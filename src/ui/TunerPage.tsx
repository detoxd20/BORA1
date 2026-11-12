import { useCallback, useEffect, useRef, useState } from 'react';
import { type AudioEngine, EngineError } from '../audio/audioEngine';
import { getTuning } from '../tuner/tunings';
import type { TunerMode } from '../tuner/tunerState';
import { loadSettings, saveSettings, type Settings } from '../storage/settings';
import { TunerScreen } from './TunerScreen';
import { DebugScreen } from './DebugScreen';
import { SettingsSheet } from './SettingsSheet';
import { useTuner } from './useTuner';
import { useWakeLock } from './useWakeLock';

type Screen = 'tuner' | 'debug';
type Status = 'idle' | 'starting' | 'running' | 'error';

const screenFromHash = (): Screen => (location.hash === '#debug' ? 'debug' : 'tuner');

export function TunerPage({ engine }: { engine: AudioEngine }) {
  const [screen, setScreen] = useState<Screen>(screenFromHash);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<TunerMode>('auto');
  const [manualIndex, setManualIndex] = useState(0);
  const taps = useRef({ n: 0, t: 0 });

  const tuning = getTuning(settings.tuningId);
  const running = status === 'running';
  const { reading, lastFrame } = useTuner(engine, running, tuning, mode, manualIndex, settings.gateDb);
  useWakeLock(running);

  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => saveSettings(settings), [settings]);

  const start = useCallback(async () => {
    setStatus('starting');
    setError('');
    try {
      await engine.start();
      setStatus('running');
    } catch (e) {
      setError(e instanceof EngineError ? e.message : 'Não foi possível iniciar o áudio.');
      setStatus('error');
    }
  }, [engine]);

  // Toque 5× no título → tela oculta de diagnóstico
  const onTitleTap = () => {
    const now = Date.now();
    taps.current.n = now - taps.current.t < 1500 ? taps.current.n + 1 : 1;
    taps.current.t = now;
    if (taps.current.n >= 5) {
      taps.current.n = 0;
      location.hash = screen === 'debug' ? '' : '#debug';
    }
  };

  const pickString = (i: number) => {
    setMode('manual');
    setManualIndex(i);
  };

  return (
    <>
      <header className="top">
        <button className="title" onClick={onTitleTap} aria-label="Título">
          {screen === 'debug' ? 'Diagnóstico' : 'Afinador'}
        </button>
        {screen === 'debug' ? (
          <button className="chip" onClick={() => (location.hash = '')}>
            Voltar
          </button>
        ) : (
          <button className="chip" onClick={() => setShowSettings(true)}>
            {tuning.name} <span aria-hidden>⚙</span>
          </button>
        )}
      </header>

      <main>
        {!running ? (
          <div className="start">
            <div className="start-icon" aria-hidden>
              🎵
            </div>
            <h1>Afinador de cavaquinho</h1>
            <p className="muted">
              Precisa do microfone. Nada é gravado nem enviado: o áudio é analisado só no seu aparelho.
            </p>
            <button className="btn primary" onClick={start} disabled={status === 'starting'}>
              {status === 'starting' ? 'Abrindo microfone…' : status === 'error' ? 'Tentar de novo' : 'Ativar microfone'}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
            {screen === 'debug' && <DebugScreen engine={engine} running={false} frame={null} reading={reading} />}
          </div>
        ) : screen === 'debug' ? (
          <DebugScreen engine={engine} running={running} frame={lastFrame} reading={reading} />
        ) : (
          <TunerScreen
            tuning={tuning}
            mode={mode}
            manualIndex={manualIndex}
            reading={reading}
            vibrate={settings.vibrate}
            onMode={setMode}
            onPickString={pickString}
          />
        )}
      </main>

      {showSettings && (
        <SettingsSheet
          settings={settings}
          levelDb={lastFrame?.levelDb ?? -120}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
