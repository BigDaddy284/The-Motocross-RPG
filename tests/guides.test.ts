import { describe, expect, it } from 'vitest';
import { checkContent, npcsOnMap, type RawContent } from '../src/core/content';
import { ROAD_TRACK_TYPES, roadMenu, routeArrival, routePlaces, waysOut } from '../src/core/guides';
import { Grid } from '../src/core/grid';
import { ROUTE, spawnTile, stepTriggerAt, Travel } from '../src/core/travel';
import { loadManifest, loadMaps, rawContent } from './helpers';
import { standLift } from '../src/world/standLift';

const maps = loadMaps();
const content = checkContent(rawContent(), loadManifest(), maps).content!;
const { world, npcs } = content;
const travel = new Travel(maps, world.locks);
const OPEN = { roadworks_done: true, van_owned: true, van_loaded: true };
const map = (id: string) => maps.get(id)!;
const exitOn = (id: string, name: string) => map(id).objects.find((o) => o.type === 'exit' && o.name === name)!;
const errorsWith = (change: (raw: Record<string, any>) => void) => {
  const raw = structuredClone(rawContent()) as RawContent & Record<string, any>;
  change(raw);
  return checkContent(raw, loadManifest(), maps).errors.map((e) => `${e.file}: ${e.field}: ${e.message}`);
};

describe('the roads out', () => {
  it('has no route marshals left (Boss, 28 Oct 2026)', () => {
    expect(npcs.some((n) => /marshal/i.test(n.id) || /marshal/i.test(n.name))).toBe(false);
    expect(Object.keys(content.dialogue).some((k) => k.startsWith('route_marshal'))).toBe(false);
  });

  it('at each venue, the lane goes to the other places, never the venue itself', () => {
    for (const id of ['venue-motocross', 'venue-supercross', 'venue-enduro']) {
      const ways = waysOut(map(id), world, maps, travel, {});
      expect(ways).toHaveLength(1);
      expect(ways[0].side).toBe('south');
      const names = ways[0].places.map((p) => p.map);
      expect(names).toHaveLength(4);
      expect(names).toContain('area1-home-town');
      expect(names).toContain('mod-tracks');
      expect(names).not.toContain(id);
    }
  });

  it('only list places that exist: a missing map or spawn is left out, not promised', () => {
    const w = structuredClone(world);
    w.places.push({ map: 'area1-nowhere', spawn: 'x', name: 'Nowhere', note: '' });
    w.routes[0].to.push('area1-nowhere');
    expect(routePlaces(w, maps, w.routes[0]).map((p) => p.name)).toEqual(['Farmland MX', 'Riverside Arena', 'Longmoor Enduro', 'Mod Track']);
  });
});

describe('leaving by a route', () => {
  const home = map('area1-home-town');
  const road = exitOn('area1-home-town', 'To the venue route');

  it('goes to the place picked, through the exit', () => {
    for (const id of ['venue-motocross', 'venue-supercross', 'venue-enduro']) {
      const to = routeArrival(home, road, world, maps, id);
      expect(typeof to).not.toBe('string');
      if (typeof to === 'string') continue;
      expect({ map: to.map, tile: to.tile }).toEqual({ map: id, tile: spawnTile(map(id), 'from_world_map') });
    }
  });

  it("without a pick takes the road's first place, and says where else it goes", () => {
    for (const pick of [null, 'area1-industrial-zone']) {
      const to = routeArrival(home, road, world, maps, pick);
      expect(typeof to).not.toBe('string');
      if (typeof to === 'string') continue;
      expect(to.map).toBe('venue-motocross');
      expect(to.others.map((p) => p.map)).toEqual(['venue-supercross', 'venue-enduro', 'mod-tracks']);
    }
  });

  it('goes straight there when a route has only one place', () => {
    const w = structuredClone(world);
    w.routes[0].to = ['venue-motocross'];
    expect(routeArrival(home, road, w, maps, null)).toMatchObject({ map: 'venue-motocross', tile: spawnTile(map('venue-motocross'), 'from_world_map') });
  });

  it('every way out of every area leads somewhere real', () => {
    for (const m of maps.values()) {
      if (m.kind !== 'area') continue;
      for (const w of waysOut(m, world, maps, travel, OPEN)) {
        if (w.exit.props.to === ROUTE) expect(w.places.length, `${m.id} ${w.exit.name}`).toBeGreaterThan(0);
        else expect(w.to, `${m.id} ${w.exit.name}`).toBeDefined();
        expect(w.shut, `${m.id} ${w.exit.name}`).toBeNull();
      }
    }
  });
});

