import { pence } from './career';
import { buffRider } from './championship';
import { KNOCKOUT_DEFAULTS, MotoSim, formatTime, mixSeed, seededRng, type Entrant, type KnockoutRules, type RiderResult } from './race';
import { cpuEntrant, drawPool, motoPrize, PLAYER_ID, scaleXp, sumXp, trackById, type RaceContent, type VenueDef } from './raceDay';

// A No-Turn Takedown race day (Boss, 30 Oct 2026): a knockout on a straight drag strip. Everyone
// rides a timed seeding run on their own, leaving the gate a few seconds apart; the seeding order
// splits the field into heats of four (the fastest kept apart), each one run from the gate to the
// finish line; the first two in each heat go through to the box beside it in a fixed bracket, until
// four are left for the final. The final is the best of three runs: each run scores its finishing
// place (1 to 4) and the lowest total wins. Pure rules with no graphics.
//
// It is late-game content, as hard to win as a race day at the same level (Boss, 30 Oct 2026):
// the field is the pool's 31 best riders, made better by sim.knockout.buff, and a run of a few
// sections rides with sim.knockout.noise of the sim's noise, so skill counts as much as over a
// moto's many laps. tools/sim/knockout.ts measures both against a race day.

/** Riders in a knockout: 32, the player one of them, when the field's pool is big enough. */
export const KNOCKOUT_FIELD = 32;

export interface KnockoutHeat {
  /** The round, from 0, and the heat in it, from 0. */
  round: number;
  index: number;
  /** Its riders, best seed first. */
  riders: string[];
  /** Each run's results, in order: one run in a heat, finalRuns in the final. */
  runs: RiderResult[][];
  /** Who went through (a heat), or the final's order on points, once it is over. */
  through: string[];
}

export interface KnockoutRound {
  name: string;
  heats: KnockoutHeat[];
  final: boolean;
}

export interface SeedingRecord {
  /** Every rider, fastest seeding run first. bestLap is their seeding time (null with none). */
  results: RiderResult[];
  xp: Record<string, number>;
}

export interface KnockoutPlace {
  id: string;
  name: string;
  player: boolean;
  /** 1 for the winner. */
  position: number;
  /** How far they got: the round's name they went out in, or Final. */
  reached: string;
  /** Final points (lowest wins), for the four in the final. */
  points?: number;
}

/** The final's points for a run: its finishing place, 1 for a win. */
export function finalPoints(position: number): number {
  return position;
}

/** A round's name by how many heats it has. */
export function roundName(heats: number, riders: number): string {
  if (heats === 1) return 'Final';
  if (heats === 2) return 'Semi-finals';
  if (heats === 4) return 'Quarter-finals';
  return `Round of ${riders}`;
}

/**
 * Splits riders (best seed first) into heats of at most `size`, snaking the seeds so the fastest
 * are kept apart: with 8 heats, heat 1 has seeds 1, 16, 17 and 32.
 */
export function snakeHeats(ids: string[], size: number): string[][] {
  const n = Math.ceil(ids.length / size);
  const heats: string[][] = Array.from({ length: n }, () => []);
  ids.forEach((id, i) => {
    const pass = Math.floor(i / n);
    const k = i % n;
    heats[pass % 2 ? n - 1 - k : k].push(id);
  });
  return heats;
}

/**
 * Where each seed's heat sits in a bracket of n heats (n a power of two), top to bottom: for 8,
 * seeds 1, 8, 4, 5, 2, 7, 3, 6, so seeds 1 and 2 can only meet in the final.
 */
export function bracketOrder(n: number): number[] {
  let order = [1];
  while (order.length < n) order = order.flatMap((s) => [s, 2 * order.length + 1 - s]);
  return order;
}

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

export class Knockout {
  readonly field: Entrant[];
  readonly rules: KnockoutRules;
  readonly cls: string;
  seeding: SeedingRecord | null = null;
  /** Everyone by seeding time, fastest first. */
  seedOrder: string[] = [];
  readonly rounds: KnockoutRound[] = [];
  /** The player's XP from each run they rode, seeding first. */
  readonly xp: Record<string, number>[] = [];
  /** How many runs the player rode and won, for their counters. */
  playerRuns = 0;
  playerWins = 0;
  private readonly rng: () => number;

