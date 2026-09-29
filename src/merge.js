// Three-way merge of config documents, run inside the save transaction against
// the server's current copy. Objects merge key by key; arrays of objects with the
// same length on all three sides merge element by element (acquisitions, leds,
// fluors); other arrays (e.g. ledsOn) and scalars are atomic. A field both sides
// changed differently is a conflict (local value kept, path reported).

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return a == b; // null ≈ undefined
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** @returns {{merged, conflicts: string[]}} */
export function merge3(base, local, remote, path = '') {
  const conflicts = [];
  const merged = (function go(b, l, r, p) {
    if (deepEqual(l, b)) return r; // only they changed it (or nobody did)
    if (deepEqual(r, b)) return l; // only we changed it
    if (deepEqual(l, r)) return l; // both made the same change
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r) && b.length === l.length && l.length === r.length
        && b.every(isObj) && l.every(isObj) && r.every(isObj)) {
      return b.map((_, i) => go(b[i], l[i], r[i], `${p}[${i}]`));
    }
    if (isObj(b) && isObj(l) && isObj(r)) {
      const out = {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(b)])) {
        const v = go(b[k], l[k], r[k], p ? `${p}.${k}` : k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    conflicts.push(p || '(document)');
    return l;
  })(base, local, remote, path);
  return { merged, conflicts };
}
