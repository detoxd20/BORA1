import { useMemo, useState } from 'react';
import { AudioEngine } from '../audio/audioEngine';
import { SongsPage } from './SongsPage';
import { TunerPage } from './TunerPage';

type Page = 'songs' | 'tuner';

export function App() {
  const engine = useMemo(() => new AudioEngine(), []);
  const [page, setPage] = useState<Page>(location.hash === '#debug' ? 'tuner' : 'songs');
  return (
    <div className="app">
      {/* Mantém as duas montadas: trocar de aba não perde o vídeo nem a análise */}
      <div className={page === 'songs' ? 'page' : 'page hidden'}>
        <SongsPage />
      </div>
      <div className={page === 'tuner' ? 'page' : 'page hidden'}>
        <TunerPage engine={engine} />
      </div>
      <nav className="tabs" aria-label="Seções">
        <button className={page === 'songs' ? 'on' : ''} onClick={() => setPage('songs')}>
          <span aria-hidden>🎬</span> Músicas
        </button>
        <button className={page === 'tuner' ? 'on' : ''} onClick={() => setPage('tuner')}>
          <span aria-hidden>🎚</span> Afinador
        </button>
      </nav>
    </div>
  );
}
