import { describe, expect, it } from 'vitest';
import { checkContent } from '../src/core/content';
import { MotoSim, type Entrant, type LapTrace } from '../src/core/race';
import { cpuEntrant } from '../src/core/raceDay';
import { directorFor, START_HOLD, type RaceDirector } from '../src/core/riderAI';
import { lapGeom, sectionBounds } from '../src/core/trackGeom';
import { BIKE_LENGTH, TrackSurface } from '../src/core/trackSurface';
import { loadManifest, loadMaps, rawContent } from './helpers';

const content = checkContent(rawContent(), loadManifest(), loadMaps()).content!;
const JUMPY = new Set(['tabletop', 'double', 'step_up', 'rhythm', 'whoops', 'braking_bumps']);

/** The whole CPU field, plus one rider on a worn-out bike with a broken part. */
function field(cls: string): Entrant[] {
  const list = content.riders.riders.map((d, i) => cpuEntrant(content, d, cls, i));
  const wreck = cpuEntrant(content, { ...content.riders.riders[content.riders.riders.length - 1], id: 'cpu.wreck', name: 'Wreck' }, cls, list.length);
  for (const [slot, p] of Object.entries(wreck.bike.parts)) wreck.bike.parts[slot] = { ...p, condition: slot === 'top_end' ? 0 : 0.15 };
  return [...list, wreck];
}

function race(trackId: string, seed: number): { sim: MotoSim; dir: RaceDirector; traces: LapTrace[] } {
  const track = content.tracks.tracks.find((t) => t.id === trackId)!;
  const sim = new MotoSim(content.racing, content.bikes, track, '50cc', field('50cc'), { laps: 4, motoIndex: 0, seed });
  const dir = directorFor(sim, content.bikes, content.racing.messages);
  const traces = sim.runToEnd();
  for (const tr of traces) dir.addLap(tr);
  return { sim, dir, traces };
}

