import { DEFAULT_TUNING_ID, TUNINGS } from '../tuner/tunings';

export interface Settings {
  tuningId: string;
  /** Limiar do portão de ruído (dBFS). Mais alto = menos sensível. */
  gateDb: number;
  vibrate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  tuningId: DEFAULT_TUNING_ID,
  gateDb: -50,
  vibrate: true,
};

const KEY = 'cavaco:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      tuningId: TUNINGS.some((t) => t.id === p.tuningId) ? (p.tuningId as string) : DEFAULT_SETTINGS.tuningId,
      gateDb: typeof p.gateDb === 'number' ? Math.min(-30, Math.max(-70, p.gateDb)) : DEFAULT_SETTINGS.gateDb,
      vibrate: typeof p.vibrate === 'boolean' ? p.vibrate : DEFAULT_SETTINGS.vibrate,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* modo privado / armazenamento bloqueado: segue sem persistir */
  }
}
