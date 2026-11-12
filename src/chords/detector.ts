import { ALL_MODELS, type ChordModel } from './models';

export interface ChordCandidate {
  name: string;
  root: number;
  typeId: string;
  /** Similaridade com o modelo (0–1). */
  score: number;
}

export interface ChordDetection {
  /** Melhor candidato, ou null se não há som/estrutura suficiente. */
  best: ChordCandidate | null;
  /** 0–1: o quanto o melhor se destaca do segundo colocado, combinado com a similaridade. */
  confidence: number;
  top: ChordCandidate[];
}

export interface DetectOptions {
  /** Acordes esperados (seguidor de cifra): ganham um bônus para desempatar. */
  expected?: Array<{ root: number; typeId: string }>;
  expectedBonus?: number;
  /** Sem energia mínima no cromagrama → sem acorde. */
  minPeakiness?: number;
}

function cosine(chroma: Float64Array, m: ChordModel): number {
  let dot = 0, n = 0;
  for (let i = 0; i < 12; i++) {
    const c = chroma[i] as number;
    dot += c * (m.template[i] as number);
    n += c * c;
  }
  return n > 0 ? dot / Math.sqrt(n) : 0;
}

/** Pontuação de todos os modelos (cosseno × prior do tipo). */
export function scoreAll(chroma: Float64Array, opts: DetectOptions = {}): ChordCandidate[] {
  const bonus = opts.expectedBonus ?? 1.04;
  const out: ChordCandidate[] = [];
  for (const m of ALL_MODELS) {
    let s = cosine(chroma, m) * m.type.prior;
    if (opts.expected?.some((e) => e.root === m.root && e.typeId === m.type.id)) s *= bonus;
    out.push({ name: m.name, root: m.root, typeId: m.type.id, score: Math.min(1, s) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function detectChord(chroma: Float64Array, opts: DetectOptions = {}): ChordDetection {
  let sum = 0;
  for (const v of chroma) sum += v;
  if (sum <= 0) return { best: null, confidence: 0, top: [] };
  const ranked = scoreAll(chroma, opts);
  // Top-3 sem repetir o mesmo conjunto de notas só com outro nome
  const top: ChordCandidate[] = [];
  for (const c of ranked) {
    top.push(c);
    if (top.length === 3) break;
  }
  const best = top[0] as ChordCandidate;
  const second = top[1] as ChordCandidate;
  const margin = Math.max(0, (best.score - second.score) / Math.max(best.score, 1e-6));
  const confidence = Math.min(1, best.score * (0.55 + Math.min(1, margin * 6) * 0.45));
  if (best.score < 0.5) return { best: null, confidence: 0, top };
  return { best, confidence, top };
}
