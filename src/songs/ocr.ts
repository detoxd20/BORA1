/** Lê, por OCR, os acordes escritos numa região do vídeo ao longo do tempo (tudo local, sem internet). */
import { createWorker } from 'tesseract.js';
import { parseChordLine } from '../chords/parse';
import type { Observation } from './vocabulary';

/** Retângulo em frações (0–1) do quadro do vídeo. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_REGION: Region = { x: 0, y: 0, w: 1, h: 0.12 };
export const SCAN_STEP = 1;

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 4000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('Não consegui abrir o vídeo para ler os quadros.'));
    v.src = src;
  });
}

/** Desenha a região (ampliada, em tons de cinza) num canvas. */
function cropTo(canvas: HTMLCanvasElement, v: HTMLVideoElement, r: Region): void {
  const sx = r.x * v.videoWidth, sy = r.y * v.videoHeight;
  const sw = Math.max(8, r.w * v.videoWidth), sh = Math.max(8, r.h * v.videoHeight);
  const scale = sh < 110 ? Math.ceil(110 / sh) : 1;
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.filter = 'grayscale(1) contrast(1.3)';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
}

/** Mostra o quadro atual do vídeo num canvas (para o usuário marcar a região). */
export function frameToCanvas(canvas: HTMLCanvasElement, v: HTMLVideoElement): void {
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d')!.drawImage(v, 0, 0);
}

export async function scanChords(
  src: string,
  region: Region,
  opts: { step?: number; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<Observation[]> {
  const step = opts.step ?? SCAN_STEP;
  const base = import.meta.env.BASE_URL;
  const video = await loadVideo(src);
  if (!video.videoWidth) throw new Error('Este arquivo não tem imagem (é só áudio).');
  const duration = video.duration;

  const worker = await createWorker('eng', 1, {
    workerPath: `${base}ocr/worker.min.js`,
    corePath: `${base}ocr`,
    langPath: `${base}ocr`,
    gzip: true,
    cacheMethod: 'none',
  });
  try {
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGmb#M7956dimsua4+()/° ',
      tessedit_pageseg_mode: '7' as never,
    });
    const canvas = document.createElement('canvas');
    const small = document.createElement('canvas');
    small.width = 64;
    small.height = 16;
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    let prevPix: Uint8ClampedArray | null = null;
    let prevObs: Observation | null = null;
    const out: Observation[] = [];

    for (let t = 0; t < duration; t += step) {
      if (opts.signal?.aborted) throw new Error('Cancelado.');
      await seekTo(video, Math.min(t, duration - 0.05));
      cropTo(canvas, video, region);

      // Se a região quase não mudou desde a leitura anterior, reaproveita (muito mais rápido).
      sctx.drawImage(canvas, 0, 0, 64, 16);
      const pix = sctx.getImageData(0, 0, 64, 16).data;
      let diff = 0;
      if (prevPix) for (let i = 0; i < pix.length; i += 4) diff += Math.abs((pix[i] as number) - (prevPix[i] as number));
      prevPix = pix;
      const same = prevObs && diff / (pix.length / 4) < 3;

      const obs: Observation = same ? { t, chords: (prevObs as Observation).chords } : { t, chords: parseChordLine((await worker.recognize(canvas)).data.text) };
      prevObs = obs;
      out.push(obs);
      opts.onProgress?.(Math.min(1, t / duration));
    }
    return out;
  } finally {
    await worker.terminate();
    video.removeAttribute('src');
    video.load();
  }
}
