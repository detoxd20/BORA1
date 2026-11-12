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

/**
 * Dedos para uma combinação de casas, ou null se precisar de mais de 4 dedos.
 * Como nos diagramas de cavaquinho: um dedo por nota, numerados da casa mais baixa para a mais alta;
 * pestana (mesmo dedo em várias cordas) só quando faltariam dedos.
 */
function assignFingers(frets: number[]): number[] | null {
  const fretted = frets.map((f, s) => ({ f, s })).filter((x) => x.f > 0).sort((x, y) => x.f - y.f || x.s - y.s);
  const fingers = frets.map(() => 0);
  if (fretted.length <= 4) {
    fretted.forEach((x, i) => (fingers[x.s] = i + 1));
    return fingers;
  }
  return null;
}

/**
 * Verifica uma formação: toda nota pertence ao acorde e as notas que definem o acorde estão presentes.
 * - Tríades: fundamental, terça (ou quarta) e quinta, todas.
 * - Acordes de 4+ notas: a terça e a sétima/sexta/nona são obrigatórias; a quinta justa pode faltar;
 *   a fundamental pode faltar só se todas as outras notas estiverem lá (forma "sem fundamental", comum no cavaquinho, ex.: B7 = 4-2-4-4).
 */
export function validateShape(frets: number[], root: number, typeId: string, tuningId?: string): boolean {
  const open = getTuning(tuningId ?? 're-sol-si-re').strings.map((s) => s.midi);
  if (frets.length !== open.length || frets.some((f) => !Number.isInteger(f) || f < 0 || f > 24)) return false;
  const type = CHORD_TYPES.find((t) => t.id === typeId);
  if (!type) return false;
  const tones = type.intervals.map((i) => (root + i) % 12);
  const pcs = frets.map((f, i) => ((open[i] as number) + f) % 12);
  if (!pcs.every((p) => tones.includes(p))) return false;
  if (type.intervals.length <= 3) return tones.every((t) => pcs.includes(t));
  const fifth = type.intervals.includes(7) ? (root + 7) % 12 : -1;
  const essentials = tones.filter((t) => t !== root && t !== fifth);
  if (!essentials.every((t) => pcs.includes(t))) return false;
  return pcs.includes(root) || tones.filter((t) => t !== root).every((t) => pcs.includes(t));
}

/**
 * Formas padrão do cavaquinho (afinação D G B D), como aparecem nos métodos e videoaulas: formas FECHADAS e móveis.
 * Cada forma é dada para uma fundamental de referência e deslizada pelo braço para as outras notas.
 * Conferidas com os diagramas da aula do Cicinho do Cavaco: G 5-4-3-5 · F#m 4-2-2-4 · B7 4-2-4-4 · Em7 2-0-0-0 · Dm 3-2-3-3 · G7 3-4-3-5.
 * Nenhuma forma é usada sem passar por `validateShape` (as notas são conferidas contra o acorde).
 */
const FORMS: Record<string, Array<{ frets: number[]; root: number }>> = {
  maj: [
    { frets: [3, 2, 1, 3], root: 5 }, // forma de Fá: F A C F → G = 5-4-3-5
    { frets: [2, 0, 1, 2], root: 0 }, // forma de Dó: E G C E → D = 4-2-3-4
    { frets: [2, 2, 2, 2], root: 9 }, // forma de Lá: E A C# E → B = 4-4-4-4
  ],
  min: [
    { frets: [3, 2, 3, 3], root: 2 }, // forma de Ré menor: F A D F
    { frets: [2, 2, 1, 2], root: 9 }, // forma de Lá menor: E A C E
    { frets: [4, 2, 2, 4], root: 6 }, // forma de Fá# menor: F# A C# F#
  ],
  '7': [
    { frets: [3, 4, 3, 5], root: 7 }, // forma de Sol7: F B D G
    { frets: [2, 3, 1, 2], root: 0 }, // forma de Dó7: E Bb C E
    { frets: [4, 2, 4, 4], root: 11 }, // forma de Si7 (sem fundamental): F# A D# F# → A7 = 2-0-2-2
  ],
  m7: [
    { frets: [2, 0, 0, 0], root: 4 }, // forma de Mi menor 7: E G B D → F#m7 = 4-2-2-2
    { frets: [5, 5, 5, 7], root: 9 }, // forma de Lá menor 7: G C E A
    { frets: [0, 2, 1, 3], root: 2 }, // forma de Ré menor 7: D A C F
    { frets: [2, 0, 1, 2], root: 9 }, // Lá menor 7 sem fundamental (= forma de Dó): E G C E → Bm7 = 4-2-3-4
  ],
  '7M': [
    { frets: [5, 4, 3, 4], root: 7 }, // forma de Sol7M: G B D F#
    { frets: [2, 4, 1, 2], root: 0 }, // forma de Dó7M: E B C E
  ],
  '6': [{ frets: [2, 2, 1, 2], root: 0 }], // forma de Dó6: E A C E → D6 = 4-4-3-4
  m7b5: [
    { frets: [9, 7, 6, 7], root: 11 }, // forma de Si meio-diminuto: B D F A → F#m7(b5) = 4-2-1-2
    { frets: [0, 2, 0, 3], root: 11 }, // D A B F
  ],
};

