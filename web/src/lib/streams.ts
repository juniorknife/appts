import { answerPayload, candidatePayload, parseSignal } from './signaling'

export type WatchPhase = 'idle' | 'requesting' | 'connecting' | 'playing' | 'error' | 'ended'

export interface WatchState {
  phase: WatchPhase
  streamId: string | null
  clientId: number
  media: MediaStream | null
  error?: string
}

type Send = (msg: Record<string, unknown>) => void

// Os mesmos STUN usados pelo cliente oficial, mais um publico de reserva.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:turn.teamspeak.com:3478', 'stun:turn2.teamspeak.com:3478'] },
  { urls: 'stun:stun.l.google.com:19302' },
]

const REQUEST_TIMEOUT_MS = 15000

/**
 * Assiste a um compartilhamento de tela/camera do TS6 usando o WebRTC nativo do
 * navegador. O gateway so repassa a sinalizacao; a midia nao passa por ele.
 */
export class StreamWatcher {
  private pc: RTCPeerConnection | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private timeout: number | undefined
  private listeners = new Set<(s: WatchState) => void>()
  state: WatchState = { phase: 'idle', streamId: null, clientId: 0, media: null }

  constructor(private send: Send) {}

  subscribe(fn: (s: WatchState) => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private set(patch: Partial<WatchState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn(this.state)
  }

  watch(streamId: string, clientId: number) {
    if (this.state.streamId === streamId && ['requesting', 'connecting', 'playing'].includes(this.state.phase)) return
    this.stop(false)
    this.set({ phase: 'requesting', streamId, clientId, media: null, error: undefined })
    this.send({ t: 'stream.join', id: streamId, clid: clientId })
    this.timeout = window.setTimeout(() => {
      if (this.state.phase === 'requesting') {
        this.fail('O streamer nao respondeu. Talvez a stream exija aprovacao ou voce precise estar no mesmo canal.')
      }
    }, REQUEST_TIMEOUT_MS)
  }

  stop(notify = true) {
    const { streamId, clientId, phase } = this.state
    if (streamId && notify && phase !== 'idle' && phase !== 'ended') {
      this.send({ t: 'stream.leave', id: streamId, clid: clientId })
    }
    clearTimeout(this.timeout)
    this.pc?.close()
    this.pc = null
    this.pendingCandidates = []
    this.set({ phase: 'idle', streamId: null, clientId: 0, media: null, error: undefined })
  }

  /** Resposta ao joinstreamrequest. */
  handleResponse(msg: { id: string; clid: number; decision: string; offer: string; msg?: string }) {
    if (msg.id !== this.state.streamId) return
    if (msg.decision === '0' && !msg.offer) {
      this.fail(msg.msg ? `Pedido recusado: ${msg.msg}` : 'O streamer recusou o pedido para assistir.')
      return
    }
    if (msg.offer) void this.applySignal(msg.clid, msg.offer)
  }

  handleSignal(msg: { id: string; clid: number; json: string }) {
    if (msg.id !== this.state.streamId) return
    void this.applySignal(msg.clid, msg.json)
  }

  handleStopped(streamId: string) {
    if (streamId !== this.state.streamId) return
    clearTimeout(this.timeout)
    this.pc?.close()
    this.pc = null
    this.set({ phase: 'ended', media: null, error: 'A transmissao foi encerrada.' })
  }

  private fail(error: string) {
    clearTimeout(this.timeout)
    this.pc?.close()
    this.pc = null
    this.set({ phase: 'error', error, media: null })
  }

  private async applySignal(senderClid: number, payload: string) {
    const signal = parseSignal(payload)
    try {
      switch (signal.kind) {
        case 'offer':
          await this.acceptOffer(senderClid, signal.sdp)
          break
        case 'candidate': {
          const cand: RTCIceCandidateInit = {
            candidate: signal.candidate,
            sdpMid: signal.sdpMid,
            sdpMLineIndex: signal.sdpMLineIndex,
          }
          if (this.pc?.remoteDescription) await this.pc.addIceCandidate(cand)
          else this.pendingCandidates.push(cand)
          break
        }
        case 'answer':
          // Somente quem transmite recebe "answer"; quem assiste ignora.
          break
        default:
          console.debug('[stream] sinal ignorado', payload)
      }
    } catch (e) {
      this.fail(`Falha na negociacao WebRTC: ${(e as Error).message}`)
    }
  }

  private async acceptOffer(senderClid: number, sdp: string) {
    const streamId = this.state.streamId
    if (!streamId) return
    clearTimeout(this.timeout)
    this.pc?.close()
    this.set({ phase: 'connecting' })

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' })
    this.pc = pc
    const media = new MediaStream()

    pc.ontrack = (ev) => {
      if (this.pc !== pc) return
      ev.track.enabled = true
      if (!media.getTracks().includes(ev.track)) media.addTrack(ev.track)
      this.set({ media, phase: 'playing' })
    }
    pc.onicecandidate = (ev) => {
      if (this.pc !== pc || !ev.candidate || !ev.candidate.candidate) return
      this.send({ t: 'stream.signal', id: streamId, clid: senderClid, json: candidatePayload(ev.candidate.toJSON()) })
    }
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      if (pc.connectionState === 'failed') this.fail('Conexao de video falhou (rede/NAT bloqueando WebRTC).')
    }

    await pc.setRemoteDescription({ type: 'offer', sdp })
    for (const c of this.pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => undefined)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    if (this.pc !== pc) return
    this.send({ t: 'stream.signal', id: streamId, clid: senderClid, json: answerPayload(answer.sdp ?? '') })
  }
}
