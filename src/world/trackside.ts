// Trackside scenery built for the race view, the way the paddock vehicles are (paddock.ts): the TV
// crew and media, the pits set up with their teams, what stands over and beside the track (the
// footbridge, marshals, the medics, the track tractor) and the fans at their ease. Each item is
// built in metres in its own frame, centred on its footprint with x along the footprint's length and
// z its depth; the people face +z. Its design (variant), set-up (action) and colour come from
// core/paddock.ts, picked for it unless chosen in the editor, which mirrors the layouts here.
import * as THREE from 'three';
import type { SceneryItem } from '../core/race';
import { MARSHAL_STANDS } from '../core/marshal';
import { paddockColour, paddockSetup, paddockVariant } from '../core/paddock';
import type { SceneryDef } from '../core/trackParts';
import { Build, CANVAS, CHASSIS, DARK, GLASS, hexNum, MAT, rustyVan, shade, SHIRTS, STEEL, TABLE, TYRE, U } from './paddock';

/** A box with words on it, in metres, for the race view to texture: the text faces +z (and -z when `both`). */
export interface Label {
  x: number; y: number; z: number; l: number; h: number; w: number; ry?: number;
  text: string; bg: number; fg?: string; vertical?: boolean; both?: boolean;
}
export interface Built { parts: Build['parts']; labels: Label[] }

/** Items whose people face the track when the item is not turned by hand. */
export const FACES_TRACK = new Set(['tv_camera_op', 'tv_tripod', 'tv_van', 'tv_tower', 'photographer', 'commentary_box', 'camp_chairs', 'fan_photo', 'fan_parasol', 'fans_fence', 'camera_crane', 'drone_pilot', 'vip_stand']);
/** Items whose length is set by their width (like a banner's), so they can run as far as wanted. */
export const STRETCH = new Set(['foot_bridge', 'crowd_barrier', 'cones', 'fans_fence', 'timing_beam', 'vip_stand', 'pyro', 'truss_arch']);

const HIVIS = 0xf0a020;
const BLACK = 0x202428;
const WHITE = 0xf0f0f0;
const CAMERA = 0x2a2a30;
const WOOD = 0x9a7a4a;
const BIKES = [0xc21c15, 0x3b86da, 0xa0c33e, 0xecbe2a, 0xef6c18];
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

interface Ctx { b: Build; col: number; setup: string | undefined; variant: string | undefined; L: number; D: number; i: number; text: string; labels: Label[] }

/** A broadcast camera: the body with its lens pointing +z and a viewfinder, bottom at y. */
function camera(b: Build, x: number, y: number, z: number, big = false): void {
  const s = big ? 1.5 : 1;
  b.box(x, y, z, 0.28 * s, 0.26 * s, 0.5 * s, CAMERA);
  b.cyl(x, y + 0.04 * s, z + 0.4 * s, 0.09 * s, 0.3 * s, BLACK, 10).rotation.x = Math.PI / 2;
  b.box(x - 0.2 * s, y + 0.1 * s, z - 0.15 * s, 0.14 * s, 0.1 * s, 0.14 * s, BLACK);
}

/** A tripod of three legs meeting under a head at height h. */
function tripod(b: Build, x: number, z: number, h: number, spread = 0.6): void {
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const lx = Math.cos(a) * spread;
    const lz = Math.sin(a) * spread;
    const len = Math.hypot(spread, h);
    const m = b.box(x + lx / 2, 0, z + lz / 2, 0.05, len, 0.05, STEEL);
    m.position.y = (h / 2) * U;
    m.rotation.set(0, -a, 0);
    m.rotateZ(Math.atan2(spread, h));
  }
  b.box(x, h - 0.08, z, 0.2, 0.08, 0.2, BLACK);
}

/** A folding chair facing +z with its seat at 0.45 m: legs, seat and back, in a colour. */
/**
 * A flight of steps from a platform's edge down to the ground: the top step just under the edge at
 * z, the flight running off it in direction dir (-1 towards -z), w wide, with a stringer each side.
 */
function stairs(b: Build, x: number, z: number, h: number, w: number, dir: -1 | 1, c = STEEL): void {
  const n = Math.max(2, Math.round(h / 0.22));
  const rise = h / n;
  const run = 0.26;
  for (let k = 1; k < n; k++) b.box(x, h - k * rise - 0.04, z + dir * (k - 0.5) * run, w, 0.05, run, c);
  const len = Math.hypot(h, n * run);
  const tilt = Math.atan2(h, n * run);
  for (const sx of [-w / 2, w / 2]) b.box(x + sx, h / 2 - 0.09, z + (dir * n * run) / 2, 0.05, 0.18, len, shade(c, 0.85), 0, dir * tilt);
}

/** A ladder up the outside of a tower to the height h, its rails at x ± 0.25 and its back to z. */
function ladder(b: Build, x: number, z: number, h: number): void {
  for (const sx of [-0.25, 0.25]) b.pole(x + sx, 0, z, h + 1.0, STEEL, 0.05);
  for (let y = 0.3; y < h; y += 0.3) b.box(x, y, z, 0.5, 0.03, 0.03, STEEL);
}

