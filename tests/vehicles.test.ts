import { describe, expect, it } from 'vitest';
import { npcsOnMap, checkContent, type Content } from '../src/core/content';
import { Grid } from '../src/core/grid';
import { applyMapState } from '../src/core/mapState';
import type { BakedMap } from '../src/core/mapTypes';
import { SAVE_VERSION, parseSave } from '../src/core/saves';
import { Travel, spawnTile, stepTriggerAt } from '../src/core/travel';
import {
  DriveMap, HEADINGS, bayFor, OPPOSITE, centre, ensureVan, exitTile, footprint, forward, inwardHeading, overhang, placeNear, planDrive, reverse, steer, turn,
  type Heading, type Move, type VanPose, type VehiclesData,
} from '../src/core/vehicles';
import { loadManifest, loadMaps, publicFileExists, rawContent } from './helpers';

const manifest = loadManifest();
const maps = loadMaps();
const content = checkContent(rawContent(), manifest, maps).content as Content;
const data = content.vehicles;
const HOME = 'area1-home-town';
const ALL_FLAGS = { van_owned: true, van_loaded: true, tutorial_done: true, first_race_done: true };

/** The drivable map as the world builds it: story changes applied, NPCs standing in the road. */
function driveMap(id: string, flags: Record<string, boolean> = {}): DriveMap {
  const map = maps.get(id)!;
  const grid = Grid.fromMap(map);
  applyMapState(map, grid, flags);
  const dm = new DriveMap(map, grid, data);
  dm.setNpcTiles(npcsOnMap(content, map).map((p) => ({ x: p.x, y: p.y })));
  return dm;
}

/** Plays moves the way the world does, checking each one still fits. */
function play(dm: DriveMap, start: VanPose, length: number, moves: Move[]): VanPose {
  let p = start;
  for (const m of moves) {
    expect(dm.fits(m.to, length)).toBe(true);
    p = m.to;
  }
  return p;
}

describe('van sheets and footprints', () => {
  it('every design has a sheet with all four headings, closed and rear open', () => {
    for (const d of data.designs) {
      const sheet = manifest.vehicles?.[d.id];
      expect(sheet, d.id).toBeDefined();
      expect(publicFileExists(`assets/${sheet!.image}`), sheet!.image).toBe(true);
      for (const h of HEADINGS) {
        const v = sheet!.views[h];
        expect(v.closed[2]).toBe(v.open[2]);
        expect(v.closed[3]).toBe(v.open[3]);
      }
      // Opposite headings share a cell size and anchor, so turning round never makes the van jump.
      expect(sheet!.views.east.anchor).toEqual(sheet!.views.west.anchor);
      expect(sheet!.views.north.anchor).toEqual(sheet!.views.south.anchor);
      expect(sheet!.views.east.closed.slice(2)).toEqual(sheet!.views.west.closed.slice(2));
    }
  });

  it('the footprint follows the real length at 28 px per metre, so longer vans take more tiles', () => {
    for (const d of data.designs) expect(d.length, d.id).toBe(Math.round((d.lengthM * 28) / 64));
    const byLength = [...data.designs].sort((a, b) => a.lengthM - b.lengthM);
    for (let i = 1; i < byLength.length; i++) expect(byLength[i].length).toBeGreaterThanOrEqual(byLength[i - 1].length);
    expect(data.designs.find((d) => d.id === 'motor-7')!.length).toBe(9);
  });

  it('a footprint is one tile wide, front first, and its centre is the middle of its tiles', () => {
    expect(footprint({ x: 5, y: 3, heading: 'east' }, 3)).toEqual([{ x: 5, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 3 }]);
    expect(footprint({ x: 5, y: 3, heading: 'north' }, 2)).toEqual([{ x: 5, y: 3 }, { x: 5, y: 4 }]);
    expect(centre({ x: 5, y: 3, heading: 'west' }, 2)).toEqual({ x: 6, y: 3.5 });
  });

  it('the starter van is Van 1 and fits its spot behind the van seller', () => {
    expect(data.starter.design).toBe('motor-1');
    expect(driveMap(HOME).fits(data.starter, 2)).toBe(true);
  });
});

