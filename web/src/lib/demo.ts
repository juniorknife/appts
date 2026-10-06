import type { TsClient } from './client'
import type { ServerSnapshot } from './types'

/**
 * Modo demonstracao (endereco "demo"): simula um servidor para testar a interface
 * sem gateway. A "transmissao de tela" e um canvas animado com texto pequeno,
 * util para conferir o zoom por pinca.
 */
export function startDemo(app: TsClient): () => void {
  const snapshot: ServerSnapshot = {
    self: 10,
    channels: [
      { id: 1, parent: 0, order: 0, channel_name: '[cspacer]★ Comunidade ★' },
      { id: 2, parent: 0, order: 1, channel_name: 'Lobby', channel_flag_default: '1' },
      { id: 3, parent: 0, order: 2, channel_name: 'Jogando', channel_topic: 'Ranked' },
      { id: 4, parent: 3, order: 0, channel_name: 'Squad 1' },
      { id: 5, parent: 3, order: 4, channel_name: 'Squad 2', channel_flag_password: '1' },
      { id: 6, parent: 0, order: 3, channel_name: '[*spacer]-' },
      { id: 7, parent: 0, order: 6, channel_name: 'AFK' },
    ],
    clients: [
      { id: 10, channel: 2, client_nickname: 'Voce (mobile)' },
      { id: 11, channel: 2, client_nickname: 'Marina' },
      { id: 12, channel: 2, client_nickname: 'Rafa', client_input_muted: '1' },
      { id: 13, channel: 4, client_nickname: 'Joao' },
      { id: 14, channel: 4, client_nickname: 'Bia', client_output_muted: '1' },
      { id: 15, channel: 7, client_nickname: 'Dormindo', client_away: '1' },
    ],
    streams: [
      { id: 'demo-screen', client: 11, type: 2, name: 'Tela', width: 1920, height: 1080, fps: 30, audio: false },
      { id: 'demo-cam', client: 13, type: 1, name: 'Camera', width: 1280, height: 720, fps: 30, audio: false },
    ],
  }

  const connectTimer = window.setTimeout(() => {
    app.set({ phase: 'connected', message: undefined })
    app.applySnapshot(snapshot)
    app.pushMessage({ key: 'd1', mode: 'channel', from: 11, fromName: 'Marina', text: 'Bem-vindo! Estou compartilhando a tela.', at: Date.now() })
  }, 500)

  const talkTimer = window.setInterval(() => {
    const ids = [11, 13]
    const speaking: Record<number, true> = {}
    for (const id of ids) if (Math.random() > 0.5) speaking[id] = true
    app.set({ speaking })
  }, 1200)

  let stopCanvas: (() => void) | null = null
  app.demoWatch = (streamId, clientId) => {
    stopCanvas?.()
    const { stream, stop } = fakeScreen(streamId === 'demo-cam')
    stopCanvas = stop
    app.set({ watch: { phase: 'connecting', streamId, clientId, media: null } })
    window.setTimeout(() => app.set({ watch: { phase: 'playing', streamId, clientId, media: stream } }), 600)
  }

  return () => {
    clearTimeout(connectTimer)
    clearInterval(talkTimer)
    stopCanvas?.()
    app.demoWatch = null
  }
}

function fakeScreen(camera: boolean): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas')
  canvas.width = camera ? 1280 : 1920
  canvas.height = camera ? 720 : 1080
  const ctx = canvas.getContext('2d')!
  let frame = 0
  const draw = () => {
    frame++
    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = camera ? '#243b55' : '#1e1e1e'
    ctx.fillRect(0, 0, w, h)
    if (camera) {
      ctx.fillStyle = '#f5c26b'
      ctx.beginPath()
      ctx.arc(w / 2 + Math.sin(frame / 20) * 80, h / 2, 160, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = '#2d2d2d'
      ctx.fillRect(0, 0, w, 48)
      ctx.fillStyle = '#ccc'
      ctx.font = '22px monospace'
      ctx.fillText('editor.ts — compartilhamento de tela (demo)', 24, 32)
      ctx.font = '18px monospace'
      for (let i = 0; i < 44; i++) {
        ctx.fillStyle = i % 7 === 0 ? '#c586c0' : i % 3 === 0 ? '#4ec9b0' : '#9cdcfe'
        ctx.fillText(`${String(i + 1).padStart(3)}  const linha${i} = calcular(${i}, ${(frame + i) % 97}) // texto pequeno p/ zoom`, 24, 90 + i * 22)
      }
      ctx.fillStyle = '#e06c75'
      ctx.fillRect(1500 + Math.sin(frame / 15) * 200, 600, 120, 120)
    }
  }
  draw()
  const timer = window.setInterval(draw, 1000 / 30)
  const stream = canvas.captureStream(30)
  return {
    stream,
    stop: () => {
      clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
