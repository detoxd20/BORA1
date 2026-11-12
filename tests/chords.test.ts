import { describe, expect, it } from 'vitest';
import { ChromaExtractor } from '../src/audio/chroma';
import { detectChord } from '../src/chords/detector';
import { CHORD_TYPES, buildModel } from '../src/chords/models';
import { midiToFreq } from '../src/chords/notes';
import { synth } from './helpers';

const SR = 44100;

/** Voicing de 4 cordas dentro da faixa do cavaco (D4…~B5), como num braço real. */
function voicing(root: number, intervals: number[]): number[] {
  const base = 62 + ((root - 2 + 12) % 12); // fundamental entre D4 e C#5
  const notes = intervals.length === 5 ? [0, 4, 10, 14] : intervals.length === 3 ? [...intervals, 12] : intervals;
  const top = Math.max(...notes);
  return notes.map((iv) => base + iv - (base + top > 82 ? 12 : 0));
}

function chordSignal(midis: number[], opts: { noise?: number; detuneCents?: number } = {}): Float32Array {
  const len = 8192 + 100;
  const out = new Float32Array(len);
  midis.forEach((m, i) => {
    const f = midiToFreq(m) * Math.pow(2, ((opts.detuneCents ?? 0) * (i % 2 ? 1 : -1)) / 1200);
    const s = synth(f, SR, len, { harmonics: [1, 0.6, 0.4, 0.25, 0.15], amp: 0.2, seed: 7 + i });
    for (let k = 0; k < len; k++) out[k]! += s[k] as number;
  });
  if (opts.noise) {
    const n = synth(100, SR, len, { harmonics: [0], noise: opts.noise, seed: 99 });
    for (let k = 0; k < len; k++) out[k]! += n[k] as number;
  }
  return out;
}

const extractor = new ChromaExtractor({ sampleRate: SR });
const detect = (sig: Float32Array) => detectChord(extractor.compute(sig).chroma);

const pcKey = (name: string) => {
  const m = [...CHORD_TYPES.flatMap((t) => Array.from({ length: 12 }, (_, r) => buildModel(r, t)))].find((x) => x.name === name)!;
  return m.pitchClasses.join(',');
};

describe('detector de acordes (sintético, 12 tons × 12 tipos)', () => {
  let exact = 0, sameNotes = 0, total = 0;
  const misses: string[] = [];
  for (const type of CHORD_TYPES) {
    for (let root = 0; root < 12; root++) {
      total++;
      const truth = buildModel(root, type);
      const r = detect(chordSignal(voicing(root, type.intervals)));
      if (r.best?.name === truth.name) exact++;
      else misses.push(`${truth.name}→${r.best?.name}`);
      if (r.best && pcKey(r.best.name) === pcKey(truth.name)) sameNotes++;
    }
  }
  it('acerta o nome na grande maioria (≥ 80%; o resto são pares de mesmas notas: 6≡m7, m6≡m7b5)', () => {
    expect(exact / total, misses.join(' ')).toBeGreaterThanOrEqual(0.8);
  });
  it('quando erra o nome, ainda acerta as notas (ambiguidade real: C6 = Am7, Bm7b5 = Dm6…)', () => {
    expect(sameNotes / total, misses.join(' ')).toBeGreaterThanOrEqual(0.99);
  });
});

describe('acordes comuns de samba/pagode — nome exato, com ruído e leve desafinação', () => {
  const cases: Array<[string, number, string]> = [
    ['C', 0, 'maj'], ['G7', 7, '7'], ['Am', 9, 'min'], ['Dm', 2, 'min'], ['E7', 4, '7'],
    ['F', 5, 'maj'], ['A7', 9, '7'], ['Bm7(b5)', 11, 'm7b5'], ['D7', 2, '7'], ['Em', 4, 'min'],
  ];
  for (const [name, root, typeId] of cases) {
    it(name, () => {
      const type = CHORD_TYPES.find((t) => t.id === typeId)!;
      const sig = chordSignal(voicing(root, type.intervals), { noise: 0.01, detuneCents: 8 });
      const r = detect(sig);
      expect(r.best?.name).toBe(name);
      expect(r.confidence).toBeGreaterThan(0.5);
      expect(r.top).toHaveLength(3);
    });
  }
});

describe('casos de borda', () => {
  it('silêncio → sem acorde', () => {
    const r = detect(new Float32Array(8300));
    expect(r.best).toBeNull();
  });
  it('bônus de expectativa desempata C6 × Am7 (mesmas notas)', () => {
    const sig = chordSignal(voicing(0, [0, 4, 7, 9]));
    const c = extractor.compute(sig).chroma;
    const am7 = detectChord(c, { expected: [{ root: 9, typeId: 'm7' }] });
    const c6 = detectChord(c, { expected: [{ root: 0, typeId: '6' }] });
    expect(am7.best?.name).toBe('Am7');
    expect(c6.best?.name).toBe('C6');
  });
});
