import { describe, expect, it } from 'vitest';
import { newCareerState, pence } from '../src/core/career';
import { checkContent } from '../src/core/content';
import { Travel } from '../src/core/travel';
import { earning, goalObjects, nextHop, storyGoal, storyGoals } from '../src/core/waymarks';
import { loadManifest, loadMaps, rawContent } from './helpers';

const maps = loadMaps();
const content = checkContent(rawContent(), loadManifest(), maps).content!;
const travel = new Travel(maps, content.world.locks);
const hop = (from: string, to: string, flags: Record<string, boolean> = {}) => nextHop(maps, content.world, travel, flags, from, to);

describe('tutorial markers (Boss, 28 Oct 2026)', () => {
  it('marks the NPC or equipment of every step, and there is a way to it from Home Town', () => {
    const c = newCareerState(content.bikes, content.story, 'hondmoto', () => 0.5);
    // Flags as the chain sets them, so a step behind a story lock is still reachable once it's open.
    const flags: Record<string, boolean> = {};
    content.story.steps.forEach((step, i) => {
      c.story = { step: i, used: [] };
      const goal = storyGoal(content, maps, c);
      expect(goal, step.id).not.toBeNull();
      const map = maps.get(goal!.map)!;
      if (goal!.kind === 'object') expect(goalObjects(map, goal!.action, []).length, step.id).toBeGreaterThan(0);
      else expect(goal!.npc).toBe(step.on.talk);
      if (goal!.map !== 'area1-home-town') expect(hop('area1-home-town', goal!.map, flags), step.id).not.toBeNull();
      for (const f of step.effects?.flags ?? []) flags[f] = true;
    });
    c.story = { step: content.story.steps.length, used: [] };
    expect(storyGoal(content, maps, c)).toBeNull();
  });

  it('points at the building door, the way out of a building, or the road to another area', () => {
    const garage = hop('area1-home-town', 'int-home-local-garage')!;
    expect(garage.kind).toBe('door');
    expect(new Set(garage.via.map((o) => o.name))).toEqual(new Set(['Phoenix MX']));
    expect(garage.via.length).toBeGreaterThan(1);

    const out = hop('int-home-local-garage', 'int-home-bike-shop')!;
    expect(out).toMatchObject({ kind: 'exit', to: 'area1-home-town' });

    const iz = hop('area1-home-town', 'int-iz-engine-rebuilder')!;
    expect(iz).toMatchObject({ kind: 'exit', to: 'area1-industrial-zone' });
    expect(iz.via[0].name).toBe('To the Industrial Zone');
    expect(hop('int-iz-engine-rebuilder', 'int-home-local-garage')).toMatchObject({ kind: 'exit', to: 'area1-industrial-zone' });
  });

  it("doesn't send the rider down a road that is still shut", () => {
    expect(hop('area1-home-town', 'venue-motocross')).toBeNull();
    expect(hop('area1-home-town', 'venue-motocross', { van_loaded: true })).toMatchObject({ kind: 'exit', to: 'venue-motocross' });
  });

  it('points to the work benches while short of the van money, then back to the van seller at £600 (Boss, 28 Oct 2026)', () => {
    const c = newCareerState(content.bikes, content.story, 'hondmoto', () => 0.5);
    c.story = { step: content.story.steps.findIndex((s) => s.id === 'buy_van'), used: [] };
    const flags = { tutorial_done: true, roadworks_done: true };
    c.money = pence(520);
    expect(earning(content, c)).toBe(true);
    const goals = storyGoals(content, maps, c);
    expect(goals.map((g) => g.map).sort()).toEqual(['int-iz-engine-rebuilder', 'int-iz-fabrication-shop']);
    for (const g of goals) {
      expect(g).toMatchObject({ kind: 'object', action: 'job.shift' });
      expect(goalObjects(maps.get(g.map)!, 'job.shift', []).length).toBeGreaterThan(0);
    }
    // From town, both are through the road to the Industrial Zone; there, each has its own door.
    const fromTown = goals.map((g) => hop('area1-home-town', g.map, flags)!);
    expect(fromTown.every((h) => h.kind === 'exit' && h.to === 'area1-industrial-zone')).toBe(true);
    expect(fromTown[0].via).toEqual(fromTown[1].via);
    const inZone = goals.map((g) => hop('area1-industrial-zone', g.map, flags)!);
    expect(inZone.map((h) => h.kind)).toEqual(['door', 'door']);
    expect(inZone[0].via).not.toEqual(inZone[1].via);
    c.money = pence(600);
    expect(earning(content, c)).toBe(false);
    expect(storyGoals(content, maps, c)).toEqual([{ kind: 'npc', map: storyGoal(content, maps, c)!.map, npc: 'npc.van_seller', name: expect.any(String) }]);
  });

  it('points to the new van until the rider gets in, then on to the spares chest (Boss, 28 Oct 2026)', () => {
    const c = newCareerState(content.bikes, content.story, 'hondmoto', () => 0.5);
    c.story = { step: content.story.steps.findIndex((s) => s.id === 'load_van'), used: [] };
    const van = { map: content.vehicles.starter.map };
    expect(storyGoals(content, maps, c, {}, van)).toEqual([{ kind: 'van', map: 'area1-home-town' }]);
    expect(storyGoals(content, maps, c, { van_driven: true }, van)).toEqual([{ kind: 'object', map: 'int-home-rented-room', action: 'storage.parts' }]);
  });

  it('marks the NPC of each task after the opening chain: Paul, the fabrication boss, then Joseph (Boss, 30 Oct 2026)', () => {
    const c = newCareerState(content.bikes, content.story, 'hondmoto', () => 0.5);
    c.story = { step: content.story.steps.length, used: [] };
    const flags: Record<string, boolean> = { tutorial_done: true, roadworks_done: true, 'found.venue-farmland': true };
    const npcs = () => storyGoals(content, maps, c, flags).map((g) => (g.kind === 'npc' ? g.npc : g.kind));
    expect(npcs()).toEqual(['npc.garage_mechanic']);
    flags['told.bike_care'] = true;
    expect(npcs()).toEqual(['npc.fabricator']);
    flags['told.iz_challenge'] = true;
    expect(npcs()).toEqual(['npc.track_official']);
    flags.first_race_done = true;
    expect(npcs()).toEqual([]);
  });

  it('marks only the stands still to do on a step that needs two', () => {
    const map = maps.get('int-home-local-garage')!;
    const both = goalObjects(map, 'workshop.bike', []);
    expect(both).toHaveLength(2);
    const o = both[0];
    expect(goalObjects(map, 'workshop.bike', [`${map.id}:${o.name}:${o.x},${o.y}`])).toEqual([both[1]]);
  });
});
