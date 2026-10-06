import { describe, expect, it } from 'vitest'
import { buildChannelTree, displayChannelName, orderSiblings } from './channelTree'
import type { Channel } from './types'

const ch = (id: number, parent: number, order: number, name = `c${id}`): Channel => ({ id, parent, order, channel_name: name })

describe('orderSiblings', () => {
  it('segue o encadeamento channel_order (id do irmao anterior)', () => {
    const list = [ch(3, 0, 7), ch(7, 0, 1), ch(1, 0, 0)]
    expect(orderSiblings(list).map((c) => c.id)).toEqual([1, 7, 3])
  })

  it('nao trava com ciclos e mantem canais orfaos no fim', () => {
    const list = [ch(1, 0, 0), ch(2, 0, 9), ch(3, 0, 3)]
    expect(orderSiblings(list).map((c) => c.id)).toEqual([1, 2, 3])
  })
})

describe('buildChannelTree', () => {
  it('achata em pre-ordem com profundidade e agrupa clientes', () => {
    const tree = buildChannelTree(
      [ch(1, 0, 0), ch(2, 0, 1), ch(3, 1, 0), ch(4, 99, 2)],
      [
        { id: 10, channel: 3, client_nickname: 'bia' },
        { id: 11, channel: 3, client_nickname: 'Ana' },
      ],
    )
    expect(tree.map((n) => [n.channel.id, n.depth])).toEqual([
      [1, 0],
      [3, 1],
      [2, 0],
      [4, 0], // pai desconhecido vira raiz
    ])
    expect(tree[1].clients.map((c) => c.client_nickname)).toEqual(['Ana', 'bia'])
  })
})

describe('displayChannelName', () => {
  it('reconhece espacadores', () => {
    expect(displayChannelName('[cspacer]Topo')).toEqual({ text: 'Topo', spacer: 'center' })
    expect(displayChannelName('[*spacer0]-')).toEqual({ text: '-', spacer: 'repeat' })
    expect(displayChannelName('[spacer1]Esq')).toEqual({ text: 'Esq', spacer: 'left' })
    expect(displayChannelName('Lobby')).toEqual({ text: 'Lobby', spacer: false })
  })
})