describe('route checks', () => {
  it('refuse a route exit with no route, a route to a place that isn’t listed, or one back to itself', () => {
    expect(errorsWith((r) => { r.world.routes = r.world.routes.slice(1); })).toEqual([expect.stringMatching(/the exit "To the venue route" on area1-home-town leads to a choice of places, but no route lists them/)]);
    expect(errorsWith((r) => { r.world.routes[0].to.push('area1-industrial-zone'); })).toEqual([expect.stringMatching(/routes\[0\]\.to\[4\]: "area1-industrial-zone" isn't one of the places/)]);
    expect(errorsWith((r) => { r.world.routes[1].to.push('venue-motocross'); })).toEqual([expect.stringMatching(/routes\[1\]\.to\[4\]: leads back to venue-motocross/)]);
    expect(errorsWith((r) => { r.world.routes[0].exit = 'To the Industrial Zone'; })).toEqual(expect.arrayContaining([expect.stringMatching(/goes straight to area1-industrial-zone, not to a choice of places/)]));
  });
});

describe('road exits and the local racer (Alpha v1)', () => {
  it('make every road out of an area a 2×2 trigger, with the arrival spot just inside it', () => {
    for (const m of maps.values()) {
      if (m.kind !== 'area') continue;
      for (const o of m.objects.filter((x) => x.type === 'exit')) {
        expect([o.w / m.tileSize, o.h / m.tileSize], `${m.id} ${o.name}`).toEqual([2, 2]);
        for (const s of m.objects.filter((x) => x.type === 'spawn')) expect(stepTriggerAt(m, { x: s.x / m.tileSize, y: s.y / m.tileSize }), `${m.id} ${s.name}`).toBeUndefined();
      }
    }
  });

  it('stands the local racer on the pavement outside the local garage', () => {
    const home = map('area1-home-town');
    const racer = home.objects.find((o) => o.type === 'npc' && o.props.npc === 'npc.local_racer')!;
    const garage = home.objects.find((o) => o.type === 'building' && o.name === 'Phoenix MX')!;
    const t = { x: racer.x / 64, y: racer.y / 64 };
    expect(t.y).toBe((garage.y + garage.h) / 64);
    expect(t.x).toBeGreaterThanOrEqual(garage.x / 64);
    expect(t.x).toBeLessThan((garage.x + garage.w) / 64);
    expect(Grid.fromMap(home).isFree(t.x, t.y)).toBe(true);
    expect(stepTriggerAt(home, t)).toBeUndefined();
    const ground = home.ground[0].cells as number[];
    expect(home.images[ground[t.y * home.width + t.x]]).toMatch(/street/);
  });
});

describe('NPCs stand on the path, not in the road', () => {
  it('puts every NPC on an area map off the road, and lifts them onto the paving on a one-tile pavement', () => {
    for (const m of maps.values()) {
      if (m.kind !== 'area') continue;
      for (const p of npcsOnMap(content, m)) {
        const imgs = m.ground.map((l) => m.images[(l.cells as number[])[p.y * m.width + p.x]] ?? '');
        expect(imgs.some((i) => /\/road-\d/.test(i)), `${p.npc.id} on ${m.id}`).toBe(false);
        // On a pavement drawn across the middle of its tile (road or verge below), the feet go up onto it.
        if (imgs.some((i) => /street-(00001000|10000000)\.png$/.test(i))) expect(standLift(m, p.x, p.y), `${p.npc.id} on ${m.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the road menu (Boss, 30 Oct 2026)', () => {
  const kindOf = (id: string) => content.tracks.tracks.find((t) => t.id === id)?.kind;
  const homeRoad = world.routes.find((r) => r.map === 'area1-home-town')!;
  const lane = world.routes.find((r) => r.map === 'venue-motocross')!;
  const names = (ps: { name: string }[]) => ps.map((p) => p.name);
  const FOUND = { 'found.venue-farmland': true };

  it('lists the track types in order, with Enduro Sprint, EnduroCross and No-Turn Takedown coming soon', () => {
    expect(ROAD_TRACK_TYPES.map((t) => t.name)).toEqual(['Motocross', 'Supercross', 'Enduro Loop', 'Enduro Sprint', 'EnduroCross', 'No-Turn Takedown']);
    expect(ROAD_TRACK_TYPES.filter((t) => t.comingSoon).map((t) => t.name)).toEqual(['Enduro Sprint', 'EnduroCross', 'No-Turn Takedown']);
  });

  it('puts each unlocked track under its type, and the places that are not tracks under Areas', () => {
    const menu = roadMenu(routePlaces(world, maps, lane), content.tracks.venues, kindOf, FOUND);
    expect(menu.tracks.map((t) => [t.name, names(t.places)])).toEqual([
      ['Motocross', []],
      ['Supercross', ['Riverside Arena']],
      ['Enduro Loop', ['Longmoor Enduro']],
      ['Enduro Sprint', []],
      ['EnduroCross', []],
      ['No-Turn Takedown', []],
    ]);
    expect(names(menu.areas)).toEqual(['Home Town']);
    expect(menu.mods).toBe(true);
  });

  it('leaves out a track until it is unlocked, and the backyard loop is never a track', () => {
    const menu = roadMenu(routePlaces(world, maps, homeRoad), content.tracks.venues, kindOf, {});
    expect(menu.tracks.every((t) => t.places.length === 0)).toBe(true);
    expect(menu.areas).toEqual([]);
    const open = roadMenu(routePlaces(world, maps, homeRoad), content.tracks.venues, kindOf, FOUND);
    expect(names(open.tracks[0].places)).toEqual(['Farmland MX']);
    const home = world.places.find((p) => p.map === 'area1-home-town')!;
    expect(names(roadMenu([home], content.tracks.venues, kindOf, FOUND).areas)).toEqual(['Home Town']);
  });

  it('lists nothing under a coming soon type, even a venue of its kind', () => {
    const venues = content.tracks.venues.map((v) => (v.id === 'venue-longmoor' ? { ...v, track: 'quarry' } : v));
    const menu = roadMenu(routePlaces(world, maps, lane), venues, (id) => (id === 'quarry' ? 'enduro_sprint' : kindOf(id)), FOUND);
    expect(menu.tracks.find((t) => t.name === 'Enduro Sprint')).toMatchObject({ comingSoon: true, places: [] });
    expect(menu.tracks[2].places).toEqual([]);
  });
});
