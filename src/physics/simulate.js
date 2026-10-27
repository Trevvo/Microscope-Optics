// Pure spectral model of the light path. No DOM, no fetching: every spectrum
// arrives as a Float64Array on the grid in ./grid.js (values 0–1), or null for
// an empty slot (treated as T = 1).
//
// Path: LEDs (+ paddle filters) → cube exciter → cube dichroic (reflect) → sample
//       → cube dichroic (transmit) → cube emitter → Gemini dichroic (T → A, R → B)
//       → arm filter → camera QE.
//
// Assumptions (surfaced in the UI): equal integrated optical power per enabled
// LED; dichroic R = 1 − T; 1-photon excitation far from saturation;
// objective/tube lens flat across λ. EC and QY default to 1 (every fluorophore
// equally bright at its excitation peak) unless the caller supplies them.

import { LAMBDA, N, mul, add, complement, integrate, dot, normalizeArea, normalizePeakInRange, zeros } from './grid.js';

const LREF = 500; // photons ∝ P·λ; divide by a reference so numbers stay O(1)

function toPhotons(power) {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = (power[i] * LAMBDA[i]) / LREF;
  return out;
}

const frac = (out, inp) => {
  const d = integrate(inp);
  return d > 0 ? integrate(out) / d : 0;
};

function step(id, label, inp, curve, out) {
  return { id, label, in: inp, curve, out, frac: frac(out, inp) };
}

/** Transmission from the sample to each camera port (everything after emission) for one cube. */
function detectionPaths(cube, sp) {
  let sA, sB;
  if (sp.dichroic) {
    sA = sp.dichroic;
    sB = complement(sp.dichroic);
  } else {
    const toA = (sp.bypassTo ?? 'A') === 'A';
    sA = toA ? null : zeros();
    sB = toA ? zeros() : null;
  }
  const common = mul(cube.dichroic, cube.emitter);
  const cams = {
    A: mul(common, sA, sp.armA?.filter, sp.armA?.camera),
    B: mul(common, sB, sp.armB?.filter, sp.armB?.camera),
  };
  // Cumulative transmission from the sample to each point on the emission path:
  // emission at a point for fluorophore f = emitted_f(λ) × cumulative[point](λ).
  const cum = { sample: null };
  cum['em:cubeDichroic'] = mul(cube.dichroic);
  cum.emitter = mul(cube.dichroic, cube.emitter);
  cum['gemini:A'] = mul(cum.emitter, sA);
  cum['gemini:B'] = mul(cum.emitter, sB);
  cum.armA = mul(cum['gemini:A'], sp.armA?.filter);
  cum.armB = mul(cum['gemini:B'], sp.armB?.filter);
  cum.camA = cams.A;
  cum.camB = cams.B;
  return { common, split: { A: sA, B: sB }, cams, cum, active: sp.dichroic ? ['A', 'B'] : [(sp.bypassTo ?? 'A')] };
}

/**
 * @param {object} input
 *   leds: [{key, label, spectrum, paddle}]
 *   cube: {exciter, dichroic, emitter} — default cube for acquisitions without their own
 *   splitter: {dichroic, bypassTo: 'A'|'B', armA: {filter, camera}, armB: {filter, camera}}
 *   fluors: [{key, name, ex, em, ec?, qy?}]
 *   acquisitions: [{name, ledsOn: [ledKey], cube?: {exciter, dichroic, emitter}}]
 *   fret: {donor, acceptor, E} | null — FRET between two of the fluorophores (keys), E in 0–1.
 *     Donor emission falls to (1 − E) of its value (E = 1 − F_DA/F_D, Lakowicz 2006 ch. 13);
 *     the transferred excitation E·A_D is emitted by the acceptor with its own QY
 *     (sensitized emission; Zal & Gascoigne 2004, Biophys J 86:3923). 1:1 stoichiometry.
 */
