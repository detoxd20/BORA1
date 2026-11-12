/// <reference path="./worklet-globals.d.ts" />
/**
 * AudioWorklet do jogo: cromagrama do microfone ~47×/s, calculado no thread de áudio.
 */
import { ChromaExtractor } from './chroma';

export interface ChromaWorkletMessage {
  /** Relógio do AudioContext no fim do trecho analisado. */
  t: number;
  chroma: Float32Array;
  levelDb: number;
}

const FFT = 4096;
const HOP = 1024;

class ChromaProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(FFT);
  private frame = new Float32Array(FFT);
  private pos = 0;
  private filled = 0;
  private since = 0;
  // Só a faixa do cavaquinho: a corda mais grave é o Ré4 (293,66 Hz). Abaixo de ~270 Hz só há voz grave,
  // zumbido e ruído — nada que o instrumento produza. (270 e não 293 para tolerar corda um pouco baixa.)
  private ex = new ChromaExtractor({ sampleRate, fftSize: FFT, minFreq: 270, maxFreq: 2400 });

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.ring[this.pos] = input[i] as number;
      this.pos = (this.pos + 1) % FFT;
    }
    this.filled = Math.min(FFT, this.filled + input.length);
    this.since += input.length;
    if (this.filled === FFT && this.since >= HOP) {
      this.since = 0;
      this.frame.set(this.ring.subarray(this.pos), 0);
      this.frame.set(this.ring.subarray(0, this.pos), FFT - this.pos);
      const r = this.ex.compute(this.frame);
      const msg: ChromaWorkletMessage = { t: currentTime, chroma: Float32Array.from(r.chroma), levelDb: r.levelDb };
      this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor('chroma-processor', ChromaProcessor);

