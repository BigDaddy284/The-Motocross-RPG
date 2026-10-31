import { bikeStats, type Bike, type BikesData } from './career';
import { firstCorner, isSprint, lapPlan, RETURN_LANE, sectionBounds, SPRINT_QUEUE, startGeom, type DrawnShape, type FirstCorner, type StartGeom } from './trackGeom';
import type { RiderStyle } from './riderProfile';
import { sectionGrades, type TrackElevation, type TrackHill } from './elevation';

// The race simulation (Spec 10, GDD 11). Pure rules with no graphics: the race screen plays a
// lap's results out section by section, and auto-complete just runs the laps straight through,
// so both use exactly the same engine (agreed). Everything random comes from the race's seed: each
// rider draws from their own seeded generator each lap, in a fixed order, so the same seed and the
// same held message always give the same race, and a change one rider makes only changes the lap
// for riders who meet them afterwards (redoLap).

export interface SectionDef {
  name: string;
  diff: number;
  /** Rider skills the section uses, with weights adding up to 1. */
  skills: Record<string, number>;
  /** Bike stats the section uses, weighted equally. */
  stats: string[];
  /** Share of the section's result from the rider; the rest is the bike. */
  riderWeight: number;
  /** Which group of parts a crash here damages. */
  damage: string;
  /** The drawn shapes the section was meant for (trackGeom.drawnShape), as a hint; any type can be placed on any shape. */
  shapes?: DrawnShape[];
}

export interface SprintRules {
  interval: number;
  returnSpeed: number;
}

export interface KnockoutRules {
  /** Seconds between riders leaving the gate on the seeding run. */
  seedInterval: number;
  /** Riders in a heat: one per gate. */
  heatSize: number;
  /** Riders from each heat who go through to the next round. */
  through: number;
  /** Runs in the final, scored on points. */
  finalRuns: number;
  /**
   * Every CPU rider made this share better (skills and bike condition), as in a championship, so
   * the knockout is as hard to win as a race day at the same level (Boss, 30 Oct 2026: late game).
   */
  buff: number;
  /** The share of the sim's noise on a knockout run (MotoOptions.noiseScale). */
  noise: number;
}

/** A knockout's rules when racing.json leaves them out. */
export const KNOCKOUT_DEFAULTS: KnockoutRules = { seedInterval: 8, heatSize: 4, through: 2, finalRuns: 3, buff: 0, noise: 1 };

/** A sprint's rules when racing.json leaves them out. */
export const SPRINT_DEFAULTS: SprintRules = { interval: 10, returnSpeed: 0.5 };

export interface MistakeOutcome {
  id: 'small' | 'big' | 'minor_crash' | 'serious_crash';
  share: number;
  timePct?: [number, number];
  seconds?: [number, number];
  crash?: boolean;
  serious?: boolean;
}

export interface MessageDef {
  id: string;
  name: string;
  pace: number;
  risk: number;
  overtaking: number;
  consistency: number;
  desc: string;
}

export interface ClassRules {
  laps: number;
  /** Entry fee in pounds. */
  entry: number;
  classXp: number;
  /** Reference speed in metres per second: a section's base time is its length over this. */
  refSpeed: number;
  youth: boolean;
}

export interface RacingData {
  sim: {
    spread: number;
    noise: number;
    consistencyNoiseCut: number;
    mistakeBase: number;
    mistakeConsistencyCut: number;
    outcomes: MistakeOutcome[];
    agilityRecoveryCut: number;
    passWindow: number;
    failedPassCost: [number, number];
    blockedGap: number;
    rutPerMoto: number;
    rutSections: string[];
    cleanAir: { top: number; bonusPct: number; trafficAfter: number; penaltyPct: number };
    retireAtBroken: number;
    /**
     * First-corner incidents: on lap 1, in the lap's first corner, this chance that a crash takes
     * riders down, how many at least and at most. Who goes down is drawn at random from the whole
     * field, so it is never every race and never always the same rider.
     */
    firstCorner?: { chance: number; riders: [number, number] };
    /**
     * A loop-out (Boss, 30 Oct 2026): on lap 1 of a race, this chance that one rider pulls such a
     * big wheelie out of the gate that the bike goes over backwards, a crash on the start straight.
     * The weaker a rider's starts, the likelier it is them.
     */
    loopOut?: { chance: number };
    /** A crash collecting riders close behind: each rider arriving within `window` seconds has this chance of going down too, up to `most` of them. */
    pileup?: { chance: number; window: number; most: number };
    /**
     * Fitness in the lap time (Spec 3.4, Boss 29 Oct 2026), each at level 99: Strength is roughPct
     * faster through rough sections and strengthLatePct late in the moto, Endurance enduranceLatePct
     * late in the moto (fading less). Late ramps in over the second half. All of it is capped at capPct.
     */
    fitness?: { roughPct: number; rough: string[]; strengthLatePct: number; enduranceLatePct: number; capPct: number };
    /** Enduro sprints (trackGeom.isSprint): seconds between riders leaving the start line, and the return lane's speed as a share of the class's reference speed. */
    sprint?: SprintRules;
    /** No-Turn Takedown knockouts (core/knockout.ts): the seeding run's interval, heat size, riders through from each heat and the final's runs. */
    knockout?: KnockoutRules;
  };
  xp: {
    sectionFactor: number;
    practiceFactor: number;
    finishBonus: number;
    positionStep: number;
    positionFloor: number;
    overtakeXp: number;
    consistencyWeight: number;
  };
  classes: Record<string, ClassRules>;
  /**
   * Laps per moto by track kind (Boss, 29 Oct 2026: endurance races are 8 laps), in place of the
   * class's laps. championship is the same for championship rounds (motocross rounds are 8 laps).
   * A kind left out uses the class's laps.
   */
  kindLaps?: { race?: Record<string, number>; championship?: Record<string, number> };
  messages: MessageDef[];
  messageEffects: {
    pacePct: number;
    paceMistakes: number;
    riskPass: number;
    riskCrashShare: number;
    overtakingEager: number;
    consistencyNoise: number;
    consistencyTimePct: number;
  };
  ink: number;
  sections: Record<string, SectionDef>;
  damageSlots: Record<string, string[]>;
  wear: {
    lifespanKm: Record<string, number>;
    youth: number;
    lowAt: number;
    lowBase: number;
    lowSlope: number;
    knockLow: number;
    knockBroken: number;
    breakAtFull: number;
    breakAtLow: number;
    minorCrashLoss: number;
  };
  points: number[];
  prize: { winnerTimesEntry: number; shares: number[]; podium: number[] };
}

