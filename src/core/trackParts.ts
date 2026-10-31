import { elevationIssues, lapProfile } from './elevation';
import type { TrackDef } from './race';
import { OFFICIAL_ITEM, officialPlan, placedOfficial } from './startOfficial';
import { cheerProblems } from './cheer';
import { sceneryIssues } from './trackClearance';
import { NO_TURN_KIND, SPRINT_KIND } from './trackGeom';
export { gridOf } from './trackGeom';
import type { ContentError, Schema } from './validate';

// The parts a track is built from beyond its sections: track kinds, surface patches, ground and
// scenery (public/data/trackParts.json). They only change how the race screen draws a track; the
// race simulation reads the sections alone, so a track races the same with or without them.

export interface TrackKind {
  id: string;
  name: string;
  /** screen: the whole track on one screen (stadiums). follow: a camera that follows the riders. */
  view: 'screen' | 'follow';
  desc: string;
}

export interface TrackSurfaceDef {
  id: string;
  name: string;
  color: string;
}

export interface GroundDef {
  id: string;
  name: string;
  /** Tile art under assets/art/area-map/tiled/tiles, without .png. */
  art?: string;
  color: string;
  /** The heading it is listed under in the track editor's ground palette; ungrouped ones come first. */
  group?: string;
}

export interface SceneryDef {
  id: string;
  name: string;
  w: number;
  h: number;
  color: string;
  art?: string;
  text?: string;
  /** Built to stand over the track (start gates, finish arches); everything else must stay off it. */
  overTrack?: boolean;
  /** Paddock vehicles (paddock.ts): the designs, set-ups and colours an item can have, picked for it when it names none. */
  variants?: [string, string][];
  setups?: [string, string][];
  colours?: string[];
  /** A new item from a model in the models folder (modModels.ts), added when the game loads; never in trackParts.json. */
  model?: boolean;
}

export interface TrackPartsData {
  /** Shows the section editor in tools/track-editor.html. Off for Final v1. */
  sectionEditor: boolean;
  kinds: TrackKind[];
  lines: string[];
  surfaces: TrackSurfaceDef[];
  ground: GroundDef[];
  scenery: SceneryDef[];
  /** The start official placed as scenery (start_official): the longest walk allowed, in grid units (startOfficial MAX_WALK when left out). */
  official?: { maxWalk: number };
}

const ID = /^[a-z0-9_.-]+$/;
const IDS = { type: 'string', pattern: ID } as const;
const S = { type: 'string', nonEmpty: true } as const;
const COLOR = { type: 'string', pattern: /^#[0-9a-fA-F]{3,8}$/ } as const;
/** Options an item can have: [id, name] pairs. */
const OPTIONS = { type: 'array', minItems: 1, items: { type: 'array', minItems: 2, maxItems: 2, items: S } } as const;
const ART = { type: 'string', pattern: /^[a-z0-9_-]+\/[a-z0-9_.-]+$/ } as const;

export const TRACK_PARTS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note', 'official'],
  fields: {
    note: { type: 'string' },
    official: { type: 'object', fields: { maxWalk: { type: 'number', min: 1, max: 30 } } },
    sectionEditor: { type: 'boolean' },
    kinds: { type: 'array', minItems: 1, items: { type: 'object', fields: { id: IDS, name: S, view: { type: 'string', oneOf: ['screen', 'follow'] }, desc: S } } },
    lines: { type: 'array', minItems: 1, items: IDS },
    surfaces: { type: 'array', items: { type: 'object', fields: { id: IDS, name: S, color: COLOR } } },
    ground: { type: 'array', minItems: 1, items: { type: 'object', optional: ['art', 'group'], fields: { id: IDS, name: S, art: ART, color: COLOR, group: S } } },
    scenery: {
      type: 'array',
      items: {
        type: 'object',
        optional: ['art', 'text', 'overTrack', 'variants', 'setups', 'colours'],
        fields: { id: IDS, name: S, w: { type: 'number', min: 0.1 }, h: { type: 'number', min: 0.1 }, color: COLOR, art: ART, text: { type: 'string' }, overTrack: { type: 'boolean' }, variants: OPTIONS, setups: OPTIONS, colours: { type: 'array', minItems: 1, items: COLOR } },
      },
    },
  },
};

export const DEFAULT_TRACK_WIDTH = 3.4;
export { GRID_H, GRID_W } from './trackGeom';

export function trackKind(parts: TrackPartsData, track: TrackDef): TrackKind {
  return parts.kinds.find((k) => k.id === track.kind) ?? parts.kinds.find((k) => k.id === 'outdoor') ?? parts.kinds[0];
}

