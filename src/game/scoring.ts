/**
 * Pontuação do Cavaco Hero. Lógica pura (sem áudio nem tela): recebe quadros de cromagrama já com o tempo
 * da música em que o som aconteceu e devolve os julgamentos (perfeito / bom / atrasado / errou).
 *
 * O jogo NÃO tenta adivinhar qualquer acorde: ele só pergunta "entre os acordes desta música, o que estou
 * ouvindo é o esperado?". Isso é muito mais confiável do que detecção aberta.
 */

/** Harmônicos de uma corda: (semitons acima, peso). Mesmo modelo do motor de acordes. */
const HARMONICS: Array<[number, number]> = [[0, 1], [12, 0.55], [19, 0.4], [24, 0.25], [28, 0.15]];

/** Modelo de cromagrama das notas que o jogador REALMENTE aperta (uma classe de altura por corda). */
export function shapeTemplate(pitchClasses: number[]): Float64Array {
  const t = new Float64Array(12);
  for (const pc of pitchClasses) for (const [shift, w] of HARMONICS) t[(pc + shift) % 12]! += w;
  let n = 0;
  for (const v of t) n += v * v;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < 12; i++) t[i] = (t[i] as number) / n;
  return t;
}

export function similarity(chroma: ArrayLike<number>, template: Float64Array): number {
  let dot = 0, n = 0;
  for (let i = 0; i < 12; i++) {
    const c = chroma[i] as number;
    dot += c * (template[i] as number);
    n += c * c;
  }
  return n > 0 ? dot / Math.sqrt(n) : 0;
}

export interface Target {
  start: number;
  end: number;
  /** Identifica o acorde/forma esperado (chave em `templates`). */
  key: string;
}

export interface LiveFrame {
  /** Tempo DA MÚSICA em que este som foi tocado (já descontados atrasos). */
  t: number;
  chroma: ArrayLike<number>;
  levelDb: number;
}

export type Grade = 'perfeito' | 'bom' | 'ok' | 'erro';

export interface Judgement {
  index: number;
  grade: Grade;
  /** Segundos em relação à hora certa (+ = atrasado). Só para acertos. */
  error: number;
  points: number;
}

export interface ScoreOptions {
  /** Quanto antes da hora o acorde já pode ser tocado (s). */
  early: number;
  perfect: number;
  good: number;
  /** Atraso máximo para ainda valer como "atrasado" (s). */
  maxLate: number;
  /** Quadros seguidos com o acorde certo para confirmar (evita falso acerto por um quadro solto). */
  confirm: number;
  /** Abaixo disso o microfone é tratado como silêncio (dBFS). */
  gateDb: number;
  /** Semelhança mínima com o modelo do acorde. */
  minSim: number;
}

export const DEFAULT_SCORE: ScoreOptions = { early: 0.25, perfect: 0.13, good: 0.32, maxLate: 1.0, confirm: 2, gateDb: -48, minSim: 0.6 };

export const GRADE_POINTS: Record<Grade, number> = { perfeito: 100, bom: 70, ok: 40, erro: 0 };
const GRADE_WEIGHT: Record<Grade, number> = { perfeito: 1, bom: 0.7, ok: 0.4, erro: 0 };

export interface ScoreSummary {
  score: number;
  combo: number;
  maxCombo: number;
  multiplier: number;
  counts: Record<Grade, number>;
  judged: number;
  total: number;
  /** 0–1: média ponderada dos julgamentos. */
  accuracy: number;
  stars: number;
}

/** Entre os acordes da música, qual o quadro mais parece — ou null se silêncio / nada parecido. */
export function classify(frame: LiveFrame, templates: Map<string, Float64Array>, opts: ScoreOptions): { key: string | null; sim: number } {
  if (frame.levelDb < opts.gateDb) return { key: null, sim: 0 };
  let best: string | null = null;
  let bestSim = 0;
  for (const [key, tpl] of templates) {
    const s = similarity(frame.chroma, tpl);
    if (s > bestSim) {
      bestSim = s;
      best = key;
    }
  }
  return bestSim >= opts.minSim ? { key: best, sim: bestSim } : { key: null, sim: bestSim };
}

export class ScoreEngine {
  private opts: ScoreOptions;
  private i = 0;
  private hitAt: number | null = null;
  private sustainTotal = 0;
  private sustainOk = 0;
  private label: string | null = null;
  private labelSince = 0;
  private labelCount = 0;
  private s: ScoreSummary;
  /** O que o jogo está ouvindo agora (para mostrar na tela). */
  heard: string | null = null;

