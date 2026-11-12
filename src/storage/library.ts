/** Biblioteca local (IndexedDB): guarda o vídeo/áudio e os acordes editados de cada música. */
import type { ChordEvent } from '../chords/analyzer';
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

export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ok */
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
