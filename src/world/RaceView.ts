import { ARCH_AT, ARCH_CLEAR } from '../core/jumps';
import Phaser from 'phaser';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneryItem, TrackDef } from '../core/race';
import { LOOP_RISE, START_HOLD, type RiderPose, type RiderState } from '../core/riderAI';
import { CHEER_ITEM, CHEER_RANGE, CHEER_WALK, cheerAction, cheerColour, cheerRoute, cheerTiming, cheerVariant, REACT_SECONDS, VARIANT_SCALE, type CheerAction } from '../core/cheer';
import { alongRoute, OFFICIAL_ITEM, OFFICIAL_SCALE, officialPlan, placedOfficial, routeLength, walkProgress, BOARD_MOVE, BOARD_SIDEWAYS, WALK_FROM, WALK_TO, type OfficialSpot } from '../core/startOfficial';
import { gridOf, hiddenSpans, isSprint, NO_TURN_LANES, NO_TURN_PLATFORM, lapMetres, nearestOnLap, pointAt, RETURN_LANE, START_PAD, startPointAt } from '../core/trackGeom';
import { DEFAULT_TRACK_WIDTH, trackKind, type SceneryDef, type TrackPartsData } from '../core/trackParts';
import { archSpan, SPANS_TRACK, sprintPlace, SPRINT_START_ITEM, SurfaceIndex, surfacePoints } from '../core/trackClearance';
import { BIKE_LENGTH, CAM_AZ, LIP_AT, LOGS_AT, TrackSurface, type Flight } from '../core/trackSurface';
import { downPhase } from '../core/crashRecovery';
import { APPROACH as TRICK_APPROACH, trickPose, type Trick } from '../core/tricks';
import { COLORS, TEXT_RES } from '../ui/theme';
import { isPaddock } from '../core/paddock';
import { paddockParts, U as METRE } from './paddock';
import { FACES_TRACK, flaggerParts, marshalParts, pitCrewParts, starterBox, tracksideParts, type Label } from './trackside';
import { FIREWORK_LEAD, fireworkShow, fireworksDue, hasFireworks, ROCKET_RISE, type Rocket } from '../core/fireworks';
import { APPROACH, assignCrews, BOARD_PAST, boardOut, boardText, crewSpot, FLAGGER_ITEM, flagState, PIT_CREW_ITEM } from '../core/finishCrew';
import { flagUp, MARSHAL_ITEM, marshalWatch, watchFocus, type Watch } from '../core/marshal';
import { bikeColours, modelFor as bikeKind, raceBikeParts, type RaceLook } from './raceBike';
import { LOCKED_ITEMS } from '../core/modModels';
import { BIKE_PAINT, bikeModel, modModel, paintModel, RIDER_PAINT, riderModel } from './modModels';

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
const CAM_EL = 38;
/** Grid units across the view, by track kind. Riders stay big enough to follow at this size. */
const VIEW_UNITS: Record<string, number> = { stadium: 36, outdoor: 32, endurance: 32 };
/** Ground drawn round the grid (100 × 60, or a No-Turn Takedown's 200 × 30), in grid units. */
const MARGIN = 24;
// The bank at each edge of the track runs a little past its foot and a little under the ground, so
// where the ground slopes away from a raised track its triangles (drawn flat between lattice points)
// never show through the bank.
const FOOT_OUT = 1.25;
const FOOT_BURY = 0.15;
const TILE_PX = 32;
const ART_DIR = 'assets/art/area-map/tiled/tiles';
const SURFACES: Record<string, number> = { hard_pack: 0xb07a45, loam: 0x8a5a33, sand: 0xd8c07a, mud: 0x6b4a2b, concrete: 0x9c9c96 };
const CROWD = [0xc0607a, 0xe0c060, 0x60a0e0, 0xf0f0f0, 0x80c080, 0xe08040, 0x9070c0];

let counter = 0;
const TRICK_PIVOT = new THREE.Vector3();
const LOOP_AXLE = new THREE.Vector3();
const LOOP_TMP = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();
const ORIGIN = new THREE.Vector3();

export interface ViewRider {
  pose: RiderPose;
  color: number;
  /** Running position, shown over the rider. */
  label: string;
  player: boolean;
  /** Start row (0 at the gate, 1 just behind), for the line-up. */
  startRow?: number;
  /** Brand and gear colours for the race-day bike and rider (raceBike.ts). */
  look?: RaceLook;
}

/** A marshal in the scene (marshalFigure, updateMarshals): the figure leans and the arm swings the flag up while a rider is down on their watch. */
interface Marshal {
  watch: Watch;
  figure: THREE.Group;
  arm: THREE.Mesh;
  /** 0 flag down, 1 up and waving; eased between. */
  raise: number;
  phase: number;
}

/** The flag man in the scene (flaggerFigure, updateFinishCrew): the white flag up for the last lap, then the chequered flag. */
interface Flagger {
  spot: number;
  figure: THREE.Group;
  white: THREE.Mesh;
  chequered: THREE.Mesh;
  /** How far each flag is up: 0 down, 1 up; eased, the white coming down before the chequered goes up. */
  wk: number;
  ck: number;
  /** How far up a raised flag swings: overhead, or held out under the roof of a tower. */
  reach: number;
  phase: number;
}

/** A pit crew member in the scene (pitCrewFigure, updateFinishCrew): leans out with the board as their rider comes by. */
interface PitCrew {
  index: number;
  spot: number;
  figure: THREE.Group;
  arms: THREE.Mesh;
  board: THREE.Mesh;
  /** The board's offset from the shoulder before the arms swing, and the shoulder's from the feet (scene units). */
  boardAt: THREE.Vector3;
  shoulderAt: THREE.Vector3;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  text: string;
  rider: string | null;
  k: number;
}

/** A cheering fan in the scene (cheerFigure, updateCheers). */
export interface Cheer {
  i: number;
  group: THREE.Group;
  figure: THREE.Group;
  legs: THREE.Group[];
  arms: THREE.Group[];
  body: THREE.Mesh;
  action: CheerAction;
  route: { x: number; y: number }[];
  length: number;
  walked: number;
  facing: number;
  /** When they may next react (view seconds), when the current reaction began, and their own rest and delay. */
  restUntil: number;
  reactAt: number;
  rest: number;
  delay: number;
  phase: number;
}
interface Bike {
  root: THREE.Group;
  /** The bike itself. */
  body: THREE.Group;
  /** The rider, posed with the bike unless they have come off it (a loop-out). */
  rider: THREE.Group;
  /** Where the rider sat, in the bike's frame (their hips), for throwing them off. */
  seat: THREE.Vector3;
  /** Which side a rider who comes off lands, 1 or -1. */
  side: number;
  /** The rider's kit colours, for their figure on foot. */
  kit: Kit;
  /** The rider on foot after a crash (crashRecovery.ts), made the first time they need it. */
  runner?: Runner;
  label: Phaser.GameObjects.Text;
}

interface Kit {
  helmet: number;
  visor: number;
  jersey: number;
  pants: number;
  boot: number;
  glove: number;
}

/** A rider on foot: legs and arms swing at the hip and shoulder, the upper body bends at the hips. */
interface Runner {
  group: THREE.Group;
  upper: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
}

