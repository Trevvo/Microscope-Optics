// Readout panels: per-channel composition bars (headline), crosstalk matrix,
// efficiency table, warnings, assumptions, and the step-by-step spectra strip.

import { plotSpectra, peakNorm, xRange } from './plots.js';
import { normalizePeakInRange } from '../physics/grid.js';
import { centroid, wavelengthCSS } from './color.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtPct = (v) => (v >= 99.95 ? '100' : v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : v > 0 ? '<0.01' : '0');
const fmtAbs = (f) => `${fmtPct(f * 100)}%`;
const CAM = { A: '1', B: '2' };

/**
 * @param ctx {doc, result, colors: {key→css}, onIntended(ai, cam, key), matrixMode, onMatrixMode(mode)}
 */
export function renderReadouts(el, ctx) {
  const { doc, result: r } = ctx;
  if (!r || !r.fluors.length) {
    el.innerHTML = `<div class="empty-state">Click the cell on the stage to add fluorophores.</div>`;
    return;
  }
  const colTotals = r.channels.map((_, ci) => r.signal.reduce((s, row) => s + row[ci], 0));
  const maxTotal = Math.max(...colTotals, 0);

  // --- 1. composition bars ---------------------------------------------
  const bars = r.channels.map((ch, ci) => {
    const acq = doc.acquisitions[ch.acq];
    const intended = acq.intended?.[ch.cam] ?? null;
    const segs = r.fluors
      .map((f, fi) => ({ f, v: r.composition[fi][ci] }))
      .filter((s) => s.v > 0)
      .sort((a, b) => b.v - a.v);
    const target = r.fluors.find((f) => f.key === intended);
    const rel = maxTotal > 0 ? (100 * colTotals[ci]) / maxTotal : 0;
    const weak = rel < 10 ? ` <span class="pill weak" title="Composition of a nearly empty channel is dominated by whatever trickles through">weak channel: ${rel < 0.1 ? '<0.1' : rel.toFixed(rel < 1 ? 1 : 0)}% of brightest</span>` : '';
    let verdict;
    if (!colTotals[ci]) verdict = '<span class="muted">no signal</span>';
    else if (target) {
      const ti = r.fluors.indexOf(target);
      const purity = r.composition[ti][ci];
      const worst = segs.find((s) => s.f.key !== target.key);
      const cls = purity >= 95 ? 'good' : purity >= 80 ? 'ok' : 'bad';
      verdict = `<span class="pill ${cls}">${esc(target.name)} ${fmtPct(purity)}% pure</span>${worst ? ` <span class="muted">largest bleed-through: ${esc(worst.f.name)} ${fmtPct(worst.v)}%</span>` : ''}`;
    } else {
      verdict = segs.length ? `<span class="muted">dominant: ${esc(segs[0].f.name)} ${fmtPct(segs[0].v)}%</span>` : '';
    }
    const options = ['<option value="">target…</option>', ...r.fluors.map((f) => `<option value="${f.key}" ${f.key === intended ? 'selected' : ''}>${esc(f.name)}</option>`)].join('');
    return `<div class="comp-row">
      <div class="comp-label"><span><b>${esc(acq.name || `Acq ${ch.acq + 1}`)}</b> · Camera ${CAM[ch.cam]}</span>
        <select class="intended" data-acq="${ch.acq}" data-cam="${ch.cam}" aria-label="Intended fluorophore">${options}</select></div>
      <div class="comp-bar" role="img" aria-label="${segs.map((s) => `${s.f.name} ${fmtPct(s.v)}%`).join(', ')}">
        ${segs.map((s) => `<span style="width:${s.v}%;background:${ctx.colors[s.f.key]}" title="${esc(s.f.name)}: ${fmtPct(s.v)}% of this camera's signal">${s.v > 9 ? `${esc(s.f.name)} ${fmtPct(s.v)}%` : ''}</span>`).join('')}
      </div>
      <div class="comp-verdict">${verdict}${colTotals[ci] ? weak : ''}</div>
      <div class="comp-total" title="Total signal in this channel relative to the brightest channel"><span style="width:${rel}%"></span><em>${rel.toFixed(0)}</em></div>
    </div>`;
  }).join('');

  // --- 2. matrix ----------------------------------------------------------
  const mode = ctx.matrixMode;
  const M = mode === 'col' ? r.composition : mode === 'row' ? r.rowPct : r.relBright;
  const cellBg = (v) => {
    if (!(v > 0)) return 'transparent';
    const t = mode === 'abs' ? Math.max(0, (Math.log10(v) + 2) / 4) : v / 100; // abs: 0.01 → 0, 100 → 1
    return `rgba(33, 102, 172, ${(0.08 + 0.8 * Math.min(1, t)).toFixed(2)})`;
  };
  const matrix = `<table class="matrix">
    <thead><tr><th></th>${r.channels.map((c) => `<th>${esc(doc.acquisitions[c.acq].name || `Acq ${c.acq + 1}`)}<br><span class="muted">Camera ${CAM[c.cam]}</span></th>`).join('')}</tr></thead>
    <tbody>${r.fluors.map((f, fi) => `<tr><th><i class="sw" style="background:${ctx.colors[f.key]}"></i>${esc(f.name)}</th>
      ${M[fi].map((v) => `<td style="background:${cellBg(v)};color:${cellBg(v) !== 'transparent' && (mode === 'abs' ? v > 10 : v > 55) ? '#fff' : 'inherit'}">${fmtPct(v)}</td>`).join('')}</tr>`).join('')}
    </tbody></table>`;

  // --- 3. efficiency table ----------------------------------------------
  const cams = r.activeCams;
  const eff = `<table class="eff">
    <thead><tr><th>Fluorophore</th><th>ex / em max</th>
      ${doc.acquisitions.map((a, ai) => `<th title="Fraction of LED photons that excite this fluorophore, as if delivered at its excitation peak">Exc. eff.<br><span class="muted">${esc(a.name || `Acq ${ai + 1}`)}</span></th>`).join('')}
      ${cams.map((c) => `<th title="Fraction of emitted photons detected by camera ${CAM[c]} (filters × QE)">Collected<br><span class="muted">→ Camera ${CAM[c]}</span></th>`).join('')}</tr></thead>
    <tbody>${r.fluors.map((f) => `<tr><th><i class="sw" style="background:${ctx.colors[f.key]}"></i>${esc(f.name)}</th>
      <td class="muted">${ctx.meta[f.key]?.exMax ? Math.round(ctx.meta[f.key].exMax) : '–'} / ${ctx.meta[f.key]?.emMax ? Math.round(ctx.meta[f.key].emMax) : '–'}</td>
      ${f.exEff.map((e) => `<td>${fmtAbs(e)}</td>`).join('')}
      ${cams.map((c) => `<td>${fmtAbs(f.collection[c])}</td>`).join('')}</tr>`).join('')}
    </tbody></table>`;

  el.innerHTML = `
    <section class="card">
      <h3>What each camera sees <span class="muted">— share of each channel's signal by fluorophore (all fluorophores equally bright at their peak)</span></h3>
      <div class="comp">${bars}</div>
      <p class="hint">Grey bar at right = channel's total signal relative to the brightest channel. Pick a target per channel to get purity.</p>
    </section>
    <section class="card">
      <h3>Crosstalk matrix
        <span class="seg" role="group">
          <button data-mode="abs" class="${mode === 'abs' ? 'on' : ''}" title="Signal relative to the brightest cell (=100), log colour scale">Relative signal</button>
          <button data-mode="col" class="${mode === 'col' ? 'on' : ''}" title="Each column sums to 100%: what a channel is made of">Channel composition %</button>
          <button data-mode="row" class="${mode === 'row' ? 'on' : ''}" title="Each row sums to 100%: where a fluorophore's detected signal ends up">Fluorophore distribution %</button>
        </span></h3>
      <div class="scroll">${matrix}</div>
    </section>
    <section class="card">
      <h3>Efficiencies <span class="muted">— absolute fractions, comparable across configs</span></h3>
      <div class="scroll">${eff}</div>
    </section>`;

  el.querySelectorAll('select.intended').forEach((s) =>
    s.addEventListener('change', () => ctx.onIntended(+s.dataset.acq, s.dataset.cam, s.value || null)));
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => ctx.onMatrixMode(b.dataset.mode)));
}

