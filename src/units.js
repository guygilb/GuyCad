// Unit handling. All geometry is stored internally in millimetres and degrees.
export const UNIT_DEFS = {
  mm: { factor: 1, label: 'mm', system: 'MMGS', digits: 2, mass: { factor: 1, label: 'g' } },
  cm: { factor: 10, label: 'cm', system: 'CGS', digits: 3, mass: { factor: 1, label: 'g' } },
  in: { factor: 25.4, label: 'in', system: 'IPS', digits: 3, mass: { factor: 453.59237, label: 'lb' } },
};

let current = 'mm';

const round = (v, d) => {
  const p = Math.pow(10, d);
  const r = Math.round(v * p) / p;
  return Object.is(r, -0) ? 0 : r;
};

export const units = {
  get id() { return current; },
  set(id) { if (UNIT_DEFS[id]) current = id; },
  get def() { return UNIT_DEFS[current]; },
  toDisplay(mm) { return round(mm / UNIT_DEFS[current].factor, UNIT_DEFS[current].digits + 2); },
  fromDisplay(v) { return v * UNIT_DEFS[current].factor; },
  fmt(mm, withUnit = true) {
    const d = UNIT_DEFS[current];
    const s = round(mm / d.factor, d.digits);
    return withUnit ? `${s} ${d.label}` : `${s}`;
  },
  fmtArea(mm2) { const d = UNIT_DEFS[current]; return `${round(mm2 / (d.factor ** 2), d.digits)} ${d.label}²`; },
  fmtVolume(mm3) { const d = UNIT_DEFS[current]; return `${round(mm3 / (d.factor ** 3), d.digits)} ${d.label}³`; },
  fmtMass(g) { const m = UNIT_DEFS[current].mass; return `${round(g / m.factor, 3)} ${m.label}`; },
};
