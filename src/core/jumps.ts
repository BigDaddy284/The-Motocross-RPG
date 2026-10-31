// The jumps (Boss, 29 Oct 2026, from the supercross jump chart): each jump type is a row of
// peaks along its section, and the ways a rider can take it are hops from one spot to another.
// A tabletop is cleared, or landed on short of the end and ridden off; a triple is tripled, or
// doubled then singled; a quad is a quad, a double-double or single-double-single; a dragon's
// back is skipped top to top, or doubled, then launched off its last hump. The race view flies
// each wheel along the same hops (trackSurface.ts flightY), so a bike leaves the lip the moment
// its front wheel passes it, tangent to the face it rode up, and lands where the hop says.
//
// Shapes are in u (0 to 1 along the section) and heights as a share of the section's height.

/** One hump of a jump: it rises from a to b, stays up (a deck) from b to c, and falls from c to d. */
export interface Peak {
  a: number;
  b: number;
  c: number;
  d: number;
  /** Its height as a share of the section's. */
  h: number;
}

/** A way of riding a jump: hops from a take-off u to a landing u, in order; none is rolling it. */
export interface Way {
  name: string;
  hops: [number, number][];
  /**
   * How likely it is, from a rider's jumping (0 to 1): the weight at 0 and at 1, straight between.
   * Every way is possible for everyone, just less or more likely.
   */
  w: [number, number];
  /** The way a jump comes up short on a mistake: a hard landing on the face. */
  short?: boolean;
}

export interface JumpDef {
  peaks: Peak[];
  ways: Way[];
}

/** Default jump face and hill heights in metres, when a section doesn't set one. */
export const DEFAULT_HEIGHTS: Record<string, number> = {
  tabletop: 2.5,
  double: 3.5,
  step_up: 3,
  triple: 3.5,
  quad: 3.5,
  step_down: 3,
  step_on: 2,
  step_on_two: 2.2,
  step_on_three: 2.4,
  on_off: 2.2,
  single_over_table: 2.8,
  table_over_single: 2.8,
  wall_jump: 2.6,
  ski_jump: 3,
  rhythm: 1.5,
  whoops: 0.6,
  rollers: 0.9,
  dragon_back: 2.2,
  uphill: 6,
  downhill: 6,
  // Enduro sections (Boss, 29 Oct 2026): a hill climb's crest, and the size of the rocks, roots and logs.
  hill_climb: 5,
  rocks: 0.35,
  roots: 0.18,
  logs: 0.4,
  log_step: 0.6,
};

const peak = (a: number, b: number, c: number, d: number, h = 1): Peak => ({ a, b, c, d, h });

/**
 * A step-on step-off (Boss, 29 Oct 2026): a single at the start with a gap to a tabletop that has
 * a slight lip on its end, to hop onto the next tabletop or, off the last, to a single at the end.
 * Like a step-up and a step-down stuck together, for tabletops. `tables` is how many tabletops
 * stand between the singles; the sizes are shares of the section.
 */
function stepOn(tables: number, size: { margin: number; single: [number, number]; gap: number; table: [number, number, number] }): JumpDef {
  const peaks: Peak[] = [];
  let u = size.margin;
  const single = (): { a: number; b: number; d: number } => {
    const a = u;
    const b = a + size.single[0];
    const d = b + size.single[1];
    peaks.push(peak(a, b, b, d, 0.7));
    u = d;
    return { a, b, d };
  };
  const first = single();
  u += size.gap;
  const tops: { a: number; b: number; lip: number }[] = [];
  for (let i = 0; i < tables; i++) {
    const a = u;
    const b = a + size.table[0];
    const c = b + size.table[1];
    const d = c + size.table[2];
    peaks.push(peak(a, b, c, d, 0.9));
    // The lip: the deck's end rises a little above the deck and is the take-off off it.
    peaks.push(peak(c - 0.05, c, c + 0.01, d, 1));
    tops.push({ a, b, lip: c + 0.005 });
    u = d + size.gap;
  }
  const last = single();
  const on: [number, number] = [first.b, tops[0].b + 0.02];
  const hops: [number, number][] = [on];
  for (let i = 1; i < tables; i++) hops.push([tops[i - 1].lip, tops[i].b + 0.02]);
  const off: [number, number] = [tops[tables - 1].lip, last.b + (last.d - last.b) * 0.35];
  const ways: Way[] = [
    { name: tables > 1 ? 'on, hop, off' : 'on and off', hops: [...hops, off], w: [0.4, 1] },
    { name: tables > 1 ? 'on, hop, roll off' : 'on and roll off', hops, w: [0.8, 0.3] },
    { name: 'roll', hops: [], w: [0.3, 0] },
    { name: 'case', hops: [[first.b, tops[0].a + size.table[0] * 0.6]], w: [0.15, 0], short: true },
  ];
  return { peaks, ways };
}

