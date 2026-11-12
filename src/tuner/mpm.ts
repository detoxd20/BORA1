/**
 * Detecção de pitch pelo método McLeod (MPM — McLeod Pitch Method).
 * Função pura, sem dependências de DOM: roda no AudioWorklet e nos testes.
 *
 * Referência: McLeod & Wyvill, "A Smarter Way to Find Pitch" (2005).
 */

export interface PitchOptions {
  sampleRate: number;
  /** Menor frequência procurada (Hz). */
  minFreq?: number;
  /** Maior frequência procurada (Hz). */
  maxFreq?: number;
  /** Limiar relativo para escolher o pico (0.8–1). Maior = menos erros de oitava. */
  k?: number;
}

export interface PitchResult {
  /** Frequência em Hz (refinada por interpolação parabólica). */
  frequency: number;
  /** Clareza 0–1: quão periódico é o sinal. Ruído fica baixo, nota limpa fica perto de 1. */
  clarity: number;
}

/**
 * Espaço de trabalho reutilizável — evita alocar memória a cada quadro
 * dentro do AudioWorklet (alocar no thread de áudio causa falhas de áudio).
 */
export class MpmWorkspace {
  nsdf: Float32Array;
  constructor(maxLag: number) {
    this.nsdf = new Float32Array(maxLag + 2);
  }
}

export function detectPitch(
  buf: Float32Array,
  opts: PitchOptions,
  ws?: MpmWorkspace,
): PitchResult | null {
  const { sampleRate } = opts;
  const minFreq = opts.minFreq ?? 200;
  const maxFreq = opts.maxFreq ?? 1000;
  const k = opts.k ?? 0.93;

  const n = buf.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(n / 2));
  if (tauMax <= tauMin + 2) return null;

  const nsdf = ws && ws.nsdf.length >= tauMax + 2 ? ws.nsdf : new Float32Array(tauMax + 2);

  // m(0) = 2·Σ x²; depois atualizado incrementalmente.
  let m = 0;
  for (let j = 0; j < n; j++) {
    const v = buf[j] as number;
    m += v * v;
  }
  m *= 2;
  if (m < 1e-12) return null;

  nsdf[0] = 1;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    // m(τ) = m(τ-1) − x[τ-1]² − x[n-τ]²
    const a = buf[tau - 1] as number;
    const b = buf[n - tau] as number;
    m -= a * a + b * b;
    let r = 0;
    const lim = n - tau;
    for (let j = 0; j < lim; j++) r += (buf[j] as number) * (buf[j + tau] as number);
    nsdf[tau] = m > 1e-12 ? (2 * r) / m : 0;
  }

  // Pula o primeiro lóbulo positivo (em torno de τ=0).
  let tau = 1;
  while (tau < tauMax && (nsdf[tau] as number) > 0) tau++;

  // Pico máximo de cada região positiva ("key maxima").
  const peaks: number[] = [];
  let best = -Infinity;
  while (tau < tauMax) {
    while (tau < tauMax && (nsdf[tau] as number) <= 0) tau++;
    let peakTau = -1;
    let peakVal = -Infinity;
    while (tau < tauMax && (nsdf[tau] as number) > 0) {
      const v = nsdf[tau] as number;
      if (v > peakVal) {
        peakVal = v;
        peakTau = tau;
      }
      tau++;
    }
    if (peakTau >= tauMin && peakTau > 1 && peakTau < tauMax) {
      peaks.push(peakTau);
      if (peakVal > best) best = peakVal;
    }
  }
  if (peaks.length === 0) return null;

  // Primeiro pico que chega perto do maior → evita saltar para a oitava de baixo.
  const threshold = k * best;
  let chosen = peaks[0] as number;
  for (const p of peaks) {
    if ((nsdf[p] as number) >= threshold) {
      chosen = p;
      break;
    }
  }

  // Interpolação parabólica → precisão sub-amostra (essencial para ±2 cents).
  const y0 = nsdf[chosen - 1] as number;
  const y1 = nsdf[chosen] as number;
  const y2 = nsdf[chosen + 1] as number;
  const denom = y0 - 2 * y1 + y2;
  let shift = 0;
  let clarity = y1;
  if (denom < 0) {
    shift = (0.5 * (y0 - y2)) / denom;
    clarity = y1 - 0.25 * (y0 - y2) * shift;
  }
  const period = chosen + shift;
  if (!(period > 0)) return null;
  return { frequency: sampleRate / period, clarity: Math.min(1, Math.max(0, clarity)) };
}

/** Nível RMS em dBFS (−∞ para silêncio, limitado em −120). */
export function rmsDb(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] as number;
    s += v * v;
  }
  const rms = Math.sqrt(s / Math.max(1, buf.length));
  return rms > 1e-6 ? 20 * Math.log10(rms) : -120;
}
