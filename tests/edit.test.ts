import { describe, expect, it } from 'vitest';
import { removeChord } from '../src/songs/edit';
import type { ChordEvent } from '../src/chords/analyzer';

const e = (start: number, end: number, name: string, root: number, typeId = 'maj'): ChordEvent => ({ start, end, name, root, typeId, confidence: 1 });
const song = [e(0, 2, 'C', 0), e(2, 4, 'F#', 6), e(4, 6, 'G7', 7, '7'), e(6, 8, 'C', 0)];

describe('removeChord', () => {
  it('anterior continua: ocupa o tempo do apagado', () => {
    const r = removeChord(song, 1, 'prev');
    expect(r.map((x) => [x.name, x.start, x.end])).toEqual([['C', 0, 4], ['G7', 4, 6], ['C', 6, 8]].map(([n, s, en]) => [n, s, en]));
  });
  it('próximo antecipa: começa onde o apagado começava', () => {
    const r = removeChord(song, 1, 'next');
    expect(r.map((x) => [x.name, x.start, x.end])).toEqual([['C', 0, 2], ['G7', 2, 6], ['C', 6, 8]]);
  });
  it('apagar o primeiro: o próximo assume desde o início', () => {
    const r = removeChord(song, 0, 'prev');
    expect(r[0]).toMatchObject({ name: 'F#', start: 0, end: 4 });
  });
  it('apagar o último: o anterior vai até o fim', () => {
    const r = removeChord(song, 3, 'next');
    expect(r[r.length - 1]).toMatchObject({ name: 'G7', start: 4, end: 8 });
  });
  it('sem buraco nenhum depois de apagar', () => {
    for (const idx of [0, 1, 2, 3]) for (const pref of ['prev', 'next'] as const) {
      const r = removeChord(song, idx, pref);
      expect(r[0]!.start).toBe(0);
      for (let i = 1; i < r.length; i++) expect(r[i]!.start).toBe(r[i - 1]!.end);
      expect(r[r.length - 1]!.end).toBe(8);
    }
  });
  it('vizinhos iguais viram um só', () => {
    const s = [e(0, 2, 'C', 0), e(2, 4, 'F#', 6), e(4, 6, 'C', 0)];
    const r = removeChord(s, 1, 'prev');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'C', start: 0, end: 6 });
  });
  it('único acorde: só remove', () => {
    expect(removeChord([e(0, 2, 'C', 0)], 0)).toEqual([]);
  });
  it('não altera o array original', () => {
    const copy = JSON.stringify(song);
    removeChord(song, 1);
    expect(JSON.stringify(song)).toBe(copy);
  });
});

import { mergeRepeats, retypeChord } from '../src/songs/edit';

describe('mergeRepeats', () => {
  it('repetidos vizinhos viram um só, mesmo com pequena lacuna', () => {
    const r = mergeRepeats([e(0, 2, 'C', 0), e(2.4, 4, 'C', 0), e(4, 6, 'G7', 7, '7'), e(6, 8, 'G7', 7, '7'), e(8, 9, 'C', 0)]);
    expect(r.map((x) => [x.name, x.start, x.end])).toEqual([['C', 0, 4], ['G7', 4, 8], ['C', 8, 9]]);
  });
  it('lacuna grande (silêncio) não junta', () => {
    expect(mergeRepeats([e(0, 2, 'C', 0), e(10, 12, 'C', 0)])).toHaveLength(2);
  });
  it('acordes diferentes alternados não mudam', () => {
    expect(mergeRepeats(song)).toHaveLength(4);
  });
});

describe('retypeChord', () => {
  it('trocar F# por C (igual aos vizinhos) junta os três num bloco só', () => {
    const s = [e(0, 2, 'C', 0), e(2, 4, 'F#', 6), e(4, 6, 'C', 0), e(6, 8, 'G7', 7, '7')];
    const r = retypeChord(s, 1, { root: 0, typeId: 'maj', name: 'C' });
    expect(r.events.map((x) => [x.name, x.start, x.end])).toEqual([['C', 0, 6], ['G7', 6, 8]]);
    expect(r.index).toBe(0);
  });
  it('trocar por um acorde diferente dos vizinhos só renomeia', () => {
    const r = retypeChord(song, 1, { root: 5, typeId: 'maj', name: 'F' });
    expect(r.events.map((x) => x.name)).toEqual(['C', 'F', 'G7', 'C']);
    expect(r.index).toBe(1);
  });
});

import { moveStart } from '../src/songs/edit';
describe('moveStart', () => {
  it('move o início e o anterior acompanha, sem buraco', () => {
    const r = moveStart(song, 1, 2.3);
    expect(r[1]).toMatchObject({ start: 2.3, end: 4 });
    expect(r[0]!.end).toBe(2.3);
  });
  it('não ultrapassa o acorde anterior nem o próprio fim', () => {
    expect(moveStart(song, 1, -5)[1]!.start).toBeCloseTo(0.1);
    expect(moveStart(song, 1, 99)[1]!.start).toBeCloseTo(3.9);
  });
});
