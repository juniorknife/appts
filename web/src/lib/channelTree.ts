import type { Channel, Client } from './types'

export interface ChannelNode {
  channel: Channel
  depth: number
  clients: Client[]
}

/**
 * Ordena os canais como o cliente oficial: dentro de cada pai, `order` aponta para o
 * id do irmao que vem imediatamente antes (0 = primeiro). Devolve uma lista achatada
 * em pre-ordem com a profundidade, pronta para renderizar.
 */
export function buildChannelTree(channels: Channel[], clients: Client[]): ChannelNode[] {
  const byParent = new Map<number, Channel[]>()
  const known = new Set(channels.map((c) => c.id))
  for (const ch of channels) {
    const parent = known.has(ch.parent) ? ch.parent : 0
    const list = byParent.get(parent) ?? []
    list.push(ch)
    byParent.set(parent, list)
  }

  const clientsByChannel = new Map<number, Client[]>()
  for (const cl of clients) {
    const list = clientsByChannel.get(cl.channel) ?? []
    list.push(cl)
    clientsByChannel.set(cl.channel, list)
  }
  for (const list of clientsByChannel.values()) {
    list.sort((a, b) => (a.client_nickname ?? '').localeCompare(b.client_nickname ?? '', undefined, { sensitivity: 'base' }))
  }

  const out: ChannelNode[] = []
  const visit = (parent: number, depth: number) => {
    for (const ch of orderSiblings(byParent.get(parent) ?? [])) {
      out.push({ channel: ch, depth, clients: clientsByChannel.get(ch.id) ?? [] })
      visit(ch.id, depth + 1)
    }
  }
  visit(0, 0)
  return out
}

export function orderSiblings(siblings: Channel[]): Channel[] {
  const after = new Map<number, Channel>()
  for (const ch of siblings) if (!after.has(ch.order)) after.set(ch.order, ch)
  const result: Channel[] = []
  const used = new Set<number>()
  let prev = 0
  while (after.has(prev)) {
    const next = after.get(prev)!
    if (used.has(next.id)) break // ciclo: protege contra dados inconsistentes
    result.push(next)
    used.add(next.id)
    prev = next.id
  }
  // Canais com encadeamento quebrado vao para o fim em ordem de id
  for (const ch of [...siblings].sort((a, b) => a.id - b.id)) if (!used.has(ch.id)) result.push(ch)
  return result
}

/** Remove a formatacao de espacador do TS ("[cspacer]Titulo", "[*spacer]---"). */
export function displayChannelName(name: string | undefined): { text: string; spacer: false | 'left' | 'center' | 'right' | 'repeat' } {
  const raw = name ?? ''
  const m = /^\[([lcr*]?)spacer[^\]]*\](.*)$/i.exec(raw)
  if (!m) return { text: raw, spacer: false }
  const kind = m[1].toLowerCase()
  const spacer = kind === 'c' ? 'center' : kind === 'r' ? 'right' : kind === '*' ? 'repeat' : 'left'
  return { text: m[2], spacer }
}
