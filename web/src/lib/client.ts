import { useSyncExternalStore } from 'react'
import { AudioEngine, canDecodeOpus } from './audio'
import { startDemo } from './demo'
import { storage } from './storage'
import { StreamWatcher, type WatchState } from './streams'
import type { ChatMessage, Phase, SavedServer, ServerSnapshot } from './types'

export interface AppState {
  phase: Phase
  message?: string
  server: SavedServer | null
  snapshot: ServerSnapshot
  speaking: Record<number, true>
  selfSpeaking: boolean
  messages: ChatMessage[]
  unread: number
  pttDown: boolean
  openMic: boolean
  micError?: string
  deafened: boolean
  watch: WatchState
  toast?: { text: string; at: number }
  demo: boolean
}

const EMPTY: ServerSnapshot = { self: 0, channels: [], clients: [], streams: [] }

function gatewayUrl(): string {
  const { gatewayUrl, accessToken } = storage.settings()
  let base: string
  if (gatewayUrl.trim()) {
    base = gatewayUrl.trim().replace(/\/+$/, '').replace(/^http/, 'ws')
    if (!/\/ws$/.test(base)) base += '/ws'
  } else {
    base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  }
  return accessToken ? `${base}?token=${encodeURIComponent(accessToken)}` : base
}

/** Estado global do app + conexao com o gateway. */
class TsClient {
  private ws: WebSocket | null = null
  private listeners = new Set<() => void>()
  private demoStop: (() => void) | null = null
  private keepAlive: number | undefined
  readonly audio = new AudioEngine((data) => this.sendBinary(data))
  readonly watcher = new StreamWatcher((msg) => this.send(msg))

  state: AppState = {
    phase: 'idle',
    server: null,
    snapshot: EMPTY,
    speaking: {},
    selfSpeaking: false,
    messages: [],
    unread: 0,
    pttDown: false,
    openMic: false,
    deafened: false,
    watch: this.watcher.state,
    demo: false,
  }

  constructor() {
    this.audio.onSpeaking((clid, on) => {
      const has = !!this.state.speaking[clid]
      if (has === on) return
      const speaking = { ...this.state.speaking }
      if (on) speaking[clid] = true
      else delete speaking[clid]
      this.set({ speaking })
    })
    this.audio.onSelfSpeaking = (on) => this.set({ selfSpeaking: on })
    this.watcher.subscribe((watch) => this.set({ watch }))
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getState = () => this.state

  set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  toast(text: string) {
    this.set({ toast: { text, at: Date.now() } })
  }

  // ------------------------------------------------------------ conexao

  connect(server: SavedServer) {
    this.audio.unlock() // gesto do usuario: libera o audio no mobile
    this.closeSocket()
    this.set({
      phase: 'connecting',
      message: `Conectando a ${server.host}…`,
      server,
      snapshot: EMPTY,
      messages: [],
      unread: 0,
      speaking: {},
      demo: false,
    })

    if (server.host.trim().toLowerCase() === 'demo') {
      this.set({ demo: true })
      this.demoStop = startDemo(this)
      return
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(gatewayUrl())
    } catch {
      this.set({ phase: 'error', message: 'Endereco do gateway invalido. Verifique em Ajustes.' })
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      const identity = storage.identity()
      this.send({
        t: 'connect',
        host: server.host,
        port: server.port || 9987,
        nickname: server.nickname || storage.settings().defaultNickname || 'Mobile',
        password: server.password,
        identity: identity?.value ?? '',
        audio: canDecodeOpus() ? 'opus' : 'pcm',
      })
      this.keepAlive = window.setInterval(() => this.send({ t: 'ping' }), 25000)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.onMessage(JSON.parse(ev.data))
      else this.audio.handleFrame(ev.data as ArrayBuffer)
    }
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      clearInterval(this.keepAlive)
      this.teardownSession()
      const reason =
        ev.code === 4401
          ? 'Gateway recusou o token de acesso (Ajustes > Token).'
          : this.state.phase === 'connecting'
            ? 'Nao foi possivel falar com o gateway. Verifique o endereco em Ajustes.'
            : 'Conexao com o gateway perdida.'
      if (this.state.phase !== 'idle' && this.state.phase !== 'error') this.set({ phase: 'disconnected', message: reason })
    }
  }

