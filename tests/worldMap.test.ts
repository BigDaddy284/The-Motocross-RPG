import { describe, expect, it } from 'vitest';
import { newCareerState } from '../src/core/career';
import { checkContent } from '../src/core/content';
import { Travel } from '../src/core/travel';
import { biggestBike, bikeImage, checkWorldMap, zoneFor } from '../src/core/worldMap';
import { loadManifest, loadMaps, publicFileExists, rawContent } from './helpers';

const maps = loadMaps();
const content = checkContent(rawContent(), loadManifest(), maps).content!;
const travel = new Travel(maps, content.world.locks);
const wm = content.world.worldMap!;
const zone = (map: string) => zoneFor(wm, maps, travel, map)?.id ?? null;

describe('the world map (Boss, 28 Oct 2026)', () => {
  it('puts the rider in their zone, inside a building too', () => {
    expect(zone('area1-home-town')).toBe('home');
    expect(zone('int-home-local-garage')).toBe('home');
    expect(zone('int-home-rented-room')).toBe('home');
    expect(zone('area1-industrial-zone')).toBe('iz');
    expect(zone('int-iz-engine-rebuilder')).toBe('iz');
    for (const v of ['venue-motocross', 'venue-supercross', 'venue-enduro']) expect(zone(v)).toBe('hub');
  });

  it('has a zone for every area map and every building with a door on one', () => {
    for (const m of maps.values()) {
      const exit = m.objects.find((o) => o.type === 'exit');
      // Homes for later (the shed workshop, the starter terrace) have no door in town yet.
      if (m.kind === 'interior' && !travel.returnFor(String(exit?.props.interior))) continue;
      expect(zone(m.id), m.id).not.toBeNull();
    }
  });

  it('shows the biggest bike, with an image for every class and brand', () => {
    const c = newCareerState(content.bikes, content.story, 'kwakmoto', () => 0.5);
    expect(bikeImage(wm, biggestBike(content.bikes, c))).toBe('art/ui/world-map-bikes/50cc-kwakmoto.png');
    for (const cls of content.bikes.classes) for (const b of content.bikes.brands) expect(publicFileExists(`assets/${bikeImage(wm, { class: cls.id, brand: b.id, parts: {} })}`), `${cls.id} ${b.id}`).toBe(true);
    for (const img of [wm.image, ...wm.zones.flatMap((z) => (z.image ? [z.image] : []))]) expect(publicFileExists(`assets/${img}`), img).toBe(true);
  });

  it("rejects a building's inside or a map in two zones", () => {
    const bad = structuredClone(wm);
    bad.zones[0].maps.push('int-home-local-garage', 'area1-industrial-zone');
    const errors = checkWorldMap('data/world.json', bad, maps);
    expect(errors.map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringMatching(/building's inside/), expect.stringMatching(/in zone "home" too|in zone "iz" too/)]));
  });
});
