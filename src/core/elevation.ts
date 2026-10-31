import type { TrackDef } from './race';
import { GRID_H, GRID_W, gridOf, lapGeom, lapMetres, pointAt, sectionBounds, type LapGeom } from './trackGeom';

// Ground elevation the track editor paints: raised and lowered ground under and around a track.
// A track stores it as heights in metres at the corners of a square lattice (`step` grid units
// apart), only where they are not 0; between corners the ground runs smoothly (bilinear). Old
// tracks without it are flat, as before. The track itself is graded level across its width where
// the ground slopes sideways (TrackSurface lifts the whole width by the ground under its middle),
// and the race view's terrain eases from that level out to the painted ground.

/** A track's elevation: heights in metres at lattice corners `step` grid units apart, 0 where left out. */
export interface TrackElevation {
  step: number;
  /** [x, y, metres], x and y multiples of step. */
  points: [number, number, number][];
}

/**
 * A hill or dip the track editor's elevation tool puts on the track along its length: centred
 * `at` grid units along the route from its first point, `len` grid units long in all, `height`
 * metres up (or down, negative) at its centre, easing to nothing at both ends (hillProfile). The
 * track's level is the ground under its middle plus every hill there; hills that overlap add up.
 */
export interface TrackHill {
  at: number;
  len: number;
  height: number;
}

/**
 * A hill's shape along its length: 1 at the centre, 0 at both ends, as a raised cosine, so the
 * slope is 0 at the ends and the peak and the hill meets the track either side with no step and
 * no kink. `d` is the distance from the centre in grid units.
 */
export function hillProfile(d: number, len: number): number {
  const half = len / 2;
  const a = Math.abs(d);
  if (half <= 0 || a >= half) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * a) / half));
}

/**
 * The hills' height in metres `u` grid units along the lap from its first point, counting round
 * past the lap's end on a closed lap (a hill over the finish line is one hill), and cut at the
 * ends of an open route.
 */
export function hillsAt(hills: TrackHill[] | undefined, u: number, total: number, open = false): number {
  if (!hills?.length) return 0;
  let m = 0;
  for (const h of hills) {
    let d = u - h.at;
    if (!open && total > 0) {
      d = ((d % total) + total) % total;
      if (d > total / 2) d -= total;
    }
    m += h.height * hillProfile(d, h.len);
  }
  return m;
}

/** The track's level in metres at lap fraction f: the ground under its middle plus its hills there. */
export function trackLevel(track: TrackDef, g: LapGeom, el: Elevation, f: number): number {
  const p = pointAt(g, f);
  const u = (((f % 1) + 1) % 1) * g.total;
  return el.at(p.x, p.y) + hillsAt(track.hills, u, g.total);
}

/** Highest and lowest the editor lets ground go, in metres: ±36 (1.5 times the ±24 it was). */
export const ELEV_MAX = 36;
/** Steepest the ground may be anywhere before it's an error (a wall), as a rise over run: 45°. */
export const WALL_SLOPE = 1;
/** Steepest the track may climb or drop along its length before it's a warning, as a rise over run (35%). */
export const STEEP_TRACK = 0.35;

/** Heights at any point, from a track's elevation. Flat (0 everywhere) for a track without one. */
export class Elevation {
  readonly step: number;
  private readonly h = new Map<number, number>();
  readonly empty: boolean;
  constructor(
    e: TrackElevation | undefined,
    /** The track grid (trackGeom.gridOf): past its edges the ground keeps the height at the edge. */
    private readonly grid: { w: number; h: number } = { w: GRID_W, h: GRID_H },
  ) {
    this.step = e?.step ?? 2;
    for (const [x, y, m] of e?.points ?? []) if (m) this.h.set(key(Math.round(x / this.step), Math.round(y / this.step)), m);
    this.empty = this.h.size === 0;
  }

  /** The height at a lattice corner, in metres. */
  corner(i: number, j: number): number {
    return this.h.get(key(i, j)) ?? 0;
  }

  /** The ground's height in metres at a point on the grid. */
  at(x: number, y: number): number {
    if (this.empty) return 0;
    const gx = Math.max(0, Math.min(this.grid.w, x)) / this.step;
    const gy = Math.max(0, Math.min(this.grid.h, y)) / this.step;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const a = this.corner(i, j) * (1 - fx) + this.corner(i + 1, j) * fx;
    const b = this.corner(i, j + 1) * (1 - fx) + this.corner(i + 1, j + 1) * fx;
    return a * (1 - fy) + b * fy;
  }
}

const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

/** A problem with a track's elevation: an error the game refuses, or a warning to look at. */
export interface ElevationIssue {
  level: 'error' | 'warning';
  message: string;
  /** Where, on the grid. */
  x: number;
  y: number;
}

/**
 * Checks a track's elevation data and how steep it makes things, in metres over metres: across
 * the ground at the scale the race view draws it (the track 8 m wide), and along the track at its
 * lap's scale (`mpu` lap metres per grid unit):
 * - error: a height past ±ELEV_MAX m, a corner off the lattice, or ground so steep it's a wall
 *   (WALL_SLOPE) anywhere.
 * - warning: the track climbing or dropping more steeply than STEEP_TRACK along its length, at
 *   `along` (lap points with their ground height in metres, in riding order).
 */
