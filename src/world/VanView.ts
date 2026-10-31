import Phaser from 'phaser';
import { Motion, restPlace, tuningFor, type Place } from '../core/vanMotion';
import { lerpAngle } from '../core/vanPath';
import { bikeShape, standMask, withoutStand, type BikeShape, type Rgba } from '../core/loadedBike';
import { type BedPoint, type Heading, type Move, type VanDesign, type VanPose, type VanSheet } from '../core/vehicles';
import { services } from '../services';
import { TILE } from './Character';

// Draws the player's van on an area map from its sheets (art/vehicles/sheets/map): parked, the
// heading's closed or rear-open cell; on the move, the turning sheet's 32 headings, so it turns
// smoothly. A soft shadow sits on the footprint, and the rider shows through the cab window while
// driving. A motor with an open bed (the Old Rusty Truck) carries the player's bike once it is
// loaded, in the bike's brand colours, strapped down to the front of the bed. Driving runs every frame: the scene hands over grid moves (vanMotion.ts turns them
// into one smooth trip with speeding up, cornering and braking) and hears back as each one ends.

/** The driver is drawn a little smaller than the rider on foot, sat down behind the glass. */
const DRIVER_SCALE = 0.85;
/** The point of the rider's 64 × 64 frame that sits in the middle of the window: their face. */
const DRIVER_FACE: [number, number] = [32, 24];
/**
 * A turning frame's window is only used when it is about the size of the glass in the parked view
 * nearest its heading (this much bigger at most, plus a few pixels). On many turning frames the
 * sheets mark the whole cab, roof and all, so cropping to that showed the whole seated rider on
 * top of the van mid-turn; there the driver is hidden instead, as the roof hides them.
 */
const GLASS_SLACK = 1.25;
/** Ask for the next move this far (in tiles) before the van would have to start braking. */
const LOOKAHEAD = 0.5;
/** Seconds to ease onto the parked pose when the back hasn't quite straightened up behind the cab. */
const SETTLE_S = 0.3;

/** How far below the bed's middle the wheels stand, side on (from the parked truck props). */
const WHEEL_DROP = 5;
/** The tie-down straps: black, a little wider than a pixel at the map's scale. */
const STRAP_COLOUR = 0x16161c;
const STRAP_WIDTH = 2;
/** Seen more end-on than this (the cosine of the van's angle), neither strap is on the far side. */
const FAR_SIDE = 0.3;
/** The truck bed is 26 px across side on and 34 px from above: the bars' width is squashed the same. */
const SIDE_SQUASH = 26 / 34;

export const vanTexture = (id: string) => `veh:${id}`;
export const vanTurnTexture = (id: string) => `veh:${id}:turn`;
/** The bike on its stand (area-map bike props) for a model (youth or adult), brand and heading. */
export const bikeTexture = (model: string, brand: string, h: Heading) => `bike:${model}-${brand}-${h}`;
export const bikeImagePath = (model: string, brand: string, h: Heading) => `art/area-map/tiled/tiles/bike-props/bike-on-stand-${model}-${brand}-${h}.png`;

/** The bike loaded on the back: its model (youth or adult) and brand. */
export interface VanLoad {
  model: string;
  brand: string;
}

