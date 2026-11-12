import { describe, expect, it } from 'vitest';
import { foldToOctave, TunerProcessor, type PitchFrame, type TunerReading } from '../src/tuner/tunerState';
import { getTuning } from '../src/tuner/tunings';
import { centsBetween } from '../src/chords/notes';
import { centsToRatio } from './helpers';

const tuning = getTuning('re-sol-si-re');
const DT = 512 / 48000;

/** Alimenta o processador com `sec` segundos de quadros a partir de `t0`. */
function run(
  p: TunerProcessor,
  t0: number,
  sec: number,
  gen: (i: number) => Partial<PitchFrame>,
  mode: 'auto' | 'manual' = 'auto',
  manual = 0,
) {
  let r!: TunerReading;
  const readings: TunerReading[] = [];
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    r = p.update({ t: t0 + i * DT, freq: 0, clarity: 0, levelDb: -30, ...gen(i) }, tuning, mode, manual);
    readings.push(r);
  }
  return { r, readings, tEnd: t0 + n * DT };
}

/** Pseudo-ruído determinístico em cents. */
const jitter = (amp: number) => (i: number) => Math.sin(i * 12.9898) * amp;

describe('TunerProcessor', () => {
  it('detecta a corda e o desvio em cents (auto)', () => {
    const p = new TunerProcessor();
    const f = 392 * centsToRatio(-12);
    const { r } = run(p, 0, 1, () => ({ freq: f, clarity: 0.99 }));
    expect(r.active).toBe(true);
    expect(tuning.strings[r.stringIndex]!.note).toBe('G4');
    expect(r.cents).toBeCloseTo(-12, 0);
  });

  it('estabilidade: com jitter de ±3 cents o ponteiro varia menos de 1 cent', () => {
    const p = new TunerProcessor();
    const j = jitter(3);
    const { readings } = run(p, 0, 2, (i) => ({ freq: 587.33 * centsToRatio(j(i)), clarity: 0.98 }));
    const tail = readings.slice(-100).map((r) => r.cents);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(1.5);
    expect(Math.abs(tail[tail.length - 1]!)).toBeLessThan(1);
  });

  it('não pula de nota por quadros soltos (glitch de 1–3 quadros)', () => {
    const p = new TunerProcessor();
    const { readings } = run(p, 0, 1.5, (i) => ({
      freq: i % 40 < 3 && i > 30 ? 392 : 493.88 * centsToRatio(2),
      clarity: 0.98,
    }));
    const idx = new Set(readings.filter((r) => r.active).map((r) => r.stringIndex));
    expect(idx).toEqual(new Set([2])); // só Si (3ª posição no array)
  });

  it('troca de corda no modo automático após persistir', () => {
    const p = new TunerProcessor();
    let s = run(p, 0, 0.8, () => ({ freq: 293.66, clarity: 0.98 }));
    expect(s.r.stringIndex).toBe(0);
    s = run(p, s.tEnd, 0.8, () => ({ freq: 493.88, clarity: 0.98 }));
    expect(s.r.stringIndex).toBe(2);
    expect(Math.abs(s.r.cents)).toBeLessThan(1);
  });

  it('inTune com histerese', () => {
    const p = new TunerProcessor();
    let s = run(p, 0, 1, () => ({ freq: 293.66 * centsToRatio(1), clarity: 0.98 }));
    expect(s.r.inTune).toBe(true);
    s = run(p, s.tEnd, 1, () => ({ freq: 293.66 * centsToRatio(15), clarity: 0.98 }));
    expect(s.r.inTune).toBe(false);
  });

  it('ignora ruído abaixo do limiar e baixa clareza', () => {
    const p = new TunerProcessor();
    const quiet = run(p, 0, 1, () => ({ freq: 392, clarity: 0.99, levelDb: -70 }));
    expect(quiet.r.active).toBe(false);
    const unclear = run(p, quiet.tEnd, 1, () => ({ freq: 392, clarity: 0.5, levelDb: -20 }));
    expect(unclear.r.active).toBe(false);
  });

  it('segura a leitura brevemente e depois zera quando o som some', () => {
    const p = new TunerProcessor();
    const a = run(p, 0, 1, () => ({ freq: 392, clarity: 0.99 }));
    const b = run(p, a.tEnd, 0.3, () => ({ freq: 0, clarity: 0, levelDb: -80 }));
    expect(b.r.active).toBe(true);
    expect(b.r.holding).toBe(true);
    const c = run(p, b.tEnd, 0.6, () => ({ freq: 0, clarity: 0, levelDb: -80 }));
    expect(c.r.active).toBe(false);
  });

  it('modo manual: corda fixa, e erro de oitava é corrigido', () => {
    const p = new TunerProcessor();
    // toca Ré4 mas o detector erra uma oitava acima
    const { r } = run(p, 0, 1, () => ({ freq: 293.66 * 2 * centsToRatio(5), clarity: 0.98 }), 'manual', 0);
    expect(r.stringIndex).toBe(0);
    expect(r.cents).toBeCloseTo(5, 0);
  });

  it('modo manual não troca de corda mesmo tocando outra', () => {
    const p = new TunerProcessor();
    const { r } = run(p, 0, 1, () => ({ freq: 392 * centsToRatio(-20), clarity: 0.98 }), 'manual', 1);
    expect(r.stringIndex).toBe(1);
    expect(r.cents).toBeCloseTo(-20, 0);
  });

  it('converge rápido: a 20 cents de distância, <0,25 s para chegar a ±3 cents do valor real', () => {
    const p = new TunerProcessor();
    const f = 587.33 * centsToRatio(20);
    const { readings } = run(p, 0, 0.5, () => ({ freq: f, clarity: 0.99 }));
    const firstGood = readings.findIndex((r) => r.active && Math.abs(r.cents - 20) < 3);
    expect(firstGood).toBeGreaterThanOrEqual(0);
    expect(firstGood * DT).toBeLessThan(0.25);
  });
});

describe('foldToOctave', () => {
  it('dobra para a oitava mais próxima do alvo', () => {
    expect(foldToOctave(587.33, 293.66)).toBeCloseTo(293.665, 2);
    expect(foldToOctave(146.83, 293.66)).toBeCloseTo(293.66, 1);
    expect(centsBetween(foldToOctave(300, 293.66), 293.66)).toBeCloseTo(centsBetween(300, 293.66), 6);
  });
});
