import { describe, expect, it } from 'vitest'
import { answerPayload, candidatePayload, normalizeSdp, parseSignal, stripCandidates } from './signaling'

const SDP = 'v=0\no=- 1 2 IN IP4 127.0.0.1\ns=-\nm=video 9 UDP/TLS/RTP/SAVPF 96\na=candidate:1 1 udp 1 1.2.3.4 5000 typ host\na=mid:0'

describe('parseSignal', () => {
  it('aceita SDP cru (offer do respondjoinstreamrequest)', () => {
    const s = parseSignal(SDP)
    expect(s.kind).toBe('offer')
    if (s.kind === 'offer') expect(s.sdp.endsWith('\r\n')).toBe(true)
  })

  it('aceita joinResponse / offer em JSON', () => {
    expect(parseSignal(JSON.stringify({ cmd: 'joinResponse', args: { offer: SDP } })).kind).toBe('offer')
    expect(parseSignal(JSON.stringify({ type: 'offer', sdp: SDP })).kind).toBe('offer')
  })

  it('aceita candidatos no formato do TS6 e no formato padrao', () => {
    const ts = parseSignal(JSON.stringify({ cmd: 'iceCandidate', args: { mLine: 0, mid: '0', sdp: 'candidate:1 1 udp 1 1.2.3.4 5000 typ host' } }))
    expect(ts).toEqual({ kind: 'candidate', candidate: 'candidate:1 1 udp 1 1.2.3.4 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 })
    const std = parseSignal(JSON.stringify({ candidate: { candidate: 'a=candidate:2 1 udp 1 h 1 typ host', sdpMid: 'v', sdpMLineIndex: '1' } }))
    expect(std).toEqual({ kind: 'candidate', candidate: 'candidate:2 1 udp 1 h 1 typ host', sdpMid: 'v', sdpMLineIndex: 1 })
  })

  it('aceita answer e ignora lixo', () => {
    expect(parseSignal(JSON.stringify({ cmd: 'answer', args: { answer: SDP } })).kind).toBe('answer')
    expect(parseSignal('nao e json').kind).toBe('unknown')
    expect(parseSignal('').kind).toBe('unknown')
  })
})

describe('payloads enviados', () => {
  it('answer vai sem candidatos e com CRLF final', () => {
    const parsed = JSON.parse(answerPayload(SDP))
    expect(parsed.cmd).toBe('answer')
    expect(parsed.args.answer).not.toContain('a=candidate')
    expect(parsed.args.answer.endsWith('\r\n')).toBe(true)
    expect(stripCandidates(SDP)).toBe(normalizeSdp(SDP.replace(/a=candidate[^\n]*\n/, '')))
  })

  it('candidato no formato iceCandidate', () => {
    expect(JSON.parse(candidatePayload({ candidate: 'candidate:x', sdpMid: '0', sdpMLineIndex: 0 }))).toEqual({
      cmd: 'iceCandidate',
      args: { mLine: 0, mid: '0', sdp: 'candidate:x' },
    })
  })
})
