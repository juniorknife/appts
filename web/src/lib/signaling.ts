/**
 * Interpretacao das mensagens de sinalizacao WebRTC do TeamSpeak 6.
 *
 * Fluxo de quem assiste (observado no protocolo):
 *  1. -> joinstreamrequest id=<stream> clid=<streamer> is_remove=0
 *  2. <- notifyrespondjoinstreamrequest (pode trazer `offer` com SDP cru)
 *        ou notifystreamsignaling json={"cmd":"joinResponse"|"offer","args":{"offer":...}}
 *  3. -> streamsignaling json={"cmd":"answer","args":{"answer":<sdp sem candidatos>}}
 *  4. <-> {"cmd":"iceCandidate","args":{"mLine":0,"mid":"0","sdp":"candidate:..."}}
 */
export type SignalMessage =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | { kind: 'unknown'; raw: string }

type Json = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : undefined

export function parseSignal(payload: string): SignalMessage {
  const trimmed = payload.trim()
  if (!trimmed) return { kind: 'unknown', raw: payload }
  if (trimmed.startsWith('v=0')) return { kind: 'offer', sdp: normalizeSdp(trimmed) }

  let json: Json
  try {
    json = JSON.parse(trimmed) as Json
  } catch {
    return { kind: 'unknown', raw: payload }
  }
  const cmd = str(json.cmd) ?? ''
  const type = (str(json.type) ?? cmd).toLowerCase()
  const args = (json.args && typeof json.args === 'object' ? json.args : {}) as Json

  const candidateObj = (json.candidate && typeof json.candidate === 'object' ? json.candidate : undefined) as Json | undefined
  const isCandidate =
    cmd === 'iceCandidate' || type === 'candidate' || type === 'icecandidate' || candidateObj !== undefined ||
    'mLine' in args || 'mid' in args || 'candidate' in args || typeof json.candidate === 'string'
  if (isCandidate) {
    const src = candidateObj ?? (Object.keys(args).length ? args : json)
    const cand = str(src.sdp) ?? str(src.candidate) ?? ''
    if (!cand) return { kind: 'unknown', raw: payload }
    return {
      kind: 'candidate',
      candidate: cand.startsWith('a=') ? cand.slice(2) : cand,
      sdpMid: str(src.mid) ?? str(src.sdpMid) ?? (num(src.mid) !== undefined ? String(num(src.mid)) : null),
      sdpMLineIndex: num(src.mLine) ?? num(src.sdpMLineIndex) ?? null,
    }
  }

  const offer = str(args.offer) ?? str(json.offer)
  const answer = str(args.answer) ?? str(json.answer)
  const sdp = str(args.sdp) ?? str(json.sdp)
  if (offer || ['joinresponse', 'offer', 'reconnectoffer'].includes(type)) {
    const value = offer ?? sdp
    if (value) return { kind: 'offer', sdp: normalizeSdp(value) }
  }
  if (answer || type === 'answer') {
    const value = answer ?? sdp
    if (value) return { kind: 'answer', sdp: normalizeSdp(value) }
  }
  return { kind: 'unknown', raw: payload }
}

/** SDP com quebras CRLF, sem linhas vazias e com CRLF final (o TS6 exige). */
export function normalizeSdp(sdp: string): string {
  return (
    sdp
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\r\n') + '\r\n'
  )
}

/** A resposta vai sem candidatos embutidos: eles seguem por trickle ICE. */
export function stripCandidates(sdp: string): string {
  return normalizeSdp(
    normalizeSdp(sdp)
      .split('\r\n')
      .filter((l) => !l.startsWith('a=candidate:') && l !== 'a=end-of-candidates')
      .join('\r\n'),
  )
}

export function answerPayload(sdp: string): string {
  return JSON.stringify({ cmd: 'answer', args: { answer: stripCandidates(sdp) } })
}

export function candidatePayload(c: RTCIceCandidateInit): string {
  return JSON.stringify({ cmd: 'iceCandidate', args: { mLine: c.sdpMLineIndex ?? 0, mid: c.sdpMid ?? '0', sdp: c.candidate } })
}
