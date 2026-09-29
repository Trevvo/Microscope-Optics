// Full-screen SVG light path, laid out right → left:
//   SpectraX (right) → cube → objective → cell on the stage → cube → Gemini → cameras (left).
// Every optical slot is a clickable circle. Beams are coloured by the centroid of
// the light on that segment and faded by how much survives. Emission beams carry
// data-em="<cumulative key>" so the hover tooltip can decompose them.

import { centroid, passbandCenter, wavelengthCSS } from './color.js';
import { integrate, LAMBDA, N } from '../physics/grid.js';
import { xRange } from './plots.js';

// Layout is sized for laptop screens: a ~1.8:1 drawing that scales up to fill the stage.
export const VIEW = { w: 1320, h: 752 };
const LED_Y0 = 92;
const LED_DY = 110;
const STAGE_Y = 270; // top of the microscope stage
const CX = 680; // optical axis (cell, objective, cube dichroic, emitter)
const CELL_SCALE = 1.2;
const CAM_NAME = { A: 'Camera 1', B: 'Camera 2' };

/** Slot definitions: id, position, title, picker categories, and doc accessors. */
export function slots(doc) {
  const list = doc.leds.flatMap((l, i) => {
    const y = LED_Y0 + i * LED_DY;
    return [
      { id: `led:${l.key}`, x: 1222, y, r: 23, title: `${l.label} LED`, kind: 'led', cats: 'L', get: (d) => d.leds[i].spectrumId, set: (d, v) => (d.leds[i].spectrumId = v), ledKey: l.key },
      { id: `paddle:${l.key}`, x: 1122, y, r: 20, title: `${l.label} paddle filter`, kind: 'filter', cats: 'filter', get: (d) => d.leds[i].paddleId, set: (d, v) => (d.leds[i].paddleId = v), ledKey: l.key },
    ];
  });
  return list.concat([
    { id: 'exciter', x: 872, y: 432, title: 'Cube exciter', kind: 'filter', cats: 'filter', get: (d) => d.cube.exciterId, set: (d, v) => (d.cube.exciterId = v) },
    { id: 'cubeDichroic', x: 680, y: 432, title: 'Cube dichroic', kind: 'dichroic', cats: 'dichroic', get: (d) => d.cube.dichroicId, set: (d, v) => (d.cube.dichroicId = v) },
    { id: 'emitter', x: 680, y: 578, title: 'Cube emitter', kind: 'filter', cats: 'filter', get: (d) => d.cube.emitterId, set: (d, v) => (d.cube.emitterId = v) },
    { id: 'gemini', x: 420, y: 660, title: 'Gemini dichroic', kind: 'dichroic', cats: 'dichroic', get: (d) => d.splitter.dichroicId, set: (d, v) => (d.splitter.dichroicId = v) },
    { id: 'armA', x: 280, y: 660, title: 'Arm 1 filter', kind: 'filter', cats: 'filter', get: (d) => d.splitter.armA.filterId, set: (d, v) => (d.splitter.armA.filterId = v) },
    { id: 'camA', x: 112, y: 660, r: 32, title: 'Camera 1', kind: 'camera', cats: 'C', get: (d) => d.splitter.armA.cameraId, set: (d, v) => (d.splitter.armA.cameraId = v) },
    { id: 'armB', x: 420, y: 548, title: 'Arm 2 filter', kind: 'filter', cats: 'filter', get: (d) => d.splitter.armB.filterId, set: (d, v) => (d.splitter.armB.filterId = v) },
    { id: 'camB', x: 420, y: 418, r: 32, title: 'Camera 2', kind: 'camera', cats: 'C', get: (d) => d.splitter.armB.cameraId, set: (d, v) => (d.splitter.armB.cameraId = v) },
  ]);
}

const pct = (f) => (f == null ? '' : f >= 0.995 ? '100%' : f < 0.001 ? '<0.1%' : `${(f * 100).toFixed(f < 0.1 ? 1 : 0)}%`);
const fmt1 = (v) => (v >= 99.95 ? '100' : v >= 10 ? v.toFixed(0) : v >= 0.1 ? v.toFixed(1) : v > 0 ? '<0.1' : '0');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (s, n = 20) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function arc(x, y, r, f) {
  if (!(f > 0)) return '';
  if (f >= 0.999) return `<circle cx="${x}" cy="${y}" r="${r}" class="ring"/>`;
  const a = 2 * Math.PI * f - Math.PI / 2;
  return `<path class="ring" d="M${x},${y - r} A${r},${r} 0 ${f > 0.5 ? 1 : 0} 1 ${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}"/>`;
}

