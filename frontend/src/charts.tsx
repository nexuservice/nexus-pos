import { formatClp } from '@nexus/core';

export const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'];

const nice = (max: number) => {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / p) * p;
};

/** Línea doble: ingresos (eje izquierdo, $) y ventas (eje derecho, n). */
export function TrendChart({ data }: { data: { label: string; revenue: number; count: number }[] }) {
  const W = 640, H = 220, L = 56, R = 36, T = 12, B = 28;
  const maxRev = nice(Math.max(...data.map((d) => d.revenue), 0));
  const maxCnt = nice(Math.max(...data.map((d) => d.count), 0));
  const x = (i: number) => L + (data.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (data.length - 1));
  const yR = (v: number) => T + (H - T - B) * (1 - v / maxRev);
  const yC = (v: number) => T + (H - T - B) * (1 - v / maxCnt);
  const path = (f: (d: (typeof data)[number]) => number, y: (v: number) => number) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(f(d))}`).join(' ');
  const every = Math.ceil(data.length / 8);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tendencia diaria de ventas e ingresos">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={yR(maxRev * t)} y2={yR(maxRev * t)} className="grid" />
            <text x={L - 6} y={yR(maxRev * t) + 4} textAnchor="end" className="tick">{formatClp(maxRev * t)}</text>
            <text x={W - R + 6} y={yC(maxCnt * t) + 4} className="tick">{Math.round(maxCnt * t)}</text>
          </g>
        ))}
        {data.length > 0 && <path d={path((d) => d.revenue, yR)} fill="none" stroke={PALETTE[1]} strokeWidth="2.5" />}
        {data.length > 0 && <path d={path((d) => d.count, yC)} fill="none" stroke={PALETTE[0]} strokeWidth="2.5" strokeDasharray="5 3" />}
        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={x(i)} cy={yR(d.revenue)} r="3.5" fill={PALETTE[1]}><title>{`${d.label}: ${formatClp(d.revenue)} · ${d.count} ventas`}</title></circle>
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="tick">{d.label.slice(5)}</text>}
          </g>
        ))}
      </svg>
      <figcaption className="legend"><span><i style={{ background: PALETTE[1] }} /> Ingresos ($)</span><span><i style={{ background: PALETTE[0] }} /> Ventas (n)</span></figcaption>
    </figure>
  );
}

export function Donut({ data, format = formatClp }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <figure className="chart donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="Distribución por medio de pago">
        {total === 0 ? <circle cx="100" cy="100" r={R} fill="none" className="grid" strokeWidth="26" /> : data.map((d, i) => {
          const len = (d.value / total) * C;
          const el = <circle key={d.label} cx="100" cy="100" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="26"
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)"><title>{`${d.label}: ${format(d.value)}`}</title></circle>;
          acc += len;
          return el;
        })}
        <text x="100" y="106" textAnchor="middle" className="donut-total">{format(total)}</text>
      </svg>
      <figcaption className="legend col">
        {data.map((d, i) => <span key={d.label}><i style={{ background: PALETTE[i % PALETTE.length] }} /> {d.label}: <b>{format(d.value)}</b></span>)}
      </figcaption>
    </figure>
  );
}

export function HBars({ data, format = formatClp }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="hbars" role="img" aria-label="Ingresos por categoría">
      {data.map((d, i) => (
        <div className="hbar" key={d.label}>
          <span className="hbar-l" title={d.label}>{d.label}</span>
          <div className="hbar-track"><div style={{ width: `${(d.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
          <b>{format(d.value)}</b>
        </div>
      ))}
    </div>
  );
}

export function VBars({ data, color = PALETTE[0], format = (n: number) => String(n) }: { data: { label: string; value: number }[]; color?: string; format?: (n: number) => string }) {
  const W = 320, H = 150, B = 22;
  const max = nice(Math.max(...data.map((d) => d.value), 0));
  const bw = (W - 8) / data.length;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de barras">
        {data.map((d, i) => {
          const h = (H - B - 6) * (d.value / max);
          return (
            <g key={d.label}>
              <rect x={4 + i * bw + 1} y={H - B - h} width={Math.max(2, bw - 3)} height={h} rx="3" fill={color}><title>{`${d.label}: ${format(d.value)}`}</title></rect>
              {(data.length <= 8 || i % 3 === 0) && <text x={4 + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="tick">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
