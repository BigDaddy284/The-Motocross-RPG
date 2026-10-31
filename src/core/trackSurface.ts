import type { TrackDef } from './race';
import { Elevation, hillsAt } from './elevation';
import { DEFAULT_HEIGHTS, HOP_JUMPS, jumpShape } from './jumps';
import { SCRUB_LAUNCH, type Trick } from './tricks';
import { gridOf, headingAt, isNoTurn, isSprint, lapGeom, NO_TURN_PLATFORM, platformShare, lapMetres, nearestOnLap, pointAt, sectionBounds, sectionTurns, startGeom, startHalfWidth, startHeadingAt, startPointAt, widthShare, type LapGeom, type StartGeom } from './trackGeom';
import { DEFAULT_TRACK_WIDTH } from './trackParts';

// The track as a solid surface (no graphics), shared by the 3D race view and its tests. Every
// section gets real shape: jumps have a take-off face, a table or gap and a landing, whoops and
// braking bumps ripple, berms bank up on the outside of the corner, and hills rise and fall. The
// track has a raised lip along both edges and an earth bank down to the ground outside it, so its
// boundaries stand out. The riders' wheels are put on this same surface, so a bike always sits on
// the track it is riding.
//
// Units: grid units across (the 100 × 60 track grid) and grid units of height. The drawing is not
// to scale along the lap (a lap of any length fits the grid), so heights take their scale from
// the track's width instead: the racing surface is TRACK_METRES wide. Heights are drawn a little
// taller than life (EXAGGERATE) so jumps and hills read clearly from the race camera.

export const EXAGGERATE = 1.25;
/** How wide the racing surface is in real life, in metres, for the height scale. */
export const TRACK_METRES = 8;
/** Height of the raised lip along each edge of the track, in grid units. */
export const LIP_H = 0.22;
/** How far out the lip peaks, in lanes (1 is the edge of the racing surface). */
export const LIP_AT = 1.22;
/** Which way the race camera looks along the ground, in degrees (RaceView). */
export const CAM_AZ = 40;
/** Length of a bike, wheel to wheel, in grid units (drawn a little large, for readability). */
export const BIKE_LENGTH = 1.1;

/** Grid units between the start straight's graded levels, and over how far it eases from the lap's level back to its own ground. */
const START_STEP = 0.25;
const START_BLEND = 4;
/** Grid units between samples of the lap's turn rate when looking for folded corners. */
const KAPPA_STEP = 0.05;
/** A folded lane's mitre is cut from its edges where the lane's turn rate has eased to this share of folding. */
const FOLD_EASE = 0.1;
/** Grid units beyond a folded corner where the lap's heading has settled enough to cut the mitre from. */
const MITRE_SETTLE = 2.5;

interface Lobe {
  fa: number;
  fb: number;
  x: number;
  y: number;
}
/** Where the take-off lip and the landing of the plain jumps are, as a share of the section (jumps.ts has every hop). */
export const TAKEOFF = 0.3;
export const LANDING = 0.72;

/**
 * A rider's flight plan (riderAI): the hops they take, each from a take-off lap fraction to a
 * landing one, and how flat they launch (1 full height off the lip, less scrubbed). Each wheel
 * flies the hop it is in (flightY), so the bike leaves the lip front wheel first.
 */
export interface Flight {
  hops: [number, number][];
  launch: number;
  /** The trick thrown on each hop, or null (tricks.ts); a scrub launches flatter. Left out, none. */
  tricks?: (Trick | null)[];
}
/** How far back from a take-off the face's slope is read, in grid units. */
const LIP_RUN = 1.2;
/** A flight clears the ground under it by at least this, in grid units. */
const CLEAR = 0.25;

/**
 * A tunnel through a jump's deck (Boss, 28 Oct 2026): where the deck stands, the banks either
 * side are vertical concrete walls instead, each with a hole where the lower track (or a walkway)
 * passes under. Lap fractions along the upper track.
 */