/**
 * The jumps. Hops start at a lip (a peak's b) and land on a deck, the back of a hump, or, coming
 * up short, its face. Weights lean towards the big way for a good jumper and the safe way for a
 * poor one.
 */
export const JUMPS: Record<string, JumpDef> = {
  tabletop: {
    peaks: [peak(0.16, 0.3, 0.62, 0.84)],
    ways: [
      { name: 'clear', hops: [[0.3, 0.75]], w: [0.3, 1] },
      { name: 'short', hops: [[0.3, 0.56]], w: [0.8, 0.2] },
      { name: 'roll', hops: [], w: [0.3, 0] },
      { name: 'case', hops: [[0.3, 0.66]], w: [0, 0], short: true },
    ],
  },
  double: {
    peaks: [peak(0.16, 0.3, 0.3, 0.37), peak(0.58, 0.68, 0.68, 0.86, 0.95)],
    ways: [
      { name: 'clear', hops: [[0.3, 0.76]], w: [0.3, 1] },
      { name: 'singles', hops: [[0.3, 0.42], [0.68, 0.8]], w: [0.8, 0.1] },
      { name: 'case', hops: [[0.3, 0.64]], w: [0.15, 0], short: true },
    ],
  },
  // A step-up onto a tabletop (Boss, 30 Oct 2026): the step's back runs straight into the table's
  // face, no gap between them, and the table is the tabletop's shape, so a tunnel through it is
  // the tabletop's (DECKS.step_up in trackSurface.ts) with the step in front of it.
  step_up: {
    peaks: [peak(0.06, 0.18, 0.2, 0.38, 0.55), peak(0.2, 0.34, 0.6, 0.76)],
    ways: [
      { name: 'clear', hops: [[0.18, 0.66]], w: [0.3, 1] },
      { name: 'ride up, hop off', hops: [[0.6, 0.72]], w: [0.8, 0.1] },
      { name: 'roll', hops: [], w: [0.3, 0] },
      { name: 'case', hops: [[0.18, 0.3]], w: [0.15, 0], short: true },
    ],
  },
  triple: {
    peaks: [peak(0.16, 0.3, 0.3, 0.4), peak(0.44, 0.5, 0.5, 0.6), peak(0.62, 0.68, 0.68, 0.86)],
    ways: [
      { name: 'triple', hops: [[0.3, 0.77]], w: [0.1, 1] },
      { name: 'double single', hops: [[0.3, 0.61], [0.68, 0.78]], w: [0.5, 0.4] },
      { name: 'single double', hops: [[0.3, 0.42], [0.5, 0.77]], w: [0.4, 0.3] },
      { name: 'singles', hops: [[0.3, 0.42], [0.5, 0.61], [0.68, 0.78]], w: [0.8, 0.05] },
      { name: 'case', hops: [[0.3, 0.66]], w: [0.1, 0], short: true },
    ],
  },
  quad: {
    peaks: [peak(0.1, 0.2, 0.2, 0.28), peak(0.3, 0.4, 0.4, 0.48), peak(0.5, 0.6, 0.6, 0.68), peak(0.7, 0.8, 0.8, 0.96)],
    ways: [
      { name: 'quad', hops: [[0.2, 0.9]], w: [0, 1] },
      { name: 'double double', hops: [[0.2, 0.49], [0.6, 0.9]], w: [0.4, 0.6] },
      { name: 'single double single', hops: [[0.2, 0.29], [0.4, 0.69], [0.8, 0.9]], w: [0.6, 0.3] },
      { name: 'triple single', hops: [[0.2, 0.69], [0.8, 0.9]], w: [0.1, 0.5] },
      { name: 'singles', hops: [[0.2, 0.29], [0.4, 0.49], [0.6, 0.69], [0.8, 0.9]], w: [0.8, 0.05] },
      { name: 'case', hops: [[0.2, 0.76]], w: [0.05, 0], short: true },
    ],
  },
  step_down: {
    peaks: [peak(0.16, 0.3, 0.5, 0.58), peak(0.62, 0.7, 0.7, 0.9, 0.4)],
    ways: [
      { name: 'clear', hops: [[0.3, 0.78]], w: [0.3, 1] },
      { name: 'drop', hops: [[0.5, 0.78]], w: [0.8, 0.2] },
      { name: 'case', hops: [[0.3, 0.66]], w: [0.1, 0], short: true },
    ],
  },
  // Single, tabletop with a lip, single (the tabletop's deck is DECKS.step_on in trackSurface.ts).
  step_on: stepOn(1, { margin: 0.04, single: [0.08, 0.07], gap: 0.06, table: [0.09, 0.26, 0.1] }),
  // Single, two tabletops with lips hopped from one to the next, single.
  step_on_two: stepOn(2, { margin: 0.03, single: [0.06, 0.05], gap: 0.05, table: [0.07, 0.135, 0.08] }),
  // Single, three tabletops, single.
  step_on_three: stepOn(3, { margin: 0.02, single: [0.05, 0.05], gap: 0.04, table: [0.06, 0.07, 0.07] }),
  on_off: {
    peaks: [peak(0.12, 0.24, 0.42, 0.5), peak(0.62, 0.72, 0.72, 0.9, 0.9)],
    ways: [
      { name: 'on and over', hops: [[0.16, 0.32], [0.42, 0.8]], w: [0.2, 1] },
      { name: 'on, off, single', hops: [[0.16, 0.32], [0.42, 0.56], [0.72, 0.82]], w: [0.7, 0.3] },
      { name: 'roll on, single', hops: [[0.72, 0.82]], w: [0.6, 0] },
      { name: 'case', hops: [[0.42, 0.68]], w: [0.1, 0], short: true },
    ],
  },
  single_over_table: {
    peaks: [peak(0.1, 0.22, 0.22, 0.3, 0.8), peak(0.4, 0.5, 0.72, 0.86)],
    ways: [
      { name: 'over the table', hops: [[0.22, 0.79]], w: [0.1, 1] },
      { name: 'onto the table', hops: [[0.22, 0.6]], w: [0.6, 0.4] },
      { name: 'single, roll the table', hops: [[0.22, 0.34]], w: [0.8, 0.05] },
      { name: 'case', hops: [[0.22, 0.47]], w: [0.1, 0], short: true },
    ],
  },
  table_over_single: {
    peaks: [peak(0.12, 0.24, 0.46, 0.56), peak(0.66, 0.74, 0.74, 0.88, 0.8)],
    ways: [
      { name: 'table over the single', hops: [[0.24, 0.81]], w: [0.1, 1] },
      { name: 'table, then the single', hops: [[0.24, 0.6], [0.74, 0.82]], w: [0.6, 0.4] },
      { name: 'short, then the single', hops: [[0.24, 0.42], [0.74, 0.82]], w: [0.7, 0.1] },
      { name: 'case', hops: [[0.24, 0.71]], w: [0.1, 0], short: true },
    ],
  },
  wall_jump: {
    peaks: [peak(0.28, 0.42, 0.42, 0.46)],
    ways: [
      { name: 'long', hops: [[0.42, 0.8]], w: [0.2, 1] },
      { name: 'short', hops: [[0.42, 0.62]], w: [0.8, 0.3] },
    ],
  },
  ski_jump: {
    // A long ramp to a lip the ground drops away from, then a long sloping landing.
    peaks: [peak(0.06, 0.46, 0.46, 0.6), peak(0.5, 0.58, 0.6, 0.96, 0.45)],
    ways: [
      { name: 'fly away', hops: [[0.46, 0.84]], w: [0.2, 1] },
      { name: 'short', hops: [[0.46, 0.66]], w: [0.8, 0.3] },
    ],
  },
  rhythm: {
    peaks: [peak(0.05, 0.15, 0.15, 0.26), peak(0.38, 0.48, 0.48, 0.59), peak(0.71, 0.81, 0.81, 0.93)],
    ways: [
      { name: 'double single', hops: [[0.15, 0.6], [0.81, 0.92]], w: [0.2, 1] },
      { name: 'single double', hops: [[0.15, 0.27], [0.48, 0.92]], w: [0.2, 0.8] },
      { name: 'singles', hops: [[0.15, 0.27], [0.48, 0.6], [0.81, 0.92]], w: [1, 0.1] },
      { name: 'case', hops: [[0.15, 0.45]], w: [0.1, 0], short: true },
    ],
  },
  dragon_back: {
    // Four humps, each bigger than the last, building up to the big final mound and the launch off its top.
    peaks: [peak(0.05, 0.12, 0.12, 0.18, 0.18), peak(0.23, 0.3, 0.3, 0.36, 0.32), peak(0.41, 0.48, 0.48, 0.54, 0.55), peak(0.58, 0.72, 0.74, 0.88, 1)],
    ways: [
      { name: 'skip the tops', hops: [[0.12, 0.3], [0.3, 0.48], [0.48, 0.72], [0.74, 0.93]], w: [0.3, 1] },
      { name: 'double double', hops: [[0.12, 0.48], [0.48, 0.93]], w: [0, 0.6] },
      { name: 'ride up, jump off', hops: [[0.74, 0.9]], w: [1, 0.1] },
    ],
  },
};

