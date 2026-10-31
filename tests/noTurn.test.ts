import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newCareerState } from '../src/core/career';
import { checkContent } from '../src/core/content';
import { bracketOrder, finalPoints, Knockout, KNOCKOUT_FIELD, roundName, snakeHeats } from '../src/core/knockout';
import { loadModTracks, modVenue, readModTrack } from '../src/core/modTracks';
import { MotoSim } from '../src/core/race';
import { entryFee, PLAYER_ID, playerEntrant } from '../src/core/raceDay';
import { directorFor } from '../src/core/riderAI';
import { MemoryStore } from '../src/core/storage';
import { layoutProblems, noTurnProblems } from '../src/core/trackCheck';
import { gridOf, hiddenSpans, isNoTurn, lapPlan, NO_TURN_GRID, NO_TURN_LANES, NO_TURN_RUNOFF, noTurnPath, noTurnStartPath, platformShare, startGeom } from '../src/core/trackGeom';
import { TrackSurface } from '../src/core/trackSurface';
import { loadManifest, loadMaps, rawContent } from './helpers';
import { content, field } from './raceHelpers';

// No-Turn Takedown (Boss, 30 Oct 2026): a straight drag strip on a 200 × 30 grid, four riders at a
// time off a raised start platform, a timed seeding run, knockout heats of four with the first two
// through, and a best-of-three final scored 1 to 4 a run, lowest total winning.

const FILE = 'takedown-strip.track.json';
function strip() {
  const m = readModTrack(content, FILE, readFileSync(`public/mods/tracks/${FILE}`, 'utf8'), 'folder');
  return { ...m, track: m.track! };
}

function knockout(seed = 5) {
  const rc = checkContent(rawContent(), loadManifest(), loadMaps()).content!;
  const [mod] = loadModTracks(rc, [{ file: FILE, text: readFileSync(`public/mods/tracks/${FILE}`, 'utf8') }], new MemoryStore());
  const venue = modVenue(mod, 'area1-home-town');
  const career = newCareerState(rc.bikes, rc.story, rc.bikes.brands[0].id);
  return new Knockout(rc, venue, playerEntrant(rc, career, 'Test'), seed, entryFee(rc, venue, {}));
}