export interface Tunnel {
  si: number;
  /** The deck: the walls stand from f0 to f1. */
  f0: number;
  f1: number;
  /** The hole in each wall. */
  h0: number;
  h1: number;
  /** Where the lap passes under, as its own lap fraction (track tunnels only). */
  under?: number;
  walk: boolean;
}
/** The flat top of each jump that can carry a tunnel, as shares of the section: the hole is cut within it. */
export const DECKS: Record<string, [number, number]> = { tabletop: [0.32, 0.6], step_on: [0.34, 0.6], step_up: [0.36, 0.58] };
/** How far along each such jump its sides are concrete walls (part way up the faces either side of the deck). */
export const WALLS: Record<string, [number, number]> = { tabletop: [0.2, 0.76], step_on: [0.27, 0.68], step_up: [0.24, 0.72] };
/** The width of a pedestrian tunnel's hole, in grid units. */
export const WALK_HOLE = 1.2;

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const ramp = (u: number, a: number, b: number) => smooth((u - a) / (b - a));

/** The shape of a section's centre line, from 0 to 1 of its height, along u (0 to 1). */
export function sectionShape(type: string, u: number): number {
  if (HOP_JUMPS.has(type)) return jumpShape(type, u);
  switch (type) {
    case 'whoops':
      return 0.5 * (1 - Math.cos(2 * Math.PI * 8 * u)) * ramp(u, 0, 0.04) * (1 - ramp(u, 0.96, 1));
    case 'rollers':
      // Long low rolls, ridden over rather than jumped.
      return 0.5 * (1 - Math.cos(2 * Math.PI * 4 * u)) * ramp(u, 0, 0.06) * (1 - ramp(u, 0.94, 1));
    case 'braking_bumps':
      return 0.5 * (1 - Math.cos(2 * Math.PI * 9 * u)) * ramp(u, 0, 0.05) * (1 - ramp(u, 0.95, 1));
    case 'uphill':
    case 'downhill':
      return Math.sin(Math.PI * u);
    case 'hill_climb':
      // A long steep climb to the crest, then a short drop off the top.
      return u < HILL_CREST ? smooth(u / HILL_CREST) : 1 - smooth((u - HILL_CREST) / (1 - HILL_CREST));
    case 'rocks':
      // Rocks of all sizes: uneven ground that never repeats in step.
      return (0.5 * (1 - Math.cos(2 * Math.PI * 13 * u)) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 5.3 * u))) * ramp(u, 0, 0.04) * (1 - ramp(u, 0.96, 1));
    case 'roots':
      return 0.5 * (1 - Math.cos(2 * Math.PI * 9 * u)) * Math.abs(Math.sin(2 * Math.PI * 2.7 * u)) * ramp(u, 0, 0.05) * (1 - ramp(u, 0.95, 1));
    case 'logs':
      // Logs laid across the track, each a hump of its own.
      return LOGS_AT.reduce((h, at) => Math.max(h, logHump((u - at) / LOG_HALF)), 0);
    case 'log_step':
      return logHump((u - 0.5) / (LOG_HALF * 1.6));
    default:
      return 0;
  }
}

/** Where a hill climb crests, as a share of the section: a steep climb, then a longer run down the back. */
export const HILL_CREST = 0.42;
/** Where the logs of a log crossing lie, as shares of the section, and half a log's width there. */
export const LOGS_AT = [0.18, 0.39, 0.61, 0.82];
export const LOG_HALF = 0.045;
/** The hump of a log lying across the track: 1 over its middle, 0 beyond its edges (x from -1 to 1). */
function logHump(x: number): number {
  return Math.abs(x) >= 1 ? 0 : Math.sqrt(1 - x * x);
}
/** Section types whose ground rises with the track: hills, not built-up jumps. */
export const HILLS = new Set(['uphill', 'downhill', 'hill_climb']);

export interface WheelSpot {
  x: number;
  z: number;
  y: number;
}

export class TrackSurface {
  readonly g: LapGeom;
  readonly bounds: number[];
  readonly turns: number[];
  /** Metres of the lap per grid unit of the drawing. */
  readonly mpu: number;
  /** Half the track's full width in grid units (hwAt for the width at a spot: a sprint's return lane is narrower). */
  readonly hw: number;
  /** An enduro sprint, whose return lane is narrower than the rest of the track. */
  private readonly narrows: boolean;
  /** A No-Turn Takedown, whose start straight is a raised platform with a drop-in. */
  readonly raised: boolean;
  private readonly heights: number[];
  /** The start straight from the gate to where it joins the lap. */
  readonly start: StartGeom;
  /** Which side of the lap the start straight comes in from (1 the riders' right, -1 left), 0 with none. */
  readonly joinSide: number;
  /** The editor's ground elevation under and round the track. */
  readonly elev: Elevation;
  /** The tunnels through jump decks (sections with `tunnel`). */
  readonly tunnels: Tunnel[];