export interface TrackSection {
  type: string;
  length: number;
  passing: number;
  /** The line most riders take through it (trackParts.json lines); the race view only. */
  line?: string;
  /** Height in metres of the jump face or hill, for the race view. */
  height?: number;
  /**
   * A tunnel through a jump's deck (tabletop, step-up, step-on): 'track' where another part of
   * the lap passes under it, 'walk' for a pedestrian tunnel through it (trackSurface.ts).
   */
  tunnel?: 'track' | 'walk';
  /** A finish-line jump (tabletop or double): the lap's first section, with the finish arch built over it (jumps.ts ARCH_AT). */
  finish?: true;
}

/** A stretch of the lap with a different surface, in metres from the start line (race view only). */
export interface SurfacePatch {
  surface: string;
  at: number;
  length: number;
}

/** A piece of scenery on the 100 × 60 track grid (race view only). */
export interface SceneryItem {
  type: string;
  x: number;
  y: number;
  /** A cheering fan's body shape and what they do when a bike passes (cheer.ts); picked for them when left out. */
  variant?: string;
  action?: string;
  /** Size on the grid; the scenery type's default when left out. */
  w?: number;
  h?: number;
  /** Turned this many degrees clockwise. */
  rot?: number;
  text?: string;
  color?: string;
  /** A start official (start_official) only: the walk from where they stand to where they end up, as grid points after their own. */
  route?: [number, number][];
}

/** The start straight from the gate to the lap, on the 100 × 60 track grid. */
export interface TrackStart {
  path: [number, number][];
  /** Passing chance on it, as for a section; 0.6 when left out. */
  passing?: number;
}

/** Ground round the track: a base ground and painted cells of cell × cell grid units, by ground id. */
export interface TrackGround {
  base: string;
  cell: number;
  paint: Record<string, [number, number][]>;
}

export interface TrackDef {
  id: string;
  name: string;
  size: string;
  surface: string;
  practiceOnly?: boolean;
  /** Gate bonus in percent of start time, best gate first. */
  gates?: number[];
  /** The shape drawn on the race screen, on a 100 × 60 grid, starting at the finish line (the first point), where every lap starts and ends. */
  path: [number, number][];
  /** False only on an unfinished track in the track editor whose finish line hasn't been placed yet (the game leaves drafts out); a finished track's finish line is always its first point. */
  finish?: false;
  sections: TrackSection[];
  /** stadium, outdoor or endurance (trackParts.json kinds); outdoor when left out. */
  kind?: string;
  /** Track width in grid units on the race view; 3.4 when left out. */
  width?: number;
  patches?: SurfacePatch[];
  ground?: TrackGround;
  /** The start straight: the gate first, its last point on the lap where it joins (trackGeom.startGeom). */
  start?: TrackStart;
  scenery?: SceneryItem[];
  /** Raised and lowered ground under and round the track (elevation.ts); flat when left out. */
  elevation?: TrackElevation;
  /** Hills and dips along the track from the editor's elevation tool (elevation.ts); none when left out. */
  hills?: TrackHill[];
  /** The track editor's route: its control points ([x, y], with curve handles after), from which `path` is drawn. */
  layout?: { points: number[][] };
}

export interface Tactic {
  message: string;
  /** Switch to PUSH this many laps from the end, if within pushGap seconds of the rider ahead. */
  push?: number;
  pushGap?: number;
}

export interface Entrant {
  id: string;
  name: string;
  tag?: string;
  /** Their own race kit on the race screen (CpuRiderDef.kit). */
  kit?: string;
  player: boolean;
  /** Child skill levels. */
  skills: Record<string, number>;
  /**
   * The player only, once the Rider Trainer has taught whips and scrubs (TRICKS_FLAG): their Rider
   * Ability level, which sets how often they throw them on the race screen (tricks.ts). Left out until then.
   */
  riderLevel?: number;
  bike: Bike;
  tactic: Tactic;
  /** Gate number from 0, best first. Lap 1 starts in gate order; in a sprint, the order riders leave the start line. */
  gate: number;
  /** How they ride on the race screen (riderProfile.ts); never changes a result. */
  style?: RiderStyle;
  /**
   * Practice only: when the rider set off from the gate, in seconds from the session's start. A
   * rider already out on track when you arrive set off before 0.
   */
  startAt?: number;
}

