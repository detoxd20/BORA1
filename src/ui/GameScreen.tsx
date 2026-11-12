import { useEffect, useMemo, useRef, useState } from 'react';
import type { SongMeta } from '../storage/library';
import { activeIndex } from '../songs/types';
import { ChordDiagram, chordHue } from './ChordDiagram';

interface Props {
  song: SongMeta;
  url: string;
  audioOnly: boolean;
  onClose: () => void;
}

/** Quantos segundos da música ficam visíveis acima da linha de acerto. */
const LOOKAHEAD = 5;
const HIT_FRAC = 0.8;
const RATES = [0.5, 0.75, 1];

export function GameScreen({ song, url, audioOnly, onClose }: Props) {
  const events = useMemo(() => [...song.events].sort((a, b) => a.start - b.start), [song.events]);
  const onsets = useMemo(() => song.onsets ?? [], [song.onsets]);
  const maxStrength = useMemo(() => Math.max(1e-6, ...onsets.map((o) => o.strength)), [onsets]);

  const media = useRef<HTMLMediaElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const geom = useRef({ h: 600 });

  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [rate, setRate] = useState(1);
  const [cur, setCur] = useState(-1);
  const [tick, setTick] = useState(0); // muda a cada 0,5 s: decide quais cartas existem na tela
  const [laneH, setLaneH] = useState(600);

  const hitY = laneH * HIT_FRAC;
  const pps = hitY / LOOKAHEAD;

  useEffect(() => {
    const el = lane.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      geom.current.h = el.clientHeight;
      setLaneH(el.clientHeight);
    });
    ro.observe(el);
    geom.current.h = el.clientHeight;
    setLaneH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Laço de animação: move a pista inteira com UMA transformação (suave, sem re-renderizar a cada quadro)
  useEffect(() => {
    let raf = 0;
    let lastCur = -2;
    let lastTick = -1;
    const loop = () => {
      const m = media.current;
      if (m) {
        const t = m.currentTime;
        const h = geom.current.h * HIT_FRAC;
        if (track.current) track.current.style.transform = `translateY(${h + t * (h / LOOKAHEAD)}px)`;
        const i = activeIndex(events, t);
        if (i !== lastCur) {
          lastCur = i;
          setCur(i);
        }
        const tk = Math.floor(t * 2);
        if (tk !== lastTick) {
          lastTick = tk;
          setTick(tk);
        }
        if (slider.current && !dragging.current && m.duration) slider.current.value = String((t / m.duration) * 1000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [events]);

  useEffect(() => () => media.current?.pause(), []);

  const start = () => {
    const m = media.current;
    if (!m) return;
    setStarted(true);
    setEnded(false);
    m.playbackRate = rate;
    void m.play();
  };
  const toggle = () => {
    const m = media.current;
    if (!m) return;
    if (m.paused) void m.play();
    else m.pause();
  };
  const seekBy = (d: number) => {
    const m = media.current;
    if (m) m.currentTime = Math.max(0, Math.min((m.duration || 1e9) - 0.1, m.currentTime + d));
  };
  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] as number;
    setRate(next);
    if (media.current) media.current.playbackRate = next;
  };

  const t = tick / 2;
  const visible = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.end > t - 2.5 && e.start < t + LOOKAHEAD + 1.5);
  const visibleOnsets = onsets.filter((o) => o.t > t - 1.5 && o.t < t + LOOKAHEAD + 1);
  const seconds: number[] = [];
  for (let s = Math.floor(t - 2); s <= Math.ceil(t + LOOKAHEAD + 2); s++) if (s >= 0) seconds.push(s);

  const now = cur >= 0 ? events[cur] : undefined;
  const next = events[cur >= 0 ? cur + 1 : 0];
  const mediaProps = {
    ref: media as never,
    src: url,
    preload: 'auto' as const,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setEnded(true),
  };

  return (
    <div className="game" role="dialog" aria-label="Modo jogo">
      {audioOnly ? <audio {...mediaProps} /> : <video {...mediaProps} className="game-video" playsInline />}
      <div className="game-shade" />

      <div className="game-top">
        <button className="game-x" onClick={onClose} aria-label="Sair do jogo">✕</button>
        <div className="game-title">{song.name}</div>
        <button className="game-rate" onClick={cycleRate} aria-label="Velocidade">{rate}×</button>
      </div>

      <div className="game-hud">
        <div className="hud-now">
          <small>AGORA</small>
          {now ? (
            <div className="hud-row" style={{ ['--c' as string]: `hsl(${chordHue(now.root)} 85% 62%)` }}>
              <span className="hud-name">{now.name}</span>
              <ChordDiagram root={now.root} typeId={now.typeId} height={128} color={`hsl(${chordHue(now.root)} 85% 62%)`} />
            </div>
          ) : (
            <div className="hud-row"><span className="hud-name dim">—</span></div>
          )}
        </div>
        <div className="hud-next">
          <small>PRÓXIMO</small>
          {next ? (
            <div className="hud-row">
              <span className="hud-name sm">{next.name}</span>
              <ChordDiagram root={next.root} typeId={next.typeId} height={84} color={`hsl(${chordHue(next.root)} 85% 62%)`} />
            </div>
          ) : (
            <div className="hud-row"><span className="hud-name sm dim">fim</span></div>
          )}
        </div>
      </div>

      <div className="game-lane" ref={lane} onClick={() => started && toggle()}>
        <div className="lane-bg" />
        <div className="game-track" ref={track}>
          {seconds.map((s) => (
            <div key={`s${s}`} className="beat" style={{ top: -s * pps }} />
          ))}
          {visibleOnsets.map((o, i) => (
            <div key={`o${i}-${o.t}`} className="strum" style={{ top: -o.t * pps, opacity: 0.15 + 0.5 * (o.strength / maxStrength) }} />
          ))}
          {visible.map(({ e, i }) => {
            const h = Math.max((e.end - e.start) * pps - 4, 46);
            const hue = chordHue(e.root);
            const c = `hsl(${hue} 85% 62%)`;
            return (
              <div
                key={`${e.start}-${i}`}
                className={`gcard ${i === cur ? 'on' : ''} ${i < cur ? 'past' : ''}`}
                style={{ top: -e.start * pps - h, height: h, ['--c' as string]: c, ['--bg' as string]: `hsl(${hue} 60% 22%)` }}
              >
                <span className="gcard-name" style={{ fontSize: h < 64 ? 24 : 34 }}>{e.name}</span>
                {h >= 56 && <ChordDiagram root={e.root} typeId={e.typeId} height={Math.min(h - 10, 124)} showNotes={h >= 100} color={c} />}
              </div>
            );
          })}
        </div>
        <div className="hit-line" style={{ top: hitY }}>
          <span>ACERTE AQUI</span>
        </div>
      </div>

      <div className="game-controls">
        <input
          ref={slider}
          type="range"
          min={0}
          max={1000}
          defaultValue={0}
          className="game-slider"
          aria-label="Posição da música"
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={() => (dragging.current = false)}
          onChange={(e) => {
            const m = media.current;
            if (m?.duration) m.currentTime = (Number(e.target.value) / 1000) * m.duration;
          }}
        />
        <div className="game-buttons">
          <button className="g-btn" onClick={() => seekBy(-5)} aria-label="Voltar 5 segundos">⏪ 5s</button>
          <button className="g-btn big" onClick={() => (started ? toggle() : start())} aria-label={playing ? 'Pausar' : 'Tocar'}>
            {playing ? '⏸' : '▶'}
          </button>
          <button className="g-btn" onClick={() => seekBy(5)} aria-label="Avançar 5 segundos">5s ⏩</button>
        </div>
      </div>

      {!started && (
        <div className="game-overlay">
          <div className="overlay-card">
            <h2>{song.name}</h2>
            <p className="muted">Siga os acordes que descem até a linha. Cada um mostra a formação no braço do cavaquinho.</p>
            <p className="muted small">Modo visual: ainda sem pontuação pelo som do cavaco. Use fones para o vídeo não atrapalhar.</p>
            <button className="btn primary" onClick={start}>▶ Começar</button>
          </div>
        </div>
      )}
      {ended && (
        <div className="game-overlay">
          <div className="overlay-card">
            <h2>Fim da música</h2>
            <button className="btn primary" onClick={() => { seekBy(-1e9); start(); }}>Jogar de novo</button>
            <button className="btn" onClick={onClose}>Sair</button>
          </div>
        </div>
      )}
    </div>
  );
}