interface Puff {
  x: number;
  y: number;
  z: number;
  life: number;
}
/** Dust puffs alive at once. */
const DUST = 200;
/** Sparks in the finish fireworks' pool (updateFireworks). */
const SPARKS = 2400;
/** How big a firework spark looks, in grid units. */
const SPARK_SIZE = 0.55;

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
  /** The lap in metres, for distances along it in the race view (tricks). */
  private readonly lapMetres: number;
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
  /** The tops of each finish arch's two posts, where its fireworks go up from (updateFireworks). */
  private readonly archTops: [THREE.Vector3, THREE.Vector3][] = [];
  /** The finish fireworks as the winner finishes: the show and its clock once started, and the spark pool. */
  private fireworks: { show: Rocket[]; at: number; sparks: THREE.Points | null; pos: Float32Array; col: Float32Array; vel: Float32Array; life: Float32Array; full: Float32Array; base: Float32Array; free: number } | null = null;
  private readonly groundCanvas: HTMLCanvasElement;
  private readonly groundTex: THREE.CanvasTexture;
  private readonly mapDots: Phaser.GameObjects.Graphics;
  private mapFrame: Phaser.GameObjects.Graphics | null = null;
  private readonly mapBox: { x: number; y: number; k: number };
  private readonly viewUnits: number;
  private readonly dir: THREE.Vector3;
  private readonly bg: number;
  private cam: THREE.Vector3 | null = null;
  /** The ground, the track and the start straight: what a click in the track editor's race view lands on. */
  private readonly ground: THREE.Mesh[] = [];
  /**
   * Set only by the track editor's race view (TrackEditScene): the camera stays where the editor
   * puts it (centre, zoom, and turned `az` degrees from the race camera) instead of following a
   * rider. A race never sets it.
   */
  editCam: { x: number; z: number; zoom: number; az: number } | null = null;
  /**
   * Set only by the track editor's race view, for an unfinished track whose lap isn't closed yet:
   * the drawing past this fraction is the gap back to the start, which isn't drawn (no track, no
   * grading of the ground, no line on the lap map). 1 (all of it drawn) otherwise.
   */
  private readonly gapFrom: number;
  /** The stretches of the drawing that aren't track (fractions of it): the gap back to the start, and any gaps left between pieces of an unfinished track. */
  private readonly gaps: [number, number][];
  /** The grid's size in grid units (trackGeom gridOf). */
  private readonly gw: number;
  private readonly gh: number;
  /** The track editor's markers (selection, brush, checks), drawn over everything; empty in a race. */
  readonly overlay = new THREE.Group();
  /** Goes up when the picture changes by itself (the ground's art arriving), for a view that only draws on a change. */
  version = 0;
  private lastClock = 0;
  private dead = false;
  private readonly patchSpans: { from: number; to: number; color: number }[];
  /** Lap fractions of the water crossings' streams, where the back wheel throws up spray. */
  private readonly waterSpans: [number, number][] = [];
  private terrain = new Float32Array(0);
  private readonly labels: Phaser.GameObjects.Container;
  /** Tall scenery that fades when a rider is behind it, so it never hides the racing. */
  private readonly tall: { corners: THREE.Vector3[]; mats: THREE.Material[]; faded: boolean }[] = [];
  /** The start gate's pickets, hinged at the bottom so they drop flat when the race starts. */
  private gateDrop: THREE.Group | null = null;
  /** The official holding the start board beside the start straight, and the board itself. */
  /** The marshals (scenery type marshal): flag up while a rider is down on their watch (updateMarshals). */
  private marshals: Marshal[] = [];
  /** The flag men and the pit crews by the finish line (core/finishCrew.ts). */
  private flaggers: Flagger[] = [];
  private crews: PitCrew[] = [];
  /** The race's laps, for the flag man's white and chequered flags and the pit boards (setLaps); unset in practice and in the editor. */
  private laps: number | undefined;
  /** The cheering fans (scenery type cheer): walk in on load, then react to bikes passing (updateCheers). */
  readonly cheers: Cheer[] = [];
  private cheerClock = 0;
  private board: { stand: THREE.Group; panel: THREE.Group; arms: THREE.Group[]; legs: THREE.Group[]; route: OfficialSpot[]; length: number } | null = null;
  /** False for practice, which has no start procedure: the start board stays down. */
  hasStart = true;
  /** False where nobody races to the line first (qualifying, a No-Turn Takedown's seeding run): no finish fireworks. */
  showFireworks = true;
  /** Draws items the game's own way, ignoring the models folder, while builtInItem builds one for the models page. */
  private builtIn = false;
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
    /** The track editor's race view passes the last view's renderer on, so a rebuild reuses its WebGL context and compiled shaders. */
    renderer?: THREE.WebGLRenderer,
    /** The track editor's race view, for an unfinished track: see gapFrom, and gaps between its pieces (fractions of the drawing). */
    opts: { gapFrom?: number; gaps?: [number, number][]; scaleWidth?: number; /** A scenery item (by index) not built: the one the track editor is dragging, which it draws itself (ghostItem). */ skipItem?: number } = {},
  ) {
    this.gapFrom = opts.gapFrom ?? 1;
    this.surface = new TrackSurface(track);
    // A No-Turn Takedown's way back from the run-off to the start line is never drawn (trackGeom hiddenSpans).
    this.gaps = [...(opts.gaps ?? []), ...(this.gapFrom < 1 ? [[this.gapFrom, 1] as [number, number]] : []), ...hiddenSpans(track, this.surface.g, this.surface.bounds)];
    ({ w: this.gw, h: this.gh } = gridOf(track));
    this.lapMetres = lapMetres(track);
    const kind = trackKind(parts, track);
    this.follow = true;
    // A view wider than scaleWidth shows more track at the same scale, rather than the same track bigger.
    this.viewUnits = (VIEW_UNITS[kind.id] ?? 32) * (opts.scaleWidth ? w / opts.scaleWidth : 1);
    const lap = this.surface.mpu * this.surface.g.total;
    this.patchSpans = (track.patches ?? []).map((p) => ({ from: p.at / lap, to: (p.at + p.length) / lap, color: hex(parts.surfaces.find((s) => s.id === p.surface)?.color, 0x888888) }));
    const ground = track.ground ?? { base: parts.ground[0]?.id ?? 'grass', cell: 2, paint: {} };
    this.bg = hex(parts.ground.find((g) => g.id === ground.base)?.color, 0x5f8f3c);

    // Draw at the screen's real resolution, so the picture stays sharp when the window is big.
    const k = Math.min(scene.scale.width / 1280, scene.scale.height / 720);
    const res = Math.max(1, Math.min(2, k));
    const rw = Math.round(w * res);
    const rh = Math.round(h * res);
    this.renderer = renderer ?? new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, preserveDrawingBuffer: true });
    const canvas = this.renderer.domElement;
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
    this.groundCanvas.width = ((this.gw + 2 * MARGIN) / 2) * TILE_PX;
    this.groundCanvas.height = ((this.gh + 2 * MARGIN) / 2) * TILE_PX;
    this.groundTex = new THREE.CanvasTexture(this.groundCanvas);
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    this.groundTex.magFilter = THREE.NearestFilter;
    this.groundTex.anisotropy = 4;
    this.drawGround();
    this.buildTerrain();
    this.ground.push(this.terrainMesh(), this.buildTrack(), ...this.buildPortals(), ...this.buildFinishArches());
    if (this.surface.start.total > 0) this.ground.push(this.buildStart());
    this.scene3.add(...this.ground);
    this.scene3.add(this.overlay);
    if (this.surface.start.total > 0 && this.surface.raised) {
      // A No-Turn Takedown's start platform: four gates, two each side of the starter's box, and no start board.
      this.scene3.add(this.noTurnGate());
      this.addTall(this.platformFrame());
    } else if (this.surface.start.total > 0) {
      this.scene3.add(this.startGate());
      this.scene3.add(this.startBoard());
    } else if (this.track.scenery?.some((it) => it.type === OFFICIAL_ITEM)) {
      // An official placed on a new track before its start straight: drawn standing where placed (the track editor).
      this.scene3.add(this.startBoard());
    }
    // The chequered finish line at the lap's first point; an unfinished track in the editor may not have placed one yet.
    if (this.track.finish !== false) this.scene3.add(this.startLine());
    // Low scenery that never needs fading is baked into one mesh; textured parts stay separate.
    const low: THREE.Mesh[] = [];
    for (const [i, it] of (track.scenery ?? []).entries()) {
      if (i === opts.skipItem) continue;
      const obj = this.buildItem(it);
      if (!obj) continue;
      this.scene3.add(obj);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      // Fans move, so they are never baked into the still scenery.
      if (box.max.y < 1.2 && it.type !== CHEER_ITEM) {
        const plain: THREE.Mesh[] = [];
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && !(m.material as THREE.MeshLambertMaterial).map && !(m.material as THREE.MeshLambertMaterial).vertexColors) plain.push(m);
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
    this.buildEnduro();

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 4), new THREE.MeshBasicMaterial({ color: COLORS.accent }));
    this.marker.rotation.x = Math.PI;
    this.scene3.add(this.marker);
    this.puffMap = this.softDot();

    // Rider numbers and the lap map draw over the 3D picture.
    this.labels = scene.add.container(0, 0);
    parent.add(this.labels);
    const mw = 190;
    const mk = mw / this.gw;
    this.mapBox = { x: x + w - mw - 12, y: y + 12, k: mk };
    const mg = scene.add.graphics();
    mg.fillStyle(COLORS.ink, 0.85).fillRoundedRect(this.mapBox.x - 6, this.mapBox.y - 6, mw + 12, this.gh * mk + 12, 6);
    mg.lineStyle(4, 0xc98a4b, 1);
    mg.beginPath();
    if (!this.gaps.length) this.surface.g.pts.forEach((p, i) => (i ? mg.lineTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk) : mg.moveTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk)));
    else {
      // Only the stretches that are track, each its own line.
      let pen = false;
      for (let i = 0; i <= 400; i++) {
        const f = i / 400;
        if (!this.drawn(f)) { pen = false; continue; }
        const p = pointAt(this.surface.g, f);
        if (pen) mg.lineTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk);
        else mg.moveTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk);
        pen = true;
      }
    }
    mg.strokePath();
    if (this.surface.start.total > 0) {
      mg.lineStyle(3, 0xc98a4b, 1);
      mg.beginPath();
      this.surface.start.pts.forEach((p, i) => (i ? mg.lineTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk) : mg.moveTo(this.mapBox.x + p.x * mk, this.mapBox.y + p.y * mk)));
      mg.strokePath();
    }
    const s0 = pointAt(this.surface.g, 0);
    if (this.gapFrom > 0) mg.fillStyle(0xffffff, 1).fillRect(this.mapBox.x + s0.x * mk - 2, this.mapBox.y + s0.y * mk - 2, 4, 4);
    this.mapDots = scene.add.graphics();
    this.mapFrame = mg;
    parent.add([mg, this.mapDots]);

    this.image.once('destroy', () => this.destroy());
    this.loadArt();
    // Handed a renderer: take up the shaders it already has before the last view lets them go.
    if (renderer) this.renderer.compile(this.scene3, this.camera);
  }

  /** False on a gap in an unfinished track's drawing (see gaps), where no track is drawn. */
  private drawn(f: number): boolean {
    return !this.gaps.some(([a, b]) => f > a && f < b);
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
      this.version++;
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
    for (let gy = -MARGIN; gy < this.gh + MARGIN; gy += cell) {
      for (let gx = -MARGIN; gx < this.gw + MARGIN; gx += cell) {
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
    const tw = this.gw + 2 * MARGIN + 1;
    const th = this.gh + 2 * MARGIN + 1;
    this.terrain = new Float32Array(tw * th);
    const hills: { x: number; z: number; e: number }[] = [];
    const flats: { x: number; z: number }[] = [];
    const n = Math.ceil(s.g.total / 0.5);
    for (let i = 0; i < n; i++) {
      const f = i / n;
      if (!this.drawn(f)) continue;
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
    const smooth = (x: number) => {
      const t = Math.max(0, Math.min(1, x));
      return t * t * (3 - 2 * t);
    };
    // The editor's elevation: the painted ground, except by the track, which is graded level across
    // its width at its own level (the ground under its middle plus its hills), so the ground there
    // eases from that level (right under the track, its lip and slope) out to the painted ground.
    // That easing is a raised or sunk track's side: grass, as wide as it needs to be to stay a
    // slope (SIDE_RUN grid units of run for each grid unit of rise), never a wall.
    if (!s.elev.empty || s.track.hills?.length) {
      // Bits of track in route order: the lap (seg 0) then the start straight (seg 1).
      const mid: { x: number; z: number; r: number; l: number; seg: number; u?: number }[] = [];
      for (let i = 0; i < n; i++) {
        const f = i / n;
        if (!this.drawn(f)) continue;
        const p = s.spot(f, 0);
        mid.push({ x: p.x, z: p.z, r: s.hwAt(f) * (LIP_AT + Math.max(s.skirt(f, -1), s.skirt(f, 1))), l: s.lift(f), seg: 0 });
      }
      const lapEnd = mid.length;
      for (let u = -START_PAD; u < s.start.total; u += 0.5) {
        const p = startPointAt(s.start, u);
        mid.push({ x: p.x, z: p.y, r: s.startHw(u) * LIP_AT + 0.4, l: s.startBase(u), seg: 1, u });
      }
      // The level of the track at the bit of route nearest a point: interpolated along the route
      // between the nearest bit and its neighbours, so under the track and at its foot the ground
      // is exactly the track's level, with none of the smoothing below (which, on a hill's
      // shoulders, would lift the ground into the riding surface).
      const exact = (x: number, z: number, k: number) => {
        const q = mid[k];
        // The start straight's level is graded to the lap where they meet, so it is a function of
        // the spot itself.
        if (q.seg === 1) return s.startBase(q.u!, x, z);
        const nb = (j: number) => {
          if (q.seg === 0) return mid[((j % lapEnd) + lapEnd) % lapEnd];
          return j >= lapEnd && j < mid.length ? mid[j] : undefined;
        };
        let bestD = Infinity;
        let level = q.l;
        for (const o of [nb(k - 1), nb(k + 1)]) {
          if (!o || o === q) continue;
          const dx = o.x - q.x;
          const dz = o.z - q.z;
          const len2 = dx * dx + dz * dz;
          if (len2 < 1e-9) continue;
          const t = Math.max(0, Math.min(1, ((x - q.x) * dx + (z - q.z) * dz) / len2));
          const d = Math.hypot(x - (q.x + dx * t), z - (q.z + dz * t));
          if (d < bestD) {
            bestD = d;
            level = q.l + (o.l - q.l) * t;
          }
        }
        return level;
      };
      const BLEND = 3;
      const SIDE_RUN = 1.5;
      const blendAt = (drop: number) => Math.max(BLEND, drop * SIDE_RUN);
      const maxBlend = blendAt(Math.max(0, ...mid.map((q) => Math.abs(q.l - s.groundAt(q.x, q.z)))));
      // Only bits of track within reach can matter: nearer than the widest blend past their own
      // reach for the blend, and the soft weights below drop out (under 1e-4) past 2.28 beyond the
      // nearest. So each point looks at the bits in its own and the neighbouring cells, in their
      // original order.
      const reach = maxBlend + Math.max(0, ...mid.map((q) => q.r)) + 2.3;
      const cw = Math.ceil(tw / reach);
      const ch = Math.ceil(th / reach);
      const cellOf = (x: number, z: number) => [Math.floor((x + MARGIN) / reach), Math.floor((z + MARGIN) / reach)];
      const inCell: number[][] = Array.from({ length: cw * ch }, () => []);
      mid.forEach((q, k) => {
        const [ci, cj] = cellOf(q.x, q.z);
        inCell[Math.max(0, Math.min(ch - 1, cj)) * cw + Math.max(0, Math.min(cw - 1, ci))].push(k);
      });
      const nearby: number[][] = [];
      for (let cj = 0; cj < ch; cj++) {
        for (let ci = 0; ci < cw; ci++) {
          const ks: number[] = [];
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (ci + di >= 0 && ci + di < cw && cj + dj >= 0 && cj + dj < ch) ks.push(...inCell[(cj + dj) * cw + ci + di]);
          nearby.push(ks.sort((a, b) => a - b));
        }
      }
      // Under the riding surface the ground sits a little below the track, so the track's mesh is
      // never pushed up by the ground between the lattice's points; the gap closes at the foot.
      const SINK = 0.05;
      for (let j = 0; j < th; j++) {
        for (let i = 0; i < tw; i++) {
          const x = i - MARGIN;
          const z = j - MARGIN;
          const [ci, cj] = cellOf(x, z);
          const local = nearby[cj * cw + ci];
          // How far off the track this is, and its level: from the nearest bits of track, weighted
          // softly so the ground has no seam where two stretches at different levels come close.
          let best = Infinity;
          let near = Infinity;
          let nearest = -1;
          for (const k of local) {
            const q = mid[k];
            const dc = Math.hypot(x - q.x, z - q.z);
            best = Math.min(best, dc - q.r);
            if (dc < near) {
              near = dc;
              nearest = k;
            }
          }
          if (best >= maxBlend) {
            this.terrain[j * tw + i] = s.groundAt(x, z);
            continue;
          }
          let l = exact(x, z, nearest);
          if (best < 0) {
            l -= SINK * smooth(-best / 0.7);
          } else {
            let sum = 0;
            let wt = 0;
            for (const k of local) {
              const q = mid[k];
              const kw = Math.exp(-(((Math.hypot(x - q.x, z - q.z) - near) / 0.4) ** 2));
              if (kw < 1e-4) continue;
              sum += kw * q.l;
              wt += kw;
            }
            // Out from the foot, over a grid unit and a half, the exact level gives way to the soft one.
            l += (sum / wt - l) * smooth(best / 1.5);
          }
          const ground = s.groundAt(x, z);
          const w = smooth(best / blendAt(Math.abs(l - ground)));
          this.terrain[j * tw + i] = l * (1 - w) + ground * w;
        }
      }
    }
    if (!hills.length) return;
    const r0 = s.hw * 1.3;
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
        this.terrain[j * tw + i] += h;
      }
    }
  }

  /** Ground height at a point on the grid. */
  terrainAt(x: number, z: number): number {
    const tw = this.gw + 2 * MARGIN + 1;
    const th = this.gh + 2 * MARGIN + 1;
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
    const tw = this.gw + 2 * MARGIN + 1;
    const th = this.gh + 2 * MARGIN + 1;
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
      const lanes = [-(LIP_AT + skL * FOOT_OUT), -(LIP_AT + skL * 0.45), -LIP_AT, ...inner, LIP_AT, LIP_AT + skR * 0.45, LIP_AT + skR * FOOT_OUT];
      const patch = this.patchAt(f);
      const grain = 0.94 + 0.1 * noise(i);
      const wall = !!s.tunnelAt(f);
      lanes.forEach((lane, j) => {
        const p = s.spot(f, lane);
        const foot = j === 0 || j === cols - 1;
        pos.push(p.x, foot ? this.terrainAt(p.x, p.z) - FOOT_BURY : Math.max(s.height(f, lane), this.terrainAt(p.x, p.z) + 0.02), p.z);
        // The dirt texture runs along the lap, one repeat every 4 grid units.
        uv.push((f * s.g.total) / 4, (lane + 2) / 4);
        let color: number;
        const open = s.mouth(f, lane < 0 ? -1 : 1);
        if (Math.abs(lane) <= 1 || open > 0.5) color = shade(patch ?? base, grain * (0.97 + 0.06 * noise(i * 31 + j)));
        else if (Math.abs(lane) <= LIP_AT + 1e-6) color = shade(patch ?? base, 0.82 * grain);
        else if (wall) color = foot ? 0x7a7a78 : 0x9a9a98;
        else color = wall ? 0x24324e : shade(base, foot ? 0.62 : 0.72);
        c.setHex(color);
        col.push(c.r, c.g, c.b);
      });
    }
    const idx: number[] = [];
    for (let i = 0; i < rows; i++) {
      if (!this.drawn((i + 0.5) / rows)) continue;
      const a = i * cols;
      const b = ((i + 1) % rows) * cols;
      // Through a tunnel's hole the walls (the two outer columns each side) are left out.
      const hole = s.inHole((i + 0.5) / rows);
      for (let j = 0; j < cols - 1; j++) {
        if (hole && (j < 2 || j >= cols - 3)) continue;
        idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
      }
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
   * The finish arch built over a finish-line jump (a section with `finish`): its posts stand on the
   * banks beside the track, clear of every lane, and its banner spans the track ARCH_CLEAR above
   * the surface where it stands (jumps.ts ARCH_AT), above any rider still in the air there.
   */
  private buildFinishArches(): THREE.Mesh[] {
    const s = this.surface;
    const out: THREE.Mesh[] = [];
    const def = this.parts.scenery.find((d) => d.id === 'finish_arch');
    const color = hex(def?.color, 0x202020);
    const span = archSpan(this.track.width ?? DEFAULT_TRACK_WIDTH);
    this.track.sections.forEach((sec, si) => {
      if (!sec.finish) return;
      const f0 = s.bounds[si];
      const f1 = s.bounds[si + 1];
      if (f1 === undefined) return;
      // A No-Turn Takedown's finish-line jump ends on the finish line, the end of the run, and the arch stands over the line.
      const f = s.raised ? f1 - 1e-4 : f0 + (ARCH_AT[sec.type] ?? 0.5) * (f1 - f0);
      const c = s.spot(f, 0);
      const deck = s.height(f, 0);
      const top = deck + ARCH_CLEAR;
      const tops: THREE.Vector3[] = [];
      for (const side of [-1, 1]) {
        const lane = (side * span) / 2 / s.hwAt(f);
        const p = s.spot(f, lane);
        tops.push(new THREE.Vector3(p.x, top + 0.9, p.z));
        const base = Math.min(this.terrainAt(p.x, p.z), s.height(f, lane)) - 0.2;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, top - base, 0.5), this.mat(0xd8d8d8));
        post.position.set(p.x, (top + base) / 2, p.z);
        post.rotation.y = Math.PI / 2 - c.ang;
        post.castShadow = true;
        post.receiveShadow = true;
        out.push(post);
      }
      const face = this.mat(0xffffff, { map: this.textTexture(def?.text || 'FINISH', color) });
      const side = this.mat(shade(color, 0.8));
      const banner = new THREE.Mesh(new THREE.BoxGeometry(span, 0.9, 0.35), [side, side, side, side, face, face]);
      banner.position.set(c.x, top + 0.45, c.z);
      banner.rotation.y = Math.PI / 2 - c.ang;
      banner.castShadow = true;
      out.push(banner);
      this.archTops.push([tops[0], tops[1]]);
    });
    return out;
  }

  /** Concrete portal frames round each tunnel's holes: a lintel along the deck's edge and a jamb at each end, both sides. */
  private buildPortals(): THREE.Mesh[] {
    const s = this.surface;
    const out: THREE.Mesh[] = [];
    const mat = new THREE.MeshLambertMaterial({ color: 0xb8b8b4 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
    const bar = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): THREE.Mesh => {
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, len), mat);
      m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      m.lookAt(bx, by, bz);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    for (const t of s.tunnels) {
      for (const side of [-1, 1]) {
        const lane = side * LIP_AT;
        const a = s.spot(t.h0, lane);
        const b = s.spot(t.h1, lane);
        const ya = s.height(t.h0, lane);
        const yb = s.height(t.h1, lane);
        const ga = this.terrainAt(a.x, a.z);
        const gb = this.terrainAt(b.x, b.z);
        out.push(bar(a.x, ya + 0.05, a.z, b.x, yb + 0.05, b.z, 0.5));
        out.push(bar(a.x, ga - 0.1, a.z, a.x, ya + 0.1, a.z, 0.55));
        out.push(bar(b.x, gb - 0.1, b.z, b.x, yb + 0.1, b.z, 0.55));
      }
      // The dark of the tunnel's throat under the deck, so the hole reads as a hole from the race camera.
      const mid = (t.h0 + t.h1) / 2;
      const c = s.spot(mid, 0);
      const top = s.height(mid, 0) - 0.08;
      const len = Math.max(0.3, (t.h1 - t.h0) * s.g.total);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(s.hw * 2 * LIP_AT, 0.05, len), dark);
      roof.position.set(c.x, top, c.z);
      roof.rotation.y = Math.PI / 2 - c.ang;
      roof.receiveShadow = false;
      out.push(roof);
    }
    return out;
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
      // A No-Turn Takedown's start platform stands on steel: its sides go straight down to the ground (platformFrame) until the drop-in reaches it.
      const wall = s.platform(u) > 0.05;
      const sk = wall ? 0.02 / s.startHw(u) : Math.max(0.35, lip * 0.9) / s.startHw(u);
      const lanes = [-(LIP_AT + sk * FOOT_OUT), -(LIP_AT + sk * 0.45), -LIP_AT, ...inner, LIP_AT, LIP_AT + sk * 0.45, LIP_AT + sk * FOOT_OUT];
      const grain = 0.94 + 0.1 * noise(i + 977);
      // Concrete under the gate and the line-up (the whole deck of a start platform), dirt from just past the gate.
      const pad = u < (s.raised ? NO_TURN_PLATFORM.deck : 0.9);
      lanes.forEach((lane, j) => {
        const p = s.startSpot(u, lane);
        const foot = j === 0 || j === cols - 1;
        pos.push(p.x, foot ? this.terrainAt(p.x, p.z) - FOOT_BURY : Math.max(s.startHeight(u, lane), this.terrainAt(p.x, p.z) + 0.02) - dip, p.z);
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

  // ---- enduro sections and sprints (Boss, 29 Oct 2026) ----

  /**
   * What the enduro sections are made of, laid on the track: rocks, roots and logs where the
   * surface bucks (trackSurface sectionShape), a stream across a water crossing, and trees close
   * on both sides of woods singletrack. On a sprint, its start at the start line (unless the track
   * places one), and stakes and tape down both sides of the return lane.
   */
  private buildEnduro(): void {
    const s = this.surface;
    const parts: THREE.Mesh[] = [];
    const water: THREE.Mesh[] = [];
    const rnd = (k: number) => noise(k * 13.37 + 5.1);
    let near: SurfaceIndex | null = null;
    const index = () => (near ??= new SurfaceIndex(surfacePoints(this.track)));
    const sitting = (m: THREE.Mesh, f: number, lane: number, lift = 0) => {
      const p = s.spot(f, lane);
      m.position.set(p.x, s.height(f, lane) + lift, p.z);
      return p;
    };
    const across = (f: number) => s.spot(f, 0).ang;
    this.track.sections.forEach((sec, si) => {
      const f0 = s.bounds[si];
      const f1 = s.bounds[si + 1];
      const len = (f1 - f0) * s.g.total;
      const at = (u: number) => f0 + (f1 - f0) * u;
      switch (sec.type) {
        case 'rocks': {
          // Stones of every size, the biggest pushed out towards the edges where riders steer round them.
          const n = Math.round(len * 3.2);
          for (let k = 0; k < n; k++) {
            const f = at(0.03 + 0.94 * rnd(si * 997 + k));
            const big = rnd(si * 31 + k * 7) > 0.8;
            const lane = (rnd(si * 53 + k * 3) * 2 - 1) * (big ? 1.15 : 0.95);
            const r = (big ? 0.2 : 0.08) + 0.1 * rnd(si * 71 + k);
            const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), this.mat(shade(0x9a958a, 0.75 + 0.35 * rnd(si * 19 + k)), { flatShading: true }));
            sitting(m, f, lane, r * 0.35);
            m.scale.y = 0.6;
            m.rotation.set(rnd(k) * 3, rnd(k * 3) * 3, 0);
            parts.push(m);
          }
          break;
        }
        case 'roots': {
          // Roots snaking across the track from the trees either side, half sunk in the dirt.
          const n = Math.max(3, Math.round(len * 0.9));
          for (let k = 0; k < n; k++) {
            const f = at(0.06 + 0.88 * rnd(si * 211 + k));
            const reach = s.hwAt(f) * 2.5;
            const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, reach, 6), this.mat(shade(0x5a3a20, 0.85 + 0.3 * rnd(k))));
            sitting(m, f, 0, 0.02);
            m.rotation.set(0, -across(f) + (rnd(si * 7 + k) - 0.5) * 0.9, Math.PI / 2);
            parts.push(m);
          }
          break;
        }
        case 'logs':
        case 'log_step': {
          // Logs across the track, as wide as its lips, on the humps the surface has for them.
          const h = this.metreUnits(sec.height ?? (sec.type === 'logs' ? 0.4 : 0.6));
          const spots = sec.type === 'logs' ? LOGS_AT : [0.5];
          spots.forEach((u, k) => {
            const f = at(u);
            const r = h / 2;
            const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, s.hwAt(f) * 2 * LIP_AT + 0.3, 12), this.mat(shade(0x7a5230, 0.9 + 0.2 * rnd(si + k))));
            sitting(m, f, 0, -h / 2 + r * 0.9);
            m.position.y = s.lift(f) + r * 0.95;
            m.rotation.set(0, -across(f), Math.PI / 2);
            parts.push(m);
            for (const side of [-1, 1]) {
              const e = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.02, 12), this.mat(0xc8a878));
              const p = s.spot(f, side * (LIP_AT + 0.15 / s.hwAt(f)));
              e.position.set(p.x, s.lift(f) + r * 0.95, p.z);
              e.rotation.set(0, -across(f), Math.PI / 2);
              parts.push(e);
            }
          });
          break;
        }
        case 'water_crossing': {
          // A stream running across the track: water over the section and out into the grass both sides.
          const rows = Math.max(6, Math.ceil(len / 0.3));
          const pos: number[] = [];
          const idx: number[] = [];
          // Across: out into the grass each side (grid units past the lip), wavering along the stream's banks.
          const lanesOut = [-4, -2.2, -LIP_AT, -1, 0, 1, LIP_AT, 2.2, 4];
          for (let i = 0; i <= rows; i++) {
            const u = 0.15 + (0.7 * i) / rows;
            const f = at(u);
            const hw = s.hwAt(f);
            const bank = Math.sin(Math.PI * (i / rows));
            for (const l of lanesOut) {
              const out = Math.abs(l) > LIP_AT ? (Math.abs(l) - LIP_AT) * (0.55 + 0.45 * bank) * (0.85 + 0.3 * rnd(si * 17 + i * 3 + (l > 0 ? 1 : 0))) : 0;
              const lane = Math.abs(l) > LIP_AT ? Math.sign(l) * (LIP_AT + out / hw) : l;
              const p = s.spot(f, lane);
              const y = Math.abs(lane) <= LIP_AT ? s.height(f, lane) : this.terrainAt(p.x, p.z);
              pos.push(p.x, y + 0.06, p.z);
            }
            // Ripples and the odd stone in the stream.
            if (i % 3 === 1) {
              const rip = new THREE.Mesh(new THREE.BoxGeometry(0.6 + rnd(i) * 0.6, 0.015, 0.05), this.mat(0xcfe6f6));
              const lane = (rnd(si * 5 + i) * 2 - 1) * (LIP_AT + 1.5 / hw);
              const p = s.spot(f, lane);
              rip.position.set(p.x, (Math.abs(lane) <= LIP_AT ? s.height(f, lane) : this.terrainAt(p.x, p.z)) + 0.075, p.z);
              rip.rotation.y = -across(f) + Math.PI / 2;
              parts.push(rip);
            }
          }
          const cols = lanesOut.length;
          for (let i = 0; i < rows; i++) for (let j = 0; j < cols - 1; j++) {
            const a = i * cols + j;
            idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          geo.setIndex(idx);
          geo.computeVertexNormals();
          const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a86c0, transparent: true, opacity: 0.78, side: THREE.DoubleSide }));
          m.receiveShadow = true;
          water.push(m);
          this.waterSpans.push([at(0.15), at(0.85)]);
          break;
        }
        case 'woods': {
          // Trees close on both sides, each clear of the rest of the track.
          const step = 2.2;
          const n = Math.max(2, Math.floor(len / step));
          for (let k = 0; k <= n; k++) {
            for (const side of [-1, 1]) {
              const f = at(k / n);
              const hw = s.hwAt(f);
              const off = hw * LIP_AT + 1.0 + 1.4 * rnd(si * 41 + k * 2 + side);
              const p = s.spot(f, side * (off / hw));
              if (index().offTrack(p.x, p.z) < 1.2) continue;
              const tree = this.buildItem({ type: rnd(si * 9 + k * 5 + side) > 0.25 ? 'tree' : 'bush', x: p.x, y: p.z, w: 2.4 + rnd(k + si) * 1.4, h: 2.4 });
              if (tree) this.addTall(tree);
            }
          }
          break;
        }
        case RETURN_LANE: {
          if (!isSprint(this.track) || si !== 0) break;
          // Stakes and tape down both sides, so the lane reads as single file.
          const n = Math.max(2, Math.floor(len / 2.5));
          const tape = this.mat(0xf0e030);
          for (let k = 1; k < n; k++) {
            for (const side of [-1, 1]) {
              const f = at(k / n);
              const hw = s.hwAt(f);
              const p = s.spot(f, side * (LIP_AT + 0.35 / hw));
              const stake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), this.mat(0xe8e8e8));
              stake.position.set(p.x, this.terrainAt(p.x, p.z) + 0.3, p.z);
              parts.push(stake);
              if (k + 1 < n) {
                const q = s.spot(at((k + 1) / n), side * (LIP_AT + 0.35 / s.hwAt(at((k + 1) / n))));
                const run = Math.hypot(q.x - p.x, q.z - p.z);
                const t = new THREE.Mesh(new THREE.BoxGeometry(run, 0.04, 0.02), tape);
                t.position.set((p.x + q.x) / 2, (this.terrainAt(p.x, p.z) + this.terrainAt(q.x, q.z)) / 2 + 0.52, (p.z + q.z) / 2);
                t.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
                parts.push(t);
              }
            }
          }
          break;
        }
      }
    });
    if (parts.length) {
      for (const m of parts) m.updateMatrix();
      this.scene3.add(this.mergeParts(parts, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    }
    for (const m of water) this.scene3.add(m);
    // A sprint's start, built at the start line unless the track places its own.
    const place = sprintPlace(this.track);
    if (place && !this.track.scenery?.some((it) => it.type === SPRINT_START_ITEM)) {
      const start = this.buildItem({ type: SPRINT_START_ITEM, ...place });
      if (start) this.scene3.add(start);
    }
  }

  /** Adds a tall object that fades when it stands between the camera and a rider (fadeBlockers), as placed scenery does. */
  private addTall(obj: THREE.Object3D): void {
    this.scene3.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
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

  /** Metres of height to grid units, as the track surface draws them. */
  private metreUnits(m: number): number {
    return this.surface.units(m);
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
   * A No-Turn Takedown's start gate (Boss, 30 Oct 2026): a gate for each of the four riders, two
   * each side of the starter's box in the middle of the platform, their pickets hinged to drop
   * together at the start like any start gate's.
   */
  private noTurnGate(): THREE.Object3D {
    const s = this.surface;
    const u = 0.75;
    const at = s.startSpot(u, 0);
    const hw = s.startHw(u);
    const g = new THREE.Group();
    g.position.set(at.x, s.startHeight(u, 0), at.z);
    g.rotation.y = -at.ang;
    const d = 1;
    // Along the riders' way is +x here, across the platform +z (the riders' right).
    const hinge = new THREE.Group();
    hinge.position.set(d * 0.3 + 0.04, 0.12, 0);
    const steel = this.mat(0x8a8a8a);
    const picket = this.mat(0x5a5a60);
    const rail = this.mat(0xd8d8d8);
    const lane = (hw * (NO_TURN_LANES[1] - NO_TURN_LANES[0])) * 0.92;
    for (const side of [-1, 1]) {
      const inner = Math.abs(NO_TURN_LANES[2]) * hw - lane / 2;
      const outer = Math.abs(NO_TURN_LANES[3]) * hw + lane / 2;
      const mid = side * (inner + outer) / 2;
      g.add(this.boxMesh(d, 0.12, outer - inner, steel, 0, 0, mid));
      for (const l of NO_TURN_LANES.filter((x) => Math.sign(x) === side)) {
        hinge.add(this.boxMesh(0.08, 0.55, lane * 0.82, picket, 0, 0, l * hw));
      }
      hinge.add(this.boxMesh(0.18, 0.18, outer - inner, this.mat(0xc8302a), -0.1, 0.55, mid));
      // A post at each end of each pair, holding the gate's pivot.
      for (const z of [inner, outer]) g.add(this.boxMesh(0.12, 0.85, 0.12, rail, 0.3, 0, side * z));
    }
    g.add(hinge);
    this.gateDrop = hinge;
    // The starter's box between the pairs, just behind the gate line, the starter facing down the run.
    const inner = (Math.abs(NO_TURN_LANES[1]) * hw - lane / 2) * 2;
    const box = this.mergeParts(starterBox(Math.min(1.2, (inner * 0.9) / METRE), 0));
    box.rotation.y = Math.PI / 2;
    box.position.set(-0.2, 0, 0);
    g.add(box);
    return g;
  }

  /**
   * The frame under a No-Turn Takedown's start platform: steel legs down each side of the deck and
   * the drop-in to the ground, a rail along the deck's edges, and the panel across its back.
   */
  private platformFrame(): THREE.Object3D {
    const s = this.surface;
    const g = new THREE.Group();
    const steel = this.mat(0x6a6e78);
    const rail = this.mat(0xd8d8d8);
    const panel = this.mat(0x24324e);
    const end = NO_TURN_PLATFORM.deck + NO_TURN_PLATFORM.drop;
    const post = (u: number, lane: number, h0: number, h1: number, w: number, m: THREE.Material) => {
      const p = s.startSpot(u, lane);
      const top = s.startHeight(u, lane);
      const mesh = this.boxMesh(w, Math.max(0.02, top - h1 - h0), w, m, p.x, h0, p.z);
      mesh.position.y = h0 + (top - h1 - h0) / 2;
      g.add(mesh);
    };
    for (let u = -START_PAD + 0.2; u < end; u += 1) {
      for (const side of [-1, 1]) {
        const lane = side * (LIP_AT + 0.02);
        const p = s.startSpot(u, lane);
        const base = this.terrainAt(p.x, p.z);
        if (s.startHeight(u, lane) - base > 0.15) post(u, lane, base, 0, 0.14, steel);
      }
    }
    // A rail along each side of the deck, on posts.
    for (const side of [-1, 1]) {
      const lane = side * LIP_AT;
      const a = s.startSpot(-START_PAD, lane);
      const b = s.startSpot(NO_TURN_PLATFORM.deck, lane);
      const y = s.startHeight(0, lane) + 0.85;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const bar = this.boxMesh(len, 0.06, 0.06, rail, (a.x + b.x) / 2, y, (a.z + b.z) / 2);
      bar.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      g.add(bar);
      for (let u = -START_PAD; u <= NO_TURN_PLATFORM.deck + 0.01; u += (NO_TURN_PLATFORM.deck + START_PAD) / 4) {
        const p = s.startSpot(u, lane);
        g.add(this.boxMesh(0.06, 0.85, 0.06, rail, p.x, s.startHeight(u, lane), p.z));
      }
    }
    // The panel across the back of the deck, from its top down to the ground.
    const l = s.startSpot(-START_PAD, -LIP_AT);
    const r = s.startSpot(-START_PAD, LIP_AT);
    const c = { x: (l.x + r.x) / 2, z: (l.z + r.z) / 2 };
    const top = s.startHeight(-START_PAD, 0);
    const base = this.terrainAt(c.x, c.z);
    const back = this.boxMesh(Math.hypot(r.x - l.x, r.z - l.z), top - base, 0.12, panel, c.x, base, c.z);
    back.rotation.y = -Math.atan2(r.z - l.z, r.x - l.x);
    g.add(back);
    return g;
  }

  /**
   * The start board: an official beside the start straight, there all race (startOfficial). They
   * wait at A near the gate with the board held low, white side out, while the riders line up;
   * raise it face out and walk to B as the five-second hold begins, turn it sideways at three, and
   * lower it white side out at one, as they reach B, where they stay. The board's face (START 30) is
   * on one side and the other is plain white (updateStart).
   */
  private startBoard(): THREE.Object3D {
    const stand = new THREE.Group();
    let plan: ReturnType<typeof officialPlan>;
    try {
      // Placed by the track, they're drawn where placed even with a problem (the track editor shows it; the game refuses such a track).
      plan = this.track.scenery?.some((it) => it.type === OFFICIAL_ITEM) ? placedOfficial(this.track, this.parts).plan : officialPlan(this.track, this.parts);
    } catch (e) {
      // Nowhere clear for them (the track checks say so too): no official, rather than one on the track.
      console.warn(String(e));
      return stand;
    }
    if (!plan) return stand;
    stand.position.set(plan.a.x, this.heightAt(plan.a.x, plan.a.y), plan.a.y);
    stand.rotation.y = plan.facing;
    // Drawn 10% smaller than first built, board and all: the scale is on this group alone.
    stand.scale.setScalar(OFFICIAL_SCALE);
    // The official: legs, body, head, and arms that swing at the shoulder, up to hold the board
    // high or down to hold it low.
    const kit = this.mat(0x2a3a5a);
    const skin = this.mat(0xe0b090);
    // Legs swing at the hip as they walk.
    const legs = [-0.1, 0.1].map((x) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0.7, 0);
      leg.add(this.boxMesh(0.12, 0.7, 0.14, kit, 0, -0.7, 0));
      stand.add(leg);
      return leg;
    });
    stand.add(this.boxMesh(0.42, 0.62, 0.24, this.mat(0xf0a020), 0, 0.7, 0));
    stand.add(this.boxMesh(0.22, 0.22, 0.22, skin, 0, 1.34, 0));
    const arms = [-1, 1].map((sd) => {
      const arm = new THREE.Group();
      arm.position.set(sd * 0.27, 1.24, 0.04);
      arm.add(this.boxMesh(0.09, 0.8, 0.09, skin, 0, 0, 0));
      stand.add(arm);
      return arm;
    });
    // The board: face on the front, plain white on the back. It turns in its own plane about its centre.
    const panel = new THREE.Group();
    const W = 1.8;
    const H = 1.35;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: this.boardTexture() }));
    front.position.z = 0.03;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ color: 0xf4f4f0 }));
    back.rotation.y = Math.PI;
    back.position.z = -0.03;
    const core = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.05), this.mat(0xdedede));
    for (const m of [front, back, core]) m.castShadow = true;
    panel.add(core, front, back);
    stand.add(panel);
    this.board = { stand, panel, arms, legs, route: plan.route, length: routeLength(plan.route) };
    this.updateStart(-Infinity);
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
   * official waits at A holding the board low, white side out, while the riders line up; at five
   * raises it face out and walks to B; turns it sideways at three; reaches B at one and lowers it
   * white side out, and stays there with it low as the gate's pickets fall flat at the drop and for
   * the rest of the race. Purely a function of the clock, so scrubbing or a new race always shows
   * the right state.
   */
  private updateStart(clock: number): void {
    if (this.board) {
      const { stand, panel, arms, legs, route, length } = this.board;
      const ease = (x: number) => {
        const t = Math.max(0, Math.min(1, x));
        return t * t * (3 - 2 * t);
      };
      // How far up the board is: 0 held low, 1 held high. Practice has no start, so it stays low.
      const up = !this.hasStart ? 0 : clock < WALK_TO ? ease((clock + START_HOLD) / BOARD_MOVE) : 1 - ease((clock - WALK_TO) / BOARD_MOVE);
      // Low: in front of the official's legs, turned round so the white back faces out.
      panel.position.set(0, 0.72 + (2.45 - 0.72) * up, 0.42 + (0.12 - 0.42) * up);
      panel.rotation.set(0, Math.PI * (1 - up), clock >= BOARD_SIDEWAYS ? (Math.PI / 2) * up : 0);
      for (const arm of arms) arm.rotation.x = 2.7 * (1 - up);
      // The walk from A along the route to B, setting off and stopping gently, with the legs swinging in step.
      const k = !this.hasStart ? 0 : Math.max(0, Math.min(1, (clock - WALK_FROM) / (WALK_TO - WALK_FROM)));
      const walked = this.hasStart ? length * walkProgress(clock) : 0;
      const at = alongRoute(route, walked);
      // On the ground, or on the track where a placed route crosses it.
      stand.position.set(at.x, this.heightAt(at.x, at.y), at.y);
      const swing = k > 0 && k < 1 ? 0.45 * Math.sin((walked / 0.55) * Math.PI) : 0;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
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

  private textTexture(text: string, bg: number, fg = '#ffffff', w = 256, h = 48, vertical = false): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    // Vertical: the words read upwards along a tall face (a feather flag, an inflatable column).
    const [tw, th] = vertical ? [h, w] : [w, h];
    ctx.font = `bold ${Math.round(th * 0.62)}px Trebuchet MS, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fit = Math.min(1, (tw * 0.92) / Math.max(1, ctx.measureText(text).width));
    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (vertical) ctx.rotate(-Math.PI / 2);
    ctx.scale(fit, 1);
    ctx.fillText(text, 0, 2);
    ctx.restore();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * A scenery item as the track editor previews it before placing: built as it would stand, drawn
   * see-through, casting no shadow. Null for the start official, who is built with the start. With
   * an index it is the track's item of that index being dragged (built as that one, so a fan or a
   * tree keeps its look), drawn solid.
   */
  ghostItem(it: SceneryItem, index?: number): THREE.Object3D | null {
    // Built outside the track's list, so a marshal or fans here are not kept to animate.
    const marshals = this.marshals.length;
    const cheers = this.cheers.length;
    const flaggers = this.flaggers.length;
    const crews = this.crews.length;
    this.ghostIndex = index ?? -1;
    const obj = this.buildItem(it);
    this.ghostIndex = -1;
    this.marshals.length = marshals;
    this.flaggers.length = flaggers;
    this.crews.length = crews;
    this.cheers.length = cheers;
    if (!obj) return null;
    if (index !== undefined) return obj;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      const ghostly = (mat: THREE.Material) => {
        const c = mat.clone();
        c.transparent = true;
        c.opacity = 0.55;
        c.depthWrite = false;
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(ghostly) : ghostly(m.material);
      m.renderOrder = 11;
    });
    return obj;
  }

  /** The index a scenery item built as a ghost stands for (ghostItem), or -1. */
  private ghostIndex = -1;
  /** A scenery item's index in the track, which picks its variant; a ghost's is the index it stands for. */
  private itemIndex(it: SceneryItem): number {
    const i = (this.track.scenery ?? []).indexOf(it);
    return i >= 0 ? i : this.ghostIndex;
  }

  /**
   * One scenery item built the game's own way (never from the models folder), standing at the
   * origin at its default size and unturned, in grid units: what the models page exports.
   */
  builtInItem(type: string): THREE.Object3D | null {
    const was = this.builtIn;
    this.builtIn = true;
    try {
      const obj = this.buildItem({ type, x: 0, y: 0, rot: 0 });
      obj?.position.set(0, 0, 0);
      obj?.rotation.set(0, 0, 0);
      return obj;
    } finally {
      this.builtIn = was;
    }
  }

  /** Builds one scenery item as 3D shapes standing on the ground. */
  private buildItem(it: SceneryItem): THREE.Object3D | null {
    // The start official placed as scenery is built with the start (startBoard).
    if (it.type === OFFICIAL_ITEM) return null;
    const def = this.parts.scenery.find((s) => s.id === it.type);
    // The finish arch always spans the track (trackClearance.ts archSpan), whatever width it was saved with.
    const w = SPANS_TRACK.has(it.type) ? archSpan(this.track.width ?? DEFAULT_TRACK_WIDTH) : it.w ?? def?.w ?? 2;
    const d = it.h ?? def?.h ?? 2;
    const color = hex(it.color ?? def?.color, 0x888888);
    const text = it.text ?? def?.text ?? '';
    const g = new THREE.Group();
    g.position.set(it.x, this.terrainAt(it.x, it.y), it.y);
    g.rotation.y = -(((it.rot ?? 0) * Math.PI) / 180);
    const add = (o: THREE.Object3D) => g.add(o);
    // Your own model for this item (world/modModels.ts): its size in metres at the item's default
    // size, stretched with the footprint when an item is placed longer or deeper (a long tyre wall
    // or line of tape), its height going with the smaller stretch.
    const custom = this.builtIn || LOCKED_ITEMS.has(it.type) ? null : modModel(it.type);
    if (custom) {
      const sx = def ? Math.max(0.1, w / def.w) : 1;
      const sz = def ? Math.max(0.1, d / def.h) : 1;
      custom.scale.set(sx, Math.min(sx, sz), sz);
      add(custom);
      if (it.rot === undefined && FACES_TRACK.has(it.type) && this.awayFromTrack(it) === 1) g.rotation.y += Math.PI;
      return g;
    }
    if (def && it.type === MARSHAL_ITEM) {
      this.marshalFigure(g, it, def);
      return g;
    }
    if (def && it.type === FLAGGER_ITEM) {
      this.flaggerFigure(g, it, def);
      return g;
    }
    if (def && it.type === PIT_CREW_ITEM) {
      this.pitCrewFigure(g, it, def);
      return g;
    }
    if (def && isPaddock(def)) {
      // A paddock vehicle or a trackside item (paddock.ts, trackside.ts): one vertex-coloured mesh
      // each, so a full paddock costs a draw an item, plus a textured box for each label with words on.
      const index = this.itemIndex(it);
      const built = tracksideParts(def, it, index) ?? { parts: paddockParts(def, it, index), labels: [] as Label[] };
      if (built.parts.length) add(this.mergeParts(built.parts));
      for (const l of built.labels) {
        const face = this.mat(0xffffff, { map: this.textTexture(l.text, l.bg, l.fg, l.vertical ? 48 : 256, l.vertical ? 256 : 48, l.vertical) });
        const side = this.mat(l.bg);
        const back = l.both ? face : side;
        const box = this.boxMesh(l.l * METRE, l.h * METRE, l.w * METRE, [side, side, side, side, face, back], l.x * METRE, l.y * METRE, l.z * METRE);
        box.rotation.y = l.ry ?? 0;
        box.receiveShadow = false;
        add(box);
      }
      // People face the track unless the item is turned by hand.
      if (it.rot === undefined && FACES_TRACK.has(def.id) && this.awayFromTrack(it) === 1) g.rotation.y += Math.PI;
      return g;
    }
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
        // Not for an editor ghost: only an arch on the track has fireworks.
        if ((this.track.scenery ?? []).includes(it) && this.ghostIndex < 0) {
          g.updateMatrixWorld(true);
          this.archTops.push([g.localToWorld(new THREE.Vector3(-(w / 2 - 0.25), 5.1, 0)), g.localToWorld(new THREE.Vector3(w / 2 - 0.25, 5.1, 0))]);
        }
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
      case 'hay_bale': {
        // A straw bale with its two strings round it and a lighter cut end.
        add(this.boxMesh(w, 0.6, d, [this.mat(shade(color, 1.12)), this.mat(shade(color, 1.12)), this.mat(color), this.mat(color), this.mat(color), this.mat(color)]));
        for (const fx of [-0.25, 0.25]) add(this.boxMesh(0.05, 0.62, d + 0.02, this.mat(shade(color, 0.7)), fx * w, -0.01, 0));
        break;
      }
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
      case CHEER_ITEM:
        this.cheerFigure(g, it);
        break;
      case 'pit_tent': {
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(this.boxMesh(0.08, 1.9, 0.08, this.mat(0xcccccc), (sx * w) / 2.1, 0, (sz * d) / 2.1));
        // Turned and stretched in the geometry so the corners sit on the legs (a mesh scales before it turns).
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) / 2, 0.9, 4).rotateY(Math.PI / 4).scale(w / Math.hypot(w, d) * Math.SQRT2, 1, d / Math.hypot(w, d) * Math.SQRT2), this.mat(color));
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
        // Sunk a little, so its lower faces meet the ground instead of a point hovering over it.
        ball.position.y = Math.min(w, d) * 0.2;
        ball.scale.y = 0.75;
        ball.castShadow = true;
        add(ball);
        break;
      }
      case 'hedge': {
        // A clipped hedge, lumpy along the top and sides.
        const leaf = this.mat(color, { flatShading: true });
        add(this.boxMesh(w, 1.0, d * 0.6, leaf));
        const n = Math.max(2, Math.round(w / 0.6));
        for (let k = 0; k < n; k++) {
          const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(d * 0.24, 0), this.mat(shade(color, k % 2 ? 1.08 : 0.94), { flatShading: true }));
          ball.position.set(-w / 2 + (w / n) * (k + 0.5), 0.95 + (k % 3) * 0.04, (k % 2 ? 0.08 : -0.08) * d);
          ball.castShadow = true;
          add(ball);
        }
        break;
      }
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
      case 'skip': {
        // A UK builder's skip, drawn from the real thing (an 8-yard skip is about 3.7 m by 1.8 m,
        // 1.2 m tall): one solid hull sitting flat on the ground, its long sides vertical and its
        // two ends sloping out to a rolled rim; channel ribs round the sides, a heavy rim rail, four
        // chain lugs at the top corners, a drop door marked at one end and a painted name board.
        // Its load is a heaped mound of rubble up over the rim, with planks, blocks, a pipe and
        // sacks bedded into the mound, so nothing in it hangs in the air.
        const paint = this.mat(color, { flatShading: true });
        const trim = this.mat(shade(color, 0.6));
        const steel = this.mat(0x2e2e32);
        const L = w / 2;
        const foot = w * 0.37;
        const H = 1.15;
        const W = d * 0.8;
        // The hull: the side profile (a trapezium, feet on the ground) extruded across the width.
        const profile = new THREE.Shape([new THREE.Vector2(-foot, 0), new THREE.Vector2(foot, 0), new THREE.Vector2(L, H), new THREE.Vector2(-L, H)]);
        const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: W, bevelEnabled: false }), paint);
        hull.position.z = -W / 2;
        hull.castShadow = true;
        hull.receiveShadow = true;
        add(hull);
        // The rolled rim: a rail round the top, standing a little proud of the hull.
        const rail = 0.12;
        for (const sz of [-1, 1]) add(this.boxMesh(L * 2 + rail, rail, rail, trim, 0, H - rail / 2, sz * (W / 2)));
        for (const sx of [-1, 1]) add(this.boxMesh(rail, rail, W + rail, trim, sx * L, H - rail / 2, 0));
        // Channel ribs: two up each long side, clear of the name board, and one up the middle of each sloping end.
        for (const sz of [-1, 1]) for (const fx of [-0.6, 0.6]) add(this.boxMesh(0.12, H - rail, 0.05, trim, fx * foot, 0, sz * (W / 2 + 0.025)));
        const lean = Math.atan2(L - foot, H);
        const slope = Math.hypot(L - foot, H);
        for (const sx of [-1, 1]) {
          const rib = this.boxMesh(0.05, slope - rail, 0.12, trim, 0, -(slope - rail) / 2, 0);
          rib.position.set(sx * ((foot + L) / 2 + 0.02), (H - rail) / 2 + 0.02, 0);
          rib.rotation.z = -sx * lean;
          add(rib);
        }
        // Chain lugs: a steel block at each top corner of the long sides, a chain ring hung on it.
        for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
          add(this.boxMesh(0.16, 0.14, 0.1, steel, sx * (L - 0.35), H - 0.3, sz * (W / 2 + 0.05)));
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 10), steel);
          ring.position.set(sx * (L - 0.35), H - 0.33, sz * (W / 2 + 0.11));
          add(ring);
        }
        // The drop door at one end: a hinge bar along the foot and two latch straps up the slope.
        {
          const hinge = this.boxMesh(0.08, 0.08, W * 0.9, steel, foot + 0.02, 0.02, 0);
          add(hinge);
          for (const fz of [-0.3, 0.3]) {
            const strap = this.boxMesh(0.04, slope * 0.9, 0.08, steel, 0, -(slope * 0.9) / 2, 0);
            strap.position.set((foot + L) / 2 + 0.04, H / 2 + 0.03, fz * W);
            strap.rotation.z = -lean;
            add(strap);
          }
        }
        // The name board painted on each long side.
        {
          const face = this.mat(0xffffff, { map: this.textTexture(text || 'SKIP HIRE', 0xf4f4f0, '#1a1a1a') });
          const edge = this.mat(0xf4f4f0);
          for (const sz of [-1, 1]) {
            const board = this.boxMesh(foot * 0.95, 0.3, 0.02, [edge, edge, edge, edge, sz > 0 ? face : edge, sz < 0 ? face : edge], 0, H * 0.4, sz * (W / 2 + 0.01));
            board.castShadow = false;
            add(board);
          }
        }
        // The load: a mound of rubble heaped over the rim, and the bigger pieces bedded into it.
        const rubble = this.mat(0x6a6058, { flatShading: true });
        // Rubble level with the rim right into the corners, and the heap rising out of it.
        add(this.boxMesh(L * 2, 0.07, W, rubble, 0, H - 0.04, 0));
        const mx = L - rail * 0.6;
        const mz = W / 2 - rail * 0.4;
        const rise = 0.34;
        const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), rubble);
        mound.scale.set(mx * 1.12, rise, mz * 1.2);
        mound.position.y = H - 0.02;
        mound.castShadow = true;
        mound.receiveShadow = true;
        add(mound);
        const moundTop = (x: number, z: number) => H - 0.02 + rise * Math.sqrt(Math.max(0, 1 - (x / (mx * 1.12)) ** 2 - (z / (mz * 1.2)) ** 2));
        // Planks and blocks, sunk a third of their height into the rubble.
        const pieces: [number, number, number, number, number, number, number][] = [
          [-0.45, 0.25, 1.1, 0.06, 0.18, 0.35, 0x8a6a44], [0.35, -0.2, 0.9, 0.06, 0.16, -0.5, 0x7a5c3a],
          [0.1, 0.3, 0.3, 0.2, 0.2, 0.2, 0xb0a898], [0.55, 0.2, 0.26, 0.18, 0.24, 0.9, 0x9a3a2a], [-0.2, -0.3, 0.3, 0.16, 0.22, 1.2, 0xa89c90],
        ];
        for (const [fx, fz, l, h, wd, ry, c] of pieces) {
          const x = fx * mx;
          const z = fz * mz;
          const m = this.boxMesh(l, h, wd, this.mat(c), x, moundTop(x, z) - h / 3, z);
          m.rotation.y = ry;
          add(m);
        }
        // A length of pipe and two rubble sacks.
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8), this.mat(0x4a4a50));
        pipe.rotation.set(0, 0.25, Math.PI / 2);
        pipe.position.set(-0.1 * mx, moundTop(-0.1 * mx, -0.45 * mz) - 0.02, -0.45 * mz);
        pipe.castShadow = true;
        add(pipe);
        for (const [fx, fz] of [[-0.6, -0.35], [0.7, 0.4]]) {
          const sack = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), this.mat(0xe8e4dc, { flatShading: true }));
          sack.scale.set(1.3, 0.75, 1);
          sack.position.set(fx * mx, moundTop(fx * mx, fz * mz) + 0.02, fz * mz);
          sack.castShadow = true;
          add(sack);
        }
        break;
      }
      default:
        add(this.boxMesh(w, 0.6, d, this.mat(color)));
    }
    return g;
  }

  /** A marshal: the stand as one mesh, the figure and its flag arm as two more the view animates, facing the middle of their watch unless turned. */
  private marshalFigure(g: THREE.Group, it: SceneryItem, def: SceneryDef): void {
    const i = this.itemIndex(it);
    const built = marshalParts(def, it, i);
    if (built.base.length) g.add(this.mergeParts(built.base));
    const figure = new THREE.Group();
    figure.position.set(built.feet[0] * METRE, built.feet[1] * METRE, built.feet[2] * METRE);
    const body = this.mergeParts(built.figure);
    body.position.set(-built.feet[0] * METRE, -built.feet[1] * METRE, -built.feet[2] * METRE);
    figure.add(body);
    const arm = this.mergeParts(built.arm);
    arm.geometry.translate(-built.shoulder[0] * METRE, -built.shoulder[1] * METRE, -built.shoulder[2] * METRE);
    arm.position.set((built.shoulder[0] - built.feet[0]) * METRE, (built.shoulder[1] - built.feet[1]) * METRE, (built.shoulder[2] - built.feet[2]) * METRE);
    figure.add(arm);
    g.add(figure);
    const watch = marshalWatch(this.surface.g, it);
    if (it.rot === undefined) {
      const at = watchFocus(this.surface.g, watch);
      g.rotation.y = -Math.atan2(at.y - it.y, at.x - it.x) + Math.PI / 2;
    }
    this.marshals.push({ watch, figure, arm, raise: 0, phase: noise(i * 29 + 7) * Math.PI * 2 });
  }

  /** The race's laps, for the flag man and the pit boards. */
  setLaps(laps: number | undefined): void {
    this.laps = laps;
  }

  /** An arm built apart from a figure, as a mesh pivoting at `at` (metres from the item's middle), its place set from the feet. */
  private pivotArm(parts: THREE.Mesh[], at: [number, number, number], feet: [number, number, number]): THREE.Mesh {
    const arm = this.mergeParts(parts);
    arm.geometry.translate(-at[0] * METRE, -at[1] * METRE, -at[2] * METRE);
    arm.position.set((at[0] - feet[0]) * METRE, (at[1] - feet[1]) * METRE, (at[2] - feet[2]) * METRE);
    return arm;
  }

  /** A figure group standing at the feet, with the body built in the item's frame. */
  private standingFigure(parts: THREE.Mesh[], feet: [number, number, number]): THREE.Group {
    const figure = new THREE.Group();
    figure.position.set(feet[0] * METRE, feet[1] * METRE, feet[2] * METRE);
    const body = this.mergeParts(parts);
    body.position.set(-feet[0] * METRE, -feet[1] * METRE, -feet[2] * METRE);
    figure.add(body);
    return figure;
  }

  /** Turns an item to face the nearest point of the track, unless it was turned by hand. */
  private faceTrack(g: THREE.Group, it: SceneryItem): void {
    if (it.rot !== undefined) return;
    const at = pointAt(this.surface.g, nearestOnLap(this.surface.g, it.x, it.y).f);
    g.rotation.y = -Math.atan2(at.y - it.y, at.x - it.x) + Math.PI / 2;
  }

  /** The flag man: his stand, the figure, and each arm with its flag, the view raising them in turn. */
  private flaggerFigure(g: THREE.Group, it: SceneryItem, def: SceneryDef): void {
    const i = this.itemIndex(it);
    const built = flaggerParts(def, it, i);
    if (built.base.length) g.add(this.mergeParts(built.base));
    const figure = this.standingFigure(built.figure, built.feet);
    const white = this.pivotArm(built.white, built.left, built.feet);
    const chequered = this.pivotArm(built.chequered, built.right, built.feet);
    figure.add(white, chequered);
    g.add(figure);
    this.faceTrack(g, it);
    const roofed = built.variant === 'tower';
    this.flaggers.push({ spot: crewSpot(this.surface.g, it), figure, white, chequered, wk: 0, ck: 0, reach: roofed ? 0.6 : 0.92, phase: noise(i * 31 + 3) * Math.PI * 2 });
  }

  /** A pit crew member: the figure, the arms with the pole, and the board with its words, which the view keeps up to date. */
  private pitCrewFigure(g: THREE.Group, it: SceneryItem, def: SceneryDef): void {
    const i = this.itemIndex(it);
    const built = pitCrewParts(def, it, i);
    if (built.base.length) g.add(this.mergeParts(built.base));
    const figure = this.standingFigure(built.figure, built.feet);
    const arms = this.pivotArm(built.arms, built.shoulder, built.feet);
    figure.add(arms);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.75 * METRE, 0.56 * METRE), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    figure.add(board);
    g.add(figure);
    this.faceTrack(g, it);
    const crew: PitCrew = {
      index: this.crews.length,
      spot: crewSpot(this.surface.g, it),
      figure,
      arms,
      board,
      boardAt: new THREE.Vector3(built.board[0] * METRE, built.board[1] * METRE, built.board[2] * METRE),
      shoulderAt: arms.position.clone(),
      canvas,
      texture,
      text: '',
      rider: null,
      k: 0,
    };
    this.drawBoard(crew, ['', '']);
    this.poseCrew(crew);
    this.crews.push(crew);
  }

  /** Paints a pit board: white with a black edge, the place big and the laps to go under it. */
  private drawBoard(c: PitCrew, [top, bottom]: [string, string]): void {
    const key = `${top}|${bottom}`;
    if (key === c.text && c.text) return;
    c.text = key;
    const ctx = c.canvas.getContext('2d')!;
    ctx.fillStyle = '#16161a';
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(5, 5, 118, 86);
    ctx.fillStyle = '#16161a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText(top, 64, bottom ? 34 : 48);
    if (bottom) {
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText(bottom, 64, 72);
    }
    c.texture.needsUpdate = true;
  }

  /** Puts the arms and the board where the crew's lean (k) has them: down by their side, or held out towards the track. */
  private poseCrew(c: PitCrew): void {
    const k = c.k;
    c.arms.rotation.x = -0.35 - 1.45 * k;
    c.figure.rotation.x = 0.2 * k;
    const p = c.boardAt.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), c.arms.rotation.x).add(c.shoulderAt);
    c.board.position.copy(p);
    // The board stands on the pole's end.
    c.board.position.y += 0.28 * METRE;
  }

  /**
   * The flag men and the pit crews: the white flag up as the leader comes up to start the last
   * lap, swapped for the chequered flag as they come up to finish, held until the last rider has
   * gone by; each pit crew leaning out with the board as their rider comes past.
   */
  updateFinishCrew(dt: number, clock: number, riders: ViewRider[]): void {
    const g = this.surface.g;
    const approach = APPROACH / g.total;
    const runners = riders.map((r) => r.pose);
    for (const f of this.flaggers) {
      const want = flagState(f.spot, approach, this.laps, runners);
      // The white flag comes down before the chequered goes up.
      const wantW = want === 'white' ? 1 : 0;
      const wantC = want === 'chequered' && f.wk < 0.15 ? 1 : 0;
      f.wk += Math.max(-dt * 2.2, Math.min(dt * 2.2, wantW - f.wk));
      f.ck += Math.max(-dt * 2.2, Math.min(dt * 2.2, wantC - f.ck));
      f.white.rotation.x = -f.reach * Math.PI * f.wk;
      f.white.rotation.z = 0.12 * f.wk * Math.sin(clock * 3 + f.phase);
      f.chequered.rotation.x = -f.reach * Math.PI * f.ck;
      f.chequered.rotation.z = -0.5 * f.ck * Math.sin(clock * 9 + f.phase);
      f.figure.rotation.x = 0.12 * Math.max(f.wk, f.ck);
    }
    if (!this.crews.length) return;
    if (riders.length && this.crews.some((c) => c.rider === null)) {
      const player = riders.find((r) => r.player)?.pose.id ?? '';
      const picks = assignCrews(this.crews.length, riders.map((r) => r.pose.id), player, this.crews.length + Math.round(g.total));
      this.crews.forEach((c, k) => (c.rider = picks[k] ?? ''));
    }
    for (const c of this.crews) {
      const r = riders.find((x) => x.pose.id === c.rider);
      const out = !!r && boardOut(c.spot, approach, BOARD_PAST / g.total, this.laps, r.pose.dist, r.pose.state);
      if (r && out) this.drawBoard(c, boardText(Number(r.label) || 0, this.laps, c.spot, approach, r.pose.dist));
      c.k += Math.max(-dt * 3, Math.min(dt * 3, (out ? 1 : 0) - c.k));
      this.poseCrew(c);
    }
  }

  /** Raises each marshal's flag while a rider is down on their watch: the arm swings up and waves, the figure leans out. */
  updateMarshals(dt: number, clock: number, riders: { dist: number; state: RiderState }[]): void {
    for (const m of this.marshals) {
      const want = flagUp(m.watch, riders) ? 1 : 0;
      m.raise += Math.max(-dt * 2.5, Math.min(dt * 2.5, want - m.raise));
      const k = m.raise;
      m.arm.rotation.z = k * 0.45 * Math.sin(clock * 7 + m.phase);
      m.arm.rotation.x = -0.9 * Math.PI * k;
      m.figure.rotation.x = 0.22 * k;
      m.figure.rotation.z = -0.06 * k * Math.sin(clock * 7 + m.phase);
    }
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
  /**
   * A cheering fan: the same box figure as the official (legs, body, head, arms that swing at the
   * shoulder), sized by its variant and dressed in its colour. Placed where the item is; if it
   * has a route it walks in along it when the view starts (updateCheers), and stands at the end
   * facing the track.
   */
  private cheerFigure(g: THREE.Group, it: SceneryItem): void {
    const i = this.itemIndex(it);
    const variant = cheerVariant(it, i);
    const sc = VARIANT_SCALE[variant];
    const figure = new THREE.Group();
    figure.scale.set(OFFICIAL_SCALE * sc.w, OFFICIAL_SCALE * sc.h, OFFICIAL_SCALE * sc.w);
    const kit = this.mat(hex(cheerColour(it, i), 0xe04040));
    const trousers = this.mat([0x2a3a5a, 0x4a4a50, 0x6a5040, 0x3a5a3a][Math.floor(noise(i * 17 + 9) * 4)]);
    const skin = this.mat([0xe0b090, 0xc08860, 0x8a5a3a, 0xf0d0b0][Math.floor(noise(i * 19 + 11) * 4)]);
    const legs = [-0.1, 0.1].map((x) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0.7, 0);
      leg.add(this.boxMesh(0.12, 0.7, 0.14, trousers, 0, -0.7, 0));
      figure.add(leg);
      return leg;
    });
    const body = this.boxMesh(0.42, 0.62, 0.24, kit, 0, 0.7, 0);
    figure.add(body);
    figure.add(this.boxMesh(0.22, 0.22, 0.22, skin, 0, 1.34, 0));
    const arms = [-1, 1].map((sd) => {
      const arm = new THREE.Group();
      arm.position.set(sd * 0.27, 1.24, 0.04);
      // Hung from the shoulder: the box sits below its pivot, so the arm swings from the shoulder, not its middle.
      arm.add(this.boxMesh(0.09, 0.8, 0.09, skin, 0, -0.8, 0));
      figure.add(arm);
      return arm;
    });
    g.add(figure);
    const route = cheerRoute(it);
    // Where they end up they face the track (the nearest point of it), unless turned by hand.
    const end = route[route.length - 1];
    let facing = -(((it.rot ?? 0) * Math.PI) / 180);
    if (it.rot === undefined) {
      let best = Infinity;
      let fx = end.x + 1;
      let fy = end.y;
      for (let f = 0; f < 1; f += 0.005) {
        const p = this.surface.spot(f, 0);
        const d = Math.hypot(p.x - end.x, p.z - end.y);
        if (d < best) { best = d; fx = p.x; fy = p.z; }
      }
      facing = -Math.atan2(fy - end.y, fx - end.x) + Math.PI / 2;
    }
    const tm = cheerTiming(i);
    this.cheers.push({ i, group: g, figure, legs, arms, body, action: cheerAction(it, i), route, length: routeLength(route), walked: 0, facing, restUntil: tm.delay, reactAt: -Infinity, rest: tm.rest, delay: tm.delay, phase: noise(i * 23 + 13) * Math.PI * 2 });
    g.rotation.y = route.length > 1 ? -Math.atan2(route[1].y - route[0].y, route[1].x - route[0].x) + Math.PI / 2 : facing;
  }

  /**
   * Moves the fans on by dt seconds: walking in along their route when the view starts (a steady
   * walking pace, never a jump), and, standing, reacting to a bike within CHEER_RANGE with their
   * own action, each after their own delay and with their own rest between, so a crowd never moves
   * as one. Cheap: one distance a fan a bike.
   */
  updateCheers(dt: number, bikes: { x: number; z: number }[]): void {
    if (!this.cheers.length) return;
    this.cheerClock += dt;
    const now = this.cheerClock;
    const r2 = CHEER_RANGE * CHEER_RANGE;
    for (const c of this.cheers) {
      const walking = c.walked < c.length;
      if (walking) {
        const before = alongRoute(c.route, c.walked);
        c.walked = Math.min(c.length, c.walked + CHEER_WALK * dt);
        const at = alongRoute(c.route, c.walked);
        c.group.position.set(at.x, this.heightAt(at.x, at.y), at.y);
        if (Math.hypot(at.x - before.x, at.y - before.y) > 1e-6) c.group.rotation.y = -Math.atan2(at.y - before.y, at.x - before.x) + Math.PI / 2;
        if (c.walked >= c.length) c.group.rotation.y = c.facing;
        const swing = 0.45 * Math.sin((c.walked / 0.55) * Math.PI);
        c.legs[0].rotation.x = swing;
        c.legs[1].rotation.x = -swing;
        for (const a of c.arms) a.rotation.set(-swing * 0.6, 0, 0);
        continue;
      }
      c.legs[0].rotation.x = c.legs[1].rotation.x = 0;
      const p = c.group.position;
      // A bike passing sets them off, once rested; the reaction then plays out on its own.
      if (now >= c.restUntil && now - c.reactAt >= REACT_SECONDS && bikes.some((b) => (b.x - p.x) ** 2 + (b.z - p.z) ** 2 <= r2)) {
        c.reactAt = now;
        c.restUntil = now + REACT_SECONDS + c.rest;
      }
      const k = (now - c.reactAt) / REACT_SECONDS;
      if (k >= 0 && k < 1) this.poseCheer(c, k);
      else {
        // Resting: a slight sway, each to their own beat.
        const sway = 0.06 * Math.sin(now * 1.7 + c.phase);
        c.arms[0].rotation.set(sway, 0, 0.05);
        c.arms[1].rotation.set(-sway, 0, -0.05);
        c.figure.position.y = 0;
      }
    }
  }

  /** One frame of a fan's reaction, k from 0 (start) to 1 (over): arms, and for a celebration a hop. */
  private poseCheer(c: Cheer, k: number): void {
    // In quickly, hold, out gently.
    const env = k < 0.2 ? k / 0.2 : k > 0.75 ? (1 - k) / 0.25 : 1;
    const up = -Math.PI * env;
    const [left, right] = c.arms;
    c.figure.position.y = 0;
    switch (c.action) {
      case 'arms_up':
        left.rotation.set(up, 0, 0.25 * env);
        right.rotation.set(up, 0, -0.25 * env);
        break;
      case 'wave':
        left.rotation.set(0.1 * env, 0, 0.05);
        right.rotation.set(up, 0, -0.45 * env * Math.sin(k * Math.PI * 6));
        break;
      case 'clap': {
        const meet = 0.32 * env * (0.5 + 0.5 * Math.sin(k * Math.PI * 8));
        left.rotation.set(-Math.PI / 2 * env, 0, -meet);
        right.rotation.set(-Math.PI / 2 * env, 0, meet);
        break;
      }
      case 'fist_pump':
        left.rotation.set(0.1 * env, 0, 0.05);
        right.rotation.set((-Math.PI / 2 - (Math.PI / 2) * (0.5 + 0.5 * Math.sin(k * Math.PI * 6))) * env, 0, -0.15 * env);
        break;
      case 'celebrate':
        left.rotation.set(up, 0, 0.35 * env * Math.sin(k * Math.PI * 4));
        right.rotation.set(up, 0, -0.35 * env * Math.sin(k * Math.PI * 4));
        c.figure.position.y = 0.22 * Math.abs(Math.sin(k * Math.PI * 3)) * env;
        break;
    }
  }

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

  /**
   * A small motocross bike and rider facing +x, wheels on y = 0: the race-day model in the bike's
   * brand colours and the rider's gear when the look is known, otherwise a plain bike in the
   * rider's colour. Either way the wheels are BIKE_LENGTH apart, centred on the root.
   */
  private makeBike(color: number, player: boolean, look?: RaceLook): Bike {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    // Your own race bike and rider models (world/modModels.ts), painted in this rider's colours.
    const c0 = bikeColours(color, player, look);
    const custom = this.builtIn ? { bike: null, rider: null } : { bike: bikeModel(!!look && bikeKind(look.cls) === 'youth'), rider: riderModel() };
    if (custom.bike) paintModel(custom.bike, { plastics: c0.plastics, frame: c0.frame, plate: c0.plate }, BIKE_PAINT);
    if (look) {
      const all = raceBikeParts(look, BIKE_LENGTH);
      const bikeOnly = raceBikeParts(look, BIKE_LENGTH, { rider: false }).length;
      const g = look.gear;
      const kit = { helmet: g.helmet, visor: g.visor, jersey: g.jersey, pants: g.pants, boot: g.boot, glove: g.glove };
      return this.finishBike(root, body, all.slice(0, bikeOnly), all.slice(bikeOnly), kit, custom);
    }
    const L = BIKE_LENGTH;
    const r = 0.22;
    const c = bikeColours(color, player, look);
    const dark = this.mat(0x1c1c22);
    const paint = this.mat(c.plastics);
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
    piece(L * 0.62, 0.1, 0.1, this.mat(c.frame), 0, r + 0.12, 0, 0.05); // frame
    piece(0.42, 0.14, 0.2, paint, 0.08, r + 0.3); // tank and seat
    piece(0.36, 0.08, 0.18, dark, -0.22, r + 0.32); // seat
    piece(0.07, 0.52, 0.06, this.mat(0xc0c0c8), L / 2 - 0.08, r + 0.22, 0.07, 0.35); // forks
    piece(0.07, 0.52, 0.06, this.mat(0xc0c0c8), L / 2 - 0.08, r + 0.22, -0.07, 0.35);
    piece(0.1, 0.2, 0.22, this.mat(c.plate), L / 2 - 0.02, r + 0.5, 0, 0.3); // number plate
    piece(0.42, 0.04, 0.14, paint, L / 2 - 0.12, r + 0.27, 0, -0.1); // front guard
    piece(0.3, 0.04, 0.14, paint, -L / 2 + 0.05, r + 0.3, 0, 0.25); // rear guard
    // Rider: legs, body leaning over the bars, arms and helmet.
    const riderFrom = parts.length;
    piece(0.34, 0.1, 0.1, this.mat(c.legs), -0.04, r + 0.42, 0.13, -0.6);
    piece(0.34, 0.1, 0.1, this.mat(c.legs), -0.04, r + 0.42, -0.13, -0.6);
    piece(0.2, 0.4, 0.28, this.mat(c.torso), -0.02, r + 0.68, 0, -0.45);
    piece(0.36, 0.07, 0.07, this.mat(c.arms), 0.2, r + 0.74, 0.15, 0.25);
    piece(0.36, 0.07, 0.07, this.mat(c.arms), 0.2, r + 0.74, -0.15, 0.25);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), this.mat(c.helmet));
    helmet.position.set(0.12, r + 0.98, 0);
    parts.push(helmet);
    piece(0.08, 0.06, 0.18, this.mat(c.visor), 0.24, r + 0.97); // visor
    return this.finishBike(root, body, parts.slice(0, riderFrom), parts.slice(riderFrom), { helmet: c.helmet, visor: c.visor, jersey: c.torso, pants: c.legs, boot: 0x1c1c22, glove: c.arms }, custom);
  }

  private finishBike(root: THREE.Group, body: THREE.Group, parts: THREE.Mesh[], riderParts: THREE.Mesh[], kit: Kit, custom: { bike: THREE.Group | null; rider: THREE.Group | null } = { bike: null, rider: null }): Bike {
    // One mesh for the bike and one for the rider, coloured per part, so a field costs two draws each.
    body.add(custom.bike ?? this.mergeParts(parts));
    const rider = new THREE.Group();
    const seat = new THREE.Vector3(0, 0.55, 0);
    if (custom.rider) {
      paintModel(custom.rider, { helmet: kit.helmet, visor: kit.visor, jersey: kit.jersey, pants: kit.pants, boots: kit.boot, gloves: kit.glove }, RIDER_PAINT);
      const box = new THREE.Box3().setFromObject(custom.rider);
      seat.set((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * 0.35, 0);
      rider.add(custom.rider);
    } else if (riderParts.length) {
      const mesh = this.mergeParts(riderParts);
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      seat.set((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * 0.35, 0);
      rider.add(mesh);
    }
    root.add(rider);
    this.scene3.add(root);
    const label = this.scene.add.text(0, 0, '', { fontFamily: 'Trebuchet MS, sans-serif', fontSize: '13px', color: '#ffffff', fontStyle: 'bold', stroke: '#14141e', strokeThickness: 3, resolution: TEXT_RES }).setOrigin(0.5, 1);
    this.labels.add(label);
    return { root, body, rider, seat, side: (this.bikes.size % 2) * 2 - 1, kit, label };
  }

  /** A rider on foot in their kit, feet at the origin, facing +x, about as tall as the seated rider. */
  private makeRunner(root: THREE.Group, kit: Kit): Runner {
    const group = new THREE.Group();
    const part = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, this.mat(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const HIP = 0.36;
    const limb = (len: number, r: number, color: number, end: number, endR: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      part(new THREE.CapsuleGeometry(r, len - 2 * r, 3, 8), color, 0, -len / 2, 0, pivot);
      part(new THREE.SphereGeometry(endR, 8, 6), end, 0.02, -len, 0, pivot);
      parent.add(pivot);
      return pivot;
    };
    const legs: [THREE.Group, THREE.Group] = [limb(HIP - 0.04, 0.065, kit.pants, kit.boot, 0.07, 0, HIP, -0.08, group), limb(HIP - 0.04, 0.065, kit.pants, kit.boot, 0.07, 0, HIP, 0.08, group)];
    const upper = new THREE.Group();
    upper.position.set(0, HIP, 0);
    group.add(upper);
    part(new THREE.BoxGeometry(0.2, 0.3, 0.3), kit.jersey, 0, 0.15, 0, upper);
    part(new THREE.SphereGeometry(0.17, 12, 10), kit.helmet, 0.02, 0.45, 0, upper);
    part(new THREE.BoxGeometry(0.06, 0.08, 0.2), kit.visor, 0.17, 0.45, 0, upper);
    const arms: [THREE.Group, THREE.Group] = [limb(0.28, 0.05, kit.jersey, kit.glove, 0.05, 0, 0.27, -0.19, upper), limb(0.28, 0.05, kit.jersey, kit.glove, 0.05, 0, 0.27, 0.19, upper)];
    group.visible = false;
    root.add(group);
    return { group, upper, legs, arms };
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
        b = this.makeBike(r.color, r.player, r.look);
        this.bikes.set(p.id, b);
      }
      // Not on show: waiting off the start platform for their turn, or gone from the run-off (riderAI).
      if (p.hidden) {
        b.root.visible = false;
        b.label.setVisible(false);
        continue;
      }
      let dist = p.dist;
      // The second start row waits a bike length behind the gate and closes up as the race starts.
      if (r.startRow && s.onStart(p.dist)) dist -= (r.startRow * BIKE_LENGTH * 1.4 * Math.max(0, Math.min(1, 1 - clock / 2))) / s.g.total;
      const f = dist - Math.floor(dist);
      const onStart = s.onStart(dist);
      const [back, front] = s.wheelsAt(dist, p.lane, p.flight);
      // Off the track (a rider who has pulled off) the wheels sit on the ground.
      for (const wh of [back, front]) wh.y = Math.max(wh.y, this.terrainAt(wh.x, wh.z));
      const mx = (back.x + front.x) / 2;
      const mz = (back.z + front.z) / 2;
      let my = (back.y + front.y) / 2;
      let yaw = Math.atan2(front.z - back.z, front.x - back.x);
      const run = Math.hypot(front.x - back.x, front.z - back.z);
      // A bike tips with the ground under its wheels, but never further than a steep jump face.
      let pitch = Math.max(-0.7, Math.min(0.7, Math.atan2(front.y - back.y, run)));
      // In the air it flies as one piece: its middle on the hop's arc, turning steadily from the
      // angle of the face it left to the angle of the landing.
      const flying = onStart ? null : this.inFlight(p.flight, f, p.lane);
      if (flying) {
        if (flying.y !== null) my = flying.y;
        pitch = flying.pitch;
      }
      // Lean into the corner, more the faster the bike.
      let lean = Math.max(-0.6, Math.min(0.6, s.curvatureAt(dist) * Math.min(p.speed, 20) * 0.9));
      if (p.state === 'wobble') yaw += 0.35 * Math.sin(clock * 16);
      b.root.position.set(mx, my, mz);
      b.root.rotation.set(0, -yaw, 0);
      b.body.rotation.set(0, 0, 0, 'XYZ');
      b.body.position.set(0, 0, 0);
      if (p.down) {
        // Thrown off, back on foot, back to the bike and on again (crashRecovery.ts); after a whip or
        // scrub gone wrong it goes down on the side it was laid over to.
        const bail = onStart ? null : this.bailAt(p.flight, f);
        this.recover(b, p.down, p.stunt?.kind === 'loop', bail?.dir ?? b.side);
        lean = 0;
      } else if (p.state === 'crashed') {
        // Down on its side, sliding: after a whip or scrub gone wrong, on the side it was laid over to.
        const bail = onStart ? null : this.bailAt(p.flight, f);
        b.body.rotation.set((bail?.dir ?? 1) * (Math.PI / 2.2), bail ? -bail.dir * 0.5 : 0, 0);
        b.body.position.set(0, 0.12, 0);
        lean = 0;
      } else {
        b.body.rotation.z = pitch;
        b.body.rotation.x = lean;
        const trick = onStart ? null : this.trickAt(p.flight, f);
        if (trick) {
          // Swung across the line of flight and laid over, about the bike's middle, not its wheels; a
          // whip swings the rear out round the headstock.
          b.body.rotation.order = 'YXZ';
          b.body.rotation.set(lean + trick.roll, trick.yaw, pitch);
          TRICK_PIVOT.set(trick.kind === 'whip' ? BIKE_LENGTH * 0.35 : 0, 0.45, 0);
          b.body.position.copy(TRICK_PIVOT).sub(TRICK_PIVOT.clone().applyEuler(b.body.rotation));
        }
      }
      if (!p.down) {
        if (b.runner) b.runner.group.visible = false;
        b.rider.visible = true;
        if (p.stunt?.kind === 'loop') this.loopOut(b, p.stunt.t);
        else {
          b.rider.position.copy(b.body.position);
          b.rider.quaternion.copy(b.body.quaternion);
        }
      }
      b.root.visible = !!p.down || !(p.state === 'remount' && !blink);
      if (p.id === focus) target = new THREE.Vector3(mx, my, mz);
      if (r.player) this.marker.position.set(mx, my + 1.75 + 0.08 * Math.sin(clock * 4), mz);
      b.label.setText(r.player ? '' : r.label).setVisible(!r.player && p.state !== 'retired');
      // Dust off the back wheel.
      if (dc > 0 && p.speed > 6 && p.air < 0.15 && p.state === 'riding' && Math.abs(p.lane) <= 1) {
        const n = Math.min(2, dc * p.speed * 0.12);
        const water = !onStart && (this.patchAt(f) === 0x4a86c0 || this.waterSpans.some(([a, b]) => f >= a && f <= b));
        for (let k = 0; k < n || (k === 0 && noise(clock * 977 + mx) < n); k++) this.puff(back.x, back.y + 0.1, back.z, water ? 0xdff0ff : 0xcaa478);
      }
    }
    this.agePuffs(Math.min(1, dc * 1.4 + dt * 0.3));
    if (this.laps && this.showFireworks && hasFireworks(this.track.kind)) this.updateFireworks(dc, riders);
    this.updateStart(clock);
    if (this.marshals.length) this.updateMarshals(Math.min(0.1, dt), clock, riders.map((r) => r.pose));
    if (this.flaggers.length || this.crews.length) this.updateFinishCrew(Math.min(0.1, dt), clock, riders);
    if (this.cheers.length) {
      const spots: { x: number; z: number }[] = [];
      for (const r of riders) { const b = this.bikes.get(r.pose.id); if (b && r.pose.state !== 'retired') spots.push({ x: b.root.position.x, z: b.root.position.z }); }
      this.updateCheers(Math.min(0.1, dt), spots);
    }
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

  /**
   * A rider down after a crash, t seconds in (crashRecovery.ts): thrown a short way off the bike
   * (or off the back, after a loop-out), down a moment, up, running back to it, lifting it upright
   * by the bars from its top side, and back on. `side` is the side the bike goes down on.
   */
  private recover(b: Bike, down: { t: number; lost: number }, loop: boolean, side: number): void {
    const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
    const { phase, k } = downPhase(down.t, down.lost);
    const runner = (b.runner ??= this.makeRunner(b.root, b.kit));
    const thrown = phase === 'thrown';
    // The bike lying where it fell, and the rider lying where they landed.
    const LIE = new THREE.Euler(side * 0.35, 0, Math.PI / 2, 'XYZ');
    let hip: THREE.Vector3;
    if (loop) {
      this.loopOut(b, thrown ? Math.min(k * 0.7, 0.7) : 0.7);
      hip = new THREE.Vector3(-BIKE_LENGTH / 2 - 0.55, 0.12, b.side * 0.5);
      side = b.side;
    } else {
      const fall = thrown ? smooth(k / 0.5) : 1;
      b.body.rotation.set(side * (Math.PI / 2.2) * fall, -side * 0.5 * fall, 0, 'XYZ');
      b.body.position.set(0, 0.12 * fall, 0);
      hip = new THREE.Vector3(BIKE_LENGTH * 1.5, 0.12, side * 0.85);
      if (thrown) {
        // Over the bars in a short tumbling arc, landing on their back.
        const start = b.seat.clone();
        const at = start.clone().lerp(hip, smooth(k));
        at.y = start.y + (0.12 - start.y) * smooth(k) + 0.35 * Math.sin(Math.PI * k);
        b.rider.rotation.set(side * (0.35 + 2 * Math.PI * smooth(k)), 0, (Math.PI / 2) * smooth(k), 'XYZ');
        b.rider.position.copy(at).sub(b.seat.clone().applyEuler(b.rider.rotation));
      }
    }
    if (thrown || phase === 'down') {
      runner.group.visible = false;
      b.rider.visible = true;
      if (phase === 'down') {
        b.rider.rotation.copy(LIE);
        b.rider.position.copy(hip).sub(b.seat.clone().applyEuler(LIE));
      }
      return;
    }
    // Back on foot. The spot to lift the bike from: beside its bars on its top side.
    const lying = { pos: b.body.position.clone(), quat: b.body.quaternion.clone() };
    const spot = new THREE.Vector3(BIKE_LENGTH * 0.25, 0, side * 0.75);
    const g = runner.group;
    const face = (dx: number, dz: number) => Math.atan2(-dz, dx);
    const pose = (legSwing: number, armSwing: number, bend: number, reach: number) => {
      runner.legs[0].rotation.set(0, 0, legSwing);
      runner.legs[1].rotation.set(0, 0, -legSwing);
      runner.arms[0].rotation.set(0, 0, -armSwing + reach);
      runner.arms[1].rotation.set(0, 0, armSwing + reach);
      runner.upper.rotation.set(0, 0, -bend);
    };
    b.rider.visible = phase === 'mount' && k >= 0.6;
    g.visible = !b.rider.visible;
    if (phase === 'up') {
      // Up off their back, turning to face the bike.
      const e = smooth(k);
      g.position.set(hip.x, 0, hip.z);
      g.rotation.set(0, face(spot.x - hip.x, spot.z - hip.z), (Math.PI / 2) * (1 - e), 'YXZ');
      pose(0.6 * (1 - e), 0, 0.5 * (1 - e), 0.4 * (1 - e));
    } else if (phase === 'run') {
      const at = hip.clone().lerp(spot, smooth(k));
      g.position.set(at.x, 0.04 * Math.abs(Math.sin(k * Math.PI * 4)), at.z);
      g.rotation.set(0, face(spot.x - hip.x, spot.z - hip.z), 0, 'YXZ');
      const swing = 0.9 * Math.sin(k * Math.PI * 4) * Math.min(1, k * 4, (1 - k) * 4);
      pose(swing, swing * 0.8, 0.25, 0);
    } else if (phase === 'lift') {
      // Bent over the bars, then straightening as the bike comes up.
      g.position.set(spot.x, 0, spot.z);
      g.rotation.set(0, face(0, -side), 0, 'YXZ');
      const e = smooth(k);
      pose(0.15, 0, 0.9 * (1 - e) + 0.15, 1.3 - 0.5 * e);
      b.body.quaternion.slerpQuaternions(lying.quat, IDENTITY, e);
      b.body.position.lerpVectors(lying.pos, ORIGIN, e);
    } else {
      // A leg over and sat on.
      b.body.rotation.set(0, 0, 0, 'XYZ');
      b.body.position.set(0, 0, 0);
      const e = smooth(k / 0.6);
      g.position.set(spot.x + (b.seat.x - spot.x) * e, 0.1 * Math.sin(Math.PI * e), spot.z * (1 - e));
      g.rotation.set(0, face(1, 0) * e + face(0, -side) * (1 - e), 0, 'YXZ');
      pose(0.8 * Math.sin(Math.PI * e), 0, 0.2, 1.1);
      b.rider.position.set(0, 0, 0);
      b.rider.rotation.set(0, 0, 0);
    }
  }

  /**
   * A loop-out out of the gate (riderAI LOOP_RISE), t seconds from the rider coming off: the front
   * comes up as the rider holds it wide open, the wheelie goes past the balance point and the bike
   * goes over backwards on its rear wheel, landing upside down behind it. The rider is pitched off
   * the back as it passes the point of no return and lands on their back to one side, clear of it.
   */
  private loopOut(b: Bike, t: number): void {
    const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
    const ease = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k; };
    const axle = LOOP_AXLE.set(-BIKE_LENGTH / 2, 0.22, 0);
    const lost = 1.25;
    const pivot = (theta: number, out: THREE.Vector3, from: THREE.Vector3) => out.copy(from).sub(axle).applyAxisAngle(Z_AXIS, theta).add(axle);
    // The bike: up to the balance point, then over, then lying on its back (lifted onto its bars and seat).
    const over = ease(t / 0.7);
    const theta = t < 0 ? lost * ease((t + LOOP_RISE) / LOOP_RISE) : lost + (Math.PI - lost) * over;
    b.body.rotation.set(t < 0 ? 0 : b.side * 0.35 * smooth(t / 0.7), 0, theta, 'XYZ');
    // Turned about the rear axle, which stays on the ground.
    b.body.position.copy(axle).sub(LOOP_TMP.copy(axle).applyEuler(b.body.rotation));
    b.body.position.y += 0.34 * smooth(t / 0.7);
    if (t < 0) {
      b.rider.position.copy(b.body.position);
      b.rider.quaternion.copy(b.body.quaternion);
      return;
    }
    // The rider: from the seat at the balance point, off the back in a short arc, onto their back to the side.
    const k = smooth(t / 0.55);
    const start = pivot(lost, LOOP_TMP, b.seat);
    const hip = new THREE.Vector3(-BIKE_LENGTH / 2 - 0.55, 0.12, b.side * 0.5);
    hip.lerp(start, 1 - k);
    hip.y = start.y + (0.12 - start.y) * k + 0.25 * Math.sin(Math.PI * k);
    b.rider.rotation.set(b.side * 0.35 * k, 0, lost + (Math.PI / 2 - lost) * k, 'XYZ');
    b.rider.position.copy(hip).sub(b.seat.clone().applyEuler(b.rider.rotation));
  }

  /**
   * A whip or scrub in progress at lap fraction f of a flight, as the turn of the bike (tricks.ts),
   * or null. A scrub starts leaning over on the face, APPROACH metres before the lip.
   */
  private trickAt(flight: Flight | null, f: number): { yaw: number; roll: number; kind: Trick['kind'] } | null {
    if (!flight?.tricks) return null;
    const pre = TRICK_APPROACH / this.lapMetres;
    for (let i = 0; i < flight.hops.length; i++) {
      const [f0, f1] = flight.hops[i];
      const t = flight.tricks[i];
      if (!t || f >= f1) continue;
      if (f > f0) return { ...trickPose(t, (f - f0) / (f1 - f0)), kind: t.kind };
      if (t.kind === 'scrub' && f > f0 - pre) return { ...trickPose(t, (f - f0) / pre), kind: t.kind };
    }
    return null;
  }

  /**
   * A bike in the air at lap fraction f (its middle between a hop's take-off and landing): where
   * its middle is on the arc, and its pitch. Turned by its wheels' heights instead, a bike on a
   * short hop (a single) dipped its nose as soon as the front wheel passed the top of the arc,
   * while the back wheel was still on the face, so it looked as if it rolled over the lip and
   * left the ground late (Boss, 30 Oct 2026). A real bike leaves nose up at the face's angle and
   * rotates slowly to meet the landing.
   */
  private inFlight(flight: Flight | null, f: number, lane: number): { y: number | null; pitch: number } | null {
    if (!flight) return null;
    const s = this.surface;
    const half = BIKE_LENGTH / 2 / s.g.total;
    const angle = (at: number) => {
      const [back, front] = s.wheels(at, lane, flight);
      return Math.max(-0.7, Math.min(0.7, Math.atan2(front.y - back.y, BIKE_LENGTH)));
    };
    for (const [f0, f1] of flight.hops) {
      // From the front wheel reaching the lip to the back wheel touching down.
      const from = f0 - half;
      const to = f1 + half;
      if (f <= from || f >= to) continue;
      const k = (f - from) / (to - from);
      const e = k * k * (3 - 2 * k);
      // Its middle rides the arc while it is over the gap; either end, its wheels still say where it is.
      return { y: f > f0 && f < f1 ? s.flightY(f, lane, flight) : null, pitch: angle(from) * (1 - e) + angle(to) * e };
    }
    return null;
  }

  /** The trick gone wrong a rider has just landed from at lap fraction f, if any: they go down on its side. */
  private bailAt(flight: Flight | null, f: number): Trick | null {
    if (!flight?.tricks) return null;
    const near = 6 / this.lapMetres;
    for (let i = 0; i < flight.hops.length; i++) {
      const t = flight.tricks[i];
      if (t?.bail && f >= flight.hops[i][1] - near && f <= flight.hops[i][1] + near) return t;
    }
    return null;
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

  /**
   * The finish fireworks (core/fireworks.ts, Boss, 30 Oct 2026): from a little before the winner
   * crosses the line, rockets go up from the tops of the finish arch's posts and burst over the
   * track. Run on the race clock, so they stop with Pause. A track with no arch has them go up from
   * either side of the finish line.
   */
  private updateFireworks(dc: number, riders: ViewRider[]): void {
    const s = this.surface;
    if (!this.fireworks) {
      if (!fireworksDue(this.laps, FIREWORK_LEAD / s.g.total, riders.map((r) => r.pose))) return;
      if (!this.archTops.length) {
        const f = s.raised ? 1 - 1e-4 : 0;
        const top = s.height(f, 0) + 5;
        this.archTops.push([-1, 1].map((side) => {
          const p = s.spot(f, side * 1.2);
          return new THREE.Vector3(p.x, top, p.z);
        }) as [THREE.Vector3, THREE.Vector3]);
      }
      this.fireworks = { show: fireworkShow(), at: 0, sparks: null, pos: new Float32Array(SPARKS * 3), col: new Float32Array(SPARKS * 3), vel: new Float32Array(SPARKS * 3), life: new Float32Array(SPARKS), full: new Float32Array(SPARKS), base: new Float32Array(SPARKS * 3), free: 0 };
      const fw = this.fireworks;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(fw.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(fw.col, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, map: this.puffMap, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      fw.sparks = new THREE.Points(geo, mat);
      fw.sparks.frustumCulled = false;
      this.scene3.add(fw.sparks);
    }
    const fw = this.fireworks;
    if (dc <= 0) return;
    const at = fw.at + dc;
    fw.at = at;
    const spark = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number) => {
      const i = fw.free;
      fw.free = (i + 1) % SPARKS;
      fw.pos.set([x, y, z], i * 3);
      fw.vel.set([vx, vy, vz], i * 3);
      fw.base.set([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255], i * 3);
      fw.life[i] = life;
      fw.full[i] = life;
    };
    // Each rocket in the air leaves a trail of sparks, and bursts at the top of its climb.
    fw.show.forEach((r, k) => {
      if (at < r.t) return;
      const u0 = (at - dc - r.t) / ROCKET_RISE;
      const u = (at - r.t) / ROCKET_RISE;
      if (u0 >= 1) return;
      for (const [a, b] of this.archTops) {
        const from = r.side < 0 ? a : b;
        const to = r.side < 0 ? b : a;
        const across = to.clone().sub(from).setY(0).normalize();
        const where = (v: number) => {
          const e = 1 - (1 - Math.min(1, v)) ** 2;
          return from.clone().addScaledVector(across, r.drift * v).setY(from.y + r.height * e);
        };
        const p = where(u);
        if (u < 1) {
          spark(p.x, p.y, p.z, 0, -0.6, 0, 0.35, 0xffe0a0);
          continue;
        }
        for (let n = 0; n < r.sparks; n++) {
          // Spread evenly over a sphere, a little jitter so no two bursts look the same.
          const yv = 1 - (2 * (n + 0.5)) / r.sparks;
          const rad = Math.sqrt(1 - yv * yv);
          const th = n * 2.39996 + k;
          const sp = 3.4 + noise(k * 131 + n) * 1.4;
          const c = noise(k * 17 + n) < 0.08 ? 0xffffff : r.color;
          spark(p.x, p.y, p.z, Math.cos(th) * rad * sp, yv * sp, Math.sin(th) * rad * sp, 1.3 + noise(k * 7 + n * 3) * 0.7, c);
        }
      }
    });
    // Sparks slow in the air, fall, and fade out with a twinkle at the end.
    const drag = Math.exp(-dc * 1.6);
    for (let i = 0; i < SPARKS; i++) {
      if (fw.life[i] <= 0) continue;
      fw.life[i] -= dc;
      const j = i * 3;
      fw.vel[j] *= drag;
      fw.vel[j + 1] = fw.vel[j + 1] * drag - 4 * dc;
      fw.vel[j + 2] *= drag;
      fw.pos[j] += fw.vel[j] * dc;
      fw.pos[j + 1] += fw.vel[j + 1] * dc;
      fw.pos[j + 2] += fw.vel[j + 2] * dc;
      const k = Math.max(0, fw.life[i] / fw.full[i]);
      const glow = k < 0.3 ? k * (0.5 + 0.5 * Math.sin(fw.life[i] * 60 + i)) * 3 : Math.min(0.85, k * 1.4);
      fw.col[j] = fw.base[j] * glow;
      fw.col[j + 1] = fw.base[j + 1] * glow;
      fw.col[j + 2] = fw.base[j + 2] * glow;
    }
    // An orthographic camera draws points a fixed number of pixels across: kept at a spark's size in the scene.
    const c = this.camera;
    (fw.sparks!.material as THREE.PointsMaterial).size = (SPARK_SIZE * this.renderer.domElement.height * c.zoom) / (c.top - c.bottom);
    const geo = fw.sparks!.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
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
    if (this.editCam) {
      const e = this.editCam;
      const az = THREE.MathUtils.degToRad(CAM_AZ + e.az);
      const el = THREE.MathUtils.degToRad(CAM_EL);
      this.dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const halfW = this.viewUnits / 2 / e.zoom;
      const halfH = (halfW * this.h) / this.w;
      const c = this.camera;
      if (c.right !== halfW || c.top !== halfH) {
        Object.assign(c, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
        c.updateProjectionMatrix();
      }
      this.cam = new THREE.Vector3(e.x, this.terrainAt(e.x, e.z), e.z);
      this.camera.position.copy(this.cam).addScaledVector(this.dir, 120);
      this.camera.lookAt(this.cam);
      this.sun.position.copy(this.cam).add(new THREE.Vector3(-30, 60, -12));
      this.sun.target.position.copy(this.cam);
      const sc = this.sun.shadow.camera;
      const reach = Math.max(this.viewUnits, halfW * 1.6);
      if (sc.right !== reach) {
        Object.assign(sc, { left: -reach, right: reach, top: reach, bottom: -reach });
        sc.updateProjectionMatrix();
      }
      return;
    }
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

  /** The grid point under a point on the screen (Phaser's coordinates), on the ground or the track, or null off it. */
  pick(px: number, py: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2(((px - this.x) / this.w) * 2 - 1, 1 - ((py - this.y) / this.h) * 2);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = this.groundIndex().cast(ray.ray);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** The height of whatever is underfoot at a grid point: the track where there is track, otherwise the ground. */
  heightAt(x: number, z: number): number {
    return this.groundIndex().top(x, z) ?? this.terrainAt(x, z);
  }

  private groundGrid: GroundIndex | null = null;

  /** The ground's triangles sorted into grid cells, built on first use: the editor's clicks and markers look up only the few under a point. */
  private groundIndex(): GroundIndex {
    return (this.groundGrid ??= new GroundIndex(this.ground));
  }

  /** Points the camera at the editor's camera without drawing, so a pick right after a pan uses the new view. */
  aim(): void {
    this.moveCamera(null, 0);
    this.camera.updateMatrixWorld();
  }

  /** The renderer, for the next view to reuse (the track editor's race view). */
  get gl(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /** Grid units across the view at zoom 1. */
  unitsAcross(): number {
    return this.viewUnits;
  }

  /** Which way on the ground the screen's right and up point, as unit vectors (x and z). */
  groundAxes(): { right: { x: number; z: number }; up: { x: number; z: number } } {
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorld.elements;
    const flat = (x: number, z: number) => {
      const l = Math.hypot(x, z) || 1;
      return { x: x / l, z: z / l };
    };
    return { right: flat(e[0], e[2]), up: flat(e[4], e[6]) };
  }

  /** Shows or hides the lap map in the corner. */
  showMap(on: boolean): void {
    this.mapDots.setVisible(on);
    this.mapFrame?.setVisible(on);
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
      if (r.pose.state === 'retired' || r.pose.hidden) continue;
      const q = this.surface.place(r.pose.dist, 0);
      const p = { x: q.x, y: q.z };
      g.fillStyle(r.color, 1).fillCircle(box.x + p.x * box.k, box.y + p.y * box.k, r.player ? 4 : 2.6);
      if (r.player) g.lineStyle(1.5, 0xffffff, 1).strokeCircle(box.x + p.x * box.k, box.y + p.y * box.k, 4);
    }
  }

  /** Lets the view go; `keepRenderer` leaves its renderer for the next view to reuse. */
  destroy(keepRenderer = false): void {
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
    if (!keepRenderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}

/**
 * The ground meshes' triangles bucketed by grid cell, for the editor's lookups: the same answers
 * as a raycast at the meshes (faces culled the way their materials cull them), without testing
 * every triangle in the scene.
 */
class GroundIndex {
  private readonly tris: Float32Array; // 9 numbers a triangle: a, b, c in world space
  private readonly cull: Uint8Array; // 0 both sides, 1 front only, 2 back only
  private readonly cells: Int32Array[];
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly yMin: number;
  private readonly yMax: number;
  private static readonly CELL = 1;

  constructor(meshes: THREE.Mesh[]) {
    const tris: number[] = [];
    const cull: number[] = [];
    const v = new THREE.Vector3();
    for (const m of meshes) {
      m.updateMatrixWorld();
      const pos = m.geometry.getAttribute('position');
      const idx = m.geometry.getIndex();
      const mat = m.material as THREE.Material;
      const c = mat.side === THREE.DoubleSide ? 0 : mat.side === THREE.BackSide ? 2 : 1;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
          tris.push(v.x, v.y, v.z);
        }
        cull.push(c);
      }
    }
    this.tris = new Float32Array(tris);
    this.cull = new Uint8Array(cull);
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (let i = 0; i < this.tris.length; i += 3) {
      x0 = Math.min(x0, this.tris[i]);
      x1 = Math.max(x1, this.tris[i]);
      y0 = Math.min(y0, this.tris[i + 1]);
      y1 = Math.max(y1, this.tris[i + 1]);
      z0 = Math.min(z0, this.tris[i + 2]);
      z1 = Math.max(z1, this.tris[i + 2]);
    }
    const C = GroundIndex.CELL;
    this.x0 = Number.isFinite(x0) ? x0 : 0;
    this.z0 = Number.isFinite(z0) ? z0 : 0;
    this.nx = Number.isFinite(x0) ? Math.floor((x1 - x0) / C) + 1 : 1;
    this.nz = Number.isFinite(z0) ? Math.floor((z1 - z0) / C) + 1 : 1;
    this.yMin = Number.isFinite(y0) ? y0 : 0;
    this.yMax = Number.isFinite(y1) ? y1 : 0;
    const lists: number[][] = Array.from({ length: this.nx * this.nz }, () => []);
    const t = this.tris;
    for (let k = 0; k < this.cull.length; k++) {
      const o = k * 9;
      const ia = this.cx(Math.min(t[o], t[o + 3], t[o + 6]));
      const ib = this.cx(Math.max(t[o], t[o + 3], t[o + 6]));
      const ja = this.cz(Math.min(t[o + 2], t[o + 5], t[o + 8]));
      const jb = this.cz(Math.max(t[o + 2], t[o + 5], t[o + 8]));
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) lists[j * this.nx + i].push(k);
    }
    this.cells = lists.map((l) => Int32Array.from(l));
  }

  private cx(x: number): number {
    return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.x0) / GroundIndex.CELL)));
  }

  private cz(z: number): number {
    return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.z0) / GroundIndex.CELL)));
  }

  /** The highest surface straight below a point, as a ray from 60 up looking down would find it (to 140 down), or null. */
  top(x: number, z: number): number | null {
    const i = Math.floor((x - this.x0) / GroundIndex.CELL);
    const j = Math.floor((z - this.z0) / GroundIndex.CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return null;
    const t = this.tris;
    let best: number | null = null;
    for (const k of this.cells[j * this.nx + i]) {
      const o = k * 9;
      const ax = t[o],
        az = t[o + 2],
        bx = t[o + 3],
        bz = t[o + 5],
        cx = t[o + 6],
        cz = t[o + 8];
      // Normal's y (of (b - a) x (c - a)): which way the face points, up or down.
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (ny === 0) continue;
      if (this.cull[k] === 1 && ny < 0) continue;
      if (this.cull[k] === 2 && ny > 0) continue;
      // Barycentric weights in the ground plane.
      const w1 = ((x - ax) * (cz - az) - (z - az) * (cx - ax)) / -ny;
      const w2 = ((z - az) * (bx - ax) - (x - ax) * (bz - az)) / -ny;
      if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
      const y = t[o + 1] + w1 * (t[o + 4] - t[o + 1]) + w2 * (t[o + 7] - t[o + 1]);
      if (y > 60 || y < -140) continue;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  /** Where a ray first meets the ground, or null: only the cells under the ray's path are tested. */
  cast(ray: THREE.Ray): THREE.Vector3 | null {
    const o = ray.origin;
    const d = ray.direction;
    // The stretch of the ray between the ground's highest and lowest points.
    let t0 = 0;
    let t1 = 1e4;
    if (Math.abs(d.y) > 1e-9) {
      const ta = (this.yMax + 0.01 - o.y) / d.y;
      const tb = (this.yMin - 0.01 - o.y) / d.y;
      t0 = Math.max(0, Math.min(ta, tb));
      t1 = Math.max(ta, tb);
      if (t1 < 0) return null;
    }
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const hit = new THREE.Vector3();
    let best: THREE.Vector3 | null = null;
    let bestT = Infinity;
    const seen = new Set<number>();
    const t = this.tris;
    const C = GroundIndex.CELL;
    // Walk the cells the ray's ground track crosses, nearest first, and stop once a hit is nearer than the next cell.
    const sx = o.x + d.x * t0;
    const sz = o.z + d.z * t0;
    let i = Math.floor((sx - this.x0) / C);
    let j = Math.floor((sz - this.z0) / C);
    const stepI = d.x > 0 ? 1 : -1;
    const stepJ = d.z > 0 ? 1 : -1;
    const dtX = d.x !== 0 ? Math.abs(C / d.x) : Infinity;
    const dtZ = d.z !== 0 ? Math.abs(C / d.z) : Infinity;
    let nextX = d.x !== 0 ? t0 + (this.x0 + (i + (d.x > 0 ? 1 : 0)) * C - sx) / d.x : Infinity;
    let nextZ = d.z !== 0 ? t0 + (this.z0 + (j + (d.z > 0 ? 1 : 0)) * C - sz) / d.z : Infinity;
    for (let guard = 0; guard < 100000; guard++) {
      if (i >= 0 && j >= 0 && i < this.nx && j < this.nz) {
        for (const k of this.cells[j * this.nx + i]) {
          if (seen.has(k)) continue;
          seen.add(k);
          const q = k * 9;
          a.set(t[q], t[q + 1], t[q + 2]);
          b.set(t[q + 3], t[q + 4], t[q + 5]);
          c.set(t[q + 6], t[q + 7], t[q + 8]);
          const p = this.cull[k] === 2 ? ray.intersectTriangle(c, b, a, true, hit) : ray.intersectTriangle(a, b, c, this.cull[k] === 1, hit);
          if (!p) continue;
          const dist = p.distanceTo(o);
          if (dist < bestT) {
            bestT = dist;
            best = p.clone();
          }
        }
      }
      const tNext = Math.min(nextX, nextZ);
      if (tNext > t1 || bestT <= tNext) break;
      if (nextX < nextZ) {
        i += stepI;
        nextX += dtX;
      } else {
        j += stepJ;
        nextZ += dtZ;
      }
      // Off the grid and heading further away: nothing more to find.
      if ((i < 0 && stepI < 0) || (i >= this.nx && stepI > 0) || (j < 0 && stepJ < 0) || (j >= this.nz && stepJ > 0)) break;
    }
    return best;
  }
}
