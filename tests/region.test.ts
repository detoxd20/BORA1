import { describe, expect, it } from 'vitest';
import { pickRegion, type ChordWord } from '../src/songs/region';

const w = (name: string, x: number, y: number, conf = 90): ChordWord => ({ name, x0: x, y0: y, x1: x + 0.04, y1: y + 0.04, conf });

describe('pickRegion', () => {
  const banner = [w('G', 0.15, 0.01), w('F#m', 0.25, 0.01), w('B7', 0.35, 0.01), w('Em7', 0.45, 0.01), w('Dm', 0.55, 0.01)];
  it('acha a faixa de cima mesmo com lixo em posições diferentes a cada quadro', () => {
    const frames: ChordWord[][] = [];
    for (let i = 0; i < 12; i++) frames.push([...banner, w('A', 0.3 + i * 0.03, 0.4 + (i % 5) * 0.08), w('Em', 0.1 + i * 0.02, 0.7)]);
    const r = pickRegion(frames)!;
    expect(r).not.toBeNull();
    expect(r.y).toBeLessThan(0.02);
    expect(r.y + r.h).toBeLessThan(0.12); // não engole a camisa
    expect(r.x).toBe(0); // largura toda: pega os acordes das pontas que o OCR perdeu
    expect(r.w).toBe(1);
  });
  it('um acorde por vez (mesmo lugar, nomes diferentes)', () => {
    const names = ['G', 'F#m', 'B7', 'Em7', 'Dm', 'G7'];
    const frames = Array.from({ length: 12 }, (_, i) => [w(names[i % 6] as string, 0.12, 0.03)]);
    const r = pickRegion(frames)!;
    expect(r).not.toBeNull();
    expect(r.y).toBeLessThan(0.04);
    expect(r.y + r.h).toBeGreaterThan(0.07);
  });
  it('sem repetição no mesmo lugar → null (cai para o seletor manual)', () => {
    const frames = Array.from({ length: 12 }, (_, i) => [w('A', (i * 0.07) % 0.9, (i * 0.13) % 0.9)]);
    expect(pickRegion(frames)).toBeNull();
    expect(pickRegion([])).toBeNull();
  });
});
