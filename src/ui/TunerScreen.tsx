import { useEffect, useRef } from 'react';
import type { Tuning } from '../tuner/tunings';
import type { TunerMode, TunerReading } from '../tuner/tunerState';
import { Gauge } from './Gauge';

interface Props {
  tuning: Tuning;
  mode: TunerMode;
  manualIndex: number;
  reading: TunerReading;
  vibrate: boolean;
  onMode: (m: TunerMode) => void;
  onPickString: (i: number) => void;
}

function hint(r: TunerReading): string {
  if (!r.active) return 'Toque uma corda';
  if (r.inTune) return 'Afinada';
  if (r.cents < 0) return r.cents < -15 ? 'Grave demais — aperte a cravelha' : 'Grave — aperte um pouco';
  return r.cents > 15 ? 'Agudo demais — afrouxe a cravelha' : 'Agudo — afrouxe um pouco';
}

export function TunerScreen({ tuning, mode, manualIndex, reading, vibrate, onMode, onPickString }: Props) {
  const idx = reading.active ? reading.stringIndex : mode === 'manual' ? manualIndex : -1;
  const target = idx >= 0 ? tuning.strings[idx] : undefined;
  const tunedBefore = useRef(false);

  // Vibração curta ao entrar na afinação
  useEffect(() => {
    if (reading.inTune && !tunedBefore.current && vibrate && 'vibrate' in navigator) navigator.vibrate(25);
    tunedBefore.current = reading.inTune;
  }, [reading.inTune, vibrate]);

  const state = !reading.active ? 'idle' : reading.inTune ? 'good' : Math.abs(reading.cents) < 10 ? 'near' : 'far';
  const cents = Math.round(reading.cents);

  return (
    <section className={`tuner state-${state} ${reading.holding ? 'holding' : ''}`}>
      <div className="note-block">
        <div className="note-name" aria-live="polite">
          {target ? target.solfege : '—'}
          {target && <span className="note-oct">{target.note.slice(-1)}</span>}
        </div>
        <div className="note-sub">
          {target ? `${target.number}ª corda` : mode === 'auto' ? 'Modo automático' : 'Escolha uma corda'}
        </div>
      </div>

      <Gauge cents={reading.cents} active={reading.active} inTune={reading.inTune} />

      <div className="readout">
        <div className="cents">
          {reading.active ? `${cents > 0 ? '+' : ''}${cents}` : '--'}
          <small> cents</small>
        </div>
        <div className="hz">{reading.active ? `${reading.freq.toFixed(1)} Hz` : ' '}</div>
      </div>
      <div className="hint">{hint(reading)}</div>

      <div className="strings" role="group" aria-label="Cordas">
        {tuning.strings.map((s, i) => {
          const selected = mode === 'manual' ? i === manualIndex : reading.active && i === reading.stringIndex;
          const done = selected && reading.active && reading.inTune;
          return (
            <button
              key={i}
              className={`string-btn ${selected ? 'sel' : ''} ${done ? 'ok' : ''}`}
              onClick={() => onPickString(i)}
              aria-pressed={selected}
            >
              <span className="s-num">{s.number}ª</span>
              <span className="s-note">{s.solfege}</span>
              <span className="s-oct">{s.note.slice(-1)}</span>
            </button>
          );
        })}
      </div>

      <div className="seg" role="group" aria-label="Modo">
        <button className={mode === 'auto' ? 'on' : ''} onClick={() => onMode('auto')}>
          Automático
        </button>
        <button className={mode === 'manual' ? 'on' : ''} onClick={() => onMode('manual')}>
          Manual
        </button>
      </div>
    </section>
  );
}
