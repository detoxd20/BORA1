import type { Region } from './ocr';

/** Uma palavra que o OCR reconheceu como acorde, em frações (0–1) do quadro. */
export interface ChordWord {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  conf: number;
}

const BIN = 0.02;

/**
 * Descobre onde fica a faixa de acordes a partir de várias amostras do vídeo (cada amostra = palavras-acorde lidas
 * no quadro inteiro). A faixa é onde palavras-acorde aparecem **no mesmo lugar em vários quadros**; lixo
 * (camisa, legenda, logo) cai em posições diferentes a cada quadro e perde a votação.
 * Devolve `null` se nada se repete o bastante.
 */
export function pickRegion(frames: ChordWord[][], minFrames = 3): Region | null {
  const nFrames = frames.length;
  if (nFrames === 0) return null;

  // Votação por faixa vertical: quantos quadros distintos têm alguma palavra-acorde nessa faixa.
  const nBins = Math.ceil(1 / BIN);
  const votes = new Array<number>(nBins).fill(0);
  frames.forEach((words) => {
    const hit = new Set<number>();
    for (const w of words) {
      const cy = (w.y0 + w.y1) / 2;
      const b = Math.min(nBins - 1, Math.floor(cy / BIN));
      for (const k of [b - 1, b, b + 1]) if (k >= 0 && k < nBins) hit.add(k);
    }
    hit.forEach((k) => (votes[k] = (votes[k] as number) + 1));
  });
  let best = 0;
  for (let k = 1; k < nBins; k++) if ((votes[k] as number) > (votes[best] as number)) best = k;
  if ((votes[best] as number) < minFrames) return null;

  const center = (best + 0.5) * BIN;
  const inBand = frames.map((ws) => ws.filter((w) => Math.abs((w.y0 + w.y1) / 2 - center) <= BIN * 2.5));
  const all = inBand.flat();
  if (all.length === 0) return null;

  const y0 = Math.min(...all.map((w) => w.y0));
  const y1 = Math.max(...all.map((w) => w.y1));

  // Na horizontal usa a LARGURA TODA: o OCR de quadro inteiro costuma perder os acordes das pontas,
  // e uma faixa fina e larga lê bem (o logo e o resto não viram acorde). A altura é que precisa ser justa.
  const rx0 = 0;
  const rx1 = 1;

  const h = y1 - y0;
  const padY = Math.max(0.008, h * 0.35);
  const r0 = Math.max(0, y0 - padY);
  const r1 = Math.min(1, y1 + padY);
  return { x: rx0, y: r0, w: Math.max(0.05, rx1 - rx0), h: Math.max(0.03, r1 - r0) };
}
