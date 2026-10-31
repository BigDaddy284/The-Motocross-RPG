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
  /**
   * Race distance where the start straight joins the lap, in laps: `join` when it joins in the
   * first half of the lap, `join - 1` when it joins in the second half, so lap 1 still goes right
   * round the circuit (riders pass the finish line once on the way without it counting). Lap 1
   * ends at race distance 1 either way.
   */
  joinAt: number;
  /** Race distance at the gate, in laps. */
  from: number;
}

/** A start straight joining past this lap fraction has lap 1 go right round the circuit first (see StartGeom.joinAt). */
export const JOIN_WRAP = 0.5;

export function startGeom(track: TrackDef, g: LapGeom = lapGeom(track.path)): StartGeom {
  const lap = lapMetres(track);
  const path = track.start?.path;
  if (isSprint(track)) {
    // A sprint has no start straight: riders leave one at a time from the start line at the end
    // of the return lane, and lap 1 is the test from there to the finish line.
    const join = sprintStart(track);
    const p = pointAt(g, join);
    return { pts: [p, p], cum: [0, 0], total: 0, join, metres: 0, joinAt: join, from: join };
  }
  if (!path || path.length < 2) {
    // No start straight: the field starts on the finish line and rides the whole lap.
    const p = pointAt(g, 0);
    return { pts: [p, p], cum: [0, 0], total: 0, join: 0, metres: 0, joinAt: 0, from: 0 };
  }
  const pts = path.map(([x, y]) => ({ x, y }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  const end = pts[pts.length - 1];
  const join = nearestOnLap(g, end.x, end.y).f;
  const metres = (total * lap) / g.total;
  // A No-Turn Takedown's start joins the run at its start line, after the hidden run-off, and the
  // race is that one run: lap 1 never goes right round the drawing.
  const joinAt = join > JOIN_WRAP && !isNoTurn(track) ? join - 1 : join;
  return { pts, cum, total, join, metres, joinAt, from: joinAt - metres / lap };
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
 * `secs` the section ridden between each pair (-1 is the start straight, -2 its end, the first
 * corner) and `metres` each stretch's length. Lap 1 is the start straight, then the lap from where it joins (part of a
 * section, if it joins part way through one) to the finish line; later laps are the whole loop.
 */
export function lapPlan(track: TrackDef, lap: number, bounds: number[] = sectionBounds(track), start: StartGeom = startGeom(track)): { marks: number[]; secs: number[]; metres: number[]; spans: [number, number][] } {
  const lapM = lapMetres(track);
  const n = track.sections.length;
  // Each stretch as it is ridden: the section, the lap fractions it covers and the race distance at its end.
  const legs: { si: number; a: number; b: number; end: number; metres: number }[] = [];
  if (isSprint(track)) {
    // A sprint lap: after lap 1, the roll down the return lane from the finish line and the wait
    // in the queue at the start line (SPRINT_QUEUE, no distance), then the timed test.
    track.sections.forEach((s, i) => {
      if (i === 0 && lap === 1) return;
      legs.push({ si: i, a: bounds[i], b: bounds[i + 1], end: lap - 1 + bounds[i + 1], metres: s.length });
      if (i === 0) legs.push({ si: SPRINT_QUEUE, a: bounds[1], b: bounds[1], end: lap - 1 + bounds[1], metres: 0 });
    });
    const marks = [lap === 1 ? start.from : lap - 1, ...legs.map((l) => l.end)];
    return { marks, secs: legs.map((l) => l.si), metres: legs.map((l) => l.metres), spans: legs.map((l) => [l.a, l.b]) };
  }
  if (lap > 1 || start.metres <= 0) {
    track.sections.forEach((s, i) => legs.push({ si: i, a: bounds[i], b: bounds[i + 1], end: lap - 1 + bounds[i + 1], metres: s.length }));
  } else {
    // The start straight in two: the run from the gate, then its last leg as the first corner
    // (firstCorner); then from the join to the end of the lap's drawing. A start joining in the
    // second half of the lap counts that stretch as the lap before (race distances below 0), then
    // the whole lap follows.
    const off = start.joinAt - start.join;
    const fc = isNoTurn(track) ? null : firstCorner(start);
    const fcM = fc?.metres ?? 0;
    legs.push({ si: -1, a: start.join, b: start.join, end: start.joinAt - fcM / lapM, metres: start.metres - fcM });
    if (fc) legs.push({ si: -2, a: start.join, b: start.join, end: start.joinAt, metres: fcM });
    let si = 0;
    while (si < n - 1 && bounds[si + 1] <= start.join + 1e-9) si++;
    for (let i = si; i < n; i++) {
      const a = Math.max(bounds[i], start.join);
      if (bounds[i + 1] - a < 1e-9) continue;
      legs.push({ si: i, a, b: bounds[i + 1], end: bounds[i + 1] + off, metres: (bounds[i + 1] - a) * lapM });
    }
    if (off < 0) track.sections.forEach((s, i) => legs.push({ si: i, a: bounds[i], b: bounds[i + 1], end: bounds[i + 1], metres: s.length }));
  }
  const marks = [legs.length ? legs[0].si < 0 ? start.from : lap - 1 : lap - 1];
  for (const l of legs) marks.push(l.end);
  return { marks, secs: legs.map((l) => l.si), metres: legs.map((l) => l.metres), spans: legs.map((l) => [l.a, l.b]) };
}

// ---- enduro sprints (Boss, 29 Oct 2026) ----
//
// An enduro sprint is a timed test ridden one rider at a time. The lap is drawn as a loop like any
// other, starting at the finish line, but its first section is the return lane: a single-file
// lane a quarter of the track's width from the finish line back round to the start line, ridden
// at half speed and never timed. Riders leave the start line one at a time, a few seconds apart,
// ride the test to the finish line, roll down the return lane and queue at the start line in the
// order they get there, and go again until every lap is done. Lowest total test time wins.

/** The track kind for an enduro sprint (trackParts.json kinds). */
export const SPRINT_KIND = 'enduro_sprint';
/** The section type of the return lane, a sprint's first section. */
export const RETURN_LANE = 'return_lane';
/** The stretch of a sprint lap spent waiting in the queue at the start line (lapPlan secs); it has no length. */
export const SPRINT_QUEUE = -3;
/** The return lane is this share of the track's width. */
export const RETURN_WIDTH = 0.25;
/** Grid units at each end of the return lane over which it widens to the full track. */
export const RETURN_TAPER = 3;

/** True for an enduro sprint: the Enduro Sprint kind, with its return lane as the first section. */
export function isSprint(track: Pick<TrackDef, 'kind' | 'sections'>): boolean {
  return track.kind === SPRINT_KIND && track.sections[0]?.type === RETURN_LANE;
}

/** Where a sprint's start line is, as a lap fraction: the end of the return lane. */
export function sprintStart(track: TrackDef): number {
  return sectionBounds(track)[1];
}

/**
 * How wide the track is at lap fraction f, as a share of its full width: a quarter along a
 * sprint's return lane, widening to the full width over RETURN_TAPER grid units at each end,
 * so the finish line and the start line are the full width. 1 everywhere on any other track.
 */
export function widthShare(track: TrackDef, g: LapGeom, f: number, bounds: number[] = sectionBounds(track)): number {
  if (!isSprint(track)) return 1;
  const x = ((f % 1) + 1) % 1;
  const end = bounds[1];
  if (x > end) return 1;
  const d = Math.min(x, end - x) * g.total;
  const t = Math.max(0, Math.min(1, d / RETURN_TAPER));
  return 1 - (1 - RETURN_WIDTH) * t * t * (3 - 2 * t);
}

/** The first corner: the end of the start straight, from `from` grid units up it to its join with the lap. */
export interface FirstCorner {
  from: number;
  /** Its length in metres, on the lap's scale. */
  metres: number;
  /** Its share of the start straight's length. */
  share: number;
}

/** On a start straight of only two points, the first corner is this much of its end. */
export const FIRST_CORNER_SHARE = 0.25;

/**
 * The first corner is the start straight's end: the leg between its last two points, which bends
 * onto the lap (on a straight of two points, its last quarter). It is not a section of its own:
 * the race times it as its own stretch of lap 1 (lapPlan's -2) and rides it with the first
 * corner's rules and lap 1's first-corner incident (race.ts). Null without a start straight.
 */
export function firstCorner(start: StartGeom): FirstCorner | null {
  if (start.total <= 0) return null;
  const n = start.pts.length;
  const from = n >= 3 ? start.cum[n - 2] : start.total * (1 - FIRST_CORNER_SHARE);
  const share = (start.total - from) / start.total;
  return { from, metres: start.metres * share, share };
}

// ---- No-Turn Takedown (Boss, 30 Oct 2026) ----
//
// A No-Turn Takedown is a straight drag strip: riders drop off a raised start platform four at a
// time and race one run, straight to the finish line, in knockout heats. The drawing is still a
// closed loop starting at the finish line, as every track is, but its first section is the
// run-off: a few grid units of track past the finish line where finishers pull up, then a hidden
// way back to the start line that is never drawn or ridden (hiddenSpans). The run is the drawing's
// last edge, from the start line straight to the finish line, so it can never bend. The start
// platform is the start straight: straight on from the gate, in line with the run.

/** The track kind for a No-Turn Takedown (trackParts.json kinds). */
export const NO_TURN_KIND = 'no_turn';
/** The section type of the run-off past the finish line and the hidden way back, a No-Turn Takedown's first section. */
export const RUN_OFF = 'run_off';
/** Grid units of run-off drawn past the finish line. */
export const NO_TURN_RUNOFF = 8;
/** How far off the run the hidden way back goes, in grid units: off the grid, clear of everything on it. */
export const NO_TURN_HIDDEN = 40;
/** Grid units the hidden way back runs in line with the run before the start line, so the run sets off straight. */
export const NO_TURN_LEAD = 2;
/** Riders on the gate at a time. */
export const NO_TURN_GATES = 4;
/**
 * The start platform, in grid units along the start straight from the gate: the raised deck the
 * gate stands on (it runs on back over the start pad behind the gate), then the drop-in down to
 * the ground, then level to the run. Its height is in metres.
 */
export const NO_TURN_PLATFORM = { deck: 2.5, drop: 4.5, height: 2.5 };
/** The start platform's length from the gate to the run, in grid units: the deck, the drop-in and a little level. */
export const NO_TURN_START = 10;
/**
 * Where each gate's rider lines up across the start platform, as lanes of its width: two each
 * side of the starter's box in the middle, gate 1 on the riders' left.
 */
export const NO_TURN_LANES = [-0.8, -0.42, 0.42, 0.8];
/** The No-Turn Takedown map is 200 × 30 grid units: half the motocross map's short side, twice its long side. */
export const NO_TURN_GRID = { w: 200, h: 30 };

/** The motocross track grid, in grid units. */
export const GRID_W = 100;
export const GRID_H = 60;

/** The grid a track is drawn on: 100 × 60, or a No-Turn Takedown's long, slim 200 × 30. */
export function gridOf(track: Pick<TrackDef, 'kind'>): { w: number; h: number } {
  return track.kind === NO_TURN_KIND ? NO_TURN_GRID : { w: GRID_W, h: GRID_H };
}

/** True for a No-Turn Takedown: the kind, with its run-off as the first section. */
export function isNoTurn(track: Pick<TrackDef, 'kind' | 'sections'>): boolean {
  return track.kind === NO_TURN_KIND && track.sections[0]?.type === RUN_OFF;
}

/** The stretches of the drawing that are never drawn or ridden, as lap fractions: a No-Turn Takedown's way back. */
export function hiddenSpans(track: TrackDef, g: LapGeom = lapGeom(track.path), bounds: number[] = sectionBounds(track)): [number, number][] {
  if (!isNoTurn(track)) return [];
  return [[Math.min(bounds[1], NO_TURN_RUNOFF / g.total), bounds[1]]];
}

/**
 * A No-Turn Takedown's drawing from its start line (sx, sy), the way the run heads (radians) and
 * the run's length in grid units: the finish line first, the run-off, the hidden way back off to
 * the riders' left, and the start line last, so the run is the closing edge. `side` turns the
 * hidden way back to the other side.
 */
export function noTurnPath(sx: number, sy: number, ang: number, run: number, side = 1): [number, number][] {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const nx = dy * side;
  const ny = -dx * side;
  const r = (v: number) => Math.round(v * 100) / 100;
  const at = (along: number, off: number): [number, number] => [r(sx + dx * along + nx * off), r(sy + dy * along + ny * off)];
  const end = run + NO_TURN_RUNOFF;
  return [at(run, 0), at(end, 0), at(end, NO_TURN_HIDDEN), at(-NO_TURN_LEAD, NO_TURN_HIDDEN), at(-NO_TURN_LEAD, 0), at(0, 0)];
}

/** A No-Turn Takedown's start straight: the gate NO_TURN_START grid units back from the start line, straight on to it. */
export function noTurnStartPath(sx: number, sy: number, ang: number): [number, number][] {
  const r = (v: number) => Math.round(v * 100) / 100;
  return [[r(sx - Math.cos(ang) * NO_TURN_START), r(sy - Math.sin(ang) * NO_TURN_START)], [r(sx), r(sy)]];
}

/**
 * How far the start platform lifts the start straight `u` grid units from the gate, as a share of
 * its height: the deck (and the start pad behind the gate) at the top, then the drop-in eased down
 * to the ground.
 */
export function platformShare(u: number): number {
  const { deck, drop } = NO_TURN_PLATFORM;
  if (u <= deck) return 1;
  const t = Math.max(0, Math.min(1, (u - deck) / drop));
  return 1 - t * t * (3 - 2 * t);
}
