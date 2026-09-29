// Top bar: editable config title (hover to reveal; click the caret for the
// config menu), notes, acquisition tabs, and the Details toggle.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (t) => {
  const d = t?.toDate?.() ?? (t ? new Date(t) : null);
  if (!d || Number.isNaN(+d)) return '';
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString();
};

/**
 * @param ctx {doc, configs, currentId, user, mode, status, menuOpen, showArchived, filter, revisions,
 *             notesOpen, acqIndex, warnCount, detailsOpen, on: {...}}
 */
export function renderTopbar(el, ctx) {
  const d = ctx.doc;
  const q = ctx.filter.toLowerCase();
  const list = ctx.configs
    .filter((c) => (ctx.showArchived || !c.archived || c.id === ctx.currentId) && (!q || c.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const acqs = d?.acquisitions ?? [];
  const cur = Math.min(ctx.acqIndex, acqs.length - 1);

  el.innerHTML = `
    <div class="tb-left">
      <div class="title-wrap">
        <input class="cfg-title" value="${esc(d?.name ?? '')}" size="${Math.max(8, Math.min(40, (d?.name ?? '').length + 1))}" maxlength="120" aria-label="Configuration name" title="Click to rename" ${d ? '' : 'disabled'}>
        <button class="title-caret" aria-haspopup="menu" aria-expanded="${ctx.menuOpen}" title="Switch or manage configurations">▾</button>
        <span class="status ${ctx.status.cls}">${esc(ctx.status.text)}</span>
      </div>
      ${ctx.menuOpen ? `<div class="cfg-menu" role="menu">
        <input type="search" class="cfg-filter" placeholder="Find a configuration…" value="${esc(ctx.filter)}">
        <ul class="cfg-list">${list.map((c) => `<li data-id="${c.id}" class="${c.id === ctx.currentId ? 'cur' : ''} ${c.archived ? 'archived' : ''}" role="menuitem">
          <span class="nm">${esc(c.name)}</span><span class="meta">${esc(c.updatedBy ?? '')} · ${when(c.updatedAt)}</span></li>`).join('') || '<li class="muted">No configurations</li>'}</ul>
        <div class="row">
          <button data-new>New</button><button data-dup ${d ? '' : 'disabled'}>Duplicate</button>
          <button data-arch ${d ? '' : 'disabled'}>${d?.archived ? 'Unarchive' : 'Archive'}</button>
          <label class="small"><input type="checkbox" data-showarch ${ctx.showArchived ? 'checked' : ''}> archived</label>
        </div>
        <div class="row"><button data-version ${d ? '' : 'disabled'}>Save version</button><button data-history ${d ? '' : 'disabled'}>${ctx.revisions ? 'Hide history' : 'History'}</button></div>
        ${ctx.revisions ? `<ul class="rev-list">${ctx.revisions.length ? ctx.revisions.map((r) => `<li><span>${esc(r.label || 'autosnapshot')}<br><span class="meta">${esc(r.savedBy)} · ${r.savedAt.toLocaleString()}</span></span><button data-restore="${r.id}">Restore</button></li>`).join('') : '<li class="muted">No versions yet</li>'}</ul>` : ''}
        <div class="menu-foot">${ctx.mode === 'local' ? '<span class="badge warn">local mode — saved in this browser only</span>' : `signed in as <b>${esc(ctx.user)}</b> · <a href="#" data-signout>sign out</a>`}</div>
      </div>` : ''}
      ${d ? `<div class="notes ${ctx.notesOpen ? 'open' : ''}">
        <button class="notes-toggle" aria-expanded="${ctx.notesOpen}">Notes ${ctx.notesOpen ? '▾' : '▸'}${!ctx.notesOpen && d.description ? ` <span class="muted">${esc(d.description.slice(0, 40))}${d.description.length > 40 ? '…' : ''}</span>` : ''}</button>
        ${ctx.notesOpen ? `<textarea class="notes-text" rows="5" maxlength="2000" placeholder="Notes about this setup (who uses it, what it's for, caveats…)">${esc(d.description)}</textarea>` : ''}
      </div>` : ''}
    </div>
    <div class="tb-center" role="tablist" aria-label="Acquisitions">
      ${acqs.map((a, i) => `<span class="acq-tab ${i === cur ? 'on' : ''}">
        ${i === cur ? `<input class="acq-name" value="${esc(a.name)}" maxlength="40" aria-label="Acquisition name" size="${Math.max(4, (a.name || '').length)}">` : `<button role="tab" data-tab="${i}" aria-selected="false">${esc(a.name || `Acq ${i + 1}`)}</button>`}
        ${i === cur && acqs.length > 1 ? `<button class="icon x" data-del="${i}" title="Delete this acquisition" aria-label="Delete acquisition">×</button>` : ''}
      </span>`).join('')}
      <button class="acq-add" data-add title="Add an acquisition (copy of the current one)">+</button>
      <span class="hint">toggle LEDs on the light engine →</span>
    </div>
    <div class="tb-right">
      <button class="details-btn ${ctx.detailsOpen ? 'on' : ''}" data-details aria-pressed="${ctx.detailsOpen}">
        ${ctx.warnCount ? `<span class="warn-dot" title="${ctx.warnCount} warning(s)">${ctx.warnCount}</span>` : ''}Detailed graphs
      </button>
    </div>`;

  const on = ctx.on;
  const title = el.querySelector('.cfg-title');
  title?.addEventListener('input', () => on.rename(title.value));
  title?.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });
  el.querySelector('.title-caret').addEventListener('click', on.toggleMenu);
  if (ctx.menuOpen) {
    const f = el.querySelector('.cfg-filter');
    f.addEventListener('input', () => on.setFilter(f.value));
    el.querySelectorAll('.cfg-list [data-id]').forEach((li) => li.addEventListener('click', () => on.open(li.dataset.id)));
    el.querySelector('[data-new]').addEventListener('click', on.create);
    el.querySelector('[data-dup]').addEventListener('click', on.duplicate);
    el.querySelector('[data-arch]').addEventListener('click', on.archive);
    el.querySelector('[data-showarch]').addEventListener('change', on.toggleArchived);
    el.querySelector('[data-version]').addEventListener('click', on.saveVersion);
    el.querySelector('[data-history]').addEventListener('click', on.history);
    el.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => on.restore(b.dataset.restore)));
    el.querySelector('[data-signout]')?.addEventListener('click', (e) => { e.preventDefault(); on.signOut(); });
  }
  el.querySelector('.notes-toggle')?.addEventListener('click', on.toggleNotes);
  el.querySelector('.notes-text')?.addEventListener('input', (e) => on.notes(e.target.value));
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => on.selectAcq(+b.dataset.tab)));
  el.querySelector('.acq-name')?.addEventListener('change', (e) => on.renameAcq(cur, e.target.value.trim()));
  el.querySelector('[data-del]')?.addEventListener('click', () => on.deleteAcq(cur));
  el.querySelector('[data-add]').addEventListener('click', () => on.addAcq(cur));
  el.querySelector('[data-details]').addEventListener('click', on.toggleDetails);
}
