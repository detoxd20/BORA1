import { useCallback, useEffect, useRef, useState } from 'react';
import { CHORD_TYPES, chordName } from '../chords/models';
import { cleanEvents, CLEAN_LEVELS, type CleanLevel } from '../chords/analyzer';
import { deleteSong, getBlob, listSongs, newId, requestPersistence, saveSong, type SongMeta } from '../storage/library';
import { NOTE_NAMES } from '../chords/notes';
import { analyzeInWorker, decodeToMono } from '../songs/analyzeFile';
import { DEFAULT_REGION, SCAN_STEP, findChordRegion, scanChords, type Region } from '../songs/ocr';
import { buildVocabulary, chordsPerFrame, fillFromVideo, type VocabSegment } from '../songs/vocabulary';
import { RegionPicker } from './RegionPicker';
import { VocabEditor } from './VocabEditor';
import { activeIndex, fmtTime, type ChordEvent } from '../songs/types';
import { mergeRepeats, removeChord, retypeChord } from '../songs/edit';

const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
};

/** Blob com tipo explícito: o Android às vezes entrega arquivos sem tipo, e o <video> recusa. */
function typed(blob: Blob, name: string, declared: string): Blob {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const type = blob.type || declared || MIME[ext] || '';
  return type && type !== blob.type ? new Blob([blob], { type }) : blob;
}

const MEDIA_ERRORS: Record<number, string> = {
  1: 'a reprodução foi interrompida',
  2: 'erro de rede ao ler o arquivo',
  3: 'o vídeo está corrompido ou usa um formato que o celular não decodifica',
  4: 'o celular não consegue tocar este formato de vídeo (ex.: HEVC/H.265, MKV)',
};

type Status = 'idle' | 'decoding' | 'ocr' | 'analyzing' | 'ready' | 'error';

/** Mantém a lista ordenada e sem sobreposição de tempos. */
function normalize(list: ChordEvent[]): ChordEvent[] {
  const s = [...list].sort((a, b) => a.start - b.start);
  return s.map((e, i) => {
    const next = s[i + 1];
    return next && e.end > next.start ? { ...e, end: next.start } : e;
  });
}