export function renderWarnings(el, list) {
  el.innerHTML = list.length
    ? `<ul class="warnings">${list.map((w) => `<li class="${w.level}">${esc(w.text)}</li>`).join('')}</ul>`
    : '<p class="muted">No warnings.</p>';
}

/** Overview plots + one small plot per step for the selected acquisition. */
export function renderJourney(el, ctx) {
  const { result: r, acqIndex, store, doc, colors } = ctx;
  const acq = r?.acquisitions[acqIndex];
  if (!acq) {
    el.innerHTML = '';
    return;
  }
  const cams = r.activeCams;
  const hide = new Set();
  if (!cams.includes('A')) ['gemini:A', 'armA', 'camA'].forEach((x) => hide.add(x));
  if (!cams.includes('B')) ['gemini:B', 'armB', 'camB'].forEach((x) => hide.add(x));
  const steps = acq.steps.filter((s) => !hide.has(s.id));

  el.innerHTML = `
    <div class="overview">
      <div class="card"><h4>Excitation at sample vs. absorption</h4><div class="plot" data-p="ex"></div></div>
      <div class="card"><h4>Emission vs. detection path</h4><div class="plot" data-p="em"></div></div>
    </div>
    <h4 class="strip-title">Spectrum at each step <span class="muted">— dashed: arriving light · line: element · filled: leaving light (arriving light's peak = 1)</span></h4>
    <div class="strip">${steps.map((s, i) => `<div class="step card"><div class="step-h"><span>${esc(s.label)}</span><b>${s.curve ? fmtAbs(s.frac) : ''}</b></div><div class="plot" data-s="${i}"></div></div>`).join('')}</div>`;

  const exSeries = [
    { label: 'Excitation at sample', data: peakNorm(acq.excitation), color: '#e0e0e0', fill: true, width: 2 },
    ...doc.fluors.filter((f) => f.enabled).map((f) => {
      const m = store.fluors.get(f.key);
      return m && store.get(m.ex) && { label: m.name, data: normalizePeakInRange(store.get(m.ex)), color: colors[f.key], dash: true };
    }).filter(Boolean),
  ];
  plotSpectra(el.querySelector('[data-p="ex"]'), exSeries, { height: 180, legend: true, sync: 'journey' });

  const emSeries = [
    ...cams.map((c) => ({ label: `Detection → Camera ${CAM[c]}`, data: r.detection[c], color: c === 'A' ? '#8bc34a' : '#ce93d8', width: 2 })),
    ...doc.fluors.filter((f) => f.enabled).map((f) => {
      const m = store.fluors.get(f.key);
      return m && { label: m.name, data: peakNorm(store.get(m.em)), color: colors[f.key], fill: true };
    }).filter(Boolean),
  ];
  plotSpectra(el.querySelector('[data-p="em"]'), emSeries, { height: 180, legend: true, sync: 'journey' });

  steps.forEach((s, i) => {
    const pk = peakNorm(s.in);
    let m = 0;
    for (const v of s.in) if (v > m) m = v;
    const out = m > 0 ? s.out.map((v) => v / m) : null;
    const c = centroid(s.out);
    const range = xRange([{ data: pk }, { data: out }]);
    plotSpectra(el.querySelector(`[data-s="${i}"]`), [
      { label: 'in', data: pk, color: '#8a94a0', dash: true },
      { label: 'element', data: s.curve, color: '#d0d6dc', width: 1 },
      { label: 'out', data: out, color: c ? wavelengthCSS(c) : '#666666', fill: true, width: 1.5 },
    ], { height: 110, sync: 'journey', range });
  });
}