describe('No-Turn Takedown tracks', () => {
  it('the example strip is a No-Turn Takedown and passes every mod track check', () => {
    const m = strip();
    expect(m.problems).toEqual([]);
    expect(isNoTurn(m.track)).toBe(true);
    expect(gridOf(m.track)).toEqual(NO_TURN_GRID);
    expect(NO_TURN_GRID).toEqual({ w: 200, h: 30 });
  });

  it('refuses any bend: a run moved off the straight line, or a start platform out of line with it', () => {
    const { track } = strip();
    const bent = { ...track, path: track.path.map((p, i) => (i === track.path.length - 1 ? [p[0], p[1] + 1] : p)) as [number, number][] };
    expect(noTurnProblems(bent).some((p) => p.field === 'path')).toBe(true);
    const [sx, sy] = track.path.at(-1)!;
    const skew = { ...track, start: { path: [[sx - 8, sy + 3], [sx, sy]] as [number, number][] } };
    expect(noTurnProblems(skew).some((p) => p.field === 'start')).toBe(true);
    expect(noTurnProblems({ ...track, gates: Array(8).fill(0) }).some((p) => p.field === 'gates')).toBe(true);
    // No corners either.
    const berm = { ...track, sections: track.sections.map((sec, i) => (i === 2 ? { ...sec, type: 'berm' } : sec)) };
    expect(noTurnProblems(berm).some((p) => p.field === 'sections[2].type')).toBe(true);
    // A run-off anywhere else, or on another kind of track, is refused.
    expect(layoutProblems({ ...track, kind: 'outdoor' }, content.racing.sections).length).toBeGreaterThan(0);
  });

  it('draws the run as one straight edge with the run-off past the finish line and the way back hidden', () => {
    const path = noTurnPath(20, 15, 0, 100, -1);
    expect(path[0]).toEqual([120, 15]);
    expect(path[1]).toEqual([120 + NO_TURN_RUNOFF, 15]);
    expect(path.at(-1)).toEqual([20, 15]);
    expect(noTurnStartPath(20, 15, 0)).toEqual([[10, 15], [20, 15]]);
    const { track } = strip();
    const [h] = hiddenSpans(track);
    const s = new TrackSurface(track);
    expect(h[0] * s.g.total).toBeCloseTo(NO_TURN_RUNOFF);
    expect(h[1]).toBeCloseTo(s.bounds[1]);
  });

  it('a run is the start platform then the run, with no first corner, ending on the finish line', () => {
    const { track } = strip();
    const plan = lapPlan(track, 1);
    expect(plan.secs).not.toContain(-2);
    expect(plan.secs[0]).toBe(-1);
    expect(plan.secs).not.toContain(0);
    expect(plan.marks.at(-1)).toBeCloseTo(1);
    expect(startGeom(track).joinAt).toBeCloseTo(startGeom(track).join);
  });

  it('raises the start platform: the gate on the deck, dropping in to the ground', () => {
    const { track } = strip();
    const s = new TrackSurface(track);
    expect(platformShare(0)).toBe(1);
    expect(platformShare(-2)).toBe(1);
    expect(platformShare(20)).toBe(0);
    expect(s.startHeight(0, 0)).toBeGreaterThan(s.startHeight(s.start.total - 0.5, 0) + 1);
  });

  it('lines four riders up on the platform, two each side of the starter, and parks finishers in the run-off', () => {
    const { track } = strip();
    const four = field('50cc', 4);
    four.forEach((e, i) => (e.gate = i));
    const sim = new MotoSim(content.racing, content.bikes, track, '50cc', four, { laps: 1, motoIndex: 0, seed: 4 });
    const dir = directorFor(sim, content.bikes, content.racing.messages);
    const traces = sim.runToEnd();
    for (const tr of traces) dir.addLap(tr);
    const lined = dir.poses(0);
    const s = new TrackSurface(track);
    const lanes = lined.map((p) => p.lane).sort((a, b) => a - b);
    lanes.forEach((l, i) => expect(l).toBeCloseTo(NO_TURN_LANES[i] * 1, 1));
    // Well after the finish, everyone has pulled up in the run-off, short of its end.
    const end = Math.max(...sim.riders.map((r) => r.time)) + 4;
    for (const p of dir.poses(end)) {
      const f = p.dist - Math.floor(p.dist);
      expect(f * s.g.total).toBeLessThanOrEqual(NO_TURN_RUNOFF + 0.01);
    }
  });
});

