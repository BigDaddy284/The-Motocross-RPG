import { describe, expect, it } from 'vitest';
import { newCareerState, pence, type CareerState } from '../src/core/career';
import { averageCondition, challengeField, lossHint, challengePrize, challengeReady, payChallenge, rigChallenge, winChance, type ChallengeDef } from '../src/core/challenge';
import { checkContent } from '../src/core/content';
import { seededRng } from '../src/core/race';
import { playerEntrant } from '../src/core/raceDay';
import { loadManifest, loadMaps, rawContent } from './helpers';

const content = checkContent(rawContent(), loadManifest(), loadMaps()).content!;
const byId = (id: string) => content.challenges.challenges.find((c) => c.id === id)!;
const home = byId('home');
const industrial = byId('industrial');

function rider(condition: number): CareerState {
  const c = newCareerState(content.bikes, content.story, 'hondmoto', () => 0.5);
  for (const s of content.bikes.slots) c.bike.parts[s.id] = { grade: 1, condition };
  return c;
}

/** The challenge on a track that exists, to race it before its own track is built. */
const onFarmland = (def: ChallengeDef): ChallengeDef => ({ ...def, track: 'farmland', map: 'venue-motocross' });

describe('challenges (Boss, 28 Oct 2026)', () => {
  it('walks off with a general hint after a loss: the bike in Area 1, or just unlucky when it is in good shape', () => {
    const h = (cond: number, def = home, skills = { riding: 1, fitness: 1 }) => lossHint(content.challenges, def, content.bikes, rider(cond).bike, skills, 10);
    expect(h(0.5)).toBe('challenge_hint.bike');
    expect(h(0.74)).toBe('challenge_hint.bike');
    expect(h(0.75)).toBe('challenge_hint.unlucky');
    expect(h(1)).toBe('challenge_hint.unlucky');
    // From Area 2, riding and then fitness count once the bike is fine.
    const area2 = { ...home, area: 2 };
    expect(h(0.5, area2)).toBe('challenge_hint.bike');
    expect(h(0.9, area2)).toBe('challenge_hint.riding');
    expect(h(0.9, area2, { riding: 12, fitness: 1 })).toBe('challenge_hint.fitness');
    expect(h(0.9, area2, { riding: 12, fitness: 12 })).toBe('challenge_hint.unlucky');
    // General: never names a part.
    for (const k of ['bike', 'riding', 'fitness', 'unlucky'] as const) {
      const text = content.dialogue[content.challenges.hints[k]].lines.map((l) => l.text).join(' ');
      for (const slot of content.bikes.slots) expect(text.toLowerCase()).not.toContain(slot.name.toLowerCase());
    }
  });

  it('Mickey is £50 against 7 others over 3 laps, Dan is £70 one on one', () => {
    expect(home).toMatchObject({ npc: 'npc.challenger_home', entry: 50, laps: 3, others: 6 });
    expect(challengeField(content, home, 1)).toHaveLength(7);
    expect(challengeField(content, home, 1)[0].id).toBe(home.challenger);
    expect(industrial).toMatchObject({ npc: 'npc.challenger_iz', entry: 70, laps: 3, others: 0 });
    expect(challengeField(content, industrial, 1).map((r) => r.id)).toEqual([industrial.challenger]);
  });

  it("stays shut with the building line until the challenge's track is in the game", () => {
    expect(challengeReady(content, { ...home, track: 'challenge-unbuilt' })).toBe(false);
    // Mickey's and Dan's tracks are both in the game (Boss, 29 Oct 2026).
    expect(challengeReady(content, home)).toBe(true);
    expect(challengeReady(content, industrial)).toBe(true);
    expect(challengeReady(content, onFarmland(home))).toBe(true);
  });

  it('averages condition across the bike: a part at 100% and one at 40% count as two at 70%', () => {
    const c = rider(0.7);
    c.bike.parts.frame.condition = 1;
    c.bike.parts.top_end.condition = 0.4;
    expect(averageCondition(content.bikes, c.bike)).toBeCloseTo(0.7);
  });

  it('is 50% on a 50cc with every part at 75%, more with better parts, never 100%', () => {
    expect(winChance(home, content.bikes, rider(0.75).bike)).toBeCloseTo(0.5);
    expect(winChance(home, content.bikes, rider(0.5).bike)).toBeCloseTo(0.25);
    expect(winChance(home, content.bikes, rider(1).bike)).toBeCloseTo(0.75);
    expect(winChance(home, content.bikes, rider(0).bike)).toBeCloseTo(home.odds.floor);
    // A bigger class is easier, up to its cap, and no cap reaches 100%.
    const big = { ...rider(1).bike, class: '85cc-small' };
    expect(winChance(home, content.bikes, big)).toBeLessThan(1);
    expect(winChance(home, content.bikes, big)).toBeGreaterThan(0.9);
  });

  it('pays the entry back plus the same again for a win, nothing for anything else', () => {
    expect(challengePrize(home, 1, false)).toBe(pence(100));
    expect(challengePrize(home, 2, false)).toBe(0);
    expect(challengePrize(home, 1, true)).toBe(0);
    const c = rider(0.75);
    c.money = pence(40);
    expect(payChallenge(c, home)).toBe(pence(10));
    expect(c.money).toBe(pence(40));
    c.money = pence(60);
    expect(payChallenge(c, home)).toBe(0);
    expect(c.money).toBe(pence(10));
  });

  it('wins about as often as the chance says, whoever is in the field', () => {
    for (const def of [onFarmland(home), onFarmland(industrial)]) {
      const c = rider(0.75);
      const rng = seededRng(42);
      let wins = 0;
      let matched = 0;
      let dnfs = 0;
      const n = 40;
      for (let i = 0; i < n; i++) {
        const rig = rigChallenge(content, def, playerEntrant(content, c, 'Test'), 'steady', rng);
        const sim = rig.day.startMoto('steady');
        sim.runToEnd();
        const me = sim.results().find((r) => r.player)!;
        const won = me.position === 1 && !me.retired;
        if (won === rig.win) matched++;
        if (won) wins++;
        if (me.retired) dnfs++;
        expect(rig.day.field).toHaveLength(def.others + 2);
        expect(rig.day.laps).toBe(3);
        expect(rig.day.motoCount).toBe(1);
      }
      // The moto plays out as rolled (the same seed replays it exactly), and about half are wins.
      expect(matched).toBeGreaterThanOrEqual(n - 2);
      expect(wins).toBeGreaterThan(n * 0.25);
      expect(wins).toBeLessThan(n * 0.75);
      // Losses are beaten on the track, not picked from motos where the bike gives out.
      expect(dnfs).toBeLessThanOrEqual(2);
    }
  });

  it('the challenger takes first whenever the rider loses (Boss, 29 Oct 2026)', () => {
    for (const def of [home, industrial]) {
      for (const cond of [0.3, 0.75]) {
        const c = rider(cond);
        const rng = seededRng(7);
        let losses = 0;
        let challengerFirst = 0;
        for (let i = 0; i < 30; i++) {
          const rig = rigChallenge(content, def, playerEntrant(content, c, 'Test'), 'steady', rng);
          if (rig.win) continue;
          losses++;
          const sim = rig.day.startMoto('steady');
          sim.runToEnd();
          if (sim.results().find((r) => r.position === 1)?.id === def.challenger) challengerFirst++;
        }
        expect(losses, `${def.id} at ${cond}`).toBeGreaterThan(0);
        expect(challengerFirst, `${def.id} at ${cond}`).toBe(losses);
      }
    }
  });
});
