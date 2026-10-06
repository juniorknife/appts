import { useState } from 'react'
import { client } from '../lib/client'
import { newId, storage, type Settings } from '../lib/storage'
import type { SavedServer } from '../lib/types'
import { Icon } from './Icon'

export function ServerList() {
  const [servers, setServers] = useState<SavedServer[]>(() => storage.servers())
  const [editing, setEditing] = useState<SavedServer | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const save = (s: SavedServer) => {
    const next = servers.some((x) => x.id === s.id) ? servers.map((x) => (x.id === s.id ? s : x)) : [...servers, s]
    setServers(next)
    storage.saveServers(next)
    setEditing(null)
  }

  const remove = (id: string) => {
    const next = servers.filter((x) => x.id !== id)
    setServers(next)
    storage.saveServers(next)
    setEditing(null)
  }

  const blank = (): SavedServer => ({
    id: newId(),
    name: '',
    host: '',
    port: 9987,
    nickname: storage.settings().defaultNickname,
    password: '',
  })

  return (
    <div className="screen">
      <header className="appbar">
        <h1>Servidores</h1>
        <button className="icon-btn" aria-label="Ajustes" onClick={() => setShowSettings(true)}>
          <Icon name="settings" />
        </button>
      </header>

      <main className="scroll">
        {servers.length === 0 ? (
          <div className="empty">
            <Icon name="headphones" size={48} />
            <h2>Nenhum servidor ainda</h2>
            <p>Adicione um servidor TeamSpeak 6 (ou TS3) para entrar nos canais e assistir as transmissoes de tela.</p>
            <p className="hint">
              Quer so ver a interface? Adicione um servidor com endereco <code>demo</code>.
            </p>
          </div>
        ) : (
          <ul className="server-list">
            {servers.map((s) => (
              <li key={s.id} className="server-card">
                <button className="server-main" onClick={() => client.connect(s)}>
                  <span className="server-avatar">{(s.name || s.host).slice(0, 1).toUpperCase()}</span>
                  <span className="server-text">
                    <strong>{s.name || s.host}</strong>
                    <small>
                      {s.host}
                      {s.port && s.port !== 9987 ? `:${s.port}` : ''} · {s.nickname || 'sem apelido'}
                    </small>
                  </span>
                </button>
                <button className="icon-btn" aria-label={`Editar ${s.name || s.host}`} onClick={() => setEditing(s)}>
                  <Icon name="edit" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <button className="fab" aria-label="Adicionar servidor" onClick={() => setEditing(blank())}>
        <Icon name="plus" size={28} />
      </button>

      {editing && (
        <ServerForm
          server={editing}
          isNew={!servers.some((x) => x.id === editing.id)}
          onSave={save}
          onDelete={() => remove(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {showSettings && <SettingsSheet onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function parseAddress(input: string, fallbackPort: number): { host: string; port: number } {
  const value = input.trim().replace(/^ts3server:\/\//i, '').split(/[/?]/)[0]
  const ipv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(value)
  if (ipv6) return { host: ipv6[1], port: ipv6[2] ? Number(ipv6[2]) : fallbackPort }
  const m = /^([^:]+):(\d+)$/.exec(value)
  if (m) return { host: m[1], port: Number(m[2]) }
  return { host: value, port: fallbackPort }
}

function ServerForm(props: {
  server: SavedServer
  isNew: boolean
  onSave: (s: SavedServer) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [s, setS] = useState(props.server)
  const [address, setAddress] = useState(
    props.server.host ? `${props.server.host}${props.server.port !== 9987 ? `:${props.server.port}` : ''}` : '',
  )
  const valid = address.trim().length > 0 && s.nickname.trim().length > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const { host, port } = parseAddress(address, 9987)
    props.onSave({ ...s, host, port, name: s.name.trim() || host, nickname: s.nickname.trim() })
  }

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-handle" />
        <h2>{props.isNew ? 'Adicionar servidor' : 'Editar servidor'}</h2>
        <label>
          Endereco
          <input
            autoFocus={props.isNew}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="ts.exemplo.com ou 1.2.3.4:9987"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label>
          Nome (opcional)
          <input placeholder="Meu clan" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
        </label>
        <label>
          Apelido
          <input
            autoCapitalize="off"
            maxLength={30}
            placeholder="Seu nome no servidor"
            value={s.nickname}
            onChange={(e) => setS({ ...s, nickname: e.target.value })}
          />
        </label>
        <label>
          Senha do servidor
          <input
            type="password"
            autoComplete="off"
            placeholder="(se houver)"
            value={s.password}
            onChange={(e) => setS({ ...s, password: e.target.value })}
          />
        </label>
        <div className="sheet-actions">
          {!props.isNew && (
            <button type="button" className="btn danger" onClick={props.onDelete}>
              <Icon name="trash" size={18} /> Remover
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={props.onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            Salvar
          </button>
        </div>
      </form>
    </div>
  )
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>(() => storage.settings())
  const [identity, setIdentity] = useState(() => storage.identity())
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    storage.saveSettings(settings)
    onClose()
  }

  const resetIdentity = () => {
    if (!confirm('Gerar nova identidade? Voce perde permissoes/grupos ligados a identidade atual.')) return
    client.newIdentity()
    setIdentity(null)
  }

  const exportIdentity = async () => {
    if (!identity) return
    try {
      await navigator.clipboard.writeText(identity.value)
      client.toast('Identidade copiada')
    } catch {
      setImportText(identity.value)
      setImporting(true)
    }
  }

  const importIdentity = () => {
    const text = importText.trim()
    if (!text) return
    storage.saveIdentity({ value: text, uid: '(sera validada ao conectar)' })
    setIdentity(storage.identity())
    setImporting(false)
    setImportText('')
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sheet-handle" />
        <h2>Ajustes</h2>
        <label>
          Gateway
          <input
            inputMode="url"
            autoCapitalize="off"
            placeholder={`${location.origin} (padrao)`}
            value={settings.gatewayUrl}
            onChange={(e) => setSettings({ ...settings, gatewayUrl: e.target.value })}
          />
          <small>O app conversa com o TeamSpeak por meio do gateway. Deixe vazio se ele serve este app.</small>
        </label>
        <label>
          Token de acesso do gateway
          <input
            type="password"
            autoComplete="off"
            value={settings.accessToken}
            onChange={(e) => setSettings({ ...settings, accessToken: e.target.value })}
          />
        </label>
        <label>
          Apelido padrao
          <input
            maxLength={30}
            value={settings.defaultNickname}
            onChange={(e) => setSettings({ ...settings, defaultNickname: e.target.value })}
          />
        </label>

        <div className="field">
          <span>Identidade TeamSpeak</span>
          <small className="mono">{identity ? identity.uid : 'Sera criada na primeira conexao'}</small>
          <div className="row">
            {identity && (
              <button type="button" className="btn ghost" onClick={exportIdentity}>
                Exportar
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => setImporting(!importing)}>
              Importar
            </button>
            {identity && (
              <button type="button" className="btn ghost danger" onClick={resetIdentity}>
                Nova
              </button>
            )}
          </div>
          {importing && (
            <>
              <textarea
                rows={4}
                placeholder="Cole aqui a identidade exportada (formato ini do ts3j)"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button type="button" className="btn" onClick={importIdentity}>
                Usar esta identidade
              </button>
            </>
          )}
        </div>

        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            Salvar
          </button>
        </div>
      </form>
    </div>
  )
}