/** The section types that are jumps with hops (JUMPS), for the referee's mistakes and the editor. */
export const HOP_JUMPS = new Set(Object.keys(JUMPS));
/** The big single-arc jumps (a deck a tunnel can run through, the editor's tunnel kit). */
export const BIG_JUMPS = new Set(['tabletop', 'double', 'step_up', 'triple', 'quad', 'step_down', 'single_over_table', 'table_over_single', 'on_off', 'wall_jump', 'ski_jump']);
/** Bumpy ground the bike skims rather than jumps. */
export const SKIM = new Set(['whoops', 'rollers', 'braking_bumps']);

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const ramp = (u: number, a: number, b: number) => smooth((u - a) / (b - a));

/** The jump's centre-line shape at u, from 0 to 1 of its height: the tallest peak there. */
export function jumpShape(type: string, u: number): number {
  const def = JUMPS[type];
  if (!def) return 0;
  let h = 0;
  for (const p of def.peaks) h = Math.max(h, p.h * ramp(u, p.a, p.b) * (1 - ramp(u, p.c, p.d)));
  return h;
}

/**
 * Which way a rider takes a jump: drawn from `r` (0 to 1, seeded per rider, lap and section) by
 * the ways' weights at the rider's jumping (0 to 1). A mistake takes the way that comes up short.
 */
