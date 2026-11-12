import { describe, expect, it } from 'vitest';
import { CHORD_TYPES } from '../src/chords/models';
import { bestShape, shapesFor, validateShape, diagramWindow } from '../src/chords/shapes';
import { NOTE_NAMES } from '../src/chords/notes';

const OPEN = [62, 67, 71, 74]; // D4 G4 B4 D5

describe('formações de acordes no cavaquinho (D G B D)', () => {
  it('TODO acorde (12 notas × 12 tipos) tem formação, e cada nota tocada pertence ao acorde', () => {
    for (const type of CHORD_TYPES) {
      for (let root = 0; root < 12; root++) {
        const s = bestShape(root, type.id);
        const name = `${NOTE_NAMES[root]}${type.suffix}`;
        expect(s, `sem formação para ${name}`).not.toBeNull();
        expect(validateShape(s!.frets, root, type.id), `formação inválida para ${name}: ${s!.frets}`).toBe(true);
        const chordPcs = new Set(type.intervals.map((i) => (root + i) % 12));
        s!.frets.forEach((f, i) => expect(chordPcs.has((OPEN[i]! + f) % 12), `${name}: corda ${i} casa ${f}`).toBe(true));
      }
    }
  });

  it('formações conhecidas do cavaquinho são aceitas pelo validador', () => {
    expect(validateShape([2, 0, 1, 2], 0, 'maj')).toBe(true); // C  = E G C E
    expect(validateShape([2, 2, 1, 2], 9, 'min')).toBe(true); // Am = E A C E
    expect(validateShape([0, 2, 3, 3], 2, 'min')).toBe(true); // Dm = D A D F
    expect(validateShape([3, 0, 0, 0], 7, '7')).toBe(true); // G7 = F G B D
    expect(validateShape([0, 0, 0, 0], 7, 'maj')).toBe(true); // G  = D G B D (cordas soltas)
  });

  it('validador recusa formações erradas', () => {
    expect(validateShape([0, 0, 0, 0], 0, 'maj')).toBe(false); // soltas não são C
    expect(validateShape([2, 0, 1, 2], 0, 'min')).toBe(false); // C maior não é Cm
    expect(validateShape([0, 0, 0, 0], 7, '7')).toBe(false); // falta o F
    expect(validateShape([2, 0, 1], 0, 'maj')).toBe(false); // só 3 cordas
  });

  it('acordes comuns saem com formações fáceis (baixas e com poucos dedos)', () => {
    for (const [root, type] of [[0, 'maj'], [7, 'maj'], [9, 'min'], [2, 'min'], [4, '7'], [5, 'maj'], [9, '7'], [7, '7'], [11, 'm7b5']] as const) {
      const s = bestShape(root, type)!;
      expect(Math.max(...s.frets), `${NOTE_NAMES[root]}${type}`).toBeLessThanOrEqual(7);
      expect(Math.max(...s.fingers)).toBeLessThanOrEqual(4);
    }
    expect(bestShape(7, 'maj')!.frets).toEqual([0, 0, 0, 0]); // G = cordas soltas
    expect(bestShape(0, 'maj')!.frets).toEqual([2, 0, 1, 2]);
  });

  it('há várias alternativas e a primeira é a de menor custo', () => {
    const all = shapesFor(0, 'maj');
    expect(all.length).toBeGreaterThan(3);
    for (let i = 1; i < all.length; i++) expect(all[i]!.cost).toBeGreaterThanOrEqual(all[i - 1]!.cost);
  });

  it('janela do diagrama: formação baixa mostra a pestana; alta mostra a casa inicial', () => {
    expect(diagramWindow({ frets: [2, 0, 1, 2], fingers: [2, 0, 1, 3], notes: [], cost: 0 })).toEqual({ base: 1, nut: true });
    expect(diagramWindow({ frets: [5, 5, 6, 7], fingers: [], notes: [], cost: 0 })).toEqual({ base: 5, nut: false });
  });
});
