import type { ChordEvent } from '../chords/analyzer';

export type { ChordEvent };

/** Identifica o arquivo do usuário (o app não guarda o vídeo, só os acordes). */
export function fileKey(f: { name: string; size: number; lastModified: number }): string {
  return `cavaco:song:v1:${f.name}:${f.size}:${f.lastModified}`;
}

export function loadEvents(key: string): ChordEvent[] | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ChordEvent[]) : null;
  } catch {
    return null;
  }
}

export function saveEvents(key: string, events: ChordEvent[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(events));
  } catch {
    /* sem espaço / bloqueado */
  }
}

/** Índice do acorde ativo no tempo `t` (o último que começou), ou -1. */
export function activeIndex(events: ChordEvent[], t: number): number {
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid] as ChordEvent).start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (ans >= 0 && t > (events[ans] as ChordEvent).end + 0.5) return -1;
  return ans;
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
