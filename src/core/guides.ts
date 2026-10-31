import type { PlaceDef, RouteDef, WorldData } from './career';
import { objectTile, type BakedMap, type MapObject } from './mapTypes';
import type { VenueDef } from './raceDay';
import { ROUTE, spawnTile, type Arrival, type Travel } from './travel';

// The roads out of an area: each of its exits, where it goes (another map, or a route with a
// choice of places from data/world.json, picked at the road), and whether it is open yet.
// (Boss, 28 Oct 2026: the route marshals who gave directions are gone from the game.)

export interface Way {
  exit: MapObject;
  /** Which edge of the map it is on, for directions. */
  side: string;
  /** The map it goes straight to, for a plain exit. */
  to?: { map: string; title: string };
  /** The route and its places, for an exit with a choice of places. */
  route?: RouteDef;
  places: PlaceDef[];
  /** Why it can't be used yet, if it can't. */
  shut: string | null;
}

/** Which edge of the map an exit is on. */
export function sideOf(map: BakedMap, o: MapObject): string {
  const t = objectTile(o, map.tileSize);
  if (t.x <= 1) return 'west';
  if (t.x >= map.width - 2) return 'east';
  if (t.y >= map.height - 2) return 'south';
  if (t.y <= 1) return 'north';
  return 'over there';
}

/**
 * The places a route really leads to: listed in places, on a map that exists, with the spawn to
 * arrive on; or the mod track list, which is raced from the road without going anywhere.
 */
export function routePlaces(world: WorldData, maps: Map<string, BakedMap>, route: RouteDef): PlaceDef[] {
  return route.to.flatMap((id) => {
    const place = world.places.find((p) => p.map === id);
    if (place?.mods) return [place];
    const m = place && maps.get(place.map);
    return place?.spawn && m && spawnTile(m, place.spawn) && place.map !== route.map ? [place] : [];
  });
}

export function routeFor(world: WorldData, map: BakedMap, exit: MapObject): RouteDef | undefined {
  return world.routes.find((r) => r.map === map.id && r.exit === exit.name);
}

/** Every way out of a map, one per exit name. */
export function waysOut(map: BakedMap, world: WorldData, maps: Map<string, BakedMap>, travel: Travel, flags: Record<string, boolean>): Way[] {
  const ways: Way[] = [];
  for (const exit of map.objects) {
    if (exit.type !== 'exit' || ways.some((w) => w.exit.name === exit.name)) continue;
    const shut = travel.shut(map, exit, flags);
    const side = sideOf(map, exit);
    if (exit.props.to === ROUTE) {
      const route = routeFor(world, map, exit);
      ways.push({ exit, side, route, places: route ? routePlaces(world, maps, route) : [], shut });
    } else if (typeof exit.props.to === 'string') {
      const m = maps.get(exit.props.to);
      ways.push({ exit, side, to: m ? { map: m.id, title: m.title } : undefined, places: [], shut });
    }
  }
  return ways;
}

/**
 * Where a route exit takes you: the place picked (`pick`), or otherwise the first place it goes.
 * A string is why it can't take you anywhere.
 * The mod track list is never where a road takes you by itself: it is picked (WorldScene.routeTo).
 */
export function routeArrival(map: BakedMap, exit: MapObject, world: WorldData, maps: Map<string, BakedMap>, pick: string | null): (Arrival & { place: PlaceDef; others: PlaceDef[] }) | string {
  const route = routeFor(world, map, exit);
  const places = route ? routePlaces(world, maps, route) : [];
  const real = places.filter((p) => !p.mods);
  if (!real.length) return "This road doesn't go anywhere yet.";
  const place = real.find((p) => p.map === pick) ?? real[0];
  return { map: place.map, tile: spawnTile(maps.get(place.map)!, place.spawn!)!, place, others: places.filter((p) => p !== place) };
}

// ---- the road menu (Boss, 30 Oct 2026) ----
// Leaving by a route opens one menu: Tracks (by type, then the unlocked tracks of that type, and
// the unlocked championships), Areas (the places that aren't tracks), Mod Tracks and Not now.

/**
 * The track types on the road menu, in order, and the trackParts.json kinds each one lists. A
 * comingSoon type lists nothing and says Coming soon when picked (Boss, 30 Oct 2026).
 */
export const ROAD_TRACK_TYPES: { id: string; name: string; kinds: string[]; comingSoon?: boolean }[] = [
  { id: 'motocross', name: 'Motocross', kinds: ['outdoor'] },
  { id: 'supercross', name: 'Supercross', kinds: ['stadium'] },
  { id: 'enduro_loop', name: 'Enduro Loop', kinds: ['endurance'] },
  { id: 'enduro_sprint', name: 'Enduro Sprint', kinds: ['enduro_sprint'], comingSoon: true },
  { id: 'endurocross', name: 'EnduroCross', kinds: ['endurocross'], comingSoon: true },
  { id: 'no_turn', name: 'No-Turn Takedown', kinds: ['no_turn'], comingSoon: true },
];

export interface RoadMenu {
  /** One per track type, in ROAD_TRACK_TYPES order, with its unlocked tracks' places. */
  tracks: { id: string; name: string; comingSoon: boolean; places: PlaceDef[] }[];
  /** Places on the road that aren't a track: Home Town and the like. */
  areas: PlaceDef[];
  /** True when the road has the mod track list. */
  mods: boolean;
}

/**
 * Sorts a road's places into the road menu. A place is a track when a race venue (not a practice
 * loop) is on its map; it is listed under its track's type once the venue is open (not locked,
 * and its needs flag set), and left out until then. `kindOf` is the venue's track kind.
 */
export function roadMenu(
  places: PlaceDef[],
  venues: Pick<VenueDef, 'map' | 'needs' | 'locked' | 'practiceOnly' | 'track'>[],
  kindOf: (track: string) => string | undefined,
  flags: Record<string, boolean>,
): RoadMenu {
  const tracks = ROAD_TRACK_TYPES.map((t) => ({ id: t.id, name: t.name, comingSoon: !!t.comingSoon, places: [] as PlaceDef[] }));
  const areas: PlaceDef[] = [];
  for (const p of places) {
    if (p.mods) continue;
    const venue = venues.find((v) => v.map === p.map && !v.practiceOnly);
    if (!venue) {
      areas.push(p);
      continue;
    }
    if (venue.locked || (venue.needs && !flags[venue.needs])) continue;
    const kind = (venue.track && kindOf(venue.track)) || 'outdoor';
    const i = ROAD_TRACK_TYPES.findIndex((t) => t.kinds.includes(kind));
    if (i >= 0 && !tracks[i].comingSoon) tracks[i].places.push(p);
  }
  return { tracks, areas, mods: places.some((p) => p.mods) };
}
