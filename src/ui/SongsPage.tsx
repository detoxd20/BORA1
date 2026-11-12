import { useCallback, useEffect, useRef, useState } from 'react';
import { CHORD_TYPES, chordName } from '../chords/models';
import { NOTE_NAMES } from '../chords/notes';
import { analyzeInWorker, decodeToMono } from '../songs/analyzeFile';
import { activeIndex, fileKey, fmtTime, loadEvents, saveEvents, type ChordEvent } from '../songs/types';

type Status = 'idle' | 'decoding' | 'analyzing' | 'ready' | 'error';

/** Mantém a lista ordenada e sem sobreposição de tempos. */
function normalize(list: ChordEvent[]): ChordEvent[] {
  const s = [...list].sort((a, b) => a.start - b.start);
  return s.map((e, i) => {
    const next = s[i + 1];
    return next && e.end > next.start ? { ...e, end: next.start } : e;
  });
}

export function SongsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<ChordEvent[]>([]);
  const [cur, setCur] = useState(-1);
  const [editing, setEditing] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const keyRef = useRef('');
  const listRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const analyze = useCallback(async (f: File) => {
    setError('');
    try {
      setStatus('decoding');
      setProgress(0);
      const { samples, sampleRate } = await decodeToMono(f);
      setStatus('analyzing');
      const ev = await analyzeInWorker(samples, sampleRate, setProgress);
      setEvents(ev);
      saveEvents(keyRef.current, ev);
      setFromCache(false);
      setStatus('ready');
    } catch {
      setError('Não consegui ler o áudio deste arquivo. Tente um MP4 (H.264/AAC), MP3 ou WAV.');
      setStatus('error');
    }
  }, []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setEvents([]);
    setCur(-1);
    setEditing(null);
    keyRef.current = fileKey(f);
    const cached = loadEvents(keyRef.current);
    if (cached) {
      setEvents(cached);
      setFromCache(true);
      setStatus('ready');
    } else void analyze(f);
  };

  const update = (next: ChordEvent[]) => {
    const n = normalize(next);
    setEvents(n);
    saveEvents(keyRef.current, n);
  };

  // Acorde atual conforme o tempo do vídeo
  useEffect(() => {
    if (status !== 'ready') return;
    let raf = 0;
    let last = -2;
    const loop = () => {
      const v = video.current;
      if (v) {
        const i = activeIndex(eventsRef.current, v.currentTime);
        if (i !== last) {
          last = i;
          setCur(i);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // Rola a lista para o acorde atual
  useEffect(() => {
    if (cur < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cur]);

  const seek = (t: number) => {
    if (video.current) video.current.currentTime = Math.max(0, t);
  };

  const now = cur >= 0 ? events[cur] : undefined;
  const next = cur >= 0 ? events[cur + 1] : events[0];
  const ed = editing !== null ? events[editing] : undefined;

  const setChord = (i: number, root: number, typeId: string) => {
    const type = CHORD_TYPES.find((t) => t.id === typeId)!;
    update(events.map((e, k) => (k === i ? { ...e, root, typeId, name: chordName(root, type), confidence: 1 } : e)));
  };

  return (
    <>
      <header className="top">
        <h1 className="title static">Músicas</h1>
        {file && (
          <label className="chip">
            Trocar arquivo
            <input type="file" accept="video/*,audio/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        )}
      </header>

      {!file ? (
        <div className="start">
          <div className="start-icon" aria-hidden>🎬</div>
          <h2>Carregue a videoaula</h2>
          <p className="muted">
            Escolha um arquivo de vídeo ou áudio do seu aparelho. O app descobre os acordes e os tempos sozinho —
            depois você ajusta o que precisar. Tudo é feito no celular, nada é enviado.
          </p>
          <label className="btn primary center">
            Escolher arquivo
            <input type="file" accept="video/*,audio/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <p className="muted small">Use fones ao tocar junto: o som do vídeo atrapalha o microfone.</p>
        </div>
      ) : (
        <div className="song">
          <video ref={video} src={url} controls playsInline className="video" />

          {(status === 'decoding' || status === 'analyzing') && (
            <div className="progress-card">
              <div className="dbg-row">
                <span>{status === 'decoding' ? 'Lendo o áudio…' : 'Descobrindo os acordes…'}</span>
                <b>{status === 'analyzing' ? `${Math.round(progress * 100)}%` : ''}</b>
              </div>
              <div className="level"><div className="level-bar" style={{ width: `${status === 'decoding' ? 5 : progress * 100}%` }} /></div>
            </div>
          )}

          {status === 'error' && (
            <div className="progress-card">
              <p className="error">{error}</p>
            </div>
          )}

          {status === 'ready' && (
            <>
              <div className="now-next">
                <div className="now">
                  <small>AGORA</small>
                  <div className="chord-big">{now ? now.name : '—'}</div>
                </div>
                <div className="next">
                  <small>PRÓXIMO</small>
                  <div className="chord-mid">{next ? next.name : '—'}</div>
                </div>
              </div>

              <div className="toolbar">
                <button className="chip" onClick={() => file && void analyze(file)}>Analisar de novo</button>
                <button
                  className="chip"
                  onClick={() => {
                    const t = video.current?.currentTime ?? 0;
                    const n = normalize([...events, { start: t, end: t + 2, name: 'C', root: 0, typeId: 'maj', confidence: 1 }]);
                    setEvents(n);
                    saveEvents(keyRef.current, n);
                    setEditing(n.findIndex((e) => e.start === t));
                  }}
                >
                  + Acorde aqui
                </button>
              </div>
              {fromCache && <p className="muted small">Acordes salvos deste arquivo (com seus ajustes).</p>}
              {events.length === 0 && (
                <p className="muted">Não encontrei acordes. Tente um trecho com o instrumento mais evidente.</p>
              )}

              <div className="timeline" ref={listRef}>
                {events.map((e, i) => (
                  <div key={`${e.start}-${i}`} data-i={i} className={`row ${i === cur ? 'cur' : ''}`}>
                    <button className="row-time" onClick={() => seek(e.start)}>{fmtTime(e.start)}</button>
                    <span className="row-chord">{e.name}</span>
                    <span className={`dot ${e.confidence < 0.7 ? 'low' : ''}`} title={`confiança ${Math.round(e.confidence * 100)}%`} />
                    <button className="row-edit" onClick={() => setEditing(i)} aria-label={`Editar ${e.name}`}>✎</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {ed && editing !== null && (
        <div className="sheet-backdrop" onClick={() => setEditing(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Editar acorde">
            <div className="sheet-head">
              <h2>{ed.name} <small className="muted">{fmtTime(ed.start)}</small></h2>
              <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Fechar">✕</button>
            </div>
            <h3>Nota</h3>
            <div className="grid-12">
              {NOTE_NAMES.map((n, r) => (
                <button key={n} className={`pick ${ed.root === r ? 'on' : ''}`} onClick={() => setChord(editing, r, ed.typeId)}>{n}</button>
              ))}
            </div>
            <h3>Tipo</h3>
            <div className="grid-4">
              {CHORD_TYPES.map((t) => (
                <button key={t.id} className={`pick ${ed.typeId === t.id ? 'on' : ''}`} onClick={() => setChord(editing, ed.root, t.id)}>
                  {t.suffix || 'maior'}
                </button>
              ))}
            </div>
            <h3>Tempo de início</h3>
            <div className="nudge">
              <button className="pick" onClick={() => update(events.map((e, k) => (k === editing ? { ...e, start: Math.max(0, e.start - 0.1) } : e)))}>−0,1 s</button>
              <button className="pick" onClick={() => seek(ed.start)}>Ir ao ponto</button>
              <button className="pick" onClick={() => update(events.map((e, k) => (k === editing ? { ...e, start: e.start + 0.1 } : e)))}>+0,1 s</button>
              <button className="pick" onClick={() => update(events.map((e, k) => (k === editing ? { ...e, start: video.current?.currentTime ?? e.start } : e)))}>Aqui</button>
            </div>
            <button
              className="btn danger"
              onClick={() => {
                update(events.filter((_, k) => k !== editing));
                setEditing(null);
              }}
            >
              Apagar este acorde
            </button>
          </div>
        </div>
      )}
    </>
  );
}
