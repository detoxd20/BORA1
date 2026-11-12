import { CHORD_TYPES, buildModel } from './models';
import { NOTE_NAMES } from './notes';
import { getTuning } from '../tuner/tunings';

/** Uma formação (posição) de acorde no braço: 4 cordas, da 4ª (grave) para a 1ª (aguda). */
export interface Shape {
  /** Casa de cada corda: 0 = solta. */
  frets: number[];
  /** Dedo de cada corda: 0 = solta, 1–4 = dedo (a mesma pestana repete o número). */
  fingers: number[];
  /** Nome da nota que cada corda toca. */
  notes: string[];
  /** Menor = mais fácil/usual. */
  cost: number;
}

/** Casas mais altas só entram se não houver formação confortável. */
const COMFORT_FRET = 9;
const MAX_FRET = 12;

/** Notas (classes de altura) que o acorde precisa ter, e as opcionais (a quinta justa nos acordes de 4+ notas). */
function toneSets(root: number, typeId: string): { required: Set<number>; allowed: Set<number> } {
  const type = CHORD_TYPES.find((t) => t.id === typeId);
  if (!type) throw new Error(`Tipo de acorde desconhecido: ${typeId}`);
  const allowed = new Set(type.intervals.map((i) => (root + i) % 12));
  const required = new Set(allowed);
  if (type.intervals.length >= 4 && type.intervals.includes(7)) required.delete((root + 7) % 12);
  return { required, allowed };
}

/** Dedos para uma combinação de casas, ou null se precisar de mais de 4 dedos. */
function assignFingers(frets: number[]): number[] | null {
  const fretted = frets.map((f, s) => ({ f, s })).filter((x) => x.f > 0);
  if (fretted.length === 0) return frets.map(() => 0);
  const fingers = frets.map(() => 0);
  const lowest = Math.min(...fretted.map((x) => x.f));
  const groups = [...new Set(fretted.map((x) => x.f))].sort((a, b) => a - b);
  let next = 1;
  for (const f of groups) {
    const g = fretted.filter((x) => x.f === f);
    const contiguous = g.length >= 2 && g[g.length - 1]!.s - g[0]!.s === g.length - 1;
    if (f === lowest && contiguous) {
      for (const x of g) fingers[x.s] = next;
      next++;
    } else {
      for (const x of g) fingers[x.s] = next++;
    }
  }
  return next - 1 <= 4 ? fingers : null;
}

/** Verifica uma formação: toda nota pertence ao acorde e as notas essenciais estão presentes. */
export function validateShape(frets: number[], root: number, typeId: string, tuningId?: string): boolean {
  const open = getTuning(tuningId ?? 're-sol-si-re').strings.map((s) => s.midi);
  if (frets.length !== open.length) return false;
  const { required, allowed } = toneSets(root, typeId);
  const pcs = frets.map((f, i) => ((open[i] as number) + f) % 12);
  if (!pcs.every((p) => allowed.has(p))) return false;
  for (const r of required) if (!pcs.includes(r)) return false;
  return true;
}

const cache = new Map<string, Shape[]>();

/** Todas as formações válidas, da mais fácil/usual para a mais difícil. */
export function shapesFor(root: number, typeId: string, tuningId = 're-sol-si-re'): Shape[] {
  const key = `${tuningId}|${root}|${typeId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const open = getTuning(tuningId).strings.map((s) => s.midi);
  const { required, allowed } = toneSets(root, typeId);
  const fifth = (root + 7) % 12;
  const search = (limit: number): Shape[] => {
  const options = open.map((o) => {
    const fs: number[] = [];
    for (let f = 0; f <= limit; f++) if (allowed.has((o + f) % 12)) fs.push(f);
    return fs;
  });

  const out: Shape[] = [];
  for (const a of options[0] as number[])
    for (const b of options[1] as number[])
      for (const c of options[2] as number[])
        for (const d of options[3] as number[]) {
          const frets = [a, b, c, d];
          const pcs = frets.map((f, i) => ((open[i] as number) + f) % 12);
          let ok = true;
          for (const r of required) if (!pcs.includes(r)) ok = false;
          if (!ok) continue;
          const fingers = assignFingers(frets);
          if (!fingers) continue;
          const fretted = frets.filter((f) => f > 0);
          const maxF = fretted.length ? Math.max(...fretted) : 0;
          const minF = fretted.length ? Math.min(...fretted) : 0;
          const span = maxF - minF;
          if (span > 3) continue; // mão do cavaquinho: no máximo 4 casas
          let cost = fretted.reduce((s, f) => s + f, 0) * 1.0 + span * 2 + Math.max(...fingers) * 1.5 - frets.filter((f) => f === 0).length * 0.8;
          if (maxF > 7) cost += 6;
          if (maxF > 10) cost += 10;
          if (pcs.includes(fifth)) cost -= 2.5; // acorde completo soa mais cheio
          if (pcs[0] === root) cost -= 1.2; // fundamental na corda mais grave
          out.push({ frets, fingers, notes: pcs.map((p) => NOTE_NAMES[p] as string), cost });
        }
  return out;
  };

  let out = search(COMFORT_FRET);
  if (out.length === 0) out = search(MAX_FRET);
  out.sort((x, y) => x.cost - y.cost || x.frets.join().localeCompare(y.frets.join()));
  cache.set(key, out);
  return out;
}

export function bestShape(root: number, typeId: string, tuningId?: string): Shape | null {
  return shapesFor(root, typeId, tuningId)[0] ?? null;
}

/** Casa inicial da janela do diagrama e se mostra a pestana "pestana/nut". */
export function diagramWindow(shape: Shape): { base: number; nut: boolean } {
  const fretted = shape.frets.filter((f) => f > 0);
  if (fretted.length === 0 || Math.max(...fretted) <= 4) return { base: 1, nut: true };
  return { base: Math.min(...fretted), nut: false };
}

/** Descrição das notas do acorde, ex.: "C E G". */
export function chordNotes(root: number, typeId: string): string[] {
  return buildModel(root, CHORD_TYPES.find((t) => t.id === typeId)!).pitchClasses.map((p) => NOTE_NAMES[p] as string);
}

export const shapeKey = (root: number, typeId: string) => `${root}:${typeId}`;

/**
 * Formação a usar: a preferida (se for válida para o acorde), senão a melhor pela regra.
 * Uma preferência inválida (ex.: de outra afinação) é ignorada — nunca mostramos um diagrama errado.
 */
export function resolveShape(root: number, typeId: string, preferred?: number[], tuningId?: string): Shape | null {
  if (preferred && validateShape(preferred, root, typeId, tuningId)) {
    const all = shapesFor(root, typeId, tuningId);
    const found = all.find((s) => s.frets.join() === preferred.join());
    if (found) return found;
    const open = getTuning(tuningId ?? 're-sol-si-re').strings.map((s) => s.midi);
    const fingers = assignFingers(preferred);
    if (fingers) return { frets: preferred, fingers, notes: preferred.map((f, i) => NOTE_NAMES[((open[i] as number) + f) % 12] as string), cost: 0 };
  }
  return bestShape(root, typeId, tuningId);
}
