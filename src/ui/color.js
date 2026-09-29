import { LAMBDA, N } from '../physics/grid.js';

/** Approximate perceived colour of monochromatic light (Bruton), UV/IR shown as muted violet/crimson. */
export function wavelengthRGB(l) {
  let r = 0, g = 0, b = 0;
  if (l < 380) [r, g, b] = [0.38, 0.0, 0.55];
  else if (l < 440) [r, g, b] = [(440 - l) / 60, 0, 1];
  else if (l < 490) [r, g, b] = [0, (l - 440) / 50, 1];
  else if (l < 510) [r, g, b] = [0, 1, (510 - l) / 20];
  else if (l < 580) [r, g, b] = [(l - 510) / 70, 1, 0];
  else if (l < 645) [r, g, b] = [1, (645 - l) / 65, 0];
  else if (l <= 780) [r, g, b] = [1, 0, 0];
  else [r, g, b] = [0.5, 0.05, 0.1];
  let f = 1;
  if (l >= 380 && l < 420) f = 0.3 + (0.7 * (l - 380)) / 40;
  else if (l > 700 && l <= 780) f = 0.3 + (0.7 * (780 - l)) / 80;
  const c = (v) => Math.round(255 * Math.pow(v * f, 0.8));
  return [c(r), c(g), c(b)];
}

export const wavelengthCSS = (l, a = 1) => {
  const [r, g, b] = wavelengthRGB(l);
  return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
};

/** Intensity-weighted mean wavelength of a spectrum (null if empty). */
export function centroid(a) {
  if (!a) return null;
  let s = 0, w = 0;
  for (let i = 0; i < N; i++) {
    s += a[i];
    w += a[i] * LAMBDA[i];
  }
  return s > 1e-12 ? w / s : null;
}

/** Centre of the passband of a transmission curve (weights only T > 0.5). */
export function passbandCenter(t) {
  if (!t) return null;
  let s = 0, w = 0;
  for (let i = 0; i < N; i++) if (t[i] > 0.5) { s += t[i]; w += t[i] * LAMBDA[i]; }
  return s > 0 ? w / s : centroid(t);
}

const FALLBACK = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f'];

export function fluorColor(meta, i = 0) {
  if (meta?.color && /^#?[0-9a-f]{6}$/i.test(meta.color)) return meta.color.startsWith('#') ? meta.color : `#${meta.color}`;
  if (meta?.emMax) return wavelengthCSS(meta.emMax);
  return FALLBACK[i % FALLBACK.length];
}