  constructor(readonly track: TrackDef) {
    this.g = lapGeom(track.path);
    this.bounds = sectionBounds(track);
    this.turns = sectionTurns(track, this.g);
    this.mpu = lapMetres(track) / this.g.total;
    this.hw = (track.width ?? DEFAULT_TRACK_WIDTH) / 2;
    this.narrows = isSprint(track);
    this.raised = isNoTurn(track);
    this.heights = track.sections.map((s) => {
      const metres = s.height ?? (s.type === 'braking_bumps' ? 0.25 : DEFAULT_HEIGHTS[s.type] ?? 0);
      return this.units(metres);
    });
    this.start = startGeom(track, this.g);
    this.elev = new Elevation(track.elevation, gridOf(track));
    this.joinSide = 0;
    if (this.start.total > 0) {
      // Which side of the lap the start straight arrives from: look a little way back up it.
      const back = startPointAt(this.start, Math.max(0, this.start.total - 2 * this.hw));
      const at = this.spot(this.start.join, 0);
      this.joinSide = (back.x - at.x) * -Math.sin(at.ang) + (back.y - at.z) * Math.cos(at.ang) >= 0 ? 1 : -1;
    }
    this.tunnels = this.findTunnels();
  }

  // ---- tunnels ----

  /** The tunnels: a wall along each side of the deck, with a hole over the crossing (or in the middle for a walkway). */
  private findTunnels(): Tunnel[] {
    const out: Tunnel[] = [];
    this.track.sections.forEach((sec, si) => {
      const deck = sec.tunnel ? DECKS[sec.type] : undefined;
      if (!deck) return;
      const span = this.bounds[si + 1] - this.bounds[si];
      const d0 = this.bounds[si] + span * deck[0];
      const d1 = this.bounds[si] + span * deck[1];
      const wall = WALLS[sec.type];
      const f0 = this.bounds[si] + span * wall[0];
      const f1 = this.bounds[si] + span * wall[1];
      if (sec.tunnel === 'walk') {
        const mid = (d0 + d1) / 2;
        const half = Math.min((d1 - d0) / 2, WALK_HOLE / 2 / this.g.total);
        out.push({ si, f0, f1, h0: mid - half, h1: mid + half, walk: true });
        return;
      }
      const c = this.crossingUnder(d0, d1);
      if (!c) return;
      // The hole takes the lower track with its lips and banks, wider where it crosses at a slant.
      const wide = this.hw * (LIP_AT + Math.max(this.skirt(c.under, -1), this.skirt(c.under, 1))) + 0.3;
      const half = Math.min((d1 - d0) / 2, wide / Math.max(0.35, Math.abs(Math.sin(c.angle))) / this.g.total);
      out.push({ si, f0, f1, h0: Math.max(d0, c.f - half), h1: Math.min(d1, c.f + half), under: c.under, walk: false });
    });
    return out;
  }

  /** Where another part of the lap crosses the deck between lap fractions f0 and f1: the crossing's fraction on the deck, on the lap below, and the angle between them. */
  crossingUnder(f0: number, f1: number): { f: number; under: number; angle: number } | null {
    const g = this.g;
    const n = Math.max(2, Math.ceil((f1 - f0) * g.total / 0.25));
    const o = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    for (let k = 0; k < n; k++) {
      const fa = f0 + ((f1 - f0) * k) / n;
      const fb = f0 + ((f1 - f0) * (k + 1)) / n;
      const a = pointAt(g, fa);
      const b = pointAt(g, fb);
      for (let j = 0; j < g.pts.length - 1; j++) {
        const fj0 = g.cum[j] / g.total;
        const fj1 = g.cum[j + 1] / g.total;
        // Not the deck's own stretch of the drawing, nor its neighbours.
        if (fj1 > f0 - 2 / g.total && fj0 < f1 + 2 / g.total) continue;
        const c = g.pts[j];
        const d = g.pts[j + 1];
        if (!(o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0)) continue;
        // Where along each the crossing is.
        const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
        const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
        const f = fa + (fb - fa) * t;
        const under = fj0 + (fj1 - fj0) * u;
        return { f, under, angle: headingAt(g, f) - headingAt(g, under) };
      }
    }
    return null;
  }

