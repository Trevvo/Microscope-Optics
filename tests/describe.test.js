import { describe as suite, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { describe } from '../src/data/describe.js';
import { LAMBDA, N } from '../src/physics/grid.js';

const DATA = new URL('../public/data/fpbase/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', DATA)));
const load = (id) => Float64Array.from(JSON.parse(readFileSync(new URL(`s/${id}.json`, DATA))).v, (v) => v / index.scale);

suite('filter labels', () => {
  it('JS labels match the Python snapshot labels for a spread of filters', () => {
    const filters = index.components.filter((c) => c.cat === 'F' && c.label);
    // every 15th filter + all Semrock parts used by the cube presets
    const sample = filters.filter((c, i) => i % 15 === 0 || /FF01-(635\/18|515\/30|432\/515)|FF409\/493|FF699/.test(c.name));
    expect(sample.length).toBeGreaterThan(200);
    const mismatches = sample
      .map((c) => ({ c, js: describe(load(c.id), c.sub, c.range) }))
      .filter(({ c, js }) => js.label !== c.label)
      .map(({ c, js }) => `${c.name}: py "${c.label}" vs js "${js.label}"`);
    expect(mismatches).toEqual([]);
  });

  it('labels synthetic curves as expected', () => {
    const box = Float64Array.from(LAMBDA, (l) => (l >= 500 && l <= 550 ? 1 : 0));
    expect(describe(box, 'BP').label).toBe('525 ± 25');
    const lp = Float64Array.from(LAMBDA, (l) => (l >= 600 ? 0.95 : 0.01));
    // an ideal 1-nm step smoothed over 3 points crosses 50% half a nanometre early
    expect(describe(lp, 'LP', [300, 1000]).label).toMatch(/^LP (599|600)$/);
    const dc = Float64Array.from(LAMBDA, (l) => (l >= 560 ? 0.95 : 0.02));
    const d = describe(dc, 'BS', [300, 1000]);
    expect(d.label).toMatch(/^(559|560) nm$/);
    expect(d.alt).toMatch(/(559|560) dichroic/);
    expect(N).toBe(701);
  });
});