// ------------------------------------------------------------------ the cell

/** Side view of an adherent cell spread on the coverslip: thin lamellipodium on the leading
 *  (left) edge, low dome over the nucleus, trailing edge with a retraction fibre, a few organelles.
 *  Fluorophore spots sit in the cytoplasm and glow with their excitation. */
function cell(cx, base, fluors, colors, glow) {
  const P = (dx, dy) => `${cx + dx},${base + dy}`;
  const body = `M${P(-168, 0)}
    C${P(-150, -3)} ${P(-122, -6)} ${P(-98, -9)}
    C${P(-84, -11)} ${P(-76, -9)} ${P(-68, -14)}
    C${P(-60, -19)} ${P(-58, -28)} ${P(-48, -41)}
    C${P(-36, -57)} ${P(-14, -66)} ${P(8, -66)}
    C${P(34, -66)} ${P(50, -53)} ${P(58, -37)}
    C${P(66, -23)} ${P(78, -14)} ${P(96, -9)}
    C${P(110, -6)} ${P(118, -4)} ${P(126, -3)}
    L${P(128, 0)} Z`;
  const organelles = `
    <path d="M${P(-40, -20)} C${P(-34, -44)} ${P(-10, -54)} ${P(12, -54)} C${P(34, -54)} ${P(46, -42)} ${P(48, -22)}" class="er"/>
    <path d="M${P(-52, -12)} C${P(-46, -40)} ${P(-18, -60)} ${P(10, -60)}" class="er"/>
    <path d="M${P(44, -34)} q6,-4 12,0 M${P(45, -29)} q6,-4 12,0 M${P(46, -24)} q5,-3 10,0" class="golgi"/>
    <rect x="${cx - 88}" y="${base - 7}" width="12" height="4" rx="2" class="mito" transform="rotate(-6 ${cx - 82} ${base - 5})"/>
    <rect x="${cx - 62}" y="${base - 24}" width="13" height="4.5" rx="2.2" class="mito" transform="rotate(-38 ${cx - 55} ${base - 22})"/>
    <rect x="${cx + 62}" y="${base - 19}" width="12" height="4" rx="2" class="mito" transform="rotate(24 ${cx + 68} ${base - 17})"/>
    <rect x="${cx + 18}" y="${base - 61}" width="12" height="4" rx="2" class="mito" transform="rotate(8 ${cx + 24} ${base - 59})"/>
    <circle cx="${cx + 88}" cy="${base - 8}" r="2.2" class="vesicle"/><circle cx="${cx - 110}" cy="${base - 4}" r="1.6" class="vesicle"/>`;
  const nucleus = `
    <ellipse cx="${cx + 2}" cy="${base - 32}" rx="36" ry="19" class="nucleus"/>
    <circle cx="${cx - 14}" cy="${base - 28}" r="1.6" class="chromatin"/><circle cx="${cx - 4}" cy="${base - 40}" r="1.3" class="chromatin"/>
    <circle cx="${cx + 20}" cy="${base - 26}" r="1.5" class="chromatin"/><circle cx="${cx - 22}" cy="${base - 37}" r="1.2" class="chromatin"/>
    <ellipse cx="${cx + 9}" cy="${base - 35}" rx="8" ry="5.5" class="nucleolus"/>`;
  // fixed spots in the cytoplasm (not the nucleus) so the cell doesn't shimmer between renders
  const spots = [[-140, -2.5], [-118, -4.5], [-96, -6.5], [-72, -10], [-58, -20], [-48, -33], [-36, -48], [-18, -58], [28, -58], [46, -46], [56, -30], [70, -17], [86, -10], [106, -5.5], [-6, -8], [22, -8]];
  const dots = fluors.length
    ? spots.map(([dx, dy], i) => {
        const f = fluors[i % fluors.length];
        const g = glow[f.key] ?? 0;
        return `<circle cx="${cx + dx}" cy="${base + dy}" r="${(2.2 + 2.2 * g).toFixed(1)}" fill="${colors[f.key]}" opacity="${(0.3 + 0.7 * g).toFixed(2)}" ${g > 0.05 ? 'filter="url(#glow)"' : ''}/>`;
      }).join('')
    : '';
  return `<g class="cell" transform="translate(${cx} ${base}) scale(${CELL_SCALE}) translate(${-cx} ${-base})">
    <path d="${body}" class="cyto"/>
    <path d="M${P(126, -2)} L${P(160, -0.8)}" class="fibre"/>
    ${organelles}${nucleus}${dots}
    <path d="M${P(-44, -44)} C${P(-30, -58)} ${P(-10, -63)} ${P(8, -63)}" class="membrane-hi"/>
  </g>`;
}

