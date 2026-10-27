// Cube-preset dropdown, opened from the cube button inside the filter cube.
// Presets are shared lab data (settings/cubes). Loading one links the current
// acquisition's cube to it, so editing a preset here changes every cube linked to it.
// Triple/Quad-style presets also carry single-band exciters for the SpectraX paddles.
// Laid out as a compact grid in a fixed, viewport-clamped box: never scrolls the page.

import { closePicker } from './picker.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let open = null;

export function closeCubeMenu() {
  open?.destroy();
  open = null;
}

/** Name of the preset the given cube is linked to (or whose parts it matches), for the cube button. */
export function matchPreset(cube, presets) {
  if (!cube) return null;
  if (cube.presetId) return presets.find((p) => p.id === cube.presetId)?.name ?? null;
  const p = presets.find((x) => (x.exciterId ?? null) === (cube.exciterId ?? null) && (x.dichroicId ?? null) === (cube.dichroicId ?? null) && (x.emitterId ?? null) === (cube.emitterId ?? null));
  return p?.name ?? null;
}

const ROLES = [['exciterId', 'exciter', 'filter'], ['dichroicId', 'dichroic', 'dichroic'], ['emitterId', 'emitter', 'filter']];

/**
 * @param ctx {store, anchor: DOMRect, presets, currentId (linked preset id), apply(preset),
 *             save(presets) → Promise, pick({title, cats, current, anchor}) → Promise<id|undefined>}
 */
