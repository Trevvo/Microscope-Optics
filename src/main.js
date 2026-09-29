import './style.css';
import { SpectraStore } from './data/spectraStore.js';
import { makeBackend } from './backend.js';
import { contentOf, migrateLeds, normalizeConfig, referencedIds, seedConfig } from './schema.js';
import { idsToLoad, resolve, warnings } from './resolve.js';
import { merge3 } from './merge.js';
import { simulate } from './physics/simulate.js';
import { complement, dot } from './physics/grid.js';
import { renderDiagram, slots } from './ui/diagram.js';
import { openPicker, closePicker } from './ui/picker.js';
import { openFluorPopover, redrawFluorPopover } from './ui/fluorPopover.js';
import { openCubeMenu, matchPreset } from './ui/cubeMenu.js';
import { DEFAULT_INVENTORY, PADDLE_PREFERRED } from './data/labParts.js';
import { renderTopbar } from './ui/topbar.js';
import { renderReadouts, renderWarnings, renderJourney } from './ui/readouts.js';
import { showBeamTip, hideBeamTip, pinBeamTip } from './ui/beamTooltip.js';
import { peakNorm } from './ui/plots.js';
import { fluorColor } from './ui/color.js';

const $ = (s) => document.querySelector(s);
const SAVE_DEBOUNCE_MS = 1200;
const SAVE_MAX_WAIT_MS = 5000; // continuous editing still saves at least this often
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const PREFS_KEY = 'microscope-optics:prefs';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ exMin: state.exMin, camMin: state.camMin, notesOpen: state.notesOpen, detailsOpen: state.detailsOpen, matrixMode: state.matrixMode }));
  } catch { /* private mode etc. */ }
}
const prefs = loadPrefs();

const state = {
  backend: null,
  store: null,
  user: null,
  configs: [],
  currentId: null,
  doc: null, // working copy (normalized)
  base: null, // content of the last version synced with the server (merge base)
  conflict: null, // remote doc awaiting the user's choice; autosave paused while set
  dirty: false,
  editSeq: 0,
  status: { text: '', cls: '' },
  acqIndex: 0,
  matrixMode: prefs.matrixMode ?? 'col',
  exMin: !!prefs.exMin,
  camMin: prefs.camMin ?? { A: false, B: false },
  notesOpen: !!prefs.notesOpen,
  detailsOpen: !!prefs.detailsOpen,
  menuOpen: false,
  showArchived: false,
  filter: '',
  revisions: null,
  snapshotted: new Set(), // configs with a pre-edit snapshot this session
  lastSnapshotAt: 0,
  result: null,
  colors: {},
  warnList: [],
  inventory: new Set(), // the lab's "our filters" spectrum IDs (shared)
  unsub: { configs: null, config: null, custom: null, inventory: null },
  seeding: false,
};

// ---------------------------------------------------------------- boot

async function boot() {
  try {
    state.store = await new SpectraStore().load();
    state.backend = await makeBackend();
  } catch (e) {
    $('#loading').textContent = `Failed to start: ${e.message}`;
    throw e;
  }
  $('#loading').hidden = true;
  state.backend.onAuth((u) => (u ? startApp(u) : showLogin()));
}

function showLogin() {
  stopApp();
  $('#app').hidden = true;
  $('#login').hidden = false;
  const form = $('#login form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('.err');
    err.textContent = '';
    try {
      await state.backend.signIn(form.u.value, form.p.value);
    } catch {
      err.textContent = 'Wrong username or password.';
    }
  };
}

function stopApp() {
  Object.values(state.unsub).forEach((u) => u?.());
  state.unsub = { configs: null, config: null, custom: null, inventory: null };
}

function startApp(user) {
  state.user = user.name;
  $('#login').hidden = true;
  $('#app').hidden = false;
  state.unsub.custom = state.backend.watchCustomSpectra((list) => {
    state.store.setCustom(list);
    render();
  });
  state.unsub.inventory = state.backend.watchInventory((ids) => {
    if (ids === null) {
      // first run: seed the shared list from the lab's filter list
      const seed = DEFAULT_INVENTORY.map((i) => state.store.idByName(i.name)).filter(Boolean);
      state.inventory = new Set(seed);
      state.backend.saveInventory([...state.inventory]).catch(console.warn);
    } else {
      state.inventory = new Set(ids);
    }
  });
  state.unsub.configs = state.backend.watchConfigs(async (list) => {
    state.configs = list.map((c) => ({ ...c, name: c.name || 'Untitled' }));
    if (!list.length && !state.seeding) {
      state.seeding = true;
      const id = await state.backend.createConfig(seedConfig(state.store.index));
      location.hash = `#/config/${id}`;
      return;
    }
    if (!state.currentId) route();
    else renderTop();
  });
  window.addEventListener('hashchange', route);
}

