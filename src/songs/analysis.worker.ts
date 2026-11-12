import { analyzeChords, type ChordEvent } from '../chords/analyzer';
import { detectOnsets, type Onset } from '../audio/onsets';
import { refineWithOnsets } from '../chords/refine';
import type { VocabSegment } from './vocabulary';

export interface WorkerIn { samples: Float32Array; sampleRate: number; vocabulary?: VocabSegment[] }
export type WorkerOut =
  | { type: 'progress'; value: number }
  | { type: 'done'; events: ChordEvent[]; onsets: Onset[] }
  | { type: 'error'; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  try {
    const onsets = detectOnsets(ev.data.samples, ev.data.sampleRate).map((o) => ({ t: +o.t.toFixed(3), strength: +o.strength.toFixed(4) }));
    const found = analyzeChords(ev.data.samples, ev.data.sampleRate, {
      onProgress: (value) => post({ type: 'progress', value }),
      vocabulary: ev.data.vocabulary,
    });
    // O Viterbi diz QUAL acorde toca; a palhetada diz QUANDO ele troca.
    post({ type: 'done', events: refineWithOnsets(found, onsets), onsets });
  } catch (e) {
    post({ type: 'error', message: String(e) });
  }
};
