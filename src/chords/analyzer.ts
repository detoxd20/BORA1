import { ChromaExtractor } from '../audio/chroma';
import { ALL_MODELS } from './models';
import { scoreAll } from './detector';
import type { VocabSegment } from '../songs/vocabulary';

export interface ChordEvent {
  /** Segundos desde o início do áudio. */
  start: number;
  end: number;
  name: string;
  root: number;
  typeId: string;
  /** Média da similaridade nos quadros do trecho (0–1). */
  confidence: number;
}

export interface AnalyzeOptions {
  fftSize?: number;
  hop?: number;
  /** Custo (em log-score) de trocar de acorde: maior = menos trocas espúrias. */
  switchPenalty?: number;
  /** Abaixo disso o quadro é considerado silêncio (dBFS). */
  silenceDb?: number;
  onProgress?: (fraction: number) => void;
  /** Acordes que o vídeo mostra, por trecho: o áudio só escolhe entre eles. */
  vocabulary?: VocabSegment[];
  /** Quanto um acorde fora da lista é penalizado (em log-score). */
  vocabPenalty?: number;
}

const N_STATE = ALL_MODELS.length; // 144; o estado extra N_STATE = "sem acorde"

/**
 * Análise offline de uma gravação inteira: cromagrama por quadro + Viterbi
 * (suavização global). Offline podemos olhar o passado E o futuro, então é
 * bem mais preciso que a detecção ao vivo.
 */
export function analyzeChords(samples: Float32Array, sampleRate: number, opts: AnalyzeOptions = {}): ChordEvent[] {
  const fftSize = opts.fftSize ?? 8192;
  const hop = opts.hop ?? 2048;
  const switchPenalty = opts.switchPenalty ?? 3.0;
  const silenceDb = opts.silenceDb ?? -55;
  const ex = new ChromaExtractor({ sampleRate, fftSize });

  const nFrames = Math.max(0, Math.floor((samples.length - fftSize) / hop) + 1);
  if (nFrames === 0) return [];

  const emis: Float64Array[] = [];
  const idx = new Map(ALL_MODELS.map((m, i) => [`${m.root}:${m.type.id}`, i]));
  for (let f = 0; f < nFrames; f++) {
    const { chroma, levelDb } = ex.compute(samples, f * hop);
    const e = new Float64Array(N_STATE + 1);
    const isSilent = levelDb < silenceDb;
    const tFrame = (f * hop + fftSize / 2) / sampleRate;
    const seg = opts.vocabulary?.find((v) => tFrame >= v.start && tFrame < v.end);
    if (isSilent) {
      e.fill(Math.log(0.05));
      e[N_STATE] = Math.log(0.9);
    } else {
      for (const c of scoreAll(chroma)) {
        e[idx.get(`${c.root}:${c.typeId}`) as number] = 4 * Math.log(Math.max(c.score, 1e-3));
      }
      e[N_STATE] = Math.log(0.3) * 4;
      if (seg) {
        // Com a lista do vídeo, é melhor "nenhum acorde" do que um acorde da lista que não combina.
        e[N_STATE] = Math.log(0.55) * 4;
        const allowed = new Set(seg.keys);
        const penalty = opts.vocabPenalty ?? 8;
        for (let k = 0; k < N_STATE; k++) {
          const m = ALL_MODELS[k]!;
          if (!allowed.has(`${m.root}:${m.type.id}`)) e[k] = (e[k] as number) - penalty;
        }
      }
    }
    emis.push(e);
    if (opts.onProgress && f % 20 === 0) opts.onProgress(f / nFrames);
  }

  // Viterbi: manter o estado custa 0; trocar custa switchPenalty.
  const S = N_STATE + 1;
  let prev = Float64Array.from(emis[0] as Float64Array);
  const back: Uint16Array[] = [];
  for (let f = 1; f < nFrames; f++) {
    let bestPrev = 0;
    for (let s = 1; s < S; s++) if ((prev[s] as number) > (prev[bestPrev] as number)) bestPrev = s;
    const cur = new Float64Array(S);
    const bp = new Uint16Array(S);
    const e = emis[f] as Float64Array;
    for (let s = 0; s < S; s++) {
      const stay = prev[s] as number;
      const move = (prev[bestPrev] as number) - switchPenalty;
      if (stay >= move) {
        cur[s] = stay + (e[s] as number);
        bp[s] = s;
      } else {
        cur[s] = move + (e[s] as number);
        bp[s] = bestPrev;
      }
    }
    back.push(bp);
    prev = cur;
  }
  let state = 0;
  for (let s = 1; s < S; s++) if ((prev[s] as number) > (prev[state] as number)) state = s;
  const path = new Array<number>(nFrames);
  path[nFrames - 1] = state;
  for (let f = nFrames - 1; f > 0; f--) {
    state = (back[f - 1] as Uint16Array)[state] as number;
    path[f - 1] = state;
  }

  // Quadros → segmentos
  const events: ChordEvent[] = [];
  const toTime = (frame: number) => (frame * hop) / sampleRate;
  let f = 0;
  while (f < nFrames) {
    const s = path[f] as number;
    let g = f;
    while (g + 1 < nFrames && path[g + 1] === s) g++;
    if (s !== N_STATE) {
      const m = ALL_MODELS[s]!;
      let conf = 0;
      for (let k = f; k <= g; k++) conf += Math.exp(((emis[k] as Float64Array)[s] as number) / 4);
      events.push({
        // o quadro f cobre [f·hop, f·hop+fftSize]; o "centro" é a melhor estimativa do instante
        start: toTime(f) + fftSize / 2 / sampleRate - (f === 0 ? fftSize / 2 / sampleRate : 0),
        end: toTime(g) + fftSize / sampleRate,
        name: m.name,
        root: m.root,
        typeId: m.type.id,
        confidence: conf / (g - f + 1),
      });
    }
    f = g + 1;
  }
  return events;
}

export interface CleanOptions {
  /** Trechos mais curtos que isso (s) são descartados: batidas na troca, notas soltas. */
  minDuration: number;
  /** Trechos com confiança média menor que isso são descartados: voz, ruído. */
  minConfidence: number;
}

/** Níveis de limpeza oferecidos na interface. */
export const CLEAN_LEVELS = {
  suave: { minDuration: 0.4, minConfidence: 0.5 },
  medio: { minDuration: 0.8, minConfidence: 0.6 },
  forte: { minDuration: 1.3, minConfidence: 0.7 },
} as const satisfies Record<string, CleanOptions>;
export type CleanLevel = keyof typeof CLEAN_LEVELS;

/** Remove trechos duvidosos e junta vizinhos que viraram o mesmo acorde. */
export function cleanEvents(events: ChordEvent[], opts: CleanOptions): ChordEvent[] {
  const kept = events.filter((e) => e.end - e.start >= opts.minDuration && e.confidence >= opts.minConfidence);
  const out: ChordEvent[] = [];
  for (const e of kept) {
    const last = out[out.length - 1];
    if (last && last.root === e.root && last.typeId === e.typeId && e.start - last.end < 1) {
      out[out.length - 1] = { ...last, end: e.end, confidence: Math.min(last.confidence, e.confidence) };
    } else out.push(e);
  }
  return out;
}
