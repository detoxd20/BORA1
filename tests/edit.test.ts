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

import { insertChord, moveEnd } from '../src/songs/edit';
describe('insertChord', () => {
  it('dentro de um acorde: o novo fica com o resto, o anterior termina ali', () => {
    const r = insertChord(song, 3);
    expect(r.events.map((x) => [x.name, x.start, x.end])).toEqual([['C', 0, 2], ['F#', 2, 3], ['F#', 3, 4], ['G7', 4, 6], ['C', 6, 8]]);
    expect(r.index).toBe(2);
  });
  it('repartir um intervalo em sequência cobre tudo sem buraco', () => {
    let s = [e(0, 8, 'C', 0)];
    s = insertChord(s, 2).events;
    s = insertChord(s, 5).events;
    expect(s.map((x) => [x.start, x.end])).toEqual([[0, 2], [2, 5], [5, 8]]);
  });
  it('em lacuna (silêncio): vai até o próximo acorde, no máximo 2 s', () => {
    const g = [e(0, 2, 'C', 0), e(10, 12, 'G7', 7, '7')];
    expect(insertChord(g, 4).events[1]).toMatchObject({ start: 4, end: 6 });
    expect(insertChord(g, 9).events[1]).toMatchObject({ start: 9, end: 10 });
  });
  it('no começo exato de um acorde, edita o próprio (sem pedaço minúsculo)', () => {
    const r = insertChord(song, 2.05);
    expect(r.events).toHaveLength(4);
    expect(r.index).toBe(1);
  });
});

describe('moveEnd', () => {
  it('move o fim e o próximo acompanha', () => {
    const r = moveEnd(song, 1, 3.5);
    expect(r[1]!.end).toBe(3.5);
    expect(r[2]!.start).toBe(3.5);
  });
});

import { dropShort } from '../src/songs/edit';
describe('dropShort', () => {
  it('acorde curtinho entre dois acordes some e o anterior ocupa o tempo', () => {
    const s = [e(0, 2, 'C', 0), e(2, 2.3, 'G7', 7, '7'), e(2.3, 4, 'Dm', 2, 'min')];
    const r = dropShort(s, 0.6);
    expect(r.removed).toBe(1);
    expect(r.events.map((x) => [x.name, x.start, x.end])).toEqual([['C', 0, 2.3], ['Dm', 2.3, 4]]);
  });
  it('vários curtos seguidos e curto no começo', () => {
    const s = [e(0, 0.2, 'A', 9), e(0.2, 3, 'C', 0), e(3, 3.2, 'F#', 6), e(3.2, 3.4, 'B', 11), e(3.4, 6, 'G7', 7, '7')];
    const r = dropShort(s, 0.6);
    expect(r.removed).toBe(3);
    expect(r.events.map((x) => [x.name, x.start, x.end])).toEqual([['C', 0, 3.4], ['G7', 3.4, 6]]);
  });
  it('sem curtos, nada muda', () => {
    expect(dropShort(song, 0.6)).toEqual({ events: song, removed: 0 });
  });
});
