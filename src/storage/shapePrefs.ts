/** Formas preferidas do usuário para cada acorde, valendo para todas as músicas (padrão global). */
const KEY = 'cavaco:shapes:v1';

export type ShapePrefs = Record<string, number[]>;

export function loadShapePrefs(): ShapePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as ShapePrefs) : {};
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export function saveShapePref(key: string, frets: number[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadShapePrefs(), [key]: frets }));
  } catch {
    /* sem armazenamento: vale só para esta música */
  }
}
