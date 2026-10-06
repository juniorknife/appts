import { useEffect, useRef, useState } from 'react'
import { client, useApp } from '../lib/client'
import { Icon } from './Icon'

interface View {
  scale: number
  x: number
  y: number
}

const IDENTITY: View = { scale: 1, x: 0, y: 0 }
const MAX_SCALE = 6

/**
 * Player de compartilhamento de tela focado em celular: pinca para dar zoom,
 * arrastar para mover, toque duplo para alternar 1x/2,5x, tela cheia em paisagem,
 * picture-in-picture e mini player enquanto navega pelos canais.
 */
export function StreamPlayer() {
  const { watch, snapshot } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(true)
  const [view, setView] = useState<View>(IDENTITY)
  const [controls, setControls] = useState(true)
  const [muted, setMuted] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; scale: number; cx: number; cy: number; x: number; y: number } | null>(null)
  const lastTap = useRef(0)
  const hideTimer = useRef<number | undefined>(undefined)

  const active = watch.phase !== 'idle'
  const stream = snapshot.streams.find((s) => s.id === watch.streamId)
  const owner = snapshot.clients.find((c) => c.id === watch.clientId)
  const hasAudio = !!watch.media?.getAudioTracks().length

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (v.srcObject !== watch.media) v.srcObject = watch.media
    if (watch.media) void v.play().catch(() => undefined)
  }, [watch.media, expanded])

  useEffect(() => {
    if (active) {
      setExpanded(true)
      setView(IDENTITY)
    }
  }, [active, watch.streamId])

  // Mantem a tela ligada enquanto assiste
  useEffect(() => {
    if (watch.phase !== 'playing' || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => undefined)
    return () => {
      void lock?.release().catch(() => undefined)
    }
  }, [watch.phase])

  const pokeControls = () => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setControls(false), 3500)
  }
  useEffect(() => {
    if (watch.phase === 'playing') pokeControls()
    return () => clearTimeout(hideTimer.current)
  }, [watch.phase])

  if (!active) return null

  const clamp = (v: View): View => {
    const stage = stageRef.current
    const scale = Math.min(MAX_SCALE, Math.max(1, v.scale))
    if (!stage || scale === 1) return { scale, x: 0, y: 0 }
    // Limita o arraste a area real do video (object-fit: contain deixa faixas pretas)
    const video = videoRef.current
    const sw = stage.clientWidth
    const sh = stage.clientHeight
    const ar = video && video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : sw / sh
    const cw = Math.min(sw, sh * ar)
    const ch = Math.min(sh, sw / ar)
    const maxX = Math.max(0, (cw * scale - sw) / 2)
    const maxY = Math.max(0, (ch * scale - sh) / 2)
    return { scale, x: Math.max(-maxX, Math.min(maxX, v.x)), y: Math.max(-maxY, Math.min(maxY, v.y)) }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        x: view.x,
        y: view.y,
      }
    } else if (pointers.current.size === 1) {
      gesture.current = { dist: 0, scale: view.scale, cx: e.clientX, cy: e.clientY, x: view.x, y: view.y }
      const now = Date.now()
      if (now - lastTap.current < 300) {
        const stage = stageRef.current!.getBoundingClientRect()
        if (view.scale > 1) setView(IDENTITY)
        else {
          // amplia em direcao ao ponto tocado
          const dx = e.clientX - (stage.left + stage.width / 2)
          const dy = e.clientY - (stage.top + stage.height / 2)
          setView(clamp({ scale: 2.5, x: -dx * 1.5, y: -dy * 1.5 }))
        }
        lastTap.current = 0
      } else lastTap.current = now
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const scale = Math.min(MAX_SCALE, Math.max(1, (g.scale * dist) / Math.max(g.dist, 1)))
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const ratio = scale / g.scale
      setView(clamp({ scale, x: g.x * ratio + (cx - g.cx), y: g.y * ratio + (cy - g.cy) }))
    } else if (view.scale > 1) {
      setView(clamp({ scale: view.scale, x: g.x + (e.clientX - g.cx), y: g.y + (e.clientY - g.cy) }))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()]
      gesture.current = { dist: 0, scale: view.scale, cx: p.x, cy: p.y, x: view.x, y: view.y }
    } else if (pointers.current.size === 0) {
      gesture.current = null
    }
  }

  const toggleFullscreen = async () => {
    const el = stageRef.current?.parentElement
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (el?.requestFullscreen) {
        await el.requestFullscreen()
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
        await orientation.lock?.('landscape').catch(() => undefined)
      } else {
        video?.webkitEnterFullscreen?.() // iPhone: so o <video> entra em tela cheia
      }
    } catch {
      video?.webkitEnterFullscreen?.()
    }
  }

  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {
      client.toast('Picture-in-picture nao suportado neste navegador')
    }
  }

  const title = `${owner?.client_nickname ?? 'Alguem'} · ${stream?.type === 1 ? 'Camera' : 'Tela'}`
  const status =
    watch.phase === 'requesting'
      ? 'Pedindo para assistir…'
      : watch.phase === 'connecting'
        ? 'Conectando video…'
        : watch.phase === 'error' || watch.phase === 'ended'
          ? watch.error
          : null

  if (!expanded) {
    return (
      <div className="mini-player" onClick={() => setExpanded(true)}>
        <video ref={videoRef} playsInline autoPlay muted={muted} />
        {status && <div className="mini-status">{status}</div>}
        <button
          className="mini-close"
          aria-label="Parar de assistir"
          onClick={(e) => {
            e.stopPropagation()
            client.stopWatching()
          }}
        >
          <Icon name="close" />
        </button>
      </div>
    )
  }

  return (
    <div className="player" onPointerDown={pokeControls}>
      <div
        ref={stageRef}
        className="player-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted={muted}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
        {status && (
          <div className="player-status">
            {watch.phase === 'requesting' || watch.phase === 'connecting' ? <div className="spinner" /> : null}
            <p>{status}</p>
            {(watch.phase === 'error' || watch.phase === 'ended') && watch.streamId && stream && (
              <button className="btn" onClick={() => client.watchStream(stream.id, stream.client)}>
                Tentar novamente
              </button>
            )}
          </div>
        )}
      </div>

      <div className={`player-top ${controls ? '' : 'hidden'}`}>
        <button className="icon-btn" aria-label="Minimizar" onClick={() => setExpanded(false)}>
          <Icon name="down" />
        </button>
        <div className="player-title">
          <strong>{title}</strong>
          {stream && stream.width > 0 && (
            <span>
              {stream.width}×{stream.height}
              {stream.fps ? ` · ${stream.fps} fps` : ''}
            </span>
          )}
        </div>
        <button className="icon-btn" aria-label="Fechar" onClick={() => client.stopWatching()}>
          <Icon name="close" />
        </button>
      </div>

      <div className={`player-bottom ${controls ? '' : 'hidden'}`}>
        {hasAudio && (
          <button className="icon-btn" aria-label={muted ? 'Ativar som' : 'Silenciar'} onClick={() => setMuted(!muted)}>
            <Icon name={muted ? 'volume-off' : 'volume'} />
          </button>
        )}
        {view.scale > 1 && (
          <button className="chip" onClick={() => setView(IDENTITY)}>
            {view.scale.toFixed(1)}× · ajustar
          </button>
        )}
        <span className="spacer" />
        {'pictureInPictureEnabled' in document && (
          <button className="icon-btn" aria-label="Picture in picture" onClick={togglePip}>
            <Icon name="pip" />
          </button>
        )}
        <button className="icon-btn" aria-label="Tela cheia" onClick={toggleFullscreen}>
          <Icon name="fullscreen" />
        </button>
      </div>
    </div>
  )
}
