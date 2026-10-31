import { describe, expect, it } from 'vitest';
import { downPhase, RECOVERY, STEPS } from '../src/core/crashRecovery';
import { race } from './raceHelpers';

describe('getting back on after a crash (Boss, 30 Oct 2026)', () => {
  it('runs thrown, down, up, run, lift, mount in order, within the time the crash costs', () => {
    for (const lost of [1.5, RECOVERY, 8, 25]) {
      const seen: string[] = [];
      for (let t = 0; t < lost; t += 0.01) {
        const { phase, k } = downPhase(t, lost);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(1);
        if (seen.at(-1) !== phase) seen.push(phase);
      }
      expect(seen).toEqual(STEPS.map(([p]) => p));
    }
    // A long crash keeps the rider down longer; the getting going again takes the same time.
    const upAt = (lost: number) => {
      let t = 0;
      while (downPhase(t, lost).phase !== 'up') t += 0.01;
      return lost - t;
    };
    expect(upAt(25)).toBeCloseTo(upAt(8), 1);
  });

  it('every crash in a race is acted out, and the rider rides on once it is over', () => {
    let crashes = 0;
    for (const seed of [1, 2, 3, 5, 8]) {
      const { dir } = race('farmland', seed);
      const was = new Map<string, string>();
      for (let t = 0; t < 400; t += 0.1) {
        for (const p of dir.poses(t)) {
          if (p.state === 'crashed' || p.state === 'remount') {
            expect(p.down).toBeDefined();
            expect(p.down!.t).toBeGreaterThanOrEqual(0);
            expect(p.down!.t).toBeLessThanOrEqual(p.down!.lost + 1e-6);
            expect(p.state === 'remount').toBe(downPhase(p.down!.t, p.down!.lost).phase === 'mount');
          } else {
            expect(p.down).toBeUndefined();
            expect(p.stunt === undefined || p.stunt.t < 0).toBe(true);
          }
          if (was.get(p.id) !== 'crashed' && p.state === 'crashed') crashes++;
          was.set(p.id, p.state);
        }
      }
    }
    expect(crashes).toBeGreaterThan(0);
  }, 30000);
});
