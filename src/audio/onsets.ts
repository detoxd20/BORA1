import { FFT, hann } from './fft';

export interface Onset {
  /** Segundos desde o início do áudio. */
  t: number;
  /** Força relativa do ataque (fluxo espectral). Palhetada de acorde é bem mais forte que nota de voz. */
  strength: number;
}

export interface OnsetOptions {
  minFreq?: number;
  maxFreq?: number;
  /** Passo entre quadros (s). */
  hopSec?: number;
  /** Intervalo mínimo entre palhetadas (s). */
  minGap?: number;
  /** Quanto o pico precisa superar a média local (multiplicador). */
  sensitivity?: number;
}

/**
 * Detecção de ataques (palhetadas): fluxo espectral com compressão logarítmica.
 * Só conta aumento de energia (retificação de meia onda), então o decaimento da corda não gera falsos ataques.
 */
export function detectOnsets(samples: Float32Array, sampleRate: number, opts: OnsetOptions = {}): Onset[] {
  const minFreq = opts.minFreq ?? 150;
  const maxFreq = opts.maxFreq ?? 6000;
  const hop = Math.max(32, Math.round(sampleRate * (opts.hopSec ?? 0.008)));
  const minGap = opts.minGap ?? 0.07;
  const sens = opts.sensitivity ?? 1.8;

  let fftSize = 256;
  while (fftSize < sampleRate * 0.04) fftSize *= 2;
  if (samples.length < fftSize + hop * 4) return [];

  const fft = new FFT(fftSize);
  const win = hann(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const binHz = sampleRate / fftSize;
  const k0 = Math.max(1, Math.floor(minFreq / binHz));
  const k1 = Math.min(fftSize / 2 - 1, Math.ceil(maxFreq / binHz));
  const nb = k1 - k0 + 1;

  const nFrames = Math.floor((samples.length - fftSize) / hop) + 1;
  const flux = new Float64Array(nFrames);
  let prev = new Float64Array(nb);
  let cur = new Float64Array(nb);
  const norm = 4 / fftSize;

  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = (samples[off + i] as number) * (win[i] as number);
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 0; k < nb; k++) cur[k] = Math.log1p(Math.hypot(re[k + k0] as number, im[k + k0] as number) * norm * 200);
    if (f > 0) {
      let s = 0;
      for (let k = 0; k < nb; k++) {
        const d = (cur[k] as number) - (prev[k] as number);
        if (d > 0) s += d;
      }
      flux[f] = s / nb;
    }
    [prev, cur] = [cur, prev];
  }

  // Média local (±0,35 s) por soma acumulada
  const csum = new Float64Array(nFrames + 1);
  for (let i = 0; i < nFrames; i++) csum[i + 1] = (csum[i] as number) + (flux[i] as number);
  const half = Math.max(2, Math.round(0.35 / (hop / sampleRate)));
  const peakR = Math.max(2, Math.round(0.03 / (hop / sampleRate)));

  const out: Onset[] = [];
  for (let i = 1; i < nFrames - 1; i++) {
    const v = flux[i] as number;
    let isMax = true;
    for (let j = Math.max(0, i - peakR); j <= Math.min(nFrames - 1, i + peakR); j++) {
      if ((flux[j] as number) > v || ((flux[j] as number) === v && j < i)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const a = Math.max(0, i - half), b = Math.min(nFrames, i + half + 1);
    const mean = ((csum[b] as number) - (csum[a] as number)) / (b - a);
    if (v < mean * sens + 0.01) continue;
    // O ataque entra na janela quando seu centro passa por ele
    const t = (i * hop + fftSize / 2) / sampleRate;
    const last = out[out.length - 1];
    if (last && t - last.t < minGap) {
      if (v > last.strength) out[out.length - 1] = { t, strength: v };
    } else out.push({ t, strength: v });
  }
  return out;
}

/** Ataque mais próximo de `t` dentro de ±`window` s (ponderando força e distância). */
export function nearestOnset(onsets: Onset[], t: number, window = 1): Onset | null {
  const med = medianStrength(onsets);
  let best: Onset | null = null;
  let bestScore = 0;
  for (const o of onsets) {
    const d = Math.abs(o.t - t);
    if (d > window) continue;
    if (o.strength < med * 0.6) continue; // ignora ataques fracos (nota solta, voz)
    const score = o.strength * (1 - d / (window * 1.5));
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

export function medianStrength(onsets: Onset[]): number {
  if (onsets.length === 0) return 0;
  const s = onsets.map((o) => o.strength).sort((a, b) => a - b);
  return s[s.length >> 1] as number;
}