export function openCubeMenu(ctx) {
  closePicker();
  closeCubeMenu();
  const { store } = ctx;
  let presets = ctx.presets.map((p) => ({ ...p }));
  let editing = null; // draft preset being edited
  let confirmDelete = false;
  let msg = '';

  const lbl = (id) => {
    if (!id) return '<span class="muted">—</span>';
    const d = store.display(id);
    return `<span class="lbl">${esc(d.title)}</span>${d.brand ? `<span class="brand">(${esc(d.brand)})</span>` : ''}`;
  };
  const row = (role, id) => `<div class="cm-part"><span class="cm-role">${role}</span><span class="cm-val">${lbl(id)}</span></div>`;

  const el = document.createElement('div');
  el.className = 'picker cube-menu';
  el.setAttribute('role', 'dialog');
  document.body.appendChild(el);

  function card(p) {
    const cur = ctx.currentId === p.id;
    return `<div class="cm-card ${cur ? 'cur' : ''}" data-p="${p.id}" role="button" tabindex="0" title="${esc(p.paddles?.length
      ? 'Load: dichroic and emitter into this acquisition’s cube, exciters onto the matching SpectraX paddles'
      : 'Load: exciter, dichroic and emitter into this acquisition’s cube')}">
        <span class="cm-name">${esc(p.name)}${p.part ? ` <span class="muted">${esc(p.part)}</span>` : ''}${cur ? ' <span class="badge">linked</span>' : ''}</span>
        ${row('exciter', p.exciterId)}${row('dichroic', p.dichroicId)}${row('emitter', p.emitterId)}
        ${p.paddles?.length ? `<div class="cm-part"><span class="cm-role">paddles</span><span class="cm-val cm-paddles">${p.paddles.map((id) => `<span class="lbl">${esc(store.display(id).title)}</span>`).join(' · ')}</span></div>` : ''}
        <button class="cm-edit" data-edit="${p.id}" title="Edit this preset for everyone">Edit</button>
      </div>`;
  }

  function editor() {
    const d = editing;
    return `<div class="cm-editor">
        <h5>${d.isNew ? 'New preset' : `Edit preset “${esc(d.name)}”`} <span class="muted small">changes apply to every cube linked to it</span></h5>
        <label class="cm-namefield">Name <input class="cm-name-input" value="${esc(d.name)}" maxlength="40"></label>
        ${ROLES.map(([k, role]) => `<div class="cm-part"><span class="cm-role">${role}</span><span class="cm-val">${lbl(d[k])}</span>
          <button data-choose="${k}">${d[k] ? 'Change' : 'Choose'}</button>${d[k] ? `<button class="icon" data-clear="${k}" title="Empty this slot">×</button>` : ''}</div>`).join('')}
        ${d.paddles?.length ? `<div class="cm-part"><span class="cm-role">paddles</span><span class="cm-val cm-paddles">${d.paddles.map((id) => `<span class="lbl">${esc(store.display(id).title)}</span>`).join(' · ')}</span>
          <button class="icon" data-clear-paddles title="Stop this preset setting the SpectraX paddles">×</button></div>` : ''}
        <div class="row">
          <button class="primary" data-save>Save preset</button><button data-cancel>Cancel</button>
          ${d.isNew ? '' : confirmDelete
            ? '<span class="small">Delete for everyone? Linked cubes keep their current parts.</span><button class="danger" data-del-yes>Delete</button><button data-del-no>Keep</button>'
            : '<button class="danger" data-del>Delete preset…</button>'}
        </div>
        ${msg ? `<p class="small">${esc(msg)}</p>` : ''}
      </div>`;
  }

  function draw() {
    el.innerHTML = `
      <div class="picker-head"><strong>Premade cubes</strong><span class="muted small">click a cube to load it into this acquisition</span><button class="icon close" aria-label="Close">×</button></div>
      ${editing ? editor() : `<div class="cm-grid">${presets.map(card).join('')}</div>
        <div class="row"><button data-new>+ New preset</button>${msg ? `<span class="small">${esc(msg)}</span>` : ''}</div>`}`;
    wire();
    place();
  }

  function place() {
    const pw = Math.min(760, window.innerWidth - 24);
    el.style.width = `${pw}px`;
    const h = Math.min(el.getBoundingClientRect().height, window.innerHeight - 24);
    const a = ctx.anchor;
    el.style.left = `${Math.max(12, Math.min((a ? a.left + a.width / 2 : window.innerWidth / 2) - pw / 2, window.innerWidth - pw - 12))}px`;
    el.style.top = `${Math.max(12, Math.min(a ? a.top - h - 10 : 60, window.innerHeight - h - 12))}px`;
  }

  async function persist(next, note) {
    msg = 'Saving…';
    draw();
    try {
      await ctx.save(next);
      presets = next.map((p) => ({ ...p }));
      editing = null;
      confirmDelete = false;
      msg = note;
    } catch (e) {
      msg = `Could not save: ${e.message}`;
    }
    draw();
  }

  function wire() {
    el.querySelector('.close').addEventListener('click', closeCubeMenu);
    el.querySelectorAll('.cm-card').forEach((c) => {
      const load = async (e) => {
        if (e.target.closest('[data-edit]')) return;
        await ctx.apply(presets.find((x) => x.id === c.dataset.p));
        closeCubeMenu();
      };
      c.addEventListener('click', load);
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(e); } });
    });
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      editing = { ...presets.find((x) => x.id === b.dataset.edit) };
      msg = '';
      draw();
    }));
    el.querySelector('[data-new]')?.addEventListener('click', () => {
      editing = { id: `p-${Date.now().toString(36)}`, name: 'New cube', exciterId: null, dichroicId: null, emitterId: null, isNew: true };
      msg = '';
      draw();
    });
    if (!editing) return;
    el.querySelector('.cm-name-input').addEventListener('input', (e) => { editing.name = e.target.value; });
    el.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.choose;
      const [, role, cats] = ROLES.find((r) => r[0] === k);
      const id = await ctx.pick({ title: `${editing.name || 'Preset'} — ${role}`, cats, current: editing[k], anchor: b.getBoundingClientRect() });
      if (id !== undefined) { editing[k] = id; draw(); }
    }));
    el.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => { editing[b.dataset.clear] = null; draw(); }));
    el.querySelector('[data-clear-paddles]')?.addEventListener('click', () => { editing.paddles = []; draw(); });
    el.querySelector('[data-cancel]').addEventListener('click', () => { editing = null; confirmDelete = false; msg = ''; draw(); });
    el.querySelector('[data-save]').addEventListener('click', () => {
      const { isNew, ...p } = editing;
      p.name = (p.name || '').trim() || 'Untitled cube';
      const next = isNew ? [...presets, p] : presets.map((x) => (x.id === p.id ? p : x));
      persist(next, `Saved “${p.name}” for everyone`);
    });
    el.querySelector('[data-del]')?.addEventListener('click', () => { confirmDelete = true; draw(); });
    el.querySelector('[data-del-no]')?.addEventListener('click', () => { confirmDelete = false; draw(); });
    el.querySelector('[data-del-yes]')?.addEventListener('click', () => persist(presets.filter((x) => x.id !== editing.id), 'Preset deleted'));
  }

  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.picker:not(.cube-menu)')) closeCubeMenu(); });
  // clicks in the part picker opened from the editor must not close this menu
  const outside = (e) => { if (!el.contains(e.target) && !e.target.closest?.('[data-cube], .picker')) closeCubeMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  open = { el, destroy() { document.removeEventListener('pointerdown', outside); el.remove(); } };
  draw();
  (el.querySelector('.cm-card.cur') ?? el.querySelector('.cm-card'))?.focus();
}
