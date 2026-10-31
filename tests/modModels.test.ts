import { describe, expect, it } from 'vitest';
import { CHEER_ITEM } from '../src/core/cheer';
import { FLAGGER_ITEM, PIT_CREW_ITEM } from '../src/core/finishCrew';
import { MARSHAL_ITEM } from '../src/core/marshal';
import {
  BIKE_LIMITS,
  checkModel,
  glbInfo,
  GRID_PER_METRE,
  LOCKED_ITEMS,
  MAX_FILE_BYTES,
  MODEL_COLOUR,
  materialSlot,
  modelDef,
  modelEntry,
  modelId,
  modelName,
  modelRole,
  RIDER_SLOTS,
  BIKE_SLOTS,
  SCENERY_LIMITS,
  type ModelInfo,
} from '../src/core/modModels';
import { OFFICIAL_ITEM } from '../src/core/startOfficial';
import { SPANS_TRACK, SPRINT_START_ITEM } from '../src/core/trackClearance';
import { BIKE_LENGTH } from '../src/core/trackSurface';
import { readPublic } from './helpers';

// Your own Blender models in public/mods/models (Boss, 31 Oct 2026): reading a .glb's size without
// three.js, and the rules for each kind of model, which the models page and the one-pager list.

type Node = { mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] };

/** A .glb with one box mesh (the given min and max, 12 triangles) under the given nodes. */
function glb(nodes: Node[], box: { min: number[]; max: number[] } = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, opts: { tris?: number; roots?: number[]; textures?: number } = {}): Uint8Array {
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: opts.roots ?? [0] }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { count: 8, componentType: 5126, type: 'VEC3', min: box.min, max: box.max },
      { count: (opts.tris ?? 12) * 3, componentType: 5123, type: 'SCALAR' },
    ],
    ...(opts.textures ? { textures: new Array(opts.textures).fill({ source: 0 }) } : {}),
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(12 + 8 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); // glTF
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, body.length, true);
  v.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(body, 20);
  return out;
}

const info = (min: number[], max: number[], tris = 12): ModelInfo => ({ min: min as ModelInfo['min'], max: max as ModelInfo['max'], tris, meshes: 1, textures: 0 });
const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 5));

describe('reading a .glb', () => {
  it('reads the box round its mesh and counts the triangles', () => {
    const i = glbInfo(glb([{ mesh: 0 }]))!;
    close(i.min, [-0.5, 0, -0.5]);
    close(i.max, [0.5, 1, 0.5]);
    expect(i.tris).toBe(12);
    expect(i.meshes).toBe(1);
  });

  it('moves, scales and turns the mesh with its nodes, parents first', () => {
    // Parent moved up 2 and scaled 2; child turned 90° about Y (x becomes -z) and moved 1 along x.
    const s = Math.SQRT1_2;
    const i = glbInfo(glb([{ children: [1], translation: [0, 2, 0], scale: [2, 2, 2] }, { mesh: 0, translation: [1, 0, 0], rotation: [0, s, 0, s] }], { min: [0, 0, 0], max: [3, 1, 1] }))!;
    // Child: box x 0..3 turned → z -3..0, z 0..1 → x 0..1, then +1 x: x 1..2; parent ×2 and +2 y.
    close(i.min, [2, 2, -6]);
    close(i.max, [4, 4, 0]);
  });

  it('takes a node matrix as glTF stores it, column by column', () => {
    const i = glbInfo(glb([{ mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, -2, 1] }]))!;
    close(i.min, [4.5, 0, -2.5]);
    close(i.max, [5.5, 1, -1.5]);
  });

  it('counts each time a mesh is used, and its textures', () => {
    const i = glbInfo(glb([{ children: [1, 2] }, { mesh: 0 }, { mesh: 0, translation: [3, 0, 0] }], undefined, { textures: 2 }))!;
    expect(i.meshes).toBe(2);
    expect(i.tris).toBe(24);
    expect(i.textures).toBe(2);
    close(i.max, [3.5, 1, 0.5]);
  });

  it("isn't fooled by a file that isn't a .glb", () => {
    expect(glbInfo(new TextEncoder().encode('{"asset":{"version":"2.0"}}'))).toBeNull();
    expect(glbInfo(new Uint8Array(4))).toBeNull();
  });
});