export function SongsPage() {
  const [library, setLibrary] = useState<SongMeta[]>([]);
  const [song, setSong] = useState<SongMeta | null>(null);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [cur, setCur] = useState(-1);
  const [editing, setEditing] = useState<number | null>(null);
  const [saved, setSaved] = useState(true);
  const [mediaErr, setMediaErr] = useState('');
  const [follow, setFollow] = useState(true);
  const [picking, setPicking] = useState(false);
  const [vocabEdit, setVocabEdit] = useState(false);
  const [stage, setStage] = useState<'find' | 'read'>('read');
  const [ocrNote, setOcrNote] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number>(0);
  const events = song?.events ?? [];
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const refresh = useCallback(() => void listSongs().then(setLibrary).catch(() => setLibrary([])), []);
  useEffect(() => {
    refresh();
    void requestPersistence();
  }, [refresh]);

  const close = () => {
    window.clearTimeout(saveTimer.current);
    if (url) URL.revokeObjectURL(url);
    setUrl('');
    setSong(null);
    setStatus('idle');
    setEditing(null);
    setCur(-1);
    refresh();
  };

  /** Salva as edições logo após cada mudança. */
  const commit = (next: SongMeta, flushNow = false) => {
    setSong(next);
    setSaved(false);
    window.clearTimeout(saveTimer.current);
    const write = () => void saveSong({ ...next, updatedAt: Date.now() }).then(() => setSaved(true)).catch(() => setError('Não consegui salvar as alterações.'));
    if (flushNow) write();
    else saveTimer.current = window.setTimeout(write, 250);
  };

  // Garante o salvamento se o app for fechado/recarregado com edição pendente
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current && song) void saveSong({ ...song, updatedAt: Date.now() });
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [song]);

  const runAnalysis = useCallback(async (file: Blob, base: SongMeta, level: CleanLevel) => {
    setError('');
    try {
      setStatus('decoding');
      setProgress(0);
      const { samples, sampleRate } = await decodeToMono(file as File);
      setStatus('analyzing');
      const raw = await analyzeInWorker(samples, sampleRate, setProgress, base.vocab);
      const meta: SongMeta = { ...base, raw, events: cleanEvents(raw, CLEAN_LEVELS[level]), cleanLevel: level, edited: false, updatedAt: Date.now() };
      await saveSong(meta, file);
      setSong(meta);
      setSaved(true);
      setStatus('ready');
    } catch {
      setError('Não consegui ler o áudio deste arquivo. Tente um MP4 (H.264/AAC), MP3 ou WAV.');
      setStatus('error');
    }
  }, []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    const base: SongMeta = {
      id: newId(), name: f.name.replace(/\.[^.]+$/, ''), size: f.size, type: f.type,
      createdAt: Date.now(), updatedAt: Date.now(), raw: [], events: [], cleanLevel: 'medio',
    };
    base.type = f.type || MIME[f.name.split('.').pop()?.toLowerCase() ?? ''] || '';
    const blob = typed(f, f.name, f.type);
    setMediaErr('');
    setUrl(URL.createObjectURL(blob));
    setSong(base);
    setCur(-1);
    void runAnalysis(blob, base, 'medio');
  };

  const open = async (meta: SongMeta) => {
    const blob = await getBlob(meta.id);
    if (!blob) {
      setError('O arquivo desta música não está mais guardado. Apague-a e carregue de novo.');
      return;
    }
    setError('');
    setMediaErr('');
    setUrl(URL.createObjectURL(typed(blob, meta.name, meta.type)));
    setSong(meta);
    setSaved(true);
    setStatus('ready');
  };

  /** Plano B: copia o arquivo para a memória e recria o endereço do vídeo. */
  const reloadVideo = async () => {
    if (!song) return;
    const stored = await getBlob(song.id);
    if (!stored) return;
    const copy = typed(new Blob([await stored.arrayBuffer()], { type: stored.type }), song.name, song.type);
    if (url) URL.revokeObjectURL(url);
    setMediaErr('');
    setUrl(URL.createObjectURL(copy));
  };

  /** Refaz a análise de áudio restrita à lista de acordes do vídeo. */
  const analyzeWithVocab = async (base: SongMeta, vocab: VocabSegment[], region: Region | undefined, oneAtATime: boolean, note: string) => {
    const blob = await getBlob(base.id);
    if (!blob) throw new Error('O arquivo desta música não está mais guardado.');
    setStatus('decoding');
    const { samples, sampleRate } = await decodeToMono(typed(blob, base.name, base.type) as File);
    setStatus('analyzing');
    setProgress(0);
    const raw = await analyzeInWorker(samples, sampleRate, setProgress, vocab);
    const level = (base.cleanLevel as CleanLevel) in CLEAN_LEVELS ? (base.cleanLevel as CleanLevel) : 'medio';
    const cleaned = cleanEvents(raw, CLEAN_LEVELS[level]);
    const meta: SongMeta = { ...base, raw, events: normalize(mergeRepeats(oneAtATime ? fillFromVideo(cleaned, vocab) : cleaned)), vocab, region, oneAtATime, edited: false, updatedAt: Date.now() };
    await saveSong(meta);
    setSong(meta);
    setSaved(true);
    setOcrNote(note);
    setStatus('ready');
  };

  /** Um toque: acha sozinho onde ficam os acordes, lê o vídeo todo e concilia com o áudio. */
  const autoRead = async () => {
    if (!song) return;
    if (song.edited && !window.confirm('Isso refaz a lista e descarta os ajustes que você fez à mão. Continuar?')) return;
    video.current?.pause();
    setError('');
    setOcrNote('');
    try {
      setStage('find');
      setStatus('ocr');
      setProgress(0);
      const region = await findChordRegion(url, { onProgress: setProgress });
      if (!region) {
        setStatus('ready');
        setOcrNote('Não consegui achar sozinho onde os acordes aparecem. Marque a região na tela.');
        setPicking(true);
        return;
      }
      await readFromVideo(region, true);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Não consegui ler os acordes do vídeo.');
      setStatus('ready');
    }
  };

  /** Lê os acordes escritos no vídeo e refaz a análise de áudio só entre eles. */
  const readFromVideo = async (region: Region, auto = false) => {
    if (!song) return;
    setPicking(false);
    if (!auto && song.edited && !window.confirm('Isso refaz a lista e descarta os ajustes que você fez à mão. Continuar?')) return;
    video.current?.pause();
    setError('');
    setOcrNote('');
    try {
      setStage('read');
      setStatus('ocr');
      setProgress(0);
      const obs = await scanChords(url, region, { onProgress: setProgress });
      const vocab = buildVocabulary(obs, { step: SCAN_STEP });
      if (vocab.length === 0) {
        setStatus('ready');
        setOcrNote('Não consegui ler nenhum acorde nessa região. Marque de novo, mais justo em volta dos nomes.');
        return;
      }
      const oneAtATime = chordsPerFrame(obs) <= 1;
      await analyzeWithVocab(
        song, vocab, region, oneAtATime,
        `${auto ? 'Achei a faixa de acordes sozinho (se estiver errada, toque em Ajustar região). ' : ''}${oneAtATime ? 'O vídeo mostra um acorde por vez.' : 'O vídeo mostra uma lista de acordes.'} Onde a faixa não aparece no começo e no fim, nenhum acorde é aceito. Faltou ou sobrou acorde? Toque em "Acordes do vídeo" para corrigir a lista.`,
      );
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Não consegui ler os acordes do vídeo.');
      setStatus('ready');
    }
  };

  /** Corrige a lista de acordes lida do vídeo (remove falsos / adiciona os que faltaram) e refaz a análise. */
  const applyVocabEdit = async (names: Array<{ key: string; name: string }>) => {
    if (!song?.vocab) return;
    setVocabEdit(false);
    const keep = new Set(names.map((n) => n.key));
    const vocab = song.vocab
      .map((v) => {
        const ordered = names.filter((n) => keep.has(n.key));
        return { ...v, keys: ordered.map((n) => n.key), names: ordered.map((n) => n.name) };
      })
      .filter((v) => v.keys.length > 0);
    if (song.edited && !window.confirm('Isso refaz a lista e descarta os ajustes que você fez à mão. Continuar?')) return;
    try {
      await analyzeWithVocab(song, vocab, song.region, !!song.oneAtATime, 'Lista de acordes do vídeo atualizada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não consegui refazer a análise.');
      setStatus('ready');
    }
  };

  const update = (next: ChordEvent[]) => {
    if (song) commit({ ...song, events: normalize(next), edited: true });
  };

  const setLevel = (level: CleanLevel) => {
    if (!song) return;
    if (song.edited && !window.confirm('Mudar a limpeza refaz a lista e descarta os ajustes que você fez à mão. Continuar?')) return;
    commit({ ...song, cleanLevel: level, events: cleanEvents(song.raw, CLEAN_LEVELS[level]), edited: false }, true);
  };

  const reanalyze = async () => {
    if (!song) return;
    if (song.edited && !window.confirm('Analisar de novo descarta os ajustes que você fez à mão. Continuar?')) return;
    const blob = await getBlob(song.id);
    if (blob) void runAnalysis(blob, song, (song.cleanLevel as CleanLevel) in CLEAN_LEVELS ? (song.cleanLevel as CleanLevel) : 'medio');
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

  // Rola só a lista (não a página) para o acorde atual — e só se estiver seguindo e sem editar
  const centerOn = useCallback((i: number, smooth: boolean) => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!list || !el) return;
    list.scrollTo({ top: el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
  }, []);
  useEffect(() => {
    if (cur >= 0 && follow && editing === null) centerOn(cur, true);
  }, [cur, follow, editing, centerOn]);

  const startEditing = (i: number) => {
    video.current?.pause();
    setEditing(i);
  };

  const seek = (t: number) => {
    if (video.current) video.current.currentTime = Math.max(0, t);
  };

  const now = cur >= 0 ? events[cur] : undefined;
  const next = cur >= 0 ? events[cur + 1] : events[0];
  const ed = editing !== null ? events[editing] : undefined;

  const setChord = (i: number, root: number, typeId: string) => {
    const type = CHORD_TYPES.find((t) => t.id === typeId)!;
    const r = retypeChord(events, i, { root, typeId, name: chordName(root, type) });
    if (!song) return;
    commit({ ...song, events: r.events, edited: true });
    setEditing(r.index); // se virou um bloco só com o vizinho, segue editando o bloco
  };

  return (
    <>
      <header className="top">
        <h1 className="title static">{song ? song.name : 'Músicas'}</h1>
        {song ? (
          <button className="chip" onClick={close}>Biblioteca</button>
        ) : (
          <label className="chip">
            + Novo
            <input type="file" accept="video/*,audio/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        )}
      </header>

      {!song ? (
        library.length === 0 ? (
          <div className="start">
            <div className="start-icon" aria-hidden>🎬</div>
            <h2>Carregue a videoaula</h2>
            <p className="muted">
              Escolha um vídeo ou áudio do seu aparelho. O app descobre os acordes e os tempos sozinho, e você ajusta o que
              precisar. O arquivo fica guardado no app, e nada é enviado para a internet.
            </p>
            <label className="btn primary center">
              Escolher arquivo
              <input type="file" accept="video/*,audio/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <p className="muted small">Use fones ao tocar junto: o som do vídeo atrapalha o microfone.</p>
            {error && <p className="error">{error}</p>}
          </div>
        ) : (
          <div className="library">
            {error && <p className="error">{error}</p>}
            {library.map((m) => (
              <div key={m.id} className="lib-row">
                <button className="lib-open" onClick={() => void open(m)}>
                  <span className="lib-name">{m.name}</span>
                  <span className="muted small">{m.events.length} acordes · {(m.size / 1048576).toFixed(1)} MB</span>
                </button>
                <button
                  className="row-edit"
                  aria-label={`Apagar ${m.name}`}
                  onClick={() => {
                    if (window.confirm(`Apagar "${m.name}" e os acordes dela?`)) void deleteSong(m.id).then(refresh);
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="song">
          <video
            ref={video}
            src={url}
            controls
            playsInline
            preload="auto"
            className="video"
            onError={(e) => {
              const code = e.currentTarget.error?.code ?? 0;
              setMediaErr(`Erro ${code}: ${MEDIA_ERRORS[code] ?? 'falha desconhecida'}.`);
            }}
          />
          {mediaErr && (
            <div className="progress-card">
              <p className="error">O vídeo não tocou. {mediaErr}</p>
              <p className="muted small">Os acordes continuam valendo. Se o formato não é suportado, converta o vídeo para MP4 (H.264) e carregue de novo.</p>
              <button className="chip" onClick={() => void reloadVideo()}>Tentar de novo</button>
            </div>
          )}

          {(status === 'decoding' || status === 'analyzing' || status === 'ocr') && (
            <div className="progress-card">
              <div className="dbg-row">
                <span>{status === 'decoding' ? 'Lendo o áudio…' : status === 'ocr' ? (stage === 'find' ? 'Procurando onde os acordes aparecem…' : 'Lendo os acordes escritos no vídeo…') : 'Descobrindo os acordes…'}</span>
                <b>{status !== 'decoding' ? `${Math.round(progress * 100)}%` : ''}</b>
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

              <div className="seg three" role="group" aria-label="Limpeza de falsos acordes">
                {(['suave', 'medio', 'forte'] as const).map((l) => (
                  <button key={l} className={song.cleanLevel === l ? 'on' : ''} onClick={() => setLevel(l)}>
                    {l === 'suave' ? 'Limpeza suave' : l === 'medio' ? 'Média' : 'Forte'}
                  </button>
                ))}
              </div>
              <p className="muted small">
                Voz ou batida virando acorde? Aumente a limpeza. Faltando acordes? Diminua.
                {' '}<b>{saved ? 'Salvo ✓' : 'Salvando…'}</b>
              </p>

              <div className="toolbar">
                <button
                  className={`chip ${follow ? 'on' : ''}`}
                  onClick={() => {
                    setFollow((f) => !f);
                    if (!follow && cur >= 0) centerOn(cur, true);
                  }}
                >
                  {follow ? 'Seguindo ✓' : 'Seguir'}
                </button>
                <button className="chip" onClick={() => void reanalyze()}>Analisar de novo</button>
                <button
                  className="chip"
                  onClick={() => {
                    const t = video.current?.currentTime ?? 0;
                    update(events.filter((e) => e.end > t).map((e) => (e.start < t ? { ...e, start: t } : e)));
                  }}
                >
                  ✂ Apagar antes daqui
                </button>
                <button
                  className="chip"
                  onClick={() => {
                    const t = video.current?.currentTime ?? 0;
                    update(events.filter((e) => e.start < t).map((e) => (e.end > t ? { ...e, end: t } : e)));
                  }}
                >
                  ✂ Apagar depois daqui
                </button>
                <button className="chip accent" onClick={() => void autoRead()}>
                  Ler acordes do vídeo
                </button>
                <button className="chip" onClick={() => { video.current?.pause(); setPicking(true); }}>
                  Ajustar região
                </button>
                <button
                  className="chip"
                  onClick={() => {
                    const t = video.current?.currentTime ?? 0;
                    const n = normalize([...events, { start: t, end: t + 2, name: 'C', root: 0, typeId: 'maj', confidence: 1 }]);
                    update(n);
                    startEditing(n.findIndex((e) => e.start === t));
                  }}
                >
                  + Acorde aqui
                </button>
              </div>
              {ocrNote && <p className="muted small">{ocrNote}</p>}
              {error && <p className="error small">{error}</p>}
              {song.vocab && song.vocab.length > 0 && (
                <button className="vocab-btn" onClick={() => { video.current?.pause(); setVocabEdit(true); }}>
                  <span className="muted small">ACORDES DO VÍDEO (toque para corrigir)</span>
                  <span className="vocab-names">{[...new Set(song.vocab.flatMap((v) => v.names))].join(' · ')}</span>
                </button>
              )}
              {events.length === 0 && (
                <p className="muted">Nenhum acorde passou pela limpeza. Tente "Limpeza suave".</p>
              )}

              <div className="timeline" ref={listRef} onPointerDown={() => setFollow(false)} onWheel={() => setFollow(false)}>
                {events.map((e, i) => (
                  <div key={`${e.start}-${i}`} data-i={i} className={`row ${i === cur ? 'cur' : ''}`}>
                    <button className="row-time" onClick={() => seek(e.start)}>{fmtTime(e.start)}</button>
                    <span className="row-chord">{e.name}</span>
                    <span className={`dot ${e.confidence < 0.7 ? 'low' : ''}`} title={`confiança ${Math.round(e.confidence * 100)}%`} />
                    <button className="row-edit" onClick={() => startEditing(i)} aria-label={`Editar ${e.name}`}>✎</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {picking && video.current && (
        <RegionPicker video={video.current} initial={song?.region ?? DEFAULT_REGION} onConfirm={(r) => void readFromVideo(r)} onCancel={() => setPicking(false)} />
      )}

      {vocabEdit && song?.vocab && (
        <VocabEditor
          initial={[...new Map(song.vocab.flatMap((v) => v.keys.map((k, i) => [k, { key: k, name: v.names[i] ?? k }] as const))).values()]}
          onCancel={() => setVocabEdit(false)}
          onApply={(n) => void applyVocabEdit(n)}
        />
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
            <h3>Apagar este acorde</h3>
            <p className="muted small">O tempo dele não fica vazio: um vizinho ocupa o lugar.</p>
            <button
              className="btn danger"
              onClick={() => {
                if (editing === null) return;
                commit({ ...song!, events: removeChord(events, editing, 'prev'), edited: true });
                setEditing(null);
              }}
            >
              Apagar — o anterior continua{events[editing - 1] ? ` (${events[editing - 1]!.name})` : ''}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (editing === null) return;
                commit({ ...song!, events: removeChord(events, editing, 'next'), edited: true });
                setEditing(null);
              }}
            >
              Apagar — o próximo começa antes{events[editing + 1] ? ` (${events[editing + 1]!.name})` : ''}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
