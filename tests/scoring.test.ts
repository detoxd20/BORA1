import { describe, expect, it } from 'vitest';
import { ChromaExtractor } from '../src/audio/chroma';
import { midiToFreq } from '../src/chords/notes';
import { bestShape } from '../src/chords/shapes';
import { classify, DEFAULT_SCORE, ScoreEngine, shapeTemplate, type LiveFrame, type Target } from '../src/game/scoring';
import { synth } from './helpers';

const SR = 48000;
const FFT = 4096;
const OPEN = [62, 67, 71, 74];
const ex = new ChromaExtractor({ sampleRate: SR, fftSize: FFT });

/** Cromagrama real (via FFT) de uma forma tocada no cavaquinho. */
function chromaOf(frets: number[], opts: { noise?: number; detune?: number } = {}): Float64Array {
  const len = FFT + 64;
  const a = new Float32Array(len);
  frets.forEach((f, i) => {
    const s = synth(midiToFreq(OPEN[i]! + f) * Math.pow(2, ((opts.detune ?? 0) * (i % 2 ? 1 : -1)) / 1200), SR, len, { amp: 0.2, seed: 21 + i, noise: opts.noise ?? 0 });
    for (let k = 0; k < len; k++) a[k]! += s[k] as number;
  });
  return ex.compute(a).chroma;
}

// Música de teste: os acordes da aula do Cicinho, com as formas padrão
const SONG: Array<[string, number, string]> = [['G', 7, 'maj'], ['F#m', 6, 'min'], ['B7', 11, '7'], ['Em7', 4, 'm7'], ['Dm', 2, 'min'], ['G7', 7, '7']];
const shapes = new Map(SONG.map(([n, r, t]) => [n, bestShape(r, t)!.frets]));
const templates = new Map(SONG.map(([n]) => [n, shapeTemplate(shapes.get(n)!.map((f, i) => (OPEN[i]! + f) % 12))]));
const chroma = new Map(SONG.map(([n]) => [n, chromaOf(shapes.get(n)!)]));
const SILENT = new Float64Array(12);

const targets: Target[] = SONG.map(([n], i) => ({ start: 2 + i * 2, end: 4 + i * 2, key: n }));
const DT = 1024 / SR;

/** Simula o jogador: `played(t)` diz qual acorde está soando no tempo t (ou null = silêncio). */
function play(engine: ScoreEngine, played: (t: number) => string | null, until = 15) {
  const js = [];
  for (let t = 0; t < until; t += DT) {
    const k = played(t);
    const f: LiveFrame = { t, chroma: k ? chroma.get(k)! : SILENT, levelDb: k ? -20 : -80 };
    js.push(...engine.push(f));
  }
  js.push(...engine.finish());
  return js;
}
const at = (t: number, shift = 0) => {
  const i = Math.floor((t - 2 - shift) / 2);
  return i >= 0 && i < SONG.length ? SONG[i]![0] : null;
};

describe('reconhecer o acorde esperado entre os da música (áudio sintético → FFT → cromagrama)', () => {
  it('cada forma é reconhecida como ela mesma, inclusive o B7 sem fundamental (4-2-4-4)', () => {
    for (const [n] of SONG) expect(classify({ t: 0, chroma: chroma.get(n)!, levelDb: -20 }, templates, DEFAULT_SCORE).key, n).toBe(n);
  });
  it('continua certo com ruído e cordas levemente desafinadas', () => {
    for (const [n] of SONG) {
      const c = chromaOf(shapes.get(n)!, { noise: 0.01, detune: 10 });
      expect(classify({ t: 0, chroma: c, levelDb: -20 }, templates, DEFAULT_SCORE).key, n).toBe(n);
    }
  });
  it('silêncio e som baixo demais não contam', () => {
    expect(classify({ t: 0, chroma: SILENT, levelDb: -80 }, templates, DEFAULT_SCORE).key).toBeNull();
    expect(classify({ t: 0, chroma: chroma.get('G')!, levelDb: -60 }, templates, DEFAULT_SCORE).key).toBeNull();
  });
});

