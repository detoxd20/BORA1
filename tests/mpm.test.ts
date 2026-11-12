import { describe, expect, it } from 'vitest';
import { detectPitch, MpmWorkspace, rmsDb } from '../src/tuner/mpm';
import { centsBetween } from '../src/chords/notes';
import { TUNINGS } from '../src/tuner/tunings';
import { centsToRatio, synth } from './helpers';

const N = 2048;

describe('MPM — precisão', () => {
  const freqs = [...new Set(TUNINGS.flatMap((t) => t.strings.map((s) => s.frequency)))];
  for (const sr of [44100, 48000]) {
    for (const f of freqs) {
      it(`${f.toFixed(2)} Hz @ ${sr} Hz → erro ≤ 0,5 cent (de −40 a +40 cents)`, () => {
        for (const det of [-40, -17, -5, 0, 3, 12, 40]) {
          const target = f * centsToRatio(det);
          const r = detectPitch(synth(target, sr, N), { sampleRate: sr });
          expect(r).not.toBeNull();
          expect(Math.abs(centsBetween(r!.frequency, target))).toBeLessThan(0.5);
          expect(r!.clarity).toBeGreaterThan(0.95);
        }
      });
    }
  }

  it('com ruído (SNR ~20 dB) o erro continua ≤ 1 cent', () => {
    for (const f of freqs) {
      const r = detectPitch(synth(f, 48000, N, { noise: 0.01, amp: 0.3 }), { sampleRate: 48000 });
      expect(Math.abs(centsBetween(r!.frequency, f))).toBeLessThan(1);
    }
  });

  it('não pula para a oitava quando o 2º harmônico é mais forte que a fundamental', () => {
    for (const f of freqs) {
      const r = detectPitch(synth(f, 48000, N, { harmonics: [0.7, 1, 0.5, 0.3] }), { sampleRate: 48000 });
      expect(Math.abs(centsBetween(r!.frequency, f))).toBeLessThan(1);
    }
  });

  it('fundamental fraca (só harmônicos 2 e 3 fortes) ainda cai na fundamental', () => {
    const f = 293.66;
    const r = detectPitch(synth(f, 48000, N, { harmonics: [0.3, 1, 0.9, 0.4] }), { sampleRate: 48000 });
    expect(Math.abs(centsBetween(r!.frequency, f))).toBeLessThan(2);
  });

  it('reutiliza o workspace sem mudar o resultado', () => {
    const ws = new MpmWorkspace(400);
    const sig = synth(392, 48000, N);
    const a = detectPitch(sig, { sampleRate: 48000 }, ws);
    const b = detectPitch(sig, { sampleRate: 48000 });
    expect(a!.frequency).toBeCloseTo(b!.frequency, 9);
  });
});

describe('MPM — rejeição', () => {
  it('silêncio → null', () => {
    expect(detectPitch(new Float32Array(N), { sampleRate: 48000 })).toBeNull();
  });
  it('ruído branco → clareza baixa', () => {
    const noise = synth(100, 48000, N, { harmonics: [0], noise: 0.2 });
    const r = detectPitch(noise, { sampleRate: 48000 });
    if (r) expect(r.clarity).toBeLessThan(0.8);
  });
});

describe('rmsDb', () => {
  it('senoide de amplitude 1 ≈ −3 dBFS; silêncio = −120', () => {
    const s = synth(440, 48000, 4800, { harmonics: [1], amp: 1 });
    expect(rmsDb(s)).toBeCloseTo(-3.01, 1);
    expect(rmsDb(new Float32Array(100))).toBe(-120);
  });
});
