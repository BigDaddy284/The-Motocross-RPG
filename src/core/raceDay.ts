import { bikeProblem, pence, type BikesData, type Bike, type CareerState } from './career';
import { isSprint, lapMetres } from './trackGeom';
import { MotoSim, formatTime, gateBonus, mixSeed, seededRng, type Entrant, type RacingData, type RiderResult, type Tactic, type TrackDef } from './race';
import { addXp, childLevels, leadLevel, type LevelUp, type SkillsData } from './skills';
import { TRICKS_FLAG } from './tricks';
import type { RiderStyle } from './riderProfile';

// Race days, practice and venues (Spec 12.2a, 14): who is in the field, gate picks, prize money,
// points, and putting the XP and wear back on the career. Pure rules with no graphics.

export interface CpuRiderDef {
  id: string;
  name: string;
  tag?: string;
  /** The areas they race in (Boss, 28 Oct 2026): they're in the pool of every field in these areas, and no other. */
  areas: number[];
  /** Sets every Rider Ability skill. */
  level: number;
  skills?: Record<string, number>;
  bike: { brand: string; grade: number; condition: number };
  tactic: Tactic;
  style?: RiderStyle;
  /** Their own race kit, a gear set on the race screen (Neal Gizard's blue and black); left out, the field's kits in turn. */
  kit?: string;
}

export interface RidersData {
  riders: CpuRiderDef[];
  /** Each field's pool of CPU riders: every rider racing in its area (riderPools). Without a size, everyone in it races. */
  fields: Record<string, string[]>;
  /** How many CPU riders race from a field: its regulars, then the rest drawn at random from its pool each race day. */
  fieldSize?: Record<string, number>;
  /** Riders in a field who race every race day it is raced (the Local Champion). */
  regulars?: Record<string, string[]>;
}

/** riders.json as written: each field names its area, and the riders say which areas they race in. */
export type RidersFile = Omit<RidersData, 'fields'> & { fields: Record<string, { area: number }> };

/** Each field's pool from the riders' areas, in the riders' listed order. */
export function riderPools(file: RidersFile): RidersData {
  const fields = Object.fromEntries(Object.entries(file.fields).map(([id, f]) => [id, file.riders.filter((r) => r.areas.includes(f.area)).map((r) => r.id)]));
  return { ...file, fields };
}

export interface VenueDef {
  id: string;
  name: string;
  map: string;
  track?: string;
  class?: string;
  field?: string;
  /** The NPC who takes entries at the race office. */
  office?: string;
  /** The flag that opens the venue. */
  needs?: string;
  /** Free practice entry as a percent of the race entry (Spec 12.2). */
  practiceFeePct?: number;
  /** GDD 4.3: the first race is free. */
  firstRaceFree?: boolean;
  practiceOnly?: boolean;
  /** Tiles [x, y, w, h] on the map that start a ride, for venues without a race office. */
  area?: [number, number, number, number];
  /** While set, the venue stays shut with this message. */
  locked?: string;
  /** CPU riders out on track in free practice, drawn from the field's pool. */
  practiceRiders?: number;
  /** Riders from the field's pool who race every race day here, on top of the field's own regulars. */
  regulars?: string[];
}

export interface TracksData {
  tracks: TrackDef[];
  venues: VenueDef[];
}

export interface RaceContent {
  racing: RacingData;
  tracks: TracksData;
  riders: RidersData;
  skills: SkillsData;
  bikes: BikesData;
}

export const PLAYER_ID = 'player';

/** Why the rider can't ride at this venue right now, or null. */
export function venueProblem(rc: RaceContent, venue: VenueDef, career: CareerState, flags: Record<string, boolean>): string | null {
  if (venue.locked) return venue.locked;
  if (venue.needs && !flags[venue.needs]) return 'Not open to you yet.';
  return bikeProblem(rc.bikes, career.bike);
}

/** Entry fee in pence for a race day here, after the free first race. */
export function entryFee(rc: RaceContent, venue: VenueDef, flags: Record<string, boolean>): number {
  if (venue.firstRaceFree && !flags.first_race_done) return 0;
  return pence(rc.racing.classes[venue.class ?? '50cc'].entry);
}

export function practiceFee(rc: RaceContent, venue: VenueDef): number {
  if (!venue.practiceFeePct) return 0;
  return pence((rc.racing.classes[venue.class ?? '50cc'].entry * venue.practiceFeePct) / 100);
}

