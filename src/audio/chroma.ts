import { FFT, hann } from './fft';

export interface ChromaOptions {
  sampleRate: number;
  fftSize?: number;
  /** Faixa útil do cavaquinho (fundamentais ~D4 a ~D6 + harmônicos que ajudam). */
  minFreq?: number;
  maxFreq?: number;
}

export interface ChromaFrame {
  /** 12 classes de altura, C=0 … B=11, normalizado para soma 1 (ou tudo 0 se silêncio). */
  chroma: Float64Array;
  /** Energia RMS do trecho (dBFS). */
  levelDb: number;
}

/**
 * Cromagrama por picos espectrais: só máximos locais do espectro entram
 * (rejeita o "chão" de ruído) e a magnitude é comprimida (raiz) para que
 * uma nota forte não esmague as demais.
 */
export class ChromaExtractor {
  readonly fftSize: number;
  private fft: FFT;
  private win: Float64Array;
  private re: Float64Array;
  private im: Float64Array;
  private mag: Float64Array;
  private minBin: number;
  private maxBin: number;
  private binHz: number;

  constructor(opts: ChromaOptions) {
    this.fftSize = opts.fftSize ?? 8192;
    this.fft = new FFT(this.fftSize);
    this.win = hann(this.fftSize);
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    this.mag = new Float64Array(this.fftSize / 2);
    this.binHz = opts.sampleRate / this.fftSize;
    this.minBin = Math.max(2, Math.floor((opts.minFreq ?? 130) / this.binHz));
    this.maxBin = Math.min(this.fftSize / 2 - 2, Math.ceil((opts.maxFreq ?? 2200) / this.binHz));
  }

  /** `samples` precisa ter ao menos fftSize amostras a partir de `start`. */
  compute(samples: Float32Array, start = 0): ChromaFrame {
    const n = this.fftSize;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = samples[start + i] as number;
      sq += v * v;
      this.re[i] = v * (this.win[i] as number);
      this.im[i] = 0;
    }
    const rms = Math.sqrt(sq / n);
    const levelDb = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    this.fft.transform(this.re, this.im);
    for (let i = 0; i < n / 2; i++) this.mag[i] = Math.hypot(this.re[i] as number, this.im[i] as number);

    const chroma = new Float64Array(12);
    // Limiar adaptativo: ignora picos muito abaixo do maior pico da faixa.
    let peakMax = 0;
    for (let i = this.minBin; i <= this.maxBin; i++) peakMax = Math.max(peakMax, this.mag[i] as number);
    const floor = peakMax * 0.1;
    for (let i = this.minBin; i <= this.maxBin; i++) {
      const m = this.mag[i] as number;
      if (m < floor || m <= (this.mag[i - 1] as number) || m < (this.mag[i + 1] as number)) continue;
      // interpolação parabólica da frequência do pico
      const a = this.mag[i - 1] as number, c = this.mag[i + 1] as number;
      const d = a - 2 * m + c;
      const shift = d < 0 ? (0.5 * (a - c)) / d : 0;
      const f = (i + shift) * this.binHz;
      const midi = 69 + 12 * Math.log2(f / 440);
      const lo = Math.floor(midi);
      const frac = midi - lo;
      const w = Math.sqrt(m);
      // distribui entre as duas notas vizinhas (tolera afinação imperfeita)
      chroma[((lo % 12) + 12) % 12]! += w * (1 - frac) * (1 - frac);
      chroma[(((lo + 1) % 12) + 12) % 12]! += w * frac * frac;
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += chroma[i] as number;
    if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] = (chroma[i] as number) / sum;
    return { chroma, levelDb };
  }
}
