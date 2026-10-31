import type { BikesData } from './career';
import { mixSeed, seededRng, type LapTrace, type MessageDef, type MistakeOutcome, type MotoSim, type TrackDef, type TrackSection } from './race';
import { riderProfile, type RiderProfile } from './riderProfile';
import { isNoTurn, isSprint, lapGeom, lapMetres, NO_TURN_LANES, NO_TURN_RUNOFF, pointAt, sectionBounds, sectionTurns, SPRINT_QUEUE, START_PAD, startGeom, type StartGeom } from './trackGeom';
import { DEFAULT_HEIGHTS, HOP_JUMPS, landingOf, pickWay, type Way } from './jumps';
import { HILLS, sectionShape, TrackSurface, type Flight } from './trackSurface';
import { showmanOf, trickFor, type Trick } from './tricks';
import { downPhase } from './crashRecovery';

export { DEFAULT_HEIGHTS };

// The rider AI for the race screen (GDD 11.1): every rider rides the lap on their own, the way
// Super Off Road's CPU drivers follow a racing line, but for motocross. The race simulation
// (race.ts) is the referee: it says when each rider reaches the end of each section, who passes
// whom, and who makes a mistake or crashes. The AI acts that out between those moments: it picks
// a line through each section, swings out to pass and tucks in when blocked, brakes into corners
// and drives out of them, leaves the ground on jumps, goes down and remounts in a crash, and
// keeps clear of the rider beside it. It always reaches the end of a section exactly when the
// referee says, so what you watch is the result the simulation gave. Its only random numbers are
// for the line-up before the start, drawn from a seed made of the track and the gate order: the
// same race always looks the same, at any playback speed.

export type RiderState = 'grid' | 'riding' | 'air' | 'wobble' | 'crashed' | 'remount' | 'retired' | 'finished' | 'waiting';

export interface RiderPose {
  id: string;
  /** Distance round the race in laps (1.5 = halfway round lap 2). */
  dist: number;
  /** Not on the screen: a No-Turn Takedown seeding rider still waiting their turn back in the pits, or long since done. */
  hidden?: boolean;
  /** Across the track: -1 is the left edge as the rider sees it, 1 the right. Past 1 is off the track. */
  lane: number;
  /** Height above the ground in metres (jumps, whoops). */
  air: number;
  /** The hops this rider is taking through this section and the next, for the view to fly the wheels along (null on the ground). */
  flight: Flight | null;
  /** Height of the ground itself in metres (hills), for the view. */
  elev: number;
  state: RiderState;
  /** Speed in metres per second, for wheel spin, dust and lean. */
  speed: number;
  /**
   * A crash the view acts out its own way: 'loop' is a wheelie out of the gate that goes over
   * backwards. t is seconds from the moment the rider comes off (negative while the front is
   * still coming up).
   */
  stunt?: { kind: 'loop'; t: number };
  /** Down after a crash: seconds since it and how long it costs, for the view to act out (crashRecovery.ts). */
  down?: { t: number; lost: number };
}

interface Seg {
  lap: number;
  si: number;
  t0: number;
  t1: number;
  d0: number;
  d1: number;
  mistake?: { outcome: MistakeOutcome['id']; lost: number; loop?: boolean };
  pass?: string;
  blocked?: string;
}

const CORNERS = new Set(['first_corner', 'flat_corner', 'berm', 'rutted_corner', 'hairpin', 'fast_sweeper']);
/** Where a mistake on a jump ridden without a hop (rolled) happens, as a share of the section. */
const LANDING = 0.72;
/** How far out of the gate a loop-out goes over, in metres, and how long the wheelie takes to come up before it does. */
export const LOOP_METRES = 6;
export const LOOP_RISE = 0.8;
/** The showman (tricks.ts) picks ways over the jumps as a jumper this good at least. */
const SHOWMAN_JUMP = 0.85;
/** Riders closer than this many metres, on near lines, ease apart. */
const ROOM = 5;
/** Seconds the whole field stands still at the gate, with the start board out, before it drops. */
export const START_HOLD = 5;
/** Seconds the line-up takes, from the start procedure opening to the last rider stopping in their slot. */
export const LINE_UP = 6;

/** The line-up for a field: LINE_UP for up to two rows, half a second more for each rider on a third, so nobody hurries. */
export function lineUpTime(riders: number): number {
  return LINE_UP + 0.5 * Math.max(0, riders - 2 * ROW_SIZE);
}
/** How fast finishers ride their cool-down after the flag, in metres a second. */
const COOL_DOWN = 4;
/** How far apart finishers ride their cool-down in single file, in grid units: three bike lengths (BIKE_LENGTH, trackSurface), room for the inside of a hairpin. */
/** Seconds after the flag in which finishers heading for different edges are still crossing each other's path. */
const COOL_SIDE = 3;
const COOL_GAP = 1.1 * 3;

/** A finisher's cool-down: when and where they took the flag, how fast, and the edge they ride down. */
interface Finish {
  id: string;
  t1: number;
  d1: number;
  v: number;
  cruise: number;
  from: number;
  edge: number;
}
/** Seconds the race screen shows before an enduro sprint's first rider leaves the start line. */
export const SPRINT_LEAD = 3;
/** Grid units between riders queueing single file at a sprint's start line: a bike and a bit. */
const QUEUE_GAP = 1.45;
/** Seconds a sprint's queue takes to close up a place once the rider at the front has gone. */
const QUEUE_CLOSE = 1.6;
/** How far down the return lane a sprint's finishers ride before pulling off, as a share of it, and the room each takes there (grid units). */
const PARK_AT = 0.2;
const PARK_GAP = 1.5;

