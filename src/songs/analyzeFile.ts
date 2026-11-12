import type { ChordEvent } from '../chords/analyzer';
import type { WorkerOut } from './analysis.worker';

/** Decodifica o áudio de um arquivo de vídeo/áudio do usuário, em mono. */
export async function decodeToMono(file: File): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const n = buf.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i]! += (ch[i] as number) / buf.numberOfChannels;
    }
    return { samples: mono, sampleRate: buf.sampleRate };
  } finally {
    void ctx.close();
  }
}

export function analyzeInWorker(
  samples: Float32Array,
  sampleRate: number,
  onProgress: (v: number) => void,
): Promise<ChordEvent[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.value);
      else {
        w.terminate();
        if (m.type === 'done') resolve(m.events);
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message));
    };
    w.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}
