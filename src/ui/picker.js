// Component picker popover with independently searched columns:
//   (paddle slots only) "preferred" — the lab's usual excitation filters for that LED
//   all   — everything in the FPbase snapshot that fits the slot
//   ours  — "our filters": the lab's shared inventory (★ toggles membership)
// Filter slots only accept filters, dichroic slots only dichroics. A live preview
// shows the highlighted part acting on the light that reaches the slot.

import Fuse from 'fuse.js';
import { plotSpectra } from './plots.js';
import { resamplePoints } from '../physics/grid.js';

const SUB_LABEL = { BP: 'bandpass', BX: 'ex', BM: 'em', BS: 'dichroic', LP: 'longpass', SP: 'shortpass', PD: 'light', QE: 'QE' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Which components a slot accepts. */
export function accepts(cats, c) {
  if (cats === 'L') return c.cat === 'L';
  if (cats === 'C') return c.cat === 'C';
  if (c.cat !== 'F') return false;
  return cats === 'dichroic' ? c.sub === 'BS' : c.sub !== 'BS';
}

let open = null;

/** Fixed-position popovers: clamp vertically by measured height so they never push the page into scrolling. */
export function placeInViewport(el, wantTop) {
  const h = Math.min(el.getBoundingClientRect().height, window.innerHeight - 24);
  el.style.top = `${Math.max(12, Math.min(wantTop, window.innerHeight - h - 12))}px`;
}

export function closePicker() {
  open?.destroy();
  open = null;
}

/** Search: exact substring hits (label, alt keys, name) first, then fuzzy matches. */
function makeSearch(pool) {
  const fuse = new Fuse(pool, {
    keys: [{ name: 'label', weight: 2 }, { name: 'alt', weight: 1.5 }, { name: 'name', weight: 1 }],
    threshold: 0.3, ignoreLocation: true,
  });
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
  const FILLER = new Set(['dichroic', 'dichroics', 'nm', 'filter', 'bp', 'bandpass']);
  return (q, limit = 80) => {
    // every token must appear in the label, search keys or part name; "dichroic"/"nm" are filler
    const tokens = q.toLowerCase().split(/\s+/).filter((t) => t && !FILLER.has(t)).map(norm);
    if (!tokens.length) return pool.slice(0, limit);
    const scored = [];
    for (const c of pool) {
      const name = norm(c.name), label = norm(c.label), alt = norm(c.alt);
      if (!tokens.every((t) => name.includes(t) || label.includes(t) || alt.includes(t))) continue;
      // part-number hits first, then label hits, then simpler (fewer-band) parts
      const score = tokens.reduce((s, t) => s + (name.includes(t) ? 3 : 0) + (label.startsWith(t) ? 2 : label.includes(t) ? 1 : 0), 0)
        - (c.label ? c.label.split('/').length - 1 : 0) * 0.5;
      scored.push([score, c]);
    }
    scored.sort((a, b) => b[0] - a[0] || (a[1].label ?? a[1].name).localeCompare(b[1].label ?? b[1].name, undefined, { numeric: true }));
    const exact = scored.map((x) => x[1]);
    const seen = new Set(exact.map((c) => c.id));
    const fuzzy = exact.length >= limit ? [] : fuse.search(q, { limit }).map((r) => r.item).filter((c) => !seen.has(c.id));
    return [...exact, ...fuzzy].slice(0, limit);
  };
}

/**
 * @param opts {title, cats, current, used: Set<id>, ours: () => Set<id>, onToggleOurs(id), store,
 *              preferred: {title, ids} | null,
 *              anchor: DOMRect, preview(arr|null) → series[], onPick(id|null), onCustom({name, data}) → Promise<id>}
 */
export function openPicker(opts) {
  closePicker();
  const { store } = opts;
  const pool = [...store.components.values()].filter((c) => accepts(opts.cats, c));
  const search = makeSearch(pool);
  const kind = opts.cats === 'C' ? 'cameras' : opts.cats === 'L' ? 'light sources' : opts.cats === 'dichroic' ? 'dichroics' : 'filters';
  const ph = opts.cats === 'dichroic' ? 'e.g. 560, 652 dichroic, FF409' : opts.cats === 'filter' ? 'e.g. 635/18, 525±25, ET470' : 'search…';

  const el = document.createElement('div');
  el.className = 'picker two-col';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="picker-head"><strong>${esc(opts.title)}</strong><span class="muted small">only ${kind}</span><button class="icon close" aria-label="Close">×</button></div>
    <div class="picker-preview"></div>
    <div class="pk-cols ${opts.preferred ? 'three' : ''}">
      ${opts.preferred ? `<section class="pk-col pref" data-col="pref">
        <h5>Preferred · ${esc(opts.preferred.title)}</h5>
        <div class="pk-note">usual excitation filters for this LED</div>
        <ul class="picker-list" role="listbox"></ul>
      </section>` : ''}
      <section class="pk-col" data-col="all">
        <h5>All (FPbase)</h5>
        <input class="picker-search" data-col="all" type="search" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false">
        <ul class="picker-list" role="listbox"></ul>
      </section>
      <section class="pk-col ours" data-col="ours">
        <h5>★ Our filters</h5>
        <input class="picker-search" data-col="ours" type="search" placeholder="search ours…" autocomplete="off" spellcheck="false">
        <ul class="picker-list" role="listbox"></ul>
      </section>
    </div>
    <div class="pk-foot">
      <button class="pk-none">None (empty slot, T = 1)</button>
      <details class="picker-custom">
        <summary>Custom spectrum…</summary>
        <p class="hint">Paste two columns (wavelength nm, value). Values in 0–1 or %. Saved for everyone.</p>
        <input class="c-name" placeholder="Name (e.g. Chroma ZT561rdc, measured)">
        <textarea class="c-data" rows="4" placeholder="400, 0.01&#10;401, 0.012&#10;…"></textarea>
        <button class="c-save">Save & use</button> <span class="c-msg"></span>
      </details>
    </div>`;
  document.body.appendChild(el);

  const a = opts.anchor;
  const pw = Math.min(opts.preferred ? 1000 : 780, window.innerWidth - 24);
  el.style.width = `${pw}px`;
  let left = a ? a.right + 12 : (window.innerWidth - pw) / 2;
  if (left + pw > window.innerWidth - 12) left = Math.max(12, (a?.left ?? 0) - pw - 12);
  if (left < 12 || left + pw > window.innerWidth - 12) left = Math.max(12, (window.innerWidth - pw) / 2);
  el.style.left = `${left}px`;
  el.style.top = '12px';
  const wantTop = a ? a.top - 60 : 60;
  placeInViewport(el, wantTop);

  const cols = {
    ...(opts.preferred ? { pref: { input: null, list: el.querySelector('[data-col="pref"] .picker-list'), items: [], hi: -1 } } : {}),
    all: { input: el.querySelector('input[data-col="all"]'), list: el.querySelector('[data-col="all"] .picker-list'), items: [], hi: 0 },
    ours: { input: el.querySelector('input[data-col="ours"]'), list: el.querySelector('[data-col="ours"] .picker-list'), items: [], hi: -1 },
  };
  const prev = el.querySelector('.picker-preview');
  let previewTimer;

  function compute(col) {
    const c = cols[col];
    const q = c.input?.value.trim() ?? '';
    const ours = opts.ours();
    if (col === 'pref') {
      c.items = opts.preferred.ids.map((id) => store.components.get(id)).filter(Boolean);
    } else if (col === 'ours') {
      const mine = pool.filter((x) => ours.has(x.id));
      c.items = q ? makeSearch(mine)(q, 200) : mine.sort((x, y) => (x.label ?? x.name).localeCompare(y.label ?? y.name, undefined, { numeric: true }));
    } else if (q) {
      c.items = search(q);
    } else {
      const used = pool.filter((x) => opts.used.has(x.id)).map((x) => ({ ...x, group: 'Used in lab configs' }));
      c.items = used.length ? [...used, ...pool.filter((x) => !opts.used.has(x.id)).slice(0, 60)] : pool.slice(0, 80);
    }
  }

  function row(x, i, col) {
    const ours = opts.ours().has(x.id);
    const d = x.label ? { t: x.label, b: x.name } : { t: x.name, b: '' };
    return `<li role="option" data-i="${i}" data-col="${col}" class="${i === cols[col].hi ? 'hi' : ''} ${x.id === opts.current ? 'cur' : ''}">
      <span class="nm"><span class="lbl">${esc(d.t)}</span>${d.b ? `<span class="brand">(${esc(d.b)})</span>` : ''}</span>
      ${x.sub && opts.cats !== 'L' && opts.cats !== 'C' ? `<span class="badge">${esc(SUB_LABEL[x.sub] ?? x.sub)}</span>` : ''}
      ${x.custom ? '<span class="badge custom">custom</span>' : ''}
      ${x.filtered ? '<span class="badge warn" title="FPbase measured this through a bandpass filter — not the raw LED">filtered output</span>' : ''}
      <button class="star ${ours ? 'on' : ''}" data-star="${x.id}" title="${ours ? 'Remove from' : 'Add to'} our filters" aria-pressed="${ours}">${ours ? '★' : '☆'}</button>
    </li>`;
  }

  function draw(col) {
    const c = cols[col];
    let lastGroup = null;
    c.list.innerHTML = c.items.map((x, i) => {
      const g = x.group && x.group !== lastGroup ? `<li class="group">${esc(x.group)}</li>` : '';
      lastGroup = x.group ?? lastGroup;
      return g + row(x, i, col);
    }).join('') || `<li class="muted empty">${col === 'ours' ? 'None yet — ☆ a part on the left to add it' : col === 'pref' ? 'None set for this LED' : 'No matches'}</li>`;
    c.list.querySelector('li.hi')?.scrollIntoView({ block: 'nearest' });
  }

  function refresh(col) { compute(col); draw(col); }

  function setPreview(id) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const arr = id ? await store.fetchOne(id) : null;
      if (open?.el !== el) return;
      plotSpectra(prev, opts.preview(arr), { height: 150, legend: true });
    }, 60);
  }

  function highlight(col, i) {
    for (const k of Object.keys(cols)) if (k !== col) { cols[k].hi = -1; cols[k].list.querySelectorAll('li.hi').forEach((x) => x.classList.remove('hi')); }
    const c = cols[col];
    if (!c.items.length) return;
    c.hi = Math.max(0, Math.min(c.items.length - 1, i));
    c.list.querySelectorAll('li.hi').forEach((x) => x.classList.remove('hi'));
    const li = c.list.querySelector(`li[data-i="${c.hi}"]`);
    li?.classList.add('hi');
    li?.scrollIntoView({ block: 'nearest' });
    setPreview(c.items[c.hi].id);
  }

  function pick(id) {
    opts.onPick(id);
    closePicker();
  }

  for (const [col, c] of Object.entries(cols)) {
    c.input?.addEventListener('input', () => { refresh(col); if (c.input.value.trim()) highlight(col, 0); });
    c.input?.addEventListener('focus', () => { if (Object.values(cols).every((k) => k.hi < 0)) highlight(col, 0); });
    c.input?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { highlight(col, c.hi + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { highlight(col, c.hi - 1); e.preventDefault(); }
      else if (e.key === 'Enter') { const x = c.items[c.hi]; if (x) pick(x.id); e.preventDefault(); }
    });
    c.list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li && +li.dataset.i !== c.hi) highlight(col, +li.dataset.i);
    });
    c.list.addEventListener('click', async (e) => {
      const star = e.target.closest('[data-star]');
      if (star) {
        e.stopPropagation();
        await opts.onToggleOurs(star.dataset.star);
        for (const k of Object.keys(cols)) refresh(k);
        return;
      }
      const li = e.target.closest('li[data-i]');
      if (li) pick(c.items[+li.dataset.i]?.id);
    });
  }
  el.querySelector('.pk-none').addEventListener('click', () => pick(null));
  el.querySelector('.pk-none').addEventListener('mouseenter', () => setPreview(null));
  el.querySelector('.close').addEventListener('click', closePicker);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

  el.querySelector('.c-save').addEventListener('click', async () => {
    const msg = el.querySelector('.c-msg');
    const name = el.querySelector('.c-name').value.trim();
    const pts = el.querySelector('.c-data').value.split(/\r?\n/)
      .map((ln) => ln.trim().split(/[\s,;\t]+/).map(Number))
      .filter((r) => r.length >= 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]));
    if (!name) return (msg.textContent = 'Give it a name.');
    if (pts.length < 5) return (msg.textContent = 'Need at least 5 numeric rows.');
    const maxV = Math.max(...pts.map((p) => p[1]));
    const data = Array.from(resamplePoints(pts.map(([l, v]) => [l, maxV > 1.5 ? v / 100 : v])), (v) => Math.round(Math.min(1, Math.max(0, v)) * 1e5) / 1e5);
    msg.textContent = 'Saving…';
    try {
      pick(await opts.onCustom({ name, data }));
    } catch (err) {
      msg.textContent = `Failed: ${err.message}`;
    }
  });

  const outside = (e) => { if (!el.contains(e.target) && !e.target.closest?.('[data-slot]')) closePicker(); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  // re-clamp whenever the content changes height (lists filling, chart + legend rendering)
  const ro = new ResizeObserver(() => placeInViewport(el, wantTop));
  ro.observe(el);
  open = { el, destroy() { ro.disconnect(); document.removeEventListener('pointerdown', outside); clearTimeout(previewTimer); el.remove(); } };

  for (const k of Object.keys(cols)) refresh(k);
  placeInViewport(el, wantTop);
  // start on the current part in whichever column holds it (preferred first); typing lands in "all"
  const where = ['pref', 'ours', 'all'].filter((k) => cols[k]).map((k) => [k, cols[k].items.findIndex((x) => x.id === opts.current)]).find(([, i]) => i >= 0);
  if (where) highlight(...where);
  else if (cols.pref?.items.length) highlight('pref', 0);
  else highlight('all', 0);
  if (!Object.values(cols).some((c) => c.items.length)) setPreview(null);
  cols.all.input.focus();
}
