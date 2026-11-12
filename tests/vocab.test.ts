import { describe, expect, it } from 'vitest';
import { analyzeChords } from '../src/chords/analyzer';
import { parseChordLine } from '../src/chords/parse';
import { midiToFreq } from '../src/chords/notes';
import { buildVocabulary, vocabAt } from '../src/songs/vocabulary';
import { synth } from './helpers';

const obs = (t: number, line: string) => ({ t, chords: parseChordLine(line) });

describe('buildVocabulary', () => {
  it('um erro isolado do OCR não cria trecho; mudança confirmada cria', () => {
    const o = [
      obs(0, 'G F#m B7'), obs(1, 'G F#m B7'), obs(2, 'G F# B7'), // leitura errada isolada
      obs(3, 'G F#m B7'), obs(4, 'G F#m B7'),
      obs(5, 'C Am F'), obs(6, 'C Am F'), obs(7, 'C Am F'),
    ];
    const v = buildVocabulary(o);
    expect(v).toHaveLength(2);
    expect(v[0]!.names).toEqual(['G', 'F#m', 'B7']);
    expect(v[1]!.names).toEqual(['C', 'Am', 'F']);
    expect(v[0]!.start).toBe(0);
    expect(v[0]!.end).toBe(5);
    expect(vocabAt(v, 6)?.names[0]).toBe('C');
  });
  it('leituras vazias mantêm o trecho', () => {
    const v = buildVocabulary([obs(0, 'G Am'), obs(1, 'G Am'), obs(2, ''), obs(3, ''), obs(4, 'G Am')]);
    expect(v).toHaveLength(1);
    expect(v[0]!.end).toBe(Infinity);
  });
});

describe('análise restrita ao vocabulário do vídeo', () => {
  const SR = 22050;
  // C6 (C E G A) tem as mesmas notas de Am7: só o vídeo desempata
  const midis = [72, 76, 79, 81];
  const len = SR * 4;
  const audio = new Float32Array(len);
  midis.forEach((m, i) => {
    const s = synth(midiToFreq(m), SR, len, { amp: 0.2, seed: 5 + i });
    for (let k = 0; k < len; k++) audio[k]! += s[k] as number;
  });
  const vocab = (line: string) => buildVocabulary([obs(0, line), obs(1, line), obs(2, line)]);

  it('com C6 no vídeo, o acorde é C6', () => {
    const ev = analyzeChords(audio, SR, { vocabulary: vocab('C6 G7') });
    expect(ev.map((e) => e.name)).toEqual(['C6']);
  });
  it('com Am7 no vídeo, o MESMO áudio vira Am7', () => {
    const ev = analyzeChords(audio, SR, { vocabulary: vocab('Am7 Dm') });
    expect(ev.map((e) => e.name)).toEqual(['Am7']);
  });
  it('acorde fora da lista do vídeo é suprimido (falso acorde de voz/batida)', () => {
    const ev = analyzeChords(audio, SR, { vocabulary: vocab('F#m B7') });
    expect(ev).toEqual([]);
  });
});
