import { describe, expect, it } from 'vitest';
import { detectOnsets } from '../src/audio/onsets';
import { midiToFreq } from '../src/chords/notes';

const SR = 22050;
const H = [1, 0.6, 0.4, 0.25, 0.15];

/** Acordes com palhetada (notas entram com 12 ms de diferença) e decaimento, nos tempos dados. */
function strums(times: number[], total: number, chords: number[][], opts: { stagger?: number; decay?: number } = {}) {
  const out = new Float32Array(Math.round(total * SR));
  const stagger = opts.stagger ?? 0.012;
  const decay = opts.decay ?? 1.2;
  times.forEach((t0, ci) => {
    (chords[ci % chords.length] as number[]).forEach((m, ni) => {
      const start = Math.round((t0 + ni * stagger) * SR);
      const f = midiToFreq(m);
      for (let i = start; i < out.length && i < start + SR * 3; i++) {
        const t = (i - start) / SR;
        let v = 0;
        H.forEach((h, k) => (v += h * Math.sin(2 * Math.PI * f * (k + 1) * t)));
        out[i]! += 0.18 * v * Math.exp(-t / decay) * Math.min(1, t / 0.002);
      }
    });
  });
  return out;
}

const CH = [[72, 76, 79, 84], [67, 71, 74, 77], [69, 72, 76, 81], [62, 65, 69, 74]];

describe('detectOnsets', () => {
  const times = [0.5, 2.5, 4.5, 6.5, 8.5];
  const audio = strums(times, 10.5, CH);
  const on = detectOnsets(audio, SR);

  it('acha cada palhetada a menos de 40 ms do tempo real', () => {
    for (const t of times) {
      const near = on.reduce((b, o) => (Math.abs(o.t - t) < Math.abs(b.t - t) ? o : b), on[0]!);
      expect(Math.abs(near.t - t), `palhetada em ${t}`).toBeLessThan(0.04);
    }
  });
  it('quase sem ataques falsos (o decaimento da corda não conta)', () => {
    const falsos = on.filter((o) => times.every((t) => Math.abs(o.t - t) > 0.1));
    expect(falsos.length).toBeLessThanOrEqual(1);
  });
  it('silêncio não gera ataque', () => {
    expect(detectOnsets(new Float32Array(SR * 3), SR)).toEqual([]);
  });
  it('palhetadas rápidas (a cada 0,25 s) são separadas', () => {
    const fast = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75];
    const o = detectOnsets(strums(fast, 3, CH, { decay: 0.3 }), SR);
    expect(o.length).toBeGreaterThanOrEqual(5);
  });
});