function route() {
  const m = location.hash.match(/^#\/config\/([\w-]+)/);
  const id = m?.[1];
  if (id && id !== state.currentId) return openConfig(id);
  if (!id && state.configs.length) {
    const first = state.configs.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name))[0] ?? state.configs[0];
    location.hash = `#/config/${first.id}`;
  }
}

// ---------------------------------------------------------------- config lifecycle

async function flushSave() {
  if (state.dirty) await save();
}

async function openConfig(id) {
  await flushSave();
  closePicker();
  state.unsub.config?.();
  state.currentId = id;
  state.doc = null;
  state.base = null;
  state.conflict = null;
  state.revisions = null;
  state.acqIndex = 0;
  state.menuOpen = false;
  hideBanner();
  state.unsub.config = state.backend.watchConfig(id, (remote, { fromMe }) => {
    if (!remote) {
      // Unknown or removed config (e.g. a stale link): fall back to another one instead of
      // leaving the previous diagram on screen with nothing behind it.
      state.doc = null;
      $('#diagram').innerHTML = '';
      const other = state.configs.find((c) => c.id !== id && !c.archived) ?? state.configs.find((c) => c.id !== id);
      if (other) {
        flash('That configuration was not found — opened another one');
        location.hash = `#/config/${other.id}`;
      } else {
        state.status = { text: 'Configuration not found', cls: 'bad' };
        renderTop();
      }
      return;
    }
    if (fromMe && state.doc) return; // echo of our own write
    if (state.dirty && state.doc) {
      // someone else saved while we have unsaved edits: merge field by field against the last synced version
      const theirs = contentOf(migrateLeds(normalizeConfig(remote), state.store.index));
      const { merged, conflicts } = merge3(state.base ?? theirs, contentOf(state.doc), theirs);
      state.base = theirs;
      if (!conflicts.length) {
        state.doc = normalizeConfig(merged);
        if (state.conflict) {
          // the clash went away (e.g. they undid it): resume autosave
          state.conflict = null;
          hideBanner();
          clearTimeout(saveTimer);
          saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
        }
        flash(`Merged ${remote.updatedBy ?? 'someone'}'s changes with yours`);
        render();
        return;
      }
      clearTimeout(saveTimer); // don't overwrite their change until the user decides
      state.conflict = remote;
      showBanner(remote, conflicts);
      setStatus('Paused — conflicting change', 'bad');
      return;
    }
    const had = !!state.doc;
    state.doc = migrateLeds(normalizeConfig(remote), state.store.index);
    state.base = contentOf(state.doc);
    state.status = { text: 'Saved', cls: 'ok' };
    if (!fromMe && had) flash(`Updated by ${remote.updatedBy ?? 'someone'}`);
    render();
  });
}

function snapshotBeforeFirstEdit() {
  const id = state.currentId;
  if (state.snapshotted.has(id)) return;
  state.snapshotted.add(id);
  state.backend.addRevision(id, contentOf(state.doc), `before ${state.user}'s edits`).catch(console.warn);
}

function edit(mutator) {
  if (!state.doc) return;
  snapshotBeforeFirstEdit();
  mutator(state.doc);
  markDirty();
  render();
}

/** Edit without re-rendering (keeps focus and caret in title/notes inputs). */
function editQuiet(mutator) {
  if (!state.doc) return;
  snapshotBeforeFirstEdit();
  mutator(state.doc);
  markDirty();
}

function markDirty() {
  if (!state.dirty) dirtySince = Date.now();
  state.dirty = true;
  state.editSeq++;
  if (state.conflict) return; // autosave paused until the banner is resolved
  setStatus('Unsaved…', 'pending');
  clearTimeout(saveTimer);
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, dirtySince + SAVE_MAX_WAIT_MS - Date.now()));
  saveTimer = setTimeout(save, wait);
}