describe('driving', () => {
  it('drives on the left along the main road: east in the top lane, west in the bottom one (Boss, 28 Oct 2026)', () => {
    const dm = driveMap(HOME);
    for (const [lane, heading] of [[12, 'east'], [13, 'west']] as [number, Heading][]) {
      let p: VanPose = { x: heading === 'east' ? 28 : 33, y: lane, heading };
      for (let i = 0; i < 6; i++) {
        const m = forward(dm, p, 2);
        expect(m, `${heading} in row ${lane}`).not.toBeNull();
        p = m!.to;
      }
      expect(p.y).toBe(lane);
      expect(dm.fits({ x: 30, y: 25 - lane, heading }, 2), `${heading} in the other lane`).toBe(false);
    }
  });

  it('keeps the body off the pavement: only an end pokes over it, two tiles for the Factory Hauler', () => {
    const dm = driveMap(HOME);
    // Along the pavement above the main road: never.
    expect(dm.fits({ x: 30, y: 11, heading: 'east' }, 2)).toBe(false);
    // Nose onto the pavement across the road (lanes don't count across a road), or tail on it.
    expect(dm.fits({ x: 30, y: 11, heading: 'north' }, 3)).toBe(true);
    expect(dm.fits({ x: 30, y: 13, heading: 'south' }, 3)).toBe(true);
    // On the south pavement, two tiles deep, only a long van's end may stand.
    expect(dm.fits({ x: 8, y: 15, heading: 'south' }, 4)).toBe(false);
    expect(overhang(4)).toBe(1);
    expect(overhang(9)).toBe(2);
  });

  it('reverses, and turns round into the other lane', () => {
    const dm = driveMap(HOME);
    const p: VanPose = { x: 30, y: 12, heading: 'east' };
    expect(reverse(dm, p, 2)!.to).toEqual({ x: 29, y: 12, heading: 'east' });
    const u = steer(dm, p, 2, 'west')!;
    expect(u.kind).toBe('uturn');
    expect(u.to.heading).toBe('west');
    expect(dm.fits(u.to, 2)).toBe(true);
  });

  it('turns at the junction into the side road, for every van', () => {
    const dm = driveMap(HOME);
    for (const d of data.designs) {
      const p: VanPose = { x: 37, y: 13, heading: 'east' };
      const t = turn(dm, p, d.length, 'south');
      expect(t, d.id).not.toBeNull();
      expect(t!.to.heading).toBe('south');
    }
  });

  it('drives anywhere on the town roads by click, for every van', () => {
    const dm = driveMap(HOME, ALL_FLAGS);
    const goals = [{ x: 46, y: 12 }, { x: 37, y: 20 }, { x: 4, y: 25 }, { x: 27, y: 17 }];
    for (const d of data.designs) {
      // The world moves a longer design (the dev swap) to the nearest spot it fits, as here. The
      // Factory Hauler is too long for the town car park, so it is moved to the road beside it.
      dm.setVanLength(d.length);
      const start = placeNear(dm, data.starter, d.length, data.starter.heading)!;
      // The Factory Hauler can't turn round on the south road's two lanes (Boss, 28 Oct 2026: it
      // has a little less control), so its west end is out of reach heading west.
      for (const g of goals.filter((g) => (dm.isDrivable(g.x, g.y) || d.length <= 6) && !(d.length > 6 && g.y >= 23))) {
        const plan = planDrive(dm, start, d.length, g);
        expect(plan, `${d.id} to ${g.x},${g.y}`).not.toBeNull();
        const end = play(dm, start, d.length, plan!);
        expect(footprint(end, d.length).some((t) => t.x === g.x && t.y === g.y)).toBe(true);
      }
    }
  });

  it('keeps off the car park verges in Home Town and Riverside, in only by an entrance (Boss, 28 Oct 2026)', () => {
    const home = driveMap(HOME, ALL_FLAGS);
    // The green verge round the town car park: left, top, right, and the bottom from the P sign on.
    for (let x = 25; x <= 35; x++) expect(home.isDrivable(x, 15), `${x},15`).toBe(false);
    for (let y = 15; y <= 21; y++) for (const x of [25, 35]) expect(home.isDrivable(x, y), `${x},${y}`).toBe(false);
    for (let x = 29; x <= 35; x++) expect(home.isDrivable(x, 22), `${x},22`).toBe(false);
    // The entrance at the bottom left (between the pavements either side of it), and the car park itself.
    for (let x = 26; x <= 27; x++) expect(home.isDrivable(x, 22), `${x},22`).toBe(true);
    for (const x of [25, 28]) expect(home.isDrivable(x, 22), `${x},22`).toBe(false);
    expect(home.isDrivable(30, 18)).toBe(true);
    const river = driveMap('venue-supercross', ALL_FLAGS);
    // Both sides of the central road, with the crossings into the car parks by the P signs.
    for (const y of [13, 18, 19, 20]) expect(river.isDrivable(11, y), `11,${y}`).toBe(false);
    for (const y of [14, 18, 19, 20]) expect(river.isDrivable(16, y), `16,${y}`).toBe(false);
    for (const y of [14, 15, 16, 17]) expect(river.isDrivable(11, y), `11,${y}`).toBe(true);
    for (const y of [15, 16, 17]) expect(river.isDrivable(16, y), `16,${y}`).toBe(true);
  });

  it('keeps the Factory Hauler out of the town car park, too long to turn round in it (Boss, 28 Oct 2026)', () => {
    const dm = driveMap(HOME, ALL_FLAGS);
    const hauler = data.designs.find((d) => d.length > 6)!;
    dm.setVanLength(hauler.length);
    expect(dm.isDrivable(30, 18)).toBe(false);
    expect(dm.isDrivable(26, 22)).toBe(false);
    expect(dm.isDrivable(37, 18)).toBe(true);
    // Parked in the car park by a swap, it is moved out onto the road, and can drive away.
    const start = placeNear(dm, data.starter, hauler.length, data.starter.heading)!;
    expect(footprint(start, hauler.length).every((t) => t.x >= 36 || t.y >= 23 || t.y <= 14)).toBe(true);
    // Too long to turn round on the two-lane roads, it gets to both ways out of town.
    for (const g of [{ x: 46, y: 12 }, { x: 2, y: 13 }]) expect(planDrive(dm, start, hauler.length, g), `${g.x},${g.y}`).not.toBeNull();
    // Every other van still uses it.
    dm.setVanLength(6);
    expect(dm.isDrivable(30, 18)).toBe(true);
  });

  it('parks the Factory Hauler in the Riverside West car park on arrival (Boss, 28 Oct 2026)', () => {
    const hauler = data.designs.find((d) => d.length > 6)!;
    const bay = bayFor(data, 'venue-supercross', hauler.length)!;
    expect(bay.name).toBe('Riverside West car park');
    const dm = driveMap('venue-supercross', ALL_FLAGS);
    dm.setVanLength(hauler.length);
    expect(dm.fits(bay, hauler.length)).toBe(true);
    expect(footprint(bay, hauler.length).every((t) => t.x <= 10 && t.y >= 15 && t.y <= 19)).toBe(true);
    // Every other van drives in and finds its own spot.
    for (const d of data.designs.filter((v) => v.length <= 6)) expect(bayFor(data, 'venue-supercross', d.length), d.id).toBeNull();
    expect(bayFor(data, HOME, hauler.length)).toBeNull();
  });

  it('drives the starter van out of each car park and back in by the entrance', () => {
    const van = data.designs.find((d) => d.id === data.starter.design)!;
    const home = driveMap(HOME, ALL_FLAGS);
    const out = planDrive(home, data.starter, van.length, { x: 37, y: 20 })!;
    expect(out).not.toBeNull();
    const end = play(home, data.starter, van.length, out);
    expect(planDrive(home, end, van.length, { x: 30, y: 17 })).not.toBeNull();
    const river = driveMap('venue-supercross', ALL_FLAGS);
    const road: VanPose = { x: 13, y: 20, heading: 'north' };
    for (const g of [{ x: 5, y: 17 }, { x: 22, y: 17 }]) expect(planDrive(river, road, van.length, g), `${g.x},${g.y}`).not.toBeNull();
  });

  it('never leaves the road: grass, buildings and doors are off limits', () => {
    const dm = driveMap(HOME);
    const map = maps.get(HOME)!;
    expect(dm.isDrivable(3, 10)).toBe(false); // the rented room's door
    expect(dm.isDrivable(10, 15)).toBe(false); // grass verge
    expect(dm.isDrivable(4, 8)).toBe(false); // a building
    expect(map.objects.some((o) => o.type === 'door' && dm.isDrivable(Math.floor(o.x / 64), Math.floor(o.y / 64)))).toBe(false);
  });
});