describe('what a model does', () => {
  const scenery = [{ id: 'hay_bale' }, { id: 'tree' }, { id: 'marshal' }];

  it('takes its id from the file name', () => {
    expect(modelId('hay_bale.glb')).toBe('hay_bale');
    expect(modelName('round_hay-bale')).toBe('Round hay bale');
  });

  it('replaces an item with the same name, the race bikes and rider, or is a new item', () => {
    expect(modelRole('hay_bale', scenery)).toBe('replace');
    expect(modelRole('race_bike', scenery)).toBe('bike');
    expect(modelRole('race_bike_youth', scenery)).toBe('bike');
    expect(modelRole('race_rider', scenery)).toBe('rider');
    expect(modelRole('round_bale', scenery)).toBe('new');
  });

  it('locks the items that move or stretch to fit the track', () => {
    for (const id of [OFFICIAL_ITEM, CHEER_ITEM, MARSHAL_ITEM, FLAGGER_ITEM, PIT_CREW_ITEM, SPRINT_START_ITEM, 'start_gate', ...SPANS_TRACK]) expect(LOCKED_ITEMS.has(id)).toBe(true);
    expect(checkModel('marshal.glb', 100, info([-0.5, 0, -0.5], [0.5, 1.8, 0.5]), scenery).join(' ')).toMatch(/can't be swapped/);
  });

  it('uses grid units a metre the same as the race view', () => {
    expect(GRID_PER_METRE).toBeCloseTo(BIKE_LENGTH / 1.46, 9);
  });

  it('makes a new item its footprint in grid units, in the model colour', () => {
    const def = modelDef('round_bale', info([-1, 0, -0.5], [1, 1.2, 0.5]), GRID_PER_METRE);
    expect(def).toEqual({ id: 'round_bale', name: 'Round bale', w: Math.round(2 * GRID_PER_METRE * 10) / 10, h: Math.round(GRID_PER_METRE * 10) / 10, color: MODEL_COLOUR, model: true });
    // Never smaller than a fifth of a grid unit, so it can still be picked in the editor.
    expect(modelDef('pin', info([0, 0, 0], [0.01, 0.5, 0.01]), GRID_PER_METRE).w).toBe(0.2);
  });

  it('reads a paint slot from a Blender material name', () => {
    expect(materialSlot('Plastics', BIKE_SLOTS)).toBe('plastics');
    expect(materialSlot('Plate.001', BIKE_SLOTS)).toBe('plate');
    expect(materialSlot('Jersey', RIDER_SLOTS)).toBe('jersey');
    expect(materialSlot('Chrome', BIKE_SLOTS)).toBeNull();
    expect(materialSlot(undefined, RIDER_SLOTS)).toBeNull();
  });
});

describe('the rules for each kind of model', () => {
  const scenery = [{ id: 'hay_bale' }];
  const ok = (file: string, i: ModelInfo, bytes = 1000) => checkModel(file, bytes, i, scenery);

  it('passes a good scenery model', () => {
    expect(ok('hay_bale.glb', info([-1.3, 0, -0.8], [1.3, 0.8, 0.8]))).toEqual([]);
    expect(ok('round_bale.glb', info([-1, -0.02, -1], [1, 1.5, 1]))).toEqual([]);
  });

  it('wants a lower-case file name ending .glb', () => {
    for (const bad of ['Hay Bale.glb', 'hay bale.glb', 'HAY.glb', '_x.glb', 'hay.gltf']) expect(ok(bad, info([-1, 0, -1], [1, 1, 1])).join(' ')).toMatch(/file name/);
  });

  it('turns away a file too big, unreadable or empty', () => {
    expect(ok('a.glb', info([-1, 0, -1], [1, 1, 1]), MAX_FILE_BYTES + 1).join(' ')).toMatch(/MB/);
    expect(checkModel('a.glb', 10, null, scenery).join(' ')).toMatch(/glTF Binary/);
    expect(ok('a.glb', { ...info([0, 0, 0], [0, 0, 0]), meshes: 0, tris: 0 }).join(' ')).toMatch(/no meshes/);
  });

  it('limits triangles and size for scenery', () => {
    expect(ok('a.glb', info([-1, 0, -1], [1, 1, 1], SCENERY_LIMITS.tris + 1)).join(' ')).toMatch(/triangles/);
    expect(ok('a.glb', info([-16, 0, -1], [16, 1, 1])).join(' ')).toMatch(/long/);
    expect(ok('a.glb', info([-1, 0, -1], [1, SCENERY_LIMITS.tall + 1, 1])).join(' ')).toMatch(/tall/);
  });

  it('wants scenery standing on the ground', () => {
    expect(ok('a.glb', info([-1, 0.5, -1], [1, 1, 1])).join(' ')).toMatch(/lowest point/);
    expect(ok('a.glb', info([-1, -0.5, -1], [1, 1, 1])).join(' ')).toMatch(/lowest point/);
  });

  it('wants a race bike in metres, pointing along +X, under its triangle limit', () => {
    expect(ok('race_bike.glb', info([-1.08, 0, -0.38], [1.1, 1.28, 0.38], 4900))).toEqual([]);
    // Pointing along Z instead: too short along X.
    expect(ok('race_bike.glb', info([-0.38, 0, -1.08], [0.38, 1.28, 1.1])).join(' ')).toMatch(/points along \+X/);
    // Left in centimetres.
    expect(ok('race_bike_youth.glb', info([-108, 0, -38], [110, 128, 38])).join(' ')).toMatch(/metres/);
    expect(ok('race_bike.glb', info([-1.08, 0, -0.38], [1.1, 1.28, 0.38], BIKE_LIMITS.tris + 1)).join(' ')).toMatch(/triangles/);
  });

  it('lets a rider sit on the pegs, off the ground', () => {
    expect(ok('race_rider.glb', info([-0.3, 0.25, -0.47], [0.5, 1.87, 0.47], 2608))).toEqual([]);
    expect(ok('race_rider.glb', info([-0.3, 1, -0.47], [0.5, 1.9, 0.47])).join(' ')).toMatch(/pegs/);
  });

  it('lists a folder file with its problems, and a usable new one with its item', () => {
    const good = modelEntry('round_bale.glb', glb([{ mesh: 0 }], { min: [-1, 0, -0.5], max: [1, 1.2, 0.5] }), scenery);
    expect(good.problems).toEqual([]);
    expect(good.def?.id).toBe('round_bale');
    const swap = modelEntry('hay_bale.glb', glb([{ mesh: 0 }]), scenery);
    expect(swap.role).toBe('replace');
    expect(swap.def).toBeUndefined();
    const bad = modelEntry('Round Bale.glb', glb([{ mesh: 0 }]), scenery);
    expect(bad.problems.length).toBeGreaterThan(0);
    expect(bad.def).toBeUndefined();
  });

  it("knows every one of the game's locked items", () => {
    const ids = new Set(readPublic<{ scenery: { id: string }[] }>('data/trackParts.json').scenery.map((s) => s.id));
    for (const id of LOCKED_ITEMS) expect(ids.has(id)).toBe(true);
  });
});
