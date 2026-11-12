import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/audioEngine';
import { emptyReading, TunerProcessor, type PitchFrame, type TunerMode, type TunerReading } from '../tuner/tunerState';
import type { Tuning } from '../tuner/tunings';

export interface TunerView {
  reading: TunerReading;
  lastFrame: PitchFrame | null;
}

/**
 * Liga o motor de áudio ao processador do afinador.
 * Os quadros chegam ~90×/s; a interface só é atualizada no rAF (≤60×/s).
 */
export function useTuner(
  engine: AudioEngine,
  running: boolean,
  tuning: Tuning,
  mode: TunerMode,
  manualIndex: number,
  gateDb: number,
): TunerView {
  const procRef = useRef<TunerProcessor | null>(null);
  if (!procRef.current) procRef.current = new TunerProcessor();
  const params = useRef({ tuning, mode, manualIndex });
  params.current = { tuning, mode, manualIndex };
  const latest = useRef<TunerView>({ reading: emptyReading(), lastFrame: null });
  const [view, setView] = useState<TunerView>(latest.current);

  useEffect(() => {
    procRef.current?.setConfig({ gateDb });
  }, [gateDb]);

  // Trocar de afinação ou de corda manual invalida a leitura em andamento.
  useEffect(() => {
    procRef.current?.reset();
  }, [tuning, mode, manualIndex]);

  useEffect(() => {
    if (!running) {
      procRef.current?.reset();
      latest.current = { reading: emptyReading(), lastFrame: null };
      setView(latest.current);
      return;
    }
    const proc = procRef.current as TunerProcessor;
    const unsub = engine.subscribe((frame) => {
      const p = params.current;
      latest.current = { reading: proc.update(frame, p.tuning, p.mode, p.manualIndex), lastFrame: frame };
    });
    let raf = 0;
    let shown: TunerView | null = null;
    const loop = () => {
      if (latest.current !== shown) {
        shown = latest.current;
        setView(shown);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [engine, running]);

  return view;
}
