import { describe, expect, it } from 'vitest';
import { parseChord, parseChordLine } from '../src/chords/parse';

describe('parseChord', () => {
  it('reconhece as cifras do vídeo de teste', () => {
    expect(parseChordLine('G F#m B7 Em7 Dm G7').map((c) => c.name)).toEqual(['G', 'F#m', 'B7', 'Em7', 'Dm', 'G7']);
  });
  it('variações de escrita', () => {
    expect(parseChord('Bm7(b5)')?.typeId).toBe('m7b5');
    expect(parseChord('Bm7b5')?.typeId).toBe('m7b5');
    expect(parseChord('G7M')?.typeId).toBe('7M');
    expect(parseChord('Gmaj7')?.typeId).toBe('7M');
    expect(parseChord('C°')?.typeId).toBe('dim');
    expect(parseChord('Bb')?.root).toBe(10);
    expect(parseChord('Ab7')?.name).toBe('G#7');
    expect(parseChord('G/B')?.name).toBe('G');
    expect(parseChord('Asus4')?.typeId).toBe('sus4');
  });
  it('lixo do OCR não vira acorde', () => {
    expect(parseChord('Hello')).toBeNull();
    expect(parseChord('cacinho')).toBeNull();
    expect(parseChord('H7')).toBeNull();
    expect(parseChord('Gxyz')).toBeNull();
    expect(parseChordLine('Do cavaco G  ~ Am')).toHaveLength(2); // só "G" e "Am"
  });
});
