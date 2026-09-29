import { describe, it, expect } from 'vitest';
import { LAMBDA, N, integrate } from '../src/physics/grid.js';
import { simulate } from '../src/physics/simulate.js';

const gauss = (mu, sd) => Float64Array.from(LAMBDA, (l) => Math.exp(-0.5 * ((l - mu) / sd) ** 2));
const box = (lo, hi) => Float64Array.from(LAMBDA, (l) => (l >= lo && l <= hi ? 1 : 0));
const longpass = (edge) => Float64Array.from(LAMBDA, (l) => (l >= edge ? 1 : 0));

const green = { key: 'g', name: 'G', ec: 50000, qy: 0.6, ex: gauss(488, 15), em: gauss(510, 15) };
const red = { key: 'r', name: 'R', ec: 70000, qy: 0.2, ex: gauss(587, 15), em: gauss(610, 15) };
const leds = [
  { key: 'cyan', label: 'Cyan', spectrum: gauss(475, 10), paddle: null },
  { key: 'green', label: 'Green', spectrum: gauss(555, 10), paddle: null },
];

describe('detection bookkeeping', () => {
  it('split with no filters and QE=1 sends every emitted photon to A or B', () => {
    const r = simulate({
      leds, fluors: [green, red],
      splitter: { dichroic: longpass(560) },
      acquisitions: [{ name: 'a', ledsOn: ['cyan'] }],
    });
    for (const f of r.fluors) expect(f.collection.A + f.collection.B).toBeCloseTo(1, 6);
    // green sits below the 560 edge → reflected → camera B
    expect(r.fluors[0].collection.B).toBeGreaterThan(0.99);
    expect(r.fluors[1].collection.A).toBeGreaterThan(0.99);
  });

  it('bypass sends everything to the chosen camera and only that channel exists', () => {
    const r = simulate({ leds, fluors: [green], splitter: { bypassTo: 'B' }, acquisitions: [{ ledsOn: ['cyan'] }] });
    expect(r.channels.map((c) => c.cam)).toEqual(['B']);
    expect(r.fluors[0].collection.B).toBeCloseTo(1, 6);
    expect(r.fluors[0].collection.A).toBe(0);
  });
});

describe('analytic box-filter case', () => {
  it('collection equals the fraction of a Gaussian inside the emitter band', () => {
    // em ~ N(510, 15); inclusive box 495–525 covers 31 grid points = ±15.5 nm → erf(15.5/15/√2) ≈ 0.6986
    const r = simulate({
      leds, fluors: [green],
      cube: { emitter: box(495, 525) },
      acquisitions: [{ ledsOn: ['cyan'] }],
    });
    expect(r.fluors[0].collection.A).toBeCloseTo(0.6986, 3);
  });

  it('excitation overlap matches the closed form for Gaussian × Gaussian', () => {
    // LED N(475,10) photons ≈ power·λ/500; fluor ex peak-normalized N(488,15).
    // ∫ N(x;475,10)·exp(-(x-488)²/(2·15²)) dx = 15/√(10²+15²) · exp(-(13)²/(2(10²+15²)))
    const r = simulate({ leds: [leds[0]], fluors: [green], acquisitions: [{ ledsOn: ['cyan'] }] });
    const s2 = 10 ** 2 + 15 ** 2;
    const expected = (15 / Math.sqrt(s2)) * Math.exp(-(13 ** 2) / (2 * s2));
    // photon weighting λ/500 near 475–488 nm is ≈ 0.96; allow for it.
    const exEff = r.fluors[0].exEff[0];
    expect(exEff).toBeGreaterThan(expected * 0.97);
    expect(exEff).toBeLessThan(expected * 1.03);
  });
});

