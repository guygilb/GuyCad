// Materials, appearance finishes and sample parts.

// density in g/cm³
export const MATERIALS = {
  'Plain Carbon Steel': { density: 7.8, color: '#aeb6bf', metalness: 0.6, roughness: 0.38 },
  'Stainless Steel 304': { density: 8.0, color: '#c8ced4', metalness: 0.75, roughness: 0.28 },
  'Aluminum 6061': { density: 2.7, color: '#d5d9de', metalness: 0.65, roughness: 0.32 },
  'Titanium Ti-6Al-4V': { density: 4.43, color: '#9ea4aa', metalness: 0.65, roughness: 0.4 },
  'Brass': { density: 8.5, color: '#c9a54c', metalness: 0.85, roughness: 0.3 },
  'Copper': { density: 8.96, color: '#c4794a', metalness: 0.85, roughness: 0.3 },
  'ABS Plastic': { density: 1.04, color: '#ebebe6', metalness: 0, roughness: 0.55 },
  'Nylon 6/6': { density: 1.14, color: '#f2efe2', metalness: 0, roughness: 0.6 },
  'PLA (3D print)': { density: 1.24, color: '#ff7a45', metalness: 0, roughness: 0.5 },
  'Oak Wood': { density: 0.75, color: '#a9784b', metalness: 0, roughness: 0.85 },
  'Rubber': { density: 1.1, color: '#2d2f33', metalness: 0, roughness: 0.95 },
};

export const FINISHES = {
  'Material default': null,
  'Polished metal': { metalness: 0.95, roughness: 0.12 },
  'Satin metal': { metalness: 0.65, roughness: 0.35 },
  'Glossy plastic': { metalness: 0, roughness: 0.22 },
  'Matte plastic': { metalness: 0, roughness: 0.7 },
  'Rubber': { metalness: 0, roughness: 0.95 },
};

export const SWATCHES = [
  '#aeb6bf', '#d5d9de', '#6b7280', '#2d2f33', '#ffffff', '#c9a54c', '#c4794a', '#a9784b',
  '#d8392b', '#ff7a45', '#f3c437', '#2e9e4f', '#14b8a6', '#2d6fd8', '#6d28d9', '#db2777',
];

// Display appearance of a part document (material defaults, overridden by its appearance).
export function appearanceOf(doc) {
  const base = MATERIALS[doc.material] || MATERIALS['Plain Carbon Steel'];
  const ap = doc.appearance || {};
  const fin = FINISHES[ap.finish] || null;
  return {
    color: ap.color || base.color,
    metalness: fin ? fin.metalness : base.metalness,
    roughness: fin ? fin.roughness : base.roughness,
  };
}

const sketch = (id, name, plane, entities, constraints) => ({ id, type: 'sketch', name, plane, entities, ...(constraints ? { constraints } : {}) });