  /** The tunnel whose walls stand at lap fraction f, if any. */
  tunnelAt(f: number): Tunnel | null {
    const x = f - Math.floor(f);
    for (const t of this.tunnels) if (x >= t.f0 && x <= t.f1) return t;
    return null;
  }

  /** True where a tunnel's walls have their hole: no bank is drawn there. */
  inHole(f: number): boolean {
    const x = f - Math.floor(f);
    return this.tunnels.some((t) => x >= t.h0 && x <= t.h1);
  }

  /**
   * How open the lap's edge is where the start straight joins it: 1 in the opening (no lip, no
   * bank, so the two surfaces run into each other), easing to 0 either side.
   */
  mouth(f: number, side: number): number {
    if (!this.joinSide || side !== this.joinSide) return 0;
    let d = Math.abs(f - this.start.join) % 1;
    d = Math.min(d, 1 - d) * this.g.total;
    const open = this.hw * 2.4;
    return 1 - smooth((d - open) / 2);
  }

  /** Half the track's width at lap fraction f, in grid units: the full width but along a sprint's return lane. */
  hwAt(f: number): number {
    return this.narrows ? this.hw * widthShare(this.track, this.g, f, this.bounds) : this.hw;
  }

  /** Metres of height to grid units, drawn a little taller than life. */
  units(metres: number): number {
    return ((metres * 2 * this.hw) / TRACK_METRES) * EXAGGERATE;
  }