describe('NPCs and the van', () => {
  it('a van cannot drive into an NPC, but the rider still walks through them', () => {
    const dm = driveMap(HOME);
    const p: VanPose = { x: 20, y: 13, heading: 'east' };
    dm.setNpcTiles([{ x: 21, y: 13 }]);
    expect(forward(dm, p, 2)).toBeNull();
    expect(steer(dm, p, 2, 'east')).toBeNull();
    expect(dm.fits({ x: 22, y: 13, heading: 'east' }, 2)).toBe(false);
    // Walking: NPCs are not occupants of the walking grid.
    expect(dm.grid.canStep({ x: 20, y: 13 }, { x: 21, y: 13 })).toBe(true);
  });

  it('click-driving goes round an NPC standing in the lane', () => {
    const dm = driveMap(HOME);
    dm.setNpcTiles([{ x: 25, y: 13 }]);
    const start: VanPose = { x: 20, y: 13, heading: 'east' };
    const plan = planDrive(dm, start, 2, { x: 30, y: 13 })!;
    expect(plan).not.toBeNull();
    for (const m of plan) expect(footprint(m.to, 2).some((t) => t.x === 25 && t.y === 13)).toBe(false);
  });

  it('every NPC on the area maps stands where the van cannot go', () => {
    for (const m of maps.values()) {
      if (m.kind !== 'area') continue;
      const dm = driveMap(m.id);
      for (const p of npcsOnMap(content, m)) expect(dm.isFree(p.x, p.y), `${p.npc.id} on ${m.id}`).toBe(false);
    }
  });
});

