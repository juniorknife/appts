import { describe, expect, it } from 'vitest'
import { resample } from './audio'

describe('resample', () => {
  it('converte 44,1 kHz para 48 kHz preservando o sinal', () => {
    const input = new Float32Array(441).fill(0.5)
    const out = resample(input, 44100, 48000)
    expect(out.length).toBe(480)
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true)
  })
})
