import { useEffect, useMemo, useRef, useState } from 'react'
import { buildChannelTree, displayChannelName } from '../lib/channelTree'
import { client, useApp } from '../lib/client'
import type { Channel, Client, StreamInfo } from '../lib/types'
import { Icon } from './Icon'

type Tab = 'channels' | 'live' | 'chat'

export function ServerView() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('channels')
  const { phase, server, snapshot } = app
  const liveCount = snapshot.streams.length

  useEffect(() => {
    if (tab === 'chat') client.markRead()
  }, [tab, app.messages.length])

  if (phase !== 'connected') {
    return (
      <div className="screen">
        <header className="appbar">
          <button className="icon-btn" aria-label="Voltar" onClick={() => client.disconnect()}>
            <Icon name="back" />
          </button>
          <h1>{server?.name}</h1>
        </header>
        <main className="center-state">
          {phase === 'connecting' ? (
            <>
              <div className="spinner" />
              <p>{app.message ?? 'Conectando…'}</p>
              <small>A primeira conexao gera sua identidade e pode levar alguns segundos.</small>
            </>
          ) : (
            <>
              <p className="error-text">{app.message ?? 'Desconectado'}</p>
              <div className="row">
                <button className="btn ghost" onClick={() => client.disconnect()}>
                  Voltar
                </button>
                <button className="btn primary" onClick={() => client.reconnect()}>
                  Reconectar
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" aria-label="Sair do servidor" onClick={() => client.disconnect()}>
          <Icon name="power" />
        </button>
        <div className="appbar-title">
          <h1>{server?.name}</h1>
          <small>
            <span className="dot online" /> {snapshot.clients.length} online{app.demo ? ' · demo' : ''}
          </small>
        </div>
      </header>

      <main className="scroll with-bars">
        {tab === 'channels' && <ChannelList />}
        {tab === 'live' && <LiveList />}
        {tab === 'chat' && <ChatPanel />}
      </main>

      <TalkBar />

      <nav className="tabbar">
        <button className={tab === 'channels' ? 'active' : ''} onClick={() => setTab('channels')}>
          <Icon name="channels" />
          <span>Canais</span>
        </button>
        <button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
          <Icon name="screen" />
          <span>Ao vivo</span>
          {liveCount > 0 && <em className="badge live">{liveCount}</em>}
        </button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          <Icon name="chat" />
          <span>Chat</span>
          {app.unread > 0 && tab !== 'chat' && <em className="badge">{app.unread}</em>}
        </button>
      </nav>
    </div>
  )
}

// ---------------------------------------------------------------- canais

function ChannelList() {
  const { snapshot, speaking, selfSpeaking } = useApp()
  const tree = useMemo(() => buildChannelTree(snapshot.channels, snapshot.clients), [snapshot.channels, snapshot.clients])
  const streamsByClient = useMemo(() => {
    const m = new Map<number, StreamInfo[]>()
    for (const s of snapshot.streams) m.set(s.client, [...(m.get(s.client) ?? []), s])
    return m
  }, [snapshot.streams])
  const myChannel = snapshot.clients.find((c) => c.id === snapshot.self)?.channel

  const join = (ch: Channel) => {
    if (ch.id === myChannel) return
    if (ch.channel_flag_password === '1') {
      const pw = prompt(`Senha do canal "${displayChannelName(ch.channel_name).text}"`)
      if (pw === null) return
      client.joinChannel(ch.id, pw)
    } else client.joinChannel(ch.id)
  }

  if (!tree.length) return <div className="empty"><div className="spinner" /></div>

  return (
    <ul className="channel-tree">
      {tree.map(({ channel, depth, clients }) => {
        const name = displayChannelName(channel.channel_name)
        if (name.spacer) {
          return (
            <li key={channel.id} className={`spacer-row ${name.spacer}`}>
              {name.spacer === 'repeat' ? <hr /> : <span>{name.text}</span>}
            </li>
          )
        }
        const mine = channel.id === myChannel
        return (
          <li key={channel.id} style={{ ['--depth' as string]: depth }}>
            <button className={`channel-row ${mine ? 'mine' : ''}`} onClick={() => join(channel)}>
              <span className={`channel-icon ${clients.length ? 'occupied' : ''}`} />
              <span className="channel-name">{name.text || 'Canal'}</span>
              {channel.channel_flag_password === '1' && <Icon name="lock" size={16} />}
              {mine ? <span className="tag">voce esta aqui</span> : <span className="join-hint">entrar</span>}
            </button>
            {clients.length > 0 && (
              <ul className="client-list">
                {clients.map((cl) => (
                  <ClientRow
                    key={cl.id}
                    cl={cl}
                    self={cl.id === snapshot.self}
                    speaking={cl.id === snapshot.self ? selfSpeaking : !!speaking[cl.id]}
                    streams={streamsByClient.get(cl.id) ?? []}
                  />
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ClientRow({ cl, self, speaking, streams }: { cl: Client; self: boolean; speaking: boolean; streams: StreamInfo[] }) {
  const muted = cl.client_input_muted === '1' || cl.client_input_hardware === '0'
  const deaf = cl.client_output_muted === '1' || cl.client_output_hardware === '0'
  return (
    <li className={`client-row ${speaking ? 'speaking' : ''}`}>
      <span className="client-status">
        {cl.client_away === '1' ? <Icon name="away" size={16} /> : deaf ? <Icon name="headphones-off" size={16} /> : muted ? <Icon name="mic-off" size={16} /> : <span className="voice-dot" />}
      </span>
      <span className="client-name">
        {cl.client_nickname}
        {self && <small> (voce)</small>}
      </span>
      {streams.map((s) => (
        <button key={s.id} className="live-pill" onClick={() => client.watchStream(s.id, s.client)}>
          <Icon name={s.type === 1 ? 'camera' : 'screen'} size={14} /> AO VIVO
        </button>
      ))}
    </li>
  )
}

// ---------------------------------------------------------------- ao vivo

function LiveList() {
  const { snapshot, watch } = useApp()
  const channelName = (cid: number) => displayChannelName(snapshot.channels.find((c) => c.id === cid)?.channel_name).text

  if (!snapshot.streams.length) {
    return (
      <div className="empty">
        <Icon name="screen" size={48} />
        <h2>Ninguem transmitindo</h2>
        <p>Quando alguem compartilhar a tela ou camera no seu canal, a transmissao aparece aqui.</p>
        <p className="hint">No TS6 as transmissoes costumam ser visiveis apenas para quem esta no mesmo canal.</p>
      </div>
    )
  }

  return (
    <ul className="live-grid">
      {snapshot.streams.map((s) => {
        const owner = snapshot.clients.find((c) => c.id === s.client)
        const watching = watch.streamId === s.id && watch.phase !== 'idle'
        return (
          <li key={s.id}>
            <button className="live-card" onClick={() => client.watchStream(s.id, s.client)}>
              <span className="live-thumb">
                <Icon name={s.type === 1 ? 'camera' : 'screen'} size={40} />
                <em className="badge live">AO VIVO</em>
              </span>
              <span className="live-info">
                <strong>{owner?.client_nickname ?? `Cliente ${s.client}`}</strong>
                <small>
                  {s.type === 1 ? 'Camera' : 'Tela'}
                  {s.name && s.name !== 'Screen' && s.name !== 'Camera' ? ` · ${s.name}` : ''}
                  {owner ? ` · ${channelName(owner.channel)}` : ''}
                </small>
                {s.width > 0 && (
                  <small>
                    {s.width}×{s.height}
                    {s.fps ? ` · ${s.fps} fps` : ''}
                  </small>
                )}
              </span>
              <span className="btn primary small">{watching ? 'Assistindo' : 'Assistir'}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------- chat

function ChatPanel() {
  const { messages, snapshot } = useApp()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    client.sendChat(t)
    setText('')
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.length === 0 && <p className="hint center">Mensagens do canal e privadas aparecem aqui.</p>}
        {messages.map((m) => (
          <div key={m.key} className={`chat-msg ${m.own || m.from === snapshot.self ? 'own' : ''}`}>
            <div className="chat-meta">
              <strong>{m.fromName}</strong>
              {m.mode !== 'channel' && <em>{m.mode === 'private' ? 'privado' : 'servidor'}</em>}
              <time>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
            <p>{stripBbCode(m.text)}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <input placeholder="Mensagem para o canal" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
        <button className="icon-btn" aria-label="Enviar" disabled={!text.trim()}>
          <Icon name="send" />
        </button>
      </form>
    </div>
  )
}

function stripBbCode(s: string) {
  return s.replace(/\[\/?(?:b|i|u|s|url|color|size|img)(?:=[^\]]*)?\]/gi, '')
}

// ---------------------------------------------------------------- falar

function TalkBar() {
  const { pttDown, openMic, deafened, selfSpeaking } = useApp()

  const press = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    void client.setPtt(true)
  }
  const release = () => {
    if (client.state.pttDown) void client.setPtt(false)
  }

  return (
    <div className="talkbar">
      <button
        className={`round-btn ${deafened ? 'off' : ''}`}
        aria-label={deafened ? 'Ativar som' : 'Silenciar tudo'}
        onClick={() => client.setDeafened(!deafened)}
      >
        <Icon name={deafened ? 'headphones-off' : 'headphones'} />
      </button>
      <button
        className={`ptt ${pttDown || (openMic && selfSpeaking) ? 'talking' : ''} ${openMic ? 'open' : ''}`}
        disabled={openMic}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Icon name="mic" size={26} />
        <span>{openMic ? (selfSpeaking ? 'Transmitindo' : 'Microfone aberto') : pttDown ? 'Falando…' : 'Segure para falar'}</span>
      </button>
      <button
        className={`round-btn ${openMic ? 'on' : ''}`}
        aria-label={openMic ? 'Fechar microfone' : 'Abrir microfone (ativacao por voz)'}
        onClick={() => void client.setOpenMic(!openMic)}
      >
        <Icon name={openMic ? 'mic' : 'mic-off'} />
      </button>
    </div>
  )
}