  constructor(
    private targets: Target[],
    private templates: Map<string, Float64Array>,
    opts: Partial<ScoreOptions> = {},
  ) {
    this.opts = { ...DEFAULT_SCORE, ...opts };
    this.s = { score: 0, combo: 0, maxCombo: 0, multiplier: 1, counts: { perfeito: 0, bom: 0, ok: 0, erro: 0 }, judged: 0, total: targets.length, accuracy: 0, stars: 0 };
  }

  get summary(): ScoreSummary {
    return { ...this.s, counts: { ...this.s.counts } };
  }

  /** Pula para o tempo `t` (seek/reinício): acordes anteriores não são julgados. */
  seek(t: number): void {
    this.i = this.targets.findIndex((x) => x.start >= t - this.opts.early);
    if (this.i < 0) this.i = this.targets.length;
    this.hitAt = null;
    this.label = null;
    this.labelCount = 0;
  }

  private judge(index: number, grade: Grade, error: number, out: Judgement[]): void {
    const s = this.s;
    let points = 0;
    if (grade === 'erro') {
      s.combo = 0;
    } else {
      s.combo++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.multiplier = Math.min(4, 1 + Math.floor(s.combo / 6));
      points = GRADE_POINTS[grade] * s.multiplier;
    }
    if (grade === 'erro') s.multiplier = 1;
    s.counts[grade]++;
    s.judged++;
    s.score += points;
    const w = s.counts.perfeito * GRADE_WEIGHT.perfeito + s.counts.bom * GRADE_WEIGHT.bom + s.counts.ok * GRADE_WEIGHT.ok;
    s.accuracy = s.judged ? w / s.judged : 0;
    s.stars = s.accuracy >= 0.95 ? 5 : s.accuracy >= 0.85 ? 4 : s.accuracy >= 0.7 ? 3 : s.accuracy >= 0.5 ? 2 : s.accuracy > 0 ? 1 : 0;
    out.push({ index, grade, error, points });
  }

  private closeSustain(): void {
    if (this.hitAt !== null && this.sustainTotal > 0) {
      this.s.score += Math.round(50 * (this.sustainOk / this.sustainTotal)) * this.s.multiplier;
    }
    this.hitAt = null;
    this.sustainTotal = 0;
    this.sustainOk = 0;
  }

  push(frame: LiveFrame): Judgement[] {
    const o = this.opts;
    const out: Judgement[] = [];
    const { key } = classify(frame, this.templates, o);
    this.heard = key;
    if (key === this.label) this.labelCount++;
    else {
      this.label = key;
      this.labelSince = frame.t;
      this.labelCount = 1;
    }

    for (;;) {
      const tg = this.targets[this.i];
      if (!tg) break;
      if (frame.t < tg.start - o.early) break; // ainda não é hora deste acorde

      if (this.hitAt === null) {
        const late = Math.min(tg.end, tg.start + o.maxLate);
        if (key === tg.key && this.labelCount >= o.confirm) {
          // vale a hora em que o acorde certo COMEÇOU a soar (não a da confirmação)
          const error = Math.max(-o.early, this.labelSince - tg.start);
          const a = Math.abs(error);
          this.judge(this.i, a <= o.perfect ? 'perfeito' : a <= o.good ? 'bom' : 'ok', error, out);
          this.hitAt = frame.t;
          break;
        }
        if (frame.t > late) {
          this.judge(this.i, 'erro', 0, out);
          this.i++;
          continue; // talvez já seja hora do próximo
        }
        break;
      }

      // acorde já acertado: conta quanto tempo foi sustentado, até pouco antes do próximo
      if (frame.t >= tg.end - o.early) {
        this.closeSustain();
        this.i++;
        continue;
      }
      this.sustainTotal++;
      if (key === tg.key) this.sustainOk++;
      break;
    }
    return out;
  }

  /** Fim da música: o que não foi tocado vira erro. */
  finish(): Judgement[] {
    const out: Judgement[] = [];
    this.closeSustain();
    while (this.i < this.targets.length) {
      if (this.hitAt === null) this.judge(this.i, 'erro', 0, out);
      this.hitAt = null;
      this.i++;
    }
    return out;
  }
}
