// Loads the FPbase snapshot index and lazily fetches individual spectra.
// Custom (user-uploaded) spectra live in the backend and are merged in with
// IDs prefixed "c:".

import { N } from '../physics/grid.js';
import { describe } from './describe.js';

const BASE = `${import.meta.env.BASE_URL}data/fpbase/`;

export class SpectraStore {
  constructor() {
    this.index = null;
    this.components = new Map(); // id → {id, name, cat, sub, range, custom?}
    this.fluors = new Map(); // key → fluor meta
    this.cache = new Map(); // id → Float64Array
    this.pending = new Map(); // id → Promise
  }

  async load() {
    const r = await fetch(`${BASE}index.json`);
    if (!r.ok) throw new Error(`Could not load spectra index (${r.status}). Run npm run fetch-fpbase.`);
    this.index = await r.json();
    this.scale = this.index.scale;
    for (const c of this.index.components) this.components.set(c.id, c);
    for (const f of this.index.fluors) this.fluors.set(f.key, f);
    return this;
  }

  /** Merge custom spectra from the backend: [{id, name, cat, sub, data: number[701]}]. */
  setCustom(list) {
    this._byName = null;
    for (const [id, c] of this.components) if (c.custom) this.components.delete(id);
    for (const s of list) {
      const id = `c:${s.id}`;
      const arr = Float64Array.from(s.data);
      const d = s.cat === 'F' ? describe(arr, s.sub) : { label: null, alt: '' };
      this.components.set(id, { id, name: s.name, cat: s.cat, sub: s.sub, custom: true, createdBy: s.createdBy, label: d.label, alt: d.alt });
      this.cache.set(id, arr);
    }
  }

  get(id) {
    return id ? this.cache.get(id) ?? null : null;
  }

  has(id) {
    return !id || this.cache.has(id);
  }

  fetchOne(id) {
    if (!id || this.cache.has(id)) return Promise.resolve(this.cache.get(id) ?? null);
    if (id.startsWith('c:')) return Promise.resolve(null); // custom spectrum not (yet) synced
    if (!this.pending.has(id)) {
      const p = fetch(`${BASE}s/${id}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j) return null;
          const a = new Float64Array(N);
          for (let i = 0; i < N; i++) a[i] = j.v[i] / this.scale;
          this.cache.set(id, a);
          return a;
        })
        .finally(() => this.pending.delete(id));
      this.pending.set(id, p);
    }
    return this.pending.get(id);
  }

  ensure(ids) {
    return Promise.all([...new Set(ids.filter(Boolean))].map((id) => this.fetchOne(id)));
  }

  name(id) {
    return this.components.get(id)?.name ?? (id ? `#${id}` : '—');
  }

  /** {title, brand}: filters show the spectrum-derived label with the part name as brand. */
  display(id) {
    const c = this.components.get(id);
    if (!c) return { title: id ? `#${id}` : '', brand: '' };
    return c.label ? { title: c.label, brand: c.name } : { title: c.name, brand: '' };
  }

  idByName(name) {
    if (!this._byName) this._byName = new Map([...this.components.values()].map((c) => [c.name, c.id]));
    return this._byName.get(name) ?? null;
  }
}