/** A CPU rider's fixed bike: the same grade and condition in every slot. */
export function cpuBike(bikes: BikesData, def: CpuRiderDef, cls: string): Bike {
  return { brand: def.bike.brand, class: cls, parts: Object.fromEntries(bikes.slots.map((s) => [s.id, { grade: def.bike.grade, condition: def.bike.condition }])) };
}

export function cpuEntrant(rc: RaceContent, def: CpuRiderDef, cls: string, gate = 0): Entrant {
  const skills: Record<string, number> = {};
  for (const lead of rc.skills.leads) for (const c of lead.children) skills[c.id] = lead.id === 'rider' ? def.level : 1;
  Object.assign(skills, def.skills);
  return { id: def.id, name: def.name, tag: def.tag, player: false, skills, bike: cpuBike(rc.bikes, def, cls), tactic: def.tactic, gate, ...(def.style ? { style: def.style } : {}), ...(def.kit ? { kit: def.kit } : {}) };
}

/** The player as they race. `flags` are the save's: with TRICKS_FLAG set, they whip and scrub by their Rider Ability level (tricks.ts). */
export function playerEntrant(rc: RaceContent, career: CareerState, name: string, gate = 0, flags: Record<string, boolean> = {}): Entrant {
  const e: Entrant = { id: PLAYER_ID, name, player: true, skills: childLevels(rc.skills, career.skills), bike: career.bike, tactic: { message: 'steady' }, gate };
  const rider = rc.skills.leads.find((l) => l.id === 'rider');
  if (flags[TRICKS_FLAG] && rider) e.riderLevel = leadLevel(rc.skills, career.skills, rider);
  return e;
}

export function trackById(rc: RaceContent, id: string): TrackDef {
  const t = rc.tracks.tracks.find((x) => x.id === id);
  if (!t) throw new Error(`No track "${id}"`);
  return t;
}

// ---- a race day ----

export interface MotoRecord {
  results: RiderResult[];
  /** The player's points, prize in pence and XP (with the finishing bonus). */
  points: number;
  prize: number;
  xp: Record<string, number>;
  passes: number;
}

export interface DayResult {
  /** Overall order: id, name, combined positions and points. */
  overall: { id: string; name: string; tag?: string; player: boolean; positions: (number | null)[]; points: number; position: number }[];
  podiumBonus: number;
}

/**
 * One race day at a venue: the field, gate picks, two motos and the results. The rider signs on
 * (paying the entry) before this is made. Moto 1's gate pick order is random (no standings yet);
 * moto 2's follows moto 1's finishing order (Spec 12.2a).
 */
/** How strongly a CPU rider is drawn to their favourite spot on the start, in start bonus % per gate away. */
const GATE_FAVOURITE_PULL = 0.3;
/** The pull stops growing this many gates from the favourite, so it never outweighs a much better gate. */
const GATE_FAVOURITE_REACH = 3;
/** The spread of a CPU rider's own feel for each gate, in start bonus %. With the capped pull, a gate 2% better always wins. */
const GATE_FEEL = 1;
/** The first picks in the order always take the best gate left: the best gates never go begging. */
const GATE_SURE_PICKS = 3;
/**
 * A few riders each moto go wide: they pass over the gates in for the outside one at most 2% worse
 * than the best left (a rut they like), so the start never fills in a neat line from gate 1 (Boss,
 * 28 Oct 2026). One of picks 4 and 5, one of 7 to 9, 10 and 11, and 12 and 13, and pick 14, as
 * [first pick, how many picks it could be].
 */
const GATE_WIDE: [number, number][] = [
  [3, 2],
  [6, 3],
  [9, 2],
  [11, 2],
  [13, 1],
];

/** A stable number for a rider id, to seed their gate preferences. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A championship round's race day (Spec 12.2a, 12.5): its fixed field, qualifying and the tier's purse. */
export interface RoundOptions {
  /** The CPU riders, the same every round, in place of a field drawn for the day. */
  cpus: CpuRiderDef[];
  /** Timed laps in qualifying, after an out lap. */
  qualifyingLaps: number;
  /** Prize money times the class's (Spec 14.2 tier, with a replay's share). */
  purseTimes: number;
  /** XP times (a replay's share). */
  xpTimes: number;
}

export interface QualifyingRecord {
  /** Every rider, fastest timed lap first. bestLap is the best timed lap (the out lap isn't timed). */
  results: RiderResult[];
  xp: Record<string, number>;
}

