import type { BikesData } from './career';
import type { LapTrace, MessageDef, MistakeOutcome, MotoSim, TrackDef, TrackSection } from './race';
import { riderProfile, type RiderProfile } from './riderProfile';
import { lapGeom, lapMetres, sectionTurns, START_PAD, startGeom, type StartGeom } from './trackGeom';

// The rider AI for the race screen (GDD 11.1): every rider rides the lap on their own, the way
// Super Off Road's CPU drivers follow a racing line, but for motocross. The race simulation
// (race.ts) is the referee: it says when each rider reaches the end of each section, who passes
// whom, and who makes a mistake or crashes. The AI acts that out between those moments: it picks
// a line through each section, swings out to pass and tucks in when blocked, brakes into corners
// and drives out of them, leaves the ground on jumps, goes down and remounts in a crash, and
// keeps clear of the rider beside it. It always reaches the end of a section exactly when the
// referee says, so what you watch is the result the simulation gave. It uses no random numbers:
// the same race always looks the same, at any playback speed.

export type RiderState = 'grid' | 'riding' | 'air' | 'wobble' | 'crashed' | 'remount' | 'retired' | 'finished' | 'waiting';

export interface RiderPose {
  id: string;
  /** Distance round the race in laps (1.5 = halfway round lap 2). */
  dist: number;
  /** Across the track: -1 is the left edge as the rider sees it, 1 the right. Past 1 is off the track. */
  lane: number;
  /** Height above the ground in metres (jumps, whoops). */
  air: number;
  /** Height of the ground itself in metres (hills), for the view. */
  elev: number;
  state: RiderState;
  /** Speed in metres per second, for wheel spin, dust and lean. */
  speed: number;
}

interface Seg {
  lap: number;
  si: number;
  t0: number;
  t1: number;
  d0: number;
  d1: number;
  mistake?: { outcome: MistakeOutcome['id']; lost: number };
  pass?: string;
  blocked?: string;
}

const CORNERS = new Set(['first_corner', 'flat_corner', 'berm', 'rutted_corner', 'hairpin', 'fast_sweeper']);
const BIG_JUMPS = new Set(['tabletop', 'double', 'step_up']);
/** Default jump face and hill heights in metres, when a section doesn't set one. */
export const DEFAULT_HEIGHTS: Record<string, number> = { tabletop: 2.5, double: 3.5, step_up: 3, rhythm: 1.5, whoops: 0.6, uphill: 6, downhill: 6 };
/** Where on a big jump the bike is in the air, as a share of the section. */
const TAKEOFF = 0.3;
const LANDING = 0.72;
/** Riders closer than this many metres, on near lines, ease apart. */
const ROOM = 5;
/** Seconds the whole field stands still at the gate, with the start board out, before it drops. */
export const START_HOLD = 5;
/** Grid units behind their slot where riders still to line up wait, by start row (beyond the start pad). */
const WAIT_BACK = [START_PAD + 1.5, START_PAD + 4];

/** One rider rolling up to their slot before the start: race times (negative) and how far back they set off, in grid units. */
interface LineUpMove {
  t0: number;
  t1: number;
  back: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const frac = (x: number) => x - Math.floor(x);

export class RaceDirector {
  private readonly segs = new Map<string, Seg[]>();
  private readonly out = new Map<string, number>();
  private readonly pulled = new Map<string, number>();
  private readonly turns: number[];
  private readonly metres: number;
  private readonly gateLane = new Map<string, number>();
  private readonly gateRow = new Map<string, number>();
  /** The start straight; riders line up at its gate, at race distance start.from. */
  readonly start: StartGeom;
  /**
   * Seconds before the gate drops that the start procedure begins: riders still to line up roll
   * into their slots (`prep`), then everyone holds still for START_HOLD. Race time runs from
   * -prestart to 0 at the gate drop. 0 in practice, which has no line-up.
   */
  readonly prestart: number;
  /** Seconds the riders still to line up take to roll into their slots. */
  readonly prep: number;
  /** Riders already in their slot when the start procedure begins. */
  readonly lined = new Set<string>();
  private readonly moves = new Map<string, LineUpMove>();
  private readonly lapUnits: number;

