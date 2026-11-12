import { TUNINGS } from '../tuner/tunings';
import type { Settings } from '../storage/settings';

interface Props {
  settings: Settings;
  levelDb: number;
  onChange: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsSheet({ settings, levelDb, onChange, onClose }: Props) {
  const meterPct = Math.max(0, Math.min(100, ((levelDb + 80) / 80) * 100));
  const gatePct = ((settings.gateDb + 80) / 80) * 100;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ajustes do afinador">
        <div className="sheet-head">
          <h2>Ajustes</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <h3>Afinação</h3>
        <div className="radio-list">
          {TUNINGS.map((t) => (
            <label key={t.id} className={`radio ${t.id === settings.tuningId ? 'on' : ''}`}>
              <input
                type="radio"
                name="tuning"
                checked={t.id === settings.tuningId}
                onChange={() => onChange({ ...settings, tuningId: t.id })}
              />
              <span className="r-title">{t.name}</span>
              <span className="r-sub">{t.description}</span>
            </label>
          ))}
        </div>

        <h3>Sensibilidade do microfone</h3>
        <p className="muted">Sons abaixo da linha são ignorados como ruído. Toque uma corda e deixe a barra passar da linha.</p>
        <div className="level">
          <div className="level-bar" style={{ width: `${meterPct}%` }} />
          <div className="level-gate" style={{ left: `${gatePct}%` }} />
        </div>
        <input
          type="range"
          min={-70}
          max={-30}
          step={1}
          value={settings.gateDb}
          onChange={(e) => onChange({ ...settings, gateDb: Number(e.target.value) })}
          aria-label="Limiar de ruído"
        />
        <div className="range-labels">
          <span>Mais sensível</span>
          <span>{settings.gateDb} dB</span>
          <span>Menos sensível</span>
        </div>

        <label className="toggle">
          <span>Vibrar ao afinar</span>
          <input
            type="checkbox"
            checked={settings.vibrate}
            onChange={(e) => onChange({ ...settings, vibrate: e.target.checked })}
          />
        </label>
      </div>
    </div>
  );
}
