import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { BIKE_LENGTH } from '../core/trackSurface';
import { U } from './paddock';
import { BRAND_COLOURS, GEAR_SETS, raceBikeParts, type BrandColours, type Gear } from './raceBike';

// The models page's export (scenes/ModelsScene.ts): the game's own objects as .glb files Blender
// opens, in metres, Y up, standing on the ground, so they can be changed and put back in the
// models folder (Boss, 31 Oct 2026). The race bike and rider come with their paint slots as named
// materials (Plastics, Frame, Plate; Helmet, Visor, Jersey, Pants, Boots, Gloves), which the game
// recolours for every brand and set of gear.

/** Stand-in colours for each paint slot, so the parts each slot paints can be found and named. */
const SLOT_KEYS: Record<string, number> = {
  Plastics: 0x010203,
  Frame: 0x010204,
  Plate: 0x010205,
  Helmet: 0x010206,
  Visor: 0x010207,
  Jersey: 0x010208,
  Pants: 0x010209,
  Boots: 0x01020a,
  Gloves: 0x01020b,
};

/**
 * The race bike (youth or adult) and its rider, built the way the race view builds them for a rider
 * with a look, each part's material named after its paint slot and coloured as the player's starter
 * kit on a Hondmoto. In grid units, the bike pointing along +x with its wheels on the ground.
 */
export function raceModels(youth: boolean): { bike: THREE.Group; rider: THREE.Group } {
  const real = BRAND_COLOURS.hondmoto;
  const kit = GEAR_SETS['player-default'];
  const colours: BrandColours = { ...real, body: SLOT_KEYS.Plastics, frame: SLOT_KEYS.Frame, plate: SLOT_KEYS.Plate };
  const gear: Gear = { ...kit, helmet: SLOT_KEYS.Helmet, visor: SLOT_KEYS.Visor, jersey: SLOT_KEYS.Jersey, pants: SLOT_KEYS.Pants, boot: SLOT_KEYS.Boots, glove: SLOT_KEYS.Gloves };
  const look = { brand: 'hondmoto', cls: youth ? '65cc' : '250cc', gear };
  const realOf: Record<string, number> = { Plastics: real.body, Frame: real.frame, Plate: real.plate, Helmet: kit.helmet, Visor: kit.visor, Jersey: kit.jersey, Pants: kit.pants, Boots: kit.boot, Gloves: kit.glove };
  const all = raceBikeParts(look, BIKE_LENGTH, { colours });
  const bikeOnly = raceBikeParts(look, BIKE_LENGTH, { rider: false, colours }).length;
  const named = new Map<THREE.Material, THREE.Material>();
  const group = (meshes: THREE.Mesh[]) => {
    const g = new THREE.Group();
    for (const m of meshes) {
      const mat = m.material as THREE.MeshLambertMaterial;
      let out = named.get(mat);
      if (!out) {
        const slot = Object.keys(SLOT_KEYS).find((k) => SLOT_KEYS[k] === mat.color.getHex());
        out = new THREE.MeshStandardMaterial({ color: slot ? realOf[slot] : mat.color.getHex(), roughness: 0.7, name: slot ?? `Trim_${mat.color.getHexString()}` });
        named.set(mat, out);
      }
      m.material = out;
      g.add(m);
    }
    return g;
  };
  return { bike: group(all.slice(0, bikeOnly)), rider: group(all.slice(bikeOnly)) };
}

/** Makes a .glb of an object built in grid units: scaled to metres, colours kept, ready for Blender. */
export async function glbOf(obj: THREE.Object3D): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  const copy = obj.clone(true);
  // Plain (Lambert) materials as standard ones, which glTF has; one copy per material shared between parts.
  const done = new Map<THREE.Material, THREE.Material>();
  const conv = (m: THREE.Material) => {
    let out = done.get(m);
    if (!out) {
      const src = m as THREE.MeshLambertMaterial;
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) out = m.clone();
      else out = new THREE.MeshStandardMaterial({ name: m.name, color: src.color ?? 0xffffff, map: src.map ?? null, vertexColors: src.vertexColors, roughness: 0.8, transparent: false, side: src.side });
      out.transparent = false;
      out.opacity = 1;
      done.set(m, out);
    }
    return out;
  };
  copy.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  root.add(copy);
  root.scale.setScalar(1 / U);
  const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  return out as ArrayBuffer;
}

/** Saves bytes as a file through the browser's download. */
export function download(bytes: ArrayBuffer, file: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
