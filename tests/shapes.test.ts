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
    expect(validateShape([0, 0, 0, 0], 7, '7')).toBe(false); // falta o F (a sétima)
    expect(validateShape([4, 2, 4, 4], 11, '7')).toBe(true); // B7 sem fundamental (F# A D# F#): forma usual
    expect(validateShape([4, 2, 4, 4], 11, 'maj')).toBe(false); // mas não é B maior (tem A)
    expect(validateShape([2, 0, 1, 2], 9, 'm7')).toBe(true); // Am7 sem fundamental = E G C E
    expect(validateShape([2, 2, 2, 2], 9, '7')).toBe(false); // A maior não é A7 (falta o G)
    expect(validateShape([2, 0, 1], 0, 'maj')).toBe(false); // só 3 cordas
  });

  it('acordes comuns saem com formações fáceis (baixas e com poucos dedos)', () => {
    for (const [root, type] of [[0, 'maj'], [7, 'maj'], [9, 'min'], [2, 'min'], [4, '7'], [5, 'maj'], [9, '7'], [7, '7'], [11, 'm7b5']] as const) {
      const s = bestShape(root, type)!;
      expect(Math.max(...s.frets), `${NOTE_NAMES[root]}${type}`).toBeLessThanOrEqual(7);
      expect(Math.max(...s.fingers)).toBeLessThanOrEqual(4);
    }
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

import { resolveShape } from '../src/chords/shapes';
describe('resolveShape (forma preferida)', () => {
  it('usa a forma escolhida quando é válida para o acorde', () => {
    const alt = shapesFor(0, 'maj')[2]!;
    expect(resolveShape(0, 'maj', alt.frets)!.frets).toEqual(alt.frets);
  });
  it('preferência inválida é ignorada: nunca mostra diagrama errado', () => {
    expect(resolveShape(0, 'maj', [0, 0, 0, 0])!.frets).toEqual(bestShape(0, 'maj')!.frets); // soltas = G, não C
    expect(resolveShape(0, 'maj', [1, 2])!.frets).toEqual(bestShape(0, 'maj')!.frets);
  });
  it('sem preferência → melhor forma', () => {
    expect(resolveShape(9, 'min')!.frets).toEqual(bestShape(9, 'min')!.frets);
  });
  it('forma válida fora da lista gerada (ex.: casa alta) também é aceita e ganha dedos/notas', () => {
    const s = resolveShape(7, 'maj', [12, 12, 12, 12])!; // G uma oitava acima
    expect(s.frets).toEqual([12, 12, 12, 12]);
    expect(s.notes).toEqual(['D', 'G', 'B', 'D']);
  });
});

describe('formas padrão do cavaquinho (referência: diagramas da aula do Cicinho do Cavaco)', () => {
  const ref: Array<[string, number, string, number[]]> = [
    ['G', 7, 'maj', [5, 4, 3, 5]],
    ['F#m', 6, 'min', [4, 2, 2, 4]],
    ['B7', 11, '7', [4, 2, 4, 4]],
    ['Em7', 4, 'm7', [2, 0, 0, 0]],
    ['Dm', 2, 'min', [3, 2, 3, 3]],
    ['G7', 7, '7', [3, 4, 3, 5]],
  ];
  for (const [name, root, type, frets] of ref) {
    it(`${name} = ${frets.join('-')} é a forma padrão (e é válida)`, () => {
      expect(validateShape(frets, root, type)).toBe(true);
      expect(bestShape(root, type)!.frets).toEqual(frets);
    });
  }
  it('dedos como no vídeo: G 5-4-3-5 → dedo 1 na casa 3, 2 na casa 4, 3 e 4 na casa 5', () => {
    expect(bestShape(7, 'maj')!.fingers).toEqual([3, 2, 1, 4]);
    expect(bestShape(2, 'min')!.fingers).toEqual([2, 1, 3, 4]); // Dm 3-2-3-3
    expect(bestShape(6, 'min')!.fingers).toEqual([3, 1, 2, 4]); // F#m 4-2-2-4
  });
  it('outras formas consagradas saem como padrão', () => {
    expect(bestShape(0, 'maj')!.frets).toEqual([2, 0, 1, 2]); // C
    expect(bestShape(2, 'maj')!.frets).toEqual([4, 2, 3, 4]); // D
    expect(bestShape(5, 'maj')!.frets).toEqual([3, 2, 1, 3]); // F
    expect(bestShape(9, 'maj')!.frets).toEqual([2, 2, 2, 2]); // A
    expect(bestShape(9, 'min')!.frets).toEqual([2, 2, 1, 2]); // Am
    expect(bestShape(9, '7')!.frets).toEqual([2, 0, 2, 2]); // A7
    expect(bestShape(0, '7')!.frets).toEqual([2, 3, 1, 2]); // C7
    expect(bestShape(2, '7')!.frets).toEqual([4, 5, 3, 4]); // D7
  });
  it('o padrão evita acorde todo em cordas soltas', () => {
    for (let root = 0; root < 12; root++) for (const t of ['maj', 'min', '7']) expect(bestShape(root, t)!.frets.some((f) => f > 0)).toBe(true);
  });
});
