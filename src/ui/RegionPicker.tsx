import { useEffect, useRef, useState } from 'react';
import { ChordOcr, DEFAULT_REGION, frameToCanvas, type Region } from '../songs/ocr';

interface Props {
  video: HTMLVideoElement;
  initial: Region;
  onConfirm: (r: Region) => void;
  onCancel: () => void;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Drag = { kind: 'move'; dx: number; dy: number } | { kind: 'resize'; handle: Handle } | { kind: 'new'; sx: number; sy: number };

const MIN = 0.03;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Tela cheia: quadro do vídeo grande, retângulo com cantos arrastáveis (e que dá para mover),
 * deslizador de tempo para achar um quadro com os acordes, e leitura ao vivo do que há dentro do retângulo.
 */
export function RegionPicker({ video, initial, onConfirm, onCancel }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [r, setR] = useState<Region>(initial);
  const [t, setT] = useState(video.currentTime);
  const [frameN, setFrameN] = useState(0);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [ocrState, setOcrState] = useState<'loading' | 'ready' | 'error'>('loading');
  const ocr = useRef<ChordOcr | null>(null);
  const drag = useRef<Drag | null>(null);
  const startTime = useRef(video.currentTime);

  // Desenha o quadro atual
  useEffect(() => {
    if (canvas.current && video.videoWidth) frameToCanvas(canvas.current, video);
    setFrameN((n) => n + 1);
  }, [video, t]);

  // Troca de tempo → busca o quadro
  const seek = (value: number) => {
    setT(value);
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      if (canvas.current) frameToCanvas(canvas.current, video);
      setFrameN((n) => n + 1);
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = value;
  };

  // OCR ao vivo
  useEffect(() => {
    let dead = false;
    ChordOcr.create()
      .then((o) => {
        if (dead) return void o.terminate();
        ocr.current = o;
        setOcrState('ready');
        setFrameN((n) => n + 1);
      })
      .catch(() => !dead && setOcrState('error'));
    return () => {
      dead = true;
      void ocr.current?.terminate();
      ocr.current = null;
      video.currentTime = startTime.current;
    };
  }, [video]);

  useEffect(() => {
    if (ocrState !== 'ready' || !canvas.current) return;
    let stale = false;
    const id = window.setTimeout(async () => {
      try {
        const chords = await ocr.current?.readRegion(video, r);
        if (!stale && chords) setPreview(chords.map((c) => c.name));
      } catch {
        /* ignora leitura abortada */
      }
    }, 350);
    return () => {
      stale = true;
      window.clearTimeout(id);
    };
  }, [r, frameN, ocrState, video]);

  const pos = (e: React.PointerEvent) => {
    const b = (box.current as HTMLDivElement).getBoundingClientRect();
    return { x: clamp((e.clientX - b.left) / b.width), y: clamp((e.clientY - b.top) / b.height), tx: 32 / b.width, ty: 32 / b.height };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos(e);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const pts: Array<[Handle, number, number]> = [
      ['nw', r.x, r.y], ['n', cx, r.y], ['ne', r.x + r.w, r.y], ['e', r.x + r.w, cy],
      ['se', r.x + r.w, r.y + r.h], ['s', cx, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, cy],
    ];
    // Alça mais próxima do dedo (em pixels), dentro de ~34 px. Em retângulos finos, cantos de cima e de baixo ficam colados:
    // por isso escolhe a MAIS PRÓXIMA, e não a primeira que encontra.
    let best: Handle | null = null;
    let bestD = Infinity;
    for (const [h, hx, hy] of pts) {
      const d = Math.hypot((p.x - hx) / p.tx, (p.y - hy) / p.ty);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best && bestD <= 1.1) drag.current = { kind: 'resize', handle: best };
    else if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) drag.current = { kind: 'move', dx: p.x - r.x, dy: p.y - r.y };
    else drag.current = { kind: 'new', sx: p.x, sy: p.y };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pos(e);
    if (d.kind === 'move') {
      setR((o) => ({ ...o, x: Math.min(1 - o.w, Math.max(0, p.x - d.dx)), y: Math.min(1 - o.h, Math.max(0, p.y - d.dy)) }));
    } else if (d.kind === 'new') {
      setR({ x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.max(MIN, Math.abs(p.x - d.sx)), h: Math.max(MIN / 2, Math.abs(p.y - d.sy)) });
    } else {
      setR((o) => {
        let l = o.x, t = o.y, rr = o.x + o.w, bb = o.y + o.h;
        if (d.handle.includes('w')) l = p.x;
        if (d.handle.includes('e')) rr = p.x;
        if (d.handle.includes('n')) t = p.y;
        if (d.handle.includes('s')) bb = p.y;
        const x0 = Math.min(l, rr), x1 = Math.max(l, rr), y0 = Math.min(t, bb), y1 = Math.max(t, bb);
        return { x: x0, y: y0, w: Math.max(MIN, x1 - x0), h: Math.max(MIN / 2, y1 - y0) };
      });
    }
  };

  const dur = Number.isFinite(video.duration) ? video.duration : 0;

  return (
    <div className="picker-full" role="dialog" aria-label="Marcar onde estão os acordes">
      <div className="picker-top">
        <button className="chip" onClick={onCancel}>Cancelar</button>
        <b>Onde estão os acordes?</b>
        <span />
      </div>

      <div className="picker-body">
        <div className="picker" ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
          <canvas ref={canvas} />
          <div className="picker-rect" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
            <i className="h nw" /><i className="h n" /><i className="h ne" /><i className="h e" /><i className="h se" /><i className="h s" /><i className="h sw" /><i className="h w" />
          </div>
        </div>

        <label className="scrub">
          <span className="muted small">Ache um momento com os acordes na tela ({Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')})</span>
          <input type="range" min={0} max={dur || 1} step={0.25} value={t} onChange={(e) => seek(Number(e.target.value))} />
        </label>

        <div className="presets">
          <button className="chip" onClick={() => setR({ x: 0.05, y: 0.01, w: 0.9, h: 0.14 })}>Topo</button>
          <button className="chip" onClick={() => setR({ x: 0.05, y: 0.84, w: 0.9, h: 0.14 })}>Rodapé</button>
          <button className="chip" onClick={() => setR({ ...DEFAULT_REGION })}>Restaurar</button>
        </div>

        <div className="live">
          <small className="muted">LENDO AGORA NO RETÂNGULO</small>
          <div className="live-chords">
            {ocrState === 'loading' && <span className="muted">Preparando o leitor… (a 1ª vez baixa uns 7 MB)</span>}
            {ocrState === 'error' && <span className="error">Não consegui carregar o leitor de acordes.</span>}
            {ocrState === 'ready' && preview === null && <span className="muted">Lendo…</span>}
            {ocrState === 'ready' && preview !== null && preview.length === 0 && <span className="muted">Nada reconhecido. Ajuste o retângulo ou escolha outro momento.</span>}
            {preview?.map((n, i) => <span key={i} className="live-chip">{n}</span>)}
          </div>
        </div>
      </div>

      <div className="picker-foot">
        <button className="btn primary" disabled={r.w < MIN} onClick={() => onConfirm(r)}>
          Usar esta região
        </button>
      </div>
    </div>
  );
}