/** Laps per moto for a race day: by the track's kind where racing.json says (kindLaps), else the class's laps. */
export function lapsFor(rc: RaceContent, track: TrackDef, cls: string, championship: boolean): number {
  const kind = track.kind ?? 'outdoor';
  const byKind = rc.racing.kindLaps;
  return (championship ? byKind?.championship?.[kind] : undefined) ?? byKind?.race?.[kind] ?? rc.racing.classes[cls].laps;
}

export class RaceDay {
  readonly field: Entrant[];
  readonly motos: MotoRecord[] = [];
  /** Qualifying, once it has been ridden (championship rounds only). */
  qualifying: QualifyingRecord | null = null;
  readonly track: TrackDef;
  readonly cls: string;
  readonly laps: number;
  readonly motoCount: number;
  /** The order riders pick gates for the next moto; in an enduro sprint, the order they leave the start line. */
  pickOrder: string[];
  /**
   * An enduro sprint (trackGeom.isSprint): a one-lap timed qualifying sets the start order for
   * moto 1, fastest first, and each moto's results the order for the next. Nobody picks a gate.
   */
  readonly sprint: boolean;
  private readonly rng: () => number;

  constructor(
    private readonly rc: RaceContent,
    readonly venue: VenueDef,
    player: Entrant,
    readonly seed: number,
    /** The entry fee paid, in pence, for the prize maths (the first race still pays prizes on the normal fee). */
    readonly entry: number,
    /** Set for a championship round. */
    readonly round?: RoundOptions,
    /** A challenge's own shape (core/challenge.ts): its motos, laps and riders. */
    custom?: { motos: number; laps: number; cpus: CpuRiderDef[] },
    /** TEST ONLY, REMOVE BEFORE RELEASE (Boss, 30 Oct 2026): no CPU riders, to test ride a track. */
    alone = false,
  ) {
    this.track = trackById(rc, venue.track!);
    this.cls = venue.class ?? '50cc';
    this.sprint = isSprint(this.track);
    this.laps = custom?.laps ?? lapsFor(rc, this.track, this.cls, !!round);
    this.motoCount = custom?.motos ?? 2;
    this.rng = seededRng(seed);
    const cpus = alone ? [] : (custom?.cpus ?? round?.cpus ?? drawField(rc, venue, seed));
    this.field = [player, ...cpus.map((d) => cpuEntrant(rc, d, this.cls))];
    this.pickOrder = shuffle(this.field.map((e) => e.id), this.rng);
  }

  get player(): Entrant {
    return this.field.find((e) => e.player)!;
  }

  get motoNumber(): number {
    return this.motos.length + 1;
  }

  get done(): boolean {
    return this.motos.length >= this.motoCount;
  }

  /** Gates still free when the player's turn comes, after the riders ahead of them in the pick order take the best ones. */
  gatesForPlayer(): { taken: Map<number, string>; free: number[] } {
    const gates = this.gateCount;
    const taken = new Map<number, string>();
    for (const id of this.pickOrder) {
      if (id === PLAYER_ID) break;
      taken.set(this.cpuGatePick(id, taken, gates), id);
    }
    const free = [...Array(gates).keys()].filter((g) => !taken.has(g));
    return { taken, free };
  }

  /**
   * Every rider's gate once the player has picked theirs. CPU riders take the gate they like best of those left (cpuGatePick). The
   * player's gate must be one of gatesForPlayer().free: a gate past the size of the field, or one
   * already taken, is an error, never quietly swapped for another.
   */
  assignGates(playerGate: number): void {
    const gates = this.gateCount;
    if (this.field.some((e) => e.id === PLAYER_ID)) {
      const { taken } = this.gatesForPlayer();
      if (!Number.isInteger(playerGate) || playerGate < 0 || playerGate >= gates) throw new RangeError(`Gate ${playerGate + 1} is not on this start: ${gates} riders, gates 1 to ${gates}`);
      if (taken.has(playerGate)) throw new RangeError(`Gate ${playerGate + 1} is already taken`);
    }
    const taken = new Map<number, string>();
    for (const id of this.pickOrder) {
      const g = id === PLAYER_ID ? playerGate : this.cpuGatePick(id, taken, gates);
      taken.set(g, id);
    }
    for (const [g, id] of taken) this.field.find((e) => e.id === id)!.gate = g;
  }

  /** One gate per rider in the field (two rows of 8): gate 1 is the inside of the first corner. */
  get gateCount(): number {
    return this.field.length;
  }

