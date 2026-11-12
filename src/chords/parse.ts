import { CHORD_TYPES, chordName } from './models';

export interface ParsedChord {
  root: number;
  typeId: string;
  name: string;
}

const ROOTS: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** Sufixos aceitos (como aparecem em cifras brasileiras) → id do tipo. */
const SUFFIX: Record<string, string> = {
  '': 'maj', maj: 'maj', M: 'maj',
  m: 'min', min: 'min', '-': 'min',
  '7': '7', '7M': '7M', M7: '7M', maj7: '7M', '7maj': '7M', '7+': '7M',
  m7: 'm7', min7: 'm7', '-7': 'm7',
  'm7(b5)': 'm7b5', m7b5: 'm7b5', 'm7(5b)': 'm7b5', 'ø': 'm7b5', 'm7-5': 'm7b5',
  dim: 'dim', '°': 'dim', 'º': 'dim', dim7: 'dim', 'm(b5)': 'dim', mb5: 'dim',
  '6': '6', m6: 'm6', '9': '9', sus4: 'sus4', sus: 'sus4', '4': 'sus4', '7sus4': 'sus4',
  '+': 'aug', aug: 'aug', '5+': 'aug', '(#5)': 'aug', '#5': 'aug',
};

/** Converte "F#m", "Bm7(b5)", "G7M"… em acorde; `null` se não reconhecer. */
export function parseChord(token: string): ParsedChord | null {
  const t = token.trim().replace(/[,;.:]+$/g, '');
  const m = /^([A-G][#b]?)(.*)$/.exec(t);
  if (!m) return null;
  const root = ROOTS[m[1] as string];
  if (root === undefined) return null;
  // ignora baixo invertido (G/B): para o motor só importa o acorde
  const suffix = (m[2] as string).split('/')[0] as string;
  const typeId = SUFFIX[suffix];
  if (!typeId) return null;
  const type = CHORD_TYPES.find((c) => c.id === typeId);
  if (!type) return null;
  return { root, typeId, name: chordName(root, type) };
}

/** Lê uma linha de texto do OCR e devolve os acordes na ordem (esquerda→direita), sem inventar nada. */
export function parseChordLine(text: string): ParsedChord[] {
  const out: ParsedChord[] = [];
  for (const tok of text.split(/\s+/)) {
    const c = parseChord(tok);
    if (c) out.push(c);
  }
  return out;
}
