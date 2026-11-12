import { useEffect, useRef, useState } from 'react';
import type { AudioEngine, EngineInfo } from '../audio/audioEngine';
import { NOTE_NAMES, nearestNote } from '../chords/notes';
import type { PitchFrame, TunerReading } from '../tuner/tunerState';

interface Props {
  engine: AudioEngine;
  running: boolean;
  frame: PitchFrame | null;
  reading: TunerReading;
}

/** Cromagrama preliminar a partir do FFT do AnalyserNode (o do módulo 2 virá depois). */
function computeChroma(engine: AudioEngine): number[] {
  const an = engine.analyser;
  const ctx = engine.ctx;
  const chroma = new Array<number>(12).fill(0);
  if (!an || !ctx) return chroma;
  const data = new Float32Array(an.frequencyBinCount);
  an.getFloatFrequencyData(data);
  const binHz = ctx.sampleRate / an.fftSize;
  for (let i = 1; i < data.length; i++) {
    const f = i * binHz;
    if (f < 130 || f > 2200) continue;
    const power = Math.pow(10, (data[i] as number) / 10);
    const pc = nearestNote(f).note.pitchClass;
    chroma[pc] = (chroma[pc] as number) + power;
  }
  const max = Math.max(...chroma, 1e-12);
  return chroma.map((v) => v / max);
}

export function DebugScreen({ engine, running, frame, reading }: Props) {
  const [chroma, setChroma] = useState<number[]>(() => new Array<number>(12).fill(0));
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const snapshot = useRef({ frame, reading, info, chroma });
  snapshot.current = { frame, reading, info, chroma };

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setChroma(computeChroma(engine));
      setInfo(engine.info());
    }, 100);
    return () => window.clearInterval(id);
  }, [engine, running]);

  const levelDb = frame?.levelDb ?? -120;
  const levelPct = Math.max(0, Math.min(100, ((levelDb + 80) / 80) * 100));
  const nn = frame && frame.freq > 0 ? nearestNote(frame.freq) : null;

  const copy = async () => {
    const s = snapshot.current;
    const report = {
      quando: new Date().toISOString(),
      userAgent: navigator.userAgent,
      motor: s.info,
      quadro: s.frame,
      afinador: s.reading,
      cromagrama: Object.fromEntries(NOTE_NAMES.map((n, i) => [n, +(s.chroma[i] as number).toFixed(3)])),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copie o relatório:', JSON.stringify(report));
    }
  };

  return (
    <section className="debug">
      {!running && <p className="muted">Ative o microfone na tela do afinador para ver os dados ao vivo.</p>}

      <div className="dbg-card">
        <div className="dbg-row">
          <span>Nível do microfone</span>
          <b>{levelDb > -120 ? `${levelDb.toFixed(1)} dBFS` : '—'}</b>
        </div>
        <div className="level">
          <div className="level-bar" style={{ width: `${levelPct}%` }} />
        </div>
      </div>

      <div className="dbg-card">
        <div className="dbg-row">
          <span>Frequência (bruta)</span>
          <b>{frame && frame.freq > 0 ? `${frame.freq.toFixed(2)} Hz` : '—'}</b>
        </div>
        <div className="dbg-row">
          <span>Nota mais próxima</span>
          <b>{nn ? `${nn.note.name} (${nn.cents >= 0 ? '+' : ''}${nn.cents.toFixed(1)}¢)` : '—'}</b>
        </div>
        <div className="dbg-row">
          <span>Clareza do pitch</span>
          <b>{frame ? frame.clarity.toFixed(3) : '—'}</b>
        </div>
        <div className="dbg-row">
          <span>Afinador (suavizado)</span>
          <b>{reading.active ? `${reading.cents.toFixed(2)}¢ · ${reading.freq.toFixed(2)} Hz` : '—'}</b>
        </div>
      </div>

      <div className="dbg-card">
        <div className="dbg-row">
          <span>Cromagrama</span>
          <small className="muted">preliminar (FFT)</small>
        </div>
        <div className="chroma">
          {chroma.map((v, i) => (
            <div key={i} className="chroma-col">
              <div className="chroma-bar" style={{ height: `${Math.round(v * 100)}%` }} />
              <span>{NOTE_NAMES[i]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dbg-card">
        <div className="dbg-row">
          <span>Acorde detectado</span>
          <b className="muted">módulo 2 ainda não implementado</b>
        </div>
      </div>

      <div className="dbg-card">
        <div className="dbg-row">
          <span>Taxa de amostragem</span>
          <b>{info ? `${info.sampleRate} Hz` : '—'}</b>
        </div>
        <div className="dbg-row">
          <span>Latência (base / saída)</span>
          <b>{info ? `${info.baseLatencyMs.toFixed(1)} / ${info.outputLatencyMs.toFixed(1)} ms` : '—'}</b>
        </div>
        <div className="dbg-row">
          <span>Quadros de pitch/s</span>
          <b>{info ? info.framesPerSec.toFixed(0) : '—'}</b>
        </div>
        <div className="dbg-row">
          <span>Estado / dispositivo</span>
          <b className="trunc">{info ? `${info.state} · ${info.deviceLabel || 'sem nome'}` : '—'}</b>
        </div>
      </div>

      <button className="btn" onClick={copy}>
        {copied ? 'Copiado ✓' : 'Copiar relatório'}
      </button>
    </section>
  );
}
