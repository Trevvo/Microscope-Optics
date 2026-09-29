// Display label + search keys for a filter from its transmission curve.
// Mirror of describe() in scripts/fetch_fpbase.py (the snapshot labels are
// precomputed there; this is used for custom spectra). tests/describe.test.js
// checks the two agree.
//   bandpass/multiband → "center ± half-width" per passband (FWHM at 50% of max T)
//   long/shortpass     → "LP edge" / "SP edge"
//   dichroic (BS)      → 50% edge(s) where T rises, "652 nm" or "410/495/574/654 nm"

import { LMIN, N } from '../physics/grid.js';

const round = (x) => Math.round(x);
// Python's round() is banker's rounding; match it so labels agree exactly.
const pyRound = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return round(x);
};

/** @param t Float64Array on the grid (0–1); range [lo, hi] measured nm (defaults to where t > 0). */
export function describe(t, sub, range) {
  let r = range;
  if (!r) {
    let a = -1, b = -1;
    for (let i = 0; i < N; i++) if (t[i] > 0) { if (a < 0) a = i; b = i; }
    if (a < 0) return { label: null, alt: '' };
    r = [LMIN + a, LMIN + b];
  }
  const loI = Math.max(0, Math.ceil(r[0]) - LMIN);
  const hiI = Math.min(N - 1, Math.floor(r[1]) - LMIN);
  if (hiI - loI < 5) return { label: null, alt: '' };
  const n = hiI - loI + 1;
  const seg = new Float64Array(n);
  const lam = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = loI + k;
    lam[k] = LMIN + i;
    // numpy convolve(..., ones(3)/3, 'same') within the segment (zero-padded ends), ends replaced below
    const a = k > 0 ? t[i - 1] : 0;
    const c = k < n - 1 ? t[i + 1] : 0;
    seg[k] = (a + t[i] + c) / 3;
  }
  seg[0] = t[loI];
  seg[n - 1] = t[hiI];
  let mx = 0;
  for (let k = 0; k < n; k++) if (seg[k] > mx) mx = seg[k];
  const thr = 0.5 * mx;
  if (!(thr > 0)) return { label: null, alt: '' };
  const cross = [];
  for (let k = 1; k < n; k++) {
    const up = seg[k] >= thr;
    if (up !== seg[k - 1] >= thr) cross.push([lam[k - 1] + (thr - seg[k - 1]) / (seg[k] - seg[k - 1]), up]);
  }
  const clean = [];
  for (const c of cross) {
    const last = clean[clean.length - 1];
    if (last && c[1] !== last[1] && c[0] - last[0] < 6) clean.pop();
    else clean.push(c);
  }
  const alt = [];
  if (sub === 'BS') {
    const inR = (x) => x >= 350 && x <= 950;
    const ups = clean.filter(([x, up]) => up && inR(x)).map(([x]) => pyRound(x));
    const downs = clean.filter(([x, up]) => !up && inR(x)).map(([x]) => pyRound(x));
    const edges = ups.length ? ups : downs;
    if (!edges.length) return { label: null, alt: '' };
    for (const e of edges) alt.push(String(e), `${e} dichroic`, `${e}nm`);
    return { label: `${edges.join('/')}${ups.length ? ' nm' : ' nm SP'}`, alt: alt.join(' ') };
  }
  let bands = [];
  let start = seg[0] >= thr ? lam[0] : null;
  for (const [x, up] of clean) {
    if (up) start = x;
    else if (start != null) { bands.push([start, x, start === lam[0], false]); start = null; }
  }
  if (start != null) bands.push([start, lam[n - 1], start === lam[0], true]);
  bands = bands.filter((b) => b[1] - b[0] >= 2);
  const shown = bands.filter((b) => (b[0] + b[1]) / 2 >= 350 && (b[0] + b[1]) / 2 <= 850);
  if (shown.length) bands = shown;
  if (!bands.length) return { label: null, alt: '' };
  const parts = [];
  for (const [lo, hi, openLo, openHi] of bands.slice(0, 6)) {
    if (openHi && !openLo) {
      const e = pyRound(lo);
      parts.push(`LP ${e}`);
      alt.push(String(e), `LP${e}`, `${e}LP`);
    } else if (openLo && !openHi) {
      const e = pyRound(hi);
      parts.push(`SP ${e}`);
      alt.push(String(e), `SP${e}`, `${e}SP`);
    } else {
      const c = pyRound((lo + hi) / 2), w = pyRound(hi - lo), h = pyRound((hi - lo) / 2);
      parts.push(`${c} ± ${h}`);
      alt.push(`${c}/${w}`, `${c}±${h}`, String(c));
    }
  }
  return { label: bands.length <= 6 ? parts.join(' / ') : `multiband (${bands.length})`, alt: alt.join(' ') };
}
