// Hover tooltip for emission beams: the light at that point in the path, one
// translucent area per fluorophore (overlaps stay visible) plus the total, and
// how much of the originally emitted light is left. Clicking a beam pins the
// tooltip; moving over its chart then reads out the mix at each wavelength.

import { LAMBDA, N } from '../physics/grid.js';

let tip = null;
let pinned = false;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v) => (v >= 99.95 ? '100' : v >= 10 ? v.toFixed(0) : v >= 0.1 ? v.toFixed(1) : v > 0 ? '<0.1' : '0');

function ensure() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'beam-tip';
  tip.hidden = true;
  tip.innerHTML = `<div class="bt-h"></div><div class="bt-plot"><canvas width="600" height="260"></canvas><div class="bt-line" hidden></div></div>
    <div class="bt-axis"></div><div class="bt-at"></div><ul class="bt-list"></ul>
    <div class="bt-hint">click the beam to pin · then hover the chart for each wavelength</div><button class="bt-close" hidden aria-label="Close">×</button>`;
  document.body.appendChild(tip);
  const cv = tip.querySelector('canvas');
  const line = tip.querySelector('.bt-line');
  const at = tip.querySelector('.bt-at');
  cv.addEventListener('mousemove', (e) => {
    const st = tip._state;
    if (!st) return;
    const r = cv.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const i = Math.round(st.lo + fx * (st.hi - st.lo));
    if (i < st.lo || i > st.hi) return;
    line.hidden = false;
    line.style.left = `${fx * 100}%`;
    const tot = st.parts.reduce((a, p) => a + p.s[i], 0);
    at.innerHTML = `<b>${LAMBDA[i]} nm</b> ${tot > 0
      ? st.parts.filter((p) => p.s[i] > 0).sort((a, b) => b.s[i] - a.s[i]).map((p) => `<span><i style="background:${st.colors[p.key]}"></i>${esc(p.name)} ${fmt((100 * p.s[i]) / tot)}%</span>`).join('')
      : '<span class="muted">no light</span>'}`;
  });
  cv.addEventListener('mouseleave', () => { line.hidden = true; at.innerHTML = ''; });
  tip.querySelector('.bt-close').addEventListener('click', () => { pinned = false; hideBeamTip(true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pinned) { pinned = false; hideBeamTip(true); } });
  return tip;
}

export function hideBeamTip(force = false) {
  if (!tip || (pinned && !force)) return;
  tip.hidden = true;
}

export function pinBeamTip() {
  if (!tip || tip.hidden) return;
  pinned = true;
  tip.classList.add('pinned');
  tip.querySelector('.bt-close').hidden = false;
}

export const isPinned = () => pinned;

/**
 * @param ctx {acq (simulate acquisition output), cumulative (Float64Array|null), label, colors, event}
 */
