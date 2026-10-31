import { describe, expect, it } from 'vitest';
import { newCareerState, type CareerState } from '../src/core/career';
import { checkChampionships, champById, champRiders, champProblem, drawChampField, enter, finishChampionship, nextRoundVenue, recordRound, roundEntry, roundOptions, roundsHere, standings, titlePossible, withdraw, type ActiveChampionship } from '../src/core/championship';
import { checkContent } from '../src/core/content';
import { PLAYER_ID, RaceDay, playerEntrant } from '../src/core/raceDay';
import { directorFor } from '../src/core/riderAI';
import { SAVE_VERSION, parseSave } from '../src/core/saves';
import { loadManifest, loadMaps, publicFileExists, rawContent } from './helpers';

const content = checkContent(rawContent(), loadManifest(), loadMaps()).content!;
const local = champById(content.championships, 'area1.local_champion')!;
const main = champById(content.championships, 'area1.main')!;
const points = content.racing.points;
const venue = (id: string) => content.tracks.venues.find((v) => v.id === id)!;

function rider(): CareerState {
  const c = newCareerState(content.bikes, content.story, 'hondmoto', () => 0.5);
  c.bike.parts.top_end = { grade: 1, condition: 0.75 };
  return c;
}

/** Rides one round straight through: qualifying, both motos, recorded on the championship. */
function rideRound(career: CareerState, active: ActiveChampionship, seed: number): RaceDay {
  const v = venue(nextRoundVenue(local, active)!);
  const day = new RaceDay(content, v, playerEntrant(content, career, 'Test'), seed, roundEntry(content, local), roundOptions(content, local, active));
  const q = day.startQualifying('steady');
  q.runToEnd();
  day.finishQualifying(q);
  for (let m = 0; m < 2; m++) {
    day.assignGates(day.gatesForPlayer().free[0]);
    const sim = day.startMoto('steady');
    sim.runToEnd();
    day.finishMoto(sim);
  }
  recordRound(active, v, day);
  return day;
}

