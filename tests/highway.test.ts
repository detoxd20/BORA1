import { describe, expect, it } from 'vitest';
import { depthScale, laneX, LOOKAHEAD, makeGeometry, projectY, SmoothClock, stepParticles, widthAt } from '../src/game/highway';

describe('projeção da pista', () => {
  const g = makeGeometry(390, 844);
  it('na hora do acorde (dt = 0) ele está na linha de acerto; no limite da visão, no horizonte', () => {
    expect(depthScale(0)).toBe(1);
    expect(depthScale(LOOKAHEAD)).toBeCloseTo(0, 9);
    expect(projectY(g, depthScale(0))).toBeCloseTo(g.strikeY);
    expect(projectY(g, depthScale(LOOKAHEAD))).toBeCloseTo(g.horizonY);
  });
  it('quanto mais perto no tempo, mais embaixo na tela (sempre, sem voltar)', () => {
    let last = -Infinity;
    for (let dt = LOOKAHEAD; dt >= -0.25; dt -= 0.05) {
      const y = projectY(g, depthScale(dt));
      expect(y).toBeGreaterThan(last);
      last = y;
    }
  });
  it('perspectiva: o mesmo intervalo de tempo ocupa menos tela quando está longe', () => {
    const near = projectY(g, depthScale(0)) - projectY(g, depthScale(0.5));
    const far = projectY(g, depthScale(LOOKAHEAD - 0.5)) - projectY(g, depthScale(LOOKAHEAD));
    expect(near).toBeGreaterThan(far * 3);
  });
  it('as 4 cordas ficam em ordem, simétricas, e se abrem ao chegar perto', () => {
    for (const s of [0, 0.5, 1]) {
      const xs = [0, 1, 2, 3].map((l) => laneX(g, l, s));
      expect(xs[0]!).toBeLessThan(xs[1]!);
      expect(xs[2]!).toBeLessThan(xs[3]!);
      expect(xs[0]! + xs[3]!).toBeCloseTo(g.w, 6);
    }
    expect(widthAt(g, 1)).toBeGreaterThan(widthAt(g, 0) * 2);
    expect(laneX(g, 3, 1)).toBeLessThan(g.w); // cabe na tela
  });
});

describe('SmoothClock', () => {
  it('com o tempo do vídeo andando aos saltos de 250 ms, o relógio do jogo anda liso', () => {
    const c = new SmoothClock();
    let prev = c.read(10, 0, true, 1);
    let maxStep = 0, minStep = Infinity;
    for (let ms = 16.7; ms < 3000; ms += 16.7) {
      const media = 10 + Math.floor(ms / 250) * 0.25; // só atualiza de 250 em 250 ms
      const t = c.read(media, ms, true, 1);
      maxStep = Math.max(maxStep, t - prev);
      minStep = Math.min(minStep, t - prev);
      prev = t;
    }
    expect(minStep).toBeGreaterThan(0.005); // nunca para
    expect(maxStep).toBeLessThan(0.03); // nunca pula
    expect(Math.abs(prev - 13)).toBeLessThan(0.3); // e não se afasta do vídeo
  });
  it('seek (salto grande) realinha na hora; pausado segue o vídeo exatamente', () => {
    const c = new SmoothClock();
    c.read(5, 0, true, 1);
    expect(c.read(42, 16, true, 1)).toBe(42);
    expect(c.read(7.3, 32, false, 1)).toBe(7.3);
  });
  it('respeita a velocidade (0,5×)', () => {
    const c = new SmoothClock();
    c.read(0, 0, true, 0.5);
    expect(c.read(0.5, 1000, true, 0.5)).toBeCloseTo(0.5, 2);
  });
});

describe('faíscas', () => {
  it('somem quando a vida acaba', () => {
    const ps = [{ x: 0, y: 0, vx: 10, vy: 0, life: 0.1, color: '#fff' }];
    expect(stepParticles(ps, 0.05)).toHaveLength(1);
    expect(stepParticles(ps, 0.2)).toHaveLength(0);
  });
});