describe('map changes with the van', () => {
  const travel = new Travel(maps, content.world.locks);
  const arrivals: { from: string; map: BakedMap; tile: { x: number; y: number } }[] = [];
  for (const m of maps.values()) {
    if (m.kind !== 'area') continue;
    for (const o of m.objects) {
      if (o.type !== 'exit') continue;
      const r = travel.resolve(m, o, ALL_FLAGS);
      if (r?.kind === 'travel') arrivals.push({ from: `${m.id} ${o.name}`, map: maps.get(r.to.map)!, tile: r.to.tile });
    }
  }
  for (const d of content.world.places.filter((p) => !p.mods)) arrivals.push({ from: `a route to ${d.name}`, map: maps.get(d.map)!, tile: spawnTile(maps.get(d.map)!, d.spawn!)! });

  it('every van has room at every arrival point, pointing into the map and clear of exits', () => {
    expect(arrivals.length).toBeGreaterThan(4);
    for (const a of arrivals) {
      const dm = driveMap(a.map.id, ALL_FLAGS);
      for (const d of data.designs) {
        const pose = placeNear(dm, a.tile, d.length, inwardHeading(a.map, a.tile), 12, (t) => !!stepTriggerAt(a.map, t));
        expect(pose, `${d.id}: ${a.from}`).not.toBeNull();
        expect(dm.fits(pose!, d.length)).toBe(true);
        expect(footprint(pose!, d.length).some((t) => stepTriggerAt(a.map, t))).toBe(false);
      }
    }
  });

  it('a van arriving from the industrial zone points into Home Town and can drive away', () => {
    const map = maps.get(HOME)!;
    const spawn = spawnTile(map, 'from_industrial_zone')!;
    const dm = driveMap(HOME);
    const pose = placeNear(dm, spawn, 2, inwardHeading(map, spawn), 12, (t) => !!stepTriggerAt(map, t))!;
    expect(pose.heading).toBe('west');
    expect(forward(dm, pose, 2)).not.toBeNull();
  });
});

describe('getting in and out', () => {
  it('the rider steps out on the driver\'s side when it is clear', () => {
    const grid = Grid.fromMap(maps.get(HOME)!);
    const p: VanPose = { x: 20, y: 13, heading: 'east' };
    for (const t of footprint(p, 2)) grid.setOccupied(t, true);
    // Heading east, the driver (right-hand drive) is on the south side.
    expect(exitTile(grid, p, 2)).toEqual({ x: 20, y: 14 });
    expect(exitTile(grid, { x: 20, y: 13, heading: 'west' }, 2)).toEqual({ x: 20, y: 12 });
  });

  it('a parked van is solid to walkers', () => {
    const grid = Grid.fromMap(maps.get(HOME)!);
    for (const t of footprint(data.starter, 2)) grid.setOccupied(t, true);
    const t = footprint(data.starter, 2)[0];
    expect(grid.canStep({ x: t.x - 1, y: t.y }, t)).toBe(false);
  });
});