export function elevationIssues(track: TrackDef, mpu: number, along: { x: number; y: number; m: number }[]): ElevationIssue[] {
  const out: ElevationIssue[] = [];
  const e = track.elevation;
  for (const h of track.hills ?? []) {
    if (!Number.isFinite(h.height) || Math.abs(h.height) > ELEV_MAX) out.push({ level: 'error', message: `the hill ${Math.round(h.at)} units along the track is ${h.height} m; a hill or dip can be ${ELEV_MAX} m at most`, ...hillSpot(track, h) });
  }
  // Along the track: the worst stretch, once (the ground under the track and its hills together).
  let worst = { grade: 0, x: 0, y: 0 };
  for (let k = 1; k < along.length; k++) {
    const a = along[k - 1];
    const b = along[k];
    const d = Math.hypot(b.x - a.x, b.y - a.y) * mpu;
    if (d <= 0) continue;
    const grade = Math.abs(b.m - a.m) / d;
    if (grade > worst.grade) worst = { grade, x: b.x, y: b.y };
  }
  if (worst.grade > STEEP_TRACK) out.push({ level: 'warning', message: `the track climbs or drops ${Math.round(worst.grade * 100)}% near ${worst.x.toFixed(0)}, ${worst.y.toFixed(0)}; past ${Math.round(STEEP_TRACK * 100)}% is steep for a 50cc`, x: worst.x, y: worst.y });
  if (!e) return out;
  for (const [x, y, m] of e.points) {
    if (!Number.isFinite(m) || Math.abs(m) > ELEV_MAX) out.push({ level: 'error', message: `the ground at ${x}, ${y} is ${m} m; it can be ${ELEV_MAX} m up or down at most`, x, y });
    if (x % e.step !== 0 || y % e.step !== 0) out.push({ level: 'error', message: `the height at ${x}, ${y} is not on the ${e.step}-unit lattice`, x, y });
  }
  const grid = gridOf(track);
  const el = new Elevation(e, grid);
  // The race view draws the track TRACK_METRES (8) wide, DEFAULT_TRACK_WIDTH (3.4) grid units unless set.
  const run = (e.step * 8) / (track.width ?? 3.4);
  const seen = new Set<string>();
  const lastI = Math.floor(grid.w / e.step);
  const lastJ = Math.floor(grid.h / e.step);
  for (const [x, y] of e.points) {
    const i = Math.round(x / e.step);
    const j = Math.round(y / e.step);
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      // Past the grid's edge the ground keeps the edge's height, so there is no wall there.
      if (i + di < 0 || j + dj < 0 || i + di > lastI || j + dj > lastJ) continue;
      const rise = Math.abs(el.corner(i, j) - el.corner(i + di, j + dj));
      const k = `${Math.min(i, i + di)},${Math.min(j, j + dj)},${di !== 0}`;
      if (rise / run > WALL_SLOPE && !seen.has(k)) {
        seen.add(k);
        out.push({ level: 'error', message: `the ground at ${x}, ${y} rises ${rise.toFixed(1)} m in ${run.toFixed(1)} m, a wall; smooth it out`, x, y });
      }
    }
  }
  return out;
}

/** Where a hill's centre is on the grid. */
function hillSpot(track: TrackDef, h: TrackHill): { x: number; y: number } {
  if (track.path.length < 2) return { x: 0, y: 0 };
  const g = lapGeom(track.path);
  const p = pointAt(g, h.at / g.total);
  return { x: p.x, y: p.y };
}

/** The lap every half grid unit with the track's level under its middle (ground and hills), in riding order (lap metres per grid unit in mpu). */
export function lapProfile(track: TrackDef): { mpu: number; along: { x: number; y: number; m: number }[] } {
  const g = lapGeom(track.path);
  const el = new Elevation(track.elevation, gridOf(track));
  const n = Math.max(40, Math.ceil(g.total / 0.5));
  const along = [];
  for (let i = 0; i <= n; i++) {
    const p = pointAt(g, i / n);
    along.push({ x: p.x, y: p.y, m: trackLevel(track, g, el, i / n) });
  }
  return { mpu: lapMetres(track) / g.total, along };
}

/** Climb a rider makes for each metre of a climb, against the flat: a 10% climb costs about 15% more time. */
export const CLIMB_COST = 1.5;
/** Time a rider makes up per metre of drop, against the flat. */
export const DROP_GAIN = 0.5;

/**
 * How much longer (over 1) or shorter each section takes to ride for the ground's climbs and drops
 * along it: 1 everywhere on a track without elevation. The race sim times sections by it, and the
 * race view's riders then follow those times, so they slow up a painted climb and run down a drop.
 */
export function sectionGrades(track: TrackDef): number[] {
  if (!track.elevation?.points.length && !track.hills?.length) return track.sections.map(() => 1);
  const g = lapGeom(track.path);
  const el = new Elevation(track.elevation, gridOf(track));
  const b = sectionBounds(track);
  return track.sections.map((sec, si) => {
    const steps = Math.max(4, Math.ceil(((b[si + 1] - b[si]) * g.total) / 0.5));
    let climb = 0;
    let drop = 0;
    let prev = 0;
    for (let k = 0; k <= steps; k++) {
      const m = trackLevel(track, g, el, b[si] + ((b[si + 1] - b[si]) * k) / steps);
      if (k) {
        if (m > prev) climb += m - prev;
        else drop += prev - m;
      }
      prev = m;
    }
    const len = Math.max(1, sec.length);
    return Math.max(0.8, Math.min(1.6, 1 + (CLIMB_COST * climb - DROP_GAIN * drop) / len));
  });
}