function chair(b: Build, x: number, z: number, c: number): void {
  b.box(x, 0.45, z, 0.5, 0.05, 0.5, c);
  b.box(x, 0.5, z - 0.22, 0.5, 0.5, 0.05, c);
  for (const [sx, sz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) b.pole(x + sx, 0, z + sz, 0.45, STEEL, 0.04);
}

/** A gazebo: four legs, a pitched roof in the colour and a valance round the eaves, over x0..x1 and z0..z1. */
function gazebo(b: Build, x0: number, x1: number, z0: number, z1: number, c: number, hEave = 2.1): void {
  const l = x1 - x0;
  const w = z1 - z0;
  const xc = (x0 + x1) / 2;
  const zc = (z0 + z1) / 2;
  for (const x of [x0 + 0.05, x1 - 0.05]) for (const z of [z0 + 0.05, z1 - 0.05]) b.pole(x, 0, z, hEave, STEEL, 0.07);
  b.box(xc, hEave - 0.3, zc, l + 0.04, 0.3, w + 0.04, shade(c, 0.85));
  // A four-sided cone turned so its corners sit on the tent's: turned and stretched in the geometry, since a mesh scales before it turns.
  const roof = b.cyl(xc, hEave, zc, Math.hypot(l, w) / 2, 0.8, c, 4, 0.05);
  roof.geometry.rotateY(Math.PI / 4).scale(l / Math.hypot(l, w) * Math.SQRT2, 1, w / Math.hypot(l, w) * Math.SQRT2);
}

/** A parasol: a pole and a shallow cone in the colour, h to its tip. */
function parasol(b: Build, x: number, z: number, h: number, r: number, c: number): void {
  b.pole(x, 0, z, h - 0.3, STEEL, 0.05);
  b.cyl(x, h - 0.5, z, r, 0.45, c, 8, 0.02);
}

/** A toolbox-sized chest on wheels, fuel cans and a spare wheel: pit clutter at x, z. */
function clutter(b: Build, x: number, z: number, c: number): void {
  b.box(x - 0.6, 0.1, z, 0.9, 0.9, 0.5, c);
  for (const k of [-1, 0, 1]) b.box(x - 0.6, 0.25 + 0.25 * k + 0.25, z + 0.26, 0.8, 0.03, 0.02, shade(c, 1.3));
  b.box(x + 0.2, 0, z - 0.1, 0.35, 0.45, 0.25, 0xc02020);
  b.box(x + 0.6, 0, z - 0.1, 0.35, 0.45, 0.25, 0x2a4aa0);
  const wheel = b.cyl(x + 0.45, 0, z + 0.35, 0.33, 0.12, TYRE, 14);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.y = 0.33 * U;
}

/**
 * The two officials at an enduro sprint's start (Boss, 29 Oct 2026), standing side by side facing
 * +z: the timekeeper with a stopwatch held up in the right hand, and the scorer with a clipboard
 * held in front, writing each rider's time off. Built standing at (x, z), turned by ry.
 */
export function sprintOfficials(b: Build, x: number, z: number, ry: number, i: number): void {
  b.turned(x, z, ry, () => {
    // The timekeeper: the right arm raised to the face with the watch, the left by their side.
    const n = b.parts.length;
    b.person(x - 0.45, z, 0, i, { shirt: HIVIS, trousers: BLACK, arms: 'down' });
    // Swap the right arm for one bent up to the face, the stopwatch in the hand.
    b.parts.splice(n + b.parts.slice(n).length - 1, 1);
    b.box(x - 0.15, 1.25, z + 0.14, 0.1, 0.1, 0.42, 0xe0b090, 0, -0.9);
    b.cyl(x - 0.15, 1.52, z + 0.32, 0.07, 0.03, BLACK, 12).rotation.x = Math.PI / 2;
    b.cyl(x - 0.15, 1.52, z + 0.34, 0.05, 0.01, WHITE, 12).rotation.x = Math.PI / 2;
    // A cap.
    b.box(x - 0.45, 1.73, z + 0.04, 0.26, 0.08, 0.3, BLACK);
    // The scorer: both arms forward holding the clipboard, a pen in the right hand.
    b.person(x + 0.45, z, 0, i + 1, { shirt: HIVIS, trousers: 0x2a3a5a, arms: 'forward' });
    b.box(x + 0.45, 1.18, z + 0.52, 0.34, 0.03, 0.44, 0x8a6a40, 0, -0.5);
    b.box(x + 0.45, 1.2, z + 0.52, 0.28, 0.03, 0.36, WHITE, 0, -0.5);
    b.box(x + 0.6, 1.26, z + 0.5, 0.02, 0.02, 0.14, BLACK);
  });
}

/**
 * The starter's box on a No-Turn Takedown's start platform (Boss, 30 Oct 2026), between the two
 * pairs of gates: a waist-high booth `w` metres across and deep, its open back at -z, with the
 * starter standing in it facing +z (down the run) and the gate's push-button lever by the front
 * wall. Built in metres at (0, 0, 0), on the platform's deck.
 */
export function starterBox(w: number, i: number): Build['parts'] {
  const b = new Build();
  const h = 1.05;
  const t = 0.06;
  const RED = 0xc8302a;
  b.box(0, 0, 0, w, 0.06, w, 0x5a5a60);
  b.box(0, 0, w / 2 - t / 2, w, h, t, RED);
  for (const sx of [-1, 1]) b.box(sx * (w / 2 - t / 2), 0, 0, t, h, w, RED);
  b.box(0, h, w / 2 - t / 2, w + 0.06, 0.06, t + 0.08, WHITE);
  for (const sx of [-1, 1]) b.box(sx * (w / 2 - t / 2), h, 0, t + 0.08, 0.06, w, WHITE);
  // A canopy on two poles at the back corners.
  for (const sx of [-1, 1]) b.pole(sx * (w / 2 - 0.05), 0, -w / 2 + 0.05, 2.3, STEEL, 0.05);
  b.box(0, 2.3, 0, w + 0.2, 0.06, w + 0.2, RED);
  // The gate lever on its post by the front wall, and the starter behind it.
  b.pole(w * 0.25, 0, w / 2 - 0.2, 0.95, STEEL, 0.06);
  b.box(w * 0.25, 0.95, w / 2 - 0.2, 0.12, 0.08, 0.12, 0xf0c020);
  b.person(-0.05, -0.05, 0, i, { shirt: HIVIS, trousers: BLACK, arms: 'forward' });
  return b.parts;
}

const builders: Record<string, (c: Ctx) => void> = {
  sprint_start({ b, col, L, i, text, labels }) {
    // An enduro sprint's start line: the sponsor arch over the line, the timing beam across the
    // ground under it, and the timekeeper and the scorer at the right-hand post with the clock.
    const dark = shade(col, 0.8);
    const h = 4.4;
    for (const s of [-1, 1]) {
      b.cyl(s * (L / 2 - 0.55), 0, 0, 0.55, h, col, 14);
      b.cyl(s * (L / 2 - 0.55), 0, 0, 0.6, 0.45, dark, 14);
    }
    const beam = b.cyl(0, h, 0, 0.55, L, col, 14);
    beam.rotation.z = Math.PI / 2;
    beam.position.y = h * U;
    labels.push({ x: 0, y: h - 0.45, z: 0, l: L - 2.2, h: 0.9, w: 1.12, text, bg: col, both: true });
    // The timing beam: a cell on a post each side just inside the arch, and the line across.
    for (const s of [-1, 1]) {
      b.pole(s * (L / 2 - 1.4), 0, 0.7, 1.0, 0xf0a020, 0.07);
      b.box(s * (L / 2 - 1.4), 1.0, 0.7, 0.22, 0.18, 0.22, s > 0 ? 0xd02020 : 0x3a3a40);
    }
    b.box(0, 0, 0.7, L - 2.8, 0.03, 0.1, 0xf0f0f0);
    // The clock on its stand beside the right post, facing the riders, and the officials by it.
    b.pole(L / 2 + 0.9, 0, -0.9, 1.5, STEEL, 0.06);
    b.box(L / 2 + 0.9, 1.5, -0.9, 0.9, 0.42, 0.08, BLACK);
    labels.push({ x: L / 2 + 0.9, y: 1.53, z: -0.95, l: 0.84, h: 0.36, w: 0.02, ry: Math.PI, text: '0:10', bg: BLACK, fg: '#ffd040' });
    sprintOfficials(b, L / 2 + 1.25, 0.9, -Math.PI / 2, i);
  },
  boulder({ b, col, L, D, variant, i }) {
    // Rough grey rocks: one big one, two, or a heap of smaller ones, each a lumpy flattened ball.
    const rock = (x: number, z: number, r: number, k: number) => {
      const m = b.cyl(x, 0, z, r, r * 1.3, shade(col, 0.85 + 0.3 * hash(i * 7 + k)), 7, r * 0.55);
      m.rotation.y = hash(i * 3 + k) * Math.PI;
    };
    if (variant === 'one') rock(0, 0, Math.min(L, D) * 0.45, 0);
    else if (variant === 'pair') {
      rock(-L * 0.2, 0, Math.min(L * 0.3, D * 0.45), 0);
      rock(L * 0.25, D * 0.1, Math.min(L * 0.22, D * 0.35), 1);
    } else for (let k = 0; k < 6; k++) rock((hash(i + k * 5) - 0.5) * L * 0.75, (hash(i * 2 + k * 9) - 0.5) * D * 0.6, 0.18 + 0.22 * hash(i + k), k);
  },
  log_pile({ b, col, L, D, variant, i }) {
    const BARK = shade(col, 0.85);
    const END = 0xc8a878;
    const log = (x: number, y: number, z: number, r: number, len: number, ry = 0) => {
      const m = b.cyl(x, y, z, r, len, BARK, 10);
      m.rotation.set(0, ry, Math.PI / 2);
      m.position.y = (y + r) * U;
      // The cut ends, lighter.
      for (const s of [-1, 1]) {
        const e = b.cyl(x + s * Math.cos(ry) * (len / 2 + 0.005), y, z - s * Math.sin(ry) * (len / 2 + 0.005), r * 0.92, 0.02, END, 10);
        e.rotation.set(0, ry, Math.PI / 2);
        e.position.y = (y + r) * U;
      }
    };
    if (variant === 'fallen') {
      log(0, 0, 0, Math.min(0.35, D * 0.3), L * 0.95, 0.08);
      // A broken-off branch.
      b.box(L * 0.2, 0.3, 0.25, 0.8, 0.08, 0.08, BARK, 0.6);
    } else if (variant === 'stumps') {
      for (let k = 0; k < 3; k++) {
        const x = (k - 1) * L * 0.3;
        const r = 0.22 + 0.12 * hash(i + k);
        b.cyl(x, 0, (hash(i * 3 + k) - 0.5) * D * 0.5, r, 0.35 + 0.25 * hash(i * 5 + k), BARK, 9);
        b.cyl(x, 0.6, (hash(i * 3 + k) - 0.5) * D * 0.5, r * 0.9, 0.02, END, 9).position.y = (0.35 + 0.25 * hash(i * 5 + k) + 0.01) * U;
      }
    } else {
      const r = Math.min(0.2, D / 7);
      const rows = [4, 3, 2];
      rows.forEach((n, row) => {
        for (let k = 0; k < n; k++) log(0, row * r * 1.7, (k - (n - 1) / 2) * r * 2.05, r, L * 0.9);
      });
    }
  },
  tv_camera_op({ b, col, variant, i }) {
    const pose = variant === 'kneeling' ? 'kneel' : 'stand';
    b.person(0, -0.1, 0, i, { pose, arms: 'forward', shirt: col, held: [0.5, 0.26, 0.28, CAMERA] });
    b.cyl(0, pose === 'kneel' ? 1.2 : 1.5, 0.45, 0.08, 0.25, BLACK, 10).rotation.x = Math.PI / 2;
  },
  tv_tripod({ b, col, i }) {
    tripod(b, 0, 0.2, 1.5, 0.7);
    camera(b, 0, 1.5, 0.2, true);
    b.person(0, -0.65, 0, i, { arms: 'forward', shirt: col });
  },
  tv_van({ b, col, setup, D, i }) {
    const bz = -(D - 1.8) / 2;
    b.turned(0, bz, 0, () => rustyVan(b, col, undefined, bz, false));
    // The roof platform with its rail, and the crew up there with the camera on a tripod.
    b.box(-0.55, 2.1, bz, 3.2, 0.08, 1.9, STEEL);
    for (const x of [-2.1, 1.0]) b.box(x, 2.18, bz, 0.04, 0.9, 1.9, STEEL);
    for (const s of [-1, 1]) b.box(-0.55, 2.18, bz + s * 0.93, 3.2, 0.9, 0.04, STEEL);
    b.box(-0.55, 3.0, bz, 3.2, 0.04, 1.9, shade(STEEL, 0.9));
    b.box(2.0, 0.3, bz, 0.5, 1.8, 0.4, STEEL);
    if (setup !== 'parked') {
      // The tripod and the operator stand on the roof: built on the ground, then lifted.
      const up = b.parts.length;
      tripod(b, 0.2, bz + 0.3, 1.2, 0.4);
      b.turned(0, 0, 0, () => b.person(0.2, bz - 0.35, 0, i, { arms: 'forward', shirt: BLACK }));
      for (const m of b.parts.slice(up)) m.position.y += 2.18 * U;
      camera(b, 0.2, 3.38, bz + 0.3);
    }
  },
  tv_tower({ b, col, i }) {
    const h = 5.0;
    for (const x of [-1.2, 1.2]) for (const z of [-1.2, 1.2]) b.pole(x, 0, z, h + 0.3, STEEL, 0.1);
    for (const y of [1.2, 2.5, 3.8]) {
      for (const x of [-1.2, 1.2]) b.box(x, y, 0, 0.06, 0.06, 2.4, STEEL);
      for (const z of [-1.2, 1.2]) b.box(0, y, z, 2.4, 0.06, 0.06, STEEL);
    }
    b.box(0, h, 0, 2.7, 0.12, 2.7, WOOD);
    for (const x of [-1.3, 1.3]) b.box(x, h + 0.12, 0, 0.05, 1.0, 2.7, STEEL);
    for (const x of [-0.9, 0.9]) b.box(x, h + 0.12, -1.3, 0.9, 1.0, 0.05, STEEL);
    b.box(0, h + 0.12, 1.3, 2.7, 1.0, 0.05, STEEL);
    for (const x of [-1.25, 1.25]) for (const z of [-1.25, 1.25]) b.pole(x, h + 0.12, z, 2.3, STEEL, 0.06);
    b.box(0, h + 2.4, 0, 3.0, 0.1, 3.0, col);
    // A ladder up the back to the platform, through a gap in the back rail.
    ladder(b, 0, -1.42, h + 0.12);
    // The tripod and the crew stand on the platform: built on the ground, then lifted.
    const up = b.parts.length;
    tripod(b, 0.3, 0.3, 1.3, 0.45);
    b.person(0.3, -0.3, 0, i, { arms: 'forward', shirt: BLACK });
    b.person(-0.8, 0.2, -0.4, i + 1, { shirt: BLACK });
    for (const m of b.parts.slice(up)) m.position.y += (h + 0.12) * U;
    camera(b, 0.3, h + 1.42, 0.3, true);
  },
  photographer({ b, col, variant, i }) {
    const pose = variant === 'lying' ? 'lie' : variant === 'kneeling' ? 'kneel' : 'stand';
    b.person(0, pose === 'lie' ? -0.2 : 0, 0, i, { pose, arms: 'forward', shirt: col, held: [0.18, 0.14, 0.2, CAMERA] });
    const y = pose === 'lie' ? 0.26 : pose === 'kneel' ? 1.17 : 1.47;
    const z = pose === 'lie' ? 0.75 : 0.42;
    b.cyl(0, y, z, 0.05, 0.4, BLACK, 10).rotation.x = Math.PI / 2;
  },
  commentary_box({ b, col, i }) {
    const h = 2.6;
    for (const x of [-1.7, 1.7]) for (const z of [-1.2, 1.2]) b.pole(x, 0, z, h, STEEL, 0.12);
    for (const x of [-1.7, 1.7]) b.box(x, 1.3, 0, 0.06, 0.06, 2.4, STEEL);
    b.box(0, h, 0, 3.8, 0.15, 2.8, DARK);
    b.box(0, h + 0.15, -0.3, 3.8, 2.2, 2.2, col);
    b.box(0, h + 1.05, 0.81, 3.4, 1.0, 0.04, GLASS);
    b.box(0, h + 0.15, 0.81, 3.8, 0.9, 0.04, col);
    b.box(0, h + 2.35, 0, 4.0, 0.1, 3.0, shade(col, 0.8));
    b.box(0, h + 0.9, 0.5, 3.2, 0.06, 0.5, TABLE);
    // The two commentators sit at the desk: built on the ground, then lifted into the box.
    const up = b.parts.length;
    b.person(-0.8, 0.1, 0, i, { pose: 'sit', arms: 'forward', shirt: WHITE });
    b.person(0.8, 0.1, 0, i + 1, { pose: 'sit', arms: 'forward', shirt: 0x2a4a90 });
    for (const m of b.parts.slice(up)) m.position.y += (h + 0.15) * U;
    // Steps up the back to a door in the box.
    stairs(b, 0, -1.4, h, 1.0, -1);
    b.box(0, h + 0.15, -1.42, 0.9, 1.9, 0.04, shade(col, 0.7));
  },
  big_screen({ b, col }) {
    b.box(0, 0.5, -0.4, 5.8, 0.3, 2.0, CHASSIS);
    b.box(3.2, 0.4, -0.4, 1.2, 0.12, 0.3, CHASSIS);
    b.wheels([-1.6, 1.6], -0.4, 0.9, 0.35);
    b.box(0, 0.8, -0.6, 5.6, 3.6, 0.6, col);
    b.box(0, 1.0, -0.28, 5.2, 3.2, 0.06, 0x1a2a50);
    b.box(0, 1.2, -0.24, 2.2, 1.2, 0.02, 0x4a7ad0);
    b.box(-1.6, 2.6, -0.24, 1.4, 0.4, 0.02, 0xe0e0e0);
  },
  pit_setup({ b, col, setup, i, text, labels }) {
    // The tent is open-fronted: the team's name on the front valance, the bikes just inside it and the people out front, where the race camera sees them.
    gazebo(b, -3.0, 3.0, -2.6, 1.0, col, 2.6);
    labels.push({ x: 0, y: 2.2, z: 1.03, l: 6.0, h: 0.4, w: 0.03, text, bg: shade(col, 0.85) });
    b.box(0, 0, -0.8, 6.0, 0.02, 3.6, MAT);
    const bikes = setup === 'bikes' || setup === 'both';
    const people = setup === 'people' || setup === 'both';
    if (bikes) {
      b.bikeOnStand(-1.6, 0.0, BIKES[i % 5], '250cc', -Math.PI / 2);
      b.bikeOnStand(1.6, 0.0, BIKES[(i + 1) % 5], '250cc', -Math.PI / 2);
    }
    if (people) {
      b.person(-1.6, 1.6, Math.PI, i, { shirt: col, arms: bikes ? 'forward' : 'down' });
      b.person(0.3, 1.9, 0.6, i + 1, { shirt: col });
      b.person(2.4, 1.5, Math.PI, i + 2, { shirt: BIKES[(i + 1) % 5] });
    }
    if (setup === 'tools' || setup === 'both') clutter(b, -0.6, -2.0, col);
    if (setup === 'tools') {
      b.box(1.6, 0, -1.8, 0.7, 0.55, 0.5, 0xc02020);
      b.box(1.6, 0.55, -1.8, 0.5, 0.15, 0.3, BLACK);
      b.table(1.8, 0.2);
      b.person(-0.5, 1.7, Math.PI, i + 3, { shirt: col });
    }
  },
  bike_wash({ b, col, i }) {
    b.disc(0, 0.2, 1.1, 0x5a6a70);
    b.bikeOnStand(0, 0, col, '250cc', Math.PI / 2);
    b.box(0.95, 0, -0.5, 0.45, 0.5, 0.35, 0xe8c020);
    b.box(0.95, 0.5, -0.5, 0.12, 0.3, 0.12, BLACK);
    b.box(0.6, 0.02, -0.2, 0.08, 0.04, 0.9, 0x4a4a50);
    b.person(-0.9, 0.9, Math.PI / 2, i, { arms: 'forward', shirt: 0x3a5a3a, held: [0.45, 0.05, 0.05, BLACK] });
  },
  bike_trailer({ b, col, variant }) {
    b.box(-0.3, 0.4, 0, 2.2, 0.1, 1.5, CHASSIS);
    b.box(-0.3, 0.5, 0, 2.2, 0.08, 1.5, col);
    b.box(1.2, 0.35, 0, 0.9, 0.08, 0.1, CHASSIS);
    b.box(1.6, 0.3, 0, 0.15, 0.2, 0.15, STEEL);
    b.wheels([-0.3], 0, 0.85, 0.3, 0.18);
    for (const x of [-1.38, 0.78]) b.box(x, 0.58, 0, 0.04, 0.3, 1.5, STEEL);
    if (variant === 'two') {
      b.bike(-0.3, 0.58, -0.38, BIKES[0], '250cc', 0);
      b.bike(-0.3, 0.58, 0.38, BIKES[1], '250cc', 0);
    } else b.bike(-0.3, 0.58, 0, BIKES[0], '250cc', 0);
  },
  pit_clutter({ b, col }) {
    clutter(b, 0.2, 0, col);
    for (let k = 0; k < 3; k++) {
      const t = b.cyl(-0.9, 0.13 + k * 0.26, 0.1, 0.32, 0.22, TYRE, 14);
      t.rotation.x = 0;
      t.position.x += (k % 2) * 0.05 * U;
    }
  },
  trade_stand({ b, col, i, text, labels }) {
    gazebo(b, -1.5, 1.5, -2.0, 1.0, col);
    labels.push({ x: 0, y: 1.8, z: 1.02, l: 3.0, h: 0.3, w: 0.03, text, bg: shade(col, 0.85) });
    b.box(0, 0.75, 0.5, 2.6, 0.05, 0.7, TABLE);
    for (const [sx, sz] of [[-1.2, 0.2], [1.2, 0.2], [-1.2, 0.8], [1.2, 0.8]]) b.pole(sx, 0, sz, 0.75, STEEL, 0.04);
    for (let k = 0; k < 5; k++) b.box(-1.0 + k * 0.5, 0.8, 0.5, 0.35, 0.2 + (k % 2) * 0.15, 0.4, SHIRTS[(i + k) % SHIRTS.length]);
    b.box(0, 0, -1.6, 2.8, 1.8, 0.1, shade(col, 0.9));
    for (let k = 0; k < 4; k++) b.box(-1.05 + k * 0.7, 0.9, -1.5, 0.5, 0.6, 0.08, SHIRTS[(i + k + 3) % SHIRTS.length]);
    b.person(0.3, -0.5, 0, i, { shirt: col });
  },
  catering_van({ b, col, setup, i, text, labels }) {
    const z = -0.9;
    b.box(0, 0.35, z, 4.6, 0.3, 2.0, CHASSIS);
    b.box(-0.3, 0.5, z, 4.2, 2.2, 2.2, col);
    b.box(2.2, 0.35, z, 0.7, 0.1, 0.12, CHASSIS);
    b.wheels([-1.2, 1.2], z, 1.1, 0.33, 0.2);
    b.box(-0.3, 1.3, z + 1.11, 2.8, 0.9, 0.04, GLASS);
    b.box(-0.3, 2.2, z + 1.5, 2.9, 0.05, 0.9, shade(col, 0.9));
    b.box(-0.3, 1.2, z + 1.15, 2.9, 0.08, 0.3, TABLE);
    labels.push({ x: -0.3, y: 2.72, z: z + 0.2, l: 4.0, h: 0.5, w: 0.06, text, bg: shade(col, 0.8), both: true });
    b.box(-0.3, 2.7, z, 4.0, 0.55, 2.0, shade(col, 0.95));
    b.box(1.6, 0, z + 1.4, 0.6, 1.2, 0.08, BLACK);
    b.box(1.6, 0.3, z + 1.4, 0.5, 0.8, 0.04, WHITE);
    b.person(-0.3, z + 0.5, 0, i + 9, { shirt: WHITE });
    if (setup === 'queue') for (let k = 0; k < 3; k++) b.person(-0.6 + k * 0.1, z + 2.1 + k * 0.75, Math.PI, i + k, {});
  },
  marquee({ b, col }) {
    const h = 2.6;
    const L = 10;
    const D = 6;
    b.box(0, 0, 0, L, 0.02, D, MAT);
    for (const x of [-L / 2 + 0.1, 0, L / 2 - 0.1]) for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) b.pole(x, 0, z, h, STEEL, 0.08);
    b.box(0, 0, -D / 2 + 0.03, L, h, 0.06, CANVAS);
    for (const x of [-L / 2 + 0.03, L / 2 - 0.03]) b.box(x, 0, 0, 0.06, h, D, CANVAS);
    b.box(0, h - 0.4, D / 2 - 0.03, L, 0.4, 0.06, col);
    // Each slope leans down towards its own side, so the two meet at a ridge, not a valley.
    for (const s of [-1, 1]) b.box(0, h + 0.7, s * D / 4, L + 0.1, 0.08, Math.hypot(D / 2, 1.5), CANVAS, 0, s * Math.atan2(1.5, D / 2));
    b.box(0, h, 0, L + 0.1, 0.25, 0.1, STEEL);
    b.box(0, h - 0.15, 0, L + 0.12, 0.15, D + 0.12, col);
    // Canvas gable ends under the ridge.
    const gable = new THREE.Shape([[-D / 2, h - 0.02], [D / 2, h - 0.02], [0, h + 1.5]].map(([z, y]) => new THREE.Vector2(z * U, y * U)));
    for (const x of [-L / 2 - 0.03, L / 2 + 0.03]) {
      const end = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.06 * U, bevelEnabled: false }), b.mat(CANVAS));
      end.rotation.y = -Math.PI / 2;
      end.position.set(x * U, 0, 0);
      b.parts.push(end);
    }
    for (let k = 0; k < 4; k++) {
      const x = -3.6 + k * 2.4;
      b.cyl(x, 0.7, -0.8, 0.6, 0.05, TABLE, 12);
      b.pole(x, 0, -0.8, 0.7, STEEL, 0.06);
      for (let c = 0; c < 4; c++) {
        const a = (c / 4) * Math.PI * 2;
        b.box(x + Math.cos(a) * 0.95, 0.45, -0.8 + Math.sin(a) * 0.95, 0.4, 0.04, 0.4, WHITE);
      }
    }
  },
  time_check({ b, col, i, text, labels }) {
    gazebo(b, -1.5, 1.5, -1.5, 1.5, col);
    labels.push({ x: 0, y: 1.8, z: 1.52, l: 3.0, h: 0.3, w: 0.03, text, bg: shade(col, 0.85) });
    b.table(0.3, 0.2);
    b.box(-1.0, 0, -0.9, 0.5, 2.0, 0.5, BLACK);
    b.box(-1.0, 1.4, -0.63, 0.44, 0.44, 0.03, WHITE);
    b.box(-1.0, 1.57, -0.61, 0.03, 0.18, 0.02, BLACK);
    b.box(-0.9, 1.6, -0.61, 0.16, 0.03, 0.02, BLACK);
    b.person(0.3, -0.5, 0, i, { pose: 'sit', arms: 'forward', shirt: HIVIS });
    b.person(1.3, 1.4, Math.PI, i + 1, { shirt: HIVIS });
  },
  foot_bridge({ b, col, setup, L, i }) {
    const deckH = 4.8;
    const tower = 2.2;
    const w = 1.6;
    for (const s of [-1, 1]) {
      const x0 = s * (L / 2 - tower / 2);
      // A stair tower at each end: four legs, the flights zig-zagging up inside, the landing at the top.
      for (const x of [-tower / 2 + 0.08, tower / 2 - 0.08]) for (const z of [-w / 2 - 0.08, w / 2 + 0.08]) b.pole(x0 + x, 0, z, deckH + 1.2, STEEL, 0.1);
      for (let k = 0; k < 4; k++) {
        const y = (k + 0.5) * (deckH / 4);
        const dir = k % 2 ? -1 : 1;
        b.box(x0, y, 0, tower - 0.2, 0.12, w - 0.1, 0x6a6a70, dir * Math.atan2(deckH / 4, tower - 0.2));
        for (const z of [-w / 2, w / 2]) b.box(x0, y + 0.1, z, tower - 0.2, 0.08, 0.05, STEEL, dir * Math.atan2(deckH / 4, tower - 0.2));
      }
      b.box(x0, deckH, 0, tower, 0.12, w, 0x6a6a70);
    }
    const span = L - tower * 2 + 0.2;
    b.box(0, deckH, 0, span, 0.15, w, col);
    b.box(0, deckH - 0.35, 0, span, 0.35, w * 0.9, shade(col, 0.8));
    for (const z of [-w / 2, w / 2]) {
      b.box(0, deckH + 1.1, z, L, 0.06, 0.06, STEEL);
      b.box(0, deckH + 0.6, z, L, 0.04, 0.04, STEEL);
      const n = Math.max(2, Math.round(L / 1.5));
      for (let k = 0; k <= n; k++) b.pole(-L / 2 + (L * k) / n, deckH + 0.15, z, 1.0, STEEL, 0.05);
    }
    for (const s of [-1, 1]) b.box(s * (L / 2 - 0.2), deckH + 1.2, 0, 0.3, 0.3, w + 0.3, STEEL);
    if (setup === 'fans') {
      const n = Math.max(2, Math.min(8, Math.round(span / 2.5)));
      const up = b.parts.length;
      for (let k = 0; k < n; k++) {
        const x = -span / 2 + 1.2 + (span - 2.4) * (k / Math.max(1, n - 1));
        const z = (hash(i * 3 + k) - 0.5) * 0.7;
        b.person(x, z, hash(i + k * 7) > 0.5 ? 0.3 : -0.4, i + k, { arms: k % 3 === 0 ? 'up' : 'down' });
      }
      for (const m of b.parts.slice(up)) m.position.y += (deckH + 0.15) * U;
    }
  },
  crowd_barrier({ b, col, L }) {
    const n = Math.max(1, Math.round(L / 2.3));
    const seg = L / n;
    for (let k = 0; k < n; k++) {
      const x = -L / 2 + seg * (k + 0.5);
      b.box(x, 1.05, 0, seg - 0.06, 0.05, 0.05, col);
      b.box(x, 0.25, 0, seg - 0.06, 0.05, 0.05, col);
      for (const sx of [-1, 1]) {
        b.pole(x + sx * (seg / 2 - 0.05), 0.1, 0, 1.0, col, 0.05);
        b.box(x + sx * (seg / 2 - 0.05), 0, 0, 0.08, 0.1, 0.5, col);
      }
      const bars = Math.max(3, Math.round(seg / 0.25));
      for (let j = 1; j < bars; j++) b.pole(x - seg / 2 + (seg * j) / bars, 0.3, 0, 0.75, col, 0.025);
    }
  },
  ambulance({ b, setup, D, i }) {
    const bz = -(D - 1.8) / 2;
    rustyVan(b, 0xf4f4f0, undefined, bz, false);
    // The Battenburg band along the sides and the blue lights on the roof.
    for (const s of [-1, 1]) for (let k = 0; k < 10; k++) b.box(-2.0 + k * 0.36, 0.95, bz + s * 0.905, 0.34, 0.45, 0.02, k % 2 ? 0x2fb02a : 0xf0e020);
    for (let k = 0; k < 4; k++) b.box(-0.6 + k * 0.5, 0.75, bz - 0.92, 0.02, 0.4, 0.4, k % 2 ? 0x2fb02a : 0xf0e020);
    b.box(-0.3, 2.1, bz, 1.2, 0.18, 0.3, 0x2050e0);
    b.box(-0.3, 1.2, bz + 0.91, 1.0, 0.5, 0.02, GLASS);
    b.box(-0.3, 1.55, bz + 0.91, 0.5, 0.5, 0.02, 0xd02020);
    b.box(-0.3, 1.75, bz + 0.92, 1.3, 0.1, 0.02, 0xd02020);
    b.box(-0.3, 1.95, bz + 0.92, 0.1, 0.1, 0.02, 0xd02020);
    if (setup === 'crew') {
      b.person(-1.2, bz + 1.5, Math.PI, i, { shirt: 0x2fb02a, trousers: 0x2fb02a });
      b.person(0.4, bz + 1.7, 0.4, i + 1, { shirt: 0x2fb02a, trousers: 0x2fb02a, arms: 'forward', held: [0.4, 0.3, 0.3, 0xd02020] });
    }
  },
  quad({ b, col, variant, i }) {
    b.box(0, 0.3, 0, 1.8, 0.3, 0.7, CHASSIS);
    b.box(-0.1, 0.55, 0, 1.3, 0.3, 0.9, col);
    b.box(-0.5, 0.8, 0, 0.7, 0.12, 0.45, BLACK);
    b.box(0.4, 0.8, 0, 0.3, 0.35, 0.3, col);
    b.box(0.6, 1.1, 0, 0.06, 0.06, 0.7, STEEL);
    b.box(-1.0, 0.4, 0, 0.2, 0.4, 0.9, STEEL);
    b.box(1.0, 0.4, 0, 0.2, 0.4, 0.9, STEEL);
    b.wheels([0.65, -0.65], 0, 0.5, 0.3, 0.25);
    if (variant === 'rider') {
      const up = b.parts.length;
      b.person(-0.5, 0.0, Math.PI / 2, i, { pose: 'sit', arms: 'forward', shirt: HIVIS });
      for (const m of b.parts.slice(up)) m.position.y += 0.15 * U;
    }
  },
  tractor({ b, col, variant, i }) {
    const x0 = 2.1;
    b.box(x0, 0.7, 0, 1.8, 0.9, 0.8, col);
    b.box(x0 + 0.9, 0.65, 0, 0.1, 0.9, 0.85, shade(col, 0.85));
    b.box(x0 - 1.1, 1.4, 0, 1.1, 0.8, 1.0, col);
    b.box(x0 - 0.5, 1.6, 0, 1.5, 0.9, 0.95, col);
    b.box(x0 - 0.6, 1.7, 0, 1.5, 1.05, 1.3, GLASS);
    b.box(x0 - 0.6, 2.75, 0, 1.6, 0.1, 1.4, shade(col, 0.8));
    b.box(x0 + 0.2, 1.4, 0, 0.14, 0.9, 0.14, BLACK);
    b.wheels([x0 - 1.1], 0, 1.05, 0.85, 0.55);
    b.wheels([x0 + 0.9], 0, 0.95, 0.5, 0.3);
    b.box(x0 - 2.4, 0.7, 0, 0.6, 0.1, 0.1, CHASSIS);
    const up = b.parts.length;
    b.person(x0 - 0.6, 0, -Math.PI / 2, i, { pose: 'sit', arms: 'forward', shirt: 0x3a5a3a });
    for (const m of b.parts.slice(up)) m.position.y += 0.95 * U;
    if (variant === 'bowser') {
      const t = x0 - 4.6;
      b.box(t + 1.6, 0.6, 0, 1.6, 0.1, 0.1, CHASSIS);
      b.box(t, 0.5, 0, 2.6, 0.2, 1.2, CHASSIS);
      const tank = b.cyl(t, 0.7, 0, 0.8, 3.0, shade(col, 1.15), 16);
      tank.rotation.z = Math.PI / 2;
      tank.position.y = 1.5 * U;
      b.wheels([t], 0, 0.95, 0.4, 0.25);
      b.box(t - 1.7, 0.6, 0, 0.1, 0.1, 2.4, STEEL);
      for (let k = 0; k < 5; k++) b.box(t - 1.7, 0.45, -1.1 + k * 0.55, 0.08, 0.15, 0.08, STEEL);
    } else {
      const t = x0 - 2.9;
      b.box(t, 0.55, 0, 0.4, 0.15, 2.2, CHASSIS);
      b.box(t - 0.6, 0.55, 0, 0.4, 0.15, 2.2, CHASSIS);
      for (let k = 0; k < 9; k++) b.box(t - (k % 2) * 0.6, 0.05, -1.0 + k * 0.25, 0.08, 0.5, 0.06, STEEL, 0.2);
    }
  },
  toilets({ b, col, variant }) {
    const n = variant === 'four' ? 4 : variant === 'two' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * 1.25;
      b.box(x, 0, 0, 1.15, 0.15, 1.15, BLACK);
      b.box(x, 0.15, 0, 1.1, 2.1, 1.1, col);
      b.box(x, 0.25, 0.555, 0.7, 1.9, 0.02, shade(col, 0.9));
      b.box(x, 2.25, 0, 1.15, 0.12, 1.15, shade(col, 1.2));
      b.box(x + 0.25, 1.1, 0.57, 0.04, 0.12, 0.02, STEEL);
    }
  },
  feather_flags({ b, col, variant, text, labels }) {
    const n = variant === 'three' ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * 1.4;
      b.disc(x, 0, 0.3, BLACK, 0.03);
      b.pole(x, 0, 0, 4.0, 0xe8e8e8, 0.04);
      b.box(x, 3.98, 0, 0.3, 0.35, 0.06, col, 0.5);
      labels.push({ x: x + 0.33, y: 0.6, z: 0, l: 0.62, h: 3.2, w: 0.02, text, bg: col, vertical: true, both: true });
    }
  },
  inflatable({ b, col, variant, L, text, labels }) {
    const dark = shade(col, 0.8);
    if (variant === 'column') {
      b.cyl(0, 0, 0, 0.75, 0.5, dark, 16);
      b.cyl(0, 0.5, 0, 0.7, 5.5, col, 16);
      b.cyl(0, 6.0, 0, 0.7, 0.5, col, 16, 0.3);
      for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) labels.push({ x: Math.sin(ry) * 0.66, y: 1.5, z: Math.cos(ry) * 0.66, l: 1.0, h: 3.0, w: 0.04, ry, text, bg: col, vertical: true });
      return;
    }
    const h = 4.8;
    for (const s of [-1, 1]) {
      b.cyl(s * (L / 2 - 0.6), 0, 0, 0.6, h, col, 14);
      b.cyl(s * (L / 2 - 0.6), 0, 0, 0.65, 0.5, dark, 14);
    }
    const beam = b.cyl(0, h, 0, 0.6, L, col, 14);
    beam.rotation.z = Math.PI / 2;
    beam.position.y = h * U;
    labels.push({ x: 0, y: h - 0.5, z: 0, l: L - 2.4, h: 1.0, w: 1.22, text, bg: col, both: true });
  },
  cones({ b, col, L }) {
    const n = Math.max(1, Math.round(L / 1.5));
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 0 : -L / 2 + 0.3 + (L - 0.6) * (k / (n - 1));
      b.box(x, 0, 0, 0.4, 0.04, 0.4, BLACK);
      b.cyl(x, 0.04, 0, 0.17, 0.7, col, 10, 0.03);
      b.cyl(x, 0.4, 0, 0.11, 0.1, WHITE, 10, 0.085);
    }
  },
  camp_chairs({ b, col, variant, i }) {
    const n = variant === 'three' ? 3 : variant === 'two' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * 0.85;
      chair(b, x, 0, col);
      b.person(x, 0, 0, i + k, { pose: 'sit', arms: k === 1 ? 'up' : 'down' });
    }
    b.box(n === 1 ? 0.7 : (n - 1) / 2 * 0.85 + 0.7, 0, 0.1, 0.55, 0.4, 0.4, 0x2a5ab0);
    b.box(n === 1 ? 0.7 : (n - 1) / 2 * 0.85 + 0.7, 0.4, 0.1, 0.57, 0.08, 0.42, WHITE);
  },
  fan_photo({ b, col, variant, i }) {
    const phone = variant !== 'camera';
    b.person(0, 0, 0, i, { arms: 'up', shirt: col });
    if (phone) b.box(0.3, 2.0, 0.08, 0.08, 0.16, 0.02, BLACK);
    else {
      b.box(0, 1.45, 0.22, 0.2, 0.14, 0.16, BLACK);
      b.cyl(0, 1.48, 0.42, 0.045, 0.25, CAMERA, 10).rotation.x = Math.PI / 2;
    }
  },
  lunch_table({ b, col, setup, i }) {
    b.box(0, 0.72, 0, 1.6, 0.05, 0.8, TABLE);
    for (const [sx, sz] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) b.pole(sx, 0, sz, 0.72, STEEL, 0.04);
    for (let k = 0; k < 3; k++) b.box(-0.5 + k * 0.5, 0.77, 0, 0.3, 0.06 + (k % 2) * 0.1, 0.3, [0xe0e0e0, 0xd04030, 0xe8c020][k]);
    for (const [x, z, ry] of [[-0.4, 0.9, Math.PI], [0.4, 0.9, Math.PI], [-0.4, -0.9, 0], [0.4, -0.9, 0]]) {
      chair(b, x, z, 0x3a3a40);
      b.person(x, z, ry, i + Math.round(x * 10 + z * 3), { pose: 'sit', arms: 'forward' });
    }
    if (setup === 'parasol') parasol(b, 0, 0, 2.4, 1.5, col);
  },
  picnic({ b, col, variant, i }) {
    b.box(0, 0, 0, 2.2, 0.03, 2.2, col);
    for (let k = 0; k < 4; k++) b.box(-0.8 + k * 0.55, 0.03, 0, 0.1, 0.01, 2.2, shade(col, 0.85));
    b.box(0.7, 0.03, -0.6, 0.5, 0.3, 0.35, WOOD);
    b.box(0.7, 0.33, -0.6, 0.52, 0.05, 0.37, shade(WOOD, 0.8));
    b.person(-0.5, -0.5, Math.PI * 0.75, i, { pose: 'floor', arms: 'forward' });
    b.person(-0.1, 0.6, Math.PI * 1.6, i + 1, { pose: 'floor' });
    if (variant === 'three') b.person(0.7, 0.4, Math.PI * 1.2, i + 2, { pose: 'floor', arms: 'up' });
  },
  fan_parasol({ b, col, i }) {
    b.person(-0.15, 0, 0, i, { arms: 'forward', shirt: 0xf0f0f0 });
    b.box(0.25, 1.1, 0, 0.05, 1.5, 0.05, STEEL);
    b.cyl(0.25, 2.3, 0, 0.9, 0.4, col, 10, 0.02);
  },
  fans_fence({ b, col, L, i }) {
    const n = Math.max(2, Math.round(L / 1.6));
    for (let k = 0; k <= n; k++) b.box(-L / 2 + (L * k) / n, 0, 0, 0.09, 1.05, 0.09, col);
    for (const y of [0.4, 0.95]) b.box(0, y, 0, L, 0.08, 0.06, col);
    const fans = Math.max(1, Math.round(L / 1.3));
    for (let k = 0; k < fans; k++) {
      const x = -L / 2 + 0.65 + (L - 1.3) * (fans === 1 ? 0.5 : k / (fans - 1));
      b.person(x, -0.3, (hash(i + k * 5) - 0.5) * 0.5, i + k, { arms: k % 2 ? 'forward' : 'down' });
    }
  },

  camera_crane({ b, col, i }) {
    // A jib: the base with its counterweight at -x, the arm rising to the camera at +x, the operator at the base.
    b.box(-2.3, 0, -0.3, 1.6, 0.2, 1.6, CHASSIS);
    for (const [x, z] of [[-3.0, -1.0], [-1.6, -1.0], [-3.0, 0.4], [-1.6, 0.4]]) b.cyl(x, 0, z, 0.12, 0.2, TYRE, 10);
    b.pole(-2.3, 0.2, -0.3, 1.6, STEEL, 0.14);
    b.box(-2.3, 1.7, -0.3, 0.4, 0.3, 0.4, col);
    const len = 6.0;
    const rise = 3.0;
    const arm = b.box(-2.3 + len / 2 - 0.6, 1.85 + rise / 2 - 0.08, -0.3, Math.hypot(len, rise), 0.16, 0.16, col);
    arm.rotation.z = Math.atan2(rise, len);
    b.box(-3.6, 1.6, -0.3, 0.6, 0.5, 0.5, 0x4a4a50);
    camera(b, -2.3 + len - 0.6, 1.85 + rise - 0.1, -0.3, true);
    b.person(-2.3, 0.6, 0, i, { arms: 'forward', shirt: BLACK });
  },
  drone_pilot({ b, col, i }) {
    b.person(0, 0, 0, i, { arms: 'forward', shirt: col, held: [0.14, 0.08, 0.3, BLACK] });
    b.box(0.3, 2.8, 0.6, 0.3, 0.1, 0.3, BLACK);
    for (const [sx, sz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      b.box(0.3 + sx, 2.82, 0.6 + sz, 0.2, 0.03, 0.04, BLACK);
      b.cyl(0.3 + sx, 2.86, 0.6 + sz, 0.14, 0.01, 0x8a8a90, 10);
    }
  },
  press_tent({ b, col, i, text, labels }) {
    gazebo(b, -2.0, 2.0, -2.0, 2.0, col);
    labels.push({ x: 0, y: 1.8, z: 2.02, l: 4.0, h: 0.3, w: 0.03, text, bg: shade(col, 0.85) });
    for (const z of [-1.0, 0.8]) {
      b.box(0, 0.72, z, 3.6, 0.05, 0.7, TABLE);
      for (const sx of [-1.7, 1.7]) for (const sz of [-0.3, 0.3]) b.pole(sx, 0, z + sz, 0.72, STEEL, 0.04);
      for (let k = 0; k < 3; k++) {
        const x = -1.2 + k * 1.2;
        b.box(x, 0.77, z + 0.1, 0.32, 0.02, 0.24, 0xd0d0d4);
        b.box(x, 0.79, z - 0.05, 0.32, 0.22, 0.02, 0x3a3a40, 0, -0.3);
        b.person(x, z + 0.55, Math.PI, i + k + (z > 0 ? 3 : 0), { pose: 'sit', arms: 'forward' });
      }
    }
  },
  signing_table({ b, col, i, text, labels }) {
    b.box(0, 0.75, -0.3, 2.4, 0.05, 0.7, TABLE);
    b.box(0, 0.05, -0.0, 2.4, 0.7, 0.03, col);
    for (const sx of [-1.1, 1.1]) b.pole(sx, 0, -0.3, 0.75, STEEL, 0.04);
    b.box(0, 0, -1.4, 2.8, 2.0, 0.08, shade(col, 0.9));
    labels.push({ x: 0, y: 1.5, z: -1.35, l: 2.6, h: 0.4, w: 0.02, text, bg: col });
    b.person(-0.4, -0.95, 0, i, { pose: 'sit', arms: 'forward', shirt: BIKES[i % 5] });
    b.person(0.5, -0.95, 0, i + 1, { pose: 'sit', arms: 'forward', shirt: BIKES[(i + 2) % 5] });
    for (let k = 0; k < 3; k++) b.person(-0.3 + k * 0.1, 0.4 + k * 0.7, Math.PI, i + 3 + k, { arms: k ? 'down' : 'forward' });
    for (let k = 0; k < 3; k++) b.box(-0.8 + k * 0.6, 0.8, -0.4, 0.3, 0.02, 0.4, WHITE);
  },
  pa_speaker({ b, col }) {
    b.box(0, 0, 0, 0.6, 0.12, 0.6, CHASSIS);
    b.pole(0, 0.12, 0, 5.0, STEEL, 0.1);
    for (const s of [-1, 1]) {
      const sp = b.box(s * 0.3, 4.3, 0.1, 0.4, 0.7, 0.5, col);
      sp.rotation.y = s * 0.6;
    }
    b.box(0, 5.1, 0, 0.3, 0.3, 0.3, 0x4a4a50);
  },
  timing_beam({ b, col, L }) {
    for (const s of [-1, 1]) {
      b.box(s * (L / 2 - 0.3), 0, 0, 0.5, 0.1, 0.5, CHASSIS);
      b.pole(s * (L / 2 - 0.3), 0.1, 0, 1.2, col, 0.08);
    }
    b.box(0, 0, 0, L - 0.6, 0.03, 0.12, 0x3a3a40);
    b.box(L / 2 - 0.3, 1.3, 0, 0.4, 0.3, 0.3, col);
    b.pole(L / 2 - 0.3, 1.6, 0, 0.8, 0xe8e8e8, 0.025);
    b.box(-L / 2 + 0.3, 1.3, 0, 0.3, 0.2, 0.3, 0xd02020);
  },
  skid_steer({ b, col, i }) {
    b.box(-0.3, 0.3, 0, 1.9, 0.9, 1.3, col);
    b.box(-0.4, 1.2, 0, 1.2, 0.9, 1.0, BLACK);
    b.box(-0.4, 1.3, 0, 1.22, 0.6, 0.9, GLASS);
    b.box(-0.4, 2.1, 0, 1.3, 0.08, 1.1, col);
    for (const s of [-1, 1]) b.box(-0.3, 1.0, s * 0.75, 1.6, 0.15, 0.12, shade(col, 0.8), 0, 0);
    b.wheels([0.3, -0.9], 0, 0.75, 0.38, 0.25);
    for (const s of [-1, 1]) b.box(0.7, 0.9, s * 0.65, 1.2, 0.12, 0.1, CHASSIS, -0.25);
    b.box(1.5, 0, 0, 0.6, 0.6, 1.7, STEEL);
    b.box(1.25, 0.55, 0, 0.1, 0.3, 1.7, STEEL, 0.5);
    const up = b.parts.length;
    b.person(-0.4, -0.2, -Math.PI / 2, i, { pose: 'sit', arms: 'forward', shirt: HIVIS });
    for (const m of b.parts.slice(up)) m.position.y += 0.75 * U;
  },
  merch_trailer({ b, col, i, text, labels }) {
    const z = -0.9;
    b.box(0, 0.4, z, 5.6, 0.25, 2.1, CHASSIS);
    b.box(3.1, 0.4, z, 0.7, 0.1, 0.12, CHASSIS);
    b.wheels([-1.0, 1.0], z, 1.15, 0.35, 0.2);
    b.box(0, 0.65, z - 0.3, 5.6, 2.2, 1.6, col);
    b.box(0, 2.85, z, 5.7, 0.12, 2.4, shade(col, 0.8));
    for (const x of [-2.75, 2.75]) b.box(x, 0.65, z + 0.5, 0.1, 2.2, 1.2, col);
    // The shelves of shirts and caps behind the counter, the side flap up as a canopy.
    for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) b.box(-2.25 + k * 0.9, 1.0 + r * 0.7, z + 0.55, 0.5, 0.5, 0.1, SHIRTS[(i + k + r * 3) % SHIRTS.length]);
    b.box(0, 0.65, z + 1.0, 5.2, 0.9, 0.3, shade(col, 0.9));
    b.box(0, 1.55, z + 1.0, 5.2, 0.05, 0.35, TABLE);
    b.box(0, 2.85, z + 1.9, 5.6, 0.05, 1.8, CANVAS, 0, -0.2);
    labels.push({ x: 0, y: 2.0, z: z + 1.85, l: 4.5, h: 0.6, w: 0.03, text, bg: shade(col, 0.85) });
    b.box(0, 1.95, z + 1.83, 4.6, 0.7, 0.03, shade(col, 0.85));
    b.person(-1.2, z + 0.6, 0, i, { shirt: col });
    b.person(1.6, z + 2.0, Math.PI, i + 1, { arms: 'forward' });
  },
  vip_stand({ b, col, L, i }) {
    const D = 5.0;
    const tiers = 4;
    const step = D / tiers;
    // The front row (the lowest) is at +z, the side the people face and the track is on; the
    // tiers rise towards the back wall at -z (Boss, 30 Oct 2026: it stood the wrong way round).
    for (let k = 0; k < tiers; k++) {
      const z = D / 2 - step * (k + 0.5);
      const h = 0.6 + k * 0.5;
      b.box(0, 0, z, L, h, step, k % 2 ? shade(col, 1.12) : col);
      const seats = Math.max(1, Math.floor(L / 0.6));
      for (let s = 0; s < seats; s++) {
        const x = -L / 2 + 0.3 + (s + 0.5) * ((L - 0.6) / seats);
        b.box(x, h, z - 0.12, 0.45, 0.08, 0.3, 0x2a4a90);
        if (hash(i * 7 + s * 3 + k) > 0.3) {
          b.box(x, h + 0.05, z + 0.08, 0.36, 0.5, 0.26, SHIRTS[Math.floor(hash(i + s * 11 + k * 5) * SHIRTS.length)]);
          b.box(x, h + 0.56, z + 0.08, 0.22, 0.22, 0.22, 0xe0b090);
        }
      }
    }
    b.box(0, 0.6 + (tiers - 1) * 0.5, -D / 2 + 0.1, L, 1.0, 0.2, shade(col, 0.7));
    for (const x of [-L / 2 + 0.2, 0, L / 2 - 0.2]) for (const z of [-D / 2 + 0.3, D / 2 - 0.3]) b.pole(x, 0.6 + (z < 0 ? (tiers - 1) * 0.5 : 0), z, z < 0 ? 2.6 : 4.0, STEEL, 0.14);
    b.box(0, 4.2, 0, L + 0.4, 0.15, D + 0.4, shade(col, 0.6), 0, -0.1);
    for (const x of [-L / 2, L / 2]) b.box(x, 0.6 + (tiers - 1) * 0.5, 0, 0.06, 1.0, D, STEEL);
  },
  // ---- supercross (Boss, 28 Oct 2026: podiums and the stadium's own kit) ----
  podium({ b, col, variant, setup, i, text, labels }) {
    const sx = variant === 'supercross';
    const dark = shade(col, 0.7);
    // The stage: supercross raises the whole podium on a staged floor with steps and a lit backdrop.
    const floor = sx ? 0.6 : 0;
    if (sx) {
      b.box(0, 0, -0.4, 7.0, floor, 3.6, 0x3a3a40);
      for (let k = 0; k < 3; k++) b.box(0, k * 0.2, 1.4 + 0.3 * (2 - k), 2.0, 0.2, 0.3, 0x4a4a50);
      for (const x of [-3.4, 3.4]) { b.pole(x, 0, -2.1, 4.6, STEEL, 0.08); b.box(x, 4.4, -2.1, 0.5, 0.3, 0.3, BLACK); }
      b.box(0, 4.5, -2.1, 7.0, 0.16, 0.16, STEEL);
      for (let k = -2; k <= 2; k++) { b.box(k * 1.4, 4.2, -1.9, 0.3, 0.3, 0.3, BLACK); b.box(k * 1.4, 4.05, -1.75, 0.22, 0.05, 0.22, 0xfff6c0); }
    }
    // The backdrop board with the sponsor's name.
    const bw = sx ? 7.0 : 5.0;
    const bh = sx ? 3.6 : 2.4;
    b.box(0, floor, -2.0, bw, bh, 0.1, col);
    for (const x of [-bw / 2 + 0.1, bw / 2 - 0.1]) b.pole(x, floor, -2.0, bh + 0.2, dark, 0.06);
    labels.push({ x: 0, y: floor + bh * 0.62, z: -1.94, l: bw - 0.4, h: bh * 0.32, w: 0.02, text, bg: col });
    b.box(0, floor + bh * 0.1, -1.94, bw - 0.4, bh * 0.32, 0.02, WHITE);
    // The three steps: 1 in the middle and tallest, 2 on its right (the viewer's left), 3 on its left.
    const steps: [number, number, string][] = [[0, 0.9, '1'], [-1.3, 0.6, '2'], [1.3, 0.4, '3']];
    for (const [x, h, n] of steps) {
      b.box(x, floor, -0.6, 1.2, h, 1.2, sx ? 0xf0f0f0 : WOOD);
      b.box(x, floor + h, -0.6, 1.2, 0.03, 1.2, sx ? col : shade(WOOD, 1.15));
      labels.push({ x, y: floor + h * 0.25, z: 0.01, l: 0.9, h: h * 0.5, w: 0.02, text: n, bg: sx ? col : dark, fg: '#ffffff' });
      if (setup === 'riders' || setup === 'champagne') {
        const n0 = b.parts.length;
        b.person(x, -0.6, 0, i + Number(n), { shirt: BIKES[(i + Number(n)) % 5], trousers: BIKES[(i + Number(n) + 2) % 5], arms: setup === 'champagne' || n === '1' ? 'up' : 'down' });
        for (const m of b.parts.slice(n0)) m.position.y += (floor + h) * U;
        if (setup === 'champagne') { b.cyl(x + 0.3, floor + h + 2.15, -0.6, 0.05, 0.3, 0x205030, 8); b.cyl(x + 0.3, floor + h + 2.45, -0.6, 0.03, 0.1, 0xe0c060, 8); }
      }
    }
    if (setup === 'champagne') { b.person(-2.6, 1.6, Math.PI, i + 9, { arms: 'up', shirt: BLACK }); b.box(-2.6, 2.0, 1.4, 0.1, 0.4, 0.1, BLACK); }
  },
  holeshot_board({ b, col, text, labels }) {
    for (const x of [-1.4, 1.4]) b.pole(x, 0, 0, 2.6, STEEL, 0.05);
    b.box(0, 1.5, 0, 3.0, 1.1, 0.06, col);
    labels.push({ x: 0, y: 1.75, z: 0.04, l: 2.8, h: 0.6, w: 0.02, text, bg: col, both: true });
    // The arrow pointing down at the holeshot line.
    b.box(0, 1.0, 0.04, 0.5, 0.4, 0.02, WHITE);
    b.box(0, 2.4, 0, 3.2, 0.12, 0.12, shade(col, 0.7));
  },
  pyro({ b, col, setup, L }) {
    const n = Math.max(1, Math.round(L / 2.0));
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 0 : -L / 2 + 0.5 + (L - 1.0) * (k / (n - 1));
      b.box(x, 0, 0, 0.7, 0.4, 0.7, BLACK);
      b.cyl(x, 0.4, 0, 0.12, 0.3, 0x4a4a50, 8);
      if (setup === 'firing') {
        b.cyl(x, 0.7, 0, 0.28, 2.2, col, 8, 0.06);
        b.cyl(x, 2.2, 0, 0.14, 1.4, 0xfff0a0, 8, 0.02);
      }
    }
  },
  truss_arch({ b, col, L, text, labels }) {
    const h = 6.0;
    const truss = (x: number, y: number, z: number, l: number, hh: number, w: number, vertical: boolean) => {
      // A lattice truss: four chords with braces, drawn as thin boxes.
      if (vertical) {
        for (const dx of [-w / 2, w / 2]) for (const dz of [-w / 2, w / 2]) b.pole(x + dx, y, z + dz, hh, STEEL, 0.04);
        for (let k = 0.5; k < hh; k += 0.8) b.box(x, y + k, z, w, 0.04, w, STEEL);
      } else {
        for (const dy of [-w / 2, w / 2]) for (const dz of [-w / 2, w / 2]) b.box(x, y + dy, z + dz, l, 0.06, 0.06, STEEL);
        for (let k = -l / 2 + 0.4; k < l / 2; k += 0.8) b.box(x + k, y - w / 2, z, 0.04, w, w, STEEL);
      }
    };
    for (const s of [-1, 1]) { b.box(s * (L / 2 - 0.4), 0, 0, 1.0, 0.1, 1.0, BLACK); truss(s * (L / 2 - 0.4), 0.1, 0, 0, h, 0.5, true); }
    truss(0, h + 0.25, 0, L, 0, 0.5, false);
    // Stage lights hung under the beam, pointing down at the track.
    const n = Math.max(2, Math.floor((L - 2) / 1.2));
    for (let k = 0; k < n; k++) {
      const x = -L / 2 + 1 + ((L - 2) * (k + 0.5)) / n;
      b.box(x, h - 0.35, 0, 0.3, 0.4, 0.3, BLACK);
      b.box(x, h - 0.37, 0, 0.24, 0.02, 0.24, 0xfff6c0);
    }
    if (text) labels.push({ x: 0, y: h + 0.6, z: 0, l: Math.max(1, L - 3), h: 0.7, w: 0.52, text, bg: col, both: true });
  },
  stadium_tunnel({ b, col, text, labels }) {
    // The riders' way onto the floor: a stadium wall with an arched opening, the seating rising behind.
    const W = 9.0;
    const H = 4.0;
    const open = 3.2;
    for (const s of [-1, 1]) b.box(s * ((W + open) / 4), 0, 0, (W - open) / 2, H, 0.6, 0x9a9a98);
    b.box(0, H - 0.8, 0, open + 0.2, 0.8, 0.6, 0x9a9a98);
    b.box(0, 0.02, -1.6, open, 0.05, 3.8, 0x3a3a40);
    for (const s of [-1, 1]) b.box(s * (open / 2 + 0.02), 0, -1.6, 0.3, H - 0.8, 3.0, 0x6a6a68);
    b.box(0, H - 0.85, -1.6, open + 0.6, 0.1, 3.0, 0x5a5a58);
    for (let k = 0; k < 4; k++) b.box(0, H + k * 0.6, -1.8 - k * 0.8, W, 0.6, 0.8, k % 2 ? col : shade(col, 1.15));
    labels.push({ x: 0, y: H - 0.4, z: 0.31, l: open + 0.2, h: 0.5, w: 0.02, text, bg: BLACK });
    b.box(0, H + 2.4, -4.4, W, 0.2, 0.3, STEEL);
  },
  trophy_table({ b, col, i }) {
    b.box(0, 0.75, 0, 2.4, 0.05, 0.8, TABLE);
    b.box(0, 0.05, 0.4, 2.4, 0.7, 0.03, col);
    for (const sx of [-1.1, 1.1]) b.pole(sx, 0, 0, 0.75, STEEL, 0.04);
    // Three cups, the winner's tallest, and the champagne.
    const cups: [number, number, number][] = [[0, 0.9, 0xe8c020], [-0.7, 0.7, 0xd0d0d8], [0.7, 0.55, 0xc08040]];
    for (const [x, h, c] of cups) {
      b.box(x, 0.8, 0, 0.3, 0.08, 0.3, BLACK);
      b.cyl(x, 0.88, 0, 0.04, h * 0.4, c, 8);
      b.cyl(x, 0.88 + h * 0.4, 0, 0.16, h * 0.6, c, 10, -0.08);
    }
    for (const x of [-1.05, 1.05]) { b.cyl(x, 0.8, 0.15, 0.05, 0.3, 0x205030, 8); b.cyl(x, 1.1, 0.15, 0.03, 0.1, 0xe0c060, 8); }
    b.person(0, -0.7, 0, i, { arms: 'down', shirt: BLACK });
  },
};

