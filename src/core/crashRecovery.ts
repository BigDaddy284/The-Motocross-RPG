// After a crash (Boss, 30 Oct 2026): the rider is thrown a short way from the bike, lies there a
// moment, gets up, runs back to it, picks it up and gets on, then rides off. The referee (race.ts)
// says how long the crash costs; this splits that time into the steps the race view acts out.
// Any time beyond what the steps need is spent down (a big crash keeps you down longer); a crash
// that costs less than the steps need plays them all, quicker.

export type DownPhase = 'thrown' | 'down' | 'up' | 'run' | 'lift' | 'mount';

/** Each step and the seconds it takes at its own pace. */
export const STEPS: readonly (readonly [DownPhase, number])[] = [
  ['thrown', 0.7],
  ['down', 0.4],
  ['up', 0.5],
  ['run', 0.8],
  ['lift', 0.8],
  ['mount', 0.5],
];
/** Seconds the whole recovery takes at its own pace. */
export const RECOVERY = STEPS.reduce((a, [, s]) => a + s, 0);

/** Where a rider is t seconds into a crash that costs `lost` seconds: the step, and how far through it (0 to 1). */
export function downPhase(t: number, lost: number): { phase: DownPhase; k: number } {
  const scale = lost < RECOVERY ? lost / RECOVERY : 1;
  const extra = Math.max(0, lost - RECOVERY);
  let at = 0;
  for (const [phase, secs] of STEPS) {
    const len = secs * scale + (phase === 'down' ? extra : 0);
    if (t < at + len) return { phase, k: Math.max(0, (t - at) / len) };
    at += len;
  }
  return { phase: 'mount', k: 1 };
}