  disconnect() {
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'disconnect' })
    this.closeSocket()
    this.teardownSession()
    this.set({ phase: 'idle', server: null, snapshot: EMPTY, message: undefined, demo: false })
  }

  reconnect() {
    if (this.state.server) this.connect(this.state.server)
  }

  private closeSocket() {
    this.demoStop?.()
    this.demoStop = null
    const ws = this.ws
    this.ws = null
    clearInterval(this.keepAlive)
    if (ws) {
      ws.onclose = null
      ws.close()
    }
  }

  private teardownSession() {
    this.watcher.stop(false)
    this.audio.stopMic()
    this.audio.resetSpeakers()
    this.set({ pttDown: false, openMic: false, speaking: {}, selfSpeaking: false })
  }

  send(msg: Record<string, unknown>) {
    if (this.state.demo) return
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private sendBinary(data: ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 64 * 1024) this.ws.send(data)
  }

  // ------------------------------------------------------------ mensagens do gateway

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onMessage(msg: any) {
    switch (msg.t) {
      case 'status':
        this.set({ phase: msg.phase as Phase, message: msg.message })
        if (msg.phase !== 'connected') this.teardownSession()
        break
      case 'state':
        this.applySnapshot(msg as ServerSnapshot)
        break
      case 'identity':
        storage.saveIdentity({ value: msg.value, uid: msg.uid })
        break
      case 'message':
        this.pushMessage({ ...msg, key: `${msg.at}-${Math.random()}` })
        break
      case 'poke':
        this.toast(`${msg.fromName} cutucou voce: ${msg.text}`)
        navigator.vibrate?.(200)
        break
      case 'stream.response':
        this.watcher.handleResponse(msg)
        break
      case 'stream.signal':
        this.watcher.handleSignal(msg)
        break
      case 'stream.stopped':
        this.watcher.handleStopped(msg.id)
        break
      case 'error':
        this.toast(msg.message)
        break
    }
  }

  applySnapshot(snapshot: ServerSnapshot) {
    const present = new Set(snapshot.clients.map((c) => c.id))
    for (const id of Object.keys(this.state.speaking).map(Number)) {
      if (!present.has(id)) this.audio.removeSpeaker(id)
    }
    const watch = this.state.watch
    if (watch.streamId && watch.phase !== 'idle' && !snapshot.streams.some((s) => s.id === watch.streamId)) {
      // a stream sumiu do estado (streamer saiu ou mudou de canal)
      if (this.state.snapshot.streams.some((s) => s.id === watch.streamId)) this.watcher.handleStopped(watch.streamId)
    }
    this.set({ snapshot })
  }

  pushMessage(m: ChatMessage) {
    const messages = [...this.state.messages, m].slice(-200)
    this.set({ messages, unread: m.own ? this.state.unread : this.state.unread + 1 })
  }

  // ------------------------------------------------------------ acoes

  joinChannel(cid: number, password = '') {
    if (this.state.demo) {
      const self = this.state.snapshot.self
      this.applySnapshot({
        ...this.state.snapshot,
        clients: this.state.snapshot.clients.map((c) => (c.id === self ? { ...c, channel: cid } : c)),
      })
      return
    }
    this.send({ t: 'join', cid, password })
  }

  sendChat(text: string) {
    const self = this.state.snapshot.clients.find((c) => c.id === this.state.snapshot.self)
    this.send({ t: 'message', mode: 'channel', text })
    this.pushMessage({
      key: `own-${Date.now()}`,
      mode: 'channel',
      from: this.state.snapshot.self,
      fromName: self?.client_nickname ?? 'Eu',
      text,
      at: Date.now(),
      own: true,
    })
  }

  markRead() {
    if (this.state.unread) this.set({ unread: 0 })
  }

  async ensureMic(): Promise<boolean> {
    if (this.audio.micActive) return true
    try {
      await this.audio.startMic()
      this.set({ micError: undefined })
      return true
    } catch (e) {
      const err = e as Error
      this.set({ micError: err.name === 'NotAllowedError' ? 'Permissao de microfone negada.' : `Microfone indisponivel: ${err.message}` })
      this.toast(this.state.micError!)
      return false
    }
  }

  async setPtt(down: boolean) {
    if (down && !(await this.ensureMic())) return
    this.set({ pttDown: down })
    if (this.state.openMic) return
    this.audio.voiceActivation = false
    this.audio.setTransmitting(down)
    this.send({ t: 'talk', on: down })
  }

  async setOpenMic(on: boolean) {
    if (on && !(await this.ensureMic())) return
    this.set({ openMic: on })
    this.audio.voiceActivation = on
    this.audio.setTransmitting(on)
    this.send({ t: 'talk', on })
    if (!on) this.audio.stopMic()
  }

  setDeafened(on: boolean) {
    this.set({ deafened: on })
    this.audio.setVolume(on ? 0 : 1)
    this.send({ t: 'deafen', on })
  }

  watchStream(streamId: string, clientId: number) {
    this.audio.unlock()
    if (this.state.demo) {
      this.demoWatch?.(streamId, clientId)
      return
    }
    this.watcher.watch(streamId, clientId)
  }

  stopWatching() {
    if (this.state.demo) {
      this.state.watch.media?.getTracks().forEach((t) => t.stop())
      this.set({ watch: { phase: 'idle', streamId: null, clientId: 0, media: null } })
      return
    }
    this.watcher.stop()
  }

  newIdentity() {
    storage.saveIdentity(null)
  }

  /** Preenchido pelo modo demonstracao */
  demoWatch: ((streamId: string, clientId: number) => void) | null = null
}

export const client = new TsClient()
export type { TsClient }

export function useApp(): AppState {
  return useSyncExternalStore(client.subscribe, client.getState)
}
