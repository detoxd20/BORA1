import { NOTE_NAMES } from './notes';

export interface ChordType {
  id: string;
  /** Sufixo na cifra: "", "m", "7", "m7", "7M", … */
  suffix: string;
  /** Intervalos em semitons a partir da fundamental. */
  intervals: number[];
  /** Quanto esse tipo é comum no repertório (desempata acordes de mesmas notas, ex.: Am7 × C6). */
  prior: number;
}

export const CHORD_TYPES: ChordType[] = [
  { id: 'maj', suffix: '', intervals: [0, 4, 7], prior: 1 },
  { id: 'min', suffix: 'm', intervals: [0, 3, 7], prior: 1 },
  { id: '7', suffix: '7', intervals: [0, 4, 7, 10], prior: 0.995 },
  { id: 'm7', suffix: 'm7', intervals: [0, 3, 7, 10], prior: 0.99 },
  { id: '7M', suffix: '7M', intervals: [0, 4, 7, 11], prior: 0.985 },
  { id: 'm7b5', suffix: 'm7(b5)', intervals: [0, 3, 6, 10], prior: 0.985 },
  { id: 'dim', suffix: 'dim', intervals: [0, 3, 6], prior: 0.98 },
  { id: '6', suffix: '6', intervals: [0, 4, 7, 9], prior: 0.975 },
  { id: 'm6', suffix: 'm6', intervals: [0, 3, 7, 9], prior: 0.975 },
  { id: '9', suffix: '9', intervals: [0, 4, 7, 10, 2], prior: 0.98 },
  { id: 'sus4', suffix: 'sus4', intervals: [0, 5, 7], prior: 0.98 },
  { id: 'aug', suffix: '+', intervals: [0, 4, 8], prior: 0.975 },
];

export interface ChordModel {
  root: number;
  type: ChordType;
  /** "C", "Am", "G7", "Bm7(b5)" … */
  name: string;
  /** Template de cromagrama (12 valores, normalizado L2). */
  template: Float64Array;
  pitchClasses: number[];
}

/** Harmônicos de cada nota: (múltiplo da frequência, deslocamento em semitons, peso). */
const HARMONICS: Array<[number, number]> = [
  [0, 1.0], // fundamental
  [12, 0.55], // 2º harmônico (oitava)
  [19, 0.4], // 3º harmônico (quinta + oitava)
  [24, 0.25], // 4º
  [28, 0.15], // 5º (terça + 2 oitavas)
];

export function chordName(root: number, type: ChordType): string {
  return `${NOTE_NAMES[root]}${type.suffix}`;
}

export function buildModel(root: number, type: ChordType): ChordModel {
  const t = new Float64Array(12);
  type.intervals.forEach((iv, idx) => {
    // A fundamental pesa um pouco mais que as outras notas
    const noteW = idx === 0 ? 1.15 : 1;
    for (const [shift, w] of HARMONICS) t[(root + iv + shift) % 12]! += w * noteW;
  });
  let norm = 0;
  for (const v of t) norm += v * v;
  norm = Math.sqrt(norm);
  for (let i = 0; i < 12; i++) t[i] = (t[i] as number) / norm;
  return {
    root,
    type,
    name: chordName(root, type),
    template: t,
    pitchClasses: type.intervals.map((iv) => (root + iv) % 12).sort((a, b) => a - b),
  };
}

export const ALL_MODELS: ChordModel[] = CHORD_TYPES.flatMap((type) =>
  Array.from({ length: 12 }, (_, root) => buildModel(root, type)),
);