describe('linearity and normalization', () => {
  const base = {
    leds, splitter: { dichroic: longpass(560) },
    acquisitions: [{ name: 'c', ledsOn: ['cyan'] }, { name: 'g', ledsOn: ['green'] }],
  };

  it('signal scales linearly in EC and QY', () => {
    const a = simulate({ ...base, fluors: [green] });
    const b = simulate({ ...base, fluors: [{ ...green, ec: green.ec * 2, qy: green.qy * 1.5 }] });
    a.signal[0].forEach((v, i) => expect(b.signal[0][i]).toBeCloseTo(3 * v, 8));
  });

  it('composition columns and row percentages each sum to 100', () => {
    const r = simulate({ ...base, fluors: [green, red] });
    r.channels.forEach((_, ci) => {
      const s = r.composition.reduce((t, row) => t + row[ci], 0);
      expect(s).toBeCloseTo(100, 6);
    });
    r.rowPct.forEach((row) => expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6));
    expect(Math.max(...r.relBright.flat())).toBeCloseTo(100, 6);
  });

  it('equal LED power: doubling an LED spectrum amplitude changes nothing', () => {
    const a = simulate({ ...base, fluors: [green] });
    const big = leds.map((l) => ({ ...l, spectrum: l.spectrum.map((v) => v * 7) }));
    const b = simulate({ ...base, leds: big, fluors: [green] });
    a.signal[0].forEach((v, i) => expect(b.signal[0][i]).toBeCloseTo(v, 8));
  });
});

describe('steps and leakage', () => {
  it('step fractions multiply to the end-to-end throughput', () => {
    const r = simulate({
      leds, fluors: [green],
      cube: { exciter: box(460, 490), dichroic: longpass(500), emitter: box(505, 545) },
      acquisitions: [{ ledsOn: ['cyan'] }],
    });
    const st = Object.fromEntries(r.acquisitions[0].steps.map((s) => [s.id, s]));
    const chain = st['paddle:cyan'].frac * st['ex:exciter'].frac * st['ex:cubeDichroic'].frac;
    expect(st['ex:cubeDichroic'].total).toBeCloseTo(chain, 8);
    expect(integrate(st.camA.out) / integrate(st.sample.out)).toBeCloseTo(r.fluors[0].collection.A, 6);
  });

  it('excitation leakage is zero when the dichroic and emitter block the LED band', () => {
    const r = simulate({
      leds, fluors: [green],
      cube: { exciter: box(460, 490), dichroic: longpass(500), emitter: box(505, 545) },
      acquisitions: [{ ledsOn: ['cyan'] }],
    });
    expect(r.acquisitions[0].leakage.A.frac).toBe(0);
    expect(N).toBe(701);
  });
});

describe('per-fluorophore emission decomposition (beam hover)', () => {
  it('Σ_f emitted_f × cumulative[point] equals the step output at every emission point', () => {
    const r = simulate({
      leds, fluors: [green, red],
      cube: { dichroic: longpass(500), emitter: box(505, 700) },
      splitter: { dichroic: longpass(560), armA: { filter: box(590, 660) }, armB: { filter: box(500, 550) } },
      acquisitions: [{ ledsOn: ['cyan', 'green'] }],
    });
    const acq = r.acquisitions[0];
    const st = Object.fromEntries(acq.steps.map((s) => [s.id, s]));
    for (const [id, stepId] of [['em:cubeDichroic', 'em:cubeDichroic'], ['emitter', 'emitter'], ['gemini:A', 'gemini:A'], ['armB', 'armB']]) {
      const cum = r.cumulative[id];
      let sum = 0;
      for (const e of acq.emittedBy) for (let i = 0; i < N; i++) sum += e.spectrum[i] * cum[i];
      const direct = st[stepId].out.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(direct, 8);
    }
  });

  it('LED lines sit at the filtered LED peak and EC/QY default to 1', () => {
    const r = simulate({ leds, fluors: [{ key: 'x', name: 'X', ex: green.ex, em: green.em }], acquisitions: [{ ledsOn: ['cyan'] }] });
    expect(r.acquisitions[0].ledLines).toHaveLength(1);
    expect(Math.abs(r.acquisitions[0].ledLines[0].lambda - 476)).toBeLessThan(4); // N(475,10) × λ photon weighting
    expect(r.fluors[0].ec).toBe(1);
    expect(r.fluors[0].qy).toBe(1);
  });
});
