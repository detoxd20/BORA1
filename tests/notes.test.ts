import { describe, expect, it } from 'vitest';
import { centsBetween, freqToMidi, midiToFreq, nearestNote, parseNoteName } from '../src/chords/notes';
import { TUNINGS, getTuning } from '../src/tuner/tunings';

describe('notas', () => {
  it('A4 = 440 Hz = MIDI 69', () => {
    expect(freqToMidi(440)).toBeCloseTo(69, 10);
    expect(midiToFreq(69)).toBeCloseTo(440, 10);
  });
  it('parseNoteName', () => {
    expect(parseNoteName('A4')).toBe(69);
    expect(parseNoteName('D4')).toBe(62);
    expect(parseNoteName('C-1')).toBe(0);
    expect(() => parseNoteName('H3')).toThrow();
  });
  it('nota mais próxima e cents', () => {
    const { note, cents } = nearestNote(440 * Math.pow(2, 10 / 1200));
    expect(note.name).toBe('A4');
    expect(cents).toBeCloseTo(10, 6);
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 8);
  });
});

describe('afinações do cavaquinho', () => {
  it('padrão Ré-Sol-Si-Ré bate com as frequências de referência', () => {
    const t = getTuning('re-sol-si-re');
    const expected = [293.66, 392.0, 493.88, 587.33];
    t.strings.forEach((s, i) => expect(s.frequency).toBeCloseTo(expected[i] as number, 1));
    expect(t.strings.map((s) => s.solfege)).toEqual(['Ré', 'Sol', 'Si', 'Ré']);
    expect(t.strings.map((s) => s.number)).toEqual([4, 3, 2, 1]);
  });
  it('Ré-Sol-Si-Mi tem E5 = 659,26 Hz na 1ª corda', () => {
    const t = getTuning('re-sol-si-mi');
    expect(t.strings[3]!.frequency).toBeCloseTo(659.26, 1);
  });
  it('todas as afinações têm 4 cordas dentro da faixa do detector (200–1000 Hz)', () => {
    for (const t of TUNINGS) {
      expect(t.strings).toHaveLength(4);
      for (const s of t.strings) {
        expect(s.frequency).toBeGreaterThan(200);
        expect(s.frequency).toBeLessThan(1000);
      }
    }
  });
});