describe('the one van in the save', () => {
  const base = { flags: {} as Record<string, boolean>, van: null as ReturnType<typeof ensureVan> };

  it('there is no van until the story sells one, then it is the starter van at the starter spot', () => {
    const s = structuredClone(base);
    expect(ensureVan(s, data)).toBeNull();
    s.flags.van_owned = true;
    expect(ensureVan(s, data)).toEqual({ ...data.starter });
  });

  it('a parked van stays where it was left: loading never moves it or adds another', () => {
    const s = { flags: { van_owned: true }, van: { design: 'motor-1', map: 'area1-industrial-zone', x: 10, y: 17, heading: 'west' as Heading } };
    const before = structuredClone(s.van);
    ensureVan(s, data);
    ensureVan(s, data);
    expect(s.van).toEqual(before);
  });

  it('the dev option swaps the design but keeps the spot', () => {
    const s = { flags: { van_owned: true }, van: { ...data.starter } };
    ensureVan(s, data, 'motor-7');
    expect(s.van).toMatchObject({ design: 'motor-7', map: data.starter.map, x: data.starter.x, y: data.starter.y });
    ensureVan(s, data, 'motor-99');
    expect(s.van.design).toBe('motor-7');
  });

  const v3 = {
    version: 3,
    savedAt: '2026-10-24T10:00:00.000Z',
    rider: { name: 'R', look: 'player-m-start-a' },
    position: { map: HOME, x: 5, y: 19, facing: 'down' },
    flags: { van_owned: true },
    stats: { playSeconds: 10 },
    career: { money: 0, bike: { brand: 'hondmoto', class: '50cc', parts: {} }, bag: [], story: { step: 9, used: [] }, counters: {}, skills: { xp: {}, bonus: {} } },
  };

  it('a test build 3 save loads with no van record yet, so the bought van turns up at the starter spot', () => {
    const s = parseSave(JSON.stringify(v3))!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.van).toBeNull();
    expect(s.driving).toBe(false);
    expect(ensureVan(s, data)?.design).toBe('motor-1');
  });

  it('keeps the van\'s map, tile and heading through a save and load', () => {
    const van = { design: 'motor-4', map: 'venue-motocross', x: 20, y: 16, heading: 'north' };
    const s = parseSave(JSON.stringify({ ...v3, version: SAVE_VERSION, van, driving: true }))!;
    expect(s.van).toEqual(van);
    expect(s.driving).toBe(true);
    expect(parseSave(JSON.stringify({ ...v3, version: SAVE_VERSION, van: { ...van, heading: 'up' }, driving: false }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...v3, version: SAVE_VERSION, van, driving: 'yes' }))).toBeNull();
  });

  it('vehicles.json problems are caught by name', () => {
    const r = rawContent() as ReturnType<typeof rawContent> & { vehicles: VehiclesData };
    r.vehicles.starter = { ...r.vehicles.starter, x: 5, y: 16 };
    r.vehicles.designs[1].id = 'motor-1';
    const { errors } = checkContent(r, manifest, maps);
    expect(errors.map((e) => `${e.file}: ${e.field}`)).toEqual(expect.arrayContaining(['data/vehicles.json: designs[1].id', 'data/vehicles.json: starter']));
  });

  it('every heading has an opposite', () => {
    for (const h of HEADINGS) expect(OPPOSITE[OPPOSITE[h]]).toBe(h);
  });
});

describe('the bike on the back (Boss, 30 Oct 2026)', () => {
  it('gives the Old Rusty Truck a bed point for every parked view and turning frame', () => {
    const truck = data.designs.find((d) => d.id === 'motor-1')!;
    expect(truck.bed).toBeDefined();
    expect(truck.bed!.turn.length).toBe(manifest.vehicles!['motor-1'].turn!.frames.length);
    // The parked views and the turning frames facing the same way share their bed point.
    const n = truck.bed!.turn.length;
    HEADINGS.forEach((h) => expect(truck.bed!.views[h]).toEqual(truck.bed!.turn[({ east: 0, north: 1, west: 2, south: 3 } as const)[h] * (n / 4)]));
  });

  it('has the bike on its stand in every brand, for both models and all four headings', () => {
    const missing: string[] = [];
    for (const b of content.bikes.brands) {
      for (const model of ['youth', 'adult']) for (const h of HEADINGS) {
        const img = `assets/art/area-map/tiled/tiles/bike-props/bike-on-stand-${model}-${b.id}-${h}.png`;
        if (!publicFileExists(img)) missing.push(img);
      }
    }
    expect(missing).toEqual([]);
  });
});
