import { describe, expect, it } from 'vitest';
import { analyzeChords } from '../src/chords/analyzer';
import { midiToFreq } from '../src/chords/notes';
import { synth } from './helpers';

const SR = 44100;

function song(parts: Array<{ midis: number[]; sec: number }>): Float32Array {
  const total = parts.reduce((a, p) => a + p.sec, 0);
  const out = new Float32Array(Math.round(total * SR));
  let at = 0;
  for (const p of parts) {
    const len = Math.round(p.sec * SR);
    p.midis.forEach((m, i) => {
      const s = synth(midiToFreq(m), SR, len, { amp: p.midis.length ? 0.2 : 0, seed: 3 + i });
      for (let k = 0; k < len; k++) {
        // decaimento tipo corda + ataque novo a cada acorde
        out[at + k]! += (s[k] as number) * Math.exp(-k / (SR * 1.5));
      }
    });
    at += len;
  }
  return out;
}

describe('analyzeChords (offline)', () => {
  it('segmenta uma sequência C – G7 – Am – silêncio – Dm com tempos corretos (±0,2 s)', () => {
    const audio = song([
      { midis: [72, 76, 79, 84], sec: 2 }, // C
      { midis: [67, 71, 74, 77], sec: 2 }, // G7
      { midis: [69, 72, 76, 81], sec: 2 }, // Am
      { midis: [], sec: 1 },
      { midis: [62, 65, 69, 74], sec: 2 }, // Dm
    ]);
    const ev = analyzeChords(audio, SR);
    expect(ev.map((e) => e.name)).toEqual(['C', 'G7', 'Am', 'Dm']);
    const starts = [0, 2, 4, 7];
    ev.forEach((e, i) => expect(Math.abs(e.start - (starts[i] as number))).toBeLessThan(0.2));
    expect(ev.every((e) => e.confidence > 0.6)).toBe(true);
  });
});