/** The bike on its stand in a brand's colours, with the stand taken off (loadedBike.ts): made once per picture. */
const loadedShapes = new Map<string, BikeShape>();
function loadedBike(scene: Phaser.Scene, model: string, brand: string, h: Heading): { key: string; shape: BikeShape } | null {
  const key = `bike:loaded:${model}-${brand}-${h}`;
  const known = loadedShapes.get(key);
  if (known) return { key, shape: known };
  if (!scene.textures.exists(bikeTexture(model, brand, h))) return null;
  const pixels = (id: string): Rgba => {
    const src = scene.textures.get(bikeTexture(model, id, h)).getSourceImage() as HTMLImageElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { data: d.data, width: d.width, height: d.height };
  };
  const brands = services.content.bikes.brands.map((b) => b.id).filter((id) => scene.textures.exists(bikeTexture(model, id, h)));
  const sideOn = h === 'east' || h === 'west';
  const img = withoutStand(pixels(brand), sideOn ? standMask(brands.map(pixels)) : null);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
  // Side on, the grips are as far apart as the bars are wide from above, squashed like the bed.
  const above = sideOn ? loadedBike(scene, model, brand, 'north') : null;
  const span = above ? Math.abs(above.shape.bars[1][0] - above.shape.bars[0][0]) * SIDE_SQUASH : undefined;
  const shape = bikeShape(img, sideOn, span);
  loadedShapes.set(key, shape);
  return { key, shape };
}

/** Adds the sheets' named frames (east:closed, east:open, ... and t0 to t31) once. */
function ensureFrames(scene: Phaser.Scene, id: string, sheet: VanSheet): void {
  const tex = scene.textures.get(vanTexture(id));
  for (const [h, v] of Object.entries(sheet.views)) {
    for (const state of ['closed', 'open'] as const) {
      const name = `${h}:${state}`;
      if (!tex.has(name)) tex.add(name, 0, ...v[state]);
    }
  }
  if (!sheet.turn || !scene.textures.exists(vanTurnTexture(id))) return;
  const turn = scene.textures.get(vanTurnTexture(id));
  sheet.turn.frames.forEach((f, i) => {
    if (!turn.has(`t${i}`)) turn.add(`t${i}`, 0, ...f.cell);
  });
}

/** The scene's side of a drive: the next move to make (already checked and booked), and what to do as each ends. */
export interface Driver {
  next(): Move | null;
  /** A move has finished. Return true to stop driving at once (the van is leaving the map). */
  arrived(m: Move, from: VanPose): boolean;
  /** The van has come to rest on its pose. */
  stopped(): void;
}

