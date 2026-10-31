import { mixSeed, seededRng } from './race';
import type { RiderProfile } from './riderProfile';

// Whips and scrubs over the jumps (Boss, 30 Oct 2026): the more skilled jumpers throw the bike
// sideways in the air on the bigger hops, a whip (kicked out at the top and straightened for the
// landing) or a scrub (laid down low off the lip so the bike stays flat and fast). At least one
// pool rider in every race is a showman who does them on most big hops, to show what is to come.
// A trick on the hop where the referee (race.ts) gave a mistake doesn't come back straight: the
// rider lands crossed up and goes down, or saves it with a wobble. Like the rest of the race view
// it is all drawn from seeds, so it never changes a result and a race always looks the same.

export interface Trick {
  kind: 'whip' | 'scrub';
  /** Which way the bike is thrown: 1 or -1. */
  dir: 1 | -1;
  /** How far, 0.6 (a tidy one) to 1 (laid flat). */
  size: number;
  /** Over-done on a mistake: it never comes back straight for the landing. */
  bail?: boolean;
}

/**
 * The player's tricks come with their Rider Ability level (Boss, 30 Oct 2026): whips from level 30,
 * a rare one at first and more often each level up to `max` at level 70; scrubs from level 60 the
 * same way, up to `max` at 99. The level builds in the background, but the player throws none
 * until the Rider Trainer (an NPC planned for Area 3) has taught them, which sets TRICKS_FLAG in the
 * save; nothing sets it yet, so for now only the CPU riders throw them.
 */
/** The save flag the Rider Trainer sets once they have taught the player whips and scrubs. */
export const TRICKS_FLAG = 'rider_trainer_tricks';

export const PLAYER_TRICKS = {
  whip: { from: 30, full: 70 },
  scrub: { from: 60, full: 99 },
  /** The chance on a big hop at the first level a trick comes in. */
  min: 0.05,
  /** The chance on a big hop once fully learned. */
  max: 0.7,
} as const;

/** Hops shorter than this many metres are too short to throw the bike about on. */
export const TRICK_HOP = 9;
/** A jumper (RiderProfile.jump) from here up does tricks some of the time, more the better they are. */
export const TRICK_JUMP = 0.4;
/** How often the showman throws one on a big hop. */
const SHOWMAN = 0.85;
/** How flat a scrub launches, as a share of the rider's usual launch (Flight.launch). */
export const SCRUB_LAUNCH = 0.45;

/**
 * The rider who shows off the most in a field: the best jumper who isn't the player. Null when
 * every rider is the player (practice on your own).
 */
export function showmanOf(profiles: Iterable<RiderProfile>): string | null {
  let best: RiderProfile | null = null;
  for (const p of profiles) {
    if (p.player) continue;
    if (!best || p.jump > best.jump || (p.jump === best.jump && p.seed < best.seed)) best = p;
  }
  return best?.id ?? null;
}

/** How likely the player at a Rider Ability level is to whip, and to scrub, on a big hop (PLAYER_TRICKS). */
export function playerTricks(level: number): { whip: number; scrub: number } {
  const ramp = ({ from, full }: { from: number; full: number }) =>
    level < from ? 0 : PLAYER_TRICKS.min + (PLAYER_TRICKS.max - PLAYER_TRICKS.min) * Math.min(1, (level - from) / (full - from));
  return { whip: ramp(PLAYER_TRICKS.whip), scrub: ramp(PLAYER_TRICKS.scrub) };
}

/**
 * How likely a rider is to throw a trick on a big hop: the showman most times, a skilled jumper
 * sometimes, the player by their Rider Ability level, everyone else never.
 */
export function trickChance(p: RiderProfile, showman: boolean): number {
  if (showman) return SHOWMAN;
  if (p.player) {
    if (p.riderLevel === undefined) return 0;
    const { whip, scrub } = playerTricks(p.riderLevel);
    return Math.max(whip, scrub);
  }
  if (p.jump < TRICK_JUMP) return 0;
  return Math.min(0.7, 0.15 + (p.jump - TRICK_JUMP));
}

/**
 * The trick a rider throws on one hop, or null: drawn from their seed, the lap, the section and
 * the hop. `metres` is the hop's length; `nextTurn` the way the track turns next (positive right).
 */
export function trickFor(p: RiderProfile, showman: boolean, lap: number, si: number, hop: number, metres: number, nextTurn = 0): Trick | null {
  if (metres < TRICK_HOP) return null;
  const chance = trickChance(p, showman);
  if (chance <= 0) return null;
  const rnd = seededRng(mixSeed(mixSeed(mixSeed(Math.floor(p.seed * 4294967296), lap + 1), si + 7), hop + 3));
  if (rnd() >= chance) return null;
  // Scrubbers scrub, floaters whip; a showman mixes them up. The player throws only what their level has
  // brought in, the newer trick less often.
  const learned = p.player && !showman ? playerTricks(p.riderLevel ?? 0) : null;
  const scrub = learned ? rnd() < learned.scrub / (learned.whip + learned.scrub) : rnd() < Math.max(showman ? 0.4 : 0, 0.2 + 0.6 * p.scrub);
  // Each rider has a side they like to throw it, and now and then goes the other way.
  const side: 1 | -1 = p.seed * 97 - Math.floor(p.seed * 97) < 0.5 ? 1 : -1;
  let dir: 1 | -1 = rnd() < 0.8 ? side : (-side as 1 | -1);
  // A scrub is thrown towards the next corner, so the bike lands pointing into it.
  if (scrub && nextTurn) dir = nextTurn > 0 ? 1 : -1;
  const size = Math.min(1, 0.6 + 0.25 * rnd() + (showman ? 0.15 : 0.1 * p.jump));
  return { kind: scrub ? 'scrub' : 'whip', dir, size };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * How the bike is turned at k through a trick, in radians: yaw (nose turned across the line of
 * flight, negative to the rider's right) and roll (laid over, positive to the right). k runs from
 * 0 at the lip to 1 on landing; a scrub starts on the face, from k = -1 (APPROACH before the lip).
 *
 * After real riding (Ben Townley's whip how-to in Transmoto, ADB's scrub how-to):
 * - A whip leaves the lip straight, then the rear swings out round the headstock and the bike
 *   lies almost flat just past the top; it comes back upright on the way down, rear wheel first,
 *   and often lands a touch crossed up.
 * - A scrub is done on the face: the bike is leaned over and the bars turned into the next corner
 *   before the lip, so it leaves low and flat; it stands up through the hop and lands upright,
 *   already pointing at the turn.
 * A bail is overdone and never comes all the way back: it lands crossed up and on its side.
 */
export function trickPose(t: Trick, k: number): { yaw: number; roll: number } {
  let out: number;
  let yaw: number;
  let roll: number;
  if (t.kind === 'whip') {
    out = smooth((k - 0.08) / 0.38) * (1 - (t.bail ? 0.3 : 0.92) * smooth((k - 0.55) / 0.37));
    yaw = 0.75;
    roll = 1.15;
  } else {
    out = k < 0 ? 0.75 * smooth(k + 1) : (0.75 + 0.25 * smooth(k / 0.12)) * (1 - (t.bail ? 0.3 : 1) * smooth((k - 0.15) / 0.5));
    yaw = 0.35;
    roll = 1.0;
  }
  const a = out * t.size * t.dir;
  return { yaw: -a * yaw, roll: a * roll };
}

/** How far before the lip a scrub starts leaning over, in metres. */
export const APPROACH = 4;
