import type { TrackDef } from './race';

// The shape of a lap on the track grid (no graphics), shared by the rider AI and the race view.
// f runs from 0 at the start line to 1 back at it; sections sit on the lap by their share of the
// lap length, as on the race screen.

export interface Point {
  x: number;
  y: number;
}

export interface LapGeom {
  pts: Point[];
  cum: number[];
  /** Length of the drawn lap in grid units. */
  total: number;
}

export function lapGeom(path: [number, number][]): LapGeom {
  const pts = path.map(([x, y]) => ({ x, y }));
  pts.push({ ...pts[0] });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, total: cum[cum.length - 1] || 1 };
}

/** A point on the lap and the riding direction there, in radians. */
export function pointAt(g: LapGeom, f: number): Point & { ang: number } {
  const d = (((f % 1) + 1) % 1) * g.total;
  let lo = 1;
  let hi = g.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.cum[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const a = g.pts[lo - 1];
  const b = g.pts[lo];
  const t = (d - g.cum[lo - 1]) / Math.max(1e-9, g.cum[lo] - g.cum[lo - 1]);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

/**
 * The riding direction with the corners rounded off over `span` grid units, so a bike turns
 * smoothly through a corner point instead of snapping round it.
 */
export function headingAt(g: LapGeom, f: number, span = 1.5): number {
  const df = span / g.total;
  const a = pointAt(g, f - df);
  const b = pointAt(g, f + df);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Section start fractions of the lap, plus 1 at the end. */
export function sectionBounds(track: TrackDef): number[] {
  const len = track.sections.reduce((a, s) => a + s.length, 0) || 1;
  const out = [0];
  let d = 0;
  for (const s of track.sections) {
    d += s.length;
    out.push(d / len);
  }
  return out;
}

export function lapMetres(track: TrackDef): number {
  return track.sections.reduce((a, s) => a + s.length, 0);
}

/**
 * Which way each section turns: 1 right, -1 left, 0 roughly straight (under 25 degrees), as the
 * rider sees it on the screen (y runs down).
 */
export function sectionTurns(track: TrackDef, g: LapGeom): number[] {
  const b = sectionBounds(track);
  return track.sections.map((_, i) => {
    const steps = 24;
    let turn = 0;
    let prev = headingAt(g, b[i]);
    for (let k = 1; k <= steps; k++) {
      const h = headingAt(g, b[i] + ((b[i + 1] - b[i]) * k) / steps);
      let dh = h - prev;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      turn += dh;
      prev = h;
    }
    return Math.abs(turn) < (25 * Math.PI) / 180 ? 0 : Math.sign(turn);
  });
}

/** What a stretch of the drawn lap looks like, measured from the drawing alone. */
export type DrawnShape = 'straight' | 'sweeper' | 'corner' | 'hairpin';

export interface ShapeInfo {
  shape: DrawnShape;
  /** Overall change of direction in degrees: positive turning right on the screen (y runs down). */
  turn: number;
  /** All the turning along the stretch, both ways, in degrees (an S-bend's two corners add up). */
  swept: number;
  /** Tightest radius along the stretch, in grid units. */
  radius: number;
}

/** Under this much total turn a stretch is a straight; this much or more is a hairpin (degrees). */
export const STRAIGHT_UNDER = 30;
export const HAIRPIN_FROM = 135;
/** A bend whose tightest radius is at least this many track widths is a sweeper, not a corner. */
export const SWEEPER_WIDTHS = 2;

const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/**
 * Measures the drawn lap between fractions f0 and f1: how far it turns and how tightly. Uses the
 * same rounded heading the riders follow, so it only depends on the drawing, never on a section's
 * name or its neighbours.
 */
export function drawnShape(g: LapGeom, f0: number, f1: number, width: number): ShapeInfo {
  const len = (f1 - f0) * g.total;
  const steps = Math.max(8, Math.ceil(len / 0.25));
  let turn = 0;
  let prev = headingAt(g, f0);
  const rates: number[] = [];
  let swept = 0;
  for (let k = 1; k <= steps; k++) {
    const h = headingAt(g, f0 + ((f1 - f0) * k) / steps);
    const dh = wrapAngle(h - prev);
    turn += dh;
    swept += Math.abs(dh);
    rates.push(Math.abs(dh) / (len / steps));
    prev = h;
  }
  // Tightest radius: the sharpest 3 grid units of the stretch.
  const win = Math.max(1, Math.round(3 / (len / steps)));
  let best = 0;
  let run = 0;
  for (let i = 0; i < rates.length; i++) {
    run += rates[i];
    if (i >= win) run -= rates[i - win];
    best = Math.max(best, run / Math.min(win, i + 1));
  }
  const radius = best > 1e-6 ? 1 / best : Infinity;
  // All the turning, both ways, so an S-bend counts as the corners it is.
  const deg = (swept * 180) / Math.PI;
  const shape: DrawnShape = deg < STRAIGHT_UNDER ? 'straight' : deg >= HAIRPIN_FROM ? 'hairpin' : radius >= SWEEPER_WIDTHS * width ? 'sweeper' : 'corner';
  return { shape, turn: (turn * 180) / Math.PI, swept: deg, radius };
}

/** Each section's drawn shape, in lap order. */
export function sectionShapes(track: TrackDef): ShapeInfo[] {
  const g = lapGeom(track.path);
  const b = sectionBounds(track);
  const width = track.width ?? 3.4;
  return track.sections.map((_, i) => drawnShape(g, b[i], b[i + 1], width));
}

/** The nearest point of the lap to (x, y): its lap fraction and how far away it is. */
export function nearestOnLap(g: LapGeom, x: number, y: number): { f: number; d: number } {
  let best = { f: 0, d: Infinity };
  for (let i = 1; i < g.pts.length; i++) {
    const a = g.pts[i - 1];
    const b = g.pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    if (d < best.d) best = { f: (g.cum[i - 1] + Math.sqrt(l2) * t) / g.total, d };
  }
  return best;
}

/** Grid units of start pad drawn behind the gate, where the second row lines up. */
export const START_PAD = 3;
/** The start straight is this much wider than the track at the gate, so a row of 8 bikes fits, narrowing to the track's width where it joins. */
export const START_WIDEN = 1.6;

/** Half the start straight's width `u` grid units from the gate, for a track of half-width hw. */
export function startHalfWidth(s: StartGeom, u: number, hw: number): number {
  const t = Math.max(0, Math.min(1, u / Math.max(1e-9, s.total * 0.7)));
  return hw * (1 + (START_WIDEN - 1) * (1 - t * t * (3 - 2 * t)));
}

/**
 * The start: a straight of its own from the gate to where it joins the lap, apart from the lap
 * loop. Riders line up at the gate, ride the start straight once, join the lap and ride on to
 * the finish line, which ends lap 1; every later lap is the whole loop. Race distance is
 * counted in laps from the finish line, so the gate is at `from` (below `join`, often below 0).
 */
export interface StartGeom {
  /** The start straight's points, the gate first; the last point is on the lap. */
  pts: Point[];
  cum: number[];
  /** Length of the start straight in grid units. */
  total: number;
  /** Where on the lap it joins, as a lap fraction. */
  join: number;
  /** Length of the start straight in metres, on the lap's scale. */
  metres: number;
  /** Race distance at the gate, in laps. */
  from: number;
}

export function startGeom(track: TrackDef, g: LapGeom = lapGeom(track.path)): StartGeom {
  const lap = lapMetres(track);
  const path = track.start?.path;
  if (!path || path.length < 2) {
    // No start straight: the field starts on the finish line and rides the whole lap.
    const p = pointAt(g, 0);
    return { pts: [p, p], cum: [0, 0], total: 0, join: 0, metres: 0, from: 0 };
  }
  const pts = path.map(([x, y]) => ({ x, y }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  const end = pts[pts.length - 1];
  const join = nearestOnLap(g, end.x, end.y).f;
  const metres = (total * lap) / g.total;
  return { pts, cum, total, join, metres, from: join - metres / lap };
}

/** A point on the start straight `u` grid units from the gate, and the riding direction there. Behind the gate (u < 0) it runs on back over the start pad. */
export function startPointAt(s: StartGeom, u: number): Point & { ang: number } {
  const { pts, cum } = s;
  if (s.total <= 0) return { ...pts[0], ang: 0 };
  let i = 1;
  while (i < pts.length - 1 && cum[i] < u) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const len = cum[i] - cum[i - 1] || 1e-9;
  const t = (u - cum[i - 1]) / len;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** The riding direction on the start straight, rounded through its bends like headingAt. */
export function startHeadingAt(s: StartGeom, u: number, span = 1.5): number {
  const a = startPointAt(s, u - span);
  const b = startPointAt(s, u + span);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * What a lap is made of. `marks` are race distances in laps where the referee times the riders,
 * `secs` the section ridden between each pair (-1 is the start straight) and `metres` each
 * stretch's length. Lap 1 is the start straight, then the lap from where it joins (part of a
 * section, if it joins part way through one) to the finish line; later laps are the whole loop.
 */
export function lapPlan(track: TrackDef, lap: number, bounds: number[] = sectionBounds(track), start: StartGeom = startGeom(track)): { marks: number[]; secs: number[]; metres: number[] } {
  const lapM = lapMetres(track);
  const n = track.sections.length;
  if (lap > 1 || start.metres <= 0) {
    return { marks: bounds.map((b) => lap - 1 + b), secs: track.sections.map((_, i) => i), metres: track.sections.map((s) => s.length) };
  }
  const marks = [start.from, start.join];
  const secs = [-1];
  const metres = [start.metres];
  let si = 0;
  while (si < n - 1 && bounds[si + 1] <= start.join + 1e-9) si++;
  for (let i = si; i < n; i++) {
    const a = Math.max(bounds[i], start.join);
    if (bounds[i + 1] - a < 1e-9) continue;
    marks.push(bounds[i + 1]);
    secs.push(i);
    metres.push((bounds[i + 1] - a) * lapM);
  }
  return { marks, secs, metres };
}