// ------------------------------------------------------------------ excitation panel

/** FPbase-style excitation view drawn in SVG: fluor ex curves (dashed), excitation light at the
 *  sample (filled), and a solid line at each LED's peak with the % of each fluor's max excitation. */
function exPanel(x, y, w, h, ctx) {
  const { acq, store, doc, colors } = ctx;
  const head = `<g class="expanel-head" data-exmin="1" role="button" tabindex="0" aria-label="${ctx.exMin ? 'Show' : 'Minimise'} excitation plot">
      <rect x="${x}" y="${y}" width="${ctx.exMin ? 230 : w}" height="28" rx="7" class="panel-head"/>
      <text x="${x + 12}" y="${y + 19}" class="t-panel">Excitation at the sample</text>
      <text x="${x + (ctx.exMin ? 214 : w - 16)}" y="${y + 20}" class="t-panel" text-anchor="middle">${ctx.exMin ? '▸' : '–'}</text>
    </g>`;
  if (ctx.exMin) return head;
  const fl = doc.fluors.filter((f) => f.enabled).map((f) => ({ f, m: store.fluors.get(f.key) })).filter((o) => o.m && store.get(o.m.ex));
  const exc = acq?.excitation;
  const series = [...fl.map((o) => ({ data: store.get(o.m.ex) })), exc && integrate(exc) > 0 ? { data: exc } : null].filter(Boolean);
  const [x0, x1] = series.length ? xRange(series) : [350, 700];
  const rows = Math.max(1, Math.ceil(fl.length / Math.max(1, Math.min(3, fl.length))));
  const px = x + 16, pw = w - 32, py = y + 52, ph = h - 80;
  const sx = (l) => px + ((l - x0) / (x1 - x0)) * pw;
  const sy = (v) => py + ph - v * ph;
  const peak = (arr) => { let m = 0; for (let i = 0; i < N; i++) if (arr[i] > m) m = arr[i]; return m; };
  const path = (arr, close) => {
    const m = peak(arr);
    if (!(m > 0)) return '';
    let d = '';
    for (let i = 0; i < N; i++) {
      const l = LAMBDA[i];
      if (l < x0 || l > x1) continue;
      d += `${d ? 'L' : 'M'}${sx(l).toFixed(1)},${sy(arr[i] / m).toFixed(1)}`;
    }
    return close ? `${d}L${sx(x1).toFixed(1)},${sy(0)}L${sx(x0).toFixed(1)},${sy(0)}Z` : d;
  };
  const ticks = [];
  for (let t = Math.ceil(x0 / 50) * 50; t <= x1; t += 50) {
    ticks.push(`<line x1="${sx(t)}" x2="${sx(t)}" y1="${py}" y2="${py + ph}" class="grid"/><text x="${sx(t)}" y="${py + ph + 15}" class="t-axis" text-anchor="middle">${t}</text>`);
  }
  // each LED's light at the sample in its own colour, on a shared scale
  const excPeak = exc ? peak(exc) : 0;
  const ledFills = excPeak > 0 ? (acq?.ledLines ?? []).map((ln) => {
    let d = '';
    for (let i = 0; i < N; i++) {
      const l = LAMBDA[i];
      if (l < x0 || l > x1) continue;
      d += `${d ? 'L' : 'M'}${sx(l).toFixed(1)},${sy(ln.spectrum[i] / excPeak).toFixed(1)}`;
    }
    d += `L${sx(x1).toFixed(1)},${sy(0)}L${sx(x0).toFixed(1)},${sy(0)}Z`;
    return `<path d="${d}" fill="${wavelengthCSS(ln.lambda, 0.28)}" stroke="${wavelengthCSS(ln.lambda)}" stroke-opacity="0.8" stroke-width="1"/>`;
  }).join('') : '';
  const lines = (acq?.ledLines ?? []).map((ln) => {
    const X = sx(ln.lambda);
    if (X < px || X > px + pw) return '';
    const hits = fl.map((o, i) => {
      const ex = store.get(o.m.ex);
      const v = ex[Math.round(ln.lambda - LAMBDA[0])] / peak(ex);
      const Y = sy(v);
      return `<circle cx="${X}" cy="${Y}" r="3.5" fill="${colors[o.f.key]}" stroke="#000" stroke-width="1"/>
        <text x="${X + 7}" y="${Y - 5 + (i % 2) * 14}" class="t-hit" fill="${colors[o.f.key]}">${Math.round(v * 100)}%</text>`;
    }).join('');
    return `<line x1="${X}" x2="${X}" y1="${py}" y2="${py + ph}" stroke="${wavelengthCSS(ln.lambda)}" stroke-width="2"/>
      <text x="${X}" y="${py - 4}" class="t-axis" text-anchor="middle">${ln.lambda} nm</text>${hits}`;
  }).join('');
  const maxAbs = Math.max(0, ...(acq?.perFluor ?? []).map((p) => p.absorbed));
  const nCols = Math.max(1, Math.min(3, fl.length));
  const colW = (w - 20) / nCols;
  const maxChars = Math.max(8, Math.floor((colW - 50) / 6.5));
  const legend = fl.map((o, i) => {
    const p = acq?.perFluor.find((q) => q.key === o.f.key);
    const rel = maxAbs > 0 && p ? (100 * p.absorbed) / maxAbs : 0;
    return `<g transform="translate(${x + 12 + (i % nCols) * colW},${y + h + 4 + Math.floor(i / nCols) * 18})">
      <line x1="0" x2="14" y1="-5" y2="-5" stroke="${colors[o.f.key]}" stroke-width="2.2" stroke-dasharray="4 2"/>
      <text x="19" y="0" class="t-leg"><title>${esc(o.m.name)}: excited ${fmt1(rel)}% as strongly as the best-excited fluorophore</title>${esc(short(o.m.name, maxChars))} <tspan class="t-leg-v">${fmt1(rel)}</tspan></text></g>`;
  }).join('');
  return `${head}
    <g class="expanel">
      <rect x="${x}" y="${y + 28}" width="${w}" height="${h - 16 + rows * 18}" class="panel-body"/>
      ${ticks.join('')}
      ${ledFills}
      ${fl.map((o) => `<path d="${path(store.get(o.m.ex), true)}" fill="${colors[o.f.key]}" fill-opacity="0.12" stroke="none"/>`).join('')}
      ${fl.map((o) => `<path d="${path(store.get(o.m.ex))}" fill="none" stroke="${colors[o.f.key]}" stroke-opacity="0.85" stroke-width="1.6" stroke-dasharray="5 3"/>`).join('')}
      ${lines}
      ${!fl.length ? `<text x="${x + w / 2}" y="${py + ph / 2}" class="t-sub" text-anchor="middle">click the cell to add fluorophores</text>` : ''}
      ${!acq?.ledLines?.length ? `<text x="${x + w / 2}" y="${py + 14}" class="t-sub" text-anchor="middle">no LED on in this acquisition</text>` : ''}
      ${fl.length ? `<text x="${x + 12}" y="${y + h + 4 + rows * 18 - 3}" class="t-axis">legend value = relative excitation</text>` : ''}
      ${legend}
    </g>`;
}