  /** Which section lap fraction f is in, and how far through it (0 to 1). */
  at(f: number): { si: number; u: number } {
    const x = f - Math.floor(f);
    let lo = 0;
    let hi = this.track.sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.bounds[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    const u = (x - this.bounds[lo]) / Math.max(1e-9, this.bounds[lo + 1] - this.bounds[lo]);
    return { si: lo, u: Math.max(0, Math.min(1, u)) };
  }

  /** Height of the middle of the track. */
  centre(f: number): number {
    const { si, u } = this.at(f);
    return this.heights[si] * sectionShape(this.track.sections[si].type, u);
  }

  /** Extra height across the track from banking: berms rise towards the outside of the corner. */
  bank(f: number, lane: number): number {
    const { si, u } = this.at(f);
    const sec = this.track.sections[si];
    const turn = this.turns[si];
    if (sec.type === 'off_camber') {
      // The other way to a berm: the track falls away to the outside of the corner (to the right, on a straight).
      const high = turn || -1;
      const across = smooth((lane * high + 1) / 2);
      return this.units(0.9) * across * Math.sin(Math.PI * u);
    }
    if (!turn) return 0;
    const out = -turn;
    const across = smooth((lane * out + 1) / 2);
    const amount = sec.type === 'berm' ? this.units(1.4) : sec.type === 'first_corner' || sec.type === 'rutted_corner' ? this.units(0.5) : 0;
    return amount * across * across * Math.sin(Math.PI * u);
  }

  /** True where the lap runs over a hill, whose sides slope gently away into the grass. */
  onHill(f: number): boolean {
    return HILLS.has(this.track.sections[this.at(f).si].type);
  }

  /**
   * The bank of earth outside the lip, in lanes, deeper where the track stands higher. On a hill
   * the ground rises with the track (the race view's terrain), so the bank stays short.
   */
  skirt(f: number, lane: number): number {
    const side = lane < 0 ? -1 : 1;
    const top = (this.onHill(f) ? 0 : this.centre(f)) + this.bank(f, side) + LIP_H;
    return Math.max(0.35, top * 0.9) / this.hwAt(f);
  }

  /** Height of the surface at lap fraction f and lane (-1 left edge, 1 right edge, further is off the track). */
  height(f: number, lane: number): number {
    const e = Math.abs(lane);
    const ground = this.lift(f);
    if (e <= 1) return ground + this.centre(f) + this.bank(f, lane);
    const side = lane < 0 ? -1 : 1;
    const top = this.centre(f) + this.bank(f, side);
    const lip = LIP_H * (1 - this.mouth(f, side));
    if (e <= LIP_AT) return ground + top + lip * smooth((e - 1) / (LIP_AT - 1));
    const sk = this.skirt(f, lane);
    return ground + (top + lip) * (1 - smooth((e - LIP_AT) / sk));
  }

  /**
   * How far the editor's elevation (elevation.ts) lifts the track at lap fraction f, in grid
   * units: the ground under the middle of the track plus the hills and dips put on the track
   * along its length. The track is graded level across its width, and the race view's terrain
   * eases from that level out to the ground either side, which is what makes a raised track's
   * sides.
   */
  lift(f: number): number {
    const hills = this.track.hills?.length ? hillsAt(this.track.hills, (((f % 1) + 1) % 1) * this.g.total, this.g.total) : 0;
    if (this.elev.empty) return this.units(hills);
    const p = pointAt(this.g, f);
    return this.units(this.elev.at(p.x, p.y) + hills);
  }

  /** The editor's ground elevation at a point, in grid units. */
  groundAt(x: number, z: number): number {
    return this.elev.empty ? 0 : this.units(this.elev.at(x, z));
  }

  // ---- the start straight ----

  /** True when race distance `dist` (in laps) is on the start straight, before it joins the lap. */
  onStart(dist: number): boolean {
    return this.start.total > 0 && dist < this.start.joinAt;
  }

  /** Grid units from the gate along the start straight, for a race distance on it. */
  startUnits(dist: number): number {
    return (dist - this.start.from) * this.g.total;
  }

  /** Height of the start straight `u` grid units from the gate: flat, with a lip along each side that runs out where it joins the lap. */
  startHeight(u: number, lane: number): number {
    const e = Math.abs(lane);
    const toEnd = this.start.total - u;
    const merge = this.hw * 1.5 + 1;
    const at = e > 0 ? this.startSpot(u, lane) : null;
    const join = this.startGround(u, at?.x, at?.z) + this.centre(this.start.join) * (1 - smooth(toEnd / merge));
    const lip = LIP_H * smooth(toEnd / merge);
    if (e <= 1) return join;
    if (e <= LIP_AT) return join + lip * smooth((e - 1) / (LIP_AT - 1));
    const sk = Math.max(0.35, lip * 0.9) / this.startHw(u);
    return join + lip * (1 - smooth((e - LIP_AT) / sk));
  }

  private startNear: number[] | null = null;

  /**
   * The ground the start straight is graded to at a spot `u` grid units from the gate, in grid
   * units: the ground under its middle, level across, except where it runs beside or into the lap.
   * There it eases to the lap's level at that spot, so on sloping ground the two surfaces meet
   * instead of one burying the other.
   */
  startGround(u: number, x?: number, z?: number): number {
    return this.startBase(u, x, z) + this.platform(u);
  }

  /**
   * How high a No-Turn Takedown's start platform holds the start straight `u` grid units from the
   * gate, in grid units: the deck the gate stands on (and the pad behind it), then the drop-in down
   * to the ground. 0 on any other track.
   */
  platform(u: number): number {
    return this.raised ? this.units(NO_TURN_PLATFORM.height) * platformShare(u) : 0;
  }

  /** The ground under the start straight, before any start platform lifts it: what the grass round it is graded to. */
  startBase(u: number, x?: number, z?: number): number {
    if ((this.elev.empty && !this.track.hills?.length) || this.start.total <= 0) return 0;
    const c = startPointAt(this.start, Math.max(0, Math.min(this.start.total, u)));
    const own = this.groundAt(c.x, c.y);
    // Skip the lap search where this stretch of the start straight is nowhere near the lap.
    const nd = (this.startNear ??= this.startClearance());
    const k = Math.max(0, Math.min(nd.length - 1, Math.round(u / START_STEP)));
    if (nd[k] > START_BLEND + START_STEP) return own;
    const near = nearestOnLap(this.g, x ?? c.x, z ?? c.y);
    const w = 1 - smooth((near.d - this.hw) / START_BLEND);
    return own + (this.lift(near.f) - own) * w;
  }

  /** How far the start straight's every lane is from the lap's edge, along it in START_STEPs (grid units, 0 where they touch). */
  private startClearance(): number[] {
    const n = Math.ceil(this.start.total / START_STEP);
    const out: number[] = [];
    for (let k = 0; k <= n; k++) {
      const u = Math.min(this.start.total, k * START_STEP);
      const p = startPointAt(this.start, u);
      out.push(Math.max(0, nearestOnLap(this.g, p.x, p.y).d - this.hw - this.startHw(u) * LIP_AT));
    }
    return out;
  }

  /** Half the start straight's width `u` grid units from the gate: wide at the gate, the track's width where it joins. */
  startHw(u: number): number {
    return startHalfWidth(this.start, u, this.hw);
  }

  /** Where `u` grid units from the gate and a lane are on the ground, on the start straight. */
  startSpot(u: number, lane: number): { x: number; z: number; ang: number } {
    const p = startPointAt(this.start, u);
    const ang = startHeadingAt(this.start, u);
    const hw = this.startHw(u);
    return { x: p.x - Math.sin(ang) * lane * hw, z: p.y + Math.cos(ang) * lane * hw, ang };
  }

  /** Where a race distance and lane are, on the start straight or the lap, and the ground's height there. */
  place(dist: number, lane: number): { x: number; z: number; ang: number; y: number } {
    if (this.onStart(dist)) {
      const u = this.startUnits(dist);
      return { ...this.startSpot(u, lane), y: this.startHeight(u, lane) };
    }
    const f = dist - Math.floor(dist);
    return { ...this.spot(f, this.rideLane(f, lane)), y: this.height(f, lane) };
  }

  /** Both wheels of a bike centred at race distance `dist`, on the start straight or the lap: back wheel first. */
  wheelsAt(dist: number, lane: number, flight: Flight | null): [WheelSpot, WheelSpot] {
    const df = BIKE_LENGTH / 2 / this.g.total;
    if (!this.onStart(dist - df)) return this.wheels(dist - Math.floor(dist), lane, flight);
    return [dist - df, dist + df].map((d) => {
      const p = this.place(d, lane);
      return { x: p.x, z: p.z, y: p.y };
    }) as [WheelSpot, WheelSpot];
  }

  /** The turn rate under a bike at race distance `dist`, as curvature(). */
  curvatureAt(dist: number): number {
    if (!this.onStart(dist)) return this.curvature(dist - Math.floor(dist));
    const u = this.startUnits(dist);
    let dh = startHeadingAt(this.start, u + 1) - startHeadingAt(this.start, u - 1);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    return dh / 2;
  }

  /** Where lap fraction f and a lane are on the ground (grid x and y; three.js calls the second z). */
  spot(f: number, lane: number): { x: number; z: number; ang: number } {
    const ang = headingAt(this.g, f);
    // Along a tunnel's deck the banks are vertical walls: every lane outside the lip stands at the lip.
    if (Math.abs(lane) > LIP_AT && this.tunnelAt(f)) lane = Math.sign(lane) * LIP_AT;
    const m = this.miter(f, lane);
    if (m) return { x: m.x, z: m.y, ang };
    const p = pointAt(this.g, f);
    const hw = this.hwAt(f);
    return { x: p.x - Math.sin(ang) * lane * hw, z: p.y + Math.cos(ang) * lane * hw, ang };
  }

  /**
   * The lane a bike is drawn in: through a corner tighter than the bike's lane is far from the
   * middle of the track, no further in than the corner's centre of curvature. The surface there is
   * mitred to a point (miter()); a bike held at that point would stand still while its race
   * distance went on, so it swings round the inside of the corner at the tightest arc instead,
   * on the surface all the way.
   */
  rideLane(f: number, lane: number): number {
    if (Math.abs(lane) <= 0.5 || Math.abs(lane) * this.hw * this.sharpest() <= 1) return lane;
    const c = this.curvature(f);
    if (lane * c <= 0) return lane;
    const most = Math.max(0, 1 / Math.abs(c) - 0.02) / this.hwAt(f);
    return Math.abs(lane) <= most ? lane : Math.sign(lane) * most;
  }

  /**
   * The inside of a corner tighter than a lane is far from the middle of the track. Offsetting the
   * lane from the lap there folds it back over itself (the inner lip of a sharp corner used to
   * sweep across its apex as a raised wedge), so through such a corner every point of the lane is
   * the one point where the lane's straight edges into and out of the corner meet: the corner is
   * mitred, like the inside of any road's kerb at a sharp bend. Null where the lane does not fold.
   */
  miter(f: number, lane: number): { x: number; y: number } | null {
    const d = Math.abs(lane) * this.hwAt(f);
    if (d * this.sharpest() <= 1) return null;
    const fr = f - Math.floor(f);
    for (const l of this.lobesFor(lane)) {
      if ((fr >= l.fa && fr <= l.fb) || (fr + 1 >= l.fa && fr + 1 <= l.fb)) return l;
    }
    return null;
  }

  /** Lap fractions where a lane folds, with the lane's mitre point there. */
  private lobesFor(lane: number): Lobe[] {
    const key = Math.round(lane * 1e4);
    const hit = this.lobeCache.get(key);
    if (hit) return hit;
    const k = this.kappa();
    const n = k.length;
    const d = Math.abs(lane) * this.hw;
    const turning = (i: number, by: number) => {
      const j = ((i % n) + n) % n;
      const c = k[j];
      return lane * c > 0 && Math.abs(c) * d * (this.narrows ? this.hwAt(j / n) / this.hw : 1) > by;
    };
    const folded = (i: number) => turning(i, 1);
    const out: Lobe[] = [];
    // Scan the lap from somewhere the lane is not turning in, so a corner at the line is seen whole.
    let s0 = 0;
    while (s0 < n && turning(s0, FOLD_EASE)) s0++;
    if (s0 < n) {
      let i = s0;
      let last = -Infinity;
      while (i < s0 + n) {
        if (!folded(i)) { i++; continue; }
        let i0 = i;
        while (i0 > s0 && turning(i0 - 1, FOLD_EASE)) i0--;
        while (folded(i)) i++;
        while (i < s0 + n && turning(i, FOLD_EASE)) i++;
        const lobe = this.mitre(i0 / n, i / n, lane, last);
        out.push(lobe);
        last = lobe.fb;
      }
    }
    this.lobeCache.set(key, out);
    return out;
  }

  /** The lane's offset point at f, as spot() places it when it does not fold. */
  private edge(f: number, lane: number): { x: number; y: number; tx: number; ty: number } {
    const p = pointAt(this.g, f);
    const a = headingAt(this.g, f);
    const hw = this.hwAt(f);
    return { x: p.x - Math.sin(a) * lane * hw, y: p.y + Math.cos(a) * lane * hw, tx: Math.cos(a), ty: Math.sin(a) };
  }

  /**
   * The mitre of a lane through a corner it folds in between lap fractions fa and fb: where the
   * lane's straight edge into the corner meets its straight edge out, taken where the lap has
   * settled either side (the smoothed heading needs a few grid units to straighten). The folded
   * stretch grows to take in every point of the lane already past the mitre, since the inside of
   * a sharp corner crosses itself before the turn rate alone says so, but never back past `lo`.
   */
  private mitre(fa: number, fb: number, lane: number, lo: number): Lobe {
    const df = MITRE_SETTLE / this.g.total;
    const A = this.edge(fa - df, lane);
    const B = this.edge(fb + df, lane);
    const cross = A.tx * B.ty - A.ty * B.tx;
    let m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    if (Math.abs(cross) >= 1e-6) {
      const t = ((B.x - A.x) * B.ty - (B.y - A.y) * B.tx) / cross;
      if (t >= 0) m = { x: A.x + A.tx * t, y: A.y + A.ty * t };
    }
    const step = KAPPA_STEP / this.g.total;
    const reach = (3 * Math.abs(lane) * this.hw) / this.g.total;
    const past = (f: number, T: { tx: number; ty: number }) => {
      const q = this.edge(f, lane);
      return (q.x - m.x) * T.tx + (q.y - m.y) * T.ty;
    };
    let f0 = fa;
    while (f0 - step > lo && f0 - step > fa - reach && past(f0 - step, A) > 0) f0 -= step;
    let f1 = fb;
    while (f1 + step < fb + reach && past(f1 + step, B) < 0) f1 += step;
    return { fa: f0, fb: f1, x: m.x, y: m.y };
  }

  private kappaCache: Float64Array | null = null;
  private kappaMax = 0;
  private lobeCache = new Map<number, Lobe[]>();

  /** The lap's turn rate sampled every KAPPA_STEP grid units round the lap. */
  private kappa(): Float64Array {
    if (this.kappaCache) return this.kappaCache;
    const n = Math.max(64, Math.ceil(this.g.total / KAPPA_STEP));
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      k[i] = this.curvature(i / n);
      this.kappaMax = Math.max(this.kappaMax, Math.abs(k[i]));
    }
    this.kappaCache = k;
    return k;
  }

