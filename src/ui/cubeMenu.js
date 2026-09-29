// Cube-preset dropdown, opened from the cube button inside the filter cube.
// POS-* cubes fill exciter / dichroic / emitter. Triple/Quad fill dichroic +
// multiband emitter and put their single-band exciters on the SpectraX paddles.
// Laid out as a compact grid in a fixed, viewport-clamped box: never scrolls the page.

import { CUBE_PRESETS } from '../data/labParts.js';
import { closePicker } from './picker.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let open = null;

export function closeCubeMenu() {
  open?.destroy();
  open = null;
}

/** Which preset (if any) the cube currently holds, for the label under the cube button. */
export function matchPreset(doc, store) {
  const id = (n) => (n ? store.idByName(n) : null);
  const c = doc.cube;
  for (const p of CUBE_PRESETS) {
    if ((c.exciterId ?? null) === id(p.exciter) && c.dichroicId === id(p.dichroic) && c.emitterId === id(p.emitter)) return p.name;
  }
  return null;
}

/** @param ctx {store, anchor: DOMRect, current: string|null, apply(preset)} */
export function openCubeMenu(ctx) {
  closePicker();
  closeCubeMenu();
  const { store } = ctx;
  const lbl = (n) => {
    const d = store.display(store.idByName(n));
    return `<span class="lbl">${esc(d.title)}</span>${d.brand ? `<span class="brand">(${esc(d.brand)})</span>` : ''}`;
  };
  const row = (role, n) => `<div class="cm-part"><span class="cm-role">${role}</span><span class="cm-val">${n ? lbl(n) : '<span class="muted">—</span>'}</span></div>`;

  const el = document.createElement('div');
  el.className = 'picker cube-menu';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="picker-head"><strong>Premade cubes</strong><span class="muted small">click a cube to load it</span><button class="icon close" aria-label="Close">×</button></div>
    <div class="cm-grid">
      ${CUBE_PRESETS.map((p) => `
        <button class="cm-card ${ctx.current === p.name ? 'cur' : ''}" data-p="${p.id}" title="${esc(p.paddles
          ? `Dichroic and emitter into the cube; exciters onto the matching SpectraX paddles; cube exciter left empty`
          : `Exciter, dichroic and emitter into the cube`)}">
          <span class="cm-name">${esc(p.name)}${p.part ? ` <span class="muted">${esc(p.part)}</span>` : ''}</span>
          ${p.paddles
            ? `${row('dichroic', p.dichroic)}${row('emitter', p.emitter)}
               <div class="cm-part"><span class="cm-role">exciters</span><span class="cm-val cm-paddles">${p.paddles.map((n) => `<span class="lbl">${esc(store.display(store.idByName(n)).title)}</span>`).join(' · ')} <span class="muted">→ SpectraX paddles</span></span></div>`
            : `${row('exciter', p.exciter)}${row('dichroic', p.dichroic)}${row('emitter', p.emitter)}`}
        </button>`).join('')}
    </div>`;
  document.body.appendChild(el);

  // size and place entirely inside the viewport (position: fixed → no page scroll)
  const pw = Math.min(760, window.innerWidth - 24);
  el.style.width = `${pw}px`;
  const h = el.getBoundingClientRect().height;
  const a = ctx.anchor;
  const left = Math.max(12, Math.min((a ? a.left + a.width / 2 : window.innerWidth / 2) - pw / 2, window.innerWidth - pw - 12));
  const top = Math.max(12, Math.min(a ? a.top - h - 10 : 60, window.innerHeight - h - 12));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  el.querySelectorAll('.cm-card').forEach((b) => b.addEventListener('click', async () => {
    await ctx.apply(CUBE_PRESETS.find((x) => x.id === b.dataset.p));
    closeCubeMenu();
  }));
  el.querySelector('.close').addEventListener('click', closeCubeMenu);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCubeMenu(); });
  const outside = (e) => { if (!el.contains(e.target) && !e.target.closest?.('[data-cube]')) closeCubeMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  open = { el, destroy() { document.removeEventListener('pointerdown', outside); el.remove(); } };
  (el.querySelector('.cm-card.cur') ?? el.querySelector('.cm-card'))?.focus();
}
