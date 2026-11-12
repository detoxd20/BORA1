import { memo } from 'react';
import { DIAGRAM_FRETS, diagramWindow, resolveShape } from '../chords/shapes';

interface Props {
  root: number;
  typeId: string;
  /** Altura em pixels. */
  height?: number;
  /** Escreve o nome da nota embaixo de cada corda. */
  showNotes?: boolean;
  color?: string;
  /** Forma escolhida pelo usuário (casas por corda). Sem isso, usa a melhor pela regra. */
  frets?: number[];
}

const XS = [18, 39, 61, 82]; // 4ª corda (grave) … 1ª corda (aguda), da esquerda para a direita
const TOP = 26;
const FRET_H = 18;
const FRETS = DIAGRAM_FRETS;

/** Formação do acorde no braço do cavaquinho (D G B D), calculada e validada no código. */
export const ChordDiagram = memo(function ChordDiagram({ root, typeId, height = 120, showNotes = true, color = '#f5a524', frets }: Props) {
  const shape = resolveShape(root, typeId, frets);
  if (!shape) return null;
  const { base, nut } = diagramWindow(shape);
  const bottom = TOP + FRET_H * FRETS;
  const vh = showNotes ? 136 : 124;
  return (
    <svg viewBox={`${nut ? 0 : -16} 0 ${nut ? 100 : 116} ${vh}`} height={height} width={(height * (nut ? 100 : 116)) / vh} role="img" aria-label={`Formação: casas ${shape.frets.join(', ')}`}>
      {/* casas */}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line key={i} x1={XS[0]} x2={XS[3]} y1={TOP + i * FRET_H} y2={TOP + i * FRET_H} stroke="#8a95a3" strokeWidth={i === 0 && nut ? 4 : 1.2} />
      ))}
      {/* cordas */}
      {XS.map((x, i) => (
        <line key={i} x1={x} x2={x} y1={TOP} y2={bottom} stroke="#c9d1db" strokeWidth={1.4} />
      ))}
      {!nut && (
        <text x={-14} y={TOP + FRET_H * 0.7} fontSize={12} fill="#c9d1db" fontWeight={700}>
          {base}ª
        </text>
      )}
      {shape.frets.map((f, i) =>
        f === 0 ? (
          <circle key={i} cx={XS[i]} cy={TOP - 10} r={5} fill="none" stroke="#e6ebf1" strokeWidth={1.8} />
        ) : (
          <g key={i}>
            <circle cx={XS[i]} cy={TOP + (f - base + 0.5) * FRET_H} r={7.6} fill={color} />
            <text x={XS[i]} y={TOP + (f - base + 0.5) * FRET_H + 3.6} textAnchor="middle" fontSize={10} fontWeight={800} fill="#1a1100">
              {shape.fingers[i]}
            </text>
          </g>
        ),
      )}
      {showNotes &&
        shape.notes.map((n, i) => (
          <text key={i} x={XS[i]} y={bottom + 14} textAnchor="middle" fontSize={11} fontWeight={700} fill="#e6ebf1">
            {n}
          </text>
        ))}
    </svg>
  );
});

/** Cor do acorde: uma matiz por nota fundamental (C, C#, D …). */
export const chordHue = (root: number) => root * 30;