export const SAMPLES = {
  flange: {
    title: 'Pipe Flange',
    icon: 'extrude',
    description: 'Extrusions, a fillet, a through-all cut and a circular pattern of bolt holes.',
    doc: {
      name: 'Flange', material: 'Stainless Steel 304', appearance: null,
      features: [
        sketch('s1', 'Sketch1', 'Top', [{ type: 'circle', c: [0, 0], r: 50 }]),
        { id: 'f1', type: 'extrude', name: 'Boss-Extrude1', sketch: 's1', endCondition: 'blind', depth: 12, reverse: false, cut: false },
        sketch('s2', 'Sketch2', 'Top', [{ type: 'circle', c: [0, 0], r: 24 }]),
        { id: 'f2', type: 'extrude', name: 'Boss-Extrude2', sketch: 's2', endCondition: 'blind', depth: 45, reverse: false, cut: false },
        { id: 'f6', type: 'fillet', name: 'Fillet1', radius: 4, edges: [[24, 12, 0]], all: false },
        sketch('s3', 'Sketch3', 'Top', [{ type: 'circle', c: [0, 0], r: 16 }]),
        { id: 'f3', type: 'extrude', name: 'Cut-Extrude1', sketch: 's3', endCondition: 'throughAllBoth', depth: 10, reverse: false, cut: true },
        sketch('s4', 'Sketch4', 'Top', [{ type: 'circle', c: [37, 0], r: 5 }]),
        { id: 'f4', type: 'extrude', name: 'Cut-Extrude2', sketch: 's4', endCondition: 'throughAllBoth', depth: 10, reverse: false, cut: true },
        { id: 'f5', type: 'cirpattern', name: 'CirPattern1', targets: ['f4'], axis: 'Y', count: 6, angle: 360, equal: true, reverse: false },
      ],
    },
  },
  bracket: {
    title: 'Angle Bracket',
    icon: 'extrude',
    description: 'An L-profile extruded mid-plane with holes cut from two directions.',
    doc: {
      name: 'Bracket', material: 'Aluminum 6061', appearance: null,
      features: [
        sketch('s1', 'Sketch1', 'Front', [
          { type: 'line', a: [0, 0], b: [80, 0] }, { type: 'line', a: [80, 0], b: [80, 10] },
          { type: 'line', a: [80, 10], b: [10, 10] }, { type: 'line', a: [10, 10], b: [10, 60] },
          { type: 'line', a: [10, 60], b: [0, 60] }, { type: 'line', a: [0, 60], b: [0, 0] },
        ]),
        { id: 'f1', type: 'extrude', name: 'Boss-Extrude1', sketch: 's1', endCondition: 'midplane', depth: 50, reverse: false, cut: false },
        sketch('s2', 'Sketch2', 'Top', [{ type: 'circle', c: [55, 12], r: 5 }]),
        { id: 'f2', type: 'extrude', name: 'Cut-Extrude1', sketch: 's2', endCondition: 'throughAllBoth', depth: 10, reverse: false, cut: true },
        { id: 'f3', type: 'mirror', name: 'Mirror1', targets: ['f2'], plane: 'Front' },
        sketch('s3', 'Sketch3', 'Right', [{ type: 'rect', a: [-12, 30], b: [12, 46] }]),
        { id: 'f4', type: 'extrude', name: 'Cut-Extrude2', sketch: 's3', endCondition: 'throughAllBoth', depth: 10, reverse: false, cut: true },
      ],
    },
  },
  vase: {
    title: 'Revolved Vase',
    icon: 'revolve',
    description: 'A closed wall profile revolved 360° around a centerline.',
    doc: {
      name: 'Vase', material: 'ABS Plastic', appearance: { color: '#14b8a6', finish: 'Glossy plastic' },
      features: [
        sketch('s1', 'Sketch1', 'Front', [
          { type: 'centerline', a: [0, 0], b: [0, 110] },
          ...[[0, 0], [30, 0], [40, 30], [28, 72], [22, 96], [27, 104], [23, 104], [18, 96], [24, 72], [36, 30], [26, 4], [0, 4]]
            .map((p, i, a) => ({ type: 'line', a: p, b: a[(i + 1) % a.length] })),
        ]),
        { id: 'f1', type: 'revolve', name: 'Revolve1', sketch: 's1', axis: 'cl:0', angle: 360, reverse: false, cut: false },
      ],
    },
  },
  plate: {
    title: 'Mounting Plate',
    icon: 'linpattern',
    description: 'Plate with patterned and mirrored slots, plus a hex boss on an offset plane.',
    doc: {
      name: 'Plate', material: 'Plain Carbon Steel', appearance: null,
      features: [
        sketch('s1', 'Sketch1', 'Top', [{ type: 'rect', a: [-60, -35], b: [60, 35] }]),
        { id: 'f1', type: 'extrude', name: 'Boss-Extrude1', sketch: 's1', endCondition: 'blind', depth: 8, reverse: false, cut: false },
        sketch('s2', 'Sketch2', 'Top', [
          { type: 'line', a: [-45, -15], b: [-45, 15] },
          { type: 'arc', c: [-40, 15], r: 5, a0: 0, a1: Math.PI },
          { type: 'line', a: [-35, 15], b: [-35, -15] },
          { type: 'arc', c: [-40, -15], r: 5, a0: Math.PI, a1: Math.PI * 2 },
        ]),
        { id: 'f2', type: 'extrude', name: 'Cut-Extrude1', sketch: 's2', endCondition: 'throughAllBoth', depth: 10, reverse: false, cut: true },
        { id: 'f3', type: 'linpattern', name: 'LPattern1', targets: ['f2'], direction: 'X', reverse: false, spacing: 20, count: 2 },
        { id: 'f5', type: 'mirror', name: 'Mirror1', targets: ['f2', 'f3'], plane: 'Right' },
        { id: 'p1', type: 'plane', name: 'Plane1', base: 'Top', offset: 8, flip: false },
        sketch('s3', 'Sketch3', 'p1', [{ type: 'polygon', c: [0, 0], r: 14, n: 6, rot: 0 }]),
        { id: 'f4', type: 'extrude', name: 'Boss-Extrude2', sketch: 's3', endCondition: 'blind', depth: 16, reverse: false, cut: false },
      ],
    },
  },
  enclosure: {
    title: 'Electronics Enclosure',
    icon: 'shell',
    description: 'A box with filleted corners, shelled open at the top, with a cut-out port.',
    doc: {
      name: 'Enclosure', material: 'ABS Plastic', appearance: { color: '#2d6fd8', finish: 'Matte plastic' },
      features: [
        sketch('s1', 'Sketch1', 'Top', [{ type: 'rect', a: [-40, -25], b: [40, 25] }]),
        { id: 'f1', type: 'extrude', name: 'Boss-Extrude1', sketch: 's1', endCondition: 'blind', depth: 30, reverse: false, cut: false },
        { id: 'f2', type: 'fillet', name: 'Fillet1', radius: 8, edges: [[40, 15, 25], [-40, 15, 25], [40, 15, -25], [-40, 15, -25]], all: false },
        { id: 'f3', type: 'shell', name: 'Shell1', thickness: 2, faces: [[0, 30, 0]] },
        sketch('s2', 'Sketch2', 'Front', [{ type: 'rect', a: [-10, 8], b: [10, 14] }]),
        { id: 'f4', type: 'extrude', name: 'Cut-Extrude1', sketch: 's2', endCondition: 'throughAll', depth: 10, reverse: false, cut: true },
        { id: 'f5', type: 'chamfer', name: 'Chamfer1', distance: 1, edges: [[0, 0, 25]], all: false },
      ],
    },
  },
};

