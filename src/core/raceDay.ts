import { bikeProblem, pence, type BikesData, type Bike, type CareerState } from './career';
import { MotoSim, mixSeed, seededRng, type Entrant, type RacingData, type RiderResult, type Tactic, type TrackDef } from './race';
import { addXp, childLevels, type LevelUp, type SkillsData } from './skills';
import type { RiderStyle } from './riderProfile';

// Race days, practice and venues (Spec 12.2a, 14): who is in the field, gate picks, prize money,
// points, and putting the XP and wear back on the career. Pure rules with no graphics.

export interface CpuRiderDef {
  id: string;
  name: string;
  tag?: string;
  /** Sets every Rider Ability skill. */
  level: number;
  skills?: Record<string, number>;
  bike: { brand: string; grade: number; condition: number };
  tactic: Tactic;
  style?: RiderStyle;
}

export interface RidersData {
  riders: CpuRiderDef[];
  fields: Record<string, string[]>;
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
  return { id: def.id, name: def.name, tag: def.tag, player: false, skills, bike: cpuBike(rc.bikes, def, cls), tactic: def.tactic, gate, ...(def.style ? { style: def.style } : {}) };
}

export function playerEntrant(rc: RaceContent, career: CareerState, name: string, gate = 0): Entrant {
  return { id: PLAYER_ID, name, player: true, skills: childLevels(rc.skills, career.skills), bike: career.bike, tactic: { message: 'steady' }, gate };
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
export class RaceDay {
  readonly field: Entrant[];
  readonly motos: MotoRecord[] = [];
  readonly track: TrackDef;
  readonly cls: string;
  readonly laps: number;
  readonly motoCount = 2;
  /** The order riders pick gates for the next moto. */
  pickOrder: string[];
  private readonly rng: () => number;

  constructor(
    private readonly rc: RaceContent,
    readonly venue: VenueDef,
    player: Entrant,
    readonly seed: number,
    /** The entry fee paid, in pence, for the prize maths (the first race still pays prizes on the normal fee). */
    readonly entry: number,
  ) {
    this.track = trackById(rc, venue.track!);
    this.cls = venue.class ?? '50cc';
    this.laps = rc.racing.classes[this.cls].laps;
    this.rng = seededRng(seed);
    const cpus = (rc.riders.fields[venue.field ?? ''] ?? []).map((id) => rc.riders.riders.find((r) => r.id === id)!).filter(Boolean);
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
    const gates = this.gateCount();
    const taken = new Map<number, string>();
    for (const id of this.pickOrder) {
      if (id === PLAYER_ID) break;
      taken.set(this.cpuGatePick(taken, gates), id);
    }
    const free = [...Array(gates).keys()].filter((g) => !taken.has(g));
    return { taken, free };
  }

  /** Every rider's gate once the player has picked theirs. CPU riders take the best gate left. */
  assignGates(playerGate: number): void {
    const gates = this.gateCount();
    const taken = new Map<number, string>();
    for (const id of this.pickOrder) {
      const g = id === PLAYER_ID && !taken.has(playerGate) ? playerGate : this.cpuGatePick(taken, gates);
      taken.set(g, id);
    }
    for (const [g, id] of taken) this.field.find((e) => e.id === id)!.gate = g;
  }

  private gateCount(): number {
    return Math.max(this.field.length, this.track.gates?.length ?? 0);
  }

  private cpuGatePick(taken: Map<number, string>, gates: number): number {
    for (let g = 0; g < gates; g++) if (!taken.has(g)) return g;
    return gates;
  }

  /** The moto simulation for the next moto. The caller runs it (live or auto-complete). */
  startMoto(message: string, retireAtBroken?: number): MotoSim {
    return new MotoSim(this.rc.racing, this.rc.bikes, this.track, this.cls, this.field, {
      laps: this.laps,
      motoIndex: this.motos.length,
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
    const xp: Record<string, number> = { ...sim.xp };
    for (const [k, v] of Object.entries(bonus)) xp[k] = (xp[k] ?? 0) + v;
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

  private get entryForPrize(): number {
    return pence(this.rc.racing.classes[this.cls].entry);
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

export function sumXp(...sets: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sets) for (const [k, v] of Object.entries(s)) out[k] = (out[k] ?? 0) + v;
  return out;
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A practice session: the rider alone, unlimited laps until they stop (Spec 12.2). */
export function practiceSim(rc: RaceContent, venue: VenueDef, player: Entrant, seed: number): MotoSim {
  return new MotoSim(rc.racing, rc.bikes, trackById(rc, venue.track!), venue.class ?? '50cc', [player], { laps: null, motoIndex: 0, seed, practice: true });
}