export function simulate(input) {
  const { leds = [], fluors = [], acquisitions = [] } = input;
  const sp = input.splitter ?? {};
  const fret = input.fret && input.fret.donor !== input.fret.acceptor ? input.fret : null;

  // Fluorophore shapes do not depend on the acquisition.
  const F = fluors.map((raw) => {
    const f = { ...raw, ec: raw.ec ?? 1, qy: raw.qy ?? 1 };
    return { ...f, exN: normalizePeakInRange(f.ex), emN: normalizeArea(f.em) }; // ex scaled by its 360–700 nm max; em per photon
  });

  const channels = [];
  const acqOut = acquisitions.map((acq, ai) => {
    const cube = acq.cube ?? input.cube ?? {};
    const det = detectionPaths(cube, sp);
    // An empty dichroic slot reflects nothing: excitation passes straight through and never
    // reaches the sample (emission still passes, T = 1).
    const cubeReflect = cube.dichroic ? complement(cube.dichroic) : zeros();
    const cubePass = cube.dichroic ?? null; // excitation transmitted through the dichroic (null = all)
    const collection = F.map((f) => ({ A: dot(f.emN, det.cams.A), B: dot(f.emN, det.cams.B) }));

    const on = leds.filter((l) => l.spectrum && acq.ledsOn?.includes(l.key));
    const ledSteps = [];
    const ledLines = []; // FPbase-style lines: where each LED's light peaks at the sample
    const exBy = []; // per LED: photons before (raw) and after its paddle, for the excitation hover
    let raw = zeros(); // LED photons before any filter
    let src = zeros(); // after paddles
    for (const l of on) {
      const p = toPhotons(normalizeArea(l.spectrum));
      const out = mul(p, l.paddle);
      ledSteps.push(step(`paddle:${l.key}`, `${l.label} paddle`, p, l.paddle, out));
      exBy.push({ key: l.key, name: l.label, raw: p, afterPaddle: out });
      raw = add(raw, p);
      src = add(src, out);
      const atS = mul(out, cube.exciter, cubeReflect);
      let pk = 0;
      for (let j = 1; j < N; j++) if (atS[j] > atS[pk]) pk = j;
      if (atS[pk] > 0) ledLines.push({ key: l.key, label: l.label, lambda: LAMBDA[pk], amount: integrate(atS), spectrum: atS });
    }
    // Cumulative transmission after the paddles to each point on the excitation path.
    const exCum = { source: null, 'ex:exciter': mul(cube.exciter), 'ex:cubeDichroic': mul(cube.exciter, cubeReflect), leak: mul(cube.exciter, cubePass) };
    const afterEx = mul(src, cube.exciter);
    const atSample = mul(afterEx, cubeReflect);
    const rawTotal = integrate(raw);
    // Excitation that goes straight through the cube dichroic instead of up to the sample.
    const passed = mul(afterEx, cubePass);
    const exTotal = integrate(afterEx);
    let pkPass = 0;
    for (let j = 1; j < N; j++) if (passed[j] > passed[pkPass]) pkPass = j;
    const cubeLeak = { passed, arriving: afterEx, frac: exTotal > 0 ? integrate(passed) / exTotal : 0, peakNm: passed[pkPass] > 0 ? LAMBDA[pkPass] : null };

    const perFluor = F.map((f) => {
      const overlap = dot(atSample, f.exN);
      return {
        key: f.key,
        absorbed: f.ec * overlap,
        // fraction of LED photons that end up exciting as if they were all at the ex peak
        exEff: rawTotal > 0 ? overlap / rawTotal : 0,
      };
    });

    // Emitted photons per fluorophore, without FRET (amount0) and with it (amount).
    const amount0 = F.map((f, i) => perFluor[i].absorbed * f.qy);
    const amount = [...amount0];
    const di = fret ? F.findIndex((f) => f.key === fret.donor) : -1;
    const ai2 = fret ? F.findIndex((f) => f.key === fret.acceptor) : -1;
    if (di >= 0 && ai2 >= 0) {
      const E = Math.max(0, Math.min(1, fret.E));
      const transferred = E * perFluor[di].absorbed;
      amount[di] = (perFluor[di].absorbed - transferred) * F[di].qy;
      amount[ai2] = (perFluor[ai2].absorbed + transferred) * F[ai2].qy;
    }
    perFluor.forEach((p, i) => { p.emitted = amount[i]; p.emitted0 = amount0[i]; });
    const spectraFor = (amt) => F.map((f, i) => {
      const e = new Float64Array(N);
      for (let j = 0; j < N; j++) e[j] = amt[i] * f.emN[j];
      return { key: f.key, name: f.name, spectrum: e };
    });
    // Emitted light at the sample, per fluorophore (FRET-adjusted) and summed.
    const emittedBy = spectraFor(amount);
    const emittedByNoFret = di >= 0 && ai2 >= 0 ? spectraFor(amount0) : emittedBy;
    const emitted = zeros();
    for (const e of emittedBy) for (let j = 0; j < N; j++) emitted[j] += e.spectrum[j];
    const afterCubeDc = mul(emitted, cube.dichroic);
    const afterEm = mul(afterCubeDc, cube.emitter);
    const toA = mul(afterEm, det.split.A);
    const toB = mul(afterEm, det.split.B);
    const armA = mul(toA, sp.armA?.filter);
    const armB = mul(toB, sp.armB?.filter);
    const camA = mul(armA, sp.armA?.camera);
    const camB = mul(armB, sp.armB?.camera);

    const steps = [
      ...ledSteps,
      step('source', 'Light engine output', raw, null, src),
      step('ex:exciter', 'Cube exciter', src, cube.exciter, afterEx),
      step('ex:cubeDichroic', 'Cube dichroic (reflected)', afterEx, cubeReflect, atSample),
      step('sample', 'Emission at sample', emitted, null, emitted),
      step('em:cubeDichroic', 'Cube dichroic (transmitted)', emitted, cube.dichroic, afterCubeDc),
      step('emitter', 'Cube emitter', afterCubeDc, cube.emitter, afterEm),
      step('gemini:A', 'Gemini → Camera 1', afterEm, det.split.A, toA),
      step('gemini:B', 'Gemini → Camera 2', afterEm, det.split.B, toB),
      step('armA', 'Arm 1 filter', toA, sp.armA?.filter, armA),
      step('armB', 'Arm 2 filter', toB, sp.armB?.filter, armB),
      step('camA', 'Camera 1 QE', armA, sp.armA?.camera, camA),
      step('camB', 'Camera 2 QE', armB, sp.armB?.camera, camB),
    ];
    // Overall excitation delivery (LED photons → sample).
    steps.find((s) => s.id === 'ex:cubeDichroic').total = rawTotal > 0 ? integrate(atSample) / rawTotal : 0;

    // Excitation light scattered back from the sample that reaches each camera.
    const leakage = {};
    const sampleTotal = integrate(atSample);
    for (const c of det.active) {
      const f = sampleTotal > 0 ? dot(atSample, det.cams[c]) / sampleTotal : 0;
      leakage[c] = { frac: f, od: f > 0 ? -Math.log10(f) : Infinity };
    }

    for (const c of det.active) channels.push({ acq: ai, cam: c, label: `${acq.name || `Acq ${ai + 1}`} · Camera ${c === 'A' ? 1 : 2}` });
    return {
      name: acq.name, ledsOn: on.map((l) => l.key), perFluor, steps, leakage, excitation: atSample, ledLines,
      emittedBy, emittedByNoFret, cubeLeak, exBy, exCum, collection,
      cumulative: det.cum, detection: det.cams, activeCams: det.active,
    };
  });

  // signal[f][ch] = emitted photons (absorbed · QY, FRET-adjusted) · that acquisition's collection
  const signal = F.map((f, fi) =>
    channels.map((ch) => acqOut[ch.acq].perFluor[fi].emitted * acqOut[ch.acq].collection[fi][ch.cam]),
  );
  const maxCell = Math.max(0, ...signal.flat());
  const colSum = channels.map((_, ci) => signal.reduce((s, row) => s + row[ci], 0));
  const rowSum = signal.map((row) => row.reduce((s, v) => s + v, 0));
  // Acquisition 0's detection stands in for callers that predate per-acquisition cubes.
  const first = acqOut[0] ?? detectionPaths(input.cube ?? {}, sp);
  const firstCollection = acqOut[0]?.collection ?? F.map((f) => ({ A: dot(f.emN, first.cams?.A ?? first.detection.A), B: dot(f.emN, first.cams?.B ?? first.detection.B) }));

  return {
    channels,
    fluors: F.map((f, fi) => ({
      key: f.key,
      name: f.name,
      ec: f.ec,
      qy: f.qy,
      brightness: (f.ec * f.qy) / 1000,
      collection: firstCollection[fi],
      collectionByAcq: acqOut.map((a) => a.collection[fi]),
      exEff: acqOut.map((a) => a.perFluor[fi].exEff),
    })),
    signal,
    relBright: signal.map((row) => row.map((v) => (maxCell > 0 ? (100 * v) / maxCell : 0))),
    composition: signal.map((row) => row.map((v, ci) => (colSum[ci] > 0 ? (100 * v) / colSum[ci] : 0))),
    rowPct: signal.map((row, fi) => row.map((v) => (rowSum[fi] > 0 ? (100 * v) / rowSum[fi] : 0))),
    acquisitions: acqOut,
    detection: acqOut[0]?.detection ?? first.cams,
    activeCams: acqOut[0]?.activeCams ?? first.active,
    cumulative: acqOut[0]?.cumulative ?? first.cum,
    fret: fret && F.some((f) => f.key === fret.donor) && F.some((f) => f.key === fret.acceptor) ? { ...fret } : null,
  };
}