// ------------------------------------------------------------------ camera readout

function camReadout(x, y, cam, ctx, W = 196) {
  const r = ctx.result;
  const ci = r ? r.channels.findIndex((c) => c.acq === ctx.acqIndex && c.cam === cam) : -1;
  const title = `<text x="${x}" y="${y}" class="t-readout-h">${CAM_NAME[cam]} sees</text>`;
  if (!r || ci < 0 || !r.fluors.length) return `<g class="readout">${title}<text x="${x}" y="${y + 20}" class="t-sub">${!r?.fluors.length ? 'no fluorophores' : 'no light (bypassed)'}</text></g>`;
  const segs = r.fluors.map((f, fi) => ({ f, v: r.composition[fi][ci] })).filter((s) => s.v > 0).sort((a, b) => b.v - a.v);
  const tot = r.signal.reduce((s, row) => s + row[ci], 0);
  const all = r.channels.map((_, j) => r.signal.reduce((s, row) => s + row[j], 0));
  const best = Math.max(...all);
  const rel = best > 0 ? (100 * tot) / best : 0;
  let acc = 0;
  const bar = segs.map((s) => {
    const w = (s.v / 100) * W;
    const out = `<rect x="${(x + acc).toFixed(1)}" y="${y + 8}" width="${Math.max(0, w).toFixed(1)}" height="16" fill="${ctx.colors[s.f.key]}"><title>${esc(s.f.name)}: ${fmt1(s.v)}%</title></rect>`;
    acc += w;
    return out;
  }).join('');
  const list = segs.slice(0, 4).map((s, i) => `<g transform="translate(${x},${y + 44 + i * 19})"><circle cx="6" cy="-5" r="5" fill="${ctx.colors[s.f.key]}"/>
      <text x="16" y="0" class="t-row">${esc(short(s.f.name, Math.floor((W - 60) / 6.6)))}</text><text x="${W}" y="0" class="t-row-v" text-anchor="end">${fmt1(s.v)}%</text></g>`).join('');
  return `<g class="readout">${title}
    <text x="${x + W}" y="${y}" class="t-sub" text-anchor="end"><title>Total signal relative to the brightest camera × acquisition</title>signal ${fmt1(rel)}${rel < 10 && tot ? ' · weak' : ''}</text>
    <rect x="${x}" y="${y + 8}" width="${W}" height="16" class="bar-bg"/>${bar}
    ${tot ? list : `<text x="${x}" y="${y + 44}" class="t-sub">no signal</text>`}
  </g>`;
}

