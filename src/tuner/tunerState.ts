import { centsBetween } from '../chords/notes';
import type { Tuning } from './tunings';

/** Um quadro vindo do AudioWorklet (~90 por segundo). */
export interface PitchFrame {
  /** Tempo em segundos (relógio do AudioContext). */
  t: number;
  /** Frequência detectada (Hz) ou 0 se não houve. */
  freq: number;
  clarity: number;
  /** Nível RMS em dBFS. */
  levelDb: number;
}

export type TunerMode = 'auto' | 'manual';

export interface TunerConfig {
  /** Nível mínimo (dBFS) para abrir o portão de ruído. */
  gateDb: number;
  /** Clareza mínima para aceitar um quadro. */
  minClarity: number;
  /** Quanto tempo (s) segurar a última leitura depois que o som some. */
  holdSec: number;
  /** Quadros iguais seguidos para trocar de corda no modo automático. */
  switchFrames: number;
  /** Quadros (mediana) usados para limpar o pitch. */
  medianSize: number;
  /** Tempo (s) a ignorar após o ataque da palheta, quando o pitch ainda "escorrega". */
  attackSkipSec: number;
}

export const DEFAULT_CONFIG: TunerConfig = {
  gateDb: -50,
  minClarity: 0.9,
  holdSec: 0.6,
  switchFrames: 8,
  medianSize: 9,
  attackSkipSec: 0.05,
};

export interface TunerReading {
  /** Há uma nota sendo ouvida (ou segurada logo após o som sumir). */
  active: boolean;
  /** true quando o som sumiu e a leitura está só "congelada". */
  holding: boolean;
  /** Índice da corda dentro de `tuning.strings`. */
  stringIndex: number;
  /** Desvio suavizado em cents em relação à corda alvo. */
  cents: number;
  /** Frequência suavizada (Hz). */
  freq: number;
  /** Dentro da tolerância de afinação (com histerese). */
  inTune: boolean;
  levelDb: number;
}

export const IN_TUNE_ENTER = 2.5;
export const IN_TUNE_EXIT = 4;

/** Dobra `freq` por oitavas até ficar o mais perto possível de `target`. */
export function foldToOctave(freq: number, target: number): number {
  const oct = Math.round(Math.log2(target / freq));
  return freq * Math.pow(2, oct);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Transforma quadros ruidosos de pitch numa leitura estável:
 * portão de ruído com histerese → mediana → escolha da corda com histerese →
 * suavização exponencial dos cents (rápida quando longe, lenta quando perto).
 */
export class TunerProcessor {
  private cfg: TunerConfig;
  private freqs: number[] = [];
  private gateOpen = false;
  private openedAt = 0;
  private lastValidT = -Infinity;
  private stringIndex = -1;
  private candidate = -1;
  private candidateCount = 0;
  private centsEma = 0;
  private hasEma = false;
  private freqEma = 0;
  private inTune = false;
  private last: TunerReading = emptyReading();

  constructor(cfg: Partial<TunerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  setConfig(cfg: Partial<TunerConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  reset(): void {
    this.freqs = [];
    this.gateOpen = false;
    this.stringIndex = -1;
    this.candidate = -1;
    this.candidateCount = 0;
    this.hasEma = false;
    this.inTune = false;
    this.lastValidT = -Infinity;
    this.last = emptyReading();
  }

  update(frame: PitchFrame, tuning: Tuning, mode: TunerMode, manualIndex: number): TunerReading {
    const { cfg } = this;
    const openDb = cfg.gateDb;
    const closeDb = cfg.gateDb - 6;

    // Portão de ruído com histerese
    if (!this.gateOpen && frame.levelDb >= openDb) {
      this.gateOpen = true;
      this.openedAt = frame.t;
    } else if (this.gateOpen && frame.levelDb < closeDb) {
      this.gateOpen = false;
    }

    const valid =
      this.gateOpen &&
      frame.freq > 0 &&
      frame.clarity >= cfg.minClarity &&
      frame.t - this.openedAt >= cfg.attackSkipSec;

    if (!valid) {
      const silentFor = frame.t - this.lastValidT;
      if (silentFor > cfg.holdSec) {
        if (this.last.active) this.reset();
        this.last = { ...emptyReading(), levelDb: frame.levelDb };
        return this.last;
      }
      this.last = { ...this.last, holding: true, levelDb: frame.levelDb };
      return this.last;
    }

    this.lastValidT = frame.t;

    // Modo manual: corrige erros de oitava usando a corda escolhida como dica.
    const manual = mode === 'manual' ? tuning.strings[manualIndex] : undefined;
    const f = manual ? foldToOctave(frame.freq, manual.frequency) : frame.freq;

    this.freqs.push(f);
    if (this.freqs.length > cfg.medianSize) this.freqs.shift();
    const fm = median(this.freqs);

    // Escolha da corda
    let idx: number;
    if (manual) {
      idx = manualIndex;
      this.candidate = -1;
    } else {
      const nearest = nearestString(fm, tuning);
      if (this.stringIndex < 0) {
        idx = nearest;
      } else if (nearest === this.stringIndex) {
        this.candidate = -1;
        idx = this.stringIndex;
      } else {
        if (nearest === this.candidate) this.candidateCount++;
        else {
          this.candidate = nearest;
          this.candidateCount = 1;
        }
        idx = this.candidateCount >= cfg.switchFrames ? nearest : this.stringIndex;
      }
    }
    if (idx !== this.stringIndex) {
      this.stringIndex = idx;
      this.candidate = -1;
      this.candidateCount = 0;
      this.hasEma = false;
      this.freqs = [f]; // recomeça a mediana para a nova corda
    }

    const target = (tuning.strings[idx] as { frequency: number }).frequency;
    const rawCents = centsBetween(this.freqs.length > 2 ? fm : f, target);

    if (!this.hasEma) {
      this.centsEma = rawCents;
      this.freqEma = fm;
      this.hasEma = true;
    } else {
      const diff = Math.abs(rawCents - this.centsEma);
      // Longe: segue rápido. Perto: suaviza forte para o ponteiro não tremer.
      const alpha = diff > 25 ? 0.7 : diff > 8 ? 0.35 : diff > 3 ? 0.15 : 0.07;
      this.centsEma += alpha * (rawCents - this.centsEma);
      this.freqEma += alpha * (fm - this.freqEma);
    }

    const a = Math.abs(this.centsEma);
    this.inTune = this.inTune ? a <= IN_TUNE_EXIT : a <= IN_TUNE_ENTER;

    this.last = {
      active: true,
      holding: false,
      stringIndex: idx,
      cents: this.centsEma,
      freq: this.freqEma,
      inTune: this.inTune,
      levelDb: frame.levelDb,
    };
    return this.last;
  }
}

export function nearestString(freq: number, tuning: Tuning): number {
  let best = 0;
  let bestDist = Infinity;
  tuning.strings.forEach((s, i) => {
    const d = Math.abs(centsBetween(freq, s.frequency));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function emptyReading(): TunerReading {
  return { active: false, holding: false, stringIndex: -1, cents: 0, freq: 0, inTune: false, levelDb: -120 };
}