  /** The tightest turn rate anywhere on the lap, in radians per grid unit. */
  sharpest(): number {
    this.kappa();
    return this.kappaMax;
  }

  /**
   * Height of a rider's wheel at lap fraction f: flying along the hop of its flight plan it is in,
   * skimming the crests of whoops and rollers, otherwise on the surface.
   */
  wheel(f: number, lane: number, flight: Flight | null): number {
    const ground = this.height(f, lane);
    const fly = this.flightY(f, lane, flight);
    if (fly !== null) return Math.max(ground, fly);
    const { si } = this.at(f);
    const type = this.track.sections[si].type;
    if (type === 'whoops') return Math.max(ground, this.lift(f) + this.heights[si] * 0.55);
    if (type === 'rollers') return Math.max(ground, this.lift(f) + this.heights[si] * 0.35);
    return ground;
  }

  /**
   * Where a wheel at lap fraction f is along its flight, or null on the ground. A hop is a
   * parabola from the take-off's height to the landing's, launched along the face it rode up
   * (its slope over the last LIP_RUN, times the launch), and at least high enough to clear the
   * ground between by CLEAR (a tabletop's deck under a clear).
   */
  flightY(f: number, lane: number, flight: Flight | null): number | null {
    if (!flight) return null;
    const x = f - Math.floor(f);
    for (let i = 0; i < flight.hops.length; i++) {
      const [f0, f1] = flight.hops[i];
      if (x <= f0 || x >= f1) continue;
      // A scrub (tricks.ts) leaves the lip flatter and skims what is under it closer.
      const scrub = flight.tricks?.[i]?.kind === 'scrub';
      const hop = scrub ? this.hop(f0, f1, lane, flight.launch * SCRUB_LAUNCH, CLEAR * 0.4) : this.hop(f0, f1, lane, flight.launch);
      const t = (x - f0) / (f1 - f0);
      return hop.y0 + (hop.y1 - hop.y0) * t + 4 * hop.apex * t * (1 - t);
    }
    return null;
  }