/** Events name the section by index; -1 is the start straight. */
export type RaceEvent =
  | { kind: 'pass'; t: number; rider: string; other: string; section: number }
  | { kind: 'failedPass'; t: number; rider: string; other: string; section: number }
  | { kind: 'mistake'; t: number; rider: string; section: number; outcome: MistakeOutcome['id']; lost: number; damaged: string[]; /** The rider whose crash this one went down in, or 'first_corner' for a first-corner incident, or 'loop_out' for a loop-out out of the gate. */ with?: string }
  | { kind: 'breakdown'; t: number; rider: string; section: number; slot: string }
  | { kind: 'retire'; t: number; rider: string; reason: string };

export interface LapTrace {
  lap: number;
  /** Race distance in laps at each timing point: the start of the lap, then the end of each stretch (trackGeom.lapPlan). */
  marks: number[];
  /** The section ridden in each stretch, in order; -1 is the start straight. */
  secs: number[];
  /** Per rider: the race time at each of the marks (fewer for a rider who dropped out). */
  times: Record<string, number[]>;
  events: RaceEvent[];
}

export interface RiderResult {
  id: string;
  name: string;
  tag?: string;
  player: boolean;
  position: number;
  laps: number;
  time: number;
  bestLap: number | null;
  retired: boolean;
  reason?: string;
  gap: string;
}

interface RiderState {
  e: Entrant;
  time: number;
  laps: number;
  lapTimes: number[];
  /** A sprint's timed test laps added up: the race time that counts (results' time). 0 on other tracks. */
  sprintTime: number;
  message: string;
  stats: Record<string, number>;
  broken: number;
  retired: boolean;
  reason?: string;
}

/** What a lap changes, kept from before it so it can be run again. */
interface LapStart {
  lapNo: number;
  passes: number;
  xp: Record<string, number>;
  parts: Bike['parts'];
  riders: Pick<RiderState, 'time' | 'laps' | 'lapTimes' | 'sprintTime' | 'message' | 'stats' | 'broken' | 'retired' | 'reason'>[];
  lastAway: number;
}

export interface MotoOptions {
  laps: number | null;
  /** Motos already run at this venue today, for ruts (Spec 10.3). */
  motoIndex: number;
  seed: number;
  practice?: boolean;
  /** The player's message at the start; it costs no ink. */
  message?: string;
  /** Retire automatically at this many broken parts (auto-complete option). */
  retireAtBroken?: number;
  /**
   * A staggered start (a No-Turn Takedown's seeding run): riders leave the gate this many seconds
   * apart in gate order, each on their own, timed from when they go. No clean air or traffic.
   */
  interval?: number;
  /**
   * A share of the sim's noise (1 when left out). A knockout run is a handful of sections, so it
   * rides with less noise to stay as much a test of skill as a moto of many laps.
   */
  noiseScale?: number;
}

