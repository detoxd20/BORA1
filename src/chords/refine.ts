import { nearestOnset, type Onset } from '../audio/onsets';
import type { ChordEvent } from './analyzer';

export interface RefineOptions {
  /** Quanto (s) o início de um acorde pode andar para encostar numa palhetada. */
  window?: number;
}

/**
 * Encosta o início de cada acorde na palhetada mais próxima. O Viterbi acha QUAL acorde toca; o instante
 * exato da troca vem do ataque da palheta (mais preciso). Sem palhetada forte por perto, mantém o tempo.
 */
export function refineWithOnsets(events: ChordEvent[], onsets: Onset[], opts: RefineOptions = {}): ChordEvent[] {
  const window = opts.window ?? 1;
  if (onsets.length === 0) return events;
  const out = events.map((e) => ({ ...e }));
  for (let i = 0; i < out.length; i++) {
    const ev = out[i] as ChordEvent;
    const orig = events[i] as ChordEvent;
    const prev = out[i - 1];
    const nextOrig = events[i + 1];
    const o = nearestOnset(onsets, orig.start, window);
    if (!o) continue;
    // não ultrapassa os vizinhos
    const lo = prev ? prev.start + 0.25 : 0;
    const hi = Math.min(orig.end - 0.2, nextOrig ? nextOrig.start - 0.25 : Infinity);
    const t = Math.min(hi, Math.max(lo, o.t));
    const touched = prev && Math.abs(prev.end - orig.start) < 0.3;
    ev.start = t;
    if (prev && (touched || prev.end > t)) prev.end = t;
  }
  return out;
}