  private readonly hops = new Map<string, { y0: number; y1: number; apex: number }>();

  /** The arc of a hop: its end heights and its apex above the straight line between them, in grid units. */
  private hop(f0: number, f1: number, lane: number, launch: number, clear = CLEAR): { y0: number; y1: number; apex: number } {
    const key = `${f0.toFixed(5)}|${f1.toFixed(5)}|${lane.toFixed(2)}|${launch.toFixed(2)}|${clear}`;
    const got = this.hops.get(key);
    if (got) return got;
    const y0 = this.height(f0, lane);
    const y1 = this.height(f1, lane);
    const L = (f1 - f0) * this.g.total;
    const back = LIP_RUN / this.g.total;
    const slope = Math.max(0, (y0 - this.height(f0 - back, lane)) / LIP_RUN) * launch;
    // Launched along the face: the arc's apex follows from its slope at the lip.
    let apex = ((slope - (y1 - y0) / L) * L) / 4;
    // And it clears whatever stands between the lip and the landing.
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      const need = (this.height(f0 + (f1 - f0) * t, lane) + clear - (y0 + (y1 - y0) * t)) / (4 * t * (1 - t));
      apex = Math.max(apex, need);
    }
    apex = Math.max(apex, this.units(0.2));
    const out = { y0, y1, apex };
    this.hops.set(key, out);
    return out;
  }

  /** Both wheels of a bike centred at f, on its lane: back wheel first. */
  wheels(f: number, lane: number, flight: Flight | null): [WheelSpot, WheelSpot] {
    const df = BIKE_LENGTH / 2 / this.g.total;
    return [f - df, f + df].map((ff) => {
      const s = this.spot(ff, this.rideLane(ff, lane));
      return { x: s.x, z: s.z, y: this.wheel(ff, lane, flight) };
    }) as [WheelSpot, WheelSpot];
  }

  /** Metres for a height in grid units (the inverse of units). */
  metresOf(units: number): number {
    return (units * TRACK_METRES) / (2 * this.hw) / EXAGGERATE;
  }

  /** The lap's total turn rate at f, in radians per grid unit (positive turning right). */
  curvature(f: number): number {
    const d = 1 / this.g.total;
    let dh = headingAt(this.g, f + d) - headingAt(this.g, f - d);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    return dh / 2;
  }
}
