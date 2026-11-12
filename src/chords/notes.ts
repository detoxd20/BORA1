/** Teoria básica: notas, frequências e cents. Referência: A4 = 440 Hz. */

export const A4_HZ = 440;

/** Nomes em português (notação por letra, como nas cifras brasileiras). */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Nomes em solfejo, usados na interface do afinador. */
export const NOTE_SOLFEGE = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'] as const;

/** Número MIDI (fracionário) de uma frequência. A4 = 69. */
export function freqToMidi(freq: number, a4 = A4_HZ): number {
  return 69 + 12 * Math.log2(freq / a4);
}

export function midiToFreq(midi: number, a4 = A4_HZ): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Diferença em cents de `freq` em relação a `target` (positivo = acima / agudo). */
export function centsBetween(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target);
}

export interface NoteInfo {
  midi: number;
  /** 0 = C … 11 = B */
  pitchClass: number;
  octave: number;
  /** Ex.: "D4" */
  name: string;
  /** Ex.: "Ré" */
  solfege: string;
  frequency: number;
}

export function noteFromMidi(midi: number, a4 = A4_HZ): NoteInfo {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return {
    midi,
    pitchClass,
    octave,
    name: `${NOTE_NAMES[pitchClass]}${octave}`,
    solfege: NOTE_SOLFEGE[pitchClass] as string,
    frequency: midiToFreq(midi, a4),
  };
}

/** Nota temperada mais próxima de uma frequência. */
export function nearestNote(freq: number, a4 = A4_HZ): { note: NoteInfo; cents: number } {
  const note = noteFromMidi(Math.round(freqToMidi(freq, a4)), a4);
  return { note, cents: centsBetween(freq, note.frequency) };
}

/** Converte "D4", "F#5" etc. em número MIDI. */
export function parseNoteName(name: string): number {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(name);
  if (!m) throw new Error(`Nota inválida: ${name}`);
  const idx = NOTE_NAMES.indexOf(`${m[1]}${m[2]}` as (typeof NOTE_NAMES)[number]);
  if (idx < 0) throw new Error(`Nota inválida: ${name}`);
  return (Number(m[3]) + 1) * 12 + idx;
}
