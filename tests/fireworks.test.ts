import { describe, expect, it } from 'vitest';
import { fireworkShow, fireworksDue, hasFireworks } from '../src/core/fireworks';

// Fireworks over the finish arch as the winner finishes, at Supercross, EnduroCross and No-Turn Takedown tracks (Boss, 30 Oct 2026).
describe('finish fireworks', () => {
  it('go off at Supercross, EnduroCross and No-Turn Takedown tracks only', () => {
    expect(['stadium', 'endurocross', 'no_turn'].every(hasFireworks)).toBe(true);
    expect(['outdoor', 'endurance', 'enduro_sprint', undefined].some(hasFireworks)).toBe(false);
  });

  it('start a little before the winner crosses the line on the last lap', () => {
    const lead = 0.05;
    const at = (dist: number) => [{ dist, state: 'riding' as const }, { dist: dist - 0.3, state: 'riding' as const }];
    expect(fireworksDue(3, lead, at(2.9))).toBe(false);
    expect(fireworksDue(3, lead, at(2.96))).toBe(true);
    expect(fireworksDue(3, lead, at(3.2))).toBe(true);
    // Not as the leader comes round on an earlier lap, nor for a rider out of the race, nor in practice.
    expect(fireworksDue(3, lead, at(1.97))).toBe(false);
    expect(fireworksDue(3, lead, [{ dist: 2.99, state: 'retired' }, { dist: 2.5, state: 'riding' }])).toBe(false);
    expect(fireworksDue(undefined, lead, at(2.99))).toBe(false);
  });

  it('puts on the same show every race, opening with a salvo from both posts', () => {
    const show = fireworkShow();
    expect(show).toEqual(fireworkShow());
    expect(show.filter((r) => r.t < 0.1).map((r) => r.side).sort()).toEqual([-1, 1]);
    expect(show.every((r, i) => i === 0 || r.t >= show[i - 1].t)).toBe(true);
    expect(show.at(-1)!.t).toBeLessThan(7);
  });
});
