import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BIKE_SLOTS, checkModel, glbInfo, MODEL_DIR, MODEL_INDEX, modelDef, modelId, modelRole, RACE_BIKE, RACE_BIKE_YOUTH, RACE_RIDER, RIDER_SLOTS, materialSlot, type ModelEntry } from '../core/modModels';
import type { SceneryDef } from '../core/trackParts';
import { U } from './paddock';

// The models in public/mods/models/ (core/modModels.ts has the rules), loaded once when the game
// starts and handed to the race view as copies. A model that fails its checks is listed on the
// models page with why, and the game draws the built-in look instead; it never stops the game.

export interface LoadedModel extends ModelEntry {
  /** The model in metres, Y up, as Blender exported it; null when it can't be used. */
  object: THREE.Group | null;
}

const models = new Map<string, LoadedModel>();

/** Every file in the models folder, used or not, for the models page. */
export function modelList(): LoadedModel[] {
  return [...models.values()];
}

/** The model to draw for this id, in grid units (as the race view builds in), or null to draw the built-in one. */
export function modModel(id: string): THREE.Group | null {
  const m = models.get(id);
  if (!m?.object) return null;
  const g = new THREE.Group();
  const copy = m.object.clone(true);
  // Its own materials, so fading one in front of a rider (RaceView.fadeBlockers) leaves the rest.
  copy.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((x) => x.clone()) : mesh.material.clone();
  });
  copy.scale.multiplyScalar(U);
  g.add(copy);
  return g;
}

/** The race bike to draw for a class: the youth model for youth classes when there is one. */
export function bikeModel(youth: boolean): THREE.Group | null {
  return (youth ? modModel(RACE_BIKE_YOUTH) : null) ?? modModel(RACE_BIKE);
}

export function riderModel(): THREE.Group | null {
  return modModel(RACE_RIDER);
}

/**
 * Gives a race bike or rider model its rider's colours: each material named after a slot (Plastics,
 * Frame, Plate on a bike; Helmet, Visor, Jersey, Pants, Boots, Gloves on a rider) is copied and
 * painted, so one model serves every brand and every set of gear.
 */
export function paintModel(g: THREE.Object3D, colours: Record<string, number>, slots: readonly string[]): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const paint = (mat: THREE.Material) => {
      const slot = materialSlot(mat.name, slots);
      if (!slot || colours[slot] === undefined) return mat;
      const copy = mat.clone() as THREE.MeshStandardMaterial;
      copy.color?.setHex(colours[slot]);
      return copy;
    };
    m.material = Array.isArray(m.material) ? m.material.map(paint) : paint(m.material);
  });
}

export const BIKE_PAINT = BIKE_SLOTS;
export const RIDER_PAINT = RIDER_SLOTS;

/**
 * Loads the models folder's files: every one is read and checked, and the good ones parsed. The
 * new items they make are returned, to add to the scenery list before mod tracks are read.
 */
export async function loadModModels(base: string, scenery: SceneryDef[]): Promise<SceneryDef[]> {
  models.clear();
  let entries: ModelEntry[] = [];
  try {
    const res = await fetch(`${base}${MODEL_INDEX}`, { cache: 'no-cache' });
    const list = res.ok ? ((await res.json()) as unknown) : [];
    entries = Array.isArray(list) ? (list as ModelEntry[]).filter((e) => e && typeof e.file === 'string' && !e.file.includes('/')) : [];
  } catch {
    return [];
  }
  const loader = new GLTFLoader();
  const added: SceneryDef[] = [];
  await Promise.all(
    entries.map(async (e) => {
      const id = modelId(e.file);
      let bytes: Uint8Array | null = null;
      let error: string | undefined;
      try {
        const r = await fetch(`${base}${MODEL_DIR}${encodeURIComponent(e.file)}`, { cache: 'no-cache' });
        if (r.ok) bytes = new Uint8Array(await r.arrayBuffer());
        else error = `The file couldn't be read (${r.status}).`;
      } catch {
        error = "The file couldn't be read.";
      }
      const info = bytes ? glbInfo(bytes) : null;
      const problems = checkModel(e.file, bytes?.length ?? 0, info, scenery, error);
      let object: THREE.Group | null = null;
      if (bytes && !problems.length) {
        try {
          const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
          object = gltf.scene;
          object.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
            }
          });
        } catch (err) {
          problems.push(`three.js couldn't read it: ${(err as Error).message}`);
        }
      }
      const role = modelRole(id, scenery);
      models.set(id, { ...e, id, role, info, bytes: bytes?.length ?? 0, problems, object });
      if (object && info && role === 'new') added.push(modelDef(id, info, U));
    }),
  );
  for (const m of models.values()) if (m.problems.length) console.warn(`mods/models/${m.file}: ${m.problems.join(' ')}`);
  return added.sort((a, b) => a.id.localeCompare(b.id));
}