export function pickWay(type: string, jumping: number, r: number, mistake = false): Way | null {
  const def = JUMPS[type];
  if (!def) return null;
  if (mistake) {
    const short = def.ways.find((w) => w.short);
    if (short) return short;
  }
  const j = Math.max(0, Math.min(1, jumping));
  const ws = def.ways.map((w) => (w.short ? 0 : Math.max(0, w.w[0] + (w.w[1] - w.w[0]) * j)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return def.ways[0];
  let x = (r - Math.floor(r)) * total;
  for (let i = 0; i < ws.length; i++) {
    x -= ws[i];
    if (x < 0) return def.ways[i];
  }
  return def.ways[ws.length - 1];
}

/** Where a mistake on a jump happens: on the last landing of the way taken, else part way through. */
export function landingOf(way: Way | null): number | null {
  if (!way || !way.hops.length) return null;
  return way.hops[way.hops.length - 1][1];
}

/**
 * A finish-line jump (a section with `finish`): where along it the finish arch stands, as a share
 * of the section, and how high its banner's underside is above the surface there. The arch stands
 * on the front hump's lip, the take-off, where every way over the jump is still on the ground or
 * just leaving it; the clearance leaves room for a rider in the air there (the arch test checks
 * it against every way).
 */
export const ARCH_AT: Record<string, number> = { tabletop: 0.3, double: 0.3 };
export const ARCH_CLEAR = 4.6;
