#!/usr/bin/env node
// Imports the art threads' Tiled maps and sprites into the game.
//
// Reads from the shared art folder (default /mnt/project-files/art, or ART_SRC / first argument),
// copies every image a map or character uses into public/assets/art/, and bakes each Tiled map
// into one game-ready JSON file in public/assets/maps/. The game never reads .tmj or .tsj files
// directly: Phaser cannot load image-collection tilesets, and baking also resolves building
// sprites, collision, edge walls and data objects once instead of on every load.
//
//   node tools/import-art.mjs [/path/to/art]
//   node tools/import-art.mjs --vehicles [/path/to/art]   only the van sheets, leaving the maps as they are

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const VEHICLES_ONLY = ARGS.includes('--vehicles');
const ART = path.resolve(ARGS.find((a) => !a.startsWith('--')) ?? process.env.ART_SRC ?? '/mnt/project-files/art');
const OUT_ART = path.join(ROOT, 'public/assets/art');
const OUT_MAPS = path.join(ROOT, 'public/assets/maps');
const TILE = 64;
const GID_MASK = 0x1fffffff; // strips Tiled's flip flags

const AREA_MAPS = [
  'area-map/tiled/maps/area1-home-town.tmj',
  'area-map/tiled/maps/area1-industrial-zone.tmj',
  'area-map/tiled/maps/venue-motocross.tmj',
  'area-map/tiled/maps/venue-enduro.tmj',
  'area-map/tiled/maps/venue-supercross.tmj',
];
const INTERIOR_DIR = 'buildings/tiled/maps/interiors';
const BUILDINGS_DATA = 'buildings/data/area1-buildings-v3.json';


/**
 * Images another thread redraws in place of a map's own art, keyed by the path the maps use.
 * The in-world bike on its paddock stand is the vehicles thread's (Boss's brief, 24 Oct 2026:
 * "Update or revert in world bike models.png"), drawn to the same canvas so placements don't move.
 */
const OVERRIDES = {
  'buildings/tiled/tiles/interior-furniture/bike_on_stand+shadow.png': 'vehicles/sheets/furniture/bike_on_stand+shadow.png',
};

/**
 * Prop folders copied whole, whether or not a map uses them yet, so the map editor's palette offers
 * them: the parked vehicles and bikes on stands (vehgen/paddockbuild.py, Boss's brief of 27 Oct 2026).
 * The ground folders go whole too, for the track editor's ground tiles (trackParts.json ground):
 * every corner set, and the mixed tiles of tools/art/ground-mix.py.
 */
const PALETTE_DIRS = ['area-map/tiled/tiles/vehicle-props', 'area-map/tiled/tiles/bike-props', 'area-map/tiled/tiles/ground-edges', 'area-map/tiled/tiles/terrain-common', 'area-map/tiled/tiles/ground-mix'];

