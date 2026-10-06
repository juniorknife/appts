import type { SavedServer } from './types'

// localStorage pode falhar (modo privado, armazenamento bloqueado): tudo e protegido.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* sem persistencia */
  }
}

export interface Settings {
  /** URL do gateway; vazio = mesmo endereco do app */
  gatewayUrl: string
  accessToken: string
  defaultNickname: string
  /** 'ptt' = segurar para falar, 'open' = microfone aberto */
  talkMode: 'ptt' | 'open'
}

const DEFAULT_SETTINGS: Settings = { gatewayUrl: '', accessToken: '', defaultNickname: '', talkMode: 'ptt' }

export const storage = {
  servers: (): SavedServer[] => read('tsm.servers', []),
  saveServers: (s: SavedServer[]) => write('tsm.servers', s),
  settings: (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>('tsm.settings', {}) }),
  saveSettings: (s: Settings) => write('tsm.settings', s),
  identity: (): { value: string; uid: string } | null => read('tsm.identity', null),
  saveIdentity: (v: { value: string; uid: string } | null) => write('tsm.identity', v),
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}
