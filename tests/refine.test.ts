import { describe, expect, it } from 'vitest';
import { analyzeChords } from '../src/chords/analyzer';
import { refineWithOnsets } from '../src/chords/refine';
import { detectOnsets } from '../src/audio/onsets';
import { midiToFreq } from '../src/chords/notes';
import { buildVocabulary } from '../src/songs/vocabulary';
import { parseChordLine } from '../src/chords/parse';

const SR = 22050;
const H = [1, 0.6, 0.4, 0.25, 0.15];
// G F#m B7 Em7 Dm G7 (acordes parecidos: dividem notas, o caso que antes atrasava/adiantava a troca)
const CH = [[67, 71, 74, 79], [66, 69, 73, 78], [71, 75, 78, 81], [64, 67, 71, 74], [62, 65, 69, 74], [67, 71, 74, 77]];
const NAMES = ['G', 'F#m', 'B7', 'Em7', 'Dm', 'G7'];

/** 5 s de "fala" (notas de voz trocando a cada 0,4 s) + 12 acordes de 2 s com palhetada + 5 s de fala. */
function lesson() {
  const total = 5 + 24 + 5;
  const out = new Float32Array(total * SR);
  const tone = (f: number, start: number, len: number, amp: number, decay: number, attack = 0.002) => {
    const s0 = Math.round(start * SR);
    for (let i = 0; i < len * SR && s0 + i < out.length; i++) {
      const t = i / SR;
      let v = 0;
      H.forEach((h, k) => (v += h * Math.sin(2 * Math.PI * f * (k + 1) * t)));
      out[s0 + i]! += amp * v * Math.exp(-t / decay) * Math.min(1, t / attack);
    }
  };
  const voice = (from: number, to: number) => {
    const notes = [70, 73, 77, 75, 68, 72];
    for (let t = from, n = 0; t < to; t += 0.4, n++) tone(midiToFreq(notes[n % 6] as number), t, 0.4, 0.12, 5, 0.03);
  };
  voice(0, 5);
  voice(29, 34);
  const truth: Array<{ t: number; name: string }> = [];
  for (let c = 0; c < 12; c++) {
    const t0 = 5 + c * 2;
    truth.push({ t: t0, name: NAMES[c % 6] as string });
    (CH[c % 6] as number[]).forEach((m, i) => tone(midiToFreq(m), t0 + i * 0.012, 2, 0.16, 1.2));
  }
  return { audio: out, truth };
}

describe('refinamento do tempo das trocas pelas palhetadas', () => {
  const { audio, truth } = lesson();
  const vocab = buildVocabulary(
    Array.from({ length: 70 }, (_, i) => ({ t: i * 0.5, chords: parseChordLine(i * 0.5 >= 5 && i * 0.5 < 29 ? 'G F#m B7 Em7 Dm G7' : '') })),
    { step: 0.5 },
  );
  const before = analyzeChords(audio, SR, { vocabulary: vocab });
  const onsets = detectOnsets(audio, SR);
  const after = refineWithOnsets(before, onsets);

  const err = (evs: typeof before) =>
    truth.map((tr) => {
      const e = evs.find((x) => x.name === tr.name && Math.abs(x.start - tr.t) < 1.5);
      return e ? Math.abs(e.start - tr.t) : Infinity;
    });

  it('reconhece os 12 acordes na ordem', () => {
    expect(after.map((e) => e.name)).toEqual(truth.map((t) => t.name));
  });
  it('depois do refinamento, TODAS as trocas ficam a menos de 60 ms do tempo real', () => {
    const e = err(after);
    expect(Math.max(...e), `erros: ${e.map((x) => x.toFixed(3)).join(' ')}`).toBeLessThan(0.06);
  });
  it('o refinamento melhora (ou mantém) o erro máximo', () => {
    expect(Math.max(...err(after))).toBeLessThanOrEqual(Math.max(...err(before)) + 1e-9);
  });
  it('o fim de cada acorde acompanha o início do próximo (sem buraco nem sobreposição)', () => {
    for (let i = 1; i < after.length; i++) expect(Math.abs((after[i - 1] as { end: number }).end - (after[i] as { start: number }).start)).toBeLessThan(0.3);
  });
});
