// Turns a stored config (spectrum IDs) into simulate() input (arrays), and
// collects warnings about things the physics silently assumes.

import { LAMBDA, N } from './physics/grid.js';
import { referencedIds } from './schema.js';

export function idsToLoad(doc, store) {
  const fl = doc.fluors.flatMap((f) => {
    const m = store.fluors.get(f.key);
    return m ? [m.ex, m.em] : [];
  });
  return [...referencedIds(doc), ...fl];
}

export function resolve(doc, store) {
  const g = (id) => store.get(id);
  const s = doc.splitter;
  const fluors = [];
  const skipped = [];
  doc.fluors.forEach((f) => {
    if (!f.enabled) return;
    const meta = store.fluors.get(f.key);
    if (!meta || !g(meta.ex) || !g(meta.em)) {
      skipped.push({ key: f.key, name: meta?.name ?? f.key, reason: !meta ? 'unknown fluorophore' : 'spectrum not loaded' });
      return;
    }
    // EC and QY are deliberately not used: every fluorophore is equally bright at its peak.
    fluors.push({ key: f.key, name: meta.name, ex: g(meta.ex), em: g(meta.em) });
  });
  return {
    input: {
      leds: doc.leds.map((l) => ({ key: l.key, label: l.label, spectrum: g(l.spectrumId), paddle: g(l.paddleId) })),
      cube: { exciter: g(doc.cube.exciterId), dichroic: g(doc.cube.dichroicId), emitter: g(doc.cube.emitterId) },
      splitter: {
        dichroic: g(s.dichroicId),
        bypassTo: s.bypassTo,
        armA: { filter: g(s.armA.filterId), camera: g(s.armA.cameraId) },
        armB: { filter: g(s.armB.filterId), camera: g(s.armB.cameraId) },
      },
      fluors,
      acquisitions: doc.acquisitions,
    },
    skipped,
  };
}

export function warnings(doc, store, result, skipped) {
  const w = [];
  for (const s of skipped) w.push({ level: 'warn', text: `${s.name} is excluded from readouts: ${s.reason}.` });
  if (!doc.cube.dichroicId) w.push({ level: 'info', text: 'No cube dichroic selected: it is treated as reflecting all excitation and transmitting all emission (R = T = 1), which is unphysical. Choose your cube dichroic.' });
  if (!doc.splitter.dichroicId) w.push({ level: 'info', text: `No Gemini dichroic: all emission goes to Camera ${doc.splitter.bypassTo === 'A' ? 1 : 2} (bypass).` });
  doc.acquisitions.forEach((a, ai) => {
    if (!a.ledsOn.length) w.push({ level: 'warn', text: `${a.name || `Acq ${ai + 1}`} has no LEDs switched on.` });
  });

  // Filter coverage: how much of each fluorophore's emission falls where a
  // detection-path element was never measured (and is therefore taken as T = 0).
  if (result) {
    const ems = doc.fluors
      .filter((f) => f.enabled)
      .map((f) => store.fluors.get(f.key))
      .filter((m) => m && store.get(m.em))
      .map((m) => ({ name: m.name, em: store.get(m.em) }));
    const s = doc.splitter;
    for (const [label, id] of [
      ['Cube dichroic', doc.cube.dichroicId], ['Cube emitter', doc.cube.emitterId], ['Gemini dichroic', s.dichroicId],
      ['Arm 1 filter', s.armA.filterId], ['Arm 2 filter', s.armB.filterId], ['Camera 1', s.armA.cameraId], ['Camera 2', s.armB.cameraId],
    ]) {
      const c = id && store.components.get(id);
      if (!c?.range || !ems.length) continue;
      let worst = { f: 0, name: '' };
      for (const { name, em } of ems) {
        let tot = 0, out = 0;
        for (let i = 0; i < N; i++) {
          tot += em[i];
          if (LAMBDA[i] < c.range[0] || LAMBDA[i] > c.range[1]) out += em[i];
        }
        const f = tot > 0 ? out / tot : 0;
        if (f > worst.f) worst = { f, name };
      }
      if (worst.f > 0.02) {
        w.push({ level: 'warn', text: `${label} "${c.name}" is only measured over ${Math.round(c.range[0])}–${Math.round(c.range[1])} nm; ${(worst.f * 100).toFixed(0)}% of ${worst.name}'s emission lies outside that range and is treated as blocked (T = 0).` });
      }
    }
    // Leakage is only meaningful once the blocking elements exist.
    if (doc.cube.dichroicId || doc.cube.emitterId) result.acquisitions.forEach((a, ai) => {
      for (const [cam, lk] of Object.entries(a.leakage)) {
        if (lk.frac > 1e-4) {
          const p = lk.frac * 100;
          w.push({ level: 'warn', text: `${doc.acquisitions[ai].name || `Acq ${ai + 1}`}: excitation blocking toward Camera ${cam === 'A' ? 1 : 2} is only OD ${lk.od.toFixed(1)} — ${p >= 0.1 ? p.toFixed(1) : p.toPrecision(1)}% of the excitation at the sample would reach the camera if back-reflected. Good filter sets block to OD ≥ 5–6.` });
        }
      }
    });
    result.fluors.forEach((f, fi) => {
      const best = Math.max(0, ...result.relBright[fi]);
      if (best < 1) w.push({ level: 'info', text: `${f.name} is below 1% of the brightest signal in every channel.` });
    });
  }
  return w;
}