/** A small seeded generator (mulberry32), so a race can be replayed exactly. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mixSeed(seed: number, n: number): number {
  return (Math.imul(seed ^ (n + 0x9e3779b9), 0x85ebca6b) ^ (seed >>> 13)) >>> 0;
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

export class MotoSim {
  readonly riders: RiderState[];
  readonly player: RiderState | undefined;
  /** Message changes left on the pen (Spec 11.3). */
  ink: number;
  /** XP the player has earned so far, per child skill, before the finishing bonus. */
  readonly xp: Record<string, number> = {};
  /** How many passes the player made. */
  passes = 0;
  /** The player's bike, wearing as it goes. The caller copies it back afterwards. */
  readonly playerBike: Bike | null;
  /** The generator of the rider being worked out now (nextLap points it at each rider's own). */
  private rng: () => number;
  private readonly cls: ClassRules;
  private readonly ceiling: number;
  private lapNo = 0;
  private readonly bounds: number[];
  /** How the ground's climbs and drops stretch or shorten each section's time (elevation.ts). */
  private readonly grades: number[];
  private readonly start: StartGeom;
  /** The first corner: the start straight's end, between its last two points (trackGeom.firstCorner), or null with no start straight. */
  readonly firstCorner: FirstCorner | null;
  /** Everything a lap changes, as it was before the latest lap, so it can be run again (redoLap). */
  private before: LapStart | null = null;
  /** An enduro sprint: riders leave the start line one at a time and the timed tests add up. */
  readonly sprint: boolean;
  readonly sprintRules: SprintRules;
  /** A sprint: when the last rider to leave the start line left it, so the next waits the interval after them. */
  private lastAway = 0;

  constructor(
    private readonly racing: RacingData,
    private readonly bikes: BikesData,
    readonly track: TrackDef,
    readonly classId: string,
    entrants: Entrant[],
    readonly opts: MotoOptions,
  ) {
    this.rng = seededRng(opts.seed);
    this.bounds = sectionBounds(track);
    this.grades = sectionGrades(track);
    this.start = startGeom(track);
    this.firstCorner = firstCorner(this.start);
    this.cls = racing.classes[classId];
    this.ceiling = bikes.classes.find((c) => c.id === classId)?.ceiling ?? 1;
    this.sprint = isSprint(track);
    this.sprintRules = { ...SPRINT_DEFAULTS, ...racing.sim.sprint };
    this.ink = racing.ink;
    const mine = entrants.find((e) => e.player);
    this.playerBike = mine ? structuredClone(mine.bike) : null;
    this.riders = entrants.map((e) => {
      const bike = e.player ? this.playerBike! : e.bike;
      return {
        e: { ...e, bike },
        // A sprint sends riders off the start line in their start order, the interval apart.
        time: opts.practice ? (e.startAt ?? 0) : this.sprint ? e.gate * this.sprintRules.interval : opts.interval ? e.gate * opts.interval : 0,
        laps: 0,
        lapTimes: [],
        sprintTime: 0,
        message: e.player ? (opts.message ?? 'steady') : e.tactic.message,
        stats: bikeStats(bikes, bike),
        broken: Object.values(bike.parts).filter((p) => p.condition <= 0).length,
        retired: false,
      };
    });
    this.player = this.riders.find((r) => r.e.player);
    this.lastAway = Math.max(0, ...this.riders.map((r) => r.time));
  }

  get lap(): number {
    return this.lapNo;
  }

  get totalLaps(): number | null {
    return this.opts.laps;
  }

  get finished(): boolean {
    // Practice is over for everyone once the rider's own bike gives out, whoever else is still out.
    return (this.opts.laps !== null && this.lapNo >= this.opts.laps) || this.riders.every((r) => r.retired) || (!!this.opts.practice && !!this.player?.retired);
  }

  get playerMessage(): string {
    return this.player?.message ?? 'steady';
  }

  /** Changes the player's message from the next lap. Uses one ink; keeping the message is free. */
  changeMessage(id: string): boolean {
    if (!this.player || id === this.player.message) return true;
    if (this.ink <= 0 || !this.racing.messages.some((m) => m.id === id)) return false;
    this.ink -= 1;
    this.player.message = id;
    return true;
  }

  /** "It's Over, Bike Blown": the player pulls off. Never uses ink. */
  retirePlayer(reason = 'Retired'): void {
    if (this.player && !this.player.retired) {
      this.player.retired = true;
      this.player.reason = reason;
    }
  }

  /**
   * Runs the latest lap again from where it started, after `change` (a new message, or retiring),
   * for a pit board read as the player crosses the line, after the leader has already started that
   * lap. Riders who reached the line before the player ride it exactly as before: their draws are
   * their own, and the player only touches riders who are behind them at some point of the lap.
   */
  redoLap(change: () => void): LapTrace {
    const b = this.before;
    if (!b) throw new Error('No lap to run again');
    this.lapNo = b.lapNo;
    this.passes = b.passes;
    for (const k of Object.keys(this.xp)) delete this.xp[k];
    Object.assign(this.xp, b.xp);
    if (this.playerBike) this.playerBike.parts = structuredClone(b.parts);
    this.riders.forEach((r, i) => Object.assign(r, { ...b.riders[i], lapTimes: [...b.riders[i].lapTimes] }));
    this.lastAway = b.lastAway;
    change();
    return this.nextLap();
  }

  /** Simulates the next lap for every rider still racing. */
  nextLap(): LapTrace {
    this.before = {
      lapNo: this.lapNo,
      passes: this.passes,
      xp: { ...this.xp },
      parts: this.playerBike ? structuredClone(this.playerBike.parts) : {},
      riders: this.riders.map((r) => ({ time: r.time, laps: r.laps, lapTimes: [...r.lapTimes], sprintTime: r.sprintTime, message: r.message, stats: r.stats, broken: r.broken, retired: r.retired, reason: r.reason })),
      lastAway: this.lastAway,
    };
    const lap = ++this.lapNo;
    const { sim } = this.racing;
    const active = this.riders.filter((r) => !r.retired);
    // Each rider's own draws for this lap.
    const draws = new Map(this.riders.map((r, i) => [r, seededRng(mixSeed(this.opts.seed, lap * 256 + i))]));
    const plan = lapPlan(this.track, lap, this.bounds, this.start);
    const trace: LapTrace = { lap, marks: plan.marks, secs: plan.secs, times: {}, events: [] };
    for (const r of active) {
      trace.times[r.e.id] = [r.time];
      if (!r.e.player) r.message = this.cpuMessage(r);
    }
    // Riding order entering the lap: the gate order on lap 1, then race order (in practice, the
    // order riders set off in, then the gate).
    let order = [...active].sort((a, b) => (lap === 1 ? a.time - b.time || a.e.gate - b.e.gate : a.time - b.time));
    const air = new Map<RiderState, number>();
    const startTimes = new Map(active.map((r) => [r, r.time]));
    const cur = new Map(active.map((r) => [r, r.time]));
    const out = new Set<RiderState>();
    // A first-corner incident on lap 1: the lap's own draw picks whether, how many and who.
    const lapRng = seededRng(mixSeed(this.opts.seed, lap * 256 + 255));
    const incident = new Set<RiderState>();
    const fc = sim.firstCorner;
    // The first corner is the start straight's end (lapPlan's stretch -2): the incident happens
    // there, on lap 1 of a race. A track without a start straight has no first corner.
    const firstCornerLeg = lap === 1 && fc && !this.opts.practice ? plan.secs.indexOf(-2) : -1;
    if (firstCornerLeg >= 0 && fc && lapRng() < fc.chance) {
      const pool = [...active];
      const n = Math.min(pool.length, fc.riders[0] + Math.floor(lapRng() * (fc.riders[1] - fc.riders[0] + 1)));
      for (let i = 0; i < n; i++) incident.add(pool.splice(Math.floor(lapRng() * pool.length), 1)[0]);
    }
    // A loop-out out of the gate on lap 1, from its own draw so the first-corner draws stay as they were.
    const startLeg = lap === 1 && sim.loopOut && !this.opts.practice && !this.sprint ? plan.secs.indexOf(-1) : -1;
    let looper: RiderState | null = null;
    if (startLeg >= 0) {
      const loopRng = seededRng(mixSeed(this.opts.seed, lap * 256 + 254));
      if (loopRng() < sim.loopOut!.chance && active.length) {
        const weight = (r: RiderState) => 1.15 - (r.e.skills.starts ?? 1) / 99;
        let x = loopRng() * active.reduce((a, r) => a + weight(r), 0);
        looper = active.find((r) => (x -= weight(r)) < 0) ?? active[active.length - 1];
        incident.delete(looper);
      }
    }

    // A sprint times each test from when the rider leaves the start line.
    const away = new Map(active.map((r) => [r, r.time]));

    plan.secs.forEach((si, leg) => {
      if (this.sprint && (si === SPRINT_QUEUE || this.track.sections[si]?.type === RETURN_LANE)) {
        order = this.sprintTransit(si, plan.metres[leg], order, cur, away, out);
        for (const r of order) trace.times[r.e.id].push(cur.get(r)!);
        return;
      }
      // The start straight rides as a start (gate bonus, start skills) in a race, in practice as a
      // straight; its end rides as the first corner. A lap section left as a first corner from
      // before (the first corner is no longer a section) rides as a flat corner.
      const full = si === -2
        ? { type: 'first_corner', length: plan.metres[leg], passing: this.track.start?.passing ?? 0.6 }
        : si < 0 ? { type: 'start_gate', length: plan.metres[leg], passing: this.track.start?.passing ?? 0.6 } : this.track.sections[si];
      const sec = { ...full, length: plan.metres[leg] };
      const isStart = si === -1 && !this.opts.practice;
      const def = this.racing.sections[sec.type === 'start_gate' && !isStart ? 'straight' : sec.type === 'first_corner' && si >= 0 && this.racing.sections.flat_corner ? 'flat_corner' : sec.type];
      // A section joined part way through on lap 1 is only partly ridden, with fewer chances to slip.
      const share = Math.min(1, sec.length / Math.max(1e-9, full.length));
      const done: RiderState[] = [];
      // Crashes in this stretch so far: who went down and when, for riders close behind to be caught up in.
      const crashes: { r: RiderState; at: number; took: number }[] = [];
      for (const r of order) {
        if (out.has(r)) continue;
        this.rng = draws.get(r)!;
        // A start one at a time (a No-Turn Takedown's seeding run) has no gate to gain or lose on.
        let t = this.sectionTime(r, sec, def, isStart && !this.opts.interval ? r.e.gate : -1) * (air.get(r) ?? 1) * (si >= 0 ? this.grades[si] : 1);
        let m = this.mistake(r, def, share);
        let withWhom: string | undefined;
        if (leg === startLeg && r === looper) {
          m = this.crashOutcome();
          withWhom = 'loop_out';
        } else if (!m?.crash && leg === firstCornerLeg && incident.has(r)) {
          m = this.crashOutcome();
          withWhom = 'first_corner';
        } else if (!m?.crash && sim.pileup && si >= 0) {
          const here = cur.get(r)! + t;
          const c = crashes.find((c) => c.took < sim.pileup!.most && Math.abs(here - c.at) <= sim.pileup!.window);
          if (c && this.rng() < sim.pileup.chance) {
            c.took++;
            m = this.crashOutcome();
            withWhom = c.r.e.id;
          }
        }
        if (m) {
          const at = cur.get(r)! + t;
          const lost = m.timePct ? t * (m.timePct[0] + this.rng() * (m.timePct[1] - m.timePct[0])) / 100 : this.crashSeconds(r, m);
          t += lost;
          const damaged = m.crash ? this.crashDamage(r, def, !!m.serious) : [];
          if (m.crash) crashes.push({ r, at, took: 0 });
          trace.events.push({ kind: 'mistake', t: cur.get(r)! + t, rider: r.e.id, section: si, outcome: m.id, lost, damaged, ...(withWhom ? { with: withWhom } : {}) });
        }
        let arrival = cur.get(r)! + t;
        // Passing: anyone ahead who would now arrive later has to be passed (Spec 10.3).
        for (let i = done.length - 1; i >= 0; i--) {
          const q = done[i];
          const qa = cur.get(q)!;
          if (qa <= arrival) continue;
          if (sec.passing > 0 && this.rng() < this.passChance(r, q, def, sec.passing)) {
            trace.events.push({ kind: 'pass', t: arrival, rider: r.e.id, other: q.e.id, section: si });
            if (r.e.player) {
              this.passes += 1;
              this.gain({ overtaking: this.racing.xp.overtakeXp * this.cls.classXp });
            }
          } else {
            const [lo, hi] = sim.failedPassCost;
            arrival = qa + (sec.passing > 0 ? lo + this.rng() * (hi - lo) : sim.blockedGap);
            if (sec.passing > 0 && qa - (cur.get(r)! + t) < sim.passWindow) trace.events.push({ kind: 'failedPass', t: arrival, rider: r.e.id, other: q.e.id, section: si });
          }
        }
        cur.set(r, arrival);
        done.push(r);
        if (r.e.player) this.sectionXp(def, sec, !m);
        if (this.mustRetire(r)) {
          r.retired = true;
          r.reason = r.reason ?? 'Too much damage';
          out.add(r);
          trace.events.push({ kind: 'retire', t: arrival, rider: r.e.id, reason: r.reason });
        }
      }
      for (const r of done) trace.times[r.e.id].push(cur.get(r)!);
      order = done.slice().sort((a, b) => cur.get(a)! - cur.get(b)!);
      // Clean air and traffic after the first stretch of the lap the field joins on lap 1 (Spec 10.4).
      // A sprint has no pack to get clear of.
      if (lap === 1 && leg === Math.min(1, plan.secs.length - 1) && !this.opts.practice && !this.sprint && !this.opts.interval) {
        const ca = sim.cleanAir;
        order.forEach((r, i) => {
          if (i < ca.top) air.set(r, 1 - ca.bonusPct / 100);
          else if (i >= ca.trafficAfter) air.set(r, 1 + ca.penaltyPct / 100);
        });
      }
    });

    for (const r of active) {
      if (out.has(r)) continue;
      r.time = cur.get(r)!;
      r.laps += 1;
      // A sprint lap's time is the timed test alone, from leaving the start line to the finish line.
      const lapTime = r.time - (this.sprint ? away.get(r)! : startTimes.get(r)!);
      r.lapTimes.push(lapTime);
      if (this.sprint) r.sprintTime += lapTime;
    }
    if (this.player) this.rng = draws.get(this.player)!;
    if (this.player && !this.player.retired && active.includes(this.player)) this.wearPlayer(trace, plan.metres.reduce((a, m) => a + m, 0) / 1000);
    return trace;
  }

  /**
   * A sprint's untimed stretches, which nobody races: the roll down the return lane at the
   * return speed, single file in the order riders finished, and the queue at the start line,
   * where each rider leaves in the order they got there, the interval after the rider before
   * (lastAway carries on from lap to lap, so a lap's first rider waits on the last lap's last).
   * Returns the riding order after it.
   */
  private sprintTransit(si: number, metres: number, order: RiderState[], cur: Map<RiderState, number>, away: Map<RiderState, number>, out: Set<RiderState>): RiderState[] {
    const going = order.filter((r) => !out.has(r)).sort((a, b) => cur.get(a)! - cur.get(b)!);
    let prev = -Infinity;
    for (const r of going) {
      if (si === SPRINT_QUEUE) {
        const at = Math.max(cur.get(r)!, this.lastAway + this.sprintRules.interval);
        this.lastAway = at;
        cur.set(r, at);
        away.set(r, at);
      } else {
        // Everyone rolls at the same speed, so nobody closes on the rider ahead; a rider who
        // finished right behind another still keeps a bike's gap.
        const at = Math.max(cur.get(r)! + metres / (this.cls.refSpeed * this.sprintRules.returnSpeed), prev + this.racing.sim.blockedGap);
        cur.set(r, at);
      }
      prev = cur.get(r)!;
    }
    return going;
  }

  /** Runs the rest of the moto with no changes, for auto-complete. */
  runToEnd(): LapTrace[] {
    const laps: LapTrace[] = [];
    while (!this.finished) laps.push(this.nextLap());
    return laps;
  }

  results(): RiderResult[] {
    // A sprint is won on the timed tests added up, not on who crosses the line first.
    const raced = (r: RiderState) => (this.sprint ? r.sprintTime : r.time);
    const sorted = [...this.riders].sort((a, b) => Number(a.retired) - Number(b.retired) || b.laps - a.laps || raced(a) - raced(b));
    const leader = sorted[0];
    return sorted.map((r, i) => ({
      id: r.e.id,
      name: r.e.name,
      tag: r.e.tag,
      player: r.e.player,
      position: i + 1,
      laps: r.laps,
      time: raced(r),
      bestLap: r.lapTimes.length ? Math.min(...r.lapTimes) : null,
      retired: r.retired,
      reason: r.reason,
      gap: i === 0 ? formatTime(raced(r)) : r.retired ? 'DNF' : r.laps < leader.laps ? `+${leader.laps - r.laps} lap${leader.laps - r.laps > 1 ? 's' : ''}` : `+${(raced(r) - raced(leader)).toFixed(1)}s`,
    }));
  }

  /** The player's finishing bonus (Spec 2.3), added once the moto is over. DNF gets none. */
  finishBonus(position: number): Record<string, number> {
    const x = this.racing.xp;
    if (!this.player || this.player.retired || this.opts.practice) return {};
    const factor = Math.max(x.positionFloor, 1 - x.positionStep * (position - 1));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.xp)) out[k] = v * x.finishBonus * factor;
    return out;
  }

  // ---- one section ----

  private performance(r: RiderState, def: SectionDef): number {
    let rider = 0;
    for (const [k, w] of Object.entries(def.skills)) rider += ((r.e.skills[k] ?? 1) / 99) * w;
    let bike = 0;
    for (const st of def.stats) bike += (r.stats[st] ?? 0) / this.ceiling / def.stats.length;
    return def.riderWeight * rider + (1 - def.riderWeight) * bike;
  }

  private message(r: RiderState): MessageDef {
    return this.racing.messages.find((m) => m.id === r.message) ?? this.racing.messages[0];
  }

  private difficulty(sec: TrackSection, def: SectionDef): number {
    const rut = this.racing.sim.rutSections.includes(sec.type) ? 1 + this.racing.sim.rutPerMoto * this.opts.motoIndex : 1;
    return def.diff * rut;
  }

  private sectionTime(r: RiderState, sec: TrackSection, def: SectionDef, gate: number): number {
    const { sim, messageEffects: me } = this.racing;
    const msg = this.message(r);
    const perf = this.performance(r, def);
    const base = sec.length / this.cls.refSpeed;
    const pace = 1 - (msg.pace * me.pacePct) / 100 + (msg.consistency * me.consistencyTimePct) / 100;
    const gateK = gate >= 0 ? 1 - gateBonus(this.track, gate) / 100 : 1;
    const cons = r.e.skills.consistency ?? 1;
    const sd = sim.noise * (this.opts.noiseScale ?? 1) * (1 - (sim.consistencyNoiseCut * cons) / 99) * Math.max(0.2, 1 - me.consistencyNoise * msg.consistency);
    const noise = Math.max(0.7, 1 + this.gauss() * sd);
    return base * this.difficulty(sec, def) * (1 - sim.spread * (perf - 0.5)) * pace * gateK * noise * (1 - this.fitnessCut(r, sec));
  }

  /** The share of a section's time a rider's Strength and Endurance take off (sim.fitness), never over its cap. */
  fitnessCut(r: RiderState, sec: TrackSection): number {
    const f = this.racing.sim.fitness;
    if (!f) return 0;
    const lvl = (k: string) => Math.max(0, (r.e.skills[k] ?? 1) - 1) / 98;
    const laps = this.opts.laps;
    const late = laps ? Math.max(0, Math.min(1, (this.lapNo / laps - 0.5) * 2)) : 0;
    const strength = lvl('strength') * ((f.rough.includes(sec.type) ? f.roughPct : 0) + f.strengthLatePct * late);
    const endurance = lvl('endurance') * f.enduranceLatePct * late;
    return Math.min(f.capPct, strength + endurance) / 100;
  }

  private mistake(r: RiderState, def: SectionDef, share = 1): MistakeOutcome | null {
    const { sim, messageEffects: me } = this.racing;
    const msg = this.message(r);
    const perf = this.performance(r, def);
    const cons = r.e.skills.consistency ?? 1;
    const p = share * sim.mistakeBase * def.diff * (1.4 - perf) * Math.max(0.2, 1 + me.paceMistakes * msg.pace) * (1 - (sim.mistakeConsistencyCut * cons) / 99);
    if (this.rng() >= p) return null;
    // Risk moves share from small errors to crashes.
    const crashScale = Math.max(0.2, 1 + me.riskCrashShare * msg.risk);
    const shares = sim.outcomes.map((o) => (o.crash ? o.share * crashScale : o.share));
    const total = shares.reduce((a, b) => a + b, 0);
    let roll = this.rng() * total;
    for (let i = 0; i < shares.length; i++) {
      roll -= shares[i];
      if (roll < 0) return sim.outcomes[i];
    }
    return sim.outcomes[0];
  }

  /** A crash outcome for a rider taken down by an incident: serious as often as serious crashes are among crashes. */
  private crashOutcome(): MistakeOutcome {
    const crashes = this.racing.sim.outcomes.filter((o) => o.crash);
    const total = crashes.reduce((a, o) => a + o.share, 0);
    let roll = this.rng() * total;
    for (const o of crashes) { roll -= o.share; if (roll < 0) return o; }
    return crashes[0] ?? this.racing.sim.outcomes[0];
  }

  private crashSeconds(r: RiderState, m: MistakeOutcome): number {
    const [lo, hi] = m.seconds ?? [5, 10];
    const agility = r.e.skills.agility ?? 1;
    return (lo + this.rng() * (hi - lo)) * (1 - (this.racing.sim.agilityRecoveryCut * agility) / 99);
  }

  /** Crash damage to the parts the section puts at risk (Spec 10.2). Returns the slots hit. */
  private crashDamage(r: RiderState, def: SectionDef, serious: boolean): string[] {
    const pool = [...(this.racing.damageSlots[def.damage] ?? [])];
    const n = serious ? 1 + Math.floor(this.rng() * this.rng() * 3) : 1 + Math.floor(this.rng() * 2);
    const hit: string[] = [];
    for (let i = 0; i < n && pool.length; i++) hit.push(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
    if (r.e.player && this.playerBike) {
      for (const slot of hit) {
        const part = this.playerBike.parts[slot];
        if (!part) continue;
        part.condition = serious ? 0 : Math.max(0, round2(part.condition - this.racing.wear.minorCrashLoss));
      }
      this.refreshPlayer();
    } else if (serious) {
      r.broken += hit.length;
    }
    return hit;
  }

  private passChance(r: RiderState, q: RiderState, def: SectionDef, passing: number): number {
    const me = this.racing.messageEffects;
    const msg = this.message(r);
    const x = 4 * (this.performance(r, def) - this.performance(q, def)) + 2 * (((r.e.skills.overtaking ?? 1) - (q.e.skills.overtaking ?? 1)) / 99);
    const eager = Math.max(0.2, 1 + me.riskPass * msg.risk + me.overtakingEager * msg.overtaking);
    return Math.min(0.98, passing * logistic(x) * eager);
  }

  private mustRetire(r: RiderState): boolean {
    if (r.retired) return true;
    const limit = this.opts.retireAtBroken ?? this.racing.sim.retireAtBroken;
    if (r.e.player && this.playerBike) {
      const engine = this.bikes.slots.find((s) => s.engine && this.playerBike!.parts[s.id]?.condition <= 0);
      if (engine) {
        r.reason = `The ${engine.name.toLowerCase()} let go`;
        return true;
      }
    }
    if (r.broken >= limit) {
      r.reason = `${r.broken} broken parts`;
      return true;
    }
    return false;
  }

  // ---- the player's XP and wear ----

  private gain(xp: Record<string, number>): void {
    for (const [k, v] of Object.entries(xp)) this.xp[k] = (this.xp[k] ?? 0) + v;
  }

  /** Spec 2.3: 2.0 × classXP × difficulty × skill weight, plus Consistency for a clean section. */
  private sectionXp(def: SectionDef, sec: TrackSection, clean: boolean): void {
    const x = this.racing.xp;
    const k = x.sectionFactor * this.cls.classXp * this.difficulty(sec, def) * (this.opts.practice ? x.practiceFactor : 1);
    const g: Record<string, number> = {};
    for (const [skill, w] of Object.entries(def.skills)) g[skill] = k * w;
    if (clean) g.consistency = (g.consistency ?? 0) + k * x.consistencyWeight;
    this.gain(g);
  }

  /** Distance wear for one lap of `km` (Spec 7.3), plus the small chance of a random breakage. */
  private wearPlayer(trace: LapTrace, km: number): void {
    const bike = this.playerBike;
    if (!bike || !this.player) return;
    const w = this.racing.wear;
    const parts = Object.entries(bike.parts);
    const low = parts.filter(([, p]) => p.condition > 0 && p.condition <= w.lowAt);
    const broken = parts.filter(([, p]) => p.condition <= 0);
    for (const [slot, part] of parts) {
      if (part.condition <= 0) continue;
      const life = w.lifespanKm[slot] ?? 300;
      const knock = 1 + w.knockLow * low.filter(([s]) => s !== slot).length + w.knockBroken * broken.filter(([s]) => s !== slot).length;
      const own = part.condition <= w.lowAt ? w.lowBase + w.lowSlope * (w.lowAt - part.condition) : 1;
      const rate = (this.cls.youth ? w.youth : 1) * knock * own;
      const before = part.condition;
      part.condition = Math.max(0, before - (km / life) * rate);
      // Random breakage: 0.02% per km when new, rising in a straight line to 0.5% per km at 5%.
      const pk = w.breakAtFull + (w.breakAtLow - w.breakAtFull) * Math.min(1, (1 - before) / 0.95);
      if (this.rng() < pk * km) {
        part.condition = 0;
        trace.events.push({ kind: 'breakdown', t: this.player.time, rider: this.player.e.id, section: trace.secs[trace.secs.length - 1], slot });
      }
      if (part.condition > 0 && part.condition < 0.005) part.condition = 0;
    }
    this.refreshPlayer();
    if (this.mustRetire(this.player)) {
      this.player.retired = true;
      trace.events.push({ kind: 'retire', t: this.player.time, rider: this.player.e.id, reason: this.player.reason ?? 'Retired' });
    }
  }

  private refreshPlayer(): void {
    if (!this.player || !this.playerBike) return;
    this.player.stats = bikeStats(this.bikes, this.playerBike);
    this.player.broken = Object.values(this.playerBike.parts).filter((p) => p.condition <= 0).length;
  }

  private cpuMessage(r: RiderState): string {
    const t = r.e.tactic;
    const total = this.opts.laps;
    if (t.push && total !== null && total - this.lapNo < t.push) {
      const ahead = this.riders.filter((q) => q !== r && !q.retired && q.time < r.time).reduce((best, q) => Math.max(best, q.time), -Infinity);
      if (ahead === -Infinity || r.time - ahead <= (t.pushGap ?? 99)) return 'push';
    }
    return t.message;
  }

  private gauss(): number {
    const u = Math.max(1e-9, this.rng());
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A gate's start bonus in percent (Spec 10.4). Gates past the track's curve (a championship's
 * third row on a track drawn for 16) get a point less than its last gate.
 */
export function gateBonus(track: Pick<TrackDef, 'gates'>, gate: number): number {
  const curve = track.gates ?? [];
  if (curve.length && gate >= curve.length) return curve[curve.length - 1] - 1;
  return curve[gate] ?? 0;
}

/** A time as m:ss.s, or with more decimals (qualifying times to the thousandth). */
export function formatTime(s: number, digits = 1): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(digits).padStart(digits + 3, '0')}`;
}
