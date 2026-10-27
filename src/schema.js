// Config document shape (what is stored in Firestore / localStorage).
// Only spectrum IDs are stored; spectra themselves come from the FPbase
// snapshot or the customSpectra collection (IDs prefixed "c:").

export const SCHEMA_VERSION = 2;

// FRET settings. Stored only once someone uses the FRET controls, so configs without FRET keep
// their old shape. efficiency is 0–1.
export const FRET_DEFAULT = { on: false, donor: null, acceptor: null, efficiency: 0.5 };
export const fretOf = (doc) => ({ ...FRET_DEFAULT, ...(doc?.fret ?? {}) });

// The shared, undeletable sandbox every session starts on (fixed Firestore document id).
export const TEST_ID = 'TEST';

/** History tab for a revision. New ones carry `kind`; older ones (before explicit saving)
 *  are classified by label: automatic snapshots → 'save', anything labelled by a person → 'manual'. */
export function revisionKind(r) {
  if (r.kind === 'manual' || r.kind === 'save') return r.kind;
  const label = r.label ?? '';
  return label === 'autosnapshot' || /^before .*edits$/.test(label) ? 'save' : 'manual';
}

// SPECTRA X sources (current model, manual 57-10039), in wavelength order, seeded with their
// *unfiltered* outputs. FPbase's "Spectra X23 *" spectra match Lumencor's published unfiltered
// curves (scripts/verify_spectrax_unfiltered.py); the older "SpectraX *" entries are filtered outputs.
// The paddle slot holds the source's bandpass filter (Lumencor defaults listed in defaultPaddle).
export const SPECTRAX_LEDS = [
  { key: 'violet', label: 'UV-Violet', fpbaseName: 'Spectra X23 UV-Violet', defaultPaddle: 'Lumencor 377/54x' },
  { key: 'blue', label: 'Blue', fpbaseName: 'Spectra X23 Blue', defaultPaddle: 'Lumencor 438/29x' },
  { key: 'cyan', label: 'Cyan-Teal', fpbaseName: 'Spectra X23 Cyan-Teal', defaultPaddle: 'Lumencor 475/28x' },
  { key: 'green', label: 'Green-Yellow', fpbaseName: 'Spectra X23 Green-Yellow', defaultPaddle: 'Lumencor 555/28x' },
  { key: 'red', label: 'Red-Far Red', fpbaseName: 'Spectra X23 Red-Far Red', defaultPaddle: 'Lumencor 635/22x' },
  { key: 'nir', label: 'NIR', fpbaseName: 'Spectra X23 Near Infra-Red', defaultPaddle: 'Lumencor 730/40x' },
];

// v1 configs used FPbase's filtered "SpectraX *" spectra and a teal slot.
const V1_TO_X23 = {
  'SpectraX Violet': 'Spectra X23 UV-Violet', 'SpectraX Blue': 'Spectra X23 Blue', 'SpectraX Cyan': 'Spectra X23 Cyan-Teal',
  'SpectraX GreenYellow': 'Spectra X23 Green-Yellow', 'SpectraX Red': 'Spectra X23 Red-Far Red',
};

/** Upgrade a v1 document's LED slots to the six current sources (needs the spectra index for names). */
export function migrateLeds(doc, index) {
  if ((doc.schemaVersion ?? 1) >= 2) return doc;
  const byId = new Map(index.components.map((c) => [c.id, c.name]));
  const byName = new Map(index.components.map((c) => [c.name, c.id]));
  const old = Object.fromEntries((doc.leds ?? []).map((l) => [l.key, l]));
  doc.leds = SPECTRAX_LEDS.map(({ key, label, fpbaseName }) => {
    const o = old[key] ?? {};
    const oldName = byId.get(o.spectrumId);
    const spectrumId = !o.spectrumId || V1_TO_X23[oldName] ? byName.get(V1_TO_X23[oldName] ?? fpbaseName) ?? null : o.spectrumId;
    return { key, label, spectrumId, paddleId: o.paddleId ?? null };
  });
  const keys = new Set(doc.leds.map((l) => l.key));
  for (const a of doc.acquisitions ?? []) a.ledsOn = [...new Set((a.ledsOn ?? []).map((k) => (k === 'teal' ? 'cyan' : k)))].filter((k) => keys.has(k));
  doc.schemaVersion = 2;
  return doc;
}

const emptyArm = () => ({ filterId: null, cameraId: null });

