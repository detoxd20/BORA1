import { midiToFreq, parseNoteName, noteFromMidi } from '../chords/notes';

export interface TuningString {
  /** Número da corda: 1 = mais fina/aguda … 4 = mais grossa/grave. */
  number: number;
  /** Ex.: "D4" */
  note: string;
  solfege: string;
  midi: number;
  frequency: number;
}

export interface Tuning {
  id: string;
  name: string;
  description: string;
  /** Ordem de exibição: da corda 4 (grave) para a 1 (aguda). */
  strings: TuningString[];
}

function makeTuning(id: string, name: string, description: string, notes: string[]): Tuning {
  // `notes` vem na ordem 4ª → 1ª corda
  const total = notes.length;
  return {
    id,
    name,
    description,
    strings: notes.map((n, i) => {
      const midi = parseNoteName(n);
      return {
        number: total - i,
        note: n,
        solfege: noteFromMidi(midi).solfege,
        midi,
        frequency: midiToFreq(midi),
      };
    }),
  };
}

export const TUNINGS: Tuning[] = [
  makeTuning('re-sol-si-re', 'Ré-Sol-Si-Ré', 'Afinação padrão (natural)', ['D4', 'G4', 'B4', 'D5']),
  makeTuning('re-sol-si-mi', 'Ré-Sol-Si-Mi', 'Afinação com a 1ª corda em Mi', ['D4', 'G4', 'B4', 'E5']),
  makeTuning('sol-sol-si-re', 'Sol-Sol-Si-Ré', 'Variação com a 4ª corda em Sol', ['G4', 'G4', 'B4', 'D5']),
];

export const DEFAULT_TUNING_ID = TUNINGS[0]!.id;

export function getTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? (TUNINGS[0] as Tuning);
}