const PIN = {
  name: 'Pin', material: 'Brass', appearance: null,
  features: [
    sketch('s1', 'Sketch1', 'Front', [
      { type: 'centerline', a: [0, -5], b: [0, 40] },
      ...[[0, 0], [4.8, 0], [4.8, 30], [8, 30], [8, 34], [0, 34]].map((p, i, a) => ({ type: 'line', a: p, b: a[(i + 1) % a.length] })),
    ]),
    { id: 'f1', type: 'revolve', name: 'Revolve1', sketch: 's1', axis: 'cl:0', angle: 360, reverse: false, cut: false },
    { id: 'f2', type: 'chamfer', name: 'Chamfer1', distance: 0.8, edges: [[4.8, 0, 0]], all: false },
  ],
};

const pinMates = (comp, z, n) => [
  {
    id: `m${n}a`, name: `Concentric${n}`, type: 'concentric', flip: false,
    a: { comp: 'c1', ref: { kind: 'axis', point: [55, 0, z], dir: [0, 1, 0], radius: 5 } },
    b: { comp, ref: { kind: 'axis', point: [0, 0, 0], dir: [0, 1, 0], radius: 4.8 } },
  },
  {
    id: `m${n}b`, name: `Coincident${n}`, type: 'coincident', flip: false,
    a: { comp: 'c1', ref: { kind: 'plane', point: [40, 10, 0], normal: [0, 1, 0] } },
    b: { comp, ref: { kind: 'plane', point: [6, 30, 0], normal: [0, -1, 0] } },
  },
];

SAMPLES.pinnedBracket = {
  title: 'Pinned Bracket (assembly)',
  icon: 'assembly',
  description: 'The bracket with two brass pins positioned by concentric and coincident mates.',
  doc: {
    type: 'assembly', name: 'PinnedBracket',
    components: [
      { id: 'c1', name: 'Bracket', part: JSON.parse(JSON.stringify(SAMPLES.bracket.doc)), position: [0, 0, 0], quaternion: [0, 0, 0, 1], fixed: true },
      { id: 'c2', name: 'Pin', part: JSON.parse(JSON.stringify(PIN)), position: [90, 30, -30], quaternion: [0, 0, 0, 1], fixed: false },
      { id: 'c3', name: 'Pin', part: JSON.parse(JSON.stringify(PIN)), position: [110, 30, 30], quaternion: [0, 0, 0, 1], fixed: false },
    ],
    mates: [...pinMates('c2', -12, 1), ...pinMates('c3', 12, 2)],
  },
};