  constructor(
    private readonly rc: RaceContent,
    readonly venue: VenueDef,
    player: Entrant,
    readonly seed: number,
    /** The entry fee paid, in pence. */
    readonly entry: number,
    /** TEST ONLY, REMOVE BEFORE RELEASE (Boss, 30 Oct 2026): no CPU riders, to test ride a track. */
    alone = false,
  ) {
    this.cls = venue.class ?? '50cc';
    this.rules = { ...KNOCKOUT_DEFAULTS, ...rc.racing.sim.knockout };
    this.rng = seededRng(seed);
    // The pool's best riders, drawn in the day's order so equal levels vary.
    const cpus = alone ? [] : drawPool(rc, venue, seed, Infinity).sort((a, b) => b.level - a.level).slice(0, KNOCKOUT_FIELD - 1);
    this.field = [player, ...cpus.map((d) => cpuEntrant(rc, buffRider(d, this.rules.buff), this.cls))];
  }

  get track() {
    return trackById(this.rc, this.venue.track!);
  }

  get player(): Entrant {
    return this.field.find((e) => e.player)!;
  }

  private entrant(id: string): Entrant {
    return this.field.find((e) => e.id === id)!;
  }

  // ---- seeding ----

  /**
   * The seeding run: everyone on their own, the seeding interval apart, in a random order except
   * that the player goes second, so only one rider is ahead of them and the screen can move on
   * once they have their time (Boss, 31 Oct 2026).
   */
  startSeeding(message: string): MotoSim {
    const order = shuffle(this.field.map((e) => e.id).filter((id) => id !== PLAYER_ID), this.rng);
    if (this.field.some((e) => e.id === PLAYER_ID)) order.splice(Math.min(1, order.length), 0, PLAYER_ID);
    order.forEach((id, i) => (this.entrant(id).gate = i));
    return new MotoSim(this.rc.racing, this.rc.bikes, this.track, this.cls, this.field, {
      laps: 1,
      motoIndex: 0,
      seed: mixSeed(this.seed, 0x73656564),
      message,
      interval: this.rules.seedInterval,
      noiseScale: this.rules.noise,
    });
  }