describe('No-Turn Takedown knockouts', () => {
  it('names rounds and snakes seeds so the fastest are kept apart', () => {
    expect(roundName(1, 4)).toBe('Final');
    expect(roundName(2, 8)).toBe('Semi-finals');
    expect(roundName(4, 16)).toBe('Quarter-finals');
    expect(roundName(8, 32)).toBe('Round of 32');
    const ids = Array.from({ length: 32 }, (_, i) => `s${i + 1}`);
    const heats = snakeHeats(ids, 4);
    expect(heats).toHaveLength(8);
    expect(heats[0]).toEqual(['s1', 's16', 's17', 's32']);
    expect(heats[7]).toEqual(['s8', 's9', 's24', 's25']);
    expect(finalPoints(1)).toBe(1);
    expect(finalPoints(4)).toBe(4);
  });

  it('seeds 32 riders on staggered solo runs, then runs 32 → 16 → 8 → 4 and a best-of-three final', () => {
    const k = knockout();
    expect(k.field).toHaveLength(KNOCKOUT_FIELD);
    const seed = k.startSeeding('steady');
    // Everyone leaves on their own, the seeding interval apart.
    const traces = seed.runToEnd();
    const away = Object.values(traces[0].times).map((t) => t[0]).sort((a, b) => a - b);
    // The player goes second, with just one rider ahead of them (Boss, 31 Oct 2026).
    expect(k.player.gate).toBe(1);
    expect(traces[0].times[PLAYER_ID][0]).toBeCloseTo(away[1]);
    for (let i = 1; i < away.length; i++) expect(away[i] - away[i - 1]).toBeGreaterThanOrEqual(k.rules.seedInterval - 1e-6);
    const rec = k.finishSeeding(seed);
    expect(rec.results).toHaveLength(32);
    expect(k.rounds[0].name).toBe('Round of 32');
    expect(k.rounds[0].heats).toHaveLength(8);
    while (!k.done) {
      const h = k.next!;
      expect(h.riders.length).toBeLessThanOrEqual(4);
      const sim = k.startHeat(h, 'steady', h.riders.includes(PLAYER_ID) ? k.gatesForPlayer(h).free[0] : undefined);
      // Each rider on a gate of their own.
      expect(new Set(sim.riders.map((r) => r.e.gate)).size).toBe(h.riders.length);
      sim.runToEnd();
      k.finishHeat(h, sim);
    }
    expect(k.rounds.map((r) => r.name)).toEqual(['Round of 32', 'Quarter-finals', 'Semi-finals', 'Final']);
    for (const r of k.rounds.slice(0, -1)) for (const h of r.heats) expect(h.through.length).toBeLessThanOrEqual(2);
    const final = k.rounds.at(-1)!.heats[0];
    expect(final.runs).toHaveLength(3);
    // The final's order is on points, lowest first.
    const pts = k.points(final);
    for (let i = 1; i < final.through.length; i++) expect(pts.get(final.through[i])!).toBeGreaterThanOrEqual(pts.get(final.through[i - 1])!);
    const places = k.places();
    expect(places).toHaveLength(32);
    expect(new Set(places.map((p) => p.id)).size).toBe(32);
    expect(places.slice(0, 4).map((p) => p.id)).toEqual(final.through);
    expect(places.slice(4, 8).every((p) => p.reached === 'Semi-finals')).toBe(true);
    const day = k.dayResult();
    expect(day.position).toBe(places.find((p) => p.player)!.position);
  });

  it('lays the heats out as a bracket: each heat fed by the two beside it, seeds 1 and 2 only meeting in the final', () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const k = knockout(3);
    const s = k.startSeeding('steady');
    s.runToEnd();
    k.finishSeeding(s);
    const tops = k.rounds[0].heats.map((h) => k.seedOrder.indexOf(h.riders[0]) + 1);
    expect(tops).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    while (!k.done) k.autoRun(k.next!);
    for (let r = 1; r < k.rounds.length; r++) {
      k.rounds[r].heats.forEach((h, i) => {
        const fed = [...k.rounds[r - 1].heats[2 * i].through, ...k.rounds[r - 1].heats[2 * i + 1].through];
        expect([...h.riders].sort()).toEqual(fed.sort());
      });
    }
  });

  it('is late-game content: the pool\'s 31 best riders, buffed, on runs with less luck', () => {
    const k = knockout();
    const rc = checkContent(rawContent(), loadManifest(), loadMaps()).content!;
    const rules = rc.racing.sim.knockout!;
    expect(rules.buff).toBeGreaterThan(0);
    expect(rules.noise).toBeLessThan(1);
    const pool = rc.riders.fields['area1.local'].map((id) => rc.riders.riders.find((r) => r.id === id)!);
    const cut = pool.map((r) => r.level).sort((a, b) => b - a)[30];
    for (const e of k.field.filter((x) => !x.player)) {
      const def = pool.find((r) => r.id === e.id)!;
      expect(def.level).toBeGreaterThanOrEqual(cut);
      expect(e.bike.parts && Object.values(e.bike.parts).every((p) => p.condition >= Math.min(1, def.bike.condition * (1 + rules.buff)) - 1e-9)).toBe(true);
    }
    const s = k.startSeeding('steady');
    expect(s.opts.noiseScale).toBe(rules.noise);
  });

  it('runs every other heat by itself, stopping at the player’s, and the same seed gives the same day', () => {
    const play = (seed: number) => {
      const k = knockout(seed);
      const s = k.startSeeding('steady');
      s.runToEnd();
      k.finishSeeding(s);
      k.runUntilPlayer();
      const h = k.next;
      expect(h?.riders).toContain(PLAYER_ID);
      return k.rounds[0].heats.map((x) => x.through.join(','));
    };
    expect(play(9)).toEqual(play(9));
  });
});
