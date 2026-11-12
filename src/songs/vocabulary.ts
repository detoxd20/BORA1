import type { ParsedChord } from '../chords/parse';
import type { ChordEvent } from '../chords/analyzer';

/** O que o OCR leu na região dos acordes num instante do vídeo. */
export interface Observation {
  t: number;
  chords: ParsedChord[];
}

/** Durante [start, end) só estes acordes são possíveis. Fora de qualquer trecho: nenhum acorde. */
export interface VocabSegment {
  start: number;
  end: number;
  /** Chaves "root:typeId". */
  keys: string[];
  /** Nomes na ordem em que aparecem na tela (esquerda → direita). */
  names: string[];
}

export interface VocabOptions {
  /** Leituras iguais seguidas para aceitar uma mudança (evita erro isolado do OCR). */
  confirm?: number;
  /** Tempo (s) sem nenhum acorde na tela para considerar que a faixa sumiu (fala, intro, final). */
  minGap?: number;
  /** Intervalo entre leituras (s). */
  step: number;
}

const keyOf = (c: ParsedChord) => `${c.root}:${c.typeId}`;
const sig = (cs: ParsedChord[]) => cs.map(keyOf).join('|');

/**
 * Agrupa as leituras em trechos: cada trecho tem o conjunto de acordes visíveis.
 * - Uma mudança só vale após `confirm` leituras iguais seguidas.
 * - Ausência de acordes por mais de `minGap` segundos encerra o trecho
 *   (nessa parte o vídeo é fala/intro/final: nenhum acorde é aceito).
 */
export function buildVocabulary(rawObs: Observation[], opts: VocabOptions): VocabSegment[] {
  const obs = smoothObservations(rawObs);
  const confirm = opts.confirm ?? 2;
  const minGap = opts.minGap ?? 2.5;
  const segs: VocabSegment[] = [];
  let open: VocabSegment | null = null;
  let curSig = '';
  let pendSig = '';
  let pendCount = 0;
  let pendStart = 0;
  let pendStartIdx = 0;
  let pendChords: ParsedChord[] = [];
  let lastSeen = 0; // último instante com acorde visível
  let emptySince: number | null = null;

  const close = (end: number) => {
    if (open) open.end = end;
    open = null;
    curSig = '';
  };

  for (let i = 0; i < obs.length; i++) {
    const o = obs[i] as Observation;
    if (o.chords.length === 0) {
      if (emptySince === null) emptySince = o.t;
      if (open && o.t - lastSeen >= minGap) close(lastSeen + opts.step);
      pendSig = '';
      pendCount = 0;
      continue;
    }
    emptySince = null;
    lastSeen = o.t;
    const s = sig(o.chords);
    if (open && s === curSig) {
      pendSig = '';
      pendCount = 0;
      continue;
    }
    if (s === pendSig) pendCount++;
    else {
      pendSig = s;
      pendCount = 1;
      pendStart = o.t;
      pendStartIdx = i;
      pendChords = o.chords;
    }
    if (pendCount >= confirm) {
      if (open) {
        // Não estica o trecho anterior por cima de uma lacuna em que nada foi lido
        let j = pendStartIdx - 1;
        while (j >= 0 && (obs[j] as Observation).chords.length === 0) j--;
        (open as VocabSegment).end = j >= 0 ? Math.min(pendStart, (obs[j] as Observation).t + opts.step) : pendStart;
      }
      open = { start: pendStart, end: Infinity, keys: [...new Set(pendChords.map(keyOf))], names: pendChords.map((c) => c.name) };
      segs.push(open);
      curSig = pendSig;
      pendSig = '';
      pendCount = 0;
    }
  }
  // Trecho ainda aberto no fim: vale até a última leitura com acordes.
  if (open) (open as VocabSegment).end = lastSeen + opts.step;
  return segs;
}

export function vocabAt(segs: VocabSegment[], t: number): VocabSegment | undefined {
  return segs.find((s) => t >= s.start && t < s.end);
}

/** Mediana de acordes visíveis por leitura: ≤1 indica "um acorde por vez" (o da tela é o atual). */
export function chordsPerFrame(obs: Observation[]): number {
  const n = obs.map((o) => o.chords.length).filter((c) => c > 0).sort((a, b) => a - b);
  return n.length ? (n[n.length >> 1] as number) : 0;
}

/**
 * Modo "um acorde por vez": o acorde escrito na tela É o acorde atual. Onde o áudio não confirmou
 * nenhum acorde dentro de um trecho do vídeo, usa o do vídeo (com confiança média, aparece em amarelo).
 */
export function fillFromVideo(events: ChordEvent[], vocab: VocabSegment[]): ChordEvent[] {
  const out = [...events];
  for (const seg of vocab) {
    if (seg.keys.length !== 1) continue;
    const [root, typeId] = (seg.keys[0] as string).split(':');
    const covered = events.some((e) => e.start < seg.end && e.end > seg.start && e.root === Number(root) && e.typeId === typeId);
    if (!covered) {
      out.push({ start: seg.start, end: seg.end, name: seg.names[0] as string, root: Number(root), typeId: typeId as string, confidence: 0.6 });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Votação ao longo do tempo: um acorde só conta como "visível" se aparece na maioria das leituras vizinhas
 * (janela de 3: aguenta acordes que duram ~1 s com leituras a cada 0,5 s). Lixo do OCR muda a cada leitura e cai fora; acordes reais, que ficam na tela, ficam.
 */
export function smoothObservations(obs: Observation[], radius = 1): Observation[] {
  return obs.map((o, i) => {
    const win = obs.slice(Math.max(0, i - radius), Math.min(obs.length, i + radius + 1));
    const need = Math.ceil(win.length * 0.6);
    const count = new Map<string, number>();
    const byKey = new Map<string, ParsedChord>();
    for (const w of win) {
      for (const c of w.chords) {
        const k = keyOf(c);
        count.set(k, (count.get(k) ?? 0) + 1);
        if (!byKey.has(k)) byKey.set(k, c);
      }
    }
    // ordem: a da leitura atual primeiro, depois as demais
    const ordered = [...o.chords, ...byKey.values()].filter((c, idx, arr) => arr.findIndex((x) => keyOf(x) === keyOf(c)) === idx);
    return { t: o.t, chords: ordered.filter((c) => (count.get(keyOf(c)) ?? 0) >= need) };
  });
}