// ------------------------------------------------------------------ cube presets button

function cubeButton(cx, cy, current) {
  const s = 13;
  return `<g class="cube-btn" data-cube="1" role="button" tabindex="0" aria-label="Premade cubes${current ? `: ${esc(current)} loaded` : ''}">
    <title>Premade cubes — load a whole filter cube at once</title>
    <rect x="${cx - 44}" y="${cy - 20}" width="88" height="52" rx="8" class="cube-hit"/>
    <path d="M${cx},${cy - s} L${cx + s},${cy - s / 2} L${cx},${cy} L${cx - s},${cy - s / 2} Z" class="cube-top"/>
    <path d="M${cx - s},${cy - s / 2} L${cx},${cy} L${cx},${cy + s} L${cx - s},${cy + s / 2} Z" class="cube-left"/>
    <path d="M${cx + s},${cy - s / 2} L${cx},${cy} L${cx},${cy + s} L${cx + s},${cy + s / 2} Z" class="cube-right"/>
    <text x="${cx}" y="${cy + s + 14}" class="t-cube" text-anchor="middle">${esc(current ?? 'presets ▾')}</text>
  </g>`;
}

// ------------------------------------------------------------------ main render

export function renderDiagram(el, ctx, handlers) {
  const { doc, store, acq, acqDoc } = ctx;
  const steps = Object.fromEntries((acq?.steps ?? []).map((s) => [s.id, s]));
  const S = slots(doc);
  const pos = Object.fromEntries(S.map((s) => [s.id, s]));
  const hasSplit = !!doc.splitter.dichroicId;
  const bypass = doc.splitter.bypassTo;

  // --- beams
  const srcTotal = steps.source ? integrate(steps.source.in) : 0;
  const emTotal = steps.sample ? integrate(steps.sample.out) : 0;
  const beam = (d, stepId, base, { cls = '', em = null } = {}) => {
    const arr = steps[stepId]?.out;
    const c = centroid(arr);
    const rel = arr && base > 0 ? integrate(arr) / base : 0;
    const col = c ? wavelengthCSS(c) : '#39404a';
    const op = rel > 0 ? Math.max(0.2, Math.min(1, 0.2 + Math.sqrt(rel))) : 0.5;
    const hit = em ? `<path d="${d}" class="beam-hit" data-em="${em}" data-label="${esc(steps[stepId]?.label ?? '')}"/>` : '';
    return `<path d="${d}" class="beam ${cls}" stroke="${col}" stroke-opacity="${op.toFixed(2)}" ${rel > 0.02 ? 'filter="url(#beamglow)"' : ''}/>${hit}`;
  };
  const beams = [];
  const JX = 1062, JY = 400; // light-guide junction
  doc.leds.forEach((l) => {
    const led = pos[`led:${l.key}`];
    const p = pos[`paddle:${l.key}`];
    const on = acqDoc?.ledsOn.includes(l.key) && l.spectrumId;
    const c = on ? centroid(steps[`paddle:${l.key}`]?.out) : null;
    const col = c ? wavelengthCSS(c) : '#39404a';
    beams.push(`<path d="M${led.x},${led.y} H${p.x}" class="beam thin" stroke="${col}" stroke-opacity="${on ? 0.95 : 0.5}"/>`);
    beams.push(`<path d="M${p.x},${p.y} C${p.x - 50},${p.y} ${JX + 30},${JY} ${JX},${JY}" class="beam thin" stroke="${col}" stroke-opacity="${on ? 0.95 : 0.5}"/>`);
  });
  beams.push(beam(`M${JX},${JY} C${JX - 90},${JY} ${pos.exciter.x + 120},${pos.exciter.y} ${pos.exciter.x},${pos.exciter.y}`, 'source', srcTotal, { cls: 'guide' }));
  beams.push(beam(`M${pos.exciter.x},${pos.exciter.y} H${pos.cubeDichroic.x}`, 'ex:exciter', srcTotal));
  beams.push(beam(`M${CX + 8},${pos.cubeDichroic.y} V${STAGE_Y + 6}`, 'ex:cubeDichroic', srcTotal));
  beams.push(beam(`M${CX - 8},${STAGE_Y + 6} V${pos.cubeDichroic.y}`, 'sample', emTotal, { em: 'sample' }));
  beams.push(beam(`M${CX - 8},${pos.cubeDichroic.y} V${pos.emitter.y}`, 'em:cubeDichroic', emTotal, { em: 'em:cubeDichroic' }));
  beams.push(beam(`M${pos.emitter.x},${pos.emitter.y} V${pos.gemini.y} H${pos.gemini.x}`, 'emitter', emTotal, { em: 'emitter' }));
  if (hasSplit || bypass === 'A') {
    beams.push(beam(`M${pos.gemini.x},${pos.gemini.y} H${pos.armA.x}`, 'gemini:A', emTotal, { em: 'gemini:A' }));
    beams.push(beam(`M${pos.armA.x},${pos.armA.y} H${pos.camA.x}`, 'armA', emTotal, { em: 'armA' }));
  }
  if (hasSplit || bypass === 'B') {
    beams.push(beam(`M${pos.gemini.x},${pos.gemini.y} V${pos.armB.y}`, 'gemini:B', emTotal, { em: 'gemini:B' }));
    beams.push(beam(`M${pos.armB.x},${pos.armB.y} V${pos.camB.y}`, 'armB', emTotal, { em: 'armB' }));
  }

  // --- nodes
  const nodeFrac = { exciter: steps['ex:exciter']?.frac, emitter: steps.emitter?.frac, armA: steps.armA?.frac, armB: steps.armB?.frac, camA: steps.camA?.frac, camB: steps.camB?.frac };
  const nodes = S.map((s) => {
    const r = s.r ?? 25;
    const id = s.get(doc);
    const comp = id ? store.components.get(id) : null;
    const disp = id ? store.display(id) : { title: '', brand: '' };
    const arr = store.get(id);
    let fill = '#15191e';
    if (arr) {
      const c = s.kind === 'filter' ? passbandCenter(arr) : s.kind === 'led' ? centroid(arr) : null;
      fill = c ? wavelengthCSS(c, 0.9) : '#2a3038';
    }
    const off = s.ledKey != null && !acqDoc?.ledsOn.includes(s.ledKey);
    let fracText = '';
    let ringF = null;
    if (s.id.startsWith('paddle:')) { ringF = steps[s.id]?.frac; fracText = id && !off ? pct(ringF) : ''; }
    else if (s.id === 'cubeDichroic') fracText = id && acq ? `R ${pct(steps['ex:cubeDichroic']?.frac)} · T ${pct(steps['em:cubeDichroic']?.frac)}` : '';
    else if (s.id === 'gemini') fracText = id && acq ? `←1 ${pct(steps['gemini:A']?.frac)} · ↑2 ${pct(steps['gemini:B']?.frac)}` : '';
    else if (s.kind === 'led') { const c = centroid(arr); fracText = c ? `${Math.round(c)} nm` : ''; }
    else if (s.id in nodeFrac) { ringF = nodeFrac[s.id]; fracText = id && acq ? pct(ringF) : ''; }
    const dimmed = ((s.id === 'camA' || s.id === 'armA') && !hasSplit && bypass !== 'A') || ((s.id === 'camB' || s.id === 'armB') && !hasSplit && bypass !== 'B');
    const small = s.ledKey != null;
    const glyph = !id
      ? `<text x="${s.x}" y="${s.y + 6}" class="plus" text-anchor="middle">+</text>`
      : s.kind === 'dichroic'
        ? `<line x1="${s.x - r * 0.62}" y1="${s.y - r * 0.62}" x2="${s.x + r * 0.62}" y2="${s.y + r * 0.62}" class="dc"/>`
        : s.kind === 'camera' ? `<rect x="${s.x - 10}" y="${s.y - 8}" width="20" height="16" rx="3" class="camglyph"/><circle cx="${s.x}" cy="${s.y}" r="4" class="camlens"/>` : '';
    const label = comp ? short(disp.title, small ? 16 : 26) : '';
    const brand = disp.brand ? `(${short(disp.brand, 30)})` : '';
    let text;
    if (s.kind === 'led') text = `<text x="${s.x}" y="${s.y + r + 16}" class="t-sub" text-anchor="middle">${esc(doc.leds.find((l) => l.key === s.ledKey)?.label ?? '')}${fracText ? ` · ${fracText}` : ''}</text>`;
    else if (small) text = `<text x="${s.x}" y="${s.y - r - 7}" class="t-sub" text-anchor="middle">${esc(label)}${fracText ? ` · ${fracText}` : ''}</text>`;
    else text = `<text x="${s.x}" y="${s.y - r - 10}" class="t-title" text-anchor="middle">${esc(s.title)}</text>
      <text x="${s.x}" y="${s.y + r + 17}" class="t-name" text-anchor="middle">${esc(label)}</text>
      ${brand ? `<text x="${s.x}" y="${s.y + r + 31}" class="t-brand" text-anchor="middle">${esc(brand)}</text>` : ''}
      <text x="${s.x}" y="${s.y + r + (brand ? 47 : 33)}" class="t-frac" text-anchor="middle">${esc(fracText)}</text>`;
    return `<g class="node ${id ? 'set' : 'empty'} ${off || dimmed ? 'off' : ''}" data-slot="${s.id}" tabindex="0" role="button" aria-label="${esc(s.title)}: ${esc(comp?.name ?? 'empty')}">
      <title>${esc(s.title)}: ${esc(comp ? (disp.brand ? `${disp.title} (${disp.brand})` : disp.title) : 'empty — click to choose')}</title>
      <circle cx="${s.x}" cy="${s.y}" r="${r}" class="disc" fill="${fill}"/>
      ${ringF != null && id && !off ? arc(s.x, s.y, r + 4, ringF) : ''}${glyph}${text}
    </g>`;
  }).join('');

  // LED on/off switches for the selected acquisition
  const toggles = doc.leds.map((l, i) => {
    const y = LED_Y0 + i * LED_DY;
    const on = acqDoc?.ledsOn.includes(l.key);
    const c = centroid(store.get(l.spectrumId));
    return `<g class="toggle ${on ? 'on' : ''} ${l.spectrumId ? '' : 'disabled'}" data-led="${l.key}" role="switch" aria-checked="${!!on}" tabindex="0" aria-label="${esc(l.label)} LED on/off">
      <title>${esc(l.label)} LED ${on ? 'on' : 'off'} in this acquisition — click to toggle</title>
      <rect x="1264" y="${y - 11}" width="40" height="22" rx="11" style="${on && c ? `fill:${wavelengthCSS(c)}` : ''}"/>
      <circle cx="${on ? 1293 : 1275}" cy="${y}" r="8"/></g>`;
  }).join('');

  // cell glow ∝ how strongly each fluorophore is excited in this acquisition
  const maxAbs = Math.max(0, ...(acq?.perFluor ?? []).map((p) => p.absorbed));
  const glow = Object.fromEntries((acq?.perFluor ?? []).map((p) => [p.key, maxAbs > 0 ? p.absorbed / maxAbs : 0]));
  const enabled = doc.fluors.filter((f) => f.enabled);
  const names = enabled.map((f) => store.fluors.get(f.key)?.name ?? f.key);

  el.innerHTML = `<svg viewBox="0 0 ${VIEW.w} ${VIEW.h}" class="diagram" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Light path">
    <defs>
      <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${VIEW.w}" height="${VIEW.h}"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="beamglow" filterUnits="userSpaceOnUse" x="0" y="0" width="${VIEW.w}" height="${VIEW.h}"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <linearGradient id="stageGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5a6470"/><stop offset="1" stop-color="#2c333b"/></linearGradient>
      <linearGradient id="cytoGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#a9d3e0" stop-opacity="0.42"/><stop offset="1" stop-color="#6f9fb2" stop-opacity="0.26"/></linearGradient>
      <radialGradient id="nucGrad" cx="0.42" cy="0.38" r="0.7"><stop offset="0" stop-color="#8f86e0" stop-opacity="0.7"/><stop offset="1" stop-color="#5a4fb5" stop-opacity="0.55"/></radialGradient>
    </defs>
    <rect x="1070" y="30" width="244" height="${LED_DY * (doc.leds.length - 1) + 110}" rx="14" class="box"/>
    <text x="1084" y="22" class="t-box">SPECTRA X</text>
    <rect x="596" y="378" width="370" height="262" rx="14" class="box"/>
    <text x="956" y="370" class="t-box" text-anchor="end">Filter cube</text>
    ${cubeButton(894, 578, ctx.cubePreset)}
    <rect x="226" y="482" width="268" height="246" rx="14" class="box"/>
    <text x="238" y="504" class="t-box">Gemini splitter</text>
    <path d="M${CX - 46},${STAGE_Y + 22} H${CX + 46} L${CX + 30},${STAGE_Y + 78} H${CX - 30} Z" class="objective"/>
    <text x="${CX + 58}" y="${STAGE_Y + 56}" class="t-box">Objective</text>
    ${beams.join('')}
    <rect x="${CX - 225}" y="${STAGE_Y}" width="450" height="16" rx="3" fill="url(#stageGrad)" class="stage"/>
    <text x="${CX - 216}" y="${STAGE_Y + 34}" class="t-box">Stage</text>
    <g class="node sample" data-slot="sample" tabindex="0" role="button" aria-label="Sample: ${enabled.length} fluorophores. Click to edit.">
      <title>Sample — click to add or remove fluorophores</title>
      <rect x="${CX - 205}" y="${STAGE_Y - 96}" width="400" height="97" fill="transparent"/>
      ${cell(CX, STAGE_Y, enabled, ctx.fluorColors, glow)}
      <text x="${CX}" y="${STAGE_Y - 96}" class="t-title t-sample" text-anchor="middle">${names.length ? esc(names.slice(0, 4).join(' · ')) + (names.length > 4 ? ` +${names.length - 4}` : '') : 'Sample — click to add fluorophores'}</text>
    </g>
    ${exPanel(24, 44, 430, 262, { acq, store, doc, colors: ctx.fluorColors, exMin: ctx.exMin })}
    ${nodes}
    ${toggles}
    ${camReadout(20, 500, 'A', ctx)}
    ${camReadout(150, 372, 'B', ctx, 222)}
    ${!hasSplit ? `<g class="bypass" data-bypass="1" role="button" tabindex="0"><text x="360" y="748" class="t-sub" text-anchor="middle">No Gemini dichroic → bypass to ${CAM_NAME[bypass]} (click to switch)</text></g>` : ''}
  </svg>`;

  const act = (sel, fn) => el.querySelectorAll(sel).forEach((g) => {
    g.addEventListener('click', (e) => fn(g, e));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(g, e); } });
  });
  act('[data-slot]', (g) => handlers.onSlot(g.dataset.slot, g.getBoundingClientRect()));
  act('[data-led]', (g) => handlers.onToggleLed(g.dataset.led));
  act('[data-bypass]', () => handlers.onSlot('bypass'));
  act('[data-exmin]', () => handlers.onToggleExMin());
  act('[data-cube]', (g) => handlers.onCubeMenu(g.getBoundingClientRect()));
  el.querySelectorAll('.beam-hit').forEach((p) => {
    p.addEventListener('mousemove', (e) => handlers.onBeamHover(p.dataset.em, p.dataset.label, e));
    p.addEventListener('mouseleave', () => handlers.onBeamHover(null));
    p.addEventListener('click', (e) => { handlers.onBeamHover(p.dataset.em, p.dataset.label, e); handlers.onBeamPin(); });
  });
}
