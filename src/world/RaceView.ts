import Phaser from 'phaser';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneryItem, TrackDef } from '../core/race';
import type { RiderPose } from '../core/riderAI';
import { nearestOnLap, pointAt, START_PAD, startPointAt } from '../core/trackGeom';
import { GRID_H, GRID_W, trackKind, type TrackPartsData } from '../core/trackParts';
import { BIKE_LENGTH, LIP_AT, TrackSurface } from '../core/trackSurface';
import { COLORS } from '../ui/theme';

// The race screen's track view (GDD 11.1): a real 3D scene, drawn by three.js and seen from an
// isometric camera in the spirit of Super Off Road's overhead arcade view. The track is solid
// ground (trackSurface.ts): jumps with faces and landings, banked berms, whoops, hills, a raised
// lip along each edge and an earth bank down to the grass. The ground tiles, surface patches and
// scenery come from the track editor. Each rider is a small 3D bike whose two wheels sit on that
// surface, pitching over jumps and leaning through corners, with a real shadow from the sun.
//
// three.js draws into its own canvas; every frame that picture is copied into a Phaser texture, so
// the race screen's panels, pit board and dialogs still draw over it as before. The camera follows
// your rider (or the leader once you are out), with a map of the whole lap in the corner.

/** Camera direction: degrees round from straight in front, and degrees down from level. */
const CAM_AZ = 40;
const CAM_EL = 38;
/** Grid units across the view, by track kind. Riders stay big enough to follow at this size. */
const VIEW_UNITS: Record<string, number> = { stadium: 36, outdoor: 32, endurance: 32 };
/** Ground drawn round the 100 × 60 grid, in grid units. */
const MARGIN = 24;
const TILE_PX = 32;
const ART_DIR = 'assets/art/area-map/tiled/tiles';
const SURFACES: Record<string, number> = { hard_pack: 0xb07a45, loam: 0x8a5a33, sand: 0xd8c07a, mud: 0x6b4a2b };
const CROWD = [0xc0607a, 0xe0c060, 0x60a0e0, 0xf0f0f0, 0x80c080, 0xe08040, 0x9070c0];

let counter = 0;

export interface ViewRider {
  pose: RiderPose;
  color: number;
  /** Running position, shown over the rider. */
  label: string;
  player: boolean;
  /** Start row (0 at the gate, 1 just behind), for the line-up. */
  startRow?: number;
}

interface Bike {
  root: THREE.Group;
  body: THREE.Group;
  label: Phaser.GameObjects.Text;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  life: number;
}
/** Dust puffs alive at once. */
const DUST = 200;