const HAY = 0xd8b45a;
export interface MarshalBuilt {
  /** The stand, the hay bales, a second marshal: still, merged into one mesh. */
  base: Build['parts'];
  /** The marshal with the flag: the figure less the flag arm, and the arm with the pole and flag, in metres from the feet. */
  figure: Build['parts'];
  arm: Build['parts'];
  /** Where the feet stand and where the flag arm pivots, in metres in the item's frame. */
  feet: [number, number, number];
  shoulder: [number, number, number];
}

/**
 * A marshal (core/marshal.ts) for the race view to animate: the flag arm is built apart, pivoting
 * at the shoulder, hanging with the flag down and swung up to wave it; the figure leans with it.
 */
export function marshalParts(def: SceneryDef, it: SceneryItem, i: number): MarshalBuilt {
  const b = new Build();
  const col = hexNum(paddockColour(def, it, i), hexNum(def.color, HIVIS));
  const variant = paddockVariant(def, it, i) ?? 'ground';
  const lift = marshalStand(b, variant, col, i);
  const base = b.parts;
  // The marshal: a figure at the platform's height, with their right arm, the pole and the flag apart.
  const f = new Build();
  const fx = variant === 'pair' ? 0.3 : 0;
  f.person(fx, 0, 0, i, { shirt: col, arms: 'down' });
  for (const m of f.parts) m.position.y += lift * U;
  const arm = [f.parts.pop()!];
  const a = new Build();
  a.parts.push(...arm);
  // The pole hangs by the arm with the flag at its lower end, so swung up the flag is on top.
  a.pole(fx + 0.36, lift + 0.1, 0.12, 1.3, 0xe8e8e8, 0.03);
  a.box(fx + 0.36 + 0.32, lift + 0.12, 0.12, 0.64, 0.5, 0.02, 0xf0c020);
  return { base, figure: f.parts, arm: a.parts, feet: [0, lift, 0], shoulder: [fx + 0.3, lift + 1.45, 0] };
}

