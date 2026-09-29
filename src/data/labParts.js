// The lab's own filters ("our filters") and premade cubes. Parts are referenced by
// their snapshot names (stable, readable) and resolved to spectrum IDs at load.
// The inventory seeds the shared, editable list stored in the backend; the cube
// presets are fixed here.

// As given by the lab, mapped to specific parts. Notes mark guesses to confirm.
export const DEFAULT_INVENTORY = [
  // Semrock LED-DA/FI/TR/Cy5-4X4M-B (quad Sedat set)
  { want: '378/52', name: 'Semrock FF01-378/52' },
  { want: '474/27', name: 'Semrock FF01-474/27' },
  { want: '554/23', name: 'Semrock FF01-554/23' },
  { want: '635/18', name: 'Semrock FF01-635/18' },
  { want: 'quad dichroic', name: 'Semrock FF409/493/573/652-Di02' },
  { want: '432/36', name: 'Semrock FF01-432/36' },
  { want: '515/30', name: 'Semrock FF01-515/30' },
  { want: '595/31', name: 'Semrock FF01-595/31' },
  { want: '698/70', name: 'Semrock FF01-698/70' },
  { want: 'quad emitter', name: 'Semrock FF01-432/515/595/730', note: 'multiband emitter in the quad cube' },
  // Semrock LED-CFP/YFP/mCherry-3X3M-A (triple Sedat set)
  { want: '438/24', name: 'Semrock FF02-438/24', note: 'triple-set exciter; not in the list but part of the cube' },
  { want: '509/22', name: 'Semrock FF01-509/22' },
  { want: '578/21', name: 'Semrock FF01-578/21' },
  { want: 'triple dichroic', name: 'Semrock FF459/526/596-DI01' },
  { want: '482/25', name: 'Semrock FF01-482/25' },
  { want: '554/24', name: 'Semrock FF01-544/24', note: 'listed as 554/24; assumed to be the triple set’s 544/24 emitter' },
  { want: '641/75', name: 'Semrock FF02-641/75' },
  { want: 'triple emitter', name: 'Semrock FF01-475/543/702', note: 'multiband emitter in the triple cube' },
  // SPECTRA X paddle filters (Lumencor)
  { want: '438/29', name: 'Lumencor 438/29x' },
  { want: '510/25', name: 'Lumencor 510/25x', note: 'Lumencor teal filter; Chroma D510/25x is the other 510/25 in FPbase' },
  { want: '555/28', name: 'Lumencor 555/28x' },
  { want: '575/25', name: 'Lumencor 575/25x', note: 'Semrock FF01-575/25 also exists' },
  { want: '730/40', name: 'Lumencor 730/40x', note: 'Chroma ET730/40m also exists' },
  // POS cubes and others
  { want: '532 dichroic', name: 'Semrock DI03-R532', note: 'best-fitting 532 edge (538 nm); Chroma RT532rdc is the alternative' },
  { want: '545/40', name: 'Chroma ET545/40m' },
  { want: '555/25', name: 'Chroma ET555/25x' },
  { want: '652 dichroic', name: 'Semrock FF652-Di01' },
  { want: '667/30', name: 'Chroma ET667/30m' },
  { want: '660/30', name: 'Semrock FF01-660/30' },
  { want: '699 dichroic', name: 'Semrock FF699-FDi01', note: 'not in FPbase; spectrum from Semrock SearchLight' },
  { want: '775/140', name: 'Semrock FF01-775/140' },
  { want: '510 dichroic', name: 'Semrock FF510-Di02' },
  { want: '560 dichroic', name: 'Semrock FF560-FDi01', note: 'image-splitting version (Gemini); FF560-Di01 is the cube version' },
];

// Premade cubes. Triple/Quad: dichroic + multiband emitter sit in the cube; their
// single-band exciters go on the SpectraX paddles (each on the LED whose unfiltered
// output it overlaps most) and the cube exciter slot is left empty.
const QUAD = 'Semrock FF409/493/573/652-Di02';
const QUAD_EM = 'Semrock FF01-432/515/595/730';
const TRIPLE = 'Semrock FF459/526/596-DI01';
const TRIPLE_EM = 'Semrock FF01-475/543/702';
export const CUBE_PRESETS = [
  {
    id: 'triple', name: 'Triple', part: 'Semrock LED-CFP/YFP/mCherry-3X3M-A-OFF', dichroic: TRIPLE, emitter: TRIPLE_EM,
    paddles: ['Semrock FF02-438/24', 'Semrock FF01-509/22', 'Semrock FF01-578/21'],
  },
  {
    id: 'quad', name: 'Quad', part: 'Semrock LED-DA/FI/TR/Cy5-4X4M-B-OFF', dichroic: QUAD, emitter: QUAD_EM,
    paddles: ['Semrock FF01-378/52', 'Semrock FF01-474/27', 'Semrock FF01-554/23', 'Semrock FF01-635/18'],
  },
  { id: 'pos-g', name: 'POS-G', exciter: 'Lumencor 510/25x', dichroic: 'Semrock DI03-R532', emitter: 'Chroma ET545/40m' },
  { id: 'pos-a', name: 'POS-A', exciter: 'Lumencor 555/28x', dichroic: QUAD, emitter: QUAD_EM },
  { id: 'pos-t', name: 'POS-T', exciter: 'Semrock FF01-635/18', dichroic: 'Semrock FF652-Di01', emitter: 'Chroma ET667/30m' },
  { id: 'pos-c', name: 'POS-C', exciter: 'Semrock FF01-660/30', dichroic: 'Semrock FF699-FDi01', emitter: 'Semrock FF01-775/140' },
];

// Preferred excitation (paddle) filters for each SpectraX LED, shown as their own
// column when choosing that LED's paddle filter.
export const PADDLE_PREFERRED = {
  violet: ['Semrock FF01-378/52'],
  blue: ['Lumencor 438/29x'],
  cyan: ['Semrock FF01-474/27', 'Semrock FF01-509/22'],
  green: ['Semrock FF01-578/21', 'Semrock FF01-554/23'],
  red: ['Semrock FF01-635/18', 'Semrock FF01-660/30'],
  nir: ['Lumencor 730/40x'],
};
