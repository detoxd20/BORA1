import { useState } from 'react';
import { CHORD_TYPES, chordName } from '../chords/models';
import { NOTE_NAMES } from '../chords/notes';

interface Item {
  key: string;
  name: string;
}

interface Props {
  initial: Item[];
  onApply: (items: Item[]) => void;
  onCancel: () => void;
}

/** Lista de acordes lida do vídeo: toque para remover um falso, e adicione os que o leitor não pegou. */
export function VocabEditor({ initial, onApply, onCancel }: Props) {
  const [items, setItems] = useState<Item[]>(initial);
  const [root, setRoot] = useState(7);
  const [typeId, setTypeId] = useState('maj');

  const add = () => {
    const type = CHORD_TYPES.find((t) => t.id === typeId)!;
    const key = `${root}:${typeId}`;
    if (!items.some((i) => i.key === key)) setItems([...items, { key, name: chordName(root, type) }]);
  };

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Acordes do vídeo">
        <div className="sheet-head">
          <h2>Acordes do vídeo</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Fechar">✕</button>
        </div>
        <p className="muted small">Toque num acorde para <b>remover</b> (leitura errada). Adicione abaixo os que o app não leu. O áudio será analisado só com esta lista.</p>
        <div className="live-chords">
          {items.length === 0 && <span className="muted">Lista vazia.</span>}
          {items.map((i) => (
            <button key={i.key} className="live-chip removable" onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
              {i.name} <span aria-hidden>✕</span>
            </button>
          ))}
        </div>
        <h3>Adicionar acorde</h3>
        <div className="grid-12">
          {NOTE_NAMES.map((n, r) => (
            <button key={n} className={`pick ${root === r ? 'on' : ''}`} onClick={() => setRoot(r)}>{n}</button>
          ))}
        </div>
        <div className="grid-4" style={{ marginTop: 8 }}>
          {CHORD_TYPES.map((t) => (
            <button key={t.id} className={`pick ${typeId === t.id ? 'on' : ''}`} onClick={() => setTypeId(t.id)}>{t.suffix || 'maior'}</button>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 12, maxWidth: 'none' }} onClick={add}>
          + Adicionar {chordName(root, CHORD_TYPES.find((t) => t.id === typeId)!)}
        </button>
        <button className="btn primary" style={{ marginTop: 10, maxWidth: 'none' }} disabled={items.length === 0} onClick={() => onApply(items)}>
          Refazer análise com esta lista
        </button>
      </div>
    </div>
  );
}