/**
 * A marshal's stand by its design (the same for the flag man): a pallet stand or a roofed tower
 * with stairs, hay bales, or a second marshal with an extinguisher. Returns the platform height.
 */
function marshalStand(b: Build, variant: string, col: number, i: number): number {
  const lift = MARSHAL_STANDS[variant] ?? 0;
  const deck = (l: number, w: number, roof: boolean) => {
    // A steel platform with a handrail round it, the stairs down the back.
    for (const x of [-l / 2 + 0.06, l / 2 - 0.06]) for (const z of [-w / 2 + 0.06, w / 2 - 0.06]) b.pole(x, 0, z, roof ? lift + 2.3 : lift + 1.05, 0x6a5a48, 0.08);
    b.box(0, lift - 0.08, 0, l, 0.08, w, 0x5a4a3a);
    b.box(0, lift - 0.3, 0, l, 0.06, w, 0x6a5a48);
    for (const x of [-l / 2, l / 2]) b.box(x, lift + 1.0, 0, 0.05, 0.05, w, 0x6a5a48);
    b.box(0, lift + 1.0, w / 2, l, 0.05, 0.05, 0x6a5a48);
    for (const x of [-l / 2, l / 2]) b.box(x, lift + 0.5, 0, 0.04, 0.04, w, 0x6a5a48);
    b.box(0, lift + 0.5, w / 2, l, 0.04, 0.04, 0x6a5a48);
    // The back rails stop either side of the stairs, which come down from the deck's back edge.
    const side = (l - 0.9) / 2;
    for (const sx of [-1, 1]) for (const y of [0.5, 1.0]) b.box(sx * (l / 2 - side / 2), lift + y, -w / 2, side, 0.05, 0.05, 0x6a5a48);
    stairs(b, 0, -w / 2, lift, 0.8, -1, 0x6a5a48);
    if (roof) b.box(0, lift + 2.3, 0, l + 0.4, 0.1, w + 0.4, col);
  };
  if (variant === 'pallet') deck(1.6, 1.4, false);
  else if (variant === 'tower') deck(2.0, 2.0, true);
  else if (variant === 'bales') {
    for (const x of [-0.95, 0.95]) b.box(x, 0, 0.85, 1.8, 0.6, 1.0, HAY);
    b.box(0, 0.6, 0.85, 1.8, 0.6, 1.0, HAY);
  } else if (variant === 'pair') {
    b.person(-0.9, 0, 0.3, i + 1, { shirt: col, arms: 'down' });
    b.cyl(-1.35, 0, 0.2, 0.09, 0.5, 0xd02020, 10);
    b.box(-1.35, 0.5, 0.2, 0.08, 0.1, 0.08, BLACK);
  }
  return lift;
}