  /** Records the seeding run and draws up the first round. */
  finishSeeding(sim: MotoSim): SeedingRecord {
    const rows = sim.riders.map((r) => ({ r, time: r.retired ? null : (r.lapTimes[0] ?? null) }));
    rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.r.e.gate - b.r.e.gate);
    const pole = rows[0]?.time ?? null;
    const results: RiderResult[] = rows.map(({ r, time }, i) => ({
      id: r.e.id,
      name: r.e.name,
      tag: r.e.tag,
      player: r.e.player,
      position: i + 1,
      laps: r.laps,
      time: r.time,
      bestLap: time,
      retired: r.retired,
      reason: r.reason,
      gap: time === null ? 'No time' : i === 0 || pole === null ? formatTime(time, 3) : `+${(time - pole).toFixed(3)}s`,
    }));
    this.seeding = { results, xp: { ...sim.xp } };
    this.xp.push(this.seeding.xp);
    if (sim.playerBike) this.player.bike = sim.playerBike;
    this.seedOrder = results.map((r) => r.id);
    this.drawRound(this.seedOrder);
    return this.seeding;
  }

  /**
   * The next round. The first is snaked from the seeding times and laid out as a bracket; after
   * that each heat is the riders through from the two heats beside it in the round before, as on
   * a drawn bracket (Boss, 30 Oct 2026). A field that does not fill a bracket is snaked afresh.
   */
  private drawRound(ids: string[]): void {
    const inSeedOrder = this.seedOrder.filter((id) => ids.includes(id));
    const final = inSeedOrder.length <= this.rules.heatSize;
    const prev = this.rounds.at(-1);
    const bySeed = (a: string, b: string) => this.seedOrder.indexOf(a) - this.seedOrder.indexOf(b);
    let groups: string[][];
    if (prev && isPow2(prev.heats.length) && prev.heats.length > 1 && 2 * this.rules.through <= this.rules.heatSize) {
      groups = [];
      for (let i = 0; i < prev.heats.length; i += 2) groups.push([...prev.heats[i].through, ...prev.heats[i + 1].through].sort(bySeed));
    } else if (final) groups = [inSeedOrder];
    else {
      groups = snakeHeats(inSeedOrder, this.rules.heatSize);
      if (isPow2(groups.length)) groups = bracketOrder(groups.length).map((s) => groups[s - 1]);
    }
    const round = this.rounds.length;
    this.rounds.push({ name: roundName(groups.length, inSeedOrder.length), final: groups.length === 1, heats: groups.map((riders, index) => ({ round, index, riders, runs: [], through: [] })) });
  }

  // ---- heats ----

  /** True once the final is over. */
  get done(): boolean {
    const last = this.rounds.at(-1);
    return !!last?.final && this.isOver(last.heats[0]);
  }

  /** True once a heat has had all its runs. */
  isOver(heat: KnockoutHeat): boolean {
    return heat.runs.length >= (this.rounds[heat.round].final ? this.rules.finalRuns : 1);
  }

  /** The next heat to ride, in order, or null when the day is done. */
  get next(): KnockoutHeat | null {
    for (const r of this.rounds) for (const h of r.heats) if (!this.isOver(h)) return h;
    return null;
  }

  /** True while the player is still in: in a heat still to ride. */
  get playerIn(): boolean {
    const h = this.next;
    return !!h && h.riders.includes(PLAYER_ID);
  }

  /**
   * Gates for a heat's next run: riders pick in seed order (in the final after its first run, in
   * order on points), each CPU rider taking a gate of their own liking from those left. Returns
   * the gates taken before the player's pick and the ones left for them.
   */
  gatesForPlayer(heat: KnockoutHeat): { taken: Map<number, string>; free: number[] } {
    const taken = new Map<number, string>();
    for (const id of this.pickOrder(heat)) {
      if (id === PLAYER_ID) break;
      taken.set(this.cpuGate(heat, id, taken), id);
    }
    return { taken, free: [...Array(this.rules.heatSize).keys()].filter((g) => !taken.has(g)) };
  }

  /** The order riders pick gates for a heat's next run. */
  pickOrder(heat: KnockoutHeat): string[] {
    if (!heat.runs.length) return [...heat.riders];
    const pts = this.points(heat);
    return [...heat.riders].sort((a, b) => (pts.get(a) ?? 0) - (pts.get(b) ?? 0) || heat.riders.indexOf(a) - heat.riders.indexOf(b));
  }

  private cpuGate(heat: KnockoutHeat, id: string, taken: Map<number, string>): number {
    const rng = seededRng(mixSeed(this.seed, hashId(id) + 977 * (heat.round * 16 + heat.index) + 31 * heat.runs.length));
    const free = [...Array(this.rules.heatSize).keys()].filter((g) => !taken.has(g));
    return free[Math.floor(rng() * free.length)];
  }

  /** Puts every rider in the heat on their gate, the player on theirs (one of gatesForPlayer().free). */
  assignGates(heat: KnockoutHeat, playerGate?: number): void {
    const taken = new Map<number, string>();
    for (const id of this.pickOrder(heat)) {
      const g = id === PLAYER_ID && playerGate !== undefined ? playerGate : this.cpuGate(heat, id, taken);
      if (taken.has(g)) throw new RangeError(`Gate ${g + 1} is already taken`);
      taken.set(g, id);
    }
    for (const [g, id] of taken) this.entrant(id).gate = g;
  }

  /** The simulation for a heat's next run, its gates assigned. The caller runs it. */
  startHeat(heat: KnockoutHeat, message: string, playerGate?: number): MotoSim {
    this.assignGates(heat, playerGate);
    const riders = heat.riders.map((id) => this.entrant(id));
    return new MotoSim(this.rc.racing, this.rc.bikes, this.track, this.cls, riders, {
      laps: 1,
      motoIndex: heat.round,
      seed: mixSeed(this.seed, 1 + heat.round * 64 + heat.index * 4 + heat.runs.length),
      message,
      noiseScale: this.rules.noise,
    });
  }

  /** Records a run of the heat; once the heat is over, who goes through, and the next round once the round is over. */
  finishHeat(heat: KnockoutHeat, sim: MotoSim): RiderResult[] {
    const results = sim.results();
    heat.runs.push(results);
    if (sim.player) {
      const me = results.find((r) => r.player)!;
      const bonus = sim.finishBonus(me.position);
      this.xp.push(sumXp(sim.xp, bonus));
      this.playerRuns += me.retired ? 0 : 1;
      if (!me.retired && me.position === 1) this.playerWins += 1;
      if (sim.playerBike) this.player.bike = sim.playerBike;
    }
    if (!this.isOver(heat)) return results;
    const round = this.rounds[heat.round];
    if (round.final) {
      const pts = this.points(heat);
      const last = new Map(results.map((r) => [r.id, r.position]));
      heat.through = [...heat.riders].sort((a, b) => pts.get(a)! - pts.get(b)! || last.get(a)! - last.get(b)!);
    } else heat.through = results.filter((r) => !r.retired).slice(0, this.rules.through).map((r) => r.id);
    if (!round.final && round.heats.every((h) => this.isOver(h))) this.drawRound(round.heats.flatMap((h) => h.through));
    return results;
  }

  /** Runs a heat with nobody watching: the CPU riders' own heats. */
  autoRun(heat: KnockoutHeat): void {
    while (!this.isOver(heat)) {
      const sim = this.startHeat(heat, 'steady');
      sim.runToEnd();
      this.finishHeat(heat, sim);
    }
  }

  /** Runs every heat before the player's next one (or all of them once the player is out). Returns the heats run. */
  runUntilPlayer(): KnockoutHeat[] {
    const ran: KnockoutHeat[] = [];
    for (let h = this.next; h && !h.riders.includes(PLAYER_ID); h = this.next) {
      this.autoRun(h);
      ran.push(h);
    }
    return ran;
  }

  /** The final's points so far for each rider in a heat (each run's place; a retirement scores last place). */
  points(heat: KnockoutHeat): Map<string, number> {
    const out = new Map(heat.riders.map((id) => [id, 0]));
    for (const run of heat.runs) for (const r of run) out.set(r.id, (out.get(r.id) ?? 0) + finalPoints(r.retired ? heat.riders.length : r.position));
    return out;
  }

  // ---- the day ----

  /**
   * Everyone's place: the final's four on points, then those out in the semi-finals, then the
   * round before, and so on; riders out in the same round by their place in their heat, then
   * their seeding time.
   */
  places(): KnockoutPlace[] {
    const out: KnockoutPlace[] = [];
    const placed = new Set<string>();
    const seed = (id: string) => this.seedOrder.indexOf(id);
    const name = (id: string) => this.entrant(id).name;
    for (let ri = this.rounds.length - 1; ri >= 0; ri--) {
      const round = this.rounds[ri];
      if (round.final) {
        const heat = round.heats[0];
        const pts = this.points(heat);
        const order = heat.through.length ? heat.through : [...heat.riders].sort((a, b) => seed(a) - seed(b));
        for (const id of order) {
          out.push({ id, name: name(id), player: id === PLAYER_ID, position: out.length + 1, reached: 'Final', points: pts.get(id) });
          placed.add(id);
        }
        continue;
      }
      const outHere: { id: string; place: number }[] = [];
      for (const h of round.heats) {
        const res = h.runs.at(-1) ?? [];
        h.riders.forEach((id) => {
          if (placed.has(id) || h.through.includes(id)) return;
          const r = res.find((x) => x.id === id);
          outHere.push({ id, place: r && !r.retired ? r.position : h.riders.length + 1 });
        });
      }
      outHere.sort((a, b) => a.place - b.place || seed(a.id) - seed(b.id));
      for (const { id } of outHere) {
        out.push({ id, name: name(id), player: id === PLAYER_ID, position: out.length + 1, reached: round.name });
        placed.add(id);
      }
    }
    // Anyone never placed (a day left early): last, in seeding order.
    for (const id of [...this.seedOrder, ...this.field.map((e) => e.id)]) {
      if (placed.has(id)) continue;
      out.push({ id, name: name(id), player: id === PLAYER_ID, position: out.length + 1, reached: 'Seeding' });
      placed.add(id);
    }
    return out;
  }

  /** The player's place, prize and XP for the day: prize money as two motos at that place, plus the podium bonus. */
  dayResult(): { places: KnockoutPlace[]; position: number; prize: number; podiumBonus: number; xp: Record<string, number> } {
    const places = this.places();
    const position = places.find((p) => p.player)!.position;
    const purse = pence(this.rc.racing.classes[this.cls].entry);
    const prize = 2 * motoPrize(this.rc.racing, purse, position);
    const podiumBonus = Math.round(purse * (this.rc.racing.prize.podium[position - 1] ?? 0));
    return { places, position, prize, podiumBonus, xp: scaleXp(sumXp(...this.xp), 1) };
  }
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
