import { describe, expect, it } from 'vitest';
import { analyzeChords } from '../src/chords/analyzer';
import { parseChordLine } from '../src/chords/parse';
import { midiToFreq } from '../src/chords/notes';
import { buildVocabulary, chordsPerFrame, vocabAt } from '../src/songs/vocabulary';
import { synth } from './helpers';

const obs = (t: number, line: string) => ({ t, chords: parseChordLine(line) });
const run = (rows: Array<[number, string]>, step = 1) => buildVocabulary(rows.map(([t, l]) => obs(t, l)), { step });

describe('buildVocabulary', () => {
  it('um erro isolado do OCR não cria trecho; mudança confirmada cria', () => {
    const v = run([[0, 'G F#m B7'], [1, 'G F#m B7'], [2, 'G F# B7'], [3, 'G F#m B7'], [4, 'G F#m B7'], [5, 'C Am F'], [6, 'C Am F'], [7, 'C Am F']]);
    expect(v).toHaveLength(2);
    expect(v[0]!.names).toEqual(['G', 'F#m', 'B7']);
    expect(v[1]!.names).toEqual(['C', 'Am', 'F']);
    expect(v[0]!.end).toBe(5);
    expect(vocabAt(v, 6)?.names[0]).toBe('C');
  });
  it('falha curta de leitura (< 2,5 s) mantém o trecho', () => {
    const v = run([[0, 'G Am'], [1, 'G Am'], [2, ''], [3, ''], [4, 'G Am'], [5, 'G Am']]);
    expect(v).toHaveLength(1);
    expect(v[0]!.start).toBe(0);
    expect(v[0]!.end).toBe(6);
  });
  it('fala no começo e no fim (sem acordes na tela) fica FORA dos trechos', () => {
    const rows: Array<[number, string]> = [];
    for (let t = 0; t < 10; t++) rows.push([t, '']); // professor falando
    for (let t = 10; t < 20; t++) rows.push([t, 'G Am']);
    for (let t = 20; t < 30; t++) rows.push([t, '']); // despedida
    const v = run(rows);
    expect(v).toHaveLength(1);
    expect(v[0]!.start).toBe(10);
    expect(v[0]!.end).toBe(20);
    expect(vocabAt(v, 5)).toBeUndefined();
    expect(vocabAt(v, 25)).toBeUndefined();
  });
  it('faixa que some no meio e volta com outros acordes gera dois trechos', () => {
    const rows: Array<[number, string]> = [];
    for (let t = 0; t < 6; t++) rows.push([t, 'G Am']);
    for (let t = 6; t < 12; t++) rows.push([t, '']);
    for (let t = 12; t < 18; t++) rows.push([t, 'C F']);
    const v = run(rows);
    expect(v.map((s) => s.names.join(' '))).toEqual(['G Am', 'C F']);
    expect(vocabAt(v, 9)).toBeUndefined();
  });
  it('um acorde por vez: trechos curtos, um por acorde', () => {
    const rows: Array<[number, string]> = [];
    ['G', 'F#m', 'B7', 'Em7'].forEach((c, i) => { rows.push([i * 2, c], [i * 2 + 1, c]); });
    const v = run(rows);
    expect(v.map((s) => s.names[0])).toEqual(['G', 'F#m', 'B7', 'Em7']);
    expect(chordsPerFrame(rows.map(([t, l]) => obs(t, l)))).toBe(1);
  });
  it('chordsPerFrame: lista de 6 → 6', () => {
    expect(chordsPerFrame([obs(0, 'G F#m B7 Em7 Dm G7'), obs(1, 'G F#m B7 Em7 Dm G7'), obs(2, '')])).toBe(6);
  });
});

describe('análise restrita ao vocabulário do vídeo', () => {
  const SR = 22050;
  const chordAudio = (midis: number[], sec: number) => {
    const len = SR * sec;
    const a = new Float32Array(len);
    midis.forEach((m, i) => {
      const s = synth(midiToFreq(m), SR, len, { amp: 0.2, seed: 5 + i });
      for (let k = 0; k < len; k++) a[k]! += s[k] as number;
    });
    return a;
  };
  const audio = chordAudio([72, 76, 79, 81], 4); // C6 ≡ Am7
  const vocab = (line: string) => buildVocabulary([obs(0, line), obs(1, line), obs(2, line), obs(3, line)], { step: 1 });

  it('com C6 no vídeo, o acorde é C6', () => {
    expect(analyzeChords(audio, SR, { vocabulary: vocab('C6 G7') }).map((e) => e.name)).toEqual(['C6']);
  });
  it('com Am7 no vídeo, o MESMO áudio vira Am7', () => {
    expect(analyzeChords(audio, SR, { vocabulary: vocab('Am7 Dm') }).map((e) => e.name)).toEqual(['Am7']);
  });
  it('acorde fora da lista do vídeo é suprimido', () => {
    expect(analyzeChords(audio, SR, { vocabulary: vocab('F#m B7 Em7 Dm') })).toEqual([]);
  });
  it('som fora dos trechos (professor falando/tocando antes da faixa aparecer) não vira acorde', () => {
    // 0–3 s: "fala" (um acorde forte qualquer); 3–7 s: acorde real com a faixa na tela
    const full = new Float32Array(SR * 7);
    full.set(chordAudio([66, 70, 73, 78], 3), 0);
    full.set(chordAudio([72, 76, 79, 84], 4), SR * 3);
    const v = buildVocabulary([3, 4, 5, 6].map((t) => obs(t, 'C G7')), { step: 1 });
    const ev = analyzeChords(full, SR, { vocabulary: v });
    expect(ev.map((e) => e.name)).toEqual(['C']);
    expect(ev[0]!.start).toBeGreaterThan(2.5);
  });
});