/** A flag man for the race view to animate: the white flag in the left hand, the chequered flag in the right, each arm built apart. */
export interface FlaggerBuilt {
  base: Build['parts'];
  figure: Build['parts'];
  /** The left arm with the white flag, the right arm with the chequered flag, in metres from the feet. */
  white: Build['parts'];
  chequered: Build['parts'];
  feet: [number, number, number];
  /** Where the left and right arms pivot. */
  left: [number, number, number];
  right: [number, number, number];
  /** The stand's design, picked or chosen. */
  variant: string;
}

/**
 * The flag man (core/finishCrew.ts), on any of the marshals' stands: each flag on a short pole hangs
 * from its hand with the flag at the lower end, so swung up the flag is on top.
 */
export function flaggerParts(def: SceneryDef, it: SceneryItem, i: number): FlaggerBuilt {
  const b = new Build();
  const col = hexNum(paddockColour(def, it, i), hexNum(def.color, WHITE));
  const variant = paddockVariant(def, it, i) ?? 'ground';
  const lift = marshalStand(b, variant, col, i);
  const f = new Build();
  const fx = variant === 'pair' ? 0.3 : 0;
  f.person(fx, 0, 0, i, { shirt: col, trousers: BLACK, arms: 'down' });
  for (const m of f.parts) m.position.y += lift * U;
  const right = f.parts.pop()!;
  const left = f.parts.pop()!;
  const w = new Build();
  w.parts.push(left);
  w.pole(fx - 0.36, lift + 0.1, 0.12, 1.3, 0xe8e8e8, 0.03);
  w.box(fx - 0.36 - 0.36, lift + 0.12, 0.12, 0.72, 0.55, 0.02, 0xf4f4f4);
  const c = new Build();
  c.parts.push(right);
  c.pole(fx + 0.36, lift + 0.1, 0.12, 1.3, 0xe8e8e8, 0.03);
  // The chequered flag: six squares by four, black and white.
  const sq = 0.12;
  for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) c.box(fx + 0.36 + sq * (k + 0.5), lift + 0.12 + sq * r, 0.12, sq, sq, 0.02, (r + k) % 2 ? 0x16161a : 0xf4f4f4);
  return { base: b.parts, figure: f.parts, white: w.parts, chequered: c.parts, feet: [0, lift, 0], left: [fx - 0.3, lift + 1.45, 0], right: [fx + 0.3, lift + 1.45, 0], variant };
}

