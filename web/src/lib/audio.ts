/**
 * Audio de voz no navegador.
 *
 * Recebimento: o gateway repassa os frames Opus do TeamSpeak (0x10). Eles sao
 * decodificados com WebCodecs (AudioDecoder). Navegadores sem WebCodecs pedem ao
 * gateway PCM ja decodificado (0x11).
 * Envio: captura com AudioWorklet, frames de 20 ms a 48 kHz. Com AudioEncoder o Opus
 * e gerado aqui (0x01, ~4 KB/s); sem ele o PCM vai cru (0x02) e o gateway codifica.
 */

const OUT_OPUS = 0x10
const OUT_PCM = 0x11
const IN_OPUS = 0x01
const IN_PCM = 0x02
const RATE = 48000
const FRAME = 960
const JITTER = 0.08 // segundos de buffer por locutor

type SpeakingListener = (clientId: number, speaking: boolean) => void

interface Speaker {
  decoder?: AudioDecoder
  channels: number
  nextTime: number
  timestamp: number
  silenceTimer?: number
}

export function canDecodeOpus(): boolean {
  return typeof window !== 'undefined' && 'AudioDecoder' in window && 'EncodedAudioChunk' in window
}

export function canEncodeOpus(): boolean {
  return typeof window !== 'undefined' && 'AudioEncoder' in window && 'AudioData' in window
}

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('tsm-capture', Capture)
`

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private speakers = new Map<number, Speaker>()
  private speakingListeners = new Set<SpeakingListener>()
  private volume = 1

  // captura
  private micStream: MediaStream | null = null
  private micNode: AudioWorkletNode | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private encoder: AudioEncoder | null = null
  private pending = new Float32Array(0)
  private encTimestamp = 0
  private transmitting = false
  private gateOpenUntil = 0
  voiceActivation = false
  /** Limiar RMS da ativacao por voz */
  vadThreshold = 0.015
  onSelfSpeaking: ((speaking: boolean) => void) | null = null
  private selfSpeaking = false

  constructor(private sendBinary: (data: ArrayBuffer) => void) {}

  /** Precisa ser chamado dentro de um gesto do usuario (politica de autoplay do mobile). */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' })
      } catch {
        this.ctx = new AudioContext()
      }
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  onSpeaking(fn: SpeakingListener) {
    this.speakingListeners.add(fn)
    return () => this.speakingListeners.delete(fn)
  }

  // ------------------------------------------------------------ recebimento

  handleFrame(buf: ArrayBuffer) {
    const view = new DataView(buf)
    if (buf.byteLength < 4) return
    const kind = view.getUint8(0)
    const clid = view.getUint16(1)
    const codec = view.getUint8(3)
    const payload = new Uint8Array(buf, 4)
    if (kind === OUT_OPUS) this.handleOpus(clid, codec, payload)
    else if (kind === OUT_PCM) this.handlePcm(clid, payload)
  }

  private speaker(clid: number): Speaker {
    let s = this.speakers.get(clid)
    if (!s) {
      s = { channels: 0, nextTime: 0, timestamp: 0 }
      this.speakers.set(clid, s)
    }
    return s
  }

  private markSpeaking(clid: number, s: Speaker, speaking: boolean) {
    if (s.silenceTimer) clearTimeout(s.silenceTimer)
    if (speaking) {
      s.silenceTimer = window.setTimeout(() => this.emitSpeaking(clid, false), 400)
    }
    this.emitSpeaking(clid, speaking)
  }

  private emitSpeaking(clid: number, speaking: boolean) {
    for (const fn of this.speakingListeners) fn(clid, speaking)
  }

  private handleOpus(clid: number, codec: number, data: Uint8Array) {
    const s = this.speaker(clid)
    if (data.length === 0) {
      // Fim da fala
      this.markSpeaking(clid, s, false)
      return
    }
    this.markSpeaking(clid, s, true)
    if (!this.ctx || !canDecodeOpus()) return
    const channels = codec === 5 ? 2 : 1 // 5 = OPUS_MUSIC (estereo)
    if (!s.decoder || s.decoder.state === 'closed' || s.channels !== channels) {
      try {
        s.decoder?.close()
      } catch {
        /* ignore */
      }
      s.channels = channels
      s.decoder = new AudioDecoder({
        output: (audio) => this.playAudioData(s, audio),
        error: () => {
          s.decoder = undefined
        },
      })
      s.decoder.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: channels })
    }
    s.timestamp += 20000
    try {
      s.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: s.timestamp, data }))
    } catch {
      s.decoder = undefined
    }
  }

  private playAudioData(s: Speaker, audio: AudioData) {
    try {
      if (!this.ctx) return
      const frames = audio.numberOfFrames
      const channels = audio.numberOfChannels
      const buffer = this.ctx.createBuffer(channels, frames, audio.sampleRate)
      for (let ch = 0; ch < channels; ch++) {
        const plane = new Float32Array(frames)
        audio.copyTo(plane, { planeIndex: ch, format: 'f32-planar' })
        buffer.copyToChannel(plane, ch)
      }
      this.schedule(s, buffer)
    } catch {
      /* frame descartado */
    } finally {
      audio.close()
    }
  }

  private handlePcm(clid: number, data: Uint8Array) {
    const s = this.speaker(clid)
    this.markSpeaking(clid, s, true)
    if (!this.ctx) return
    const samples = Math.floor(data.byteLength / 2)
    if (!samples) return
    const view = new DataView(data.buffer, data.byteOffset, samples * 2)
    const buffer = this.ctx.createBuffer(1, samples, RATE)
    const out = buffer.getChannelData(0)
    for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true) / 32768
    this.schedule(s, buffer)
  }

  private schedule(s: Speaker, buffer: AudioBuffer) {
    const ctx = this.ctx!
    const now = ctx.currentTime
    if (s.nextTime < now || s.nextTime > now + 0.6) s.nextTime = now + JITTER
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.master!)
    src.start(s.nextTime)
    s.nextTime += buffer.duration
  }

  removeSpeaker(clid: number) {
    const s = this.speakers.get(clid)
    if (!s) return
    try {
      s.decoder?.close()
    } catch {
      /* ignore */
    }
    if (s.silenceTimer) clearTimeout(s.silenceTimer)
    this.speakers.delete(clid)
  }

  resetSpeakers() {
    for (const id of [...this.speakers.keys()]) this.removeSpeaker(id)
  }

  // ------------------------------------------------------------ captura

  get micActive() {
    return this.micStream !== null
  }

  async startMic(): Promise<void> {
    this.unlock()
    if (this.micStream || !this.ctx) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    try {
      await this.ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    this.micStream = stream
    this.micSource = this.ctx.createMediaStreamSource(stream)
    this.micNode = new AudioWorkletNode(this.ctx, 'tsm-capture')
    this.micNode.port.onmessage = (e: MessageEvent<Float32Array>) => this.onMicSamples(e.data)
    this.micSource.connect(this.micNode)
    // O worklet precisa estar ligado ao grafo para processar; saida silenciosa
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    this.micNode.connect(sink).connect(this.ctx.destination)

    if (canEncodeOpus()) {
      try {
        const encoder = new AudioEncoder({
          output: (chunk) => {
            const out = new Uint8Array(chunk.byteLength + 1)
            out[0] = IN_OPUS
            chunk.copyTo(out.subarray(1))
            this.sendBinary(out.buffer)
          },
          error: () => {
            this.encoder = null
          },
        })
        encoder.configure({
          codec: 'opus',
          sampleRate: RATE,
          numberOfChannels: 1,
          bitrate: 32000,
          opus: { frameDuration: 20000 },
        } as AudioEncoderConfig)
        this.encoder = encoder
      } catch {
        this.encoder = null
      }
    }
  }

  stopMic() {
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micSource?.disconnect()
    this.micNode?.disconnect()
    try {
      this.encoder?.close()
    } catch {
      /* ignore */
    }
    this.micStream = null
    this.micSource = null
    this.micNode = null
    this.encoder = null
    this.pending = new Float32Array(0)
    this.setTransmitting(false)
  }

  setTransmitting(on: boolean) {
    this.transmitting = on
    if (!on) this.setSelfSpeaking(false)
  }

  private setSelfSpeaking(v: boolean) {
    if (v !== this.selfSpeaking) {
      this.selfSpeaking = v
      this.onSelfSpeaking?.(v)
    }
  }

  private onMicSamples(input: Float32Array) {
    if (!this.transmitting || !this.ctx) return
    const samples = this.ctx.sampleRate === RATE ? input : resample(input, this.ctx.sampleRate, RATE)
    const merged = new Float32Array(this.pending.length + samples.length)
    merged.set(this.pending)
    merged.set(samples, this.pending.length)
    let offset = 0
    while (merged.length - offset >= FRAME) {
      this.sendFrame(merged.subarray(offset, offset + FRAME))
      offset += FRAME
    }
    this.pending = merged.slice(offset)
  }

  private sendFrame(frame: Float32Array) {
    if (this.voiceActivation) {
      let sum = 0
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
      const rms = Math.sqrt(sum / frame.length)
      const now = performance.now()
      if (rms >= this.vadThreshold) this.gateOpenUntil = now + 350
      if (now > this.gateOpenUntil) {
        this.setSelfSpeaking(false)
        return
      }
    }
    this.setSelfSpeaking(true)
    if (this.encoder && this.encoder.state === 'configured') {
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: RATE,
        numberOfFrames: FRAME,
        numberOfChannels: 1,
        timestamp: this.encTimestamp,
        data: frame.slice(),
      })
      this.encTimestamp += 20000
      this.encoder.encode(data)
      data.close()
      return
    }
    const out = new DataView(new ArrayBuffer(1 + FRAME * 2))
    out.setUint8(0, IN_PCM)
    for (let i = 0; i < FRAME; i++) {
      const v = Math.max(-1, Math.min(1, frame[i]))
      out.setInt16(1 + i * 2, v < 0 ? v * 32768 : v * 32767, true)
    }
    this.sendBinary(out.buffer)
  }
}

/** Reamostragem linear simples (so usada se o AudioContext nao aceitar 48 kHz). */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const length = Math.floor(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = pos - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}
