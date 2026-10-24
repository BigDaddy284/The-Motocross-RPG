import type { TrackDef } from './race';
import { DEFAULT_HEIGHTS } from './riderAI';
import { headingAt, lapGeom, lapMetres, pointAt, sectionBounds, sectionTurns, startGeom, startHalfWidth, startHeadingAt, startPointAt, type LapGeom, type StartGeom } from './trackGeom';
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
/** Length of a bike, wheel to wheel, in grid units (drawn a little large, for readability). */
export const BIKE_LENGTH = 1.1;

const BIG_JUMPS = new Set(['tabletop', 'double', 'step_up']);
/** Where the take-off lip and the landing are on a big jump, as a share of the section (as in riderAI). */
export const TAKEOFF = 0.3;
export const LANDING = 0.72;

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const ramp = (u: number, a: number, b: number) => smooth((u - a) / (b - a));

/** The shape of a section's centre line, from 0 to 1 of its height, along u (0 to 1). */
export function sectionShape(type: string, u: number): number {
  switch (type) {
    case 'tabletop':
      return ramp(u, 0.16, TAKEOFF) * (1 - ramp(u, 0.62, 0.84));
    case 'double':
      return Math.max(ramp(u, 0.16, TAKEOFF) * (1 - ramp(u, TAKEOFF, 0.37)), 0.95 * ramp(u, 0.58, 0.68) * (1 - ramp(u, 0.68, 0.86)));
    case 'step_up':
      return Math.max(0.55 * ramp(u, 0.16, TAKEOFF) * (1 - ramp(u, TAKEOFF, 0.36)), ramp(u, 0.58, 0.68) * (1 - ramp(u, 0.86, 0.98)));
    case 'rhythm': {
      const x = (u * 3) % 1;
      return x > 0.08 && x < 0.78 ? Math.sin((Math.PI * (x - 0.08)) / 0.7) : 0;
    }
    case 'whoops':
      return 0.5 * (1 - Math.cos(2 * Math.PI * 8 * u)) * ramp(u, 0, 0.04) * (1 - ramp(u, 0.96, 1));
    case 'braking_bumps':
      return 0.5 * (1 - Math.cos(2 * Math.PI * 9 * u)) * ramp(u, 0, 0.05) * (1 - ramp(u, 0.95, 1));
    case 'uphill':
    case 'downhill':
      return Math.sin(Math.PI * u);
    default:
      return 0;
  }
}

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
  /** Half the track width in grid units. */
  readonly hw: number;
  private readonly heights: number[];
  /** The start straight from the gate to where it joins the lap. */
  readonly start: StartGeom;
  /** Which side of the lap the start straight comes in from (1 the riders' right, -1 left), 0 with none. */
  readonly joinSide: number;

  constructor(readonly track: TrackDef) {
    this.g = lapGeom(track.path);
    this.bounds = sectionBounds(track);
    this.turns = sectionTurns(track, this.g);
    this.mpu = lapMetres(track) / this.g.total;
    this.hw = (track.width ?? DEFAULT_TRACK_WIDTH) / 2;
    this.heights = track.sections.map((s) => {
      const metres = s.height ?? (s.type === 'braking_bumps' ? 0.25 : DEFAULT_HEIGHTS[s.type] ?? 0);
      return this.units(metres);
    });
    this.start = startGeom(track, this.g);
    this.joinSide = 0;
    if (this.start.total > 0) {
      // Which side of the lap the start straight arrives from: look a little way back up it.
      const back = startPointAt(this.start, Math.max(0, this.start.total - 2 * this.hw));
      const at = this.spot(this.start.join, 0);
      this.joinSide = (back.x - at.x) * -Math.sin(at.ang) + (back.y - at.z) * Math.cos(at.ang) >= 0 ? 1 : -1;
    }
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
    if (!turn) return 0;
    const out = -turn;
    const across = smooth((lane * out + 1) / 2);
    const amount = sec.type === 'berm' ? this.units(1.4) : sec.type === 'first_corner' || sec.type === 'rutted_corner' ? this.units(0.5) : 0;
    return amount * across * across * Math.sin(Math.PI * u);
  }

  /** True where the lap runs over a hill, whose sides slope gently away into the grass. */
  onHill(f: number): boolean {
    const t = this.track.sections[this.at(f).si].type;
    return t === 'uphill' || t === 'downhill';
  }

  /**
   * The bank of earth outside the lip, in lanes, deeper where the track stands higher. On a hill
   * the ground rises with the track (the race view's terrain), so the bank stays short.
   */
  skirt(f: number, lane: number): number {
    const side = lane < 0 ? -1 : 1;
    const top = (this.onHill(f) ? 0 : this.centre(f)) + this.bank(f, side) + LIP_H;
    return Math.max(0.35, top * 0.9) / this.hw;
  }

  /** Height of the surface at lap fraction f and lane (-1 left edge, 1 right edge, further is off the track). */
  height(f: number, lane: number): number {
    const e = Math.abs(lane);
    if (e <= 1) return this.centre(f) + this.bank(f, lane);
    const side = lane < 0 ? -1 : 1;
    const top = this.centre(f) + this.bank(f, side);
    const lip = LIP_H * (1 - this.mouth(f, side));
    if (e <= LIP_AT) return top + lip * smooth((e - 1) / (LIP_AT - 1));
    const sk = this.skirt(f, lane);
    return (top + lip) * (1 - smooth((e - LIP_AT) / sk));
  }

  // ---- the start straight ----

  /** True when race distance `dist` (in laps) is on the start straight, before it joins the lap. */
  onStart(dist: number): boolean {
    return this.start.total > 0 && dist < this.start.join;
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
    const join = this.centre(this.start.join) * (1 - smooth(toEnd / merge));
    const lip = LIP_H * smooth(toEnd / merge);
    if (e <= 1) return join;
    if (e <= LIP_AT) return join + lip * smooth((e - 1) / (LIP_AT - 1));
    const sk = Math.max(0.35, lip * 0.9) / this.startHw(u);
    return join + lip * (1 - smooth((e - LIP_AT) / sk));
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
    return { ...this.spot(f, lane), y: this.height(f, lane) };
  }

  /** Both wheels of a bike centred at race distance `dist`, on the start straight or the lap: back wheel first. */
  wheelsAt(dist: number, lane: number, air: number): [WheelSpot, WheelSpot] {
    const df = BIKE_LENGTH / 2 / this.g.total;
    if (!this.onStart(dist - df)) return this.wheels(dist - Math.floor(dist), lane, air);
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
    const p = pointAt(this.g, f);
    const ang = headingAt(this.g, f);
    return { x: p.x - Math.sin(ang) * lane * this.hw, z: p.y + Math.cos(ang) * lane * this.hw, ang };
  }

  /**
   * Height of a rider's wheel at lap fraction f. On a big jump the bike flies from the lip to the
   * landing on an arc `apex` metres above the straight line between them (the rider AI's jump
   * height); everywhere else the wheel is on the surface, plus any small hop the AI gives it.
   */
  wheel(f: number, lane: number, apex: number, hop: number): number {
    const ground = this.height(f, lane);
    const { si, u } = this.at(f);
    const type = this.track.sections[si].type;
    if (BIG_JUMPS.has(type) && apex > 0 && u > TAKEOFF && u < LANDING) {
      const f0 = this.bounds[si] + (this.bounds[si + 1] - this.bounds[si]) * TAKEOFF;
      const f1 = this.bounds[si] + (this.bounds[si + 1] - this.bounds[si]) * LANDING;
      const x = (u - TAKEOFF) / (LANDING - TAKEOFF);
      const line = this.height(f0, lane) * (1 - x) + this.height(f1, lane) * x;
      return Math.max(ground, line + this.units(apex) * 4 * x * (1 - x));
    }
    // Over rhythm jumps the bike hops from top to top; through whoops it skims along the crests.
    if (type === 'rhythm' && hop > 0.05) return Math.max(ground, this.heights[si] * 0.85 + this.units(hop) * 0.6);
    if (type === 'whoops') return Math.max(ground, this.heights[si] * 0.55);
    return ground;
  }

  /**
   * How high a big jump's arc is (in metres above the lip-to-landing line) for a rider that is
   * `air` metres up at lap fraction f, as the rider AI gives it; 0 off big jumps.
   */
  apexFor(f: number, air: number): number {
    const { si, u } = this.at(f);
    if (!BIG_JUMPS.has(this.track.sections[si].type) || u <= TAKEOFF || u >= LANDING) return 0;
    const x = (u - TAKEOFF) / (LANDING - TAKEOFF);
    return x > 0.03 && x < 0.97 ? air / (4 * x * (1 - x)) : 0;
  }

  /** Both wheels of a bike centred at f, on its lane: back wheel first. */
  wheels(f: number, lane: number, air: number): [WheelSpot, WheelSpot] {
    const apex = this.apexFor(f, air);
    const df = BIKE_LENGTH / 2 / this.g.total;
    return [f - df, f + df].map((ff) => {
      const s = this.spot(ff, lane);
      return { x: s.x, z: s.z, y: this.wheel(ff, lane, apex, air) };
    }) as [WheelSpot, WheelSpot];
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