describe('fillFromVideo (um acorde por vez)', () => {
  it('usa o acorde da tela onde o áudio não confirmou', async () => {
    const { fillFromVideo } = await import('../src/songs/vocabulary');
    const rows: Array<[number, string]> = [];
    ['G', 'F#m', 'B7'].forEach((c, i) => rows.push([i * 2, c], [i * 2 + 1, c]));
    const v = run(rows);
    const audio = [{ start: 0, end: 2, name: 'G', root: 7, typeId: 'maj', confidence: 0.9 }];
    const out = fillFromVideo(audio, v);
    expect(out.map((e) => e.name)).toEqual(['G', 'F#m', 'B7']);
    expect(out[1]!.confidence).toBeLessThan(0.7);
    expect(out[0]!.confidence).toBe(0.9);
  });
});

describe('votação temporal (lixo do OCR)', () => {
  it('chord que só aparece numa leitura solta não entra; o estável entra', async () => {
    const { smoothObservations } = await import('../src/songs/vocabulary');
    const rows: Array<[number, string]> = [[0, 'G Am'], [1, 'G Am A'], [2, 'G Am'], [3, 'G Am'], [4, 'G Am D'], [5, 'G Am']];
    const sm = smoothObservations(rows.map(([t, l]) => obs(t, l)));
    for (const o of sm) expect(o.chords.map((c) => c.name).sort()).toEqual(['Am', 'G']);
  });
  it('lista com leitura incompleta numa das leituras ainda sai completa', () => {
    const rows: Array<[number, string]> = [[0, 'G Am F'], [1, 'G Am'], [2, 'G Am F'], [3, 'G F'], [4, 'G Am F'], [5, 'G Am F']];
    const v = run(rows);
    expect(v).toHaveLength(1);
    expect([...v[0]!.names].sort()).toEqual(['Am', 'F', 'G']);
  });
});

describe('lacunas e acordes únicos', () => {
  const SR = 22050;
  const tone = (midis: number[], sec: number) => {
    const len = SR * sec;
    const a = new Float32Array(len);
    midis.forEach((m, i) => {
      const s = synth(midiToFreq(m), SR, len, { amp: 0.2, seed: 11 + i });
      for (let k = 0; k < len; k++) a[k]! += s[k] as number;
    });
    return a;
  };
  it('lacuna curta no meio (OCR falhou) NÃO apaga acorde que o áudio tocou claramente', () => {
    // 0–4 s: C com faixa; 4–8 s: G7 SEM faixa lida (falha do OCR); 8–12 s: C com faixa
    const full = new Float32Array(SR * 12);
    full.set(tone([72, 76, 79, 84], 4), 0);
    full.set(tone([67, 71, 74, 77], 4), SR * 4);
    full.set(tone([72, 76, 79, 84], 4), SR * 8);
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((t) => obs(t, t >= 4 && t < 8 ? '' : 'C F Am Dm'));
    const v = buildVocabulary(rows, { step: 1 });
    const names = analyzeChords(full, SR, { vocabulary: v }).map((e) => e.name);
    expect(names).toEqual(['C', 'G7', 'C']);
  });
  it('uma pausa longa (> 8 s) sem faixa é tratada como fala: nada', () => {
    const full = new Float32Array(SR * 16);
    full.set(tone([67, 71, 74, 77], 10), SR * 3); // "fala" de 3 a 13 s
    full.set(tone([72, 76, 79, 84], 3), 0);
    full.set(tone([72, 76, 79, 84], 3), SR * 13);
    const v = buildVocabulary(Array.from({ length: 16 }, (_, t) => obs(t, t < 3 || t >= 13 ? 'C F Am Dm' : '')), { step: 1 });
    expect(analyzeChords(full, SR, { vocabulary: v }).map((e) => e.name)).toEqual(['C', 'C']);
  });
  it('acorde único na tela é dica forte, mas áudio claro de outro acorde ainda vence', () => {
    const v = buildVocabulary([0, 1, 2, 3].map((t) => obs(t, 'F#m')), { step: 1 });
    const names = analyzeChords(tone([72, 76, 79, 84], 4), SR, { vocabulary: v }).map((e) => e.name);
    expect(names).toEqual(['C']);
  });
});