export class VanView {
  readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Rectangle;
  private driver: Phaser.GameObjects.Image | null = null;
  private driverSheet: string | null = null;
  private bike: Phaser.GameObjects.Image | null = null;
  /** One graphics per strap, so the far one can pass behind the bike. */
  private straps: Phaser.GameObjects.Graphics[] | null = null;
  private load: VanLoad | null = null;
  private open = false;
  /** The pose the van is at or heading for: the last move handed over. */
  pose: VanPose;
  private readonly motion: Motion;
  private trip: Driver | null = null;
  /** Easing onto the parked pose after pulling up: from where, and how far through (0 to 1). */
  private settle: { from: Place; t: number } | null = null;
  /** Where it is drawn: middle of the van in pixels and its screen angle. */
  drawn: Place;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly design: VanDesign,
    private readonly sheet: VanSheet,
    pose: VanPose,
  ) {
    ensureFrames(scene, design.id, sheet);
    this.pose = { ...pose };
    this.motion = new Motion(tuningFor(design.stepMs), design.length, pose);
    this.shadow = scene.add.rectangle(0, 0, 10, 10, 0x14181e, 0.3);
    this.sprite = scene.add.image(0, 0, vanTexture(design.id), `${pose.heading}:closed`);
    this.drawn = { x: 0, y: 0, angle: 0 };
    this.place(pose);
  }

  get moving(): boolean {
    return this.motion.moving || !!this.settle;
  }

  /** Speed now, in tiles a second. */
  get speed(): number {
    return this.motion.speed;
  }

  get cruise(): number {
    return 1000 / this.design.stepMs;
  }

  /** Puts the van straight on a pose, at rest. */
  place(pose: VanPose): void {
    this.motion.rest(pose);
    this.settle = null;
    this.pose = { ...pose };
    this.draw(restPlace(pose, this.design.length), pose.heading);
  }

  setOpen(open: boolean): void {
    this.open = open;
    if (!this.moving) this.place(this.pose);
  }

  /** Shows the rider (a character sheet) in the cab, or nobody. */
  setDriver(sheet: string | null): void {
    this.driverSheet = sheet;
    this.driver?.destroy();
    this.driver = sheet ? this.scene.add.image(0, 0, `chr:${sheet}:act`, 0).setOrigin(0, 0).setScale(DRIVER_SCALE) : null;
    if (this.moving) this.draw(this.drawn, null);
    else this.place(this.pose);
  }

  /** Shows the bike on the back (motors with an open bed only), or an empty bed. */
  setLoad(load: VanLoad | null): void {
    if (!this.design.bed) load = null;
    if (load?.model === this.load?.model && load?.brand === this.load?.brand) return;
    this.load = load;
    if (!load) {
      this.bike?.destroy();
      this.straps?.forEach((g) => g.destroy());
      this.bike = null;
      this.straps = null;
      return;
    }
    if (!this.bike) this.bike = this.scene.add.image(0, 0, '__MISSING');
    if (!this.straps) this.straps = [this.scene.add.graphics(), this.scene.add.graphics()];
    if (this.moving) this.draw(this.drawn, null);
    else this.place(this.pose);
  }

  /** Starts (or keeps up) a drive: the van asks `trip` for moves as it needs them. */
  drive(trip: Driver): void {
    this.trip = trip;
    this.noMore = false;
  }

  /** Set when the drive is ending: finish what's queued, then stop. */
  private noMore = false;

  /** Stops asking for moves; the van finishes what it has and comes to rest. */
  endTrip(): void {
    this.noMore = true;
  }

  /** Runs the drive by one frame. */
  update(dtMs: number): void {
    const trip = this.trip;
    if (!trip && !this.moving) return;
    if (trip && !this.settle && !this.noMore) {
      // Keep enough road queued to carry on without braking; ask once more each frame while it's short.
      while (this.motion.remaining() < this.motion.stoppingDistance() + LOOKAHEAD) {
        const m = trip.next();
        if (!m) break;
        this.motion.push(m, this.pose);
        this.pose = { ...m.to };
      }
    }
    if (this.settle) {
      this.settle.t += dtMs / 1000 / SETTLE_S;
      if (this.settle.t < 1) {
        const f = this.settle.t * this.settle.t * (3 - 2 * this.settle.t);
        const a = this.settle.from;
        const b = restPlace(this.pose, this.design.length);
        this.draw({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: lerpAngle(a.angle, b.angle, f) }, null);
        return;
      }
      this.arrive();
      return;
    }
    if (!this.motion.moving) {
      this.arrive();
      return;
    }
    const done = this.motion.step(dtMs / 1000);
    for (const leg of done) {
      if (this.trip?.arrived(leg.move, leg.from)) {
        // Leaving the map: stop here, with nothing more to drive.
        this.trip = null;
        this.place(this.pose);
        return;
      }
    }
    const at = this.motion.place();
    this.draw(at, null);
    if (!this.motion.moving) {
      // Pulled up: ease the last bit onto the parked pose if the back is still swinging in.
      const rest = restPlace(this.pose, this.design.length);
      if (Math.hypot(at.x - rest.x, at.y - rest.y) > 0.01 || Math.abs(at.angle - rest.angle) > 0.5) this.settle = { from: at, t: 0 };
      else this.arrive();
    }
  }

  /** At rest on the pose: drawn parked, and the trip hears it has stopped. */
  private arrive(): void {
    this.place(this.pose);
    const t = this.trip;
    this.trip = null;
    this.noMore = false;
    t?.stopped();
  }

  /** True when a world point is on the van's picture. */
  contains(wx: number, wy: number): boolean {
    const f = this.sprite.frame;
    return this.sprite.getBounds().contains(wx, wy) && this.scene.textures.getPixelAlpha(wx - this.sprite.getTopLeft().x, wy - this.sprite.getTopLeft().y, this.sprite.texture.key, f.name) > 0;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.driver?.destroy();
    this.bike?.destroy();
    this.straps?.forEach((g) => g.destroy());
  }

  /**
   * Draws the van with its middle at a place (tile units). A parked heading uses the four-view
   * sheet (with the back open or shut); anything else the nearest of the turning sheet's frames.
   */
  private draw(at: Place, parked: Heading | null): void {
    this.drawn = { ...at };
    const x = at.x * TILE;
    const y = at.y * TILE;
    const turn = this.sheet.turn;
    let anchor: [number, number];
    let win: [number, number, number, number] | null | undefined;
    let bed: BedPoint | undefined;
    /** The angle of the picture drawn: a parked view's heading or the turning frame's. */
    let shown: number;
    if (parked || !turn || !this.scene.textures.exists(vanTurnTexture(this.design.id))) {
      const h = parked ?? nearestHeading(at.angle);
      const v = this.sheet.views[h];
      const frame = `${h}:${this.open && parked ? 'open' : 'closed'}`;
      if (this.sprite.texture.key !== vanTexture(this.design.id)) this.sprite.setTexture(vanTexture(this.design.id), frame);
      else if (this.sprite.frame.name !== frame) this.sprite.setFrame(frame);
      anchor = v.anchor;
      win = v.driver;
      bed = this.design.bed?.views[h];
      shown = HEADING_ANGLE[h];
    } else {
      const i = Math.round(at.angle / (360 / turn.frames.length)) % turn.frames.length;
      const f = turn.frames[i];
      const name = `t${i}`;
      if (this.sprite.texture.key !== vanTurnTexture(this.design.id)) this.sprite.setTexture(vanTurnTexture(this.design.id), name);
      else if (this.sprite.frame.name !== name) this.sprite.setFrame(name);
      anchor = f.anchor;
      bed = this.design.bed?.turn[i];
      shown = i * (360 / turn.frames.length);
      win = glassSized(f.driver, this.sheet.views[nearestHeading(at.angle)].driver) ? f.driver : null;
    }
    this.sprite.setOrigin(anchor[0] / this.sprite.frame.width, anchor[1] / this.sprite.frame.height);
    // Sorted by the lowest point of the footprint on screen.
    const a = (at.angle * Math.PI) / 180;
    const half = (this.design.length * TILE) / 2;
    const bottom = y + half * Math.abs(Math.sin(a)) + (TILE / 2) * Math.abs(Math.cos(a));
    this.sprite.setPosition(Math.round(x), Math.round(y)).setDepth(bottom - 0.5);
    this.shadow
      .setPosition(x, y + 4)
      .setSize(this.design.length * TILE - 12, TILE * 0.72)
      .setOrigin(0.5)
      .setRotation(-a)
      .setDepth(bottom - 0.75);
    this.placeDriver(win ?? null, nearestHeading(at.angle), anchor);
    this.placeBike(bed, shown);
  }

  /**
   * The loaded bike stood in the bed's middle, facing the way the motor does, with a strap from
   * each grip to the bed's front corner on that side, behind the cab. Between the four bike
   * views (on the turning frames) the nearest one is turned to the frame's angle.
   */
  private placeBike(bed: BedPoint | undefined, shown: number): void {
    const b = this.bike;
    const g = this.straps;
    const load = this.load;
    if (!b || !g || !load) return;
    const h = nearestHeading(shown);
    const pic = bed ? loadedBike(this.scene, load.model, load.brand, h) : null;
    if (!bed || !pic) {
      b.setVisible(false);
      g.forEach((s) => s.setVisible(false));
      return;
    }
    if (b.texture.key !== pic.key) b.setTexture(pic.key);
    const { middle, bottom, bars } = pic.shape;
    const side = Math.abs(Math.cos((shown * Math.PI) / 180));
    const rot = -(((shown - HEADING_ANGLE[h] + 540) % 360) - 180) * (Math.PI / 180);
    const x = this.sprite.x + bed.mid[0];
    const y = this.sprite.y + bed.mid[1] + side * (WHEEL_DROP - (bottom - middle[1]));
    b.setOrigin(middle[0] / b.width, middle[1] / b.height).setRotation(rot).setPosition(x, y).setDepth(this.sprite.depth + 0.004).setVisible(true);
    // The handlebar ends in the world, turned with the bike.
    const [cos, sin] = [Math.cos(rot), Math.sin(rot)];
    const ends = bars.map(([bx, by]) => [x + (bx - middle[0]) * cos - (by - middle[1]) * sin, y + (bx - middle[0]) * sin + (by - middle[1]) * cos]);
    const hooks = bed.straps.map(([sx, sy]) => [this.sprite.x + sx, this.sprite.y + sy]);
    // Each corner takes the nearer grip.
    const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const pair = d(ends[0], hooks[0]) + d(ends[1], hooks[1]) <= d(ends[0], hooks[1]) + d(ends[1], hooks[0]) ? [0, 1] : [1, 0];
    // Unless the bed is seen end-on, the corner up the picture across the bike's line is on the
    // far side of the bed: its strap goes behind the bike, so the two read as one each side.
    const a = (shown * Math.PI) / 180;
    const across = (p: number[]) => ((p[0] - x) * Math.sin(a) + (p[1] - y) * Math.cos(a)) * Math.sign(Math.cos(a));
    const far = Math.abs(Math.cos(a)) < FAR_SIDE ? -1 : across(hooks[0]) < across(hooks[1]) ? 0 : 1;
    hooks.forEach((hk, i) => {
      const e = ends[pair[i]];
      g[i].clear().lineStyle(STRAP_WIDTH, STRAP_COLOUR, 1).lineBetween(e[0], e[1], hk[0], hk[1]);
      g[i].setDepth(this.sprite.depth + (i === far ? 0.002 : 0.006)).setVisible(true);
    });
  }

  /** The rider's face in the cab window, cropped to the glass. Hidden when the window can't be seen. */
  private placeDriver(win: [number, number, number, number] | null, h: Heading, anchor: [number, number]): void {
    const d = this.driver;
    if (!d || !this.driverSheet) return;
    if (!win) {
      d.setVisible(false);
      return;
    }
    const cols = services.manifest.characters.act.columns.length;
    const facing = h === 'north' ? 'up' : h === 'south' ? 'down' : h === 'east' ? 'right' : 'left';
    d.setFrame(services.manifest.characters.rows.indexOf(facing) * cols);
    const left = this.sprite.x - anchor[0];
    const top = this.sprite.y - anchor[1];
    const wx = left + win[0];
    const wy = top + win[1];
    const ix = wx + win[2] / 2 - DRIVER_FACE[0] * DRIVER_SCALE;
    const iy = wy + win[3] / 2 - DRIVER_FACE[1] * DRIVER_SCALE + 2;
    d.setPosition(ix, iy).setVisible(true).setDepth(this.sprite.depth + 0.01);
    d.setCrop((wx - ix) / DRIVER_SCALE, (wy - iy) / DRIVER_SCALE, win[2] / DRIVER_SCALE, win[3] / DRIVER_SCALE);
  }
}

/** True when a turning frame's window is no bigger than the parked view's glass (GLASS_SLACK). */
function glassSized(win: [number, number, number, number] | null | undefined, parked: [number, number, number, number] | null | undefined): boolean {
  return !!win && !!parked && win[2] <= parked[2] * GLASS_SLACK + 4 && win[3] <= parked[3] * GLASS_SLACK + 4;
}

/** Screen angles of the headings, anticlockwise from east (as the turning frames count them). */
const HEADING_ANGLE: Record<Heading, number> = { east: 0, north: 90, west: 180, south: 270 };

function nearestHeading(angle: number): Heading {
  const i = Math.round((((angle % 360) + 360) % 360) / 90) % 4;
  return (['east', 'north', 'west', 'south'] as Heading[])[i];
}
