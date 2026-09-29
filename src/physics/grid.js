// Shared wavelength grid. Must match GRID in scripts/fetch_fpbase.py.
export const LMIN = 300;
export const LMAX = 1000;
export const N = LMAX - LMIN + 1; // 1 nm steps
export const LAMBDA = Float64Array.from({ length: N }, (_, i) => LMIN + i);

export const ones = () => new Float64Array(N).fill(1);
export const zeros = () => new Float64Array(N);

/** Elementwise product of any number of spectra; null/undefined factors are treated as 1. */
export function mul(...arrs) {
  const out = ones();
  for (const a of arrs) {
    if (!a) continue;
    for (let i = 0; i < N; i++) out[i] *= a[i];
  }
  return out;
}

export function add(a, b) {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = a[i] + b[i];
  return out;
}

export function scale(a, k) {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = a[i] * k;
  return out;
}

/** 1 - T, i.e. reflectance of a lossless dichroic. */
export function complement(a) {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = 1 - a[i];
  return out;
}

/** ∫ a(λ) dλ with 1 nm spacing (trapezoid). */
export function integrate(a) {
  let s = 0;
  for (let i = 0; i < N; i++) s += a[i];
  return s - 0.5 * (a[0] + a[N - 1]);
}

/** ∫ a·b dλ without allocating. */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < N; i++) s += a[i] * b[i];
  return s - 0.5 * (a[0] * b[0] + a[N - 1] * b[N - 1]);
}

export function normalizeArea(a) {
  const s = integrate(a);
  return s > 0 ? scale(a, 1 / s) : zeros();
}

/** Excitation spectra are scaled by their maximum within this band, so strong UV/sub-360 nm
 *  absorption (e.g. propidium iodide) doesn't shrink the visible band. Values may exceed 1 outside it. */
export const EX_NORM_RANGE = [360, 700];

export function normalizePeakInRange(a, lo = EX_NORM_RANGE[0], hi = EX_NORM_RANGE[1]) {
  let m = 0;
  for (let i = Math.max(0, lo - LMIN); i <= Math.min(N - 1, hi - LMIN); i++) if (a[i] > m) m = a[i];
  return m > 0 ? scale(a, 1 / m) : zeros();
}

export function normalizePeak(a) {
  let m = 0;
  for (let i = 0; i < N; i++) if (a[i] > m) m = a[i];
  return m > 0 ? scale(a, 1 / m) : zeros();
}

/** Resample arbitrary [[λ, v], ...] points onto the grid (linear, 0 outside). */
export function resamplePoints(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0]);
  const out = zeros();
  if (pts.length < 2) return out;
  let j = 0;
  for (let i = 0; i < N; i++) {
    const l = LAMBDA[i];
    if (l < pts[0][0] || l > pts[pts.length - 1][0]) continue;
    while (j < pts.length - 2 && pts[j + 1][0] < l) j++;
    const [l0, v0] = pts[j];
    const [l1, v1] = pts[j + 1];
    out[i] = l1 === l0 ? v0 : v0 + ((v1 - v0) * (l - l0)) / (l1 - l0);
  }
  return out;
}
