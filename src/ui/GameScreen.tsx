import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SongMeta } from '../storage/library';
import { activeIndex } from '../songs/types';
import { CHORD_TYPES } from '../chords/models';
import { resolveShape, shapeKey } from '../chords/shapes';
import { getTuning } from '../tuner/tunings';
import { loadShapePrefs } from '../storage/shapePrefs';
import { ChordListener } from '../audio/chordListener';
import { drawHighway, LANE_COLORS, makeGeometry, SmoothClock, spawnSparks, stepParticles, type Flash, type GameChord, type Geometry, type Particle } from '../game/highway';
import { ScoreEngine, shapeTemplate, type Grade, type Judgement, type ScoreSummary, type Target } from '../game/scoring';
import { ChordDiagram, chordHue } from './ChordDiagram';
import { useWakeLock } from './useWakeLock';

interface Props {
  song: SongMeta;
  /** O MESMO player da tela da música (um só vídeo aberto: Android limita decodificadores simultâneos). */
  media: RefObject<HTMLMediaElement | null>;
  /** Mensagem de falha do player, se houver. */
  problem: string;
  onAudioOnly?: () => void;
  /** Resultado de uma partida completa com microfone. */
  onResult?: (r: { score: number; accuracy: number; stars: number }) => void;
  onClose: () => void;
}

type Phase = 'title' | 'count' | 'play' | 'paused' | 'ended';
const RATES = [0.5, 0.75, 1];
const LATENCY_KEY = 'cavaco:latencyMs';
const GRADE_TEXT: Record<Grade, { text: string; color: string }> = {
  perfeito: { text: 'PERFEITO!', color: '#ffd23f' },
  bom: { text: 'BOM!', color: '#2ee66b' },
  ok: { text: 'ATRASADO', color: '#3fa9ff' },
  erro: { text: 'ERROU', color: '#ff4d5a' },
};