  constructor(
    readonly track: TrackDef,
    readonly profiles: Map<string, RiderProfile>,
    /** Each rider's gate on lap 1, best first. */
    gates: Map<string, number>,
    /** Laps in the race, or null for practice. */
    readonly laps: number | null,
  ) {
    const g = lapGeom(track.path);
    this.turns = sectionTurns(track, g);
    this.metres = lapMetres(track);
    this.lapUnits = g.total;
    this.start = startGeom(track, g);
    // The gate row spreads across the track, gate 0 nearest the inside of the first corner.
    const order = [...gates.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const firstTurn = this.turns.find((t) => t !== 0) || 1;
    // A big field lines up in two rows of up to 8, the second row straight behind the first.
    const rows = order.length > 8 ? 2 : 1;
    const perRow = Math.ceil(order.length / rows);
    const step = perRow > 1 ? 1.8 / (perRow - 1) : 0;
    order.forEach((id, i) => {
      const row = i % rows;
      const col = Math.floor(i / rows);
      this.gateRow.set(id, row);
      this.gateLane.set(id, firstTurn * (order.length > 1 ? 0.9 - step * col : 0));
    });
    for (const id of profiles.keys()) this.segs.set(id, []);

    // The line-up, for a race: the first riders to the gate (the inside gates of the front row,
    // 4 to 8 of them, more for a bigger field) are already in their slots. The rest roll up from
    // behind the start pad, the front row first, each in their own lane so nobody overlaps, and
    // the bigger the job the longer it takes (2 to 4 seconds). Then the field holds still.
    if (laps === null || order.length < 2) {
      this.prep = 0;
      this.prestart = 0;
      return;
    }
    const k = Math.min(order.length, clamp(Math.round(order.length * 0.4), 4, 8));
    const front = order.filter((id) => this.startRow(id) === 0);
    for (const id of front.slice(0, k)) this.lined.add(id);
    for (const id of order) if (this.lined.size < k && !this.lined.has(id)) this.lined.add(id);
    const movers = [...front, ...order.filter((id) => this.startRow(id) === 1)].filter((id) => !this.lined.has(id));
    this.prep = movers.length ? clamp(2 + (2 * movers.length) / 12, 2, 4) : 0;
    this.prestart = this.prep + START_HOLD;
    // Front-row riders roll up in the first part of the time, the second row once they are through.
    const groups = [movers.filter((id) => this.startRow(id) === 0), movers.filter((id) => this.startRow(id) === 1)];
    const t0 = -this.prestart;
    groups.forEach((group, gi) => {
      if (!group.length) return;
      const from = gi === 1 && groups[0].length ? this.prep * 0.42 : 0;
      const span = this.prep - from;
      const ride = Math.min(span, Math.max(1.4, span * 0.75));
      const gap = group.length > 1 ? (span - ride) / (group.length - 1) : 0;
      group.forEach((id, i) => this.moves.set(id, { t0: t0 + from + gap * i, t1: t0 + from + gap * i + ride, back: WAIT_BACK[gi] }));
    });
  }

  /**
   * Where a rider is before the gate drops: in their slot, or rolling up to it from behind the
   * start pad. Slots are at the gate (race distance start.from); the race view sets the second
   * row back a bike length.
   */
  private lineUp(id: string, t: number): RiderPose {
    const lane = this.gateLane.get(id) ?? 0;
    const m = this.moves.get(id);
    if (!m || t >= m.t1) return { id, dist: this.start.from, lane, air: 0, elev: 0, state: 'grid', speed: 0 };
    const k = clamp((t - m.t0) / (m.t1 - m.t0), 0, 1);
    const back = m.back * (1 - smooth(k));
    // Speed from the eased roll, in metres per second.
    const speed = k > 0 && k < 1 ? ((6 * k * (1 - k) * m.back) / (m.t1 - m.t0)) * (this.metres / this.lapUnits) : 0;
    return { id, dist: this.start.from - back / this.lapUnits, lane, air: 0, elev: 0, state: 'grid', speed };
  }

  /** True once every rider is in their slot and still (from START_HOLD seconds before the gate drops). */
  linedUp(t: number): boolean {
    return [...this.moves.values()].every((m) => t >= m.t1);
  }

  /** Which start row a rider lines up in: 0 at the gate, 1 just behind it. */
  startRow(id: string): number {
    return this.gateRow.get(id) ?? 0;
  }

  /** Takes in a lap from the simulation. Call it in lap order, as the race screen does. */
  addLap(trace: LapTrace): void {
    for (const [id, times] of Object.entries(trace.times)) {
      const list = this.segs.get(id);
      if (!list) continue;
      for (let i = 1; i < times.length; i++) {
        list.push({ lap: trace.lap, si: trace.secs[i - 1], t0: times[i - 1], t1: times[i], d0: trace.marks[i - 1], d1: trace.marks[i] });
      }
    }
    for (const e of trace.events) {
      if (e.kind === 'retire') {
        this.out.set(e.rider, e.t);
        continue;
      }
      if (e.kind === 'breakdown') continue;
      const seg = this.segs.get(e.rider)?.find((s) => s.lap === trace.lap && s.si === e.section);
      if (!seg) continue;
      if (e.kind === 'mistake') {
        // Two mistakes in one section show as one, with the time of both.
        const lost = (seg.mistake?.lost ?? 0) + e.lost;
        const worse = seg.mistake && rank(seg.mistake.outcome) > rank(e.outcome) ? seg.mistake.outcome : e.outcome;
        seg.mistake = { outcome: worse, lost };
      } else if (e.kind === 'pass') seg.pass = e.other;
      else if (e.kind === 'failedPass') seg.blocked = e.other;
    }
  }

  /** The player pulled off (the pit board's "It's over, bike blown"), at race time t. */
  retire(id: string, t: number): void {
    if (!this.pulled.has(id)) this.pulled.set(id, t);
  }

  /** Where every rider is, and what they are doing, at race time t (seconds from the gate drop). */
  poses(t: number): RiderPose[] {
    const poses: RiderPose[] = [];
    for (const [id, list] of this.segs) poses.push(this.pose(id, list, t));
    this.keepApart(poses);
    return poses;
  }

  private pose(id: string, list: Seg[], t: number, pulled = true): RiderPose {
    if (pulled) {
      const off = this.pulledOff(id, list, t);
      if (off) return off;
    }
    const p = this.profiles.get(id)!;
    if (!list.length || t <= list[0].t0) return this.lineUp(id, t);
    // The section the rider is in now: the first one that ends after t.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].t1 <= t) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= list.length) return this.afterLast(id, p, list, t);
    const seg = list[lo];
    const prev = lo > 0 ? list[lo - 1] : null;
    const sec = this.section(seg.si);
    const dur = Math.max(1e-6, seg.t1 - seg.t0);
    const s = t - seg.t0;

    // Riding time and any time lost to a mistake, which happens part way through the section.
    const lost = Math.min(seg.mistake?.lost ?? 0, dur * 0.95);
    const ride = dur - lost;
    const at = this.mistakeAt(p, seg);
    let tau: number;
    let stopped = false;
    if (s < at * ride) tau = s / ride;
    else if (s < at * ride + lost) {
      tau = at;
      stopped = true;
    } else tau = (s - lost) / ride;
    tau = clamp(tau, 0, 1);

    const c = this.warp(p, sec.type);
    const u = clamp(tau - (c * Math.sin(2 * Math.PI * tau)) / (2 * Math.PI), 0, 1);
    const dist = seg.d0 + u * (seg.d1 - seg.d0);
    const speed = stopped ? 0 : (((seg.d1 - seg.d0) * this.metres) / Math.max(1e-6, ride)) * (1 - c * Math.cos(2 * Math.PI * tau));

    // Line: from the last section's line into this one's, quicker for a nimble rider on a good bike.
    const from = prev ? this.target(id, p, prev) : (this.gateLane.get(id) ?? 0);
    const to = this.target(id, p, seg);
    let lane = from + (to - from) * smooth(u / (0.2 + 0.35 * (1 - p.agility)));
    lane += p.wobble * 0.08 * Math.sin(t * 1.3 + p.seed * 40);

    let state: RiderState = 'riding';
    if (stopped && seg.mistake) {
      const crash = seg.mistake.outcome === 'minor_crash' || seg.mistake.outcome === 'serious_crash';
      if (crash) {
        state = s - at * ride < lost * 0.6 ? 'crashed' : 'remount';
        // A crashed bike slides towards the outside of the track.
        lane += (this.turn(seg.si) ? -this.turn(seg.si) : 1) * 0.25 * smooth((s - at * ride) / 0.6);
      } else state = 'wobble';
    }

    const { air, elev } = this.height(p, sec.type, sec.height, u, stopped);
    if (air > 0.05 && state === 'riding') state = 'air';
    return { id, dist, lane: clamp(lane, -1, 1), air, elev, state, speed };
  }

  /** After the rider's last section: finished, out of the race, or waiting for the next lap. */
  private afterLast(id: string, p: RiderProfile, list: Seg[], t: number): RiderPose {
    const last = list[list.length - 1];
    const side = p.seed < 0.5 ? -1 : 1;
    const outAt = this.out.get(id);
    if (outAt !== undefined && outAt <= t + 1e-9) {
      // Pulled off the track where they stopped.
      return { id, dist: last.d1, lane: side * (1 + 0.45 * smooth((t - Math.max(outAt, last.t1)) / 2)), air: 0, elev: 0, state: 'retired', speed: 0 };
    }
    if (this.laps !== null && last.d1 >= this.laps - 1e-9) {
      // A cool-down roll after the flag, easing off the racing line.
      const v = ((last.d1 - last.d0) * this.metres) / Math.max(1e-6, last.t1 - last.t0);
      const dt = t - last.t1;
      const metres = v * 4 * (1 - Math.exp(-dt / 4));
      return { id, dist: last.d1 + metres / this.metres, lane: clamp(side * 0.95 * smooth(dt / 3), -1, 1), air: 0, elev: 0, state: 'finished', speed: v * Math.exp(-dt / 4) };
    }
    return { id, dist: last.d1, lane: this.target(id, p, last), air: 0, elev: 0, state: 'waiting', speed: 0 };
  }

  /** The line a rider aims for through a section: their own taste, the section's line, and any pass. */
  private target(id: string, p: RiderProfile, seg: Seg): number {
    const own = this.ownLine(id, p, seg);
    const other = seg.pass ?? seg.blocked;
    if (!other) return own;
    const op = this.profiles.get(other);
    const oseg = this.segs.get(other)?.find((s) => s.lap === seg.lap && s.si === seg.si);
    const theirs = op && oseg ? this.ownLine(other, op, oseg) : 0;
    if (seg.blocked) return clamp(theirs + (own >= theirs ? 0.2 : -0.2), -0.95, 0.95);
    // Pass on whichever side has more room, swinging wider the keener the rider.
    const swing = 0.65 + 0.35 * p.aggression;
    return clamp(theirs >= 0 ? theirs - swing : theirs + swing, -0.95, 0.95);
  }

  private ownLine(id: string, p: RiderProfile, seg: Seg): number {
    if (seg.si < 0) return this.gateLane.get(id) ?? 0;
    const sec = this.section(seg.si);
    const turn = this.turn(seg.si);
    if (CORNERS.has(sec.type) && turn) {
      const lines: Record<string, number> = { inside: 1, middle: 0, outside: -1 };
      const pref = sec.line ? 0.6 * (lines[sec.line] ?? 0) + 0.4 * p.line : p.line;
      // Positive lane is the rider's right, so the inside of a right-hand turn.
      return clamp(pref * 0.75 * turn, -0.9, 0.9);
    }
    return clamp(p.lane * 0.8, -0.9, 0.9);
  }

  /**
   * How speed changes through a section, from -0.6 (slow in the middle: braking in, driving out of
   * a corner) to 0.6 (fastest in the middle: a straight).
   */
  private warp(p: RiderProfile, type: string): number {
    if (CORNERS.has(type)) return -(type === 'hairpin' ? 0.6 : type === 'fast_sweeper' ? 0.25 : 0.5) * (1 - 0.6 * p.cornerSpeed);
    if (type === 'straight' || type === 'start_gate' || type === 'downhill') return 0.15 + 0.35 * p.drive;
    if (type === 'uphill') return -0.1 * (1 - p.drive);
    if (type === 'whoops' || type === 'braking_bumps') return -0.2 * (1 - p.skim);
    return 0;
  }

  /** The section ridden in a stretch; -1 is the start straight, ridden as a start. */
  private section(si: number): Pick<TrackSection, 'type' | 'height' | 'line'> {
    return si < 0 ? { type: 'start_gate' } : this.track.sections[si];
  }

  private turn(si: number): number {
    return si < 0 ? 0 : this.turns[si];
  }

  /** Where in a section a mistake happens: on landing for a jump, otherwise part way through. */
  private mistakeAt(p: RiderProfile, seg: Seg): number {
    if (!seg.mistake) return 1;
    const type = this.section(seg.si).type;
    if (BIG_JUMPS.has(type)) return LANDING;
    return 0.35 + 0.3 * frac(p.seed * 7 + seg.si * 0.37 + seg.lap * 0.13);
  }

  private height(p: RiderProfile, type: string, set: number | undefined, u: number, stopped: boolean): { air: number; elev: number } {
    const h = set ?? DEFAULT_HEIGHTS[type] ?? 0;
    let air = 0;
    let elev = 0;
    if (!stopped) {
      if (BIG_JUMPS.has(type) && u > TAKEOFF && u < LANDING) {
        const x = (u - TAKEOFF) / (LANDING - TAKEOFF);
        air = h * (1 - 0.5 * p.scrub) * 4 * x * (1 - x);
      } else if (type === 'rhythm') {
        // Three jumps in a row.
        const x = (u * 3) % 1;
        if (x > 0.1 && x < 0.75) air = h * (1 - 0.4 * p.scrub) * 4 * ((x - 0.1) / 0.65) * (1 - (x - 0.1) / 0.65);
      } else if (type === 'whoops') air = h * (1 - p.skim) * Math.abs(Math.sin(u * Math.PI * 10));
      else if (type === 'braking_bumps') air = 0.15 * (1 - p.skim) * Math.abs(Math.sin(u * Math.PI * 14));
    }
    if (type === 'uphill' || type === 'downhill') elev = h * Math.sin(Math.PI * u);
    return { air, elev };
  }

  /** The player pulled off part way round: they stop where they are, not at the end of the lap. */
  private pulledOff(id: string, list: Seg[], t: number): RiderPose | null {
    const at = this.pulled.get(id);
    if (at === undefined || t < at) return null;
    const where = this.pose(id, list, at, false);
    const side = where.lane >= 0 ? 1 : -1;
    return { ...where, lane: side * Math.max(Math.abs(where.lane), 1 + 0.45 * smooth((t - at) / 2)), air: 0, state: 'retired', speed: 0 };
  }

  /** Riders side by side ease apart so they don't ride through each other. */
  private keepApart(poses: RiderPose[]): void {
    const racing = poses.filter((q) => q.state !== 'grid' && q.state !== 'retired' && q.state !== 'finished').sort((a, b) => b.dist - a.dist);
    for (let i = 0; i < racing.length; i++) {
      for (let j = i + 1; j < racing.length; j++) {
        const a = racing[i];
        const b = racing[j];
        const gap = (a.dist - b.dist) * this.metres;
        if (gap > ROOM) break;
        const dl = b.lane - a.lane;
        if (Math.abs(dl) >= 0.5) continue;
        const push = (0.5 - Math.abs(dl)) * 0.5 * (1 - gap / ROOM);
        const dir = dl === 0 ? (frac(this.profiles.get(b.id)!.seed * 13) < 0.5 ? -1 : 1) : Math.sign(dl);
        // The rider behind gives most of the room.
        b.lane = clamp(b.lane + dir * push * 0.7, -1, 1);
        a.lane = clamp(a.lane - dir * push * 0.3, -1, 1);
      }
    }
  }
}

/** A director for a moto: every rider's profile from their skills, bike and message at the start. */
export function directorFor(sim: MotoSim, bikes: BikesData, messages: MessageDef[]): RaceDirector {
  const ceiling = bikes.classes.find((c) => c.id === sim.classId)?.ceiling ?? 1;
  const profiles = new Map<string, RiderProfile>();
  const gates = new Map<string, number>();
  for (const r of sim.riders) {
    profiles.set(r.e.id, riderProfile(r.e, r.stats, ceiling, messages.find((m) => m.id === r.message)));
    gates.set(r.e.id, r.e.gate);
  }
  return new RaceDirector(sim.track, profiles, gates, sim.totalLaps);
}

function rank(o: MistakeOutcome['id']): number {
  return ['small', 'big', 'minor_crash', 'serious_crash'].indexOf(o);
}

/** Height of the ground in metres at lap fraction f (hills), for the race view. */
export function groundElev(track: TrackDef, bounds: number[], f: number): number {
  const at = f - Math.floor(f);
  let si = 0;
  while (si < track.sections.length - 1 && bounds[si + 1] <= at) si++;
  const sec = track.sections[si];
  if (sec.type !== 'uphill' && sec.type !== 'downhill') return 0;
  const u = (at - bounds[si]) / Math.max(1e-9, bounds[si + 1] - bounds[si]);
  return (sec.height ?? DEFAULT_HEIGHTS[sec.type]) * Math.sin(Math.PI * u);
}
