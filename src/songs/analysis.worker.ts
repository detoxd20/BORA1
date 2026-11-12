import { analyzeChords, type ChordEvent } from '../chords/analyzer';
import type { VocabSegment } from './vocabulary';

export interface WorkerIn { samples: Float32Array; sampleRate: number; vocabulary?: VocabSegment[] }
export type WorkerOut =
  | { type: 'progress'; value: number }
  | { type: 'done'; events: ChordEvent[] }
  | { type: 'error'; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  try {
    const events = analyzeChords(ev.data.samples, ev.data.sampleRate, {
      onProgress: (value) => post({ type: 'progress', value }),
      vocabulary: ev.data.vocabulary,
    });
    post({ type: 'done', events });
  } catch (e) {
    post({ type: 'error', message: String(e) });
  }
};
