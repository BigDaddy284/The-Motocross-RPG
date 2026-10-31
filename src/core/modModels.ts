import type { SceneryDef } from './trackParts';

// Your own 3D models for the race view (Boss, 31 Oct 2026). Drop a .glb file (Blender's File >
// Export > glTF 2.0, the binary .glb kind) into public/mods/models/ and the race view and the
// track editor use it:
//
// - named after a scenery item (hauler.glb, tuff_block.glb, ...), it replaces how that item looks
//   everywhere, on every track;
// - named anything else (my_tower.glb), it is a new scenery item in the track editor's palette,
//   its footprint the model's size;
// - race_bike.glb, race_bike_youth.glb and race_rider.glb replace the bikes and riders on track.
//
// The models page (the game's address with ?models, or Models in the toolkit) lists them with any
// problems, previews them, and exports any built-in item as a .glb to start from in Blender.
//
// Models are built in metres, the way paddock.ts builds its vehicles: 1 m in Blender is 1 m in the
// game. A scenery model stands on the ground at Z = 0, centred on the origin, its length along X
// and its depth along Y, the side seen in Blender's Front view (looking along +Y) facing the
// track. A race bike points along +X with its wheels on the ground and the middle of its
// wheelbase at the origin; the rider sits on it in the same frame.
//
// This file is the rules (the names, the sizes, the limits) and reads a .glb's size without
// three.js, so the dev server's index of the folder (vite.config.ts) and the game agree.

/** The models folder, under the game's base path. */
export const MODEL_DIR = 'mods/models/';
/** The folder's index: the dev server and the build write it (vite.config.ts), as for mod tracks. */
export const MODEL_INDEX = `${MODEL_DIR}index.json`;

/** The race bike for every class, unless race_bike_youth.glb gives the youth classes their own. */
export const RACE_BIKE = 'race_bike';
/** The race bike for the youth classes (50 to 85 cc). */
export const RACE_BIKE_YOUTH = 'race_bike_youth';
/** The rider on the race bikes. */
export const RACE_RIDER = 'race_rider';

/**
 * Scenery whose look the race view moves or sizes as it goes, so a still model can't stand in for
 * it: the start official, cheering fans, marshals, the flag man and pit crews (all animated), and
 * the start gate, finish arch and sprint start (stretched to the track's width).
 */
export const LOCKED_ITEMS: ReadonlySet<string> = new Set(['start_official', 'cheer', 'marshal', 'flagger', 'pit_crew', 'start_gate', 'finish_arch', 'sprint_start']);

/** The limits each kind of model is checked against. Sizes in metres. */
export interface ModelLimits {
  /** Triangles at most. */
  tris: number;
  /** Longest side (X or Y in Blender), and height, at most. */
  long: number;
  tall: number;
  /** For a race bike: its length bumper to bumper (X), at least and at most. */
  minLength?: number;
  maxLength?: number;
}

/** Scenery: a factory hauler is about 21 m long; a TV tower about 12 m tall. */
export const SCENERY_LIMITS: ModelLimits = { tris: 20000, long: 30, tall: 16 };
/** On-track bikes and riders: up to 32 on track at once, so they are kept light. */
export const BIKE_LIMITS: ModelLimits = { tris: 6000, long: 2.6, tall: 1.6, minLength: 1.4, maxLength: 2.6 };
export const RIDER_LIMITS: ModelLimits = { tris: 6000, long: 2.4, tall: 2.0 };
/** A model file's size at most, in bytes. */
/** The highest a rider model's lowest point (its boots on the pegs) can be, in metres. */
export const RIDER_FEET = 0.6;
/** Grid units a metre: world/paddock.ts U (trackSurface BIKE_LENGTH 1.1 over a 1.46 m bike), here so vite.config.ts can use it. */
export const GRID_PER_METRE = 1.1 / 1.46;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** The colour used for a new item in the editor's 2D view and palette. */
export const MODEL_COLOUR = '#9aa3ad';

/** A file name the folder accepts: lower-case letters, digits, - and _, then .glb. */
export const MODEL_FILE = /^[a-z0-9][a-z0-9_-]{0,47}\.glb$/;

/**
 * Material names on a race bike or rider model that take that rider's colours, so every rider's
 * bike is still in their brand and their gear (raceBike.ts BikeColours). Matched ignoring case,
 * and Blender's ".001" endings.
 */