  /**
   * A CPU rider's pick: the free gate they like best. The first GATE_SURE_PICKS in the order take
   * the best gate left (the inside one of a tie). After them, most want the inside gates and their
   * start bonus, but each rider has a favourite spot this moto (a rut they like, a line round the
   * first corner) and their own feel for each gate, so the field fills the start unevenly instead
   * of from gate 1 up; neither ever beats a gate 2% better. A few riders after them go wide
   * for a spot further out (GATE_WIDE). Worked out from the day's seed, the
   * rider and the moto, never from what is already taken, so the gate screen and the start always agree.
   */
  private cpuGatePick(id: string, taken: Map<number, string>, gates: number): number {
    if (this.pickOrder.indexOf(id) < GATE_SURE_PICKS) {
      let best = -1;
      for (let g = 0; g < gates; g++) if (!taken.has(g) && (best < 0 || gateBonus(this.track, g) > gateBonus(this.track, best))) best = g;
      return best;
    }
    const free = [...Array(gates).keys()].filter((g) => !taken.has(g));
    const top = Math.max(...free.map((g) => gateBonus(this.track, g)));
    const moto = seededRng(mixSeed(this.seed, 104729 + 7919 * this.motos.length));
    const pick = this.pickOrder.indexOf(id);
    for (const [from, spread] of GATE_WIDE) {
      const wide = from + Math.floor(moto() * spread);
      const inOne = moto() < 0.4;
      if (pick !== wide) continue;
      // The outside gate in reach, or sometimes the one in from it.
      const reach = free.filter((g) => gateBonus(this.track, g) >= top - 2);
      if (reach.length > 2) return reach[reach.length - (inOne ? 2 : 1)];
    }
    const rng = seededRng(mixSeed(this.seed, hashId(id) + 7919 * this.motos.length));
    const favourite = rng() * gates;
    let best = gates;
    let bestScore = -Infinity;
    for (let g = 0; g < gates; g++) {
      // One draw per gate, taken or not, so a rider's feel for a gate never depends on the others.
      const feel = (rng() - 0.5) * GATE_FEEL;
      if (taken.has(g)) continue;
      const score = gateBonus(this.track, g) - Math.min(Math.abs(g - favourite), GATE_FAVOURITE_REACH) * GATE_FAVOURITE_PULL + feel;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  /** True while a championship round's or a sprint's qualifying is still to ride. */
  get qualifyingDue(): boolean {
    return (!!this.round || this.sprint) && !this.qualifying;
  }

  /** A sprint: every rider leaves the start line in the pick order (their gate is their place in it). */
  private startInPickOrder(): void {
    this.pickOrder.forEach((id, i) => (this.field.find((e) => e.id === id)!.gate = i));
  }

  /**
   * Qualifying (Spec 12.2): an out lap from the gate, then the timed laps. Riders line up in a
   * random order (the day's first pick order); nobody picks a gate for it.
   */
  startQualifying(message: string): MotoSim {
    this.startInPickOrder();
    // A sprint qualifies on one timed test, riders leaving in a random order; a round has an out lap first.
    return new MotoSim(this.rc.racing, this.rc.bikes, this.track, this.cls, this.field, {
      laps: this.sprint ? 1 : this.round!.qualifyingLaps + 1,
      motoIndex: 0,
      seed: mixSeed(this.seed, 0x7175616c),
      message,
    });
  }

  /** Records qualifying: the order by best timed lap sets moto 1's gate pick order. No points or prize. */
  finishQualifying(sim: MotoSim): QualifyingRecord {
    const timed = (laps: number[]) => (this.sprint ? (laps[0] ?? null) : laps.length > 1 ? Math.min(...laps.slice(1)) : null);
    const rows = sim.riders.map((r) => ({ r, best: timed(r.lapTimes) }));
    rows.sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || b.r.laps - a.r.laps || a.r.time - b.r.time || a.r.e.gate - b.r.e.gate);
    const pole = rows[0].best;
    const results: RiderResult[] = rows.map(({ r, best }, i) => ({
      id: r.e.id,
      name: r.e.name,
      tag: r.e.tag,
      player: r.e.player,
      position: i + 1,
      laps: r.laps,
      time: r.time,
      bestLap: best,
      retired: r.retired,
      reason: r.reason,
      gap: best === null ? 'No time' : i === 0 || pole === null ? formatTime(best, 3) : `+${(best - pole).toFixed(3)}s`,
    }));
    const xp = scaleXp(sim.xp, this.round?.xpTimes ?? 1);
    this.qualifying = { results, xp };
    if (sim.playerBike) this.player.bike = sim.playerBike;
    this.pickOrder = results.map((r) => r.id);
    return this.qualifying;
  }

  /** The moto simulation for the next moto. The caller runs it (live or auto-complete). */
  startMoto(message: string, retireAtBroken?: number): MotoSim {
    if (this.sprint) this.startInPickOrder();
    return new MotoSim(this.rc.racing, this.rc.bikes, this.track, this.cls, this.field, {
      laps: this.laps,
      // Ruts deepen through the day, qualifying counting as one step (Spec 10, Round 111).
      motoIndex: this.motos.length + (this.qualifying ? 1 : 0),
      seed: mixSeed(this.seed, this.motos.length + 1),
      message,
      retireAtBroken,
    });
  }

  /** Records a finished moto and sets the next pick order. Returns the player's record. */
  finishMoto(sim: MotoSim): MotoRecord {
    const results = sim.results();
    const me = results.find((r) => r.player)!;
    const points = me.retired ? 0 : (this.rc.racing.points[me.position - 1] ?? 0);
    const bonus = sim.finishBonus(me.position);
    let xp: Record<string, number> = { ...sim.xp };
    for (const [k, v] of Object.entries(bonus)) xp[k] = (xp[k] ?? 0) + v;
    if (this.round) xp = scaleXp(xp, this.round.xpTimes);
    const rec: MotoRecord = { results, points, prize: me.retired ? 0 : motoPrize(this.rc.racing, this.entryForPrize, me.position), xp, passes: sim.passes };
    this.motos.push(rec);
    // The player's bike comes off the track as it finished.
    if (sim.playerBike) this.player.bike = sim.playerBike;
    this.pickOrder = results.map((r) => r.id);
    return rec;
  }

  /** The player leaves before the last moto: it counts as a DNF (Spec 12.2a, 5A). */
  leaveEarly(): void {
    while (!this.done) {
      const results: RiderResult[] = this.field.map((e, i) => ({ id: e.id, name: e.name, tag: e.tag, player: e.player, position: i + 1, laps: 0, time: 0, bestLap: null, retired: e.player, reason: e.player ? 'Left early' : undefined, gap: '' }));
      this.motos.push({ results, points: 0, prize: 0, xp: {}, passes: 0 });
    }
  }

  /** The entry the prize maths works from: the class entry, times a championship's purse. */
  private get entryForPrize(): number {
    return pence(this.rc.racing.classes[this.cls].entry * (this.round?.purseTimes ?? 1));
  }

  /** Day overall by lowest combined positions, ties to the last moto (Spec 12.4), plus the podium bonus. */
  dayResult(): DayResult {
    const n = this.field.length;
    const rows = this.field.map((e) => {
      const positions = this.motos.map((m) => {
        const r = m.results.find((x) => x.id === e.id);
        return r && !r.retired ? r.position : null;
      });
      const points = this.motos.reduce((a, m) => {
        const r = m.results.find((x) => x.id === e.id);
        return a + (r && !r.retired ? (this.rc.racing.points[r.position - 1] ?? 0) : 0);
      }, 0);
      return { id: e.id, name: e.name, tag: e.tag, player: e.player, positions, points, position: 0 };
    });
    const score = (p: (number | null)[]) => p.reduce<number>((a, x) => a + (x ?? n + 1), 0);
    rows.sort((a, b) => score(a.positions) - score(b.positions) || (a.positions.at(-1) ?? n + 1) - (b.positions.at(-1) ?? n + 1));
    rows.forEach((r, i) => (r.position = i + 1));
    const me = rows.find((r) => r.player)!;
    const share = this.rc.racing.prize.podium[me.position - 1] ?? 0;
    const finishedAll = me.positions.every((p) => p !== null);
    return { overall: rows, podiumBonus: finishedAll ? Math.round(this.entryForPrize * share) : 0 };
  }
}

/** Prize for one moto in pence: the winner gets 3 × entry, the rest a share of that (Spec 14.3). */
export function motoPrize(racing: RacingData, entryPence: number, position: number): number {
  const share = racing.prize.shares[position - 1] ?? 0;
  return Math.round(entryPence * racing.prize.winnerTimesEntry * share);
}

// ---- putting it back on the career ----

export interface Payout {
  money: number;
  xp: Record<string, number>;
  levelUps: LevelUp[];
}

/** Adds money and XP and puts the bike back as it came off the track. */
export function applyRide(rc: RaceContent, career: CareerState, bike: Bike | null, money: number, xp: Record<string, number>): Payout {
  if (bike) career.bike = structuredClone(bike);
  career.money += money;
  const levelUps = addXp(rc.skills, career.skills, xp);
  return { money, xp, levelUps };
}

export function scaleXp(xp: Record<string, number>, k: number): Record<string, number> {
  return k === 1 ? { ...xp } : Object.fromEntries(Object.entries(xp).map(([s, v]) => [s, v * k]));
}

export function sumXp(...sets: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sets) for (const [k, v] of Object.entries(s)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * The CPU riders on a race day: the field's regulars and the venue's, then riders drawn at random
 * from the rest of the field's pool (seeded by the day) up to the field's size. A field without a
 * size races its whole pool, in its listed order.
 */
export function drawField(rc: RaceContent, venue: VenueDef, seed: number): CpuRiderDef[] {
  const id = venue.field ?? '';
  const pool = (rc.riders.fields[id] ?? []).map((r) => rc.riders.riders.find((x) => x.id === r)!).filter(Boolean);
  const size = rc.riders.fieldSize?.[id];
  if (size === undefined || size >= pool.length) return pool;
  const always = new Set([...(rc.riders.regulars?.[id] ?? []), ...(venue.regulars ?? [])]);
  const regulars = pool.filter((r) => always.has(r.id));
  const drawn = shuffle(pool.filter((r) => !always.has(r.id)), seededRng(mixSeed(seed, 0x6669656c)));
  return [...regulars, ...drawn].slice(0, Math.max(size, regulars.length));
}

/**
 * `n` CPU riders drawn at random (seeded by the day) from the field's whole pool, whatever the
 * field's usual size: a No-Turn Takedown knockout races 32 (Boss, 30 Oct 2026). The regulars first.
 */
export function drawPool(rc: RaceContent, venue: VenueDef, seed: number, n: number): CpuRiderDef[] {
  const id = venue.field ?? '';
  const pool = (rc.riders.fields[id] ?? []).map((r) => rc.riders.riders.find((x) => x.id === r)!).filter(Boolean);
  const always = new Set([...(rc.riders.regulars?.[id] ?? []), ...(venue.regulars ?? [])]);
  const regulars = pool.filter((r) => always.has(r.id));
  const drawn = shuffle(pool.filter((r) => !always.has(r.id)), seededRng(mixSeed(seed, 0x6b6e6f63)));
  return [...regulars, ...drawn].slice(0, n);
}

/** How many CPU riders race a race day here. */
export function fieldCount(rc: RaceContent, venue: VenueDef): number {
  const id = venue.field ?? '';
  const pool = rc.riders.fields[id]?.length ?? 0;
  return Math.min(pool, rc.riders.fieldSize?.[id] ?? pool);
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A practice session: unlimited laps until the rider stops (Spec 12.2). At a venue with
 * practiceRiders, that many riders from its field's pool are already out on track, spread round
 * the lap: each set off from the gate a share of a lap before the session starts, so the nearest is
 * well clear of the gate when you set off.
 */
export function practiceSim(rc: RaceContent, venue: VenueDef, player: Entrant, seed: number, alone = false): MotoSim {
  const track = trackById(rc, venue.track!);
  const cls = venue.class ?? '50cc';
  const pool = (rc.riders.fields[venue.field ?? ''] ?? []).map((id) => rc.riders.riders.find((r) => r.id === id)).filter((r): r is CpuRiderDef => !!r);
  // TEST ONLY, REMOVE BEFORE RELEASE (Boss, 30 Oct 2026): `alone` sends nobody else out.
  const n = alone ? 0 : Math.min(venue.practiceRiders ?? 0, pool.length);
  const drawn = shuffle(pool, seededRng(mixSeed(seed, 0x70726163))).slice(0, n);
  // A rough lap time: the lap's length at the class's reference speed.
  const lapSeconds = lapMetres(track) / rc.racing.classes[cls].refSpeed;
  const others = drawn.map((d, i) => ({ ...cpuEntrant(rc, d, cls, i + 1), startAt: -((i + 1) * lapSeconds) / (n + 1) }));
  return new MotoSim(rc.racing, rc.bikes, track, cls, [{ ...player, gate: 0, startAt: 0 }, ...others], { laps: null, motoIndex: 0, seed, practice: true });
}
