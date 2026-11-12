import type { ChordEvent } from '../chords/analyzer';

const same = (a: ChordEvent, b: ChordEvent) => a.root === b.root && a.typeId === b.typeId;

/**
 * Apaga o acorde `index` sem deixar buraco: o vizinho ocupa o tempo dele.
 * - `prefer: 'prev'` → o acorde anterior continua até o fim do apagado.
 * - `prefer: 'next'` → o próximo acorde começa onde o apagado começava.
 * Sem o vizinho preferido, usa o outro; sem nenhum, só remove. Vizinhos iguais que passam a se tocar viram um só.
 */
export function removeChord(events: ChordEvent[], index: number, prefer: 'prev' | 'next' = 'prev'): ChordEvent[] {
  const removed = events[index];
  if (!removed) return events;
  const out = events.filter((_, i) => i !== index).map((e) => ({ ...e }));
  const prev = index > 0 ? out[index - 1] : undefined;
  const next = index < out.length ? out[index] : undefined;

  const useNext = (prefer === 'next' && next) || (!prev && next);
  if (useNext && next) next.start = Math.min(next.start, removed.start);
  else if (prev) prev.end = Math.max(prev.end, removed.end);

  // Mesmo acorde dos dois lados (e agora colados): junta
  const merged: ChordEvent[] = [];
  for (const e of out) {
    const last = merged[merged.length - 1];
    if (last && same(last, e) && e.start - last.end <= 0.01) {
      last.end = Math.max(last.end, e.end);
      last.confidence = Math.min(last.confidence, e.confidence);
    } else merged.push(e);
  }
  return merged;
}