function loadLatency(): number {
  try {
    const v = Number(localStorage.getItem(LATENCY_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 600 && localStorage.getItem(LATENCY_KEY) !== null ? v : 120;
  } catch {
    return 120;
  }
}

export function GameScreen({ song, media, problem, onAudioOnly, onResult, onClose }: Props) {
  useWakeLock(true);

  const evs = useMemo(() => [...song.events].sort((a, b) => a.start - b.start), [song.events]);
  const prefs = useMemo(() => ({ ...loadShapePrefs(), ...(song.shapes ?? {}) }), [song.shapes]);
  // Acordes da música já com a forma (casas por corda) que o jogador escolheu
  const chords = useMemo<GameChord[]>(
    () => evs.map((e) => ({ start: e.start, end: e.end, name: e.name, root: e.root, frets: resolveShape(e.root, e.typeId, prefs[shapeKey(e.root, e.typeId)])?.frets ?? null })),
    [evs, prefs],
  );
  const strums = useMemo(() => (song.onsets ?? []).map((o) => o.t), [song.onsets]);

  // Alvos e modelos para a pontuação: o modelo de cada acorde vem das notas que o jogador REALMENTE aperta
  const { targets, templates, names } = useMemo(() => {
    const open = getTuning('re-sol-si-re').strings.map((s) => s.midi);
    const tpl = new Map<string, Float64Array>();
    const nm = new Map<string, string>();
    const tg: Target[] = evs.map((e, i) => {
      const key = shapeKey(e.root, e.typeId);
      if (!tpl.has(key)) {
        const frets = chords[i]?.frets;
        const pcs = frets ? frets.map((f, s) => ((open[s] as number) + f) % 12) : (CHORD_TYPES.find((t) => t.id === e.typeId)?.intervals ?? [0, 4, 7]).map((iv) => (e.root + iv) % 12);
        tpl.set(key, shapeTemplate(pcs));
        nm.set(key, e.name);
      }
      return { start: e.start, end: e.end, key };
    });
    return { targets: tg, templates: tpl, names: nm };
  }, [evs, chords]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const geom = useRef<Geometry>(makeGeometry(390, 844));

  const [phase, setPhase] = useState<Phase>('title');
  const phaseRef = useRef<Phase>('title');
  phaseRef.current = phase;
  const [count, setCount] = useState(3);
  const [rate, setRate] = useState(1);
  const [cur, setCur] = useState(-1);

  // ---- microfone e pontuação
  const listener = useRef<ChordListener | null>(null);
  const engine = useRef<ScoreEngine | null>(null);
  const pending = useRef<Judgement[]>([]);
  const gameT = useRef(0);
  const [mic, setMic] = useState(false);
  const micRef = useRef(false);
  micRef.current = mic;
  const [micError, setMicError] = useState('');
  const [summary, setSummary] = useState<ScoreSummary | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [latency, setLatency] = useState(loadLatency);
  const latencyRef = useRef(latency);
  latencyRef.current = latency;
  const reported = useRef(false);

  const newEngine = () => {
    engine.current = new ScoreEngine(targets, templates);
    pending.current = [];
    reported.current = false;
    setSummary(engine.current.summary);
  };

  // Tamanho do canvas (nítido, mas sem exagerar nos pixels: no máximo 1,5× por causa do desempenho)
  useEffect(() => {
    const el = stage.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      cv.width = Math.round(el.clientWidth * dpr);
      cv.height = Math.round(el.clientHeight * dpr);
      geom.current = makeGeometry(el.clientWidth, el.clientHeight);
      cv.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  // Laço do jogo
  useEffect(() => {
    const clock = new SmoothClock();
    let raf = 0;
    let lastT = -1;
    let lastNow = performance.now();
    let lastCur = -2;
    let flashes: Flash[] = [];
    let particles: Particle[] = [];
    let popup: { text: string; color: string; at: number } | undefined;
    let missAt: number | undefined;
    const hitFx = (now: number) => {
      for (let l = 0; l < 4; l++) {
        flashes.push({ lane: l, at: now });
        spawnSparks(geom.current, l, particles);
      }
    };
    const loop = (nowMs: number) => {
      const m = media.current;
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      if (m && ctx) {
        const playing = !m.paused && !m.ended;
        const t = clock.read(m.currentTime, nowMs, playing, m.playbackRate);
        gameT.current = t;
        const dt = Math.min(0.05, (nowMs - lastNow) / 1000);
        lastNow = nowMs;
        const now = nowMs / 1000;

        // pulo no tempo (seek/reinício): a pontuação recomeça dali
        if (lastT >= 0 && Math.abs(t - lastT) > 0.6) engine.current?.seek(t);

        if (micRef.current) {
          // com microfone: os efeitos vêm dos julgamentos de verdade
          for (const j of pending.current.splice(0)) {
            const g = GRADE_TEXT[j.grade];
            popup = { text: g.text, color: g.color, at: now };
            if (j.grade === 'erro') missAt = now;
            else hitFx(now);
          }
        } else if (playing && lastT >= 0 && t > lastT && t - lastT < 0.3) {
          // demonstração: clarão quando o acorde cruza a linha
          for (const c of chords) if (c.start > lastT && c.start <= t) hitFx(now);
        }
        lastT = t;
        flashes = flashes.filter((f) => now - f.at < 0.4);
        particles = stepParticles(particles, dt);

        drawHighway(ctx, geom.current, { t, now, chords, strums, flashes, particles, popup, missAt });

        const i = activeIndex(evs, t);
        if (i !== lastCur) {
          lastCur = i;
          setCur(i);
        }
        if (m.duration) {
          const frac = Math.min(1, t / m.duration);
          if (bar.current) bar.current.style.transform = `scaleX(${frac})`;
          if (slider.current && document.activeElement !== slider.current) slider.current.value = String(frac * 1000);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [chords, evs, strums, media]);

  // Acompanha o player compartilhado
  useEffect(() => {
    const m = media.current;
    if (!m) return;
    const onPause = () => {
      if (phaseRef.current === 'play' && !m.ended) setPhase('paused');
    };
    const onEnded = () => {
      const e = engine.current;
      if (e && micRef.current) {
        e.finish();
        setSummary(e.summary);
      }
      setPhase('ended');
    };
    m.addEventListener('pause', onPause);
    m.addEventListener('ended', onEnded);
    return () => {
      m.removeEventListener('pause', onPause);
      m.removeEventListener('ended', onEnded);
      m.pause();
      m.playbackRate = 1;
    };
  }, [media]);

  // Desliga o microfone ao sair
  useEffect(() => () => void listener.current?.stop(), []);

  // Guarda o resultado de uma partida completa
  useEffect(() => {
    if (phase === 'ended' && mic && summary && !reported.current && summary.judged > 0) {
      reported.current = true;
      onResult?.({ score: summary.score, accuracy: summary.accuracy, stars: summary.stars });
    }
  }, [phase, mic, summary, onResult]);

  // Contagem 3-2-1 antes de tocar
  useEffect(() => {
    if (phase !== 'count') return;
    if (count === 0) {
      const m = media.current;
      if (m) {
        m.playbackRate = rate;
        void m.play();
      }
      setPhase('play');
      return;
    }
    const id = window.setTimeout(() => setCount((c) => c - 1), 650);
    return () => window.clearTimeout(id);
  }, [phase, count, media, rate]);

  const begin = (fromStart: boolean) => {
    const m = media.current;
    if (m && fromStart) m.currentTime = 0;
    if (fromStart && micRef.current) newEngine();
    setCount(3);
    setPhase('count');
  };

  /** Liga o microfone (precisa de um toque do usuário) e começa a pontuar. */
  const startWithMic = async () => {
    setMicError('');
    try {
      const l = listener.current ?? new ChordListener();
      listener.current = l;
      await l.start();
      l.onFrame = (f) => {
        const e = engine.current;
        const m = media.current;
        if (!e || !m || m.paused || phaseRef.current !== 'play') return;
        // tempo da música em que o som foi tocado: agora − idade do som − atraso de áudio escolhido
        const t = gameT.current - (f.ageSec + latencyRef.current / 1000) * m.playbackRate;
        const js = e.push({ t, chroma: f.chroma, levelDb: f.levelDb });
        if (js.length) {
          pending.current.push(...js);
          setSummary(e.summary);
        }
        setHeard((h) => (h === e.heard ? h : e.heard));
      };
      setMic(true);
      micRef.current = true;
      newEngine();
      engine.current?.seek(media.current?.currentTime ?? 0);
      begin(false);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Não consegui abrir o microfone.');
    }
  };

  const pause = () => {
    media.current?.pause();
    setPhase('paused');
  };
  const seekBy = (d: number) => {
    const m = media.current;
    if (m) m.currentTime = Math.max(0, Math.min((m.duration || 1e9) - 0.1, m.currentTime + d));
  };
  const pickRate = (r: number) => {
    setRate(r);
    if (media.current) media.current.playbackRate = r;
  };
  const pickLatency = (v: number) => {
    setLatency(v);
    try {
      localStorage.setItem(LATENCY_KEY, String(v));
    } catch {
      /* sem armazenamento */
    }
  };

  const nowEv = cur >= 0 ? evs[cur] : undefined;
  const nextIdx = cur >= 0 ? cur + 1 : evs.findIndex((c) => c.start > (media.current?.currentTime ?? 0));
  const nextEv = nextIdx >= 0 ? evs[nextIdx] : undefined;
  const done = Math.max(0, cur + 1);
  const expectedKey = nowEv ? shapeKey(nowEv.root, nowEv.typeId) : null;

  return (
    <div className="game" role="dialog" aria-label="Cavaco Hero">
      <div className="game-shade" />
      <div className="g-progress"><div ref={bar} /></div>

      <div className="g-top">
        <button className="g-pause" onClick={pause} aria-label="Pausar" disabled={phase !== 'play'}>
          <span /><span />
        </button>
        {mic && summary ? (
          <div className="g-score">
            <b>{summary.score.toLocaleString('pt-BR')}</b>
            <small>
              {summary.combo > 1 ? `SEQUÊNCIA ${summary.combo}` : 'PONTOS'}
              {summary.multiplier > 1 && <i> ×{summary.multiplier}</i>}
            </small>
          </div>
        ) : (
          <div className="g-song">{song.name}</div>
        )}
        <div className="g-counter">
          <b>{done}</b>/{chords.length}
          <small>ACORDES</small>
        </div>
      </div>

      <div className="g-hud">
        <div className="g-panel now" style={{ ['--c' as string]: nowEv ? `hsl(${chordHue(nowEv.root)} 90% 62%)` : '#8b96a3' }}>
          <small>AGORA</small>
          <div className="g-panel-row">
            <span key={cur} className="g-chord pop">{nowEv ? nowEv.name : '—'}</span>
            {nowEv && <ChordDiagram root={nowEv.root} typeId={nowEv.typeId} frets={prefs[shapeKey(nowEv.root, nowEv.typeId)]} height={104} color={`hsl(${chordHue(nowEv.root)} 90% 62%)`} />}
          </div>
        </div>
        <div className="g-panel next">
          <small>PRÓXIMO</small>
          <div className="g-panel-row">
            <span className="g-chord sm">{nextEv ? nextEv.name : 'fim'}</span>
            {nextEv && <ChordDiagram root={nextEv.root} typeId={nextEv.typeId} frets={prefs[shapeKey(nextEv.root, nextEv.typeId)]} height={72} showNotes={false} color={`hsl(${chordHue(nextEv.root)} 90% 62%)`} />}
          </div>
        </div>
      </div>

      {mic && (
        <div className={`g-heard ${heard && heard === expectedKey ? 'ok' : heard ? 'no' : ''}`}>
          🎤 {heard ? `ouvindo ${names.get(heard) ?? '?'}` : 'ouvindo…'}
        </div>
      )}

      <div className="g-stage" ref={stage} onClick={() => phase === 'play' && pause()}>
        <canvas ref={canvas} />
        <div className="g-strings" aria-hidden>
          {['4ª', '3ª', '2ª', '1ª'].map((s, i) => (
            <span key={s} style={{ color: LANE_COLORS[i] }}>{s}</span>
          ))}
        </div>
      </div>

      {problem && (
        <div className="g-overlay">
          <div className="g-menu">
            <h2>O vídeo não tocou</h2>
            <pre className="diag">{problem}</pre>
            {onAudioOnly && <button className="g-btn primary" onClick={onAudioOnly}>JOGAR SÓ COM O ÁUDIO</button>}
            <button className="g-btn" onClick={onClose}>SAIR</button>
          </div>
        </div>
      )}

      {!problem && phase === 'title' && (
        <div className="g-overlay">
          <div className="g-menu">
            <div className="g-logo">CAVACO<span>HERO</span></div>
            <div className="g-songname">{song.name}</div>
            {song.best && <p className="g-note">Recorde: <b>{song.best.score.toLocaleString('pt-BR')}</b> · {'★'.repeat(song.best.stars)}{'☆'.repeat(5 - song.best.stars)} · {Math.round(song.best.accuracy * 100)}%</p>}
            <button className="g-btn primary" onClick={() => void startWithMic()}>🎤 TOCAR VALENDO</button>
            <button className="g-btn" onClick={() => begin(false)}>▶ SÓ ASSISTIR</button>
            <button className="g-btn" onClick={onClose}>VOLTAR</button>
            {micError && <p className="g-note err">{micError}</p>}
            <p className="g-note dim">
              Valendo: o jogo ouve o seu cavaco e pontua. <b>Use fones</b> — sem fones o microfone ouve o vídeo e conta acerto que não é seu.
            </p>
          </div>
        </div>
      )}

      {!problem && phase === 'count' && (
        <div className="g-overlay clear">
          <div key={count} className="g-count">{count > 0 ? count : 'VAI!'}</div>
        </div>
      )}

      {!problem && phase === 'paused' && (
        <div className="g-overlay">
          <div className="g-menu">
            <h2>PAUSADO</h2>
            <button className="g-btn primary" onClick={() => begin(false)}>▶ CONTINUAR</button>
            <input
              ref={slider}
              type="range"
              min={0}
              max={1000}
              defaultValue={0}
              className="g-slider"
              aria-label="Posição da música"
              onChange={(e) => {
                const m = media.current;
                if (m?.duration) m.currentTime = (Number(e.target.value) / 1000) * m.duration;
              }}
            />
            <div className="g-row">
              <button className="g-btn" onClick={() => seekBy(-5)}>⏪ 5 s</button>
              <button className="g-btn" onClick={() => seekBy(5)}>5 s ⏩</button>
            </div>
            <div className="g-row three">
              {RATES.map((r) => (
                <button key={r} className={`g-btn ${rate === r ? 'on' : ''}`} onClick={() => pickRate(r)}>{r}×</button>
              ))}
            </div>
            {mic && (
              <label className="g-latency">
                <span>Sincronia do som: <b>{latency} ms</b></span>
                <input type="range" min={0} max={500} step={10} value={latency} className="g-slider" onChange={(e) => pickLatency(Number(e.target.value))} aria-label="Atraso do som" />
                <small>Acertos saindo como "ATRASADO" mesmo tocando na hora? Aumente. Fone Bluetooth costuma pedir 200–300 ms.</small>
              </label>
            )}
            <button className="g-btn" onClick={() => begin(true)}>↺ REINICIAR</button>
            <button className="g-btn" onClick={onClose}>SAIR</button>
          </div>
        </div>
      )}

      {!problem && phase === 'ended' && (
        <div className="g-overlay">
          <div className="g-menu">
            <div className="g-logo small">MÚSICA<span>COMPLETA!</span></div>
            <div className="g-songname">{song.name}</div>
            {mic && summary ? (
              <>
                <div className="g-stars" aria-label={`${summary.stars} de 5 estrelas`}>{'★'.repeat(summary.stars)}<i>{'★'.repeat(5 - summary.stars)}</i></div>
                <div className="g-final">{summary.score.toLocaleString('pt-BR')}</div>
                <p className="g-note">{Math.round(summary.accuracy * 100)}% de acerto · maior sequência {summary.maxCombo}</p>
                <div className="g-grades">
                  <span style={{ color: GRADE_TEXT.perfeito.color }}><b>{summary.counts.perfeito}</b>perfeito</span>
                  <span style={{ color: GRADE_TEXT.bom.color }}><b>{summary.counts.bom}</b>bom</span>
                  <span style={{ color: GRADE_TEXT.ok.color }}><b>{summary.counts.ok}</b>atrasado</span>
                  <span style={{ color: GRADE_TEXT.erro.color }}><b>{summary.counts.erro}</b>errou</span>
                </div>
              </>
            ) : (
              <p className="g-note">{chords.length} acordes na pista</p>
            )}
            <button className="g-btn primary" onClick={() => begin(true)}>↺ JOGAR DE NOVO</button>
            <button className="g-btn" onClick={onClose}>SAIR</button>
          </div>
        </div>
      )}
    </div>
  );
}
