// Config document shape (what is stored in Firestore / localStorage).
// Only spectrum IDs are stored; spectra themselves come from the FPbase
// snapshot or the customSpectra collection (IDs prefixed "c:").

export const SCHEMA_VERSION = 2;

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
    (a) => ({ name: a.name ?? '', ledsOn: a.ledsOn ?? [], intended: { A: null, B: null, ...a.intended } }),
  );
  return d;
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
    s.dichroicId, s.armA?.filterId, s.armA?.cameraId, s.armB?.filterId, s.armB?.cameraId,
  ].filter(Boolean);
}
