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

/** Move o início do acorde `index` para `t`; o anterior acompanha (sem buraco nem sobreposição). */
export function moveStart(events: ChordEvent[], index: number, t: number): ChordEvent[] {
  const target = events[index];
  if (!target) return events;
  const prev = events[index - 1];
  const out = events.map((e) => ({ ...e }));
  const lo = prev ? prev.start + 0.1 : 0;
  const hi = target.end - 0.1;
  const nt = Math.min(hi, Math.max(lo, t));
  (out[index] as ChordEvent).start = nt;
  const p = out[index - 1];
  if (p && (Math.abs(p.end - target.start) < 0.3 || p.end > nt)) p.end = nt;
  return out;
}

/**
 * Insere um acorde que começa em `t`. Se `t` cai dentro de um acorde, o novo acorde fica com o RESTO dele
 * (o acorde de antes termina em `t`): assim dá para repartir qualquer intervalo inserindo acordes em sequência.
 * Se `t` cai numa lacuna, vai até o próximo acorde (ou 2 s). Copia o nome do acorde que estava ali (troque em seguida).
 */
export function insertChord(events: ChordEvent[], t: number): { events: ChordEvent[]; index: number } {
  const sorted = [...events].sort((a, b) => a.start - b.start).map((e) => ({ ...e }));
  const i = sorted.findIndex((e) => e.start <= t && t < e.end);
  if (i >= 0) {
    const cur = sorted[i] as ChordEvent;
    // quase no começo do acorde: não cria um pedaço minúsculo, edita o próprio acorde
    if (t - cur.start < 0.15) return { events: sorted, index: i };
    const tail: ChordEvent = { ...cur, start: t, confidence: 1 };
    cur.end = t;
    sorted.splice(i + 1, 0, tail);
    return { events: sorted, index: i + 1 };
  }
  const next = sorted.find((e) => e.start > t);
  const prev = [...sorted].reverse().find((e) => e.end <= t);
  const base = prev ?? next ?? { name: 'C', root: 0, typeId: 'maj', confidence: 1, start: 0, end: 0 };
  const created: ChordEvent = { start: t, end: Math.min(next ? next.start : Infinity, t + 2), name: base.name, root: base.root, typeId: base.typeId, confidence: 1 };
  const out = [...sorted, created].sort((a, b) => a.start - b.start);
  return { events: out, index: out.indexOf(created) };
}

/** Move o fim do acorde `index` para `t`; o próximo acompanha se estava colado. */
export function moveEnd(events: ChordEvent[], index: number, t: number): ChordEvent[] {
  const target = events[index];
  if (!target) return events;
  const next = events[index + 1];
  const out = events.map((e) => ({ ...e }));
  const hi = next ? next.end - 0.1 : Infinity;
  const nt = Math.min(hi, Math.max(target.start + 0.1, t));
  (out[index] as ChordEvent).end = nt;
  const n = out[index + 1];
  if (n && (Math.abs(n.start - target.end) < 0.3 || n.start < nt)) n.start = nt;
  return out;
}
