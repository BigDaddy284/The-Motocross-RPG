import type { Entrant, MessageDef } from './race';

// How a rider rides on the race screen (GDD 11.1): one set of numbers per rider, worked out from
// their skills, their bike's stats, their race message and an optional riding style. The race
// simulation decides the results; the rider AI (riderAI.ts) uses these numbers to act them out,
// so the same AI drives any rider on any bike. Nothing here changes a result.

export interface RiderStyle {
  /** The line this rider likes through corners. */
  line?: 'inside' | 'middle' | 'outside';
  /** 0 (patient) to 1 (dives up the inside at every chance). */
  aggression?: number;
  /** scrub: low, flat jumps. float: high, floaty jumps. */
  jumps?: 'scrub' | 'float';
}

export interface RiderProfile {
  id: string;
  /** Corner line: -1 outside, 0 middle, 1 inside. */
  line: number;
  /** 0 to 1: how hard and how wide this rider swings out to pass, and how close they follow. */
  aggression: number;
  /** 0 to 1: how much speed they carry through corners (1 barely slows down). */
  cornerSpeed: number;
  /** 0 to 1: how low and flat they jump (1 skims every jump). */
  scrub: number;
  /** 0 to 1: how smoothly they skim whoops and bumps. */
  skim: number;
  /** 0 to 1: how much they move about on the track (low consistency wanders). */
  wobble: number;
  /** 0 to 1: how hard the bike drives out of corners (power and response). */
  drive: number;
  /** 0 to 1: how quickly they change line (handling and balance). */
  agility: number;
  /** Where on the track this rider sits on the straights, -0.6 to 0.6. */
  lane: number;
  /** A per-rider number for small differences that should stay the same all race. */
  seed: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const LINES = { outside: -1, middle: 0, inside: 1 } as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** A rider's profile from their skills (levels 1 to 99), bike stats (0 to ceiling) and message. */
export function riderProfile(e: Entrant, stats: Record<string, number>, ceiling: number, message?: MessageDef): RiderProfile {
  const sk = (id: string) => (e.skills[id] ?? 1) / 99;
  const st = (id: string) => clamp01((stats[id] ?? 0) / Math.max(1, ceiling));
  const style = e.style ?? {};
  const seed = hash(e.id);
  const msg = message ?? { pace: 0, risk: 0, overtaking: 0, consistency: 0 };
  const aggression = style.aggression ?? clamp01(0.3 + 0.45 * sk('overtaking') + 0.08 * msg.risk + 0.06 * msg.overtaking + 0.15 * (seed - 0.5));
  // Better cornering riders hold a tighter inside line; the rest spread out, with a little of their own taste.
  const line = style.line ? LINES[style.line] : Math.max(-1, Math.min(1, 1.6 * sk('cornering') + (seed - 0.5) * 0.8 - 0.2));
  const scrubBase = 0.15 + 0.7 * sk('jumps_ruts');
  const scrub = style.jumps === 'scrub' ? Math.max(scrubBase, 0.8) : style.jumps === 'float' ? Math.min(scrubBase, 0.15) : scrubBase;
  return {
    id: e.id,
    line,
    aggression,
    cornerSpeed: clamp01(0.25 + 0.5 * sk('cornering') + 0.25 * st('grip') + 0.05 * msg.pace),
    scrub,
    skim: clamp01(0.2 + 0.5 * sk('balance') + 0.3 * st('absorption')),
    wobble: clamp01(0.6 - 0.5 * sk('consistency') - 0.1 * msg.consistency),
    drive: clamp01(0.5 * st('power') + 0.5 * st('response')),
    agility: clamp01(0.3 + 0.35 * st('handling') + 0.35 * sk('balance')),
    lane: (hash(`${e.id}:lane`) - 0.5) * 1.2,
    seed,
  };
}
