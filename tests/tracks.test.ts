import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkContent } from '../src/core/content';
import { checkTrackParts, trackKind } from '../src/core/trackParts';
import { lapGeom, lapMetres, sectionTurns } from '../src/core/trackGeom';
import { loadManifest, loadMaps, rawContent } from './helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILES = path.join(ROOT, 'public/assets/art/area-map/tiled/tiles');
const artExists = (rel: string) => fs.existsSync(path.join(TILES, `${rel}.png`));
const content = checkContent(rawContent(), loadManifest(), loadMaps()).content!;

describe('track parts and track layouts', () => {
  it('finds the art for every ground tile and scenery piece', () => {
    expect(checkTrackParts(content.trackParts, content.tracks.tracks, artExists)).toEqual([]);
  });

  it('spots a missing piece of art, an unknown ground tile and a patch past the lap', () => {
    const tracks = structuredClone(content.tracks.tracks);
    const t = tracks.find((x) => x.ground)!;
    t.ground!.paint.nonsense = [[1, 1]];
    t.patches = [{ surface: 'mud', at: 99999, length: 10 }];
    const problems = checkTrackParts(content.trackParts, tracks, () => false).map((e) => `${e.field}: ${e.message}`);
    expect(problems.some((p) => p.includes('nonsense'))).toBe(true);
    expect(problems.some((p) => /art/i.test(p))).toBe(true);
    expect(problems.some((p) => /past the end/.test(p))).toBe(true);
  });

  it('has one track of each kind, all inside the grid', () => {
    const kinds = new Set(content.tracks.tracks.map((t) => trackKind(content.trackParts, t).id));
    for (const k of ['stadium', 'outdoor', 'endurance']) expect(kinds.has(k)).toBe(true);
    for (const t of content.tracks.tracks) {
      const g = lapGeom(t.path);
      expect(g.total).toBeGreaterThan(0);
      expect(lapMetres(t)).toBeGreaterThan(0);
      expect(sectionTurns(t, g)).toHaveLength(t.sections.length);
      for (const [x, y] of t.path) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(60);
      }
    }
  });
});
