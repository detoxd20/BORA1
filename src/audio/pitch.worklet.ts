/// <reference path="./worklet-globals.d.ts" />
/**
 * AudioWorklet: roda no thread de áudio, sem passar pelo thread da interface.
 * Mantém uma janela deslizante e roda o MPM a cada `hop` amostras.
 */
import { detectPitch, MpmWorkspace, rmsDb } from '../tuner/mpm';

export interface PitchWorkletOptions {
  windowSize: number;
  hop: number;
  minFreq: number;
  maxFreq: number;
  /** Abaixo disso nem tentamos detectar (economiza CPU em silêncio). */
  skipBelowDb: number;
}

export interface PitchWorkletMessage {
  t: number;
  freq: number;
  clarity: number;
  levelDb: number;
}

class PitchProcessor extends AudioWorkletProcessor {
  private opts: PitchWorkletOptions;
  private ring: Float32Array;
  private frame: Float32Array;
  private pos = 0;
  private filled = 0;
  private sinceHop = 0;
  private ws: MpmWorkspace;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.opts = options?.processorOptions as PitchWorkletOptions;
    this.ring = new Float32Array(this.opts.windowSize);
    this.frame = new Float32Array(this.opts.windowSize);
    this.ws = new MpmWorkspace(Math.ceil(sampleRate / this.opts.minFreq) + 2);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const size = this.ring.length;

    for (let i = 0; i < input.length; i++) {
      this.ring[this.pos] = input[i] as number;
      this.pos = (this.pos + 1) % size;
    }
    this.filled = Math.min(size, this.filled + input.length);
    this.sinceHop += input.length;

    if (this.filled === size && this.sinceHop >= this.opts.hop) {
      this.sinceHop = 0;
      // Linearização: o mais antigo primeiro.
      const tail = size - this.pos;
      this.frame.set(this.ring.subarray(this.pos), 0);
      this.frame.set(this.ring.subarray(0, this.pos), tail);

      const levelDb = rmsDb(this.frame);
      let freq = 0;
      let clarity = 0;
      if (levelDb > this.opts.skipBelowDb) {
        const r = detectPitch(
          this.frame,
          { sampleRate, minFreq: this.opts.minFreq, maxFreq: this.opts.maxFreq },
          this.ws,
        );
        if (r) {
          freq = r.frequency;
          clarity = r.clarity;
        }
      }
      const msg: PitchWorkletMessage = { t: currentTime, freq, clarity, levelDb };
      this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor('pitch-processor', PitchProcessor);
