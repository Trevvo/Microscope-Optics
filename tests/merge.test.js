import { describe, it, expect } from 'vitest';
import { merge3 } from '../src/merge.js';

const base = { name: 'x', cube: { exciterId: '1', dichroicId: '2' }, acquisitions: [{ name: 'A', ledsOn: ['cyan'] }] };

describe('merge3', () => {
  it('combines edits to different fields', () => {
    const local = { ...base, cube: { ...base.cube, exciterId: '9' } };
    const remote = { ...base, name: 'renamed' };
    const { merged, conflicts } = merge3(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.name).toBe('renamed');
    expect(merged.cube.exciterId).toBe('9');
  });

  it('reports a conflict when both change the same field differently, keeping local', () => {
    const local = { ...base, acquisitions: [{ name: 'A', ledsOn: ['cyan', 'red'] }] };
    const remote = { ...base, acquisitions: [{ name: 'A', ledsOn: ['cyan', 'violet'] }] };
    const { merged, conflicts } = merge3(base, local, remote);
    expect(conflicts).toEqual(['acquisitions[0].ledsOn']);
    expect(merged.acquisitions[0].ledsOn).toEqual(['cyan', 'red']);
  });

  it('merges edits to different elements of an object array (acquisitions)', () => {
    const b2 = { acquisitions: [{ name: 'A', ledsOn: ['cyan'] }, { name: 'B', ledsOn: ['green'] }] };
    const local = { acquisitions: [{ name: 'A', ledsOn: ['cyan', 'red'] }, b2.acquisitions[1]] };
    const remote = { acquisitions: [b2.acquisitions[0], { name: 'B', ledsOn: [] }] };
    const { merged, conflicts } = merge3(b2, local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.acquisitions.map((a) => a.ledsOn)).toEqual([['cyan', 'red'], []]);
  });

  it('identical changes on both sides are not a conflict', () => {
    const both = { ...base, name: 'same' };
    expect(merge3(base, both, { ...both }).conflicts).toEqual([]);
  });
});
