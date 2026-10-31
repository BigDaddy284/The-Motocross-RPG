// Fireworks over the finish arch as the winner finishes (Boss, 30 Oct 2026): at Supercross,
// EnduroCross and No-Turn Takedown tracks, rockets go up from the arch's posts a little before the
// race winner crosses the finish line, and burst over it for a few seconds after.
//
// The race view draws them (world/RaceView.ts); this file says when they start and the show they
// put on, the same every race.
import type { RiderState } from './riderAI';

/** The track kinds (trackParts.json) whose finish arch has fireworks: Supercross, EnduroCross and No-Turn Takedown. */
export const FIREWORK_KINDS = new Set(['stadium', 'endurocross', 'no_turn']);
/** How far before the finish line (grid units) the winner is when the first rockets go up. */
export const FIREWORK_LEAD = 14;
/** Race seconds a rocket climbs before it bursts. */
export const ROCKET_RISE = 0.7;

/** One rocket in the show. */
export interface Rocket {
  /** Race seconds after the show starts that it goes up. */
  t: number;
  /** Which of the arch's posts it goes up from: -1 or 1. */
  side: number;
  /** How high over the arch it bursts, in grid units. */
  height: number;
  /** How far it drifts out over the track as it climbs (grid units, from its post towards the middle and past). */
  drift: number;
  /** Its burst's colour. */
  color: number;
  /** How many sparks it bursts into. */
  sparks: number;
}

/** Firework colours: red, gold, green, blue, violet and white. */
export const FIREWORK_COLOURS = [0xff4a3a, 0xffc93a, 0x5aff6a, 0x4aa8ff, 0xd46aff, 0xffffff];

interface Runner {
  dist: number;
  state: RiderState;
}

/** True when this kind of track has fireworks at its finish arch. */
export function hasFireworks(kind: string | undefined): boolean {
  return FIREWORK_KINDS.has(kind ?? '');
}

/**
 * True once the show should be on for a race of `laps` laps: the leader still racing is within
 * `lead` (a lap fraction) of the finish line on the last lap, or over it. Never in practice (no laps).
 */
export function fireworksDue(laps: number | undefined, lead: number, riders: Runner[]): boolean {
  if (!laps || laps < 1) return false;
  let leader = -Infinity;
  for (const r of riders) if (r.state !== 'retired') leader = Math.max(leader, r.dist);
  return leader >= laps - lead;
}

/**
 * The show: a salvo from both posts as the winner comes up to the line, then rockets going up from
 * alternate posts, quicker towards the end, and a last salvo from both. About six seconds long.
 */
export function fireworkShow(): Rocket[] {
  const out: Rocket[] = [];
  const rnd = (i: number) => {
    const x = Math.sin(i * 91.7 + 17.3) * 43758.5453;
    return x - Math.floor(x);
  };
  const add = (t: number, side: number, i: number) =>
    out.push({
      t,
      side,
      height: 4 + rnd(i) * 3,
      drift: 0.5 + rnd(i + 50) * 2,
      color: FIREWORK_COLOURS[Math.floor(rnd(i + 100) * FIREWORK_COLOURS.length)],
      sparks: 36 + Math.floor(rnd(i + 150) * 24),
    });
  add(0, -1, 0);
  add(0.05, 1, 1);
  let t = 0.6;
  for (let i = 2; i < 14; i++) {
    add(t, i % 2 ? 1 : -1, i);
    t += 0.45 - i * 0.02;
  }
  for (let i = 14; i < 18; i++) add(t + (i - 14) * 0.08, i % 2 ? 1 : -1, i);
  return out;
}