describe('ScoreEngine', () => {
  it('tocando tudo na hora: todos perfeitos, sequência cheia, 5 estrelas', () => {
    const e = new ScoreEngine(targets, templates);
    const js = play(e, (t) => at(t));
    expect(js.map((j) => j.grade)).toEqual(Array(6).fill('perfeito'));
    const s = e.summary;
    expect(s.maxCombo).toBe(6);
    expect(s.accuracy).toBe(1);
    expect(s.stars).toBe(5);
    expect(s.multiplier).toBe(2); // 6 seguidos → 2×
    expect(s.score).toBeGreaterThan(600); // 6×100 + bônus de sustentar
  });
  it('0,25 s atrasado → "bom"; 0,7 s atrasado → "ok" (atrasado)', () => {
    expect(play(new ScoreEngine(targets, templates), (t) => at(t, 0.25)).every((j) => j.grade === 'bom')).toBe(true);
    expect(play(new ScoreEngine(targets, templates), (t) => at(t, 0.7)).every((j) => j.grade === 'ok')).toBe(true);
  });
  it('um pouco adiantado (0,1 s) ainda é perfeito', () => {
    const js = play(new ScoreEngine(targets, templates), (t) => at(t, -0.1));
    expect(js.filter((j) => j.grade === 'perfeito').length).toBeGreaterThanOrEqual(5);
  });
  it('sem tocar nada: tudo erro, zero pontos', () => {
    const e = new ScoreEngine(targets, templates);
    const js = play(e, () => null);
    expect(js.map((j) => j.grade)).toEqual(Array(6).fill('erro'));
    expect(e.summary.score).toBe(0);
    expect(e.summary.stars).toBe(0);
  });
  it('tocar o acorde ERRADO não pontua e zera a sequência', () => {
    const e = new ScoreEngine(targets, templates);
    // toca certo, mas no 3º acorde (B7, de 6 a 8 s) fica segurando o F#m
    const js = play(e, (t) => (t >= 6 && t < 8 ? 'F#m' : at(t)));
    expect(js.map((j) => j.grade)).toEqual(['perfeito', 'perfeito', 'erro', 'perfeito', 'perfeito', 'perfeito']);
    expect(e.summary.maxCombo).toBe(3);
    expect(e.summary.counts.erro).toBe(1);
  });
  it('segurar o acorde anterior não vale como acerto do próximo', () => {
    const e = new ScoreEngine(targets, templates);
    const js = play(e, (t) => (t >= 2 ? 'G' : null)); // fica só no G a música toda
    expect(js[0]!.grade).toBe('perfeito');
    expect(js.slice(1).every((j) => j.grade === 'erro')).toBe(true);
  });
  it('um quadro solto do acorde certo (ruído) não confirma acerto', () => {
    const e = new ScoreEngine(targets, templates);
    let n = 0;
    const js = play(e, (t) => (t >= 2 && t < 4 && n++ === 3 ? 'G' : null), 5);
    expect(js[0]!.grade).toBe('erro');
  });
  it('sustentar o acorde até o fim vale mais do que soltar logo', () => {
    const full = new ScoreEngine(targets.slice(0, 1), templates);
    play(full, (t) => (t >= 2 && t < 4 ? 'G' : null), 5);
    const short = new ScoreEngine(targets.slice(0, 1), templates);
    play(short, (t) => (t >= 2 && t < 2.3 ? 'G' : null), 5);
    expect(full.summary.score).toBeGreaterThan(short.summary.score);
  });
  it('seek: acordes anteriores ao ponto não viram erro', () => {
    const e = new ScoreEngine(targets, templates);
    e.seek(9);
    const js = [];
    for (let t = 9; t < 15; t += DT) js.push(...e.push({ t, chroma: at(t) ? chroma.get(at(t)!)! : SILENT, levelDb: at(t) ? -20 : -80 }));
    js.push(...e.finish());
    expect(js.map((j) => j.index)).toEqual([4, 5]);
    expect(js.every((j) => j.grade === 'perfeito')).toBe(true);
  });
});

import { gateFromNoise } from '../src/game/scoring';
describe('limite de volume pelo ruído do ambiente', () => {
  it('sala silenciosa → limite baixo (sensível); sala barulhenta → limite alto', () => {
    expect(gateFromNoise(Array(60).fill(-75))).toBe(-58);
    expect(gateFromNoise(Array(60).fill(-50))).toBe(-40);
    expect(gateFromNoise(Array(60).fill(-20))).toBe(-32); // nunca fica surdo de vez
  });
  it('se o jogador já estiver tocando durante a medição, não infla o limite', () => {
    const levels = [...Array(40).fill(-60), ...Array(20).fill(-15)]; // 1/3 do tempo com cavaco
    expect(gateFromNoise(levels)).toBe(-50);
  });
  it('poucas medições → valor padrão', () => {
    expect(gateFromNoise([-40])).toBe(-48);
  });
  it('o motor passa a ignorar som abaixo do limite ajustado', () => {
    const e = new ScoreEngine(targets, templates);
    e.setGate(-30);
    const js = [];
    for (let t = 0; t < 15; t += DT) js.push(...e.push({ t, chroma: at(t) ? chroma.get(at(t)!)! : SILENT, levelDb: -40 }));
    js.push(...e.finish());
    expect(js.every((j) => j.grade === 'erro')).toBe(true);
  });
});

describe('faixa do cavaquinho no microfone (270 Hz para cima)', () => {
  const live = new ChromaExtractor({ sampleRate: SR, fftSize: FFT, minFreq: 270, maxFreq: 2400 });
  const mix = (frets: number[], extra: Array<[number, number]>) => {
    const len = FFT + 64;
    const a = new Float32Array(len);
    frets.forEach((f, i) => {
      const s = synth(midiToFreq(OPEN[i]! + f), SR, len, { amp: 0.2, seed: 31 + i });
      for (let k = 0; k < len; k++) a[k]! += s[k] as number;
    });
    for (const [hz, amp] of extra) {
      const s = synth(hz, SR, len, { amp, harmonics: [1], seed: 77 });
      for (let k = 0; k < len; k++) a[k]! += s[k] as number;
    }
    return a;
  };
  it('zumbido forte de 120 Hz e um grave de 180 Hz não atrapalham o reconhecimento do acorde', () => {
    for (const [n] of SONG) {
      const c = live.compute(mix(shapes.get(n)!, [[120, 0.5], [180, 0.4]])).chroma;
      expect(classify({ t: 0, chroma: c, levelDb: -20 }, templates, DEFAULT_SCORE).key, n).toBe(n);
    }
  });
  it('só o grave (sem cavaco) não vira acorde nenhum', () => {
    const len = FFT + 64;
    const a = new Float32Array(len);
    for (const [hz, amp] of [[120, 0.5], [180, 0.4]] as const) {
      const s = synth(hz, SR, len, { amp, harmonics: [1], seed: 5 });
      for (let k = 0; k < len; k++) a[k]! += s[k] as number;
    }
    const c = live.compute(a).chroma;
    expect(Array.from(c).reduce((x, y) => x + y, 0)).toBe(0);
  });
  it('a corda mais grave (Ré4, 293,66 Hz) continua sendo ouvida', () => {
    const c = live.compute(mix([0, 0, 0, 0], [])).chroma; // cordas soltas: D G B D
    expect(c[2]!).toBeGreaterThan(0.2); // Ré presente
  });
});
