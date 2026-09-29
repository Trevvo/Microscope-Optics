// Popover opened from the cell on the stage: search FPbase proteins/dyes to add,
// toggle or remove the ones in the sample.
import Fuse from 'fuse.js';
import { closePicker, placeInViewport } from './picker.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let fuse = null;
let open = null;

export function closeFluorPopover() {
  open?.destroy();
  open = null;
}

export const fluorPopoverOpen = () => !!open;

/** @param ctx {getDoc(), store, colors(), edit(mutator), anchor: DOMRect} */
export function openFluorPopover(ctx) {
  closePicker();
  closeFluorPopover();
  const { store } = ctx;
  fuse ??= new Fuse([...store.fluors.values()], { keys: ['name'], threshold: 0.3, ignoreLocation: true });

  const el = document.createElement('div');
  el.className = 'picker fluor-pop';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="picker-head"><strong>Fluorophores in the sample</strong><button class="icon close" aria-label="Close">×</button></div>
    <input class="picker-search" type="search" placeholder="Add a protein or dye (mNeonGreen, Alexa 647, JF549…)" autocomplete="off" spellcheck="false">
    <ul class="picker-list results" role="listbox" hidden></ul>
    <ul class="fl-current"></ul>`;
  document.body.appendChild(el);
  const pw = Math.min(400, window.innerWidth - 24);
  el.style.width = `${pw}px`;
  const a = ctx.anchor;
  let left = a ? a.left + a.width / 2 - pw / 2 : (window.innerWidth - pw) / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
  el.style.left = `${left}px`;
  el.style.top = '12px';

  const input = el.querySelector('.picker-search');
  const results = el.querySelector('.results');
  const current = el.querySelector('.fl-current');
  let hits = [];
  let hi = 0;

  function drawCurrent() {
    const doc = ctx.getDoc();
    const colors = ctx.colors();
    current.innerHTML = doc.fluors.length ? doc.fluors.map((f, i) => {
      const m = store.fluors.get(f.key);
      return `<li class="${f.enabled ? '' : 'disabled'}">
        <label><input type="checkbox" data-en="${i}" ${f.enabled ? 'checked' : ''}><i class="sw" style="background:${colors[f.key] ?? '#888'}"></i>${esc(m?.name ?? f.key)}</label>
        <span class="muted">${m?.exMax ? Math.round(m.exMax) : '–'} / ${m?.emMax ? Math.round(m.emMax) : '–'} nm</span>
        <button class="icon" data-rm="${i}" aria-label="Remove ${esc(m?.name)}">×</button></li>`;
    }).join('') : '<li class="muted">No fluorophores yet — search above.</li>';
    current.querySelectorAll('[data-en]').forEach((x) => x.addEventListener('change', () => { ctx.edit((d) => (d.fluors[+x.dataset.en].enabled = x.checked)); drawCurrent(); }));
    current.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => { ctx.edit((d) => d.fluors.splice(+x.dataset.rm, 1)); drawCurrent(); }));
  }

  function drawHits() {
    results.hidden = !hits.length;
    results.innerHTML = hits.map((m, i) => `<li data-i="${i}" class="${i === hi ? 'hi' : ''}"><i class="sw" style="background:${m.color ?? '#888'}"></i><span class="nm">${esc(m.name)}</span>
      <span class="badge">${m.kind}</span><span class="muted">${m.exMax ? Math.round(m.exMax) : '–'}/${m.emMax ? Math.round(m.emMax) : '–'}</span></li>`).join('');
  }

  const add = (m) => {
    if (!m) return;
    ctx.edit((d) => { if (!d.fluors.some((f) => f.key === m.key)) d.fluors.push({ key: m.key, enabled: true }); });
    input.value = '';
    hits = [];
    drawHits();
    drawCurrent();
  };
  input.addEventListener('input', () => {
    const q = input.value.trim();
    hits = q ? fuse.search(q, { limit: 12 }).map((r) => r.item) : [];
    hi = 0;
    drawHits();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { hi = Math.min(hits.length - 1, hi + 1); drawHits(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); drawHits(); e.preventDefault(); }
    else if (e.key === 'Enter') { add(hits[hi]); e.preventDefault(); }
  });
  results.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); add(hits[+li.dataset.i]); }
  });
  el.querySelector('.close').addEventListener('click', closeFluorPopover);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFluorPopover(); });
  const outside = (e) => { if (!el.contains(e.target) && !e.target.closest?.('[data-slot="sample"]')) closeFluorPopover(); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  const ro = new ResizeObserver(() => placeInViewport(el, a ? a.bottom + 10 : 80));
  ro.observe(el);
  open = { el, redraw: drawCurrent, destroy() { ro.disconnect(); document.removeEventListener('pointerdown', outside); el.remove(); } };
  drawCurrent();
  placeInViewport(el, a ? a.bottom + 10 : 80);
  input.focus();
}

export function redrawFluorPopover() {
  open?.redraw();
}
