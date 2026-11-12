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

  return mergeRepeats(out);
}

/**
 * Acordes iguais vizinhos (mesmo nome, com no máximo `maxGap` segundos entre eles) viram UM só bloco de tempo:
 * do começo do primeiro ao fim do último. Mais fácil de sincronizar do que várias repetições coladas.
 */
export function mergeRepeats(events: ChordEvent[], maxGap = 1): ChordEvent[] {
  const merged: ChordEvent[] = [];
  for (const e of [...events].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && same(last, e) && e.start - last.end <= maxGap) {
      last.end = Math.max(last.end, e.end);
      last.confidence = Math.min(last.confidence, e.confidence);
    } else merged.push({ ...e });
  }
  return merged;
}

/** Troca o acorde `index` por outro; se ficar igual ao vizinho, os dois viram um bloco só. Devolve também o novo índice. */
export function retypeChord(
  events: ChordEvent[],
  index: number,
  next: { root: number; typeId: string; name: string },
): { events: ChordEvent[]; index: number } {
  const target = events[index];
  if (!target) return { events, index };
  const changed = events.map((e, i) => (i === index ? { ...e, ...next, confidence: 1 } : e));
  const merged = mergeRepeats(changed);
  const at = merged.findIndex((e) => e.start <= target.start && e.end > target.start);
  return { events: merged, index: at >= 0 ? at : Math.min(index, merged.length - 1) };
}
