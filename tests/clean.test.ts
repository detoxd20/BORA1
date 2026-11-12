import { describe, expect, it } from 'vitest';
import { cleanEvents, CLEAN_LEVELS, type ChordEvent } from '../src/chords/analyzer';

const e = (start: number, end: number, name: string, root: number, typeId: string, confidence: number): ChordEvent => ({ start, end, name, root, typeId, confidence });

describe('cleanEvents', () => {
  const raw = [
    e(0, 3, 'C', 0, 'maj', 0.9),
    e(3, 3.3, 'F#', 6, 'maj', 0.8), // batida na troca (curta)
    e(3.3, 6, 'G7', 7, '7', 0.9),
    e(6, 8, 'A#', 10, 'maj', 0.4), // voz (baixa confiança)
    e(8, 10, 'C', 0, 'maj', 0.85),
    e(10, 12, 'C', 0, 'maj', 0.85), // repetido: junta
  ];
  it('descarta batidas curtas e voz, e junta repetidos', () => {
    const out = cleanEvents(raw, CLEAN_LEVELS.medio);
    expect(out.map((x) => x.name)).toEqual(['C', 'G7', 'C']);
    expect(out[2]!.end).toBe(12);
  });
  it('nível suave é mais permissivo que o forte', () => {
    expect(cleanEvents(raw, CLEAN_LEVELS.suave).length).toBeGreaterThanOrEqual(cleanEvents(raw, CLEAN_LEVELS.forte).length);
  });
});