export const BIKE_SLOTS = ['plastics', 'frame', 'plate'] as const;
export const RIDER_SLOTS = ['helmet', 'visor', 'jersey', 'pants', 'boots', 'gloves'] as const;

/** What a .glb holds, read from its JSON chunk: its size (in its own units, metres from Blender) and how heavy it is. */
export interface ModelInfo {
  /** Bounding box in glTF axes (Y up): min and max X, Y, Z. */
  min: [number, number, number];
  max: [number, number, number];
  tris: number;
  meshes: number;
  textures: number;
}

/** One file in the models folder, as the index lists it. */
export interface ModelEntry {
  file: string;
  id: string;
  /** What the file does: replaces a scenery item, is a new one, or replaces the race bikes or riders. */
  role: ModelRole;
  info: ModelInfo | null;
  bytes: number;
  /** Problems that stop the game using it; an empty list means it is used. */
  problems: string[];
  /** A usable new model's scenery item, for the track editor's palette (modelDef). */
  def?: SceneryDef;
}

export type ModelRole = 'replace' | 'new' | 'bike' | 'rider';

/** The id a file stands for: its name without .glb. */
export function modelId(file: string): string {
  return file.replace(/\.glb$/i, '');
}

/** A new item's name in the palette, from its file: my_tower → My tower. */
export function modelName(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a model named `id` does, given the scenery the game has. */
export function modelRole(id: string, scenery: { id: string }[]): ModelRole {
  if (id === RACE_BIKE || id === RACE_BIKE_YOUTH) return 'bike';
  if (id === RACE_RIDER) return 'rider';
  return scenery.some((s) => s.id === id) ? 'replace' : 'new';
}

/** The limits for a model of this role. */
export function limitsFor(role: ModelRole): ModelLimits {
  return role === 'bike' ? BIKE_LIMITS : role === 'rider' ? RIDER_LIMITS : SCENERY_LIMITS;
}

/** The size of a model's box in metres: length (X), depth (glTF Z, Blender Y) and height (Y). */
export function modelSize(info: ModelInfo): { length: number; depth: number; height: number } {
  return { length: info.max[0] - info.min[0], depth: info.max[2] - info.min[2], height: info.max[1] - info.min[1] };
}

/** Everything wrong with a model file, in words for the models page; empty when the game can use it. */
export function checkModel(file: string, bytes: number, info: ModelInfo | null, scenery: { id: string }[], error?: string): string[] {
  const out: string[] = [];
  if (!MODEL_FILE.test(file)) out.push('The file name must be lower-case letters, digits, - and _, ending .glb (no spaces or capitals).');
  if (bytes > MAX_FILE_BYTES) out.push(`The file is ${(bytes / 1048576).toFixed(1)} MB; the most is ${MAX_FILE_BYTES / 1048576} MB. Use smaller textures or fewer triangles.`);
  if (error || !info) {
    out.push(error ?? "This isn't a .glb file the game can read. Export it from Blender with File > Export > glTF 2.0, Format: glTF Binary (.glb).");
    return out;
  }
  const id = modelId(file);
  const role = modelRole(id, scenery);
  if (role === 'replace' && LOCKED_ITEMS.has(id)) out.push(`The ${id} item moves or stretches to fit the track in the race, so it can't be swapped for a model.`);
  const lim = limitsFor(role);
  const { length, depth, height } = modelSize(info);
  const m = (v: number) => `${v.toFixed(2)} m`;
  if (!info.meshes || !info.tris) out.push('The file has no meshes in it.');
  if (info.tris > lim.tris) out.push(`It has ${info.tris} triangles; the most for this kind of model is ${lim.tris}. Use Decimate in Blender, or simpler shapes.`);
  if (Math.max(length, depth) > lim.long) out.push(`It is ${m(Math.max(length, depth))} long; the most is ${m(lim.long)}. Models are in metres: check the scale in Blender (1 unit = 1 m).`);
  if (height > lim.tall) out.push(`It is ${m(height)} tall; the most is ${m(lim.tall)}.`);
  if (lim.minLength !== undefined && length < lim.minLength) out.push(`It is ${m(length)} long, front to back along X; a race bike is ${m(lim.minLength)} to ${m(lim.maxLength!)}. Check it points along +X and is in metres.`);
  // A rider sits on the bike, feet on the pegs, in the same place as the exported race_rider.glb.
  if (role === 'rider') {
    if (info.min[1] < -0.05 || info.min[1] > RIDER_FEET) out.push(`Its lowest point is ${m(info.min[1])} from the ground; a rider's boots rest on the pegs, 0 to ${m(RIDER_FEET)} up. Start from the exported race_rider.glb so it sits on the bike.`);
  } else if (info.min[1] < -0.05 || info.min[1] > 0.05) out.push(`Its lowest point is ${m(info.min[1])} from the ground; it should sit on the ground (Z = 0 in Blender).`);
  return out;
}

/** The scenery item a new model makes, its footprint its size, in grid units (`unit` grid units a metre). */
export function modelDef(id: string, info: ModelInfo, unit: number): SceneryDef {
  const { length, depth } = modelSize(info);
  const r = (v: number) => Math.max(0.2, Math.round(v * unit * 10) / 10);
  return { id, name: modelName(id), w: r(length), h: r(depth), color: MODEL_COLOUR, model: true };
}

/** Reads a material's slot on a race bike or rider model: "Plastics.001" → plastics. */
export function materialSlot(name: string | undefined, slots: readonly string[]): string | null {
  const n = (name ?? '').toLowerCase().replace(/\.\d+$/, '').trim();
  return slots.includes(n) ? n : null;
}

// ---- reading a .glb's JSON ----

type Vec3 = [number, number, number];
type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4x4 multiply, as glTF stores matrices. */
function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function trs(t: Vec3 = [0, 0, 0], q: [number, number, number, number] = [0, 0, 0, 1], s: Vec3 = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q;
  const [sx, sy, sz] = s;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

function apply(m: Mat4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { children?: number[]; mesh?: number; matrix?: number[]; translation?: Vec3; rotation?: [number, number, number, number]; scale?: Vec3 }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { count: number; min?: number[]; max?: number[] }[];
  textures?: unknown[];
}

/**
 * The size and weight of a .glb, read from its JSON chunk (no three.js): the box round every mesh
 * in the scene, with each node's move, turn and scale, from the position accessors' min and max
 * (which glTF requires). Null when it isn't a .glb.
 */
export function glbInfo(bytes: Uint8Array): ModelInfo | null {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return null;
  const len = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + len > bytes.length) return null;
  let json: Gltf;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as Gltf;
  } catch {
    return null;
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  let meshes = 0;
  const visit = (n: number, parent: Mat4, depth: number) => {
    const node = json.nodes?.[n];
    if (!node || depth > 64) return;
    const m = mul(parent, node.matrix?.length === 16 ? node.matrix : trs(node.translation, node.rotation, node.scale));
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : undefined;
    if (mesh) {
      meshes++;
      for (const p of mesh.primitives ?? []) {
        const pos = json.accessors?.[p.attributes?.POSITION];
        if (!pos?.min || !pos.max) continue;
        if ((p.mode ?? 4) === 4) tris += Math.floor((p.indices !== undefined ? json.accessors?.[p.indices]?.count ?? 0 : pos.count) / 3);
        for (const x of [pos.min[0], pos.max[0]]) for (const y of [pos.min[1], pos.max[1]]) for (const z of [pos.min[2], pos.max[2]]) {
          const w = apply(m, [x, y, z]);
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], w[i]);
            max[i] = Math.max(max[i], w[i]);
          }
        }
      }
    }
    for (const c of node.children ?? []) visit(c, m, depth + 1);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
  for (const r of roots) visit(r, IDENTITY, 0);
  if (!meshes || min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0], tris, meshes, textures: json.textures?.length ?? 0 };
  return { min, max, tris, meshes, textures: json.textures?.length ?? 0 };
}

/** The index entry for one file in the folder (vite.config.ts writes the list; the game and the track editor read it). */
export function modelEntry(file: string, bytes: Uint8Array, scenery: { id: string }[]): ModelEntry {
  const info = glbInfo(bytes);
  const id = modelId(file);
  const role = modelRole(id, scenery);
  const problems = checkModel(file, bytes.length, info, scenery);
  // The track editor's palette item for a new model it can't measure itself.
  const def = role === 'new' && info && !problems.length ? modelDef(id, info, GRID_PER_METRE) : undefined;
  return { file, id, role, info, bytes: bytes.length, problems, ...(def ? { def } : {}) };
}
