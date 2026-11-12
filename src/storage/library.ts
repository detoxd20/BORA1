/** Biblioteca local (IndexedDB): guarda o vídeo/áudio e os acordes editados de cada música. */
import type { ChordEvent } from '../chords/analyzer';
import type { Onset } from '../audio/onsets';
import type { Region } from '../songs/ocr';
import type { VocabSegment } from '../songs/vocabulary';

export interface SongMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
  updatedAt: number;
  /** Resultado bruto da análise (para refazer a limpeza sem reanalisar). */
  raw: ChordEvent[];
  /** Acordes que o usuário vê e edita. */
  events: ChordEvent[];
  cleanLevel: string;
  /** O usuário já editou à mão (refazer a limpeza descartaria isso). */
  edited?: boolean;
  /** Acordes lidos no vídeo, por trecho (quando o usuário usou "Ler acordes do vídeo"). */
  vocab?: VocabSegment[];
  region?: Region;
  /** Vídeo mostra um acorde por vez (o da tela é o atual), em vez de uma lista. */
  oneAtATime?: boolean;
  /** Palhetadas detectadas no áudio (para encostar trocas de acorde e, depois, pontuar o jogo). */
  onsets?: Onset[];
  /** Veio de um backup: os acordes existem, mas falta escolher de novo o arquivo de vídeo. */
  needsFile?: boolean;
  /** Forma (casas por corda) escolhida para cada acorde desta música. Chave "root:typeId". */
  shapes?: Record<string, number[]>;
}

const DB = 'cavaco';
const META = 'songs';
const BLOBS = 'blobs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' });
      req.result.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        const req = fn(tx);
        tx.oncomplete = () => {
          db.close();
          resolve(req ? (req.result as T) : (undefined as T));
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Pede ao navegador para não apagar os dados do app. Devolve se ficaram protegidos. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function saveSong(meta: SongMeta, blob?: Blob): Promise<void> {
  return run([META, BLOBS], 'readwrite', (tx) => {
    tx.objectStore(META).put(meta);
    if (blob) tx.objectStore(BLOBS).put(blob, meta.id);
  });
}

export function listSongs(): Promise<SongMeta[]> {
  return run<SongMeta[]>([META], 'readonly', (tx) => tx.objectStore(META).getAll()).then((l) =>
    l.sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

export function getBlob(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>([BLOBS], 'readonly', (tx) => tx.objectStore(BLOBS).get(id));
}

export function deleteSong(id: string): Promise<void> {
  return run([META, BLOBS], 'readwrite', (tx) => {
    tx.objectStore(META).delete(id);
    tx.objectStore(BLOBS).delete(id);
  });
}

export async function getMeta(id: string): Promise<SongMeta | undefined> {
  return run<SongMeta | undefined>([META], 'readonly', (tx) => tx.objectStore(META).get(id));
}

/** Backup em texto: os acordes e ajustes de todas as músicas (o vídeo não entra: é grande). */
export async function exportBackup(): Promise<string> {
  const songs = await listSongs();
  return JSON.stringify({ app: 'cavaco', version: 1, exportedAt: new Date().toISOString(), songs }, null, 1);
}

/** Importa um backup. Música que já existe fica com a versão mais recente; nova entra pedindo o arquivo. */
export async function importBackup(text: string): Promise<{ added: number; updated: number }> {
  const data = JSON.parse(text) as { app?: string; songs?: SongMeta[] };
  if (data.app !== 'cavaco' || !Array.isArray(data.songs)) throw new Error('Este arquivo não é um backup do Cavaco.');
  const have = new Map((await listSongs()).map((m) => [m.id, m]));
  let added = 0, updated = 0;
  for (const m of data.songs) {
    if (!m || typeof m.id !== 'string' || !Array.isArray(m.events)) continue;
    const cur = have.get(m.id);
    if (!cur) {
      await saveSong({ ...m, needsFile: true });
      added++;
    } else if ((m.updatedAt ?? 0) > (cur.updatedAt ?? 0)) {
      await saveSong({ ...cur, ...m, needsFile: cur.needsFile });
      updated++;
    }
  }
  return { added, updated };
}
