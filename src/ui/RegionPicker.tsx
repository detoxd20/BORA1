import { useEffect, useRef, useState } from 'react';
import { frameToCanvas, type Region } from '../songs/ocr';

interface Props {
  video: HTMLVideoElement;
  initial: Region;
  onConfirm: (r: Region) => void;
  onCancel: () => void;
}

/** Mostra o quadro atual do vídeo e deixa o usuário arrastar um retângulo em volta dos acordes. */
export function RegionPicker({ video, initial, onConfirm, onCancel }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [r, setR] = useState<Region>(initial);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (canvas.current) frameToCanvas(canvas.current, video);
  }, [video]);

  const pos = (e: React.PointerEvent) => {
    const b = (box.current as HTMLDivElement).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
    };
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-label="Marcar onde estão os acordes">
        <div className="sheet-head">
          <h2>Onde estão os acordes?</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Fechar">✕</button>
        </div>
        <p className="muted small">
          Pause o vídeo num momento em que os nomes dos acordes apareçam, volte aqui e arraste um retângulo em volta
          <b> só dos nomes</b> (G, F#m, B7…). Quanto mais justo, melhor.
        </p>
        <div
          className="picker"
          ref={box}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            start.current = pos(e);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = pos(e), s = start.current;
            setR({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
          }}
          onPointerUp={() => (start.current = null)}
        >
          <canvas ref={canvas} />
          <div className="picker-rect" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} disabled={r.w < 0.05 || r.h < 0.01} onClick={() => onConfirm(r)}>
          Ler acordes do vídeo
        </button>
      </div>
    </div>
  );
}