export function showBeamTip({ acq, cumulative, label, colors, event }) {
  const el = ensure();
  if (pinned) return; // keep the pinned view until it is closed
  el.classList.remove('pinned');
  el.querySelector('.bt-close').hidden = true;
  el.querySelector('.bt-at').innerHTML = '';
  const parts = acq.emittedBy.map((e) => {
    const s = new Float64Array(N);
    for (let i = 0; i < N; i++) s[i] = e.spectrum[i] * (cumulative ? cumulative[i] : 1);
    let tot = 0, orig = 0;
    for (let i = 0; i < N; i++) { tot += s[i]; orig += e.spectrum[i]; }
    return { ...e, s, tot, orig };
  });
  const total = parts.reduce((a, p) => a + p.tot, 0);
  const emitted = parts.reduce((a, p) => a + p.orig, 0);

  // x-range: where the emitted light lives (stable while moving along the path)
  let lo = N, hi = 0, pk = 0;
  const sum = new Float64Array(N);
  for (const p of parts) for (let i = 0; i < N; i++) sum[i] += p.s[i];
  const orig = new Float64Array(N);
  for (const p of parts) for (let i = 0; i < N; i++) orig[i] += p.spectrum[i];
  let om = 0;
  for (let i = 0; i < N; i++) { if (orig[i] > om) om = orig[i]; if (sum[i] > pk) pk = sum[i]; }
  for (let i = 0; i < N; i++) if (orig[i] > om * 0.01) { lo = i; break; }
  for (let i = N - 1; i >= 0; i--) if (orig[i] > om * 0.01) { hi = i; break; }
  if (hi <= lo) { lo = 150; hi = 450; }
  lo = Math.max(0, lo - 10); hi = Math.min(N - 1, hi + 10);

  el.querySelector('.bt-h').innerHTML = `<b>${esc(label || 'Emission')}</b><span>${emitted > 0 ? `${fmt((100 * total) / emitted)}% of emitted light remains` : 'no emission'}</span>`;

  const cv = el.querySelector('canvas');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 6;
  g.clearRect(0, 0, W, H);
  const X = (i) => pad + ((i - lo) / (hi - lo)) * (W - 2 * pad);
  const Y = (v) => H - pad - (pk > 0 ? v / pk : 0) * (H - 2 * pad);
  // grid every 50 nm
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  for (let l = Math.ceil(LAMBDA[lo] / 50) * 50; l <= LAMBDA[hi]; l += 50) {
    const x = X(l - LAMBDA[0]);
    g.beginPath(); g.moveTo(x, pad); g.lineTo(x, H - pad); g.stroke();
  }
  // original emission outline (dashed) scaled the same way, clipped to the plot
  if (pk > 0) {
    g.save();
    g.setLineDash([6, 5]);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    for (let i = lo; i <= hi; i++) { const y = Math.max(pad, Y(orig[i])); i === lo ? g.moveTo(X(i), y) : g.lineTo(X(i), y); }
    g.stroke();
    g.restore();
  }
  // one translucent area per fluorophore, drawn biggest first so small ones stay on top
  for (const p of [...parts].sort((a, b) => b.tot - a.tot)) {
    if (p.tot <= 0) continue;
    g.beginPath();
    g.moveTo(X(lo), Y(0));
    for (let i = lo; i <= hi; i++) g.lineTo(X(i), Y(p.s[i]));
    g.lineTo(X(hi), Y(0));
    g.closePath();
    g.fillStyle = colors[p.key] ?? '#888';
    g.globalAlpha = 0.4;
    g.fill();
    g.globalAlpha = 0.95;
    g.strokeStyle = colors[p.key] ?? '#888';
    g.lineWidth = 2;
    g.stroke();
    g.globalAlpha = 1;
  }
  // total light (thin white) when more than one fluorophore contributes
  if (parts.filter((p) => p.tot > 0).length > 1) {
    g.beginPath();
    for (let i = lo; i <= hi; i++) g.lineTo(X(i), Y(sum[i]));
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  el.querySelector('.bt-axis').innerHTML = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${Math.round(LAMBDA[lo] + f * (LAMBDA[hi] - LAMBDA[lo]))}</span>`).join('');

  el.querySelector('.bt-list').innerHTML = parts
    .filter((p) => p.orig > 0)
    .sort((a, b) => b.tot - a.tot)
    .map((p) => `<li><i style="background:${colors[p.key]}"></i>${esc(p.name)}<span>${total > 0 ? fmt((100 * p.tot) / total) : '0'}% of light here</span><em>${fmt((100 * p.tot) / p.orig)}% of its emission left</em></li>`)
    .join('') || '<li class="muted">No fluorophores excited</li>';

  el._state = { parts, lo, hi, colors };

  el.hidden = false;
  const r = el.getBoundingClientRect();
  let left = event.clientX + 18;
  let top = event.clientY + 18;
  if (left + r.width > window.innerWidth - 8) left = event.clientX - r.width - 18;
  if (top + r.height > window.innerHeight - 8) top = event.clientY - r.height - 18;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}