describe('rider AI (GDD 11.1)', () => {
  for (const track of content.tracks.tracks) {
    it(`acts out the simulation's result on ${track.id}`, () => {
      for (const seed of [3, 77]) {
        const { sim, dir, traces } = race(track.id, seed);
        const bounds = sectionBounds(track);
        // At every checkpoint the referee recorded, the rider is exactly at that point of the race.
        for (const tr of traces) {
          for (const [id, times] of Object.entries(tr.times)) {
            for (let i = 1; i < times.length; i++) {
              const p = dir.poses(times[i]).find((q) => q.id === id)!;
              expect(p.dist).toBeCloseTo(tr.marks[i], 6);
            }
          }
        }
        // Over the race: nobody goes backwards, stays on the track, and only leaves the ground on jumps.
        const end = Math.max(...traces.flatMap((tr) => Object.values(tr.times).map((t) => t[t.length - 1]))) + 6;
        const last = new Map<string, number>();
        let airborne = 0;
        for (let t = 0; t <= end; t += 0.25) {
          for (const p of dir.poses(t)) {
            expect(p.dist).toBeGreaterThanOrEqual((last.get(p.id) ?? -Infinity) - 1e-9);
            last.set(p.id, p.dist);
            expect(p.air).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(p.speed)).toBe(true);
            if (p.state !== 'retired') expect(Math.abs(p.lane)).toBeLessThanOrEqual(1);
            if (p.air > 0) {
              expect(p.dist).toBeGreaterThan(dir.start.join);
              const at = p.dist - Math.floor(p.dist);
              const si = bounds.findIndex((b, k) => k > 0 && at < b + 1e-9) - 1;
              expect(JUMPY.has(track.sections[Math.max(0, si)].type)).toBe(true);
              airborne++;
            }
          }
        }
        if (track.sections.some((s) => JUMPY.has(s.type))) expect(airborne).toBeGreaterThan(0);
        // Finishers end on the full distance, and in the referee's finishing order.
        const results = sim.results().filter((r) => !r.retired);
        const finals = dir.poses(end);
        for (const r of results) expect(finals.find((p) => p.id === r.id)!.state).toBe('finished');
        for (const r of sim.results().filter((x) => x.retired)) expect(finals.find((p) => p.id === r.id)!.state).toBe('retired');
      }
    }, 20000); // Longmoor is a long race: 16 riders over every quarter second.
  }

  it('shows the same race at any playback speed', () => {
    const a = race('farmland', 5).dir;
    const b = race('farmland', 5).dir;
    for (const t of [0, 3.3, 41.7, 120]) expect(a.poses(t)).toEqual(b.poses(t));
  });

  it('lines riders up at their gates before the start', () => {
    const { dir } = race('farmland', 9);
    const grid = dir.poses(0);
    // Everyone lines up at the gate on the start straight, before it joins the lap: two rows of 8,
    // the second straight behind the first, every slot different.
    expect(grid.every((p) => p.state === 'grid' && p.dist === dir.start.from && p.dist < dir.start.join)).toBe(true);
    const slots = grid.map((p) => `${dir.startRow(p.id)} ${p.lane.toFixed(3)}`);
    expect(new Set(slots).size).toBe(grid.length);
    expect(grid.filter((p) => dir.startRow(p.id) === 0).length).toBe(8);
    const front = new Set(grid.filter((p) => dir.startRow(p.id) === 0).map((p) => p.lane.toFixed(3)));
    expect(grid.filter((p) => dir.startRow(p.id) === 1).every((p) => front.has(p.lane.toFixed(3)))).toBe(true);
  });

  for (const trackId of ['farmland', 'arena-supercross', 'longmoor-endurance']) {
    it(`runs the start procedure on ${trackId}: some lined up, the rest roll in without touching, then a five-second hold`, () => {
      const { dir } = race(trackId, 4);
      const track = content.tracks.tracks.find((t) => t.id === trackId)!;
      const s = new TrackSurface(track);
      const units = lapGeom(track.path).total;
      const ids = dir.poses(0).map((p) => p.id);
      // 4 to 8 already in their slots; the rest take 2 to 4 seconds; then the hold.
      expect(dir.lined.size).toBeGreaterThanOrEqual(4);
      expect(dir.lined.size).toBeLessThanOrEqual(8);
      expect(dir.prep).toBeGreaterThanOrEqual(2);
      expect(dir.prep).toBeLessThanOrEqual(4);
      expect(dir.prestart).toBeCloseTo(dir.prep + START_HOLD, 9);
      expect(dir.linedUp(-START_HOLD)).toBe(true);
      expect(dir.linedUp(-START_HOLD - 0.1)).toBe(false);
      const start = dir.poses(-dir.prestart);
      expect(start.filter((p) => p.dist === dir.start.from).length).toBe(dir.lined.size);
      const last = new Map<string, number>();
      for (let t = -dir.prestart; t <= 0; t += 0.02) {
        const poses = dir.poses(t);
        // Where each bike stands on the start straight, as the race view places it (second row a bike length and a bit back).
        const at = poses.map((p) => {
          const u = (p.dist - dir.start.from) * units - dir.startRow(p.id) * BIKE_LENGTH * 1.4;
          return { id: p.id, u, x: p.lane * s.startHw(u) };
        });
        for (const p of poses) {
          expect(p.state).toBe('grid');
          // Only ever forwards, never past the slot.
          expect(p.dist).toBeGreaterThanOrEqual((last.get(p.id) ?? -Infinity) - 1e-12);
          expect(p.dist).toBeLessThanOrEqual(dir.start.from + 1e-12);
          last.set(p.id, p.dist);
          // Still, and in the slot, for the whole hold.
          if (t >= -START_HOLD) {
            expect(p.dist).toBe(dir.start.from);
            expect(p.speed).toBe(0);
          }
        }
        // No two bikes overlap: a bike is BIKE_LENGTH long and under half a grid unit wide.
        for (let i = 0; i < at.length; i++) {
          for (let j = i + 1; j < at.length; j++) {
            const touching = Math.abs(at[i].u - at[j].u) < BIKE_LENGTH && Math.abs(at[i].x - at[j].x) < 0.45;
            expect(touching, `${at[i].id} and ${at[j].id} at ${t.toFixed(2)}`).toBe(false);
          }
        }
      }
      expect(ids.length).toBe(16);
    });
  }

  it('shows mistakes and crashes where the referee put them', () => {
    let crashes = 0;
    let wobbles = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { dir, traces } = race('farmland', seed);
      for (const tr of traces) {
        for (const e of tr.events) {
          if (e.kind !== 'mistake') continue;
          const times = tr.times[e.rider];
          const leg = tr.secs.indexOf(e.section);
          const t0 = times[leg];
          const t1 = times[leg + 1];
          const states = new Set<string>();
          for (let t = t0; t < t1; t += 0.1) states.add(dir.poses(t).find((p) => p.id === e.rider)!.state);
          if (e.outcome === 'minor_crash' || e.outcome === 'serious_crash') {
            expect(states.has('crashed')).toBe(true);
            crashes++;
          } else if (states.has('wobble')) wobbles++;
        }
      }
    }
    expect(wobbles).toBeGreaterThan(0);
    expect(crashes + wobbles).toBeGreaterThan(0);
  });
});
