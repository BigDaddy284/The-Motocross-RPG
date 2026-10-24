import { bikeStats, type Bike, type BikesData } from './career';
import { lapPlan, sectionBounds, startGeom, type DrawnShape, type StartGeom } from './trackGeom';
import type { RiderStyle } from './riderProfile';

// The race simulation (Spec 10, GDD 11). Pure rules with no graphics: the race screen plays a
// lap's results out section by section, and auto-complete just runs the laps straight through,
// so both use exactly the same engine (agreed). Everything random comes from one seeded generator
// drawn in a fixed order, so the same seed and the same held message always give the same race.

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
  /** The drawn shapes the section can sit on (trackGeom.drawnShape): a hairpin must be drawn as one. */
  shapes: DrawnShape[];
}

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
  /** Size on the grid; the scenery type's default when left out. */
  w?: number;
  h?: number;
  /** Turned this many degrees clockwise. */
  rot?: number;
  text?: string;
  color?: string;
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
  /** The shape drawn on the race screen, on a 100 × 60 grid, starting at the start line. */
  path: [number, number][];
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
  player: boolean;
  /** Child skill levels. */
  skills: Record<string, number>;
  bike: Bike;
  tactic: Tactic;
  /** Gate number from 0, best first. Lap 1 starts in gate order. */
  gate: number;
  /** How they ride on the race screen (riderProfile.ts); never changes a result. */
  style?: RiderStyle;
}

/** Events name the section by index; -1 is the start straight. */
export type RaceEvent =
  | { kind: 'pass'; t: number; rider: string; other: string; section: number }
  | { kind: 'failedPass'; t: number; rider: string; other: string; section: number }
  | { kind: 'mistake'; t: number; rider: string; section: number; outcome: MistakeOutcome['id']; lost: number; damaged: string[] }
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
  message: string;
  stats: Record<string, number>;
  broken: number;
  retired: boolean;
  reason?: string;
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
  private readonly rng: () => number;
  private readonly cls: ClassRules;
  private readonly ceiling: number;
  private lapNo = 0;
  private readonly bounds: number[];
  private readonly start: StartGeom;

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
    this.start = startGeom(track);
    this.cls = racing.classes[classId];
    this.ceiling = bikes.classes.find((c) => c.id === classId)?.ceiling ?? 1;
    this.ink = racing.ink;
    const mine = entrants.find((e) => e.player);
    this.playerBike = mine ? structuredClone(mine.bike) : null;
    this.riders = entrants.map((e) => {
      const bike = e.player ? this.playerBike! : e.bike;
      return {
        e: { ...e, bike },
        time: 0,
        laps: 0,
        lapTimes: [],
        message: e.player ? (opts.message ?? 'steady') : e.tactic.message,
        stats: bikeStats(bikes, bike),
        broken: Object.values(bike.parts).filter((p) => p.condition <= 0).length,
        retired: false,
      };
    });
    this.player = this.riders.find((r) => r.e.player);
  }

  get lap(): number {
    return this.lapNo;
  }

  get totalLaps(): number | null {
    return this.opts.laps;
  }

  get finished(): boolean {
    return (this.opts.laps !== null && this.lapNo >= this.opts.laps) || this.riders.every((r) => r.retired);
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

  /** Simulates the next lap for every rider still racing. */
  nextLap(): LapTrace {
    const lap = ++this.lapNo;
    const { sim } = this.racing;
    const active = this.riders.filter((r) => !r.retired);
    const plan = lapPlan(this.track, lap, this.bounds, this.start);
    const trace: LapTrace = { lap, marks: plan.marks, secs: plan.secs, times: {}, events: [] };
    for (const r of active) {
      trace.times[r.e.id] = [r.time];
      if (!r.e.player) r.message = this.cpuMessage(r);
    }
    // Riding order entering the lap: the gate order on lap 1, then race order.
    let order = [...active].sort((a, b) => (lap === 1 ? a.e.gate - b.e.gate : a.time - b.time));
    const air = new Map<RiderState, number>();
    const startTimes = new Map(active.map((r) => [r, r.time]));
    const cur = new Map(active.map((r) => [r, r.time]));
    const out = new Set<RiderState>();

    plan.secs.forEach((si, leg) => {
      // The start straight rides as a start (gate bonus, start skills) in a race; in practice it's a straight.
      const full = si < 0 ? { type: 'start_gate', length: plan.metres[leg], passing: this.track.start?.passing ?? 0.6 } : this.track.sections[si];
      const sec = { ...full, length: plan.metres[leg] };
      const isStart = si < 0 && !this.opts.practice;
      const def = this.racing.sections[sec.type === 'start_gate' && !isStart ? 'straight' : sec.type];
      // A section joined part way through on lap 1 is only partly ridden, with fewer chances to slip.
      const share = Math.min(1, sec.length / Math.max(1e-9, full.length));
      const done: RiderState[] = [];
      for (const r of order) {
        if (out.has(r)) continue;
        let t = this.sectionTime(r, sec, def, isStart ? r.e.gate : -1) * (air.get(r) ?? 1);
        const m = this.mistake(r, def, share);
        if (m) {
          const lost = m.timePct ? t * (m.timePct[0] + this.rng() * (m.timePct[1] - m.timePct[0])) / 100 : this.crashSeconds(r, m);
          t += lost;
          const damaged = m.crash ? this.crashDamage(r, def, !!m.serious) : [];
          trace.events.push({ kind: 'mistake', t: cur.get(r)! + t, rider: r.e.id, section: si, outcome: m.id, lost, damaged });
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
      if (lap === 1 && leg === Math.min(1, plan.secs.length - 1) && !this.opts.practice) {
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
      r.lapTimes.push(r.time - startTimes.get(r)!);
    }
    if (this.player && !this.player.retired && active.includes(this.player)) this.wearPlayer(trace, plan.metres.reduce((a, m) => a + m, 0) / 1000);
    return trace;
  }

  /** Runs the rest of the moto with no changes, for auto-complete. */
  runToEnd(): LapTrace[] {
    const laps: LapTrace[] = [];
    while (!this.finished) laps.push(this.nextLap());
    return laps;
  }

  results(): RiderResult[] {
    const sorted = [...this.riders].sort((a, b) => Number(a.retired) - Number(b.retired) || b.laps - a.laps || a.time - b.time);
    const leader = sorted[0];
    return sorted.map((r, i) => ({
      id: r.e.id,
      name: r.e.name,
      tag: r.e.tag,
      player: r.e.player,
      position: i + 1,
      laps: r.laps,
      time: r.time,
      bestLap: r.lapTimes.length ? Math.min(...r.lapTimes) : null,
      retired: r.retired,
      reason: r.reason,
      gap: i === 0 ? formatTime(r.time) : r.retired ? 'DNF' : r.laps < leader.laps ? `+${leader.laps - r.laps} lap${leader.laps - r.laps > 1 ? 's' : ''}` : `+${(r.time - leader.time).toFixed(1)}s`,
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
    const gateBonus = gate >= 0 ? 1 - (this.track.gates?.[gate] ?? 0) / 100 : 1;
    const cons = r.e.skills.consistency ?? 1;
    const sd = sim.noise * (1 - (sim.consistencyNoiseCut * cons) / 99) * Math.max(0.2, 1 - me.consistencyNoise * msg.consistency);
    const noise = Math.max(0.7, 1 + this.gauss() * sd);
    return base * this.difficulty(sec, def) * (1 - sim.spread * (perf - 0.5)) * pace * gateBonus * noise;
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

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}