let saveTimer;
let dirtySince = 0;
async function save() {
  clearTimeout(saveTimer);
  if (!state.doc || !state.dirty || state.conflict) return;
  const seq = state.editSeq;
  const id = state.currentId;
  const content = contentOf(state.doc);
  setStatus('Saving…', 'pending');
  try {
    const res = await state.backend.saveConfig(id, content, state.base);
    if (!res.saved) {
      // someone changed the same field since we last synced: write nothing, ask the user
      state.conflict = res.remote;
      showBanner(res.remote, res.conflicts);
      setStatus('Paused — conflicting change', 'bad');
      return;
    }
    state.base = contentOf(res.merged);
    if (res.changedByOthers) {
      // the server copy had other people's edits; fold them into what's on screen
      state.doc = normalizeConfig(seq === state.editSeq ? res.merged : merge3(content, contentOf(state.doc), res.merged).merged);
      flash(`Merged ${res.remote?.updatedBy ?? 'someone'}'s changes with yours`);
      render();
    }
    if (seq === state.editSeq) state.dirty = false;
    else dirtySince = Date.now();
    setStatus(`Saved ✓ ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'ok');
    if (Date.now() - state.lastSnapshotAt > SNAPSHOT_EVERY_MS) {
      state.lastSnapshotAt = Date.now();
      state.backend.addRevision(id, content, 'autosnapshot').catch(console.warn);
    }
  } catch (e) {
    setStatus(`Save failed: ${e.message}`, 'bad');
  }
}

function setStatus(text, cls) {
  state.status = { text, cls };
  const el = $('#topbar .status');
  if (el) { el.textContent = text; el.className = `status ${cls}`; }
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { save(); e.preventDefault(); }
});

function showBanner(remote, conflicts = []) {
  const b = $('#banner');
  b.hidden = false;
  const what = conflicts.map((c) => c.split(/[.[]/)[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  b.innerHTML = `<b>${remote.updatedBy ?? 'Someone'}</b> changed the same thing you're editing${what ? ` (${what})` : ''}. Autosave is paused.
    <button data-theirs>Use theirs</button> <button data-mine>Keep mine</button>`;
  b.querySelector('[data-theirs]').onclick = () => {
    state.doc = migrateLeds(normalizeConfig(remote), state.store.index);
    state.base = contentOf(state.doc);
    state.conflict = null;
    state.dirty = false;
    clearTimeout(saveTimer);
    hideBanner();
    setStatus('Saved', 'ok');
    render();
  };
  b.querySelector('[data-mine]').onclick = () => {
    // treat their version as the base so our values win where we changed things
    state.base = contentOf(migrateLeds(normalizeConfig(remote), state.store.index));
    state.conflict = null;
    hideBanner();
    save();
  };
}
function hideBanner() { $('#banner').hidden = true; }

let flashTimer;
function flash(text) {
  let el = $('#flash');
  if (!el) { el = document.createElement('div'); el.id = 'flash'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ---------------------------------------------------------------- top bar actions

const topActions = {
  toggleMenu: () => { state.menuOpen = !state.menuOpen; renderTop(); $('#topbar .cfg-filter')?.focus(); },
  open: (id) => { state.menuOpen = false; location.hash = `#/config/${id}`; },
  create: async () => {
    const d = seedConfig(state.store.index);
    d.name = 'New config';
    const id = await state.backend.createConfig(d);
    state.menuOpen = false;
    location.hash = `#/config/${id}`;
  },
  duplicate: async () => {
    if (!state.doc) return;
    await flushSave();
    const c = contentOf(state.doc);
    c.name = `${c.name} (copy)`;
    c.archived = false;
    const id = await state.backend.createConfig(c);
    state.menuOpen = false;
    location.hash = `#/config/${id}`;
  },
  archive: () => edit((d) => (d.archived = !d.archived)),
  rename: (v) => editQuiet((d) => (d.name = v || 'Untitled')),
  notes: (v) => editQuiet((d) => (d.description = v)),
  toggleNotes: () => { state.notesOpen = !state.notesOpen; savePrefs(); renderTop(); if (state.notesOpen) $('#topbar .notes-text')?.focus(); },
  saveVersion: async () => {
    const label = window.prompt?.('Label for this version (optional):', '') ?? '';
    await flushSave();
    await state.backend.addRevision(state.currentId, contentOf(state.doc), label || `version by ${state.user}`);
    flash('Version saved');
    if (state.revisions) state.revisions = await state.backend.listRevisions(state.currentId);
    renderTop();
  },
  history: async () => {
    state.revisions = state.revisions ? null : await state.backend.listRevisions(state.currentId);
    renderTop();
  },
  restore: (revId) => {
    const r = state.revisions?.find((x) => x.id === revId);
    if (!r) return;
    const snap = migrateLeds(normalizeConfig(r.snapshot), state.store.index);
    edit((d) => Object.assign(d, snap));
    flash('Restored — autosaving');
  },
  signOut: async () => { await flushSave(); state.backend.signOut(); },
  setFilter: (v) => { state.filter = v; renderTop(); },
  toggleArchived: () => { state.showArchived = !state.showArchived; renderTop(); },
  selectAcq: (i) => { state.acqIndex = i; render(); },
  renameAcq: (i, v) => edit((d) => (d.acquisitions[i].name = v)),
  deleteAcq: (i) => { edit((d) => d.acquisitions.splice(i, 1)); state.acqIndex = Math.max(0, i - 1); render(); },
  addAcq: (i) => {
    edit((d) => {
      const src = d.acquisitions[i];
      d.acquisitions.push({ name: `Acq ${d.acquisitions.length + 1}`, ledsOn: [...(src?.ledsOn ?? [])], intended: { A: null, B: null } });
    });
    state.acqIndex = state.doc.acquisitions.length - 1;
    render();
  },
  toggleDetails: () => { state.detailsOpen = !state.detailsOpen; savePrefs(); render(); },
};

document.addEventListener('pointerdown', (e) => {
  if (state.menuOpen && !e.target.closest('.cfg-menu, .title-caret')) { state.menuOpen = false; renderTop(); }
});

// ---------------------------------------------------------------- slots / picker

function slotPreview(slotId, arr) {
  const acq = state.result?.acquisitions[state.acqIndex];
  const st = Object.fromEntries((acq?.steps ?? []).map((s) => [s.id, s]));
  const generic = (inp, label = 'arriving light') => {
    const pk = peakNorm(inp);
    let m = 0;
    if (inp) for (const v of inp) if (v > m) m = v;
    const out = arr && inp && m > 0 ? inp.map((v, i) => (v * arr[i]) / m) : null;
    return [
      { label, data: pk, color: '#8a94a0', dash: true },
      { label: 'this part', data: arr, color: '#e8ecef', width: 1.5 },
      { label: 'leaving', data: out, color: '#26c6da', fill: true },
    ];
  };
  const fluorEx = () => state.doc.fluors.filter((f) => f.enabled).map((f) => {
    const m = state.store.fluors.get(f.key);
    return m && { label: `${m.name} ex`, data: peakNorm(state.store.get(m.ex)), color: state.colors[f.key], dash: true };
  }).filter(Boolean);
  if (slotId.startsWith('led:')) return [{ label: 'LED', data: peakNorm(arr), color: '#e8ecef', fill: true }, ...fluorEx()];
  if (slotId.startsWith('paddle:')) {
    const led = state.doc.leds.find((l) => `paddle:${l.key}` === slotId);
    return generic(st[slotId]?.in ?? state.store.get(led?.spectrumId), 'LED');
  }
  switch (slotId) {
    case 'exciter': return [...generic(st['ex:exciter']?.in), ...fluorEx()];
    case 'cubeDichroic': return [
      { label: 'excitation arriving', data: peakNorm(st['ex:cubeDichroic']?.in), color: '#7986cb', dash: true },
      { label: 'emission arriving', data: peakNorm(st.sample?.out), color: '#ff9800', fill: true },
      { label: 'T (R = 1 − T)', data: arr, color: '#e8ecef', width: 1.5 },
    ];
    case 'emitter': return generic(st.emitter?.in);
    case 'gemini': return [
      { label: 'emission arriving', data: peakNorm(st.emitter?.out), color: '#ff9800', fill: true },
      { label: 'T → Camera 1', data: arr, color: '#8bc34a', width: 1.5 },
      { label: 'R → Camera 2', data: arr ? complement(arr) : null, color: '#ce93d8', dash: true },
    ];
    case 'armA': return generic(st['gemini:A']?.out);
    case 'armB': return generic(st['gemini:B']?.out);
    case 'camA': return generic(st.armA?.out);
    case 'camB': return generic(st.armB?.out);
    default: return generic(null);
  }
}

function onSlot(slotId, rect) {
  if (!state.doc) return;
  if (slotId === 'sample') {
    openFluorPopover({ store: state.store, getDoc: () => state.doc, colors: () => state.colors, edit, anchor: rect });
    return;
  }
  if (slotId === 'bypass') return edit((d) => (d.splitter.bypassTo = d.splitter.bypassTo === 'A' ? 'B' : 'A'));
  const s = slots(state.doc).find((x) => x.id === slotId);
  if (!s) return;
  const used = new Set(state.configs.flatMap((c) => referencedIds(normalizeConfig(c))));
  openPicker({
    title: s.title,
    cats: s.cats,
    current: s.get(state.doc),
    used,
    store: state.store,
    anchor: rect,
    preview: (arr) => slotPreview(slotId, arr),
    onPick: (id) => edit((d) => s.set(d, id)),
    ours: () => state.inventory,
    preferred: s.id.startsWith('paddle:') ? {
      title: `SpectraX ${state.doc.leds.find((l) => l.key === s.ledKey)?.label ?? ''}`,
      ids: (PADDLE_PREFERRED[s.ledKey] ?? []).map((n) => state.store.idByName(n)).filter(Boolean),
    } : null,
    onToggleOurs: async (id) => {
      const next = new Set(state.inventory);
      if (next.has(id)) next.delete(id); else next.add(id);
      state.inventory = next;
      await state.backend.saveInventory([...next]);
    },
    onCustom: async ({ name, data }) => {
      const cat = s.cats === 'C' ? 'C' : s.cats === 'L' ? 'L' : 'F';
      const sub = s.cats === 'C' ? 'QE' : s.cats === 'L' ? 'PD' : s.cats === 'dichroic' ? 'BS' : 'BP';
      const rec = { name, cat, sub, data };
      const id = await state.backend.addCustomSpectrum(rec);
      state.store.setCustom([...[...state.store.components.values()].filter((c) => c.custom).map((c) => ({
        id: c.id.slice(2), name: c.name, cat: c.cat, sub: c.sub, data: Array.from(state.store.get(c.id)),
      })), { id, ...rec }]);
      return `c:${id}`;
    },
  });
}

/** Load a premade cube. Triple/Quad also put their single-band exciters on the SpectraX paddles. */
async function applyPreset(p) {
  const id = (n) => (n ? state.store.idByName(n) : null);
  const assign = {};
  if (p.paddles) {
    // each exciter goes on the LED whose unfiltered output it passes most light from
    const ex = p.paddles.map(id).filter(Boolean);
    await state.store.ensure([...ex, ...state.doc.leds.map((l) => l.spectrumId)]);
    for (const fid of ex) {
      const t = state.store.get(fid);
      let best = null, bestV = 0;
      for (const l of state.doc.leds) {
        const led = state.store.get(l.spectrumId);
        if (!led || !t) continue;
        const v = dot(led, t) / (dot(led, led) ** 0.5 || 1);
        if (v > bestV) { bestV = v; best = l.key; }
      }
      if (best && !assign[best]) assign[best] = fid;
    }
  }
  edit((d) => {
    d.cube.exciterId = id(p.exciter);
    d.cube.dichroicId = id(p.dichroic);
    d.cube.emitterId = id(p.emitter);
    for (const l of d.leds) if (assign[l.key]) l.paddleId = assign[l.key];
  });
  const moved = Object.entries(assign).map(([k, f]) => `${state.doc.leds.find((l) => l.key === k).label} ← ${state.store.display(f).title}`);
  flash(`Loaded ${p.name}${moved.length ? `; paddles: ${moved.join(', ')}` : ''}`);
}

const diagramHandlers = {
  onSlot,
  onCubeMenu: (rect) => openCubeMenu({ store: state.store, anchor: rect, current: matchPreset(state.doc, state.store), apply: applyPreset }),
  onToggleLed: (key) => {
    const l = state.doc.leds.find((x) => x.key === key);
    if (!l?.spectrumId) return flash('Choose an LED spectrum first (click the LED circle)');
    edit((d) => {
      const a = d.acquisitions[state.acqIndex];
      a.ledsOn = a.ledsOn.includes(key) ? a.ledsOn.filter((k) => k !== key) : [...a.ledsOn, key];
    });
  },
  onToggleExMin: () => { state.exMin = !state.exMin; savePrefs(); render(); },
  onToggleCamMin: (cam) => { state.camMin = { ...state.camMin, [cam]: !state.camMin[cam] }; savePrefs(); render(); },
  onBeamHover: (em, label, event) => {
    const acq = state.result?.acquisitions[state.acqIndex];
    if (!em || !acq) return hideBeamTip();
    showBeamTip({ acq, cumulative: state.result.cumulative[em], label, colors: state.colors, event });
  },
  onBeamPin: () => pinBeamTip(),
};

// ---------------------------------------------------------------- render

function preserveFocus(el, fn) {
  const a = document.activeElement;
  const inside = a && el.contains(a);
  const sel = inside && a.className ? `.${String(a.className).trim().split(/\s+/).join('.')}` : null;
  const pos = inside && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (sel) {
    const b = el.querySelector(sel);
    if (b) { b.focus(); if (pos) try { b.setSelectionRange(...pos); } catch { /* not a text input */ } }
  }
}

function renderTop() {
  preserveFocus($('#topbar'), () => renderTopbar($('#topbar'), {
    doc: state.doc, configs: state.configs, currentId: state.currentId, user: state.user, mode: state.backend.mode,
    status: state.status, menuOpen: state.menuOpen, showArchived: state.showArchived, filter: state.filter,
    revisions: state.revisions, notesOpen: state.notesOpen, acqIndex: state.acqIndex,
    warnCount: state.warnList.filter((w) => w.level === 'warn').length, detailsOpen: state.detailsOpen, on: topActions,
  }));
}

function renderDetails() {
  const panel = $('#details');
  panel.hidden = !state.detailsOpen;
  document.body.classList.toggle('details-open', state.detailsOpen);
  if (!state.detailsOpen || !state.doc) return;
  const { doc, store, result } = state;
  const meta = Object.fromEntries(doc.fluors.map((f) => [f.key, store.fluors.get(f.key)]));
  renderReadouts($('#readouts'), {
    doc, result, colors: state.colors, meta, matrixMode: state.matrixMode,
    onIntended: (ai, cam, key) => edit((d) => (d.acquisitions[ai].intended[cam] = key)),
    onMatrixMode: (m) => { state.matrixMode = m; savePrefs(); render(); },
  });
  renderWarnings($('#warnings'), state.warnList);
  renderJourney($('#journey'), { result, acqIndex: state.acqIndex, store, doc, colors: state.colors });
}

/** Keep FPbase emission colours, but lighten/darken ones that would be indistinguishable. */
function distinctColors(pairs) {
  const rgb = (c) => {
    const m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const n = c.match(/\d+(\.\d+)?/g);
    return n ? n.slice(0, 3).map(Number) : [128, 128, 128];
  };
  const used = [];
  const out = {};
  for (const [key, c] of pairs) {
    let v = rgb(c);
    for (let k = 1; k < 6 && used.some((u) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 100); k++) {
      const base = rgb(c);
      const t = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.28; // alternately lighter, darker
      v = base.map((x) => Math.round(t > 0 ? x + (255 - x) * t : x * (1 + t)));
    }
    used.push(v);
    out[key] = `rgb(${v.join(',')})`;
  }
  return out;
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(async () => {
    renderQueued = false;
    const doc = state.doc;
    if (!doc) return renderTop();
    const { store } = state;
    const missing = idsToLoad(doc, store).filter((id) => !store.has(id));
    if (missing.length) {
      await store.ensure(missing);
      if (state.doc !== doc) return;
    }
    state.acqIndex = Math.max(0, Math.min(state.acqIndex, doc.acquisitions.length - 1));
    state.colors = distinctColors(doc.fluors.map((f, i) => [f.key, fluorColor(store.fluors.get(f.key), i)]));
    const { input, skipped } = resolve(doc, store);
    state.result = simulate(input);
    state.warnList = warnings(doc, store, state.result, skipped);

    renderTop();
    renderDiagram($('#diagram'), {
      doc, store, acq: state.result.acquisitions[state.acqIndex], acqDoc: doc.acquisitions[state.acqIndex],
      fluorColors: state.colors, exMin: state.exMin, camMin: state.camMin, result: state.result, acqIndex: state.acqIndex, colors: state.colors,
      cubePreset: matchPreset(doc, store),
    }, diagramHandlers);
    redrawFluorPopover();
    renderDetails();
  });
}

$('#details .close')?.addEventListener('click', () => topActions.toggleDetails());

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 200); });

boot();