export function blankConfig(name = 'Untitled config') {
  return {
    name,
    description: '',
    schemaVersion: SCHEMA_VERSION,
    archived: false,
    leds: SPECTRAX_LEDS.map(({ key, label }) => ({ key, label, spectrumId: null, paddleId: null })),
    cube: { exciterId: null, dichroicId: null, emitterId: null },
    splitter: { dichroicId: null, bypassTo: 'A', armA: emptyArm(), armB: emptyArm() },
    fluors: [],
    acquisitions: [{ name: 'Acq 1', ledsOn: [], intended: { A: null, B: null } }],
  };
}

/** Seed config for the lab scope, resolving FPbase names through the loaded index. */
export function seedConfig(index) {
  const byName = new Map(index.components.map((c) => [c.name, c.id]));
  const fluorByName = (n) => index.fluors.find((f) => f.name === n)?.key ?? null;
  const c = blankConfig('Lab widefield + Gemini (template)');
  c.leds = c.leds.map((l) => ({
    ...l,
    spectrumId: byName.get(SPECTRAX_LEDS.find((s) => s.key === l.key).fpbaseName) ?? null,
  }));
  c.fluors = ['EGFP', 'mCherry']
    .map(fluorByName)
    .filter(Boolean)
    .map((key) => ({ key, enabled: true }));
  c.acquisitions = [
    { name: 'Cyan-Teal', ledsOn: ['cyan'], intended: { A: null, B: null } },
    { name: 'Green-Yellow', ledsOn: ['green'], intended: { A: null, B: null } },
  ];
  return c;
}

/** Fill in fields missing from older/partial documents so the UI never sees undefined. */
export function normalizeConfig(doc) {
  const b = blankConfig(doc?.name || 'Untitled config');
  const d = { ...b, ...doc };
  d.cube = { ...b.cube, ...doc?.cube };
  d.splitter = {
    ...b.splitter,
    ...doc?.splitter,
    armA: { ...emptyArm(), ...doc?.splitter?.armA },
    armB: { ...emptyArm(), ...doc?.splitter?.armB },
  };
  d.leds = Array.isArray(doc?.leds) && doc.leds.length ? doc.leds : b.leds;
  d.fluors = Array.isArray(doc?.fluors) ? doc.fluors : [];
  d.acquisitions = (Array.isArray(doc?.acquisitions) && doc.acquisitions.length ? doc.acquisitions : b.acquisitions).map(
    (a) => {
      // each acquisition has its own filter cube; older documents had one cube for the whole config
      const cube = { exciterId: null, dichroicId: null, emitterId: null, ...(a.cube ?? d.cube) };
      if (!a.cube?.presetId) delete cube.presetId;
      return { name: a.name ?? '', ledsOn: a.ledsOn ?? [], intended: { A: null, B: null, ...a.intended }, cube };
    },
  );
  return d;
}

/** Effective cube parts for an acquisition: a linked preset's current parts, else its own. */
export function effectiveCube(acq, presets = []) {
  const c = acq?.cube ?? {};
  const p = c.presetId ? presets.find((x) => x.id === c.presetId) : null;
  return p ? { exciterId: p.exciterId ?? null, dichroicId: p.dichroicId ?? null, emitterId: p.emitterId ?? null, presetId: p.id }
    : { exciterId: c.exciterId ?? null, dichroicId: c.dichroicId ?? null, emitterId: c.emitterId ?? null, presetId: null };
}

/** Strip server bookkeeping fields for snapshots / duplication. */
export function contentOf(doc) {
  const { updatedAt, updatedBy, updatedSession, createdAt, createdBy, id, ...rest } = doc;
  return JSON.parse(JSON.stringify(rest));
}

/** Every spectrum ID a config refers to (for "used in lab" suggestions and prefetching). */
export function referencedIds(doc) {
  const s = doc.splitter ?? {};
  return [
    ...(doc.leds ?? []).flatMap((l) => [l.spectrumId, l.paddleId]),
    doc.cube?.exciterId, doc.cube?.dichroicId, doc.cube?.emitterId,
    ...(doc.acquisitions ?? []).flatMap((a) => [a.cube?.exciterId, a.cube?.dichroicId, a.cube?.emitterId]),
    s.dichroicId, s.armA?.filterId, s.armA?.cameraId, s.armB?.filterId, s.armB?.cameraId,
  ].filter(Boolean);
}