const copied = new Set();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Copies an art file into public/assets/art and returns its path relative to public/assets. */
function useImage(absPath) {
  const rel = path.relative(ART, absPath).split(path.sep).join('/');
  if (rel.startsWith('..')) throw new Error(`Image outside the art folder: ${absPath}`);
  if (!copied.has(rel)) {
    const dest = path.join(OUT_ART, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(OVERRIDES[rel] ? path.join(ART, OVERRIDES[rel]) : absPath, dest);
    copied.add(rel);
  }
  return `art/${rel}`;
}

function props(list) {
  const out = {};
  for (const p of list ?? []) out[p.name] = p.value;
  return out;
}

/** Loads a map's external tilesets and returns a gid lookup. */
function loadTilesets(mapFile, map) {
  const lookup = new Map();
  for (const ts of map.tilesets) {
    if (!ts.source) throw new Error(`${mapFile}: embedded tilesets are not supported`);
    const tsFile = path.resolve(path.dirname(mapFile), ts.source);
    const tileset = readJson(tsFile);
    const align = tileset.objectalignment ?? 'bottomleft';
    for (const tile of tileset.tiles ?? []) {
      lookup.set(ts.firstgid + tile.id, {
        firstgid: ts.firstgid,
        imageAbs: path.resolve(path.dirname(tsFile), tile.image),
        w: tile.imagewidth,
        h: tile.imageheight,
        align,
        props: props(tile.properties),
        animation: tile.animation ?? null,
      });
    }
  }
  return lookup;
}

function bakeMap(mapFile, kind, buildings) {
  const map = readJson(mapFile);
  const gids = loadTilesets(mapFile, map);
  const mapProps = props(map.properties);
  const id = path.basename(mapFile, '.tmj');
  const { width, height } = map;
  if (map.tilewidth !== TILE || map.tileheight !== TILE) throw new Error(`${id}: tiles must be ${TILE} px`);

  const images = [];
  const imageIndex = new Map();
  const img = (abs) => {
    const p = useImage(abs);
    if (!imageIndex.has(p)) {
      imageIndex.set(p, images.length);
      images.push(p);
    }
    return imageIndex.get(p);
  };

  const ground = [];
  const sprites = [];
  const blocked = Array.from({ length: height }, () => Array(width).fill('.'));
  const edgeWalls = [];
  const objects = [];

  for (const layer of map.layers) {
    if (layer.type === 'tilelayer') {
      if (layer.name === 'Collision') {
        layer.data.forEach((gid, i) => {
          if (gid & GID_MASK) blocked[Math.floor(i / width)][i % width] = '#';
        });
        continue;
      }
      // Ground-style layers: each cell holds one tile image, drawn bottom-left on its cell.
      const cells = layer.data.map((raw) => {
        const gid = raw & GID_MASK;
        if (!gid) return -1;
        const t = gids.get(gid);
        if (!t) throw new Error(`${id}: layer ${layer.name} uses unknown gid ${gid}`);
        return img(t.imageAbs);
      });
      ground.push({ name: layer.name, cells });
      continue;
    }
    if (layer.type !== 'objectgroup') continue;

    const overhead = layer.name === 'Overhead';
    for (const o of layer.objects) {
      const p = props(o.properties);
      if (layer.name === 'Partitions' && o.polyline) {
        for (let i = 1; i < o.polyline.length; i++) {
          const a = o.polyline[i - 1];
          const b = o.polyline[i];
          edgeWalls.push([
            Math.round((o.x + a.x) / TILE),
            Math.round((o.y + a.y) / TILE),
            Math.round((o.x + b.x) / TILE),
            Math.round((o.y + b.y) / TILE),
          ]);
        }
        continue;
      }
      if (o.type === 'building' && !o.gid) {
        const b = buildings.get(p.blueprint);
        if (!b) throw new Error(`${id}: building ${p.blueprint} is not in ${BUILDINGS_DATA}`);
        const s = b.sprite;
        sprites.push({
          img: img(path.join(ART, 'buildings', s.sheet)),
          crop: [s.x, s.y, s.w, s.h],
          x: o.x,
          y: o.y,
          w: s.w,
          h: s.h,
          depth: o.y + b.size[1] * TILE,
          overhead,
        });
        objects.push({ type: 'building', name: o.name, x: o.x, y: o.y, w: o.width, h: o.height, props: { ...p, npc: b.npc } });
        continue;
      }
      if (o.gid) {
        const t = gids.get(o.gid & GID_MASK);
        if (!t) throw new Error(`${id}: object ${o.name} uses unknown gid ${o.gid}`);
        const w = o.width || t.w;
        const h = o.height || t.h;
        let left = o.x;
        let top = o.y - h;
        if (t.align === 'bottom') left = o.x - w / 2;
        else if (t.align === 'topleft') top = o.y;
        else if (t.align === 'center') { left = o.x - w / 2; top = o.y - h / 2; }
        const frames = t.animation?.map((f) => ({ img: img(gids.get(t.firstgid + f.tileid).imageAbs), ms: f.duration }));
        sprites.push({
          img: img(t.imageAbs),
          x: left,
          y: top,
          w,
          h,
          depth: top + h,
          overhead,
          ...(frames ? { frames } : {}),
        });
        continue;
      }
      // A blocker's cleared look (cleared_tile, a tile name) is baked as an image the game draws
      // over the blocker's ground detail once the story clears it.
      if (o.type === 'blocker' && typeof p.cleared_tile === 'string') {
        const t = [...gids.values()].find((g) => g.props.name === p.cleared_tile);
        if (!t) throw new Error(`${id}: blocker ${o.name} names unknown cleared_tile ${p.cleared_tile}`);
        p.cleared_img = img(t.imageAbs);
      }
      objects.push({
        type: o.type,
        name: o.name,
        x: o.x,
        y: o.y,
        w: o.width,
        h: o.height,
        ...(o.point ? { point: true } : {}),
        props: p,
      });
    }
  }

  return {
    id,
    title: mapProps.title ?? mapProps.name ?? id,
    kind,
    width,
    height,
    tileSize: TILE,
    props: mapProps,
    images,
    ground,
    sprites,
    blocked: blocked.map((row) => row.join('')),
    edgeWalls,
    objects,
  };
}

function copyCharacters() {
  const chars = readJson(path.join(ART, 'characters/characters.json'));
  const out = { frame: chars.frame, anchor: chars.anchor, rows: chars.rows, walk: chars.walk, act: chars.act, sheets: {} };
  for (const n of chars.npcs) {
    out.sheets[n.id] = { name: n.name, walk: useImage(path.join(ART, 'characters', n.walk)), act: useImage(path.join(ART, 'characters', n.act)) };
  }
  for (const pid of chars.players) {
    out.sheets[pid] = {
      name: pid,
      walk: useImage(path.join(ART, 'characters/player', `${pid}.png`)),
      act: useImage(path.join(ART, 'characters/player', `${pid}.act.png`)),
      // The push-up frames for the Fitness drill (up, down), when the art has them.
      ...(fs.existsSync(path.join(ART, 'characters/player', `${pid}.fit.png`)) ? { fit: useImage(path.join(ART, 'characters/player', `${pid}.fit.png`)) } : {}),
    };
  }
  return out;
}

/**
 * The player's van sheets (vehicles thread, Boss's brief of 24 Oct 2026): one sheet per design in
 * public/data/vehicles.json, with each heading's closed and rear-open cells, the anchor (ground
 * under the footprint centre) and the driver window.
 */
function copyVehicles() {
  const data = readJson(path.join(ROOT, 'public/data/vehicles.json'));
  const out = {};
  for (const d of data.designs) {
    const dir = path.join(ART, 'vehicles/sheets/map');
    // The sheets keep their van names (art), the designs are motors (Boss, 28 Oct 2026).
    const art = d.art ?? d.id;
    const sheet = readJson(path.join(dir, `map-${art}.json`));
    if (sheet.footprintTiles[0] !== d.length) throw new Error(`map-${art}.json: footprint ${sheet.footprintTiles[0]} tiles, but vehicles.json says ${d.length}`);
    out[d.id] = { image: useImage(path.join(dir, `map-${art}.png`)), views: sheet.views };
    // The turning frames (vehgen/vanrot.py), when drawn.
    const turnJson = path.join(dir, `map-${art}-turn.json`);
    if (fs.existsSync(turnJson)) out[d.id].turn = { image: useImage(path.join(dir, `map-${art}-turn.png`)), frames: readJson(turnJson).frames };
  }
  return out;
}

function copyPaletteDirs() {
  for (const d of PALETTE_DIRS) {
    const dir = path.join(ART, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) useImage(path.join(dir, f));
  }
}

function main() {
  if (VEHICLES_ONLY) {
    const file = path.join(ROOT, 'public/assets/manifest.json');
    const manifest = readJson(file);
    manifest.vehicles = copyVehicles();
    fs.writeFileSync(file, JSON.stringify(manifest, null, 1));
    console.log(`copied ${copied.size} van sheets`);
    return;
  }
  if (!fs.existsSync(ART)) throw new Error(`Art folder not found: ${ART}`);
  fs.rmSync(OUT_ART, { recursive: true, force: true });
  fs.rmSync(OUT_MAPS, { recursive: true, force: true });
  fs.mkdirSync(OUT_MAPS, { recursive: true });

  const bdata = readJson(path.join(ART, BUILDINGS_DATA));
  const buildings = new Map(bdata.buildings.map((b) => [b.id, b]));

  const files = [
    ...AREA_MAPS.map((f) => ({ file: path.join(ART, f), kind: 'area' })),
    ...fs
      .readdirSync(path.join(ART, INTERIOR_DIR))
      .filter((f) => f.endsWith('.tmj'))
      .sort()
      .map((f) => ({ file: path.join(ART, INTERIOR_DIR, f), kind: 'interior' })),
  ];

  const manifest = { generated: new Date().toISOString().slice(0, 10), source: 'art/ (shared project folder)', maps: [] };
  for (const { file, kind } of files) {
    const baked = bakeMap(file, kind, buildings);
    fs.writeFileSync(path.join(OUT_MAPS, `${baked.id}.json`), JSON.stringify(baked));
    manifest.maps.push({ id: baked.id, title: baked.title, kind });
    console.log(`baked ${baked.id} (${baked.width}x${baked.height}, ${baked.sprites.length} sprites, ${baked.objects.length} objects)`);
  }
  manifest.characters = copyCharacters();
  manifest.vehicles = copyVehicles();
  copyPaletteDirs();
  fs.writeFileSync(path.join(ROOT, 'public/assets/manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`copied ${copied.size} images`);
}

main();