/** Seconds a No-Turn Takedown seeding rider stays parked in the run-off before riding back to the pits (off the screen). */
const PARK_STAY = 6;
/** Grid units a No-Turn Takedown rider waiting their turn on the seeding run stands behind the one on the gate. */
const SEED_GAP = 1.6;

/** Gates in a start row, and the most riders the start takes (two rows; Boss, 28 Oct 2026: 16 looks cleaner than 20). */
export const ROW_SIZE = 8;
export const MAX_GRID = 16;
/** How far behind the front row the race view draws the second row, in grid units (RaceView: BIKE_LENGTH × 1.4). */
const ROW_GAP = 1.1 * 1.4;

/**
 * One rider riding up to their slot before the start: race times (negative), how far back they
 * set off (grid units behind their slot, along the start straight) and how far off their lane
 * line (a share of the half-width) they start, easing onto it.
 */
interface LineUpMove {
  t0: number;
  t1: number;
  back: number;
  side: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const frac = (x: number) => x - Math.floor(x);
/** The ids in a seeded random order (its own draws, so the line-up's other draws stay as they were). */
const shuffled = (ids: string[], seed: number) => {
  const rnd = seededRng(mixSeed(seed, 1));
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

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
  /** The order riders reach their slots: the front row in pick order, then each row behind in pick order. Empty in practice. */
  readonly arrival: string[] = [];
  private readonly moves = new Map<string, LineUpMove>();
  private readonly lapUnits: number;
  /** The track as a surface, for the riders' flights over jumps. */
  private readonly surface: TrackSurface;
  private readonly bounds: number[];
  /** Each rider's way through each jump on each lap, picked once (id|lap|section). */
  private readonly ways = new Map<string, Way | null>();
  /** Each rider's tricks over the hops of their way through each jump on each lap (id|lap|section). */
  private readonly tricks = new Map<string, (Trick | null)[]>();
  /** The field's showman: the best jumper who isn't the player, who whips and scrubs the big hops (tricks.ts). */
  readonly showman: string | null;
  private finishCache: { key: string; plan: Map<string, Finish> } | null = null;
  /** An enduro sprint: riders leave the start line one at a time, queue for it single file, and ride the return lane single file. */
  readonly sprint: boolean;
  /** A No-Turn Takedown: four on the gate, two each side of the starter's box, and finishers pull up in the run-off. */
  readonly noTurn: boolean;
  /** Seconds between riders leaving the gate on a staggered run (a No-Turn Takedown's seeding run); 0 when they all go together. */
  readonly interval: number;

  constructor(
    readonly track: TrackDef,
    readonly profiles: Map<string, RiderProfile>,
    /** Each rider's gate on lap 1, best first. */
    private readonly gates: Map<string, number>,
    /** Laps in the race, or null for practice. */
    readonly laps: number | null,
    /** The order riders picked their gates, which is the order they ride up to the start. Left out, a shuffle drawn from the track and the gates. */
    pickOrder?: string[],
    /** A staggered start (MotoOptions.interval): riders leave the gate this many seconds apart, in gate order. */
    interval = 0,
  ) {
    const g = lapGeom(track.path);
    this.turns = sectionTurns(track, g);
    this.metres = lapMetres(track);
    this.lapUnits = g.total;
    this.surface = new TrackSurface(track);
    this.bounds = sectionBounds(track);
    this.start = startGeom(track, g);
    this.sprint = isSprint(track);
    this.noTurn = isNoTurn(track);
    this.interval = interval;
    this.showman = showmanOf(profiles.values());
    // Each rider's gate is their slot: gates 1 to 8 (0 to 7 here) are the front row, from the inside
    // of the first corner outwards, gates 9 to 16 the second row and 17 to 24 the third, each
    // straight behind the gate eight before it. A field of 8 or fewer is one row spread across the start.
    const order = [...gates.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const firstTurn = this.turns.find((t) => t !== 0) || 1;
    const n = order.length;
    if (n > MAX_GRID && !interval) throw new Error(`${n} riders, but the start has ${MAX_GRID} gates`);
    const used = new Set<number>();
    for (const [id, gate] of gates) {
      if (!Number.isInteger(gate) || gate < 0 || gate >= Math.max(n, 1) || used.has(gate)) throw new Error(`${id} has gate ${gate + 1}, which is not a free gate of the ${n}`);
      used.add(gate);
    }
    const perRow = n > ROW_SIZE ? ROW_SIZE : n;
    const step = perRow > 1 ? 1.8 / (perRow - 1) : 0;
    for (const [id, gate] of gates) {
      this.gateRow.set(id, Math.floor(gate / ROW_SIZE));
      this.gateLane.set(id, firstTurn * (perRow > 1 ? 0.9 - step * (gate % ROW_SIZE) : 0));
    }
    // A No-Turn Takedown's four gates: two each side of the starter's box.
    if (this.noTurn) for (const [id, gate] of gates) this.gateLane.set(id, NO_TURN_LANES[gate % NO_TURN_LANES.length]);
    for (const id of profiles.keys()) this.segs.set(id, []);
    if (interval > 0) {
      // A staggered run: no line-up. The next rider away waits on the gate, the one after on the
      // pad behind, and the rest back in the pits; the first leaves SPRINT_LEAD seconds in.
      for (const id of gates.keys()) this.gateLane.set(id, this.noTurn ? NO_TURN_LANES[1] : 0);
      this.prep = 0;
      this.prestart = SPRINT_LEAD;
      return;
    }
    if (this.sprint) {
      // A sprint has no grid: everyone queues single file in the middle of the return lane, in
      // their start order, and the first rider leaves SPRINT_LEAD seconds after the screen opens.
      for (const id of gates.keys()) this.gateLane.set(id, 0);
      this.prep = 0;
      this.prestart = laps === null ? 0 : SPRINT_LEAD;
      return;
    }

    // The line-up, for a race. Riders reach their slots in the order they picked their gates, front
    // row first, as at a real start, so the gate fills unevenly: the first few (4 for a full field)
    // are already there, and the rest ride up from just behind the start pad over about LINE_UP seconds, several moving at once, each at their own pace from their own spot, in their
    // own lane, so nobody touches. A second-row rider only sets off once the front-row rider in their
    // lane has stopped in their slot, so they never ride through it. Then the field holds still.
    if (laps === null || n < 2) {
      this.prep = 0;
      this.prestart = 0;
      return;
    }
    let seed = 2166136261;
    for (const ch of `${track.id}|${order.join(',')}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
    const rnd = seededRng(seed >>> 0);
    const k = Math.min(n, clamp(Math.round(n * 0.25), 4, ROW_SIZE));
    const gateOf = (id: string) => gates.get(id)!;
    const byGate = new Map(order.map((id) => [gateOf(id), id]));
    // Pick order, the front row first: a second-row rider stops in the slot the front-row rider of
    // their lane rides through, so the second row rolls in once the front row is in.
    const picks = pickOrder?.filter((id) => gates.has(id)).length === n ? pickOrder.filter((id) => gates.has(id)) : shuffled(order, seed >>> 0);
    const arrival = this.arrival;
    const rows = Math.ceil(n / ROW_SIZE);
    for (let row = 0; row < rows; row++) arrival.push(...picks.filter((id) => this.startRow(id) === row));
    for (const id of arrival.slice(0, k)) this.lined.add(id);
    // Riders drift onto their lane line from the same side, so neighbours never close up.
    const drift = rnd() < 0.5 ? -1 : 1;
    // Each rider's own draws, made once, so the plan can be tightened without changing who does what.
    const movers = arrival.slice(k).map((id) => ({ id, r: [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()] }));
    const build = (tight: number) => {
      const plan = new Map<string, LineUpMove>();
      let prev = 0;
      for (const { id, r } of movers) {
        const row = this.startRow(id);
        // Just clear of the pad (START_PAD behind the gate, plus room for the bike), the second row
        // about as far back as the front-row rider of their lane started.
        const ahead = row ? byGate.get(gateOf(id) - ROW_SIZE) : undefined;
        const fm = ahead ? plan.get(ahead) : undefined;
        const back = Math.max(START_PAD + 0.6 - row * ROW_GAP + r[0] * 1.2 * tight, fm ? fm.back - ROW_GAP + 1.35 + r[1] * 0.4 : -Infinity);
        // Each at their own easy pace: a top speed of 1.9 to 2.3 grid units a second.
        const ride = (1.5 * back) / (1.9 + r[2] * 0.4);
        // Arrive after the rider who picked before, and set off only once the lane ahead is filled.
        const laneFree = ahead ? (fm ? fm.t1 : 0) + 0.15 + r[3] * 0.3 * tight : 0;
        const t1 = Math.max(prev + 0.08 + r[4] * 0.3 * tight, ride + r[5] * 0.4 * tight, laneFree + ride);
        plan.set(id, { t0: t1 - ride, t1, back, side: drift * (0.01 + r[6] * 0.03) });
        prev = t1;
      }
      return { plan, prev };
    };
    // Tighten the gaps until it fits in LINE_UP without anyone hurrying (at most a fifth quicker).
    const lineUp = lineUpTime(n);
    let { plan, prev } = build(1);
    for (let tight = 0.8; prev > lineUp * 1.2 && tight >= 0; tight -= 0.2) ({ plan, prev } = build(tight));
    // Stretch or squeeze the whole plan so the last rider stops at LINE_UP: every rider keeps their
    // order and the second row still waits on the front.
    this.prep = plan.size ? lineUp : 0;
    this.prestart = this.prep + START_HOLD;
    const scale = prev > 0 ? lineUp / prev : 1;
    for (const [id, m] of plan) this.moves.set(id, { ...m, t0: -this.prestart + m.t0 * scale, t1: Math.min(-START_HOLD, -this.prestart + m.t1 * scale) });
  }

  /**
   * Where a rider is before the gate drops: in their slot, or rolling up to it from behind the
   * start pad. Slots are at the gate (race distance start.from); the race view sets the second
   * row back a bike length.
   */
  private lineUp(id: string, t: number): RiderPose {
    const lane = this.gateLane.get(id) ?? 0;
    const m = this.moves.get(id);
    if (!m || t >= m.t1) return { id, dist: this.start.from, lane, air: 0, elev: 0, flight: null, state: 'grid', speed: 0 };
    const k = clamp((t - m.t0) / (m.t1 - m.t0), 0, 1);
    const left = 1 - smooth(k);
    // Speed from the eased ride, in metres per second.
    const speed = k > 0 && k < 1 ? ((6 * k * (1 - k) * m.back) / (m.t1 - m.t0)) * (this.metres / this.lapUnits) : 0;
    return { id, dist: this.start.from - (m.back * left) / this.lapUnits, lane: lane + m.side * left, air: 0, elev: 0, flight: null, state: 'grid', speed };
  }

  /** True once every rider is in their slot and still (from START_HOLD seconds before the gate drops). */
  linedUp(t: number): boolean {
    return [...this.moves.values()].every((m) => t >= m.t1);
  }

  /** Which start row a rider lines up in: 0 at the gate, 1 just behind it, 2 behind that. */
  startRow(id: string): number {
    return this.gateRow.get(id) ?? 0;
  }

  /** A rider's gate, from 0 (gate 1). */
  gateOf(id: string): number {
    return this.gates.get(id) ?? 0;
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
        seg.mistake = { outcome: worse, lost, ...(seg.mistake?.loop || e.with === 'loop_out' ? { loop: true } : {}) };
      } else if (e.kind === 'pass') seg.pass = e.other;
      else if (e.kind === 'failedPass') seg.blocked = e.other;
    }
  }

  /** Takes back the latest lap, to be replaced by the same lap run again (MotoSim.redoLap). */
  dropLap(trace: LapTrace): void {
    for (const list of this.segs.values()) while (list.length && list[list.length - 1].lap === trace.lap) list.pop();
    for (const e of trace.events) if (e.kind === 'retire' && this.out.get(e.rider) === e.t) this.out.delete(e.rider);
    // Its ways and tricks are picked again, as its mistakes may fall differently.
    for (const m of [this.ways, this.tricks]) for (const k of [...m.keys()]) if (k.split('|')[1] === String(trace.lap)) m.delete(k);
  }

  /** The player pulled off (the pit board's "It's over, bike blown"), at race time t. */
  retire(id: string, t: number): void {
    if (!this.pulled.has(id)) this.pulled.set(id, t);
  }

  /** Where every rider is, and what they are doing, at race time t (seconds from the gate drop). */
  poses(t: number): RiderPose[] {
    const poses: RiderPose[] = [];
    for (const [id, list] of this.segs) poses.push(this.pose(id, list, t));
    if (this.sprint) this.queue(poses, t);
    else if (!this.noTurn) this.coolDown(poses, t);
    this.keepApart(poses);
    return poses;
  }

  /**
   * A sprint rider's next time away from the start line at race time t: the end of the wait they
   * are in or have still to come to, or null once they have left it for the last lap simulated.
   */
  private nextAway(list: Seg[], t: number): number | null {
    if (!list.length) return null;
    if (t <= list[0].t0) return list[0].t0;
    for (const s of list) if (s.si === SPRINT_QUEUE && s.t1 > t) return s.t1;
    return null;
  }

  /**
   * The queue at a sprint's start line: riders waiting to leave stand single file back down the
   * return lane in the order they leave, the front one on the line, closing up a place over
   * QUEUE_CLOSE seconds each time someone goes; a rider rolling down the return lane stops behind
   * the back of it. One who has left rides away from the line as the race says.
   */
  private queue(poses: RiderPose[], t: number): void {
    const line = frac(this.start.from);
    const gap = QUEUE_GAP / this.lapUnits;
    const away = new Map<string, number>();
    for (const [id, list] of this.segs) {
      const a = this.nextAway(list, t);
      if (a !== null) away.set(id, a);
    }
    // Everyone who has gone from the line lately, for the queue to close up after them.
    const gone: number[] = [];
    for (const list of this.segs.values()) {
      for (const s of list) {
        if (s.si !== SPRINT_QUEUE && s !== list[0]) continue;
        const at = s.si === SPRINT_QUEUE ? s.t1 : s.t0;
        if (at < t - 1e-9 && t - at < QUEUE_CLOSE) gone.push(at);
      }
    }
    const waiting = poses.filter((p) => p.state === 'grid' && away.has(p.id)).sort((a, b) => away.get(a.id)! - away.get(b.id)!);
    const closing = gone.reduce((sum, at) => sum + (1 - smooth((t - at) / QUEUE_CLOSE)), 0);
    // Lap fractions: the start line is at `line`, and the queue runs back from it down the lane.
    let back = Infinity;
    waiting.forEach((p, k) => {
      p.dist -= (k + closing) * gap;
      p.lane = 0;
      back = frac(p.dist);
    });
    // Riders rolling down the return lane (short of the start line) stop behind the back of the queue.
    if (back === Infinity) return;
    const rolling = poses.filter((p) => (p.state === 'riding' || p.state === 'waiting') && frac(p.dist) < line).sort((a, b) => frac(b.dist) - frac(a.dist));
    for (const p of rolling) {
      const cap = back - gap;
      if (frac(p.dist) > cap) {
        p.dist = Math.floor(p.dist) + Math.max(0, cap);
        p.speed = 0;
      }
      back = frac(p.dist);
    }
  }

  private pose(id: string, list: Seg[], t: number, pulled = true): RiderPose {
    if (pulled) {
      const off = this.pulledOff(id, list, t);
      if (off) return off;
    }
    const p = this.profiles.get(id)!;
    if (this.interval > 0 && (!list.length || t <= list[0].t0)) return this.waitingTurn(id, list, t);
    if (this.sprint && (!list.length || t <= list[0].t0)) return { id, dist: this.start.from, lane: 0, air: 0, elev: 0, flight: null, state: 'grid', speed: 0 };
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
    // A sprint's wait at the start line: in the queue (queue() says where).
    if (seg.si === SPRINT_QUEUE) return { id, dist: seg.d0, lane: 0, air: 0, elev: 0, flight: null, state: 'grid', speed: 0 };
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
    const loop = this.loopsOut(p, seg);
    let stunt: RiderPose['stunt'];
    let down: RiderPose['down'];
    if (loop) {
      const since = s - at * ride;
      if (since > -LOOP_RISE && since < lost) stunt = { kind: 'loop', t: since };
    }
    if (stopped && seg.mistake) {
      const crash = seg.mistake.outcome === 'minor_crash' || seg.mistake.outcome === 'serious_crash';
      if (crash) {
        // Down until they are getting back on (crashRecovery.ts), then remounting.
        down = { t: s - at * ride, lost };
        state = downPhase(down.t, lost).phase === 'mount' ? 'remount' : 'crashed';
        // A crashed bike slides towards the outside of the track; a loop-out stays where it went over.
        if (!loop) lane += (this.turn(seg.si) ? -this.turn(seg.si) : 1) * 0.25 * smooth((s - at * ride) / 0.6);
      } else state = 'wobble';
    }

    const flight = this.flight(p, seg, list, lo);
    const { air, elev } = this.height(p, sec.type, sec.height, u, dist - Math.floor(dist), flight, stopped);
    if (air > 0.05 && state === 'riding') state = 'air';
    const pose: RiderPose = { id, dist, lane: clamp(lane, -1, 1), air, elev, flight, state, speed };
    if (stunt) pose.stunt = stunt;
    if (down) pose.down = down;
    return pose;
  }

  /** After the rider's last section: finished, out of the race, or waiting for the next lap. */
  private afterLast(id: string, p: RiderProfile, list: Seg[], t: number): RiderPose {
    const last = list[list.length - 1];
    const side = p.seed < 0.5 ? -1 : 1;
    const outAt = this.out.get(id);
    if (outAt !== undefined && outAt <= t + 1e-9) {
      // Pulled off the track where they stopped.
      return { id, dist: last.d1, lane: side * (1 + 0.45 * smooth((t - Math.max(outAt, last.t1)) / 2)), air: 0, elev: 0, flight: null, state: 'retired', speed: 0 };
    }
    if (this.laps !== null && last.d1 >= this.laps - 1e-9 && this.sprint) return this.parked(id, last, t);
    if (this.laps !== null && last.d1 >= this.laps - 1e-9 && this.noTurn) return this.pulledUp(id, last, t);
    if (this.laps !== null && last.d1 >= this.laps - 1e-9) {
      // A cool-down after the flag: ease off to a steady slow ride down one edge of the track and
      // keep rolling round, so finishers never park on the track where the riders behind are still
      // racing to the line (they all used to stop in a heap 40 m past it).
      const f = this.finishes().get(id)!;
      const dt = t - f.t1;
      return { id, dist: this.coolDist(f, t), lane: f.from + (f.edge * 0.7 - f.from) * smooth(dt / 3), air: 0, elev: 0, flight: null, state: 'finished', speed: f.cruise + (f.v - f.cruise) * Math.exp(-dt / 2) };
    }
    return { id, dist: last.d1, lane: this.target(id, p, last), air: 0, elev: 0, flight: null, state: 'waiting', speed: 0 };
  }

  /**
   * A sprint finisher after the flag: easing down to the return lane's pace, they roll a little
   * way down it and pull off to the side away from the test, each a bike's room further on than
   * the one who finished before, so they never block the lane for riders still to queue.
   */
  private parked(id: string, last: Seg, t: number): RiderPose {
    const order = [...this.segs.entries()].filter(([, l]) => l.at(-1)?.d1 !== undefined && l.at(-1)!.d1 >= this.laps! - 1e-9).sort((a, b) => a[1].at(-1)!.t1 - b[1].at(-1)!.t1).map(([k]) => k);
    const k = order.indexOf(id);
    const lane = this.start.from;
    const spot = this.laps! + Math.min(lane * 0.9, lane * PARK_AT + (k * PARK_GAP) / this.lapUnits);
    const v0 = ((last.d1 - last.d0) * this.metres) / Math.max(1e-6, last.t1 - last.t0);
    const dt = Math.max(0, t - last.t1);
    const cruise = Math.min(v0, COOL_DOWN);
    const rolled = last.d1 + (cruise * dt + (v0 - cruise) * 2 * (1 - Math.exp(-dt / 2))) / this.metres;
    const dist = Math.min(rolled, spot);
    const there = rolled >= spot;
    const reach = there ? (rolled - spot) * this.metres / Math.max(0.5, cruise) : 0;
    const side = this.parkSide(spot);
    return { id, dist, lane: side * 3.2 * smooth(reach / 1.5), air: 0, elev: 0, flight: null, state: 'finished', speed: there ? cruise * (1 - smooth(reach / 1.5)) : cruise + (v0 - cruise) * Math.exp(-dt / 2) };
  }

  /**
   * A staggered run's rider before they leave the gate: on the gate if they are next away, on the
   * pad behind it if they go after that, otherwise back in the pits (hidden).
   */
  private waitingTurn(id: string, list: Seg[], t: number): RiderPose {
    const mine = list[0]?.t0 ?? Infinity;
    let ahead = 0;
    for (const other of this.segs.values()) {
      const at = other[0]?.t0;
      if (at !== undefined && at > t && at < mine) ahead++;
    }
    const lane = this.gateLane.get(id) ?? 0;
    const dist = this.start.from - (ahead * SEED_GAP) / this.lapUnits;
    return { id, dist, lane, air: 0, elev: 0, flight: null, state: 'grid', speed: 0, ...(ahead > 1 ? { hidden: true } : {}) };
  }

  /**
   * A No-Turn Takedown finisher: rolls off the line into the run-off and pulls up to one side, in
   * finishing order, alternating sides, clear of the riders still finishing. On a staggered run
   * they ride off back to the pits a few seconds later, so the run-off never fills.
   */
  private pulledUp(id: string, last: Seg, t: number): RiderPose {
    const order = [...this.segs.entries()].filter(([, l]) => l.at(-1)?.d1 !== undefined && l.at(-1)!.d1 >= this.laps! - 1e-9).sort((a, b) => a[1].at(-1)!.t1 - b[1].at(-1)!.t1).map(([k]) => k);
    const k = order.indexOf(id);
    const runoff = NO_TURN_RUNOFF / this.lapUnits;
    const slot = this.interval > 0 ? 0 : Math.floor(k / 2);
    const spot = this.laps! + Math.min(runoff * 0.8, runoff * 0.35 + (slot * PARK_GAP) / this.lapUnits);
    const v0 = ((last.d1 - last.d0) * this.metres) / Math.max(1e-6, last.t1 - last.t0);
    const dt = Math.max(0, t - last.t1);
    // Braking hard to a stop: the run-off is short.
    const stopIn = Math.max(0.5, ((spot - last.d1) * this.metres * 2) / Math.max(1, v0));
    const k1 = clamp(dt / stopIn, 0, 1);
    const dist = last.d1 + (spot - last.d1) * (1 - (1 - k1) * (1 - k1));
    const side = k % 2 ? -1 : 1;
    const off = smooth((dt - stopIn * 0.6) / 1.5);
    const gone = this.interval > 0 && dt > PARK_STAY;
    return { id, dist, lane: side * (0.55 + 0.25 * off), air: 0, elev: 0, flight: null, state: 'finished', speed: v0 * (1 - k1), ...(gone ? { hidden: true } : {}) };
  }

  private parkSides = new Map<number, number>();

  /** Which side of the return lane a finisher parks on at race distance d: the one further from the rest of the track. */
  private parkSide(d: number): number {
    const key = Math.round(d * 1e4);
    const got = this.parkSides.get(key);
    if (got) return got;
    const f = d - Math.floor(d);
    const g = lapGeom(this.track.path);
    const room = (side: number) => {
      const p = this.surface.spot(f, side * 3.2);
      let near = Infinity;
      for (let u = this.start.join; u < 1; u += 0.5 / g.total) {
        const q = pointAt(g, u);
        near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.z));
      }
      return near;
    };
    const side = room(1) >= room(-1) ? 1 : -1;
    this.parkSides.set(key, side);
    return side;
  }

  /**
   * How each finisher rides their cool-down: from the line they crossed on to one edge, the edge
   * they were nearer, unless a rider who finished just before is still close ahead on it and the
   * other edge is clearer. Worked out in finishing order, again whenever the laps change.
   */
  private finishes(): Map<string, Finish> {
    const key = [...this.segs.values()].map((l) => l.length).join(',');
    if (this.finishCache?.key === key) return this.finishCache.plan;
    const plan = new Map<string, Finish>();
    const all: Finish[] = [];
    if (this.laps !== null) {
      for (const [id, list] of this.segs) {
        const last = list.at(-1);
        if (!last || last.d1 < this.laps - 1e-9) continue;
        const p = this.profiles.get(id)!;
        const v = ((last.d1 - last.d0) * this.metres) / Math.max(1e-6, last.t1 - last.t0);
        const from = this.target(id, p, last) + p.wobble * 0.08 * Math.sin(last.t1 * 1.3 + p.seed * 40);
        all.push({ id, t1: last.t1, d1: last.d1, v, cruise: Math.min(v, COOL_DOWN), from, edge: from >= 0 ? 1 : -1 });
      }
    }
    all.sort((a, b) => a.t1 - b.t1);
    const lastOn = new Map<number, Finish>();
    for (const f of all) {
      // How far past the line the last finisher down each edge is when this one crosses.
      const room = (edge: number) => {
        const lead = lastOn.get(edge);
        return lead ? this.coolDist(lead, f.t1) - f.d1 : Infinity;
      };
      if (room(f.edge) < COOL_GAP * 3 / this.lapUnits && room(-f.edge) > room(f.edge)) f.edge = -f.edge;
      lastOn.set(f.edge, f);
      plan.set(f.id, f);
    }
    this.finishCache = { key, plan };
    return plan;
  }

  /** Where a finisher is at time t on their cool-down, left to themselves. */
  private coolDist(f: Finish, t: number): number {
    const dt = Math.max(0, t - f.t1);
    return f.d1 + (f.cruise * dt + (f.v - f.cruise) * 2 * (1 - Math.exp(-dt / 2))) / this.metres;
  }

  /**
   * Riders cooling down ride in single file down each edge, COOL_GAP apart: one who took the flag
   * just behind another on the same edge eases off behind them instead of riding through them.
   * Each is held at the lesser of where they would be and where the rider ahead allows, but never
   * back over the line, so nobody ever rolls backwards.
   */
  private coolDown(poses: RiderPose[], t: number): void {
    const plan = this.finishes();
    const gap = COOL_GAP / this.lapUnits;
    const done = poses.filter((q) => q.state === 'finished' && plan.has(q.id)).sort((a, b) => plan.get(a.id)!.t1 - plan.get(b.id)!.t1);
    const ahead = new Map<number, RiderPose>();
    for (const q of done) {
      const f = plan.get(q.id)!;
      const lead = ahead.get(f.edge);
      if (lead) q.dist = Math.min(q.dist, Math.max(f.d1, lead.dist - gap));
      // One who took the flag just before, heading for the other edge, is still beside this one
      // while they both pull over: hold behind them for those seconds too, so they never ride
      // through each other on the way to their edges.
      const other = ahead.get(-f.edge);
      if (other && f.t1 - plan.get(other.id)!.t1 < COOL_SIDE && t - f.t1 < COOL_SIDE) q.dist = Math.min(q.dist, Math.max(f.d1, other.dist - gap));
      ahead.set(f.edge, q);
    }
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
    // Single file down the middle of a sprint's return lane, and straight off the start line.
    if (this.sprint && seg.si === 0) return 0;
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
    if (type === 'whoops' || type === 'rollers' || type === 'braking_bumps') return -0.2 * (1 - p.skim);
    // Enduro going: slowest picking through the middle of the rocks, roots and logs, and the climb steepest near its top.
    if (type === 'rocks' || type === 'roots' || type === 'logs' || type === 'woods' || type === 'water_crossing') return -0.25 * (1 - 0.5 * p.skim);
    if (type === 'hill_climb') return -0.2 * (1 - p.drive);
    return 0;
  }

  /** The section ridden in a stretch; -1 is the start straight, ridden as a start, -2 its end, the first corner. */
  private section(si: number): Pick<TrackSection, 'type' | 'height' | 'line'> {
    return si === -2 ? { type: 'first_corner' } : si < 0 ? { type: 'start_gate' } : this.track.sections[si];
  }

  private turn(si: number): number {
    return si < 0 ? 0 : this.turns[si];
  }

  /** Where in a section a mistake happens: on landing for a jump, otherwise part way through. */
  private mistakeAt(p: RiderProfile, seg: Seg): number {
    if (!seg.mistake) return 1;
    if (this.loopsOut(p, seg)) return clamp(LOOP_METRES / Math.max(1e-6, (seg.d1 - seg.d0) * this.metres), 0, 0.5);
    const type = this.section(seg.si).type;
    if (HOP_JUMPS.has(type)) return landingOf(this.way(p, seg)) ?? LANDING;
    return 0.35 + 0.3 * frac(p.seed * 7 + seg.si * 0.37 + seg.lap * 0.13);
  }

  /**
   * A crash on the start straight shown as a loop-out (Boss, 30 Oct 2026): the rider pulls such a
   * big wheelie out of the gate that the bike goes over backwards and they come off the back.
   * The referee (race.ts, sim.loopOut) says who and how long it costs.
   */
  private loopsOut(_p: RiderProfile, seg: Seg): boolean {
    return seg.si === -1 && !!seg.mistake?.loop;
  }

  /**
   * The way a rider takes a jump section on a lap: drawn once from their seed, the lap and the
   * section by their jumping (jumps.ts pickWay); a mistake there comes up short. Null off jumps.
   */
  private way(p: RiderProfile, seg: Seg): Way | null {
    if (seg.si < 0) return null;
    const key = `${p.id}|${seg.lap}|${seg.si}`;
    const got = this.ways.get(key);
    if (got !== undefined) return got;
    const type = this.track.sections[seg.si].type;
    let way: Way | null = null;
    if (HOP_JUMPS.has(type)) {
      const r = frac(p.seed * 31.7 + seg.lap * 0.618 + seg.si * 0.3819);
      // The showman goes big, so there are always hops to throw tricks off (only the view; the referee sets the time).
      const jumping = this.showsOff(p) ? Math.max(p.jump, SHOWMAN_JUMP) : p.jump;
      way = pickWay(type, jumping, r, !!seg.mistake);
      // A rider who would have thrown a trick off the last hop of their usual way overdoes it
      // there instead of coming up short: the mistake is the trick gone wrong.
      if (seg.mistake) {
        const usual = pickWay(type, jumping, r);
        const last = usual ? usual.hops.length - 1 : -1;
        if (usual && last >= 0 && this.hopTrick(p, seg, usual, last)) way = usual;
      }
    }
    this.ways.set(key, way);
    return way;
  }

  /** The field's showman, who goes big and throws tricks on most big hops. */
  private showsOff(p: RiderProfile): boolean {
    return p.id === this.showman;
  }

  /** The trick a rider would throw on hop i of a way through a section (tricks.ts), before any mistake. */
  private hopTrick(p: RiderProfile, seg: Seg, way: Way, i: number): Trick | null {
    const [a, b] = way.hops[i];
    const metres = (b - a) * (this.bounds[seg.si + 1] - this.bounds[seg.si]) * this.metres;
    const next = this.turns.slice(seg.si + 1).find((t) => t !== 0) ?? this.turns.find((t) => t !== 0) ?? 0;
    return trickFor(p, this.showsOff(p), seg.lap, seg.si, i, metres, next);
  }

  /** A rider's tricks over each hop of their way through a section; the last is overdone (bail) on a mistake. */
  private tricksOn(p: RiderProfile, seg: Seg, way: Way): (Trick | null)[] {
    const key = `${p.id}|${seg.lap}|${seg.si}`;
    const got = this.tricks.get(key);
    if (got) return got;
    const out = way.short ? way.hops.map(() => null) : way.hops.map((_, i) => this.hopTrick(p, seg, way, i));
    const last = out.length - 1;
    if (seg.mistake && last >= 0 && out[last]) out[last] = { ...out[last]!, bail: true };
    this.tricks.set(key, out);
    return out;
  }

  /** A rider's flight plan through a section and the one after it, as lap fractions, or null with no hops. */
  private flight(p: RiderProfile, seg: Seg, list: Seg[], i: number): Flight | null {
    const hops: [number, number][] = [];
    const tricks: (Trick | null)[] = [];
    for (const sg of [seg, list[i + 1]]) {
      if (!sg || sg.si < 0 || sg.lap !== seg.lap) continue;
      const way = this.way(p, sg);
      if (!way) continue;
      const f0 = this.bounds[sg.si];
      const span = this.bounds[sg.si + 1] - f0;
      for (const [a, b] of way.hops) hops.push([f0 + a * span, f0 + b * span]);
      tricks.push(...this.tricksOn(p, sg, way));
    }
    if (!hops.length) return null;
    const flight: Flight = { hops, launch: 1 - 0.45 * p.scrub };
    if (tricks.some(Boolean)) flight.tricks = tricks;
    return flight;
  }

  /** How high the rider is off the ground (metres) and how high the ground is (hills), at lap fraction f. */
  private height(p: RiderProfile, type: string, set: number | undefined, u: number, f: number, flight: Flight | null, stopped: boolean): { air: number; elev: number } {
    const h = set ?? DEFAULT_HEIGHTS[type] ?? 0;
    let air = 0;
    let elev = 0;
    if (!stopped) {
      const fly = this.surface.flightY(f, 0, flight);
      if (fly !== null) air = Math.max(0, this.surface.metresOf(fly - this.surface.height(f, 0)));
      else if (type === 'whoops') air = h * (1 - p.skim) * Math.abs(Math.sin(u * Math.PI * 10));
      else if (type === 'rollers') air = 0.3 * h * (1 - p.skim) * Math.abs(Math.sin(u * Math.PI * 4));
      else if (type === 'braking_bumps') air = 0.15 * (1 - p.skim) * Math.abs(Math.sin(u * Math.PI * 14));
      // The bike bucks over rocks and roots, and the front wheel lifts over each log.
      else if (type === 'rocks' || type === 'roots') air = 0.12 * (1 - 0.6 * p.skim) * Math.abs(Math.sin(u * Math.PI * (type === 'rocks' ? 17 : 11) + p.seed * 9));
      else if (type === 'logs' || type === 'log_step') air = 0.2 * h * sectionShape(type, Math.min(1, u + 0.02));
    }
    if (HILLS.has(type)) elev = h * (type === 'hill_climb' ? sectionShape(type, u) : Math.sin(Math.PI * u));
    return { air, elev };
  }

  /** The player pulled off part way round: they stop where they are, not at the end of the lap. */
  private pulledOff(id: string, list: Seg[], t: number): RiderPose | null {
    const at = this.pulled.get(id);
    if (at === undefined || t < at) return null;
    const where = this.pose(id, list, at, false);
    const side = where.lane >= 0 ? 1 : -1;
    return { ...where, lane: side * Math.max(Math.abs(where.lane), 1 + 0.45 * smooth((t - at) / 2)), air: 0, flight: null, state: 'retired', speed: 0 };
  }

  /** Riders side by side ease apart so they don't ride through each other. */
  private keepApart(poses: RiderPose[]): void {
    const racing = poses.filter((q) => q.state !== 'grid' && q.state !== 'retired' && !q.hidden).sort((a, b) => b.dist - a.dist);
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
        // The rider behind gives most of the room, but a rider cooling down after the flag gives
        // way to anyone still racing.
        const give = a.state === 'finished' && b.state !== 'finished' ? 0.2 : 0.7;
        b.lane = clamp(b.lane + dir * push * give, -1, 1);
        a.lane = clamp(a.lane - dir * push * (1 - give), -1, 1);
      }
    }
  }
}

/** A director for a moto: every rider's profile from their skills, bike and message at the start. */
export function directorFor(sim: MotoSim, bikes: BikesData, messages: MessageDef[], pickOrder?: string[]): RaceDirector {
  const ceiling = bikes.classes.find((c) => c.id === sim.classId)?.ceiling ?? 1;
  const profiles = new Map<string, RiderProfile>();
  const gates = new Map<string, number>();
  for (const r of sim.riders) {
    profiles.set(r.e.id, riderProfile(r.e, r.stats, ceiling, messages.find((m) => m.id === r.message)));
    gates.set(r.e.id, r.e.gate);
  }
  return new RaceDirector(sim.track, profiles, gates, sim.totalLaps, pickOrder, sim.opts.interval ?? 0);
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
  if (!HILLS.has(sec.type)) return 0;
  const u = (at - bounds[si]) / Math.max(1e-9, bounds[si + 1] - bounds[si]);
  return (sec.height ?? DEFAULT_HEIGHTS[sec.type]) * (sec.type === 'hill_climb' ? sectionShape(sec.type, u) : Math.sin(Math.PI * u));
}