/** A pit crew member for the race view to animate: the arms and the board's pole built apart; the board itself (with its words) is drawn by the view. */
export interface PitCrewBuilt {
  base: Build['parts'];
  figure: Build['parts'];
  /** Both arms and the pole, pivoting at the shoulders, in metres from the feet. */
  arms: Build['parts'];
  feet: [number, number, number];
  shoulder: [number, number, number];
  /** Where the board hangs from the end of the pole, in the arms' frame before they swing (metres from the shoulder). */
  board: [number, number, number];
}

/**
 * A pit crew member (core/finishCrew.ts): a team shirt and cap, holding a pit board on a pole in
 * both hands. Standing alone, behind a pit wall, or with a mechanic beside them.
 */
export function pitCrewParts(def: SceneryDef, it: SceneryItem, i: number): PitCrewBuilt {
  const b = new Build();
  const col = hexNum(paddockColour(def, it, i), hexNum(def.color, 0x2a4a90));
  const variant = paddockVariant(def, it, i) ?? 'standing';
  if (variant === 'wall') {
    // A low concrete pit wall in front of them, the lap side.
    b.box(0, 0, 0.75, 2.4, 0.9, 0.3, 0xb8b8b0);
    b.box(0, 0.9, 0.75, 2.4, 0.06, 0.34, 0xd8d8d0);
  } else if (variant === 'pair') {
    b.person(-0.9, -0.2, 0.4, i + 1, { shirt: col, arms: 'forward', held: [0.3, 0.2, 0.3, 0xc02020] });
  }
  const f = new Build();
  f.person(0, 0, 0, i, { shirt: col, trousers: BLACK, arms: 'down' });
  // A team cap.
  f.box(0, 1.73, 0.04, 0.26, 0.08, 0.3, col);
  const cap = f.parts.pop()!;
  const right = f.parts.pop()!;
  const left = f.parts.pop()!;
  f.parts.push(cap);
  const a = new Build();
  a.parts.push(left, right);
  // A handle across both hands, and the pole running on from it, so held out the board is at its end.
  a.box(0, 0.72, 0.06, 0.66, 0.05, 0.05, 0xc8c8c8);
  a.pole(0, -0.05, 0.06, 0.8, 0xc8c8c8, 0.04);
  return { base: b.parts, figure: f.parts, arms: a.parts, feet: [0, 0, 0], shoulder: [0, 1.45, 0], board: [0, -1.5, 0.06] };
}

/** The meshes and labels of a trackside item, in its own frame, or null for an item built elsewhere (the paddock vehicles). */
export function tracksideParts(def: SceneryDef, it: SceneryItem, i: number): Built | null {
  const build = builders[def.id];
  if (!build) return null;
  const b = new Build();
  const labels: Label[] = [];
  build({
    b,
    col: hexNum(paddockColour(def, it, i), hexNum(def.color, 0x888888)),
    setup: paddockSetup(def, it, i),
    variant: paddockVariant(def, it, i),
    L: (it.w ?? def.w) / U,
    D: (it.h ?? def.h) / U,
    i,
    text: it.text ?? def.text ?? '',
    labels,
  });
  return { parts: b.parts, labels };
}

/** True for an item this file builds. */
export const isTrackside = (id: string) => id in builders;
