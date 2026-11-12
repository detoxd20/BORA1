interface Props {
  /** Desvio em cents (−50…+50 visível). */
  cents: number;
  active: boolean;
  inTune: boolean;
}

const CX = 160;
const CY = 156;
const R = 128;
const SPAN = 62; // graus para cada lado em ±50 cents

function polar(angleDeg: number, r: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

const TICKS = Array.from({ length: 21 }, (_, i) => (i - 10) * 5); // −50…+50 de 5 em 5

export function Gauge({ cents, active, inTune }: Props) {
  const clamped = Math.max(-50, Math.min(50, cents));
  const angle = (clamped / 50) * SPAN;
  const [ax, ay] = polar(-2.5 * (SPAN / 50), R + 2);
  const [bx, by] = polar(2.5 * (SPAN / 50), R + 2);
  return (
    <svg viewBox="0 0 320 176" className={`gauge ${active ? 'on' : ''} ${inTune ? 'tuned' : ''}`} role="img"
      aria-label={active ? `Desvio de ${Math.round(cents)} cents` : 'Sem sinal'}>
      <path
        className="gauge-zone"
        d={`M ${ax} ${ay} A ${R + 2} ${R + 2} 0 0 1 ${bx} ${by}`}
      />
      {TICKS.map((c) => {
        const major = c % 10 === 0;
        const ang = (c / 50) * SPAN;
        const [x1, y1] = polar(ang, R - (major ? 16 : 9));
        const [x2, y2] = polar(ang, R);
        return <line key={c} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'tick major' : 'tick'} />;
      })}
      {[-50, -25, 0, 25, 50].map((c) => {
        const [x, y] = polar((c / 50) * SPAN, R + 18);
        return (
          <text key={c} x={x} y={y} className="tick-label" textAnchor="middle" dominantBaseline="middle">
            {c === 0 ? '0' : c > 0 ? `+${c}` : `${c}`}
          </text>
        );
      })}
      <g className="needle" style={{ transform: `rotate(${active ? angle : 0}deg)` }}>
        <line x1={CX} y1={CY} x2={CX} y2={CY - R + 8} className="needle-line" />
      </g>
      <circle cx={CX} cy={CY} r={9} className="needle-hub" />
    </svg>
  );
}
