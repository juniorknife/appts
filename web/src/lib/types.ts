export interface SavedServer {
  id: string
  name: string
  host: string
  port: number
  nickname: string
  password: string
}

export interface Channel {
  id: number
  parent: number
  order: number
  channel_name?: string
  channel_topic?: string
  channel_flag_password?: string
  channel_flag_default?: string
  channel_maxclients?: string
}

export interface Client {
  id: number
  channel: number
  client_nickname?: string
  client_input_muted?: string
  client_output_muted?: string
  client_away?: string
  client_away_message?: string
  client_input_hardware?: string
  client_output_hardware?: string
  client_is_recording?: string
  client_is_priority_speaker?: string
  client_is_channel_commander?: string
  client_country?: string
}

export interface StreamInfo {
  id: string
  client: number
  /** 1 = camera, 2 = tela (valores observados no TS6) */
  type: number
  name: string
  width: number
  height: number
  fps: number
  audio: boolean
}

export interface ServerSnapshot {
  self: number
  channels: Channel[]
  clients: Client[]
  streams: StreamInfo[]
}

export type Phase = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ChatMessage {
  key: string
  mode: 'channel' | 'private' | 'server'
  from: number
  fromName: string
  text: string
  at: number
  own?: boolean
}
