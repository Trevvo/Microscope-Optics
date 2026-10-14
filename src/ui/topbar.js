// Top bar: editable config title (hover to reveal; click the caret for the
// config menu), Save button, notes, acquisition tabs, and the Details toggle.

import { TEST_ID, revisionKind } from '../schema.js';

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
 * @param ctx {doc, configs, currentId, user, mode, status, dirty, menuOpen, filter, revisions, historyTab,
 *             confirmDelete, notesOpen, acqIndex, warnCount, detailsOpen, on: {...}}
 */
export function renderTopbar(el, ctx) {
  const d = ctx.doc;
  const q = ctx.filter.toLowerCase();
  const isTest = ctx.currentId === TEST_ID;
  const match = (c) => !q || c.name.toLowerCase().includes(q);
  const test = ctx.configs.find((c) => c.id === TEST_ID);
  const others = ctx.configs.filter((c) => c.id !== TEST_ID && match(c)).sort((a, b) => a.name.localeCompare(b.name));
  const item = (c) => `<li data-id="${c.id}" class="${c.id === ctx.currentId ? 'cur' : ''} ${c.id === TEST_ID ? 'test' : ''}" role="menuitem">
          <span class="nm">${esc(c.id === TEST_ID ? 'TEST' : c.name)}${c.id === TEST_ID ? ' <span class="badge">shared sandbox</span>' : ''}</span><span class="meta">${esc(c.updatedBy ?? '')} · ${when(c.updatedAt)}</span></li>`;
  const listHtml = [
    test && match(test) ? item(test) : '',
    test && match(test) ? '<li class="sep" role="separator" aria-hidden="true">────────────</li>' : '',
    ...others.map(item),
  ].join('') || '<li class="muted">No configurations</li>';
  const revs = (ctx.revisions ?? []).filter((r) => revisionKind(r) === ctx.historyTab);
  const nManual = (ctx.revisions ?? []).filter((r) => revisionKind(r) === 'manual').length;
  const nSave = (ctx.revisions ?? []).length - nManual;
  const acqs = d?.acquisitions ?? [];
  const cur = Math.min(ctx.acqIndex, acqs.length - 1);

  el.innerHTML = `
    <div class="tb-left">
      <div class="title-wrap">
        <input class="cfg-title" value="${esc(isTest ? 'TEST' : d?.name ?? '')}" size="${Math.max(8, Math.min(40, (d?.name ?? '').length + 1))}" maxlength="120" aria-label="Configuration name" title="${isTest ? 'TEST is the shared sandbox and can\'t be renamed' : 'Click to rename'}" ${d && !isTest ? '' : 'readonly'}>
        <button class="title-caret" aria-haspopup="menu" aria-expanded="${ctx.menuOpen}" title="Switch or manage configurations">▾</button>
        <button class="save-btn ${ctx.dirty ? 'dirty' : ''}" data-save ${d && ctx.dirty ? '' : 'disabled'} title="Save this configuration (Ctrl/⌘+S)">Save</button>
        <span class="status ${ctx.status.cls}">${esc(ctx.status.text)}</span>
      </div>
      ${ctx.menuOpen ? `<div class="cfg-menu" role="menu">
        <input type="search" class="cfg-filter" placeholder="Find a configuration…" value="${esc(ctx.filter)}">
        <ul class="cfg-list">${listHtml}</ul>
        <div class="row">
          <button data-new>New</button><button data-dup ${d ? '' : 'disabled'}>Duplicate</button>
          ${isTest ? '<span class="small">TEST can’t be deleted</span>' : `<button data-delete class="danger" ${d ? '' : 'disabled'}>Delete…</button>`}
        </div>
        ${ctx.confirmDelete && !isTest ? `<div class="confirm-del" role="alertdialog">
          Delete “${esc(d?.name)}” and all its history for everyone? This can’t be undone.
          <div class="row"><button data-delete-yes class="danger">Delete permanently</button><button data-delete-no>Cancel</button></div></div>` : ''}
        <div class="row"><button data-version ${d ? '' : 'disabled'} title="Keep a labelled snapshot in the Manual history">Save version…</button><button data-history ${d ? '' : 'disabled'}>${ctx.revisions ? 'Hide history' : 'History'}</button></div>
        ${ctx.revisions ? `<div class="hist-tabs" role="tablist">
            <button role="tab" data-htab="manual" class="${ctx.historyTab === 'manual' ? 'on' : ''}" aria-selected="${ctx.historyTab === 'manual'}">Manual <span class="muted">${nManual}</span></button>
            <button role="tab" data-htab="save" class="${ctx.historyTab === 'save' ? 'on' : ''}" aria-selected="${ctx.historyTab === 'save'}">Saves <span class="muted">${nSave}</span></button>
          </div>
          <ul class="rev-list">${revs.length ? revs.map((r) => `<li><span>${esc(r.label || (revisionKind(r) === 'save' ? 'save' : 'version'))}<br><span class="meta">${esc(r.savedBy)} · ${r.savedAt.toLocaleString()}</span></span><button data-restore="${r.id}">Restore</button></li>`).join('') : `<li class="muted">${ctx.historyTab === 'manual' ? 'No manual versions yet — use “Save version…”' : 'No saves recorded yet'}</li>`}</ul>` : ''}
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
  el.querySelector('[data-save]').addEventListener('click', on.save);
  if (ctx.menuOpen) {
    const f = el.querySelector('.cfg-filter');
    f.addEventListener('input', () => on.setFilter(f.value));
    el.querySelectorAll('.cfg-list [data-id]').forEach((li) => li.addEventListener('click', () => on.open(li.dataset.id)));
    el.querySelector('[data-new]').addEventListener('click', on.create);
    el.querySelector('[data-dup]').addEventListener('click', on.duplicate);
    el.querySelector('[data-delete]')?.addEventListener('click', on.askDelete);
    el.querySelector('[data-delete-yes]')?.addEventListener('click', on.doDelete);
    el.querySelector('[data-delete-no]')?.addEventListener('click', on.cancelDelete);
    el.querySelectorAll('[data-htab]').forEach((b) => b.addEventListener('click', () => on.historyTab(b.dataset.htab)));
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
