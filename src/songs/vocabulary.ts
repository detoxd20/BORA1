import type { ParsedChord } from '../chords/parse';

/** O que o OCR leu na região dos acordes num instante do vídeo. */
export interface Observation {
  t: number;
  chords: ParsedChord[];
}

/** Durante [start, end) só estes acordes são possíveis. */
export interface VocabSegment {
  start: number;
  end: number;
  /** Chaves "root:typeId". */
  keys: string[];
  /** Nomes na ordem em que aparecem na tela (esquerda → direita). */
  names: string[];
}

const keyOf = (c: ParsedChord) => `${c.root}:${c.typeId}`;
const sig = (cs: ParsedChord[]) => cs.map(keyOf).join('|');

/**
 * Agrupa as leituras em trechos. Para evitar que um erro isolado do OCR crie um
 * trecho falso, só aceita uma mudança de conjunto depois de `confirm` leituras
 * iguais seguidas; leituras vazias (nenhum acorde visível) mantêm o trecho atual.
 */
export function buildVocabulary(obs: Observation[], confirm = 2): VocabSegment[] {
  const segs: VocabSegment[] = [];
  let curSig = '';
  let pendSig = '';
  let pendCount = 0;
  let pendStart = 0;
  let pendChords: ParsedChord[] = [];

  for (const o of obs) {
    if (o.chords.length === 0) continue;
    const s = sig(o.chords);
    if (s === curSig) {
      pendSig = '';
      pendCount = 0;
      continue;
    }
    if (s === pendSig) pendCount++;
    else {
      pendSig = s;
      pendCount = 1;
      pendStart = o.t;
      pendChords = o.chords;
    }
    if (pendCount >= confirm) {
      const last = segs[segs.length - 1];
      if (last) last.end = pendStart;
      segs.push({
        start: segs.length === 0 ? 0 : pendStart,
        end: Infinity,
        keys: [...new Set(pendChords.map(keyOf))],
        names: pendChords.map((c) => c.name),
      });
      curSig = pendSig;
      pendSig = '';
      pendCount = 0;
    }
  }
  // O último trecho vale até o fim do vídeo (a faixa de acordes fica na tela).
  return segs;
}

export function vocabAt(segs: VocabSegment[], t: number): VocabSegment | undefined {
  return segs.find((s) => t >= s.start && t < s.end);
}