/** Cross-checks the track parts each track uses. `artExists` says whether a tile image is there. */
export function checkTrackParts(parts: TrackPartsData, tracks: TrackDef[], artExists: (art: string) => boolean): ContentError[] {
  const errors: ContentError[] = [];
  const F = { parts: 'data/trackParts.json', tracks: 'data/tracks.json' };
  const err = (file: string, field: string, message: string) => errors.push({ file, field, message });
  for (const list of ['kinds', 'surfaces', 'ground', 'scenery'] as const) {
    const seen = new Set<string>();
    parts[list].forEach((p, i) => {
      if (seen.has(p.id)) err(F.parts, `${list}[${i}].id`, `"${p.id}" is used twice`);
      seen.add(p.id);
    });
  }
  parts.ground.forEach((g, i) => g.art && !artExists(g.art) && err(F.parts, `ground[${i}].art`, `no tile art "${g.art}"`));
  parts.scenery.forEach((g, i) => g.art && !artExists(g.art) && err(F.parts, `scenery[${i}].art`, `no tile art "${g.art}"`));

  const kinds = new Set(parts.kinds.map((k) => k.id));
  const lines = new Set(parts.lines);
  const surfaces = new Set(parts.surfaces.map((s) => s.id));
  const ground = new Set(parts.ground.map((g) => g.id));
  const scenery = new Set(parts.scenery.map((s) => s.id));
  tracks.forEach((t, i) => {
    const at = (f: string) => `tracks[${i}].${f}`;
    if (t.kind && !kinds.has(t.kind)) err(F.tracks, at('kind'), `no track kind "${t.kind}" in ${F.parts}`);
    t.sections.forEach((s, j) => s.line && !lines.has(s.line) && err(F.tracks, at(`sections[${j}].line`), `no line "${s.line}" in ${F.parts}`));
    const lap = t.sections.reduce((a, s) => a + s.length, 0);
    t.patches?.forEach((p, j) => {
      if (!surfaces.has(p.surface)) err(F.tracks, at(`patches[${j}].surface`), `no surface "${p.surface}" in ${F.parts}`);
      if (p.at >= lap) err(F.tracks, at(`patches[${j}].at`), `${p.at} m is past the end of the ${lap} m lap`);
    });
    if (t.ground) {
      if (!ground.has(t.ground.base)) err(F.tracks, at('ground.base'), `no ground "${t.ground.base}" in ${F.parts}`);
      for (const id of Object.keys(t.ground.paint)) if (!ground.has(id)) err(F.tracks, at(`ground.paint.${id}`), `no ground "${id}" in ${F.parts}`);
    }
    t.scenery?.forEach((s, j) => !scenery.has(s.type) && err(F.tracks, at(`scenery[${j}].type`), `no scenery "${s.type}" in ${F.parts}`));
    // Errors only: warnings (sceneryIssues) are for the track editor to show, and never stop the game.
    for (const p of sceneryIssues(parts, t)) if (p.level === 'error') err(F.tracks, at(`scenery[${p.i}]`), p.message);
    for (const p of cheerProblems(t, parts)) if (p.level === 'error') err(F.tracks, at(`scenery[${p.i}]`), p.message);
    if (t.elevation) {
      const { mpu, along } = lapProfile(t);
      for (const p of elevationIssues(t, mpu, along)) if (p.level === 'error') err(F.tracks, at('elevation'), p.message);
    }
    if (t.kind === SPRINT_KIND && t.scenery?.some((s) => s.type === OFFICIAL_ITEM)) {
      err(F.tracks, at(`scenery[${t.scenery.findIndex((s) => s.type === OFFICIAL_ITEM)}]`), 'an Enduro Sprint has no start board official: riders leave one at a time from the start line');
    } else if (t.kind === NO_TURN_KIND && t.scenery?.some((s) => s.type === OFFICIAL_ITEM)) {
      err(F.tracks, at(`scenery[${t.scenery.findIndex((s) => s.type === OFFICIAL_ITEM)}]`), "a No-Turn Takedown has no start board official: the starter stands in the starter's box on the start platform");
    } else if (t.scenery?.some((s) => s.type === OFFICIAL_ITEM)) {
      // Placed by the track: every problem with where they stand and walk.
      const j = t.scenery.findIndex((s) => s.type === OFFICIAL_ITEM);
      for (const m of placedOfficial(t, parts).problems) err(F.tracks, at(`scenery[${j}]`), m);
    } else if (!t.practiceOnly && t.start && t.kind !== NO_TURN_KIND) {
      try {
        officialPlan(t, parts);
      } catch {
        err(F.tracks, at('start'), 'there is nowhere beside the start straight clear of the track and scenery for the start official to stand and walk');
      }
    }
  });
  return errors;
}
