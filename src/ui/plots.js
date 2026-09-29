// Thin uPlot wrapper for spectra on the shared λ grid.
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { LAMBDA, N } from '../physics/grid.js';

const instances = new WeakMap();
const AXIS = {
  gap: 2,
  font: '10px system-ui',
  stroke: '#8d97a3',
  grid: { stroke: 'rgba(255,255,255,0.07)', width: 1 },
  ticks: { stroke: 'rgba(255,255,255,0.15)', width: 1, size: 3 },
};

function translucent(c, a = 0.22) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return `${c}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
  const m = c.match(/^rgba?\(([^)]+)\)/);
  if (m) return `rgba(${m[1].split(',').slice(0, 3).join(',')},${a})`;
  return c;
}

/** x-range covering where any series is non-negligible, padded. */
export function xRange(series) {
  let lo = N, hi = 0;
  for (const s of series) {
    if (!s.data) continue;
    let m = 0;
    for (let i = 0; i < N; i++) if (s.data[i] > m) m = s.data[i];
    const t = m * 0.01;
    for (let i = 0; i < N; i++) if (s.data[i] > t) { lo = Math.min(lo, i); break; }
    for (let i = N - 1; i >= 0; i--) if (s.data[i] > t) { hi = Math.max(hi, i); break; }
  }
  if (hi <= lo) return [380, 780];
  return [Math.max(300, LAMBDA[lo] - 25), Math.min(1000, LAMBDA[hi] + 25)];
}

/**
 * @param series [{label, data: Float64Array|null, color, fill: bool, dash: bool, width}]
 * @param opts {height, legend, sync: string, range: [lo, hi], yMax}
 */
export function plotSpectra(el, series, opts = {}) {
  instances.get(el)?.destroy();
  el.innerHTML = '';
  const live = series.filter((s) => s.data);
  if (!live.length) {
    el.innerHTML = '<div class="plot-empty">no light here</div>';
    return;
  }
  const width = Math.max(160, el.clientWidth || 300);
  const [x0, x1] = opts.range ?? xRange(live);
  const u = new uPlot(
    {
      width,
      height: opts.height ?? 160,
      legend: { show: !!opts.legend, live: false },
      cursor: { sync: opts.sync ? { key: opts.sync } : undefined, points: { show: false }, drag: { x: false, y: false } },
      scales: { x: { time: false, range: [x0, x1] }, y: { range: [0, opts.yMax ?? 1.05] } },
      axes: [
        { ...AXIS, size: 28, values: (u, v) => v.map((x) => `${x}`) },
        { ...AXIS, size: 30, values: (u, v) => v.map((x) => (x >= 1 ? x.toFixed(0) : x.toFixed(1))) },
      ],
      series: [
        { label: 'nm' },
        ...live.map((s) => ({
          label: s.label,
          stroke: translucent(s.color, 0.85),
          width: s.width ?? 1.5,
          dash: s.dash ? [4, 3] : undefined,
          fill: s.fill ? translucent(s.color, 0.2) : undefined,
          points: { show: false },
        })),
      ],
    },
    [Array.from(LAMBDA), ...live.map((s) => Array.from(s.data))],
    el,
  );
  instances.set(el, u);
}

/** Peak-normalise for display (returns null for empty). */
export function peakNorm(a) {
  if (!a) return null;
  let m = 0;
  for (let i = 0; i < N; i++) if (a[i] > m) m = a[i];
  if (m <= 0) return null;
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = a[i] / m;
  return out;
}
