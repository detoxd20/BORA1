import { describe, expect, it } from 'vitest';
import { activeIndex } from '../src/songs/types';

const ev = (start: number, end: number) => ({ start, end, name: 'C', root: 0, typeId: 'maj', confidence: 1 });

describe('activeIndex', () => {
  const events = [ev(0, 2), ev(2, 4), ev(7, 9)];
  it('acha o acorde ativo no tempo', () => {
    expect(activeIndex(events, 0.5)).toBe(0);
    expect(activeIndex(events, 2)).toBe(1);
    expect(activeIndex(events, 8)).toBe(2);
  });
  it('em silêncio longo, nenhum acorde ativo', () => {
    expect(activeIndex(events, 5.5)).toBe(-1);
    expect(activeIndex(events, 4.3)).toBe(1);
    expect(activeIndex([], 1)).toBe(-1);
  });
});