/** X6 tem as mesmas notas de (X−3)m7, e Xm6 as de (X−3)m7(b5): reaproveita as formas. */
const ALIAS: Record<string, { typeId: string; shift: number }> = {
  '6': { typeId: 'm7', shift: 9 },
  m6: { typeId: 'm7b5', shift: 9 },
};

/** Formas exatas que valem mais que a regra geral (as do vídeo de referência e as mais consagradas). */
const STANDARD: Record<string, number[]> = {
  '7:maj': [5, 4, 3, 5], // G
  '0:maj': [2, 0, 1, 2], // C
  '4:m7': [2, 0, 0, 0], // Em7
  '11:7': [4, 2, 4, 4], // B7
  '9:7': [2, 0, 2, 2], // A7
  // "Quadradinho de Fá maior" (Léo Soares), enviado pelo dono: F 3-2-1-3 · D7 4-2-1-4 · Gm 5-3-3-5 · C7 5-3-5-5
  '5:maj': [3, 2, 1, 3], // F
  '2:7': [4, 2, 1, 4], // D7 (sem fundamental: F# A C F#)
  '7:min': [5, 3, 3, 5], // Gm
  '0:7': [5, 3, 5, 5], // C7 (sem fundamental: G Bb E G)
};

/** Nota de "quão alto e solto" — menor é melhor. Cordas soltas pesam: no cavaquinho a forma fechada é a regra. */
function formScore(frets: number[]): number {
  const open = frets.filter((f) => f === 0).length;
  return Math.max(...frets) + open * 2.5 + (open === frets.length ? 5 : 0);
}

function curatedFrets(root: number, typeId: string, tuningId: string): number[][] {
  if (tuningId !== 're-sol-si-re') return [];
  const alias = ALIAS[typeId];
  // formas próprias do tipo + as do acorde "parente" de mesmas notas
  const sources: Array<{ forms: Array<{ frets: number[]; root: number }>; target: number }> = [{ forms: FORMS[typeId] ?? [], target: root }];
  if (alias) sources.push({ forms: FORMS[alias.typeId] ?? [], target: (root + alias.shift) % 12 });
  const out: number[][] = [];
  const std = STANDARD[`${root}:${typeId}`];
  if (std && validateShape(std, root, typeId, tuningId)) out.push(std);
  const cands: number[][] = [];
  for (const { forms, target } of sources) {
    for (const form of forms) {
      const k = (target - form.root + 12) % 12;
      for (const shift of [k, k - 12]) {
        const frets = form.frets.map((f) => f + shift);
        if (frets.every((f) => f >= 0 && f <= MAX_FRET) && validateShape(frets, root, typeId, tuningId)) cands.push(frets);
      }
    }
  }
  cands.sort((x, y) => formScore(x) - formScore(y));
  for (const c of cands) if (!out.some((o) => o.join() === c.join())) out.push(c);
  return out;
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

  let generated = search(COMFORT_FRET);
  if (generated.length === 0) generated = search(MAX_FRET);
  generated.sort((x, y) => x.cost - y.cost || x.frets.join().localeCompare(y.frets.join()));

  // Primeiro as formas padrão do cavaquinho; depois, como opções extras, as geradas pela regra.
  const out: Shape[] = [];
  curatedFrets(root, typeId, tuningId).forEach((frets, i) => {
    const fingers = assignFingers(frets);
    if (fingers) out.push({ frets, fingers, notes: frets.map((f, s) => NOTE_NAMES[((open[s] as number) + f) % 12] as string), cost: -100 + i });
  });
  for (const g of generated) if (!out.some((o) => o.frets.join() === g.frets.join())) out.push(g);
  cache.set(key, out);
  return out;
}

export function bestShape(root: number, typeId: string, tuningId?: string): Shape | null {
  return shapesFor(root, typeId, tuningId)[0] ?? null;
}

/** Quantas casas o diagrama mostra (5 a partir da pestana, como nas videoaulas). */
export const DIAGRAM_FRETS = 5;

/** Casa inicial da janela do diagrama e se mostra a pestana "pestana/nut". */
export function diagramWindow(shape: Shape): { base: number; nut: boolean } {
  const fretted = shape.frets.filter((f) => f > 0);
  if (fretted.length === 0 || Math.max(...fretted) <= DIAGRAM_FRETS) return { base: 1, nut: true };
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
