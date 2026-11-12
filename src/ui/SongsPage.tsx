import { useCallback, useEffect, useRef, useState } from 'react';
import { CHORD_TYPES, chordName } from '../chords/models';
import { cleanEvents, CLEAN_LEVELS, type CleanLevel } from '../chords/analyzer';
import { deleteSong, exportBackup, getBlob, getMeta, importBackup, listSongs, newId, requestPersistence, saveSong, type SongMeta } from '../storage/library';
import { NOTE_NAMES } from '../chords/notes';
import { analyzeInWorker, decodeToMono } from '../songs/analyzeFile';
import { DEFAULT_REGION, SCAN_STEP, findChordRegion, scanChords, type Region } from '../songs/ocr';
import { buildVocabulary, chordsPerFrame, fillFromVideo, type VocabSegment } from '../songs/vocabulary';
import { RegionPicker } from './RegionPicker';
import { VocabEditor } from './VocabEditor';
import { GameScreen } from './GameScreen';
import { ShapePicker } from './ShapePicker';
import { loadShapePrefs, saveShapePref } from '../storage/shapePrefs';
import { activeIndex, fmtTime, type ChordEvent } from '../songs/types';
import { insertChord, mergeRepeats, moveEnd, moveStart, removeChord, retypeChord } from '../songs/edit';
import { nearestOnset } from '../audio/onsets';

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
  const [gaming, setGaming] = useState(false);
  const [shaping, setShaping] = useState(false);
  const [stage, setStage] = useState<'find' | 'read'>('read');
  const [ocrNote, setOcrNote] = useState('');
  const video = useRef<HTMLMediaElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const loadedRef = useRef(false);
  const copyTried = useRef(false);
  const stuckTimer = useRef<number>(0);
  const [audioOnly, setAudioOnly] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const history = useRef<ChordEvent[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [backupNote, setBackupNote] = useState('');
  const events = song?.events ?? [];
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const refresh = useCallback(() => void listSongs().then(setLibrary).catch(() => setLibrary([])), []);
  useEffect(() => {
    refresh();
    void requestPersistence().then(setPersisted);
  }, [refresh]);

  const close = () => {
    if (url) URL.revokeObjectURL(url);
    setUrl('');
    setSong(null);
    setStatus('idle');
    setEditing(null);
    setCur(-1);
    history.current = [];
    setUndoCount(0);
    // espera os salvamentos pendentes antes de reler a biblioteca
    void saveChain.current.then(refresh);
  };

  /** Salva NA HORA (em fila, para manter a ordem). Cada edição pode ser desfeita. */
  const commit = (next: SongMeta, opts: { noHistory?: boolean } = {}) => {
    if (song && !opts.noHistory && next.events !== song.events) {
      history.current.push(song.events);
      if (history.current.length > 40) history.current.shift();
      setUndoCount(history.current.length);
    }
    setSong(next);
    setSaved(false);
    const snapshot = { ...next, updatedAt: Date.now() };
    saveChain.current = saveChain.current
      .then(() => saveSong(snapshot))
      .then(() => setSaved(true))
      .catch(() => setError('Não consegui salvar as alterações. Faça um backup (Biblioteca → Exportar).'));
  };

  const undo = () => {
    const prev = history.current.pop();
    setUndoCount(history.current.length);
    if (prev && song) commit({ ...song, events: prev, edited: true }, { noHistory: true });
  };

  const runAnalysis = useCallback(async (file: Blob, base: SongMeta, level: CleanLevel) => {
    setError('');
    try {
      setStatus('decoding');
      setProgress(0);
      const { samples, sampleRate } = await decodeToMono(file as File);
      setStatus('analyzing');
      const { events: raw, onsets } = await analyzeInWorker(samples, sampleRate, setProgress, base.vocab);
      const meta: SongMeta = { ...base, raw, onsets, events: cleanEvents(raw, CLEAN_LEVELS[level]), cleanLevel: level, edited: false, updatedAt: Date.now() };
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
    blobRef.current = blob;
    setMediaErr('');
    copyTried.current = false;
    setAudioOnly(false);
    setUrl(URL.createObjectURL(blob));
    setSong(base);
    setCur(-1);
    void runAnalysis(blob, base, 'medio');
  };

  const open = async (listed: SongMeta) => {
    const meta = (await getMeta(listed.id)) ?? listed; // sempre a versão mais recente do banco, não a da lista
    const blob = await getBlob(meta.id);
    if (!blob) {
      setError('O arquivo desta música não está mais guardado. Apague-a e carregue de novo.');
      return;
    }
    setError('');
    setMediaErr('');
    copyTried.current = false;
    setAudioOnly(false);
    blobRef.current = typed(blob, meta.name, meta.type);
    setUrl(URL.createObjectURL(blobRef.current));
    setSong(meta);
    setSaved(true);
    setStatus('ready');
  };

  /** Texto de diagnóstico do player (para mostrar e para copiar e me mandar). */
  const mediaDiag = (): string => {
    const v = video.current as HTMLVideoElement | null;
    const type = song?.type || (song ? MIME[song.name.split('.').pop()?.toLowerCase() ?? ''] : '') || '?';
    return [
      `arquivo: ${song?.name ?? '?'} · tipo ${type} · ${song ? (song.size / 1048576).toFixed(1) : '?'} MB`,
      `o celular diz que ${v?.canPlayType?.(type) ? `consegue tocar este tipo (${v.canPlayType(type)})` : 'NÃO consegue tocar este tipo'}`,
      `readyState ${v?.readyState} · networkState ${v?.networkState} · código de erro ${v?.error?.code ?? '-'}`,
      `imagem ${v?.videoWidth ?? 0}x${v?.videoHeight ?? 0} · duração ${v?.duration ?? '?'}`,
      `navegador: ${navigator.userAgent.slice(0, 110)}`,
    ].join('\n');
  };

  const showFail = (why: string) => setMediaErr(`${why}\n\n${mediaDiag()}`);

  /** Plano B: copia o arquivo para a memória e recria o endereço do vídeo. */
  const reloadVideo = async () => {
    if (!song) return;
    // Na 1ª carga o arquivo ainda não está no banco (só depois da análise): usa o que está em memória.
    const stored = blobRef.current ?? (await getBlob(song.id));
    if (!stored) return;
    const copy = typed(new Blob([await stored.arrayBuffer()], { type: stored.type }), song.name, song.type);
    if (url) URL.revokeObjectURL(url);
    setMediaErr('');
    setUrl(URL.createObjectURL(copy));
  };

  /** Falhou? Tenta sozinho o plano B (uma vez por música); se falhar de novo, mostra o diagnóstico. */
  const onMediaProblem = (why: string) => {
    if (!copyTried.current) {
      copyTried.current = true;
      void reloadVideo();
    } else showFail(why);
  };

  // Vigia: se em 6 s o vídeo não carregou nada, é problema
  useEffect(() => {
    if (!url) return;
    loadedRef.current = false;
    const t = window.setTimeout(() => {
      if (!loadedRef.current) onMediaProblem('O vídeo não carregou.');
    }, 6000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  /** Refaz a análise de áudio restrita à lista de acordes do vídeo. */
  const analyzeWithVocab = async (base: SongMeta, vocab: VocabSegment[], region: Region | undefined, oneAtATime: boolean, note: string) => {
    const blob = await getBlob(base.id);
    if (!blob) throw new Error('O arquivo desta música não está mais guardado.');
    setStatus('decoding');
    const { samples, sampleRate } = await decodeToMono(typed(blob, base.name, base.type) as File);
    setStatus('analyzing');
    setProgress(0);
    const { events: raw, onsets } = await analyzeInWorker(samples, sampleRate, setProgress, vocab);
    const level = (base.cleanLevel as CleanLevel) in CLEAN_LEVELS ? (base.cleanLevel as CleanLevel) : 'medio';
    const cleaned = cleanEvents(raw, CLEAN_LEVELS[level]);
    const meta: SongMeta = { ...base, raw, onsets, events: normalize(mergeRepeats(oneAtATime ? fillFromVideo(cleaned, vocab) : cleaned)), vocab, region, oneAtATime, edited: false, updatedAt: Date.now() };
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
      const region = await findChordRegion((video.current as HTMLVideoElement | null) ?? url, { onProgress: setProgress });
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
      const obs = await scanChords((video.current as HTMLVideoElement | null) ?? url, region, { onProgress: setProgress });
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
    commit({ ...song, cleanLevel: level, events: cleanEvents(song.raw, CLEAN_LEVELS[level]), edited: false });
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

  const attachFile = async (meta: SongMeta, f: File | undefined) => {
    if (!f) return;
    if (meta.size && f.size !== meta.size && !window.confirm('Este arquivo tem tamanho diferente do original; os tempos dos acordes podem não bater. Usar mesmo assim?')) return;
    await saveSong({ ...meta, needsFile: false, size: f.size, type: f.type || meta.type }, typed(f, f.name, f.type));
    refresh();
  };

  const doExport = async () => {
    const blob = new Blob([await exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cavaco-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setBackupNote('Backup salvo na pasta Downloads. Guarde esse arquivo: ele traz todos os seus acordes.');
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await importBackup(await f.text());
      setBackupNote(`Backup importado: ${r.added} música(s) nova(s), ${r.updated} atualizada(s). As novas pedem para escolher o vídeo de novo.`);
      refresh();
    } catch (e) {
      setBackupNote(e instanceof Error ? e.message : 'Não consegui ler o backup.');
    }
  };

  const backupBar = (
    <div className="backup">
      <p className="muted small">
        {persisted === null ? '' : persisted
          ? '💾 Armazenamento protegido neste aparelho.'
          : '⚠ O navegador pode apagar os dados do app. Instale na tela inicial (menu ⋮ → Adicionar à tela inicial), abra sempre pelo ícone e faça backup.'}
      </p>
      <div className="toolbar">
        <button className="chip" onClick={() => void doExport()} disabled={library.length === 0}>Exportar backup</button>
        <label className="chip">
          Importar backup
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      {backupNote && <p className="muted small">{backupNote}</p>}
    </div>
  );

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
            {backupBar}
          </div>
        ) : (
          <div className="library">
            {error && <p className="error">{error}</p>}
            {library.map((m) => (
              <div key={m.id} className="lib-row">
                {m.needsFile ? (
                  <label className="lib-open">
                    <span className="lib-name">{m.name}</span>
                    <span className="muted small">{m.events.length} acordes · <b>falta o vídeo: toque para escolher o arquivo</b></span>
                    <input type="file" accept="video/*,audio/*" hidden onChange={(e) => { void attachFile(m, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                ) : (
                  <button className="lib-open" onClick={() => void open(m)}>
                    <span className="lib-name">{m.name}</span>
                    <span className="muted small">{m.events.length} acordes · {(m.size / 1048576).toFixed(1)} MB · salvo {new Date(m.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                )}
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
            {backupBar}
          </div>
        )
      ) : (
        <div className="song">
          {audioOnly ? (
            <audio ref={video as never} src={url} controls preload="auto" className="video audio-only" onLoadedData={() => (loadedRef.current = true)} onError={() => showFail('Nem o áudio tocou.')} />
          ) : (
            <video
              ref={video as never}
              src={url}
              controls={!gaming}
              playsInline
              preload="auto"
              className={gaming ? 'video game-bg' : 'video'}
              onLoadedData={() => {
                loadedRef.current = true;
                setMediaErr('');
              }}
              onError={(e) => {
                const code = e.currentTarget.error?.code ?? 0;
                onMediaProblem(`Erro ${code}: ${MEDIA_ERRORS[code] ?? 'falha desconhecida'}.`);
              }}
              onPlay={() => {
                window.clearTimeout(stuckTimer.current);
                // deu play e o tempo não andou em 5 s → travado
                stuckTimer.current = window.setTimeout(() => onMediaProblem('O vídeo não anda ao tocar.'), 5000);
              }}
              onTimeUpdate={() => {
                window.clearTimeout(stuckTimer.current);
                if (mediaErr) setMediaErr('');
              }}
              onPause={() => window.clearTimeout(stuckTimer.current)}
            />
          )}
          {mediaErr && (
            <div className="progress-card">
              <p className="error">O vídeo não tocou.</p>
              <pre className="diag">{mediaErr}</pre>
              <p className="muted small">Os acordes continuam valendo. Você pode ouvir só o áudio e seguir o jogo pelos acordes.</p>
              <div className="toolbar">
                <button className="chip" onClick={() => void reloadVideo()}>Tentar de novo</button>
                {!audioOnly && <button className="chip accent" onClick={() => { setMediaErr(''); setAudioOnly(true); }}>Tocar só o áudio</button>}
                <button className="chip" onClick={() => void navigator.clipboard?.writeText(mediaErr)}>Copiar diagnóstico</button>
              </div>
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
              <div className="two-btn">
                <button className="btn primary play" onClick={() => { video.current?.pause(); setGaming(true); }} disabled={events.length === 0}>
                  🎮 Jogar
                </button>
                <button className="btn play" style={{ fontSize: 16 }} onClick={() => { video.current?.pause(); setShaping(true); }} disabled={events.length === 0}>
                  🎸 Formas
                </button>
              </div>

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
                <button
                  className={`chip ${follow ? 'on' : ''}`}
                  onClick={() => {
                    setFollow((f) => !f);
                    if (!follow && cur >= 0) centerOn(cur, true);
                  }}
                >
                  {follow ? 'Seguindo ✓' : 'Seguir'}
                </button>
                <button className="chip" onClick={undo} disabled={undoCount === 0}>
                  ↶ Desfazer{undoCount > 0 ? ` (${undoCount})` : ''}
                </button>
                <button
                  className="chip"
                  onClick={() => {
                    const t = video.current?.currentTime ?? 0;
                    const r = insertChord(events, t);
                    if (song) commit({ ...song, events: r.events, edited: true });
                    startEditing(r.index);
                  }}
                >
                  + Acorde aqui
                </button>
              </div>
              <p className="muted small"><b>{saved ? 'Salvo ✓' : 'Salvando…'}</b></p>

              <details className="tools">
                <summary>🛠 Ferramentas de edição</summary>
              <div className="seg three" role="group" aria-label="Limpeza de falsos acordes">
                {(['suave', 'medio', 'forte'] as const).map((l) => (
                  <button key={l} className={song.cleanLevel === l ? 'on' : ''} onClick={() => setLevel(l)}>
                    {l === 'suave' ? 'Limpeza suave' : l === 'medio' ? 'Média' : 'Forte'}
                  </button>
                ))}
              </div>
                <p className="muted small">Voz ou batida virando acorde? Aumente a limpeza. Faltando acordes? Diminua.</p>
                <div className="toolbar">
                <button className="chip accent" disabled={audioOnly} onClick={() => void autoRead()}>
                  Ler acordes do vídeo
                </button>
                <button className="chip" disabled={audioOnly} onClick={() => { video.current?.pause(); setPicking(true); }}>
                  Ajustar região
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
                </div>
              </details>
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

      {shaping && song && (
        <ShapePicker
          events={events}
          chosen={{ ...loadShapePrefs(), ...(song.shapes ?? {}) }}
          onPick={(key, frets) => {
            saveShapePref(key, frets); // padrão para as outras músicas
            commit({ ...song, shapes: { ...(song.shapes ?? {}), [key]: frets } }, { noHistory: true });
          }}
          onClose={() => setShaping(false)}
        />
      )}

      {gaming && <div className="game-backdrop" />}
      {gaming && song && <GameScreen key={audioOnly ? "a" : "v"} song={song} media={video} problem={mediaErr} onAudioOnly={audioOnly ? undefined : () => { setMediaErr(''); setAudioOnly(true); }} onClose={() => setGaming(false)} />}

      {picking && video.current && (
        <RegionPicker video={video.current as HTMLVideoElement} initial={song?.region ?? DEFAULT_REGION} onConfirm={(r) => void readFromVideo(r)} onCancel={() => setPicking(false)} />
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
            <button
              className="btn"
              style={{ marginTop: 8, maxWidth: 'none' }}
              disabled={!song?.onsets?.length}
              onClick={() => {
                const o = song?.onsets ? nearestOnset(song.onsets, ed.start, 1) : null;
                if (o && editing !== null) update(moveStart(events, editing, o.t));
              }}
            >
              🎯 Grudar na palhetada mais próxima
            </button>
            <h3>Tempo de fim</h3>
            <div className="nudge">
              <button className="pick" onClick={() => update(moveEnd(events, editing, ed.end - 0.1))}>−0,1 s</button>
              <button className="pick" onClick={() => seek(Math.max(0, ed.end - 0.05))}>Ir ao fim</button>
              <button className="pick" onClick={() => update(moveEnd(events, editing, ed.end + 0.1))}>+0,1 s</button>
              <button className="pick" onClick={() => update(moveEnd(events, editing, video.current?.currentTime ?? ed.end))}>Aqui</button>
            </div>
            <button
              className="btn danger"
              onClick={() => {
                if (editing === null) return;
                // O acorde anterior continua e ocupa o tempo; se for o mesmo acorde dos dois lados, viram um só.
                commit({ ...song!, events: removeChord(events, editing, 'prev'), edited: true });
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
