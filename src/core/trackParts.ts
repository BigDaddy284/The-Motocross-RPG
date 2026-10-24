import type { SceneryItem, TrackDef } from './race';
import { lapGeom, pointAt, START_PAD, startGeom, startHalfWidth, startPointAt } from './trackGeom';
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
}

export interface TrackPartsData {
  /** Shows the section editor in tools/track-editor.html. Off for Final v1. */
  sectionEditor: boolean;
  kinds: TrackKind[];
  lines: string[];
  surfaces: TrackSurfaceDef[];
  ground: GroundDef[];
  scenery: SceneryDef[];
}

const ID = /^[a-z0-9_.-]+$/;
const IDS = { type: 'string', pattern: ID } as const;
const S = { type: 'string', nonEmpty: true } as const;
const COLOR = { type: 'string', pattern: /^#[0-9a-fA-F]{3,8}$/ } as const;
const ART = { type: 'string', pattern: /^[a-z0-9_-]+\/[a-z0-9_.-]+$/ } as const;

export const TRACK_PARTS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    sectionEditor: { type: 'boolean' },
    kinds: { type: 'array', minItems: 1, items: { type: 'object', fields: { id: IDS, name: S, view: { type: 'string', oneOf: ['screen', 'follow'] }, desc: S } } },
    lines: { type: 'array', minItems: 1, items: IDS },
    surfaces: { type: 'array', items: { type: 'object', fields: { id: IDS, name: S, color: COLOR } } },
    ground: { type: 'array', minItems: 1, items: { type: 'object', optional: ['art'], fields: { id: IDS, name: S, art: ART, color: COLOR } } },
    scenery: {
      type: 'array',
      items: {
        type: 'object',
        optional: ['art', 'text', 'overTrack'],
        fields: { id: IDS, name: S, w: { type: 'number', min: 0.1 }, h: { type: 'number', min: 0.1 }, color: COLOR, art: ART, text: { type: 'string' }, overTrack: { type: 'boolean' } },
      },
    },
  },
};

export const DEFAULT_TRACK_WIDTH = 3.4;
export const GRID_W = 100;
export const GRID_H = 60;

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
    for (const j of sceneryOnTrack(parts, t)) err(F.tracks, at(`scenery[${j}]`), `the ${t.scenery![j].type.replace(/_/g, ' ')} at ${t.scenery![j].x}, ${t.scenery![j].y} is on the racing surface, where riders would ride through it`);
  });
  return errors;
}

/**
 * Scenery that sits on the racing surface (the track's width either side of the drawing, the start straight included), by
 * index. Riders ride anywhere across the track, so anything there would be ridden through. Items
 * built to stand over the track (overTrack) are allowed.
 */
export function sceneryOnTrack(parts: TrackPartsData, track: TrackDef): number[] {
  const g = lapGeom(track.path);
  const hw = (track.width ?? DEFAULT_TRACK_WIDTH) / 2;
  const n = Math.max(200, Math.ceil(g.total / 0.25));
  const pts = Array.from({ length: n }, (_, i) => ({ ...pointAt(g, i / n), hw }));
  // The start straight and the pad behind its gate are racing surface too, wider at the gate.
  const start = startGeom(track, g);
  if (start.total > 0) for (let u = -START_PAD; u <= start.total; u += 0.25) pts.push({ ...startPointAt(start, u), hw: startHalfWidth(start, u, hw) });
  const out: number[] = [];
  (track.scenery ?? []).forEach((it: SceneryItem, i) => {
    const def = parts.scenery.find((d) => d.id === it.type);
    if (!def || def.overTrack) return;
    const w = it.w ?? def.w;
    const d = it.h ?? def.h;
    const a = ((it.rot ?? 0) * Math.PI) / 180;
    const reach = Math.hypot(w, d) / 2;
    const near = pts.filter((p) => Math.hypot(p.x - it.x, p.y - it.y) < reach + p.hw);
    if (!near.length) return;
    for (let u = -0.5; u <= 0.5001; u += 0.1) {
      for (let v = -0.5; v <= 0.5001; v += 0.25) {
        const x = it.x + u * w * Math.cos(a) - v * d * Math.sin(a);
        const y = it.y + u * w * Math.sin(a) + v * d * Math.cos(a);
        if (near.some((p) => Math.hypot(p.x - x, p.y - y) < p.hw - 1e-6)) {
          out.push(i);
          return;
        }
      }
    }
  });
  return out;
}
