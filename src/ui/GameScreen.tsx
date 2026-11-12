import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SongMeta } from '../storage/library';
import { activeIndex } from '../songs/types';
import { resolveShape, shapeKey } from '../chords/shapes';
import { loadShapePrefs } from '../storage/shapePrefs';
import { drawHighway, LANE_COLORS, makeGeometry, SmoothClock, spawnSparks, stepParticles, type Flash, type GameChord, type Geometry, type Particle } from '../game/highway';
import { ChordDiagram, chordHue } from './ChordDiagram';
import { useWakeLock } from './useWakeLock';

interface Props {
  song: SongMeta;
  /** O MESMO player da tela da música (um só vídeo aberto: Android limita decodificadores simultâneos). */
  media: RefObject<HTMLMediaElement | null>;
  /** Mensagem de falha do player, se houver. */
  problem: string;
  onAudioOnly?: () => void;
  onClose: () => void;
}

type Phase = 'title' | 'count' | 'play' | 'paused' | 'ended';
const RATES = [0.5, 0.75, 1];

export function GameScreen({ song, media, problem, onAudioOnly, onClose }: Props) {
  useWakeLock(true);

  // Acordes da música já com a forma (casas por corda) que o jogador escolheu
  const evs = useMemo(() => [...song.events].sort((a, b) => a.start - b.start), [song.events]);
  const chords = useMemo<GameChord[]>(() => {
    const prefs = { ...loadShapePrefs(), ...(song.shapes ?? {}) };
    return evs.map((e) => ({ start: e.start, end: e.end, name: e.name, root: e.root, frets: resolveShape(e.root, e.typeId, prefs[shapeKey(e.root, e.typeId)])?.frets ?? null }));
  }, [evs, song.shapes]);
  const prefs = useMemo(() => ({ ...loadShapePrefs(), ...(song.shapes ?? {}) }), [song.shapes]);
  const strums = useMemo(() => (song.onsets ?? []).map((o) => o.t), [song.onsets]);

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
    const loop = (nowMs: number) => {
      const m = media.current;
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      if (m && ctx) {
        const playing = !m.paused && !m.ended;
        const t = clock.read(m.currentTime, nowMs, playing, m.playbackRate);
        const dt = Math.min(0.05, (nowMs - lastNow) / 1000);
        lastNow = nowMs;
        const now = nowMs / 1000;
        const g = geom.current;

        // acordes que acabaram de cruzar a linha → clarão e faíscas nas 4 cordas
        if (playing && lastT >= 0 && t > lastT && t - lastT < 0.3) {
          for (const c of chords) {
            if (c.start > lastT && c.start <= t) {
              for (let l = 0; l < 4; l++) {
                flashes.push({ lane: l, at: now });
                spawnSparks(g, l, particles);
              }
            }
          }
        }
        lastT = t;
        flashes = flashes.filter((f) => now - f.at < 0.4);
        particles = stepParticles(particles, dt);

        drawHighway(ctx, g, { t, now, chords, strums, flashes, particles });

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
    const onEnded = () => setPhase('ended');
    m.addEventListener('pause', onPause);
    m.addEventListener('ended', onEnded);
    return () => {
      m.removeEventListener('pause', onPause);
      m.removeEventListener('ended', onEnded);
      m.pause();
      m.playbackRate = 1;
    };
  }, [media]);

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
    setCount(3);
    setPhase('count');
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

  const nowEv = cur >= 0 ? evs[cur] : undefined;
  const nextIdx = cur >= 0 ? cur + 1 : evs.findIndex((c) => c.start > (media.current?.currentTime ?? 0));
  const nextEv = nextIdx >= 0 ? evs[nextIdx] : undefined;
  const done = Math.max(0, cur + 1);

  return (
    <div className="game" role="dialog" aria-label="Cavaco Hero">
      <div className="game-shade" />
      <div className="g-progress"><div ref={bar} /></div>

      <div className="g-top">
        <button className="g-pause" onClick={pause} aria-label="Pausar" disabled={phase !== 'play'}>
          <span /><span />
        </button>
        <div className="g-song">{song.name}</div>
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
            <p className="g-note">{chords.length} acordes · as 4 pistas são as 4 cordas, e o número em cada nota é a casa</p>
            <button className="g-btn primary" onClick={() => begin(false)}>▶ TOCAR</button>
            <button className="g-btn" onClick={onClose}>VOLTAR</button>
            <p className="g-note dim">Demonstração: ainda não ouve o seu cavaco, então não há pontuação. Use fones.</p>
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
            <p className="g-note">{chords.length} acordes tocados na pista</p>
            <button className="g-btn primary" onClick={() => begin(true)}>↺ JOGAR DE NOVO</button>
            <button className="g-btn" onClick={onClose}>SAIR</button>
          </div>
        </div>
      )}
    </div>
  );
}