describe('championships (Spec 12.5, 18.6)', () => {
  it('loads both Area 1 championships: 3 Local Champion rounds, one a track, then 6 for the area', () => {
    expect(local.rounds).toEqual(['venue-farmland', 'venue-riverside', 'venue-longmoor']);
    expect(main.rounds).toHaveLength(6);
    for (const v of ['venue-farmland', 'venue-riverside', 'venue-longmoor']) expect(main.rounds.filter((r) => r === v)).toHaveLength(2);
    expect(main.needs).toContain(local.rewards[0].flag);
    expect(checkChampionships(content.championships, content)).toEqual([]);
  });

  it('has a picture for the Area 1 badge, the knobbly tyre', () => {
    expect(local.rewards[0].image).toBe('art/ui/badge-area1.png');
    for (const c of content.championships.championships) for (const r of c.rewards) if (r.image) expect(publicFileExists(`assets/${r.image}`), r.image).toBe(true);
  });

  it('rejects a round at a venue that has no race day, and a field bigger than its pool', () => {
    const bad = { championships: [{ ...local, rounds: ['backyard', 'nowhere'], size: 60 }] };
    const errs = checkChampionships(bad, content).map((e) => e.field);
    expect(errs).toEqual(expect.arrayContaining(['championships[0].rounds[0]', 'championships[0].rounds[1]', 'championships[0].size']));
  });

  it('opens after the first race day; the Area 1 Championship after the badge, and then not until Area 2 (Boss, 29 Oct 2026)', () => {
    const flags: Record<string, boolean> = { 'found.venue-farmland': true };
    expect(champProblem(content, local, flags)).toMatch(/race day first/);
    flags.first_race_done = true;
    expect(champProblem(content, local, flags)).toBeNull();
    expect(champProblem(content, main, flags)).toMatch(/badge/);
    flags['badge.area1'] = true;
    expect(champProblem(content, main, flags)).toMatch(/Area 2/);
    flags['area2.ready'] = true;
    expect(champProblem(content, main, flags)).toBeNull();
  });

  it('draws the same 15 CPU riders for every round, Louis Jonez always among them and Dean Marsh left to the Area 1 Championship', () => {
    for (const seed of [1, 2, 3, 99]) {
      const f = drawChampField(content, local, seed);
      expect(f).toHaveLength(15);
      expect(new Set(f).size).toBe(15);
      expect(f).not.toContain('cpu.local_champion');
      expect(f).toContain('cpu.local_racer');
      expect(drawChampField(content, main, seed)).toEqual(expect.arrayContaining(['cpu.local_champion', 'cpu.local_racer']));
      expect(drawChampField(content, local, seed)).toEqual(f);
    }
    expect(drawChampField(content, local, 1)).not.toEqual(drawChampField(content, local, 2));
  });

  it('races everyone but the main rider 10% better, and the main rider is still the best (Boss, 28 Oct 2026)', () => {
    for (const def of [local, main]) {
      const active = enter(rider(), content, def, 7);
      const raced = roundOptions(content, def, active).cpus;
      for (const r of raced) {
        const base = content.riders.riders.find((x) => x.id === r.id)!;
        if (r.id === def.main) expect(r).toEqual(base);
        else {
          expect(r.level, r.id).toBe(Math.round(base.level * 1.1));
          expect(r.bike.condition).toBeCloseTo(Math.min(1, base.bike.condition * 1.1));
        }
      }
      const top = raced.find((r) => r.id === def.main)!;
      expect(raced.every((r) => r === top || r.level < top.level), def.id).toBe(true);
    }
    expect(local.main).toBe('cpu.local_racer');
    expect(main.main).toBe('cpu.local_champion');
  });

  it('charges 1.5× the entry and pays 1.8× the prize money', () => {
    expect(roundEntry(content, local)).toBe(3000);
    const career = rider();
    const active = enter(career, content, local, 7);
    const day = new RaceDay(content, venue('venue-farmland'), playerEntrant(content, career, 'Test'), 5, 3000, roundOptions(content, local, active));
    const plain = new RaceDay(content, venue('venue-farmland'), playerEntrant(content, career, 'Test'), 5, 2000);
    expect(day.field).toHaveLength(16);
    expect(plain.field).toHaveLength(16);
    const q = day.startQualifying('steady');
    q.runToEnd();
    day.finishQualifying(q);
    day.assignGates(day.gatesForPlayer().free[0]);
    const sim = day.startMoto('steady');
    sim.runToEnd();
    const rec = day.finishMoto(sim);
    const me = rec.results.find((r) => r.player)!;
    const share = content.racing.prize.shares[me.position - 1] ?? 0;
    if (!me.retired) expect(rec.prize).toBe(Math.round(2000 * 1.8 * content.racing.prize.winnerTimesEntry * share));
  });

  it('qualifies on the best timed lap, after an untimed out lap, and sets moto 1 gate picks in that order', () => {
    const career = rider();
    const active = enter(career, content, local, 11);
    const day = new RaceDay(content, venue('venue-riverside'), playerEntrant(content, career, 'Test'), 21, 3000, roundOptions(content, local, active));
    expect(day.qualifyingDue).toBe(true);
    const sim = day.startQualifying('steady');
    expect(sim.totalLaps).toBe(local.qualifyingLaps + 1);
    sim.runToEnd();
    const rec = day.finishQualifying(sim);
    expect(day.qualifyingDue).toBe(false);
    const times = rec.results.map((r) => r.bestLap ?? Infinity);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const r of rec.results) {
      const laps = sim.riders.find((x) => x.e.id === r.id)!.lapTimes;
      if (laps.length > 1) expect(r.bestLap).toBe(Math.min(...laps.slice(1)));
    }
    expect(day.pickOrder).toEqual(rec.results.map((r) => r.id));
    // The first moto's ruts count qualifying as one step.
    expect(day.startMoto('steady').opts.motoIndex).toBe(1);
  });

  it('races a field saved at the old 19 CPU riders as 15, the main rider kept', () => {
    const career = rider();
    const active = enter(career, content, local, 3);
    active.field = [...active.field.filter((id) => id !== local.main), ...content.riders.fields[local.field].filter((id) => !active.field.includes(id) && !local.without?.includes(id)).slice(0, 4), local.main!];
    expect(active.field).toHaveLength(19);
    const riders = champRiders(content, local, active);
    expect(riders).toHaveLength(15);
    expect(riders.map((r) => r.id)).toContain(local.main);
  });

  it('lines its field of 16 up in two rows of 8, as a race day (Boss, 28 Oct 2026)', () => {
    const career = rider();
    const active = enter(career, content, local, 3);
    const day = new RaceDay(content, venue('venue-longmoor'), playerEntrant(content, career, 'Test'), 8, 3000, roundOptions(content, local, active));
    const q = day.startQualifying('steady');
    q.runToEnd();
    day.finishQualifying(q);
    day.assignGates(day.gatesForPlayer().free.at(-1)!);
    const sim = day.startMoto('steady');
    const dir = directorFor(sim, content.bikes, content.racing.messages, day.pickOrder);
    const rows = day.field.map((e) => dir.startRow(e.id));
    expect(Math.max(...rows)).toBe(1);
    expect(rows.filter((r) => r === 1)).toHaveLength(8);
    expect(sim.runToEnd().length).toBe(day.laps);
  });

  it('adds up points for every moto over the rounds, the next round moving round the tracks', () => {
    const career = rider();
    const active = enter(career, content, local, 5);
    expect(roundsHere(content.championships, career, venue('venue-farmland')).map((d) => d.id)).toEqual([local.id]);
    expect(roundsHere(content.championships, career, venue('venue-riverside'))).toEqual([]);
    const days = [rideRound(career, active, 100), rideRound(career, active, 200)];
    expect(nextRoundVenue(local, active)).toBe('venue-longmoor');
    const table = standings(points, active);
    expect(table).toHaveLength(16);
    for (const row of table) {
      const expected = days.reduce((a, d) => a + d.motos.reduce((b, m) => {
        const r = m.results.find((x) => x.id === row.id)!;
        return b + (r.retired ? 0 : points[r.position - 1]);
      }, 0), 0);
      expect(row.points, row.id).toBe(expected);
    }
    for (let i = 1; i < table.length; i++) expect(table[i - 1].points).toBeGreaterThanOrEqual(table[i].points);
  });

  it('breaks ties on moto wins, then the best result in the latest moto', () => {
    const active: ActiveChampionship = { seed: 1, field: ['a', 'b', 'c'], replay: false, rounds: [
      { venue: 'venue-farmland', qualifying: [], motos: [{ a: 1, b: 3, c: 2, [PLAYER_ID]: 4 }, { a: 2, b: 3, c: 1, [PLAYER_ID]: 4 }] },
    ] };
    const t = standings(points, active);
    // a and c both 25 + 22 = 47 with a win each; c was ahead in the last moto.
    expect(t.map((r) => r.id)).toEqual(['c', 'a', 'b', PLAYER_ID]);
    expect(t.map((r) => r.points)).toEqual([47, 47, 40, 36]);
    // a (25 + 15) and b (22 + 18) level on 40: a's win counts before b's better last moto.
    active.rounds[0].motos = [{ a: 1, b: 2, c: 3, [PLAYER_ID]: 4 }, { a: 6, b: 4, c: 1, [PLAYER_ID]: 5 }];
    expect(standings(points, active).map((r) => [r.id, r.points])).toEqual([['c', 45], ['a', 40], ['b', 40], [PLAYER_ID, 34]]);
  });

  it('says when the title is out of reach', () => {
    const active: ActiveChampionship = { seed: 1, field: ['a'], replay: false, rounds: [
      { venue: 'venue-farmland', qualifying: [], motos: [{ a: 1, [PLAYER_ID]: null }, { a: 1, [PLAYER_ID]: null }] },
    ] };
    expect(titlePossible(local, points, active)).toBe(true);
    active.rounds.push({ venue: 'venue-riverside', qualifying: [], motos: [{ a: 1, [PLAYER_ID]: 20 }, { a: 1, [PLAYER_ID]: 20 }] });
    expect(titlePossible(local, points, active)).toBe(false);
  });

  it('gives the winner the badge and the prize, 2nd and 3rd a smaller prize, and half money on a replay', () => {
    const won = (career: CareerState, place: number) => {
      const active = enter(career, content, local, 1);
      const others = active.field;
      for (const v of local.rounds) {
        const m: Record<string, number | null> = { [PLAYER_ID]: place };
        others.forEach((id, i) => (m[id] = i + 1 >= place ? i + 2 : i + 1));
        active.rounds.push({ venue: v, qualifying: [], motos: [m, m] });
      }
    };
    const career = rider();
    const flags: Record<string, boolean> = {};
    won(career, 1);
    const before = career.money;
    const fin = finishChampionship(career, flags, local, points);
    expect(fin).toMatchObject({ position: 1, money: 15000, flag: 'badge.area1', firstWin: true, title: 'the Area 1 badge' });
    expect(flags['badge.area1']).toBe(true);
    expect(career.money - before).toBe(15000);
    expect(career.champs!.active[local.id]).toBeUndefined();
    expect(career.champs!.done[local.id]).toEqual({ runs: 1, wins: 1, best: 1 });

    // Again, as a replay: half the XP and purse on the rounds, half the prize, no new title.
    const again = enter(career, content, local, 2);
    expect(again.replay).toBe(true);
    expect(roundOptions(content, local, again)).toMatchObject({ purseTimes: 0.9, xpTimes: 0.5 });
    withdraw(career, local);
    won(career, 1);
    expect(finishChampionship(career, flags, local, points)).toMatchObject({ money: 7500, firstWin: false, title: undefined });

    const second = rider();
    won(second, 2);
    expect(finishChampionship(second, {}, local, points)).toMatchObject({ position: 2, money: 7500, flag: undefined });
    const fifth = rider();
    won(fifth, 5);
    expect(finishChampionship(fifth, {}, local, points)).toMatchObject({ position: 5, money: 0 });
  });

  it('keeps a championship in the save', () => {
    const career = rider();
    const active = enter(career, content, local, 9);
    active.rounds.push({ venue: 'venue-farmland', qualifying: ['player'], motos: [{ player: 3 }, { player: null }] });
    career.champs!.done['area1.main'] = { runs: 1, wins: 0, best: 4 };
    const save = { version: SAVE_VERSION, savedAt: 'x', rider: { name: 'T', look: 'a' }, position: { map: 'm', x: 1, y: 1, facing: 'down' }, flags: {}, stats: { playSeconds: 0 }, career, van: null, driving: false };
    const back = parseSave(JSON.stringify(save))!;
    expect(back.career.champs).toEqual(career.champs);
    expect(parseSave(JSON.stringify({ ...save, career: { ...career, champs: { active: { x: { seed: 'no' } }, done: {} } } }))).toBeNull();
    // Saves from before championships have none, and still load.
    const { champs: _c, ...old } = career;
    expect(parseSave(JSON.stringify({ ...save, career: old }))!.career.champs).toBeUndefined();
  });
});

describe('laps by track kind (Boss, 29 Oct 2026)', () => {
  const day = (id: string, round: boolean) => {
    const active = enter(rider(), content, local, 1);
    return new RaceDay(content, venue(id), playerEntrant(content, rider(), 'Test'), 1, 0, round ? roundOptions(content, local, active) : undefined);
  };

  it('races 8 laps a moto on an endurance track, and in a motocross or endurance championship round', () => {
    expect(day('venue-longmoor', false).laps).toBe(8);
    expect(day('venue-longmoor', true).laps).toBe(8);
    expect(day('venue-farmland', true).laps).toBe(8);
  });

  it('keeps the class laps for other race days and stadium rounds', () => {
    expect(day('venue-farmland', false).laps).toBe(content.racing.classes['50cc'].laps);
    expect(day('venue-riverside', false).laps).toBe(content.racing.classes['50cc'].laps);
    expect(day('venue-riverside', true).laps).toBe(content.racing.classes['50cc'].laps);
  });
});