const hex = (s: string | undefined, fallback: number) => (s && /^#[0-9a-f]{6}$/i.test(s) ? parseInt(s.slice(1), 16) : fallback);
function shade(c: number, k: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
}
/** A steady pseudo-random number from 0 to 1 for an integer, for grain and crowds. */
function noise(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class RaceView {
  readonly surface: TrackSurface;
  readonly follow: boolean;
  private readonly key: string;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene3: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly sun: THREE.DirectionalLight;
  private readonly texture: Phaser.Textures.Texture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly bikes = new Map<string, Bike>();
  private readonly marker: THREE.Mesh;
  private readonly puffs: Puff[] = [];
  private puffNext = 0;
  private dust: THREE.InstancedMesh | null = null;
  private readonly puffMap: THREE.Texture;
  private readonly groundCanvas: HTMLCanvasElement;
  private readonly groundTex: THREE.CanvasTexture;
  private readonly mapDots: Phaser.GameObjects.Graphics;
  private readonly mapBox: { x: number; y: number; k: number };
  private readonly viewUnits: number;
  private readonly dir: THREE.Vector3;
  private readonly bg: number;
  private cam: THREE.Vector3 | null = null;
  private lastClock = 0;
  private dead = false;
  private readonly patchSpans: { from: number; to: number; color: number }[];
  private terrain = new Float32Array(0);
  private readonly labels: Phaser.GameObjects.Container;
  /** Tall scenery that fades when a rider is behind it, so it never hides the racing. */
  private readonly tall: { corners: THREE.Vector3[]; mats: THREE.Material[]; faded: boolean }[] = [];
  /** The start gate's pickets, hinged at the bottom so they drop flat when the race starts. */
  private gateDrop: THREE.Group | null = null;
  /** The official holding the start board beside the start straight, and the board itself. */
  private board: { stand: THREE.Group; panel: THREE.Group } | null = null;
  /** Frame times in ms (whole update, the 3D draw, and handing the picture to Phaser), for the performance check. */
  readonly frameMs: number[] = [];
  readonly renderMs: number[] = [];
  readonly uploadMs: number[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    private readonly track: TrackDef,
    private readonly parts: TrackPartsData,
    private readonly x: number,
    private readonly y: number,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.surface = new TrackSurface(track);
    const kind = trackKind(parts, track);
    this.follow = true;
    this.viewUnits = VIEW_UNITS[kind.id] ?? 32;
    const lap = this.surface.mpu * this.surface.g.total;
    this.patchSpans = (track.patches ?? []).map((p) => ({ from: p.at / lap, to: (p.at + p.length) / lap, color: hex(parts.surfaces.find((s) => s.id === p.surface)?.color, 0x888888) }));
    const ground = track.ground ?? { base: parts.ground[0]?.id ?? 'grass', cell: 2, paint: {} };
    this.bg = hex(parts.ground.find((g) => g.id === ground.base)?.color, 0x5f8f3c);

    // Draw at the screen's real resolution, so the picture stays sharp when the window is big.
    const k = Math.min(scene.scale.width / 1280, scene.scale.height / 720);
    const res = Math.max(1, Math.min(2, k * (window.devicePixelRatio || 1)));
    const rw = Math.round(w * res);
    const rh = Math.round(h * res);
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(rw, rh, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Phaser takes the three.js canvas itself as a texture source and re-uploads it each frame.
    this.key = `raceview-${++counter}`;
    this.texture = scene.textures.addImage(this.key, canvas as unknown as HTMLImageElement)!;
    this.image = scene.add.image(x, y, this.key).setOrigin(0).setDisplaySize(w, h);
    parent.add(this.image);

    this.scene3 = new THREE.Scene();
    this.scene3.background = new THREE.Color(this.bg);
    this.scene3.add(new THREE.HemisphereLight(0xe8f0ff, 0x6a5a40, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera;
    sc.left = -this.viewUnits;
    sc.right = this.viewUnits;
    sc.top = this.viewUnits;
    sc.bottom = -this.viewUnits;
    sc.near = 1;
    sc.far = 200;
    this.scene3.add(this.sun, this.sun.target);

    const az = THREE.MathUtils.degToRad(CAM_AZ);
    const el = THREE.MathUtils.degToRad(CAM_EL);
    this.dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const halfW = this.viewUnits / 2;
    const halfH = (halfW * h) / w;
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 400);

    // Ground, track and scenery.
    this.groundCanvas = document.createElement('canvas');
    this.groundCanvas.width = ((GRID_W + 2 * MARGIN) / 2) * TILE_PX;
    this.groundCanvas.height = ((GRID_H + 2 * MARGIN) / 2) * TILE_PX;
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.magFilter = THREE.NearestFilter;
    this.groundTex.anisotropy = 4;
    this.drawGround();
    this.buildTerrain();
    this.scene3.add(this.terrainMesh());
    this.scene3.add(this.buildTrack());
    if (this.surface.start.total > 0) {
      this.scene3.add(this.buildStart());
      this.scene3.add(this.startGate());
      this.scene3.add(this.startBoard());
    }
    this.scene3.add(this.startLine());
    // Low scenery that never needs fading is baked into one mesh; textured parts stay separate.
    const low: THREE.Mesh[] = [];
    for (const it of track.scenery ?? []) {
      const obj = this.buildItem(it);
      if (!obj) continue;
      this.scene3.add(obj);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.max.y < 1.2) {
        const plain: THREE.Mesh[] = [];
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && !(m.material as THREE.MeshLambertMaterial).map) plain.push(m);
        });
        for (const m of plain) {
          m.userData.world = m.matrixWorld.clone();
          m.removeFromParent();
          low.push(m);
        }
        continue;
      }
      const mats: THREE.Material[] = [];
      obj.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) mats.push(...(Array.isArray(m) ? m : [m]));
      });
      for (const m of mats) m.transparent = true;
      const corners: THREE.Vector3[] = [];
      for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(cx, cy, cz));
      this.tall.push({ corners, mats, faded: false });
    }

    if (low.length) {
      const flat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this.scene3.add(this.mergeParts(low, flat));
    }

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 4), new THREE.MeshBasicMaterial({ color: COLORS.accent }));
    this.marker.rotation.x = Math.PI;
    this.scene3.add(this.marker);
    this.puffMap = this.softDot();

    // Rider numbers and the lap map draw over the 3D picture.
    this.labels = scene.add.container(0, 0);
    parent.add(this.labels);
    const mw = 190;
    const mk = mw / GRID_W;
    this.mapBox = { x: x + w - mw - 12, y: y + 12, k: mk };
    const mg = scene.add.graphics();
    mg.fillStyle(COLORS.ink, 0.85).fillRoundedRect(this.mapBox.x - 6, this.mapBox.y - 6, mw + 12, GRID_H * mk + 12, 6);
    mg.lineStyle(4, 0xc98a4b, 1);
    mg.beginPath();
    this.surface.g.pts.forEach((p, i) => (i ? mg.lineTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk) : mg.moveTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk)));
    mg.strokePath();
    if (this.surface.start.total > 0) {
      mg.lineStyle(3, 0xc98a4b, 1);
      mg.beginPath();
      this.surface.start.pts.forEach((p, i) => (i ? mg.lineTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk) : mg.moveTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk)));
      mg.strokePath();
    }
    const s0 = pointAt(this.surface.g, 0);
    mg.fillStyle(0xffffff, 1).fillRect(this.mapBox.x + s0.x * mk - 2, this.mapBox.y + s0.y * mk - 2, 4, 4);
    this.mapDots = scene.add.graphics();
    parent.add([mg, this.mapDots]);

    this.image.once('destroy', () => this.destroy());
    this.loadArt();
  }

  // ---- ground ----

  private loadArt(): void {
    const arts = [...new Set(this.parts.ground.map((p) => p.art).filter((a): a is string => !!a))];
    const missing = arts.filter((a) => !this.scene.textures.exists(`trackart:${a}`));
    if (!missing.length) return;
    for (const a of missing) this.scene.load.image(`trackart:${a}`, `${ART_DIR}/${a}.png`);
    this.scene.load.once('complete', () => {
      if (this.dead) return;
      this.drawGround();
      this.groundTex.needsUpdate = true;
    });
    this.scene.load.start();
  }

  /** The ground tiles painted in the editor, onto one big texture under the whole scene. */
  private drawGround(): void {
    const ctx = this.groundCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const ground = this.track.ground ?? { base: this.parts.ground[0]?.id ?? 'grass', cell: 2, paint: {} };
    const cell = ground.cell || 2;
    const painted = new Map<string, string>();
    for (const [id, cells] of Object.entries(ground.paint ?? {})) for (const [cx, cy] of cells) painted.set(`${cx},${cy}`, id);
    const px = TILE_PX / 2;
    for (let gy = -MARGIN; gy < GRID_H + MARGIN; gy += cell) {
      for (let gx = -MARGIN; gx < GRID_W + MARGIN; gx += cell) {
        const id = painted.get(`${Math.floor(gx / cell)},${Math.floor(gy / cell)}`) ?? ground.base;
        const def = this.parts.ground.find((g) => g.id === id);
        const key = def?.art && this.scene.textures.exists(`trackart:${def.art}`) ? `trackart:${def.art}` : null;
        const sx = (gx + MARGIN) * px;
        const sy = (gy + MARGIN) * px;
        if (key) ctx.drawImage(this.scene.textures.get(key).getSourceImage() as CanvasImageSource, sx, sy, cell * px, cell * px);
        else {
          ctx.fillStyle = def?.color ?? '#5f8f3c';
          ctx.fillRect(sx, sy, cell * px, cell * px);
        }
      }
    }
  }

  // ---- the land ----

  /**
   * Heights of the ground round the track: hills on the lap rise out of the grass with gentle
   * slopes, and the ground stays flat next to the rest of the track.
   */
  private buildTerrain(): void {
    const s = this.surface;
    const tw = GRID_W + 2 * MARGIN + 1;
    const th = GRID_H + 2 * MARGIN + 1;
    this.terrain = new Float32Array(tw * th);
    const hills: { x: number; z: number; e: number }[] = [];
    const flats: { x: number; z: number }[] = [];
    const n = Math.ceil(s.g.total / 0.5);
    for (let i = 0; i < n; i++) {
      const f = i / n;
      const p = s.spot(f, 0);
      const e = s.centre(f);
      if (s.onHill(f) && e > 0.05) hills.push({ x: p.x, z: p.z, e });
      else flats.push({ x: p.x, z: p.z });
    }
    // The start straight stays level too, with the ground easing down to it over a few grid units.
    const level: { x: number; z: number; r: number }[] = [];
    for (let u = -START_PAD; u < s.start.total; u += 0.5) {
      const p = startPointAt(s.start, u);
      level.push({ x: p.x, z: p.y, r: s.startHw(u) * LIP_AT + 0.4 });
    }
    if (!hills.length) return;
    const r0 = s.hw * 1.3;
    const smooth = (x: number) => {
      const t = Math.max(0, Math.min(1, x));
      return t * t * (3 - 2 * t);
    };
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const x = i - MARGIN;
        const z = j - MARGIN;
        let h = 0;
        for (const q of hills) {
          const r1 = r0 + q.e * 3;
          const d = Math.hypot(x - q.x, z - q.z);
          if (d < r1) h = Math.max(h, (q.e - 0.06) * (1 - smooth((d - r0) / (r1 - r0))));
        }
        if (h <= 0) continue;
        for (const q of flats) {
          const d = Math.hypot(x - q.x, z - q.z);
          if (d < r0 + 1.5) h *= smooth((d - r0) / 1.5);
        }
        for (const q of level) {
          const d = Math.hypot(x - q.x, z - q.z);
          if (d < q.r + 5) h *= smooth((d - q.r) / 5);
        }
        this.terrain[j * tw + i] = h;
      }
    }
  }

  /** Ground height at a point on the grid. */
  terrainAt(x: number, z: number): number {
    const tw = GRID_W + 2 * MARGIN + 1;
    const th = GRID_H + 2 * MARGIN + 1;
    const gx = Math.max(0, Math.min(tw - 1.001, x + MARGIN));
    const gz = Math.max(0, Math.min(th - 1.001, z + MARGIN));
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const t = this.terrain;
    const a = t[j * tw + i] * (1 - fx) + t[j * tw + i + 1] * fx;
    const b = t[(j + 1) * tw + i] * (1 - fx) + t[(j + 1) * tw + i + 1] * fx;
    return a * (1 - fz) + b * fz - 0.01;
  }

  /** The ground as one mesh, shaped by the terrain and painted with the editor's ground tiles. */
  private terrainMesh(): THREE.Mesh {
    const tw = GRID_W + 2 * MARGIN + 1;
    const th = GRID_H + 2 * MARGIN + 1;
    const pos: number[] = [];
    const uv: number[] = [];
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        pos.push(i - MARGIN, this.terrain[j * tw + i] - 0.01, j - MARGIN);
        uv.push(i / (tw - 1), 1 - j / (th - 1));
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < th - 1; j++) {
      for (let i = 0; i < tw - 1; i++) {
        const a = j * tw + i;
        idx.push(a, a + tw, a + 1, a + 1, a + tw, a + tw + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.groundTex }));
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---- the track ----

  private patchAt(f: number): number | null {
    for (const p of this.patchSpans) if ((f >= p.from && f <= p.to) || (p.to > 1 && f <= p.to - 1)) return p.color;
    return null;
  }

  /** The racing surface, its lips and its earth banks, as one solid mesh round the lap. */
  private buildTrack(): THREE.Mesh {
    const s = this.surface;
    const rows = Math.max(400, Math.ceil(s.g.total / 0.2));
    // Across the track: bank foot, bank middle, lip, the racing surface, lip, bank middle, bank foot.
    const inner = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
    const cols = 4 + inner.length + 2;
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const base = SURFACES[this.track.surface] ?? 0xb07a45;
    const c = new THREE.Color();
    for (let i = 0; i < rows; i++) {
      const f = i / rows;
      const skL = s.skirt(f, -1);
      const skR = s.skirt(f, 1);
      const lanes = [-(LIP_AT + skL), -(LIP_AT + skL * 0.45), -LIP_AT, ...inner, LIP_AT, LIP_AT + skR * 0.45, LIP_AT + skR];
      const patch = this.patchAt(f);
      const grain = 0.94 + 0.1 * noise(i);
      lanes.forEach((lane, j) => {
        const p = s.spot(f, lane);
        const foot = j === 0 || j === cols - 1;
        pos.push(p.x, foot ? this.terrainAt(p.x, p.z) : Math.max(s.height(f, lane), this.terrainAt(p.x, p.z) + 0.02), p.z);
        // The dirt texture runs along the lap, one repeat every 4 grid units.
        uv.push((f * s.g.total) / 4, (lane + 2) / 4);
        let color: number;
        const open = s.mouth(f, lane < 0 ? -1 : 1);
        if (Math.abs(lane) <= 1 || open > 0.5) color = shade(patch ?? base, grain * (0.97 + 0.06 * noise(i * 31 + j)));
        else if (Math.abs(lane) <= LIP_AT + 1e-6) color = shade(patch ?? base, 0.82 * grain);
        else color = shade(base, foot ? 0.62 : 0.72);
        c.setHex(color);
        col.push(c.r, c.g, c.b);
      });
    }
    const idx: number[] = [];
    for (let i = 0; i < rows; i++) {
      const a = i * cols;
      const b = ((i + 1) % rows) * cols;
      for (let j = 0; j < cols - 1; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: this.dirtTexture(), side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /**
   * The start straight: its own strip of track from the start pad behind the gate to where it
   * runs into the lap, with lips that run out as it joins. Where it runs onto the lap it sinks a
   * few millimetres, under the lap's surface but above the grass, so the two meet without a seam.
   */
  private buildStart(): THREE.Mesh {
    const s = this.surface;
    const st = s.start;
    const rows = Math.max(40, Math.ceil((st.total + START_PAD) / 0.2));
    const inner = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
    const cols = 4 + inner.length + 2;
    const pos: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const base = SURFACES[this.track.surface] ?? 0xb07a45;
    const c = new THREE.Color();
    const merge = st.total - (s.hw * 2.5 + 1);
    for (let i = 0; i <= rows; i++) {
      const u = -START_PAD + ((st.total + START_PAD) * i) / rows;
      const dip = 0.006 * Math.max(0, Math.min(1, (u - merge) / 0.5));
      const lip = s.startHeight(u, LIP_AT);
      const sk = Math.max(0.35, lip * 0.9) / s.startHw(u);
      const lanes = [-(LIP_AT + sk), -(LIP_AT + sk * 0.45), -LIP_AT, ...inner, LIP_AT, LIP_AT + sk * 0.45, LIP_AT + sk];
      const grain = 0.94 + 0.1 * noise(i + 977);
      // Concrete under the gate and the line-up, dirt from just past the gate.
      const pad = u < 0.9;
      lanes.forEach((lane, j) => {
        const p = s.startSpot(u, lane);
        const foot = j === 0 || j === cols - 1;
        pos.push(p.x, foot ? this.terrainAt(p.x, p.z) : Math.max(s.startHeight(u, lane), this.terrainAt(p.x, p.z) + 0.02) - dip, p.z);
        uv.push(u / 4, (lane + 2) / 4);
        let color: number;
        if (Math.abs(lane) <= 1) color = pad ? shade(0xa8a49a, 0.95 + 0.06 * noise(i * 7 + j)) : shade(base, grain * (0.97 + 0.06 * noise(i * 31 + j)));
        else if (Math.abs(lane) <= LIP_AT + 1e-6) color = shade(base, 0.82 * grain);
        else color = shade(base, foot ? 0.62 : 0.72);
        c.setHex(color);
        col.push(c.r, c.g, c.b);
      });
    }
    const idx: number[] = [];
    for (let i = 0; i < rows; i++) {
      const a = i * cols;
      const b = (i + 1) * cols;
      for (let j = 0; j < cols - 1; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: this.dirtTexture(), side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /** The start gate across the start straight, just ahead of the line-up. */
  private startGate(): THREE.Object3D {
    const s = this.surface;
    const at = startPointAt(s.start, 0.75);
    const ang = s.startSpot(0.75, 0).ang;
    const d = 1;
    const gate = this.buildItem({ type: 'start_gate', x: at.x, y: at.y, w: 2 * s.startHw(0.75) * LIP_AT + 0.4, h: d, rot: (ang * 180) / Math.PI + 90 })!;
    gate.position.y = s.startHeight(0.75, 0);
    // Everything above the base (the pickets and their rail) hangs on a hinge along the base's
    // front edge, so the whole row falls forward onto the track at the drop.
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.12, -d * 0.3 - 0.04);
    for (const part of gate.children.slice(1)) {
      part.position.y -= 0.12;
      part.position.z -= hinge.position.z;
      hinge.add(part);
    }
    gate.add(hinge);
    this.gateDrop = hinge;
    return gate;
  }

  /**
   * The start board: an official beside the start straight, ahead of the gate on the side where
   * it joins the lap, holding the board up to the riders. Shown from five seconds out, turned
   * sideways at three, gone at the drop (updateStart). Its face is printed both sides so the
   * camera reads it whichever way it faces the riders.
   */
  private startBoard(): THREE.Object3D {
    const s = this.surface;
    const st = s.start;
    const side = s.joinSide || 1;
    const merge = st.total - (s.hw * 2.5 + 1);
    // Ahead of the gate, as near 8 units out as there is room for, in the grass between the start
    // straight and the lap (or on the far side if that strip is too narrow), clear of scenery.
    let best: { x: number; z: number; ang: number; score: number } | null = null;
    for (let u = 4; u <= Math.max(4, merge); u += 0.5) {
      for (const sd of [side, -side]) {
        const edge = s.startHw(u) * LIP_AT;
        for (const out of [2.2, 1.8, 1.5]) {
          const p = s.startSpot(u, (sd * (edge + out)) / s.startHw(u));
          const lapGap = nearestOnLap(s.g, p.x, p.z).d - s.hw * LIP_AT;
          const clutter = (this.track.scenery ?? []).some((it) => Math.hypot(it.x - p.x, it.y - p.z) < 1.4 + Math.max(it.w ?? 0, it.h ?? 0) / 2);
          if (lapGap < 1.1 || clutter) continue;
          const score = Math.abs(u - 8) + (sd === side ? 0 : 3) + (2.2 - out);
          if (!best || score < best.score) best = { x: p.x, z: p.z, ang: p.ang, score };
          break;
        }
      }
    }
    const spot = best ?? { ...s.startSpot(6, (side * (s.startHw(6) * LIP_AT + 1.5)) / s.startHw(6)), score: 0 };
    const stand = new THREE.Group();
    stand.position.set(spot.x, this.terrainAt(spot.x, spot.z), spot.z);
    // Face the camera, so the player reads the board, turned just a touch back towards the riders
    // (the face is printed on both sides, so the riders see it too).
    const camAz = THREE.MathUtils.degToRad(CAM_AZ);
    const toRiders = Math.atan2(-Math.cos(spot.ang), -Math.sin(spot.ang));
    const toCam = camAz;
    let turn = toCam - toRiders;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    stand.rotation.y = toRiders + turn * 0.85;
    // The official: legs, body, head, arms up to the board.
    const kit = this.mat(0x2a3a5a);
    const skin = this.mat(0xe0b090);
    stand.add(this.boxMesh(0.12, 0.7, 0.14, kit, -0.1, 0, 0), this.boxMesh(0.12, 0.7, 0.14, kit, 0.1, 0, 0));
    stand.add(this.boxMesh(0.42, 0.62, 0.24, this.mat(0xf0a020), 0, 0.7, 0));
    stand.add(this.boxMesh(0.22, 0.22, 0.22, skin, 0, 1.34, 0));
    stand.add(this.boxMesh(0.09, 0.8, 0.09, skin, -0.3, 1.35, 0.04), this.boxMesh(0.09, 0.8, 0.09, skin, 0.3, 1.35, 0.04));
    // The board, held above the head; it turns in its own plane about its centre.
    const panel = new THREE.Group();
    panel.position.set(0, 2.45, 0.12);
    const face = new THREE.MeshLambertMaterial({ map: this.boardTexture() });
    const W = 1.8;
    const H = 1.35;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), face);
    front.position.z = 0.03;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), face);
    back.rotation.y = Math.PI;
    back.position.z = -0.03;
    const core = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.05), this.mat(0xdedede));
    for (const m of [front, back, core]) m.castShadow = true;
    panel.add(core, front, back);
    stand.add(panel);
    stand.visible = false;
    this.board = { stand, panel };
    return stand;
  }

  /** The start board's face: START over a big red 30, as held up at the gate. */
  private boardTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 192;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(0, 0, 256, 192);
    ctx.fillStyle = '#2f5d73';
    ctx.fillRect(0, 0, 256, 50);
    ctx.fillRect(0, 160, 256, 32);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px Trebuchet MS, sans-serif';
    ctx.fillText('START', 128, 27);
    ctx.fillStyle = '#d42a20';
    ctx.font = 'bold 116px Trebuchet MS, sans-serif';
    ctx.fillText('30', 128, 108);
    // Hand holds.
    ctx.fillStyle = '#c8c8c0';
    for (const x of [26, 230]) ctx.fillRect(x - 8, 88, 16, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * The start procedure as race time runs up to the gate drop at 0 (riderAI START_HOLD): the
   * board is held up square from five seconds out, turned sideways at three, and taken away at
   * the drop, when the gate's pickets fall flat. Purely a function of the clock, so scrubbing or
   * a new race always shows the right state.
   */
  private updateStart(clock: number): void {
    if (this.board) {
      this.board.stand.visible = clock >= -5 && clock < 0;
      this.board.panel.rotation.z = clock >= -3 ? Math.PI / 2 : 0;
    }
    if (this.gateDrop) this.gateDrop.rotation.x = -(Math.PI / 2) * Math.max(0, Math.min(1, clock / 0.3)) ** 2;
  }

  /**
   * Grey-scale dirt that the track's colours are multiplied by: clods and stones, and the dark
   * grooves riders cut along the racing line.
   */
  private dirtTexture(): THREE.CanvasTexture {
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // v (y) runs across the track: the racing surface is the middle half of the texture.
        const across = y / size;
        const groove = Math.abs(Math.sin(across * Math.PI * 9)) < 0.18 && across > 0.27 && across < 0.73 ? 0.86 : 1;
        const grain = 0.86 + 0.14 * noise(x * 131 + y * 17) + 0.06 * Math.sin(x * 0.4 + noise(y) * 6);
        const v = Math.max(0, Math.min(255, Math.round(255 * grain * groove)));
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    // A few stones and clods.
    for (let k = 0; k < 90; k++) {
      const x = Math.floor(noise(k * 3.1) * size);
      const y = Math.floor(noise(k * 7.7) * size);
      const v = noise(k * 1.3) > 0.5 ? 255 : 150;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = (((y + dy) % size) * size + ((x + dx) % size)) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** The chequered start and finish line, laid on the surface. */
  private startLine(): THREE.Mesh {
    const s = this.surface;
    const cv = document.createElement('canvas');
    cv.width = 16;
    cv.height = 4;
    const ctx = cv.getContext('2d')!;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#ffffff' : '#14141e';
      ctx.fillRect(i * 2, j * 2, 2, 2);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pos: number[] = [];
    const uv: number[] = [];
    const df = 0.7 / s.g.total;
    for (const [r, f] of [[0, 0], [1, df]]) {
      for (let j = 0; j <= 8; j++) {
        const lane = -1 + j / 4;
        const p = s.spot(f, lane);
        pos.push(p.x, s.height(f, lane) + 0.03, p.z);
        uv.push(j / 8, r);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < 8; j++) idx.push(j, j + 9, j + 1, j + 1, j + 9, j + 10);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---- scenery ----

  private mat(color: number, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color, ...extra });
  }

  private boxMesh(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private textTexture(text: string, bg: number, fg = '#ffffff', w = 256, h = 48): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `bold ${Math.round(h * 0.62)}px Trebuchet MS, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fit = Math.min(1, (w * 0.92) / Math.max(1, ctx.measureText(text).width));
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(fit, 1);
    ctx.fillText(text, 0, 2);
    ctx.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** Builds one scenery item as 3D shapes standing on the ground. */
  private buildItem(it: SceneryItem): THREE.Object3D | null {
    const def = this.parts.scenery.find((s) => s.id === it.type);
    const w = it.w ?? def?.w ?? 2;
    const d = it.h ?? def?.h ?? 2;
    const color = hex(it.color ?? def?.color, 0x888888);
    const text = it.text ?? def?.text ?? '';
    const g = new THREE.Group();
    g.position.set(it.x, this.terrainAt(it.x, it.y), it.y);
    g.rotation.y = -(((it.rot ?? 0) * Math.PI) / 180);
    const add = (o: THREE.Object3D) => g.add(o);
    switch (it.type) {
      case 'banner':
      case 'sponsor_board': {
        const H = it.type === 'banner' ? 1 : 1.3;
        const face = this.mat(0xffffff, { map: this.textTexture(text, color) });
        const side = this.mat(shade(color, 0.7));
        add(this.boxMesh(w, H, 0.1, [side, side, side, side, face, face], 0, 0.35, 0));
        for (const sx of [-0.45, 0.45]) add(this.boxMesh(0.08, 0.35, 0.08, this.mat(0x5a5a60), sx * w, 0, 0));
        break;
      }
      case 'finish_arch': {
        for (const sx of [-1, 1]) add(this.boxMesh(0.5, 4.2, 0.5, this.mat(0xd8d8d8), sx * (w / 2 - 0.25), 0, 0));
        const face = this.mat(0xffffff, { map: this.textTexture(text || 'FINISH', color) });
        const side = this.mat(shade(color, 0.8));
        add(this.boxMesh(w, 0.9, 0.35, [side, side, side, side, face, face], 0, 4.2, 0));
        break;
      }
      case 'start_gate': {
        add(this.boxMesh(w, 0.12, d, this.mat(0x8a8a8a)));
        const n = Math.max(2, Math.round(w / 1.6));
        for (let i = 0; i < n; i++) add(this.boxMesh((w / n) * 0.82, 0.55, 0.08, this.mat(0x5a5a60), -w / 2 + (w / n) * (i + 0.5), 0.12, -d * 0.3));
        add(this.boxMesh(w, 0.18, 0.18, this.mat(color), 0, 0.67, -d * 0.4));
        break;
      }
      case 'tuff_block': {
        // White blocks with red bands, the supercross track marker.
        add(this.boxMesh(w, 0.5, d * 0.8, this.mat(color)));
        for (let i = 0; i < 3; i++) add(this.boxMesh(w / 7, 0.52, d * 0.82, this.mat(0xd33a2c), -w / 2 + (w / 3) * (i + 0.5), -0.01, 0));
        break;
      }
      case 'hay_bale':
        add(this.boxMesh(w, 0.6, d, this.mat(color)));
        break;
      case 'tyre_wall': {
        const n = Math.max(1, Math.round(w / Math.max(0.5, d)));
        const r = Math.min(w / n, d) / 2;
        const geo = new THREE.CylinderGeometry(r, r, 0.3, 12);
        for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) {
          const t = new THREE.Mesh(geo, this.mat(color));
          t.position.set(-w / 2 + (w / n) * (i + 0.5), 0.15 + k * 0.3, 0);
          t.castShadow = true;
          add(t);
        }
        break;
      }
      case 'tape': {
        const posts = Math.max(1, Math.round(w / 2));
        for (let i = 0; i <= posts; i++) add(this.boxMesh(0.06, 0.65, 0.06, this.mat(0x5a5a60), -w / 2 + (w * i) / posts, 0, 0));
        add(this.boxMesh(w, 0.05, 0.02, this.mat(color), 0, 0.55, 0));
        break;
      }
      case 'flag_post': {
        add(this.boxMesh(0.08, 2.4, 0.08, this.mat(0xdddddd)));
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), this.mat(color, { side: THREE.DoubleSide }));
        flag.position.set(0.4, 2.15, 0);
        flag.castShadow = true;
        add(flag);
        break;
      }
      case 'stand': {
        // Seating steps rising away from the track, with a row of fans on each.
        const away = this.awayFromTrack(it);
        const tiers = 4;
        for (let i = 0; i < tiers; i++) {
          const z = (-d / 2 + (d / tiers) * (i + 0.5)) * away;
          const hh = 0.7 + i * 0.75;
          add(this.boxMesh(w, hh, d / tiers, this.mat(i % 2 ? shade(color, 1.12) : color), 0, 0, z));
          this.fans(g, w * 0.96, d / tiers * 0.5, 0, hh, z, Math.round(w * 1.3), i);
        }
        add(this.boxMesh(w, 0.3, 0.2, this.mat(0x4a4a50), 0, 0.7 + tiers * 0.75, (d / 2) * away));
        break;
      }
      case 'crowd':
        this.fans(g, w, d, 0, 0, 0, Math.round(w * d * 1.4), 7);
        break;
      case 'pit_tent': {
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(this.boxMesh(0.08, 1.9, 0.08, this.mat(0xcccccc), (sx * w) / 2.1, 0, (sz * d) / 2.1));
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2, 0.9, 4), this.mat(color));
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(w / Math.hypot(w, d) * 1.414, 1, d / Math.hypot(w, d) * 1.414);
        roof.position.set(0, 2.35, 0);
        roof.castShadow = true;
        add(roof);
        add(this.boxMesh(w, 0.25, d, this.mat(shade(color, 0.9)), 0, 1.65, 0));
        break;
      }
      case 'van': {
        add(this.boxMesh(w * 0.72, 1.7, d * 0.9, this.mat(color), -w * 0.14, 0.3, 0));
        add(this.boxMesh(w * 0.26, 1.2, d * 0.9, this.mat(shade(color, 0.95)), w * 0.36, 0.3, 0));
        add(this.boxMesh(0.05, 0.5, d * 0.7, this.mat(0x223344), w * 0.495, 0.85, 0));
        const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12);
        for (const [sx, sz] of [[-0.3, -1], [-0.3, 1], [0.32, -1], [0.32, 1]]) {
          const t = new THREE.Mesh(wheel, this.mat(0x1c1c22));
          t.rotation.x = Math.PI / 2;
          t.position.set(sx * w, 0.32, (sz * d * 0.9) / 2);
          add(t);
        }
        break;
      }
      case 'light_tower': {
        add(this.boxMesh(0.25, 7.5, 0.25, this.mat(0x6a6a70)));
        add(this.boxMesh(w * 0.9, 0.7, 0.35, this.mat(0x3a3a40), 0, 7.5, 0));
        add(this.boxMesh(w * 0.8, 0.5, 0.05, new THREE.MeshBasicMaterial({ color: 0xfff6c0 }), 0, 7.6, 0.2));
        break;
      }
      case 'tree': {
        add(this.boxMesh(0.35, 1.6, 0.35, this.mat(0x6a4a2a)));
        const leaf = this.mat(color, { flatShading: true });
        for (const [r, y, ox] of [[w * 0.42, 2.3, 0], [w * 0.32, 3.2, 0.2], [w * 0.28, 2.5, -0.5]]) {
          const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leaf);
          ball.position.set(ox, y, ox * 0.5);
          ball.castShadow = true;
          ball.receiveShadow = true;
          add(ball);
        }
        break;
      }
      case 'bush': {
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(w, d) * 0.45, 0), this.mat(color, { flatShading: true }));
        ball.position.y = Math.min(w, d) * 0.3;
        ball.scale.y = 0.75;
        ball.castShadow = true;
        add(ball);
        break;
      }
      case 'hedge':
        add(this.boxMesh(w, 1.1, d * 0.6, this.mat(color, { flatShading: true })));
        break;
      case 'fence':
        for (const sx of [-0.45, 0, 0.45]) add(this.boxMesh(0.1, 0.9, 0.1, this.mat(color), sx * w, 0, 0));
        for (const y of [0.35, 0.7]) add(this.boxMesh(w, 0.08, 0.06, this.mat(color), 0, y, 0));
        break;
      case 'barrels':
      case 'tyre_stack': {
        const geo = it.type === 'barrels' ? new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12) : new THREE.TorusGeometry(0.3, 0.13, 8, 14);
        const n = 3;
        for (let i = 0; i < n; i++) {
          const m = new THREE.Mesh(geo, this.mat(color));
          if (it.type === 'barrels') m.position.set((i - 1) * 0.7 * (w / 2), 0.45, 0);
          else {
            m.rotation.x = Math.PI / 2;
            m.position.set((i - 1) * 0.15, 0.13 + i * 0.26, 0);
          }
          m.castShadow = true;
          add(m);
        }
        break;
      }
      case 'skip':
        add(this.boxMesh(w, 1, d, this.mat(color)));
        break;
      default:
        add(this.boxMesh(w, 0.6, d, this.mat(color)));
    }
    return g;
  }

  /** Which way, along the item's depth, points away from the nearest bit of track: 1 or -1. */
  private awayFromTrack(it: SceneryItem): number {
    let best = Infinity;
    let near = { x: it.x, y: it.y };
    for (let i = 0; i < 400; i++) {
      const p = pointAt(this.surface.g, i / 400);
      const d = Math.hypot(p.x - it.x, p.y - it.y);
      if (d < best) {
        best = d;
        near = p;
      }
    }
    const a = ((it.rot ?? 0) * Math.PI) / 180;
    // The item's depth axis on the grid is (-sin a, cos a).
    const dot = (near.x - it.x) * -Math.sin(a) + (near.y - it.y) * Math.cos(a);
    return dot > 0 ? -1 : 1;
  }

  /** Spectators: small figures in many colours, standing on a patch of ground or a stand step. */
  private fans(g: THREE.Group, w: number, d: number, x: number, y: number, z: number, n: number, seed: number): void {
    const body = new THREE.BoxGeometry(0.22, 0.42, 0.18);
    const head = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const bodies = new THREE.InstancedMesh(body, this.mat(0xffffff), n);
    const heads = new THREE.InstancedMesh(head, this.mat(0xe8c0a0), n);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const px = x + (noise(i * 7 + seed * 13) - 0.5) * w;
      const pz = z + (noise(i * 11 + seed * 17) - 0.5) * d;
      m.makeTranslation(px, y + 0.21, pz);
      bodies.setMatrixAt(i, m);
      c.setHex(CROWD[Math.floor(noise(i * 3 + seed) * CROWD.length)]);
      bodies.setColorAt(i, c);
      m.makeTranslation(px, y + 0.5, pz);
      heads.setMatrixAt(i, m);
    }
    bodies.castShadow = true;
    g.add(bodies, heads);
  }

  // ---- riders ----

  /** A small motocross bike and rider in the rider's colour, facing +x, wheels on y = 0. */
  private makeBike(color: number, player: boolean): Bike {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const L = BIKE_LENGTH;
    const r = 0.22;
    const dark = this.mat(0x1c1c22);
    const paint = this.mat(color);
    const kit = this.mat(shade(color, 0.75));
    const parts: THREE.Mesh[] = [];
    const wheelGeo = new THREE.CylinderGeometry(r, r, 0.12, 14);
    for (const sx of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set((sx * L) / 2, r, 0);
      parts.push(wheel);
    }
    const piece = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z = 0, rz = 0) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      p.position.set(x, y, z);
      p.rotation.z = rz;
      parts.push(p);
      return p;
    };
    piece(L * 0.62, 0.1, 0.1, this.mat(0x9a9aa0), 0, r + 0.12, 0, 0.05); // frame
    piece(0.42, 0.14, 0.2, paint, 0.08, r + 0.3); // tank and seat
    piece(0.36, 0.08, 0.18, dark, -0.22, r + 0.32); // seat
    piece(0.07, 0.52, 0.06, this.mat(0xc0c0c8), L / 2 - 0.08, r + 0.22, 0.07, 0.35); // forks
    piece(0.07, 0.52, 0.06, this.mat(0xc0c0c8), L / 2 - 0.08, r + 0.22, -0.07, 0.35);
    piece(0.1, 0.2, 0.22, this.mat(0xf4f4f4), L / 2 - 0.02, r + 0.5, 0, 0.3); // number plate
    piece(0.42, 0.04, 0.14, paint, L / 2 - 0.12, r + 0.27, 0, -0.1); // front guard
    piece(0.3, 0.04, 0.14, paint, -L / 2 + 0.05, r + 0.3, 0, 0.25); // rear guard
    // Rider: legs, body leaning over the bars, arms and helmet.
    piece(0.34, 0.1, 0.1, kit, -0.04, r + 0.42, 0.13, -0.6);
    piece(0.34, 0.1, 0.1, kit, -0.04, r + 0.42, -0.13, -0.6);
    piece(0.2, 0.4, 0.28, paint, -0.02, r + 0.68, 0, -0.45);
    piece(0.36, 0.07, 0.07, kit, 0.2, r + 0.74, 0.15, 0.25);
    piece(0.36, 0.07, 0.07, kit, 0.2, r + 0.74, -0.15, 0.25);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), this.mat(player ? 0xffffff : shade(color, 1.15)));
    helmet.position.set(0.12, r + 0.98, 0);
    parts.push(helmet);
    piece(0.08, 0.06, 0.18, dark, 0.24, r + 0.97); // visor
    // One mesh per bike, coloured per part, so a field of bikes costs one draw each.
    body.add(this.mergeParts(parts));
    this.scene3.add(root);
    const label = this.scene.add.text(0, 0, '', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '13px', color: '#ffffff', fontStyle: 'bold', stroke: '#14141e', strokeThickness: 3, resolution: 2 }).setOrigin(0.5, 1);
    this.labels.add(label);
    return { root, body, label };
  }

  /** Bakes meshes (each with a plain coloured material) into one vertex-coloured, shadow-casting mesh. */
  private mergeParts(parts: THREE.Mesh[], material?: THREE.MeshLambertMaterial): THREE.Mesh {
    const geos = parts.map((p) => {
      p.updateMatrix();
      const g = (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone()).applyMatrix4((p.userData.world as THREE.Matrix4 | undefined) ?? p.matrix);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const c = (p.material as THREE.MeshLambertMaterial).color;
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos), material ?? new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (const g of geos) g.dispose();
    return mesh;
  }

  /** Draws the riders at their poses. clock is race time, dt real seconds since the last frame. */
  update(riders: ViewRider[], clock: number, dt: number, focus: string | null): void {
    if (this.dead) return;
    const t0 = performance.now();
    const dc = Math.max(0, Math.min(1, clock - this.lastClock));
    this.lastClock = clock;
    const s = this.surface;
    const blink = Math.floor(clock * 6) % 2 === 0;
    let target: THREE.Vector3 | null = null;
    for (const r of riders) {
      const p = r.pose;
      let b = this.bikes.get(p.id);
      if (!b) {
        b = this.makeBike(r.color, r.player);
        this.bikes.set(p.id, b);
      }
      let dist = p.dist;
      // The second start row waits a bike length behind the gate and closes up as the race starts.
      if (r.startRow && p.dist < s.start.join) dist -= (r.startRow * BIKE_LENGTH * 1.4 * Math.max(0, Math.min(1, 1 - clock / 2))) / s.g.total;
      const f = dist - Math.floor(dist);
      const onStart = s.onStart(dist);
      const [back, front] = s.wheelsAt(dist, p.lane, p.air);
      // Off the track (a rider who has pulled off) the wheels sit on the ground.
      for (const wh of [back, front]) wh.y = Math.max(wh.y, this.terrainAt(wh.x, wh.z));
      const mx = (back.x + front.x) / 2;
      const mz = (back.z + front.z) / 2;
      const my = (back.y + front.y) / 2;
      let yaw = Math.atan2(front.z - back.z, front.x - back.x);
      const run = Math.hypot(front.x - back.x, front.z - back.z);
      // A bike tips with the ground under its wheels, but never further than a steep jump face.
      const pitch = Math.max(-0.7, Math.min(0.7, Math.atan2(front.y - back.y, run)));
      // Lean into the corner, more the faster the bike.
      let lean = Math.max(-0.6, Math.min(0.6, s.curvatureAt(dist) * Math.min(p.speed, 20) * 0.9));
      if (p.state === 'wobble') yaw += 0.35 * Math.sin(clock * 16);
      b.root.position.set(mx, my, mz);
      b.root.rotation.set(0, -yaw, 0);
      b.body.rotation.set(0, 0, 0);
      b.body.position.set(0, 0, 0);
      if (p.state === 'crashed') {
        // Down on its side, sliding.
        b.body.rotation.set(Math.PI / 2.2, 0, 0);
        b.body.position.set(0, 0.12, 0);
        lean = 0;
      } else {
        b.body.rotation.z = pitch;
        b.body.rotation.x = lean;
      }
      b.root.visible = !(p.state === 'remount' && !blink);
      if (p.id === focus) target = new THREE.Vector3(mx, my, mz);
      if (r.player) this.marker.position.set(mx, my + 1.75 + 0.08 * Math.sin(clock * 4), mz);
      b.label.setText(r.player ? '' : r.label).setVisible(!r.player && p.state !== 'retired');
      // Dust off the back wheel.
      if (dc > 0 && p.speed > 6 && p.air < 0.15 && p.state === 'riding' && Math.abs(p.lane) <= 1) {
        const n = Math.min(2, dc * p.speed * 0.12);
        const water = !onStart && this.patchAt(f) === 0x4a86c0;
        for (let k = 0; k < n || (k === 0 && noise(clock * 977 + mx) < n); k++) this.puff(back.x, back.y + 0.1, back.z, water ? 0xdff0ff : 0xcaa478);
      }
    }
    this.agePuffs(Math.min(1, dc * 1.4 + dt * 0.3));
    this.updateStart(clock);
    if (!riders.some((r) => r.player && r.pose.state !== 'retired')) this.marker.visible = false;
    else this.marker.visible = true;
    this.moveCamera(target, dt);
    this.fadeBlockers(riders);
    const r0 = performance.now();
    this.renderer.render(this.scene3, this.camera);
    const r1 = performance.now();
    this.texture.source[0].update();
    this.renderMs.push(r1 - r0);
    this.uploadMs.push(performance.now() - r1);
    if (this.renderMs.length > 600) {
      this.renderMs.shift();
      this.uploadMs.shift();
    }
    this.placeLabels(riders);
    this.drawMap(riders);
    this.frameMs.push(performance.now() - t0);
    if (this.frameMs.length > 600) this.frameMs.shift();
  }

  private softDot(): THREE.Texture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const ctx = cv.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(cv);
  }

  /** A puff of dust (or spray): one of a pool of camera-facing quads drawn in a single batch. */
  private puff(x: number, y: number, z: number, color: number): void {
    if (!this.dust) {
      const mat = new THREE.MeshBasicMaterial({ map: this.puffMap, transparent: true, opacity: 0.5, depthWrite: false });
      this.dust = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, DUST);
      this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.dust.frustumCulled = false;
      const c = new THREE.Color(0xffffff);
      for (let i = 0; i < DUST; i++) {
        this.dust.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        this.dust.setColorAt(i, c);
      }
      this.scene3.add(this.dust);
    }
    const i = this.puffNext;
    this.puffNext = (i + 1) % DUST;
    this.puffs[i] = { x: x + (noise(x * 91) - 0.5) * 0.2, y, z: z + (noise(z * 37) - 0.5) * 0.2, life: 1 };
    this.dust.setColorAt(i, new THREE.Color(color));
    this.dust.instanceColor!.needsUpdate = true;
  }

  private agePuffs(k: number): void {
    if (!this.dust) return;
    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    this.puffs.forEach((p, i) => {
      if (!p || p.life <= 0) return;
      p.life -= k;
      p.y += k * 0.3;
      // Grows as it drifts up, then shrinks away as it fades.
      const size = p.life > 0 ? (0.35 + (1 - p.life) * 0.9) * Math.min(1, p.life * 3) : 0;
      this.dust!.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), face, sc.set(size, size, size)));
    });
    this.dust.instanceMatrix.needsUpdate = true;
  }

  private moveCamera(target: THREE.Vector3 | null, dt: number): void {
    const want = target ?? this.cam ?? (() => {
      const p = this.surface.place(this.surface.start.from, 0);
      return new THREE.Vector3(p.x, 0, p.z);
    })();
    if (!this.cam || want.distanceTo(this.cam) > this.viewUnits) this.cam = want.clone();
    else this.cam.lerp(want, 1 - Math.exp(-dt * 9));
    this.camera.position.copy(this.cam).addScaledVector(this.dir, 120);
    this.camera.lookAt(this.cam);
    // The sun follows the camera so shadows near the action stay sharp.
    this.sun.position.copy(this.cam).add(new THREE.Vector3(-30, 60, -12));
    this.sun.target.position.copy(this.cam);
  }

  /** Fades tall scenery standing between the camera and any rider. */
  private fadeBlockers(riders: ViewRider[]): void {
    this.camera.updateMatrixWorld();
    const spots = riders.map((r) => this.bikes.get(r.pose.id)).filter((b): b is Bike => !!b).map((b) => b.root.position.clone().add(new THREE.Vector3(0, 0.5, 0)).project(this.camera));
    for (const t of this.tall) {
      const ps = t.corners.map((c) => c.clone().project(this.camera));
      const x0 = Math.min(...ps.map((p) => p.x));
      const x1 = Math.max(...ps.map((p) => p.x));
      const y0 = Math.min(...ps.map((p) => p.y));
      const y1 = Math.max(...ps.map((p) => p.y));
      const near = Math.min(...ps.map((p) => p.z));
      const hides = x1 > -1 && x0 < 1 && y1 > -1 && y0 < 1 && spots.some((p) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1 && p.z > near);
      if (hides === t.faded) continue;
      t.faded = hides;
      for (const m of t.mats) {
        m.opacity = hides ? 0.28 : 1;
        m.depthWrite = !hides;
      }
    }
  }

  /** Where a 3D point is on the race screen, or null when it is outside the view. */
  private toScreen(v: THREE.Vector3): { x: number; y: number } | null {
    const p = v.clone().project(this.camera);
    if (p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1) return null;
    return { x: this.x + ((p.x + 1) / 2) * this.w, y: this.y + ((1 - p.y) / 2) * this.h };
  }

  private placeLabels(riders: ViewRider[]): void {
    for (const r of riders) {
      const b = this.bikes.get(r.pose.id);
      if (!b || !b.label.visible) continue;
      const at = this.toScreen(b.root.position.clone().add(new THREE.Vector3(0, 1.45, 0)));
      if (at) b.label.setPosition(at.x, at.y);
      else b.label.setVisible(false);
    }
  }

  private drawMap(riders: ViewRider[]): void {
    const g = this.mapDots;
    const box = this.mapBox;
    g.clear();
    const order = [...riders].sort((a, b) => Number(a.player) - Number(b.player));
    for (const r of order) {
      if (r.pose.state === 'retired') continue;
      const q = this.surface.place(r.pose.dist, 0);
      const p = { x: q.x, y: q.z };
      g.fillStyle(r.color, 1).fillCircle(box.x + p.x * box.k, box.y + p.y * box.k, r.player ? 4 : 2.6);
      if (r.player) g.lineStyle(1.5, 0xffffff, 1).strokeCircle(box.x + p.x * box.k, box.y + p.y * box.k, 4);
    }
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.scene3.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshLambertMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}
