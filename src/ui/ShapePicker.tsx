import { useMemo } from 'react';
import type { ChordEvent } from '../chords/analyzer';
import { resolveShape, shapeKey, shapesFor } from '../chords/shapes';
import { ChordDiagram, chordHue } from './ChordDiagram';

interface Props {
  events: ChordEvent[];
  /** Formas já escolhidas (música + padrão do usuário). */
  chosen: Record<string, number[]>;
  onPick: (key: string, frets: number[]) => void;
  onClose: () => void;
}

const MAX_OPTIONS = 8;

/** Para cada acorde da música, mostra as formas possíveis no braço; o usuário toca na que ele usa. */
export function ShapePicker({ events, chosen, onPick, onClose }: Props) {
  // acordes distintos, na ordem em que aparecem na música
  const chords = useMemo(() => {
    const seen = new Map<string, ChordEvent>();
    for (const e of [...events].sort((a, b) => a.start - b.start)) {
      const k = shapeKey(e.root, e.typeId);
      if (!seen.has(k)) seen.set(k, e);
    }
    return [...seen.entries()];
  }, [events]);

  return (
    <div className="picker-full" role="dialog" aria-label="Formas dos acordes">
      <div className="picker-top">
        <span />
        <b>Formas dos acordes</b>
        <button className="chip" onClick={onClose}>Pronto</button>
      </div>
      <div className="picker-body">
        <p className="muted small">
          Toque na forma que você usa para cada acorde. O jogo passa a mostrar essa forma, e ela vira o seu padrão para as outras músicas.
        </p>
        {chords.map(([key, e]) => {
          const current = resolveShape(e.root, e.typeId, chosen[key])!;
          const options = shapesFor(e.root, e.typeId).slice(0, MAX_OPTIONS);
          // se a forma atual não está entre as primeiras, mostra ela também
          if (!options.some((o) => o.frets.join() === current.frets.join())) options.unshift(current);
          const color = `hsl(${chordHue(e.root)} 85% 62%)`;
          return (
            <section key={key} className="shape-row">
              <h3 style={{ color }}>{e.name}</h3>
              <div className="shape-options">
                {options.map((o) => {
                  const on = o.frets.join() === current.frets.join();
                  return (
                    <button key={o.frets.join()} className={`shape-opt ${on ? 'on' : ''}`} onClick={() => onPick(key, o.frets)} aria-pressed={on}>
                      <ChordDiagram root={e.root} typeId={e.typeId} frets={o.frets} height={118} color={color} />
                      <span className="muted small">{o.frets.join('-')}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
