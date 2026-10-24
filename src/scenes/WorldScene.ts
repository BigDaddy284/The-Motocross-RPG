import Phaser from 'phaser';
import { advanceStory, fillText, formatMoney, jobPay, matchStory, pence, type JobDef, type StoryEvent, type StoryStep } from '../core/career';
import { npcsOnMap, type DialogueLine, type NpcDef, type NpcPlacement } from '../core/content';
import { Grid, STEPS } from '../core/grid';
import { objectTiles, type BakedMap, type Facing, type MapObject, type Tile } from '../core/mapTypes';
import { findPathToAny, findPathTowards, standingTiles } from '../core/pathfinding';
import type { SaveData } from '../core/saves';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../core/settings';
import { applyMapState, clearedPatches, hiddenSprites } from '../core/mapState';
import { WORLD_MAP, spawnTile, stepTriggerAt } from '../core/travel';
import { entryFee, practiceFee, venueProblem, type VenueDef } from '../core/raceDay';
import { noteActivity, shopForAction, type ShopDef } from '../core/shops';
import { CAREER_SLOT, services } from '../services';
import { Character, TILE } from '../world/Character';
import { MapView, OVERHEAD_DEPTH, isMapCached, loadMapImages } from '../world/MapView';
import { actionMessage } from '../world/messages';
import type { HudScene } from './HudScene';
import type { RaceSceneData } from './RaceScene';

// The walkable world: one map at a time, the player, NPCs, doors and exits.
// Changing map restarts this scene with the arrival tile, so nothing from the old map lingers.

/** Autosave every 5 minutes outside menus, plus on every map change (Spec 21b, Boss: 3 to 5 minutes). */
const AUTOSAVE_MS = 5 * 60 * 1000;
/** Design viewport: at 100% zoom, 20 × 11 tiles fit in 1280 × 720 (style guide 3). */
const DESIGN_W = 1280;
const DESIGN_H = 720;
/** Zoom on entering a building: all the way out, then six clicks in (Boss). Closer settings are kept. */
const INTERIOR_ZOOM = ZOOM_MIN + 6 * ZOOM_STEP;

interface WorldData {
  save: SaveData;
  /** A brand-new career: show the opening lines. */
  intro?: boolean;
}

/** A shift in progress: which station is next and how many parts are made. */
interface Shift {
  job: JobDef;
  made: number;
  station: number;
}

/** What a click or the interact key is aimed at. */
type Target =
  | { kind: 'npc'; placement: NpcPlacement; character: Character }
  | { kind: 'object'; object: MapObject; tiles: Tile[] }
  | { kind: 'venue'; venue: VenueDef; tiles: Tile[] };

export class WorldScene extends Phaser.Scene {
  private save!: SaveData;
  private map!: BakedMap;
  private grid!: Grid;
  private player!: Character;
  private npcs: { placement: NpcPlacement; character: Character }[] = [];
  private path: Tile[] = [];
  private onArrive: (() => void) | null = null;
  private walking = false;
  private busy = false;
  /** The zoom the player had outside, while a building has raised it to INTERIOR_ZOOM. */
  private outdoorZoom: number | null = null;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private hud!: HudScene;
  private intro = false;
  private shift: Shift | null = null;
  private stationMarks: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('world');
  }

  init(data: WorldData): void {
    this.save = structuredClone(data.save);
    this.intro = !!data.intro;
    this.shift = null;
    this.stationMarks = [];
    this.npcs = [];
    this.path = [];
    this.onArrive = null;
    this.walking = false;
    this.busy = true;
  }

  async create(): Promise<void> {
    const map = services.maps.get(this.save.position.map) ?? services.maps.get('area1-home-town')!;
    this.map = map;
    if (!this.scene.isActive('hud')) this.scene.launch('hud');
    this.hud = this.scene.get('hud') as HudScene;
    this.cameras.main.setBackgroundColor('#14141e');

    const firstVisit = !isMapCached(this, map);
    const started = performance.now();
    await loadMapImages(this, map);
    new MapView(this, map, hiddenSprites(map, this.save.flags), clearedPatches(map, this.save.flags));
    if (firstVisit) console.info(`Map ${map.id}: first visit ${Math.round(performance.now() - started)} ms`);
    else console.info(`Map ${map.id}: cached visit ${Math.round(performance.now() - started)} ms`);

    this.grid = Grid.fromMap(map);
    applyMapState(map, this.grid, this.save.flags);
    for (const p of npcsOnMap(services.content, map)) {
      // NPCs don't block the way: walking past (not clicking them) goes straight through.
      const character = new Character(this, p.npc.sprite, p, p.facing);
      this.npcs.push({ placement: p, character });
    }
    const { x, y, facing } = this.save.position;
    this.player = new Character(this, this.save.rider.look, { x, y }, facing);
    // While overlapping an NPC, the player draws on top of them.
    this.player.depthFloor = () => {
      let floor = -Infinity;
      for (const n of this.npcs) {
        const s = n.character.sprite;
        if (Math.abs(s.x - this.player.x) < TILE && Math.abs(s.y - this.player.y) < TILE) floor = Math.max(floor, s.depth + 1);
      }
      return floor;
    };
    this.player.placeAt({ x, y });

    const cam = this.cameras.main;
    cam.startFollow(this.player.sprite, true, 0.2, 0.2, 0, TILE / 2);
    cam.setRoundPixels(true);
    this.applyZoom();
    const unsub = services.settings.onChange(() => this.applyZoom());
    this.scale.on('resize', this.applyZoom, this);
    this.events.once('shutdown', () => {
      unsub();
      this.scale.off('resize', this.applyZoom, this);
    });

    this.setupInput();
    this.time.addEvent({ delay: AUTOSAVE_MS, loop: true, callback: () => this.autosave('timer') });
    this.hud.showMapTitle(map.title);
    this.hud.showCareer(this.save.career, this.save.flags);
    this.hud.showShift(null);
    // Buying, selling, repairs and dumping spares change the career in the HUD's panels.
    this.hud.onShopChange = () => {
      this.hud.showCareer(this.save.career, this.save.flags);
      this.milestoneSave();
    };
    cam.fadeIn(250, 20, 20, 30);
    this.busy = false;
    if (this.intro) this.say('', services.content.story.intro);

    // Remember the rider's spot: on arriving on every map, and whenever the page is hidden or
    // closed, so Continue puts them back where they were (not just where the last autosave was).
    this.quickSave();
    const onHide = () => document.visibilityState === 'hidden' && this.quickSave();
    const onPageHide = () => this.quickSave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    });
  }

  update(_time: number, delta: number): void {
    if (!this.player) return;
    if (!this.busy && !this.hud.isDialogueOpen()) this.save.stats.playSeconds += delta / 1000;
    if (this.busy || this.walking || this.hud.isDialogueOpen()) return;
    const dir = this.heldDirection();
    if (dir) {
      this.path = [];
      this.onArrive = null;
      const to = { x: this.player.tile.x + dir.x, y: this.player.tile.y + dir.y };
      if (this.grid.canStep(this.player.tile, to)) void this.walk([to]);
      else this.player.faceTowards(to);
      return;
    }
    if (this.player.moving) this.player.stopWalking();
  }

  // ---- input ----

  private setupInput(): void {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D }) as typeof this.keys;
    // E, Space and Esc are handled by the HUD, which knows whether a dialogue or menu is open.
    kb.on('keydown-PLUS', () => this.zoomBy(ZOOM_STEP));
    kb.on('keydown-NUMPAD_ADD', () => this.zoomBy(ZOOM_STEP));
    kb.on('keydown-MINUS', () => this.zoomBy(-ZOOM_STEP));
    kb.on('keydown-NUMPAD_SUBTRACT', () => this.zoomBy(-ZOOM_STEP));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? -ZOOM_STEP : ZOOM_STEP));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() > 12) return; // a drag, not a click
      if (this.busy || this.hud.isDialogueOpen() || this.hud.pointerOnUi(p)) return;
      if (this.hud.closeZoom()) return;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      this.clickAt(w.x, w.y);
    });
  }

  private heldDirection(): Tile | null {
    const k = this.keys;
    if (k.up.isDown || k.w.isDown) return STEPS[3];
    if (k.down.isDown || k.s.isDown) return STEPS[0];
    if (k.left.isDown || k.a.isDown) return STEPS[1];
    if (k.right.isDown || k.d.isDown) return STEPS[2];
    return null;
  }

  zoomBy(d: number): void {
    const z = services.settings.get().display.zoom;
    services.settings.update('display', 'zoom', Phaser.Math.Clamp(z + d, ZOOM_MIN, ZOOM_MAX));
  }

  /** Entering a building zooms in to INTERIOR_ZOOM; leaving puts back the outdoor zoom unless the player changed it inside. */
  private zoomForMapChange(entering: boolean): void {
    const z = services.settings.get().display.zoom;
    if (entering) {
      this.outdoorZoom = z < INTERIOR_ZOOM ? z : null;
      if (this.outdoorZoom !== null) services.settings.update('display', 'zoom', INTERIOR_ZOOM);
    } else if (this.map.kind === 'interior') {
      if (this.outdoorZoom !== null && z === INTERIOR_ZOOM) services.settings.update('display', 'zoom', this.outdoorZoom);
      this.outdoorZoom = null;
    }
  }

  private applyZoom(): void {
    const { width, height } = this.scale;
    const base = Math.min(width / DESIGN_W, height / DESIGN_H);
    const zoom = base * (services.settings.get().display.zoom / 100);
    const cam = this.cameras.main.setZoom(zoom);
    // A map smaller than the screen (most interiors) sits in the middle instead of the top-left.
    const mw = this.map.width * TILE;
    const mh = this.map.height * TILE;
    const vw = width / zoom;
    const vh = height / zoom;
    const bx = mw < vw ? (mw - vw) / 2 : 0;
    const by = mh < vh ? (mh - vh) / 2 : 0;
    cam.setBounds(bx, by, Math.max(mw, vw), Math.max(mh, vh));
  }

  // ---- clicks and interaction ----

  private clickAt(wx: number, wy: number): void {
    const tile = { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
    const target = this.targetAt(tile, wx, wy);
    if (target) {
      this.approach(target);
      return;
    }
    const path = findPathTowards(this.grid, this.player.tile, tile);
    this.markTarget(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2);
    this.setPath(path, null);
  }

  /** An NPC or usable object under a click. Characters are checked by their sprite, not just their tile. */
  private targetAt(tile: Tile, wx: number, wy: number): Target | null {
    for (const n of this.npcs) {
      const b = n.character.sprite.getBounds();
      if (b.contains(wx, wy) || (n.placement.x === tile.x && n.placement.y === tile.y)) return { kind: 'npc', placement: n.placement, character: n.character };
    }
    for (const o of this.map.objects) {
      if (!actionMessage(o)) continue;
      const tiles = objectTiles(o, this.map.tileSize);
      if (tiles.some((t) => t.x === tile.x && t.y === tile.y)) return { kind: 'object', object: o, tiles };
    }
    // Ride-on spots with no map object of their own, such as the backyard loop.
    for (const v of services.content.tracks.venues) {
      if (v.map !== this.map.id || !v.area) continue;
      const [ax, ay, aw, ah] = v.area;
      if (tile.x >= ax && tile.x < ax + aw && tile.y >= ay && tile.y < ay + ah) {
        const tiles: Tile[] = [];
        for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) tiles.push({ x, y });
        return { kind: 'venue', venue: v, tiles };
      }
    }
    return null;
  }

  /** Smart pathing: walk to the nearest free tile beside the target, face it, then use it. */
  private approach(target: Target): void {
    const tiles = target.kind === 'npc' ? [{ x: target.placement.x, y: target.placement.y }] : target.tiles;
    const here = this.player.tile;
    const act = () => {
      const facingTile = tiles.reduce((best, t) => (dist(t, this.player.tile) < dist(best, this.player.tile) ? t : best), tiles[0]);
      this.player.faceTowards(facingTile);
      this.use(target);
    };
    // Already standing on it (a walkable object such as a venue gate) or next to it.
    if (tiles.some((t) => t.x === here.x && t.y === here.y) || tiles.some((t) => dist(t, here) === 1 && this.grid.edgeOpen(t, here))) {
      act();
      return;
    }
    const goals = standingTiles(this.grid, tiles);
    const walkable = tiles.filter((t) => this.grid.isFree(t.x, t.y));
    const path = findPathToAny(this.grid, here, goals.length ? goals : walkable);
    if (!path) {
      this.hud.toast("You can't get there from here.");
      return;
    }
    this.setPath(path, act);
  }

  interactFacing(): void {
    if (this.busy || this.walking) return;
    if (this.hud.isDialogueOpen()) return;
    const d = STEPS[['down', 'left', 'right', 'up'].indexOf(this.player.facing)];
    const t = { x: this.player.tile.x + d.x, y: this.player.tile.y + d.y };
    const target = this.targetAt(t, -1, -1);
    if (target && this.grid.edgeOpen(this.player.tile, t)) this.use(target);
  }

  private use(target: Target): void {
    if (target.kind === 'npc') {
      this.talkTo(target.placement, target.character);
      return;
    }
    if (target.kind === 'venue') {
      this.openVenue(target.venue);
      return;
    }
    const o = target.object;
    if (this.useForShift(o)) return;
    const action = typeof o.props.action === 'string' ? o.props.action : null;
    const objectKey = `${this.map.id}:${o.name}:${o.x},${o.y}`;
    if (action && this.runStory({ use: action, map: this.map.id, object: objectKey }, '')) return;
    const shop = action ? shopForAction(services.content.shops, this.map.id, action) : null;
    if (shop && this.openShop(shop.shop, shop.fit ? 'fit' : 'buy')) return;
    const venue = o.type === 'venue' ? services.content.tracks.venues.find((v) => v.id === o.props.venue) : undefined;
    if (venue) {
      if (venue.office && !venue.locked) {
        const official = services.content.npcs.find((n) => n.id === venue.office);
        this.hud.toast(`${venue.name}: sign on with the ${official?.name.toLowerCase() ?? 'track official'} at the race office.`);
      } else this.openVenue(venue);
      return;
    }
    if (o.type === 'travel' && o.props.to === WORLD_MAP) {
      const lock = services.travel.lockFor(this.map, o, this.save.flags);
      if (lock) this.hud.toast(lock.message);
      else this.openWorldMap();
      return;
    }
    const msg = actionMessage(o, this.save.flags);
    if (msg) this.hud.toast(msg);
  }

  private talkTo(placement: NpcPlacement, character: Character): void {
    const { npc } = placement;
    if (this.runStory({ talk: npc.id }, npc.name, () => this.faceBack(placement, character), () => this.faceNpc(character))) return;
    if (npc.quietUntil && !this.save.flags[npc.quietUntil]) {
      // GDD 4.2: NPCs outside the opening chain don't acknowledge the rider until it's done.
      this.hud.toast(`The ${npc.name.toLowerCase()} doesn't look up.`);
      return;
    }
    this.faceNpc(character);
    const office = services.content.tracks.venues.find((v) => v.office === npc.id && v.map === this.map.id);
    if (office) {
      this.openVenue(office, () => this.faceBack(placement, character));
      return;
    }
    const shop = services.content.shops.shops.find((s) => s.npc === npc.id);
    if (shop && !this.talkRule(npc) && this.openShop(shop, 'buy', () => this.faceBack(placement, character))) return;
    this.say(npc.name, this.dialogueFor(npc), () => this.faceBack(placement, character));
  }

  /**
   * Opens a shop or the garage's services. Returns false while it is shut (before the opening
   * chain is done), so the object or NPC says its usual line instead.
   */
  private openShop(shop: ShopDef, tab: 'buy' | 'fit', onClose: () => void = () => this.player.idle()): boolean {
    if (shop.needs && !this.save.flags[shop.needs]) return false;
    this.hud.showCareer(this.save.career, this.save.flags);
    this.hud.openShop(shop, tab, onClose);
    return true;
  }

  private faceNpc(character: Character): void {
    const turn: Record<Facing, Facing> = { down: 'up', up: 'down', left: 'right', right: 'left' };
    character.face(turn[this.player.facing]);
    this.player.reach();
  }

  private faceBack(placement: NpcPlacement, character: Character): void {
    this.player.idle();
    character.face(placement.facing);
  }

  /** The NPC's line set for the current flags (npcs.json talk), or their default dialogue. */
  private dialogueFor(npc: NpcDef): string {
    return this.talkRule(npc)?.dialogue ?? npc.dialogue;
  }

  private talkRule(npc: NpcDef): { dialogue: string } | undefined {
    const f = this.save.flags;
    return npc.talk?.find((t) => (t.if === undefined || f[t.if]) && (t.unless === undefined || !f[t.unless]));
  }

  /** Shows a dialogue by key, filling in {rider} and any extra values. */
  private say(speaker: string, key: string, onClose: () => void = () => this.player.idle(), vars: Record<string, string> = {}): void {
    const all = { rider: this.save.rider.name, ...vars };
    const lines: DialogueLine[] = services.content.dialogue[key].lines.map((l) => ({ ...l, text: fillText(l.text, all) }));
    this.hud.openDialogue(speaker, this.save.rider.name, lines, onClose);
  }

  /**
   * Plays the current opening-chain step if this talk or use is it. Returns false when the event
   * has nothing to do with the story, so the normal response runs instead.
   */
  private runStory(ev: StoryEvent, speaker: string, onClose: () => void = () => this.player.idle(), onStart: () => void = () => this.player.reach()): boolean {
    const { story, items } = services.content;
    const career = this.save.career;
    const m = matchStory(story, career, ev);
    if (!m) return false;
    if (m.kind === 'alreadyUsed') {
      this.hud.toast("You've already done that one.");
      return true;
    }
    onStart();
    if (m.kind === 'notReady') {
      if (m.step.notReady) this.say(speaker, m.step.notReady, onClose, { short: formatMoney(m.short) });
      else {
        this.hud.toast(m.short > 0 ? `You're ${formatMoney(m.short)} short.` : "You don't have what you need for this yet.");
        onClose();
      }
      return true;
    }
    const finish = () => {
      const object = 'use' in ev ? ev.object : undefined;
      const step: StoryStep = m.step;
      const completed = advanceStory(story, career, this.save.flags, items, object);
      this.hud.showCareer(career, this.save.flags);
      const show = () => {
        onClose();
        if (!completed) return;
        if (step.effects?.money) this.hud.toast(step.toast ?? `${step.effects.money > 0 ? '+' : ''}${formatMoney(pence(step.effects.money))}`);
        else if (step.toast) this.hud.toast(step.toast);
        if (step.effects?.flags?.length) this.refreshMapState();
        this.milestoneSave();
      };
      if (step.lines) this.say(speaker, step.lines, show);
      else show();
    };
    if (m.step.confirm) this.hud.confirm(m.step.confirm, 'Yes', finish, onClose);
    else finish();
    return true;
  }

  /** Flags such as cleared roadworks change the map: reload it in place. */
  private refreshMapState(): void {
    const hidden = hiddenSprites(this.map, this.save.flags);
    if (!hidden.size) return;
    this.time.delayedCall(300, () => {
      this.save.position = { map: this.map.id, x: this.player.tile.x, y: this.player.tile.y, facing: this.player.facing };
      this.scene.restart({ save: this.save });
    });
  }

  // ---- shift work (Spec 15.5: click a station, wait for it, move to the next; one pass makes one part) ----

  /** Starts a shift at a job's start object, or works the next station. Returns true if handled. */
  private useForShift(o: MapObject): boolean {
    if (this.shift) {
      const st = this.shift.job.stations[this.shift.station];
      if (o.name === st.object) {
        void this.workStation();
        return true;
      }
      if (this.shift.job.stations.some((s) => s.object === o.name)) {
        this.hud.toast(`Next: ${st.label}.`);
        return true;
      }
      return false;
    }
    const job = services.content.world.jobs.find((j) => j.map === this.map.id && j.start === o.name);
    if (!job) return false;
    if (job.needs && !this.save.flags[job.needs]) {
      this.hud.toast('Nobody here has time to show you the work yet. Finish helping the garage mechanic first.');
      return true;
    }
    const pay = formatMoney(jobPay(services.content.world, job));
    this.hud.confirm(`${job.name}: make a batch of ${job.batch} ${job.product}s at ${pay} each.\nYou're paid for every part, even if you stop early.`, 'Start shift', () => {
      this.shift = { job, made: 0, station: 0 };
      this.showShift();
      void this.workStation();
    }, () => this.player.idle());
    return true;
  }

  private async workStation(): Promise<void> {
    const shift = this.shift;
    if (!shift || this.busy) return;
    const st = shift.job.stations[shift.station];
    this.busy = true;
    this.clearStationMarks();
    this.player.reach();
    await this.hud.progress(st.label, st.ms);
    this.player.idle();
    this.busy = false;
    if (this.shift !== shift) return;
    shift.station += 1;
    if (shift.station >= shift.job.stations.length) {
      shift.station = 0;
      shift.made += 1;
      this.save.career.money += jobPay(services.content.world, shift.job);
      this.hud.showCareer(this.save.career, this.save.flags);
      if (shift.made >= shift.job.batch) {
        const c = this.save.career.counters;
        c[shift.job.id] = (c[shift.job.id] ?? 0) + 1;
        noteActivity(services.content.shops, this.save.career, 'activity');
        this.endShift(`Batch done: ${shift.made} ${shift.job.product}s, ${formatMoney(jobPay(services.content.world, shift.job) * shift.made)} earned.`);
        this.milestoneSave();
        return;
      }
    }
    this.showShift();
  }

  private showShift(): void {
    const s = this.shift;
    if (!s) return;
    const st = s.job.stations[s.station];
    this.hud.showShift(`${s.job.name}: ${s.made} of ${s.job.batch} ${s.job.product}s\nNext: ${st.label}`);
    this.markStation(st.object);
  }

  private endShift(message: string): void {
    this.shift = null;
    this.clearStationMarks();
    this.hud.showShift(null);
    this.hud.toast(message);
  }

  /** A pulsing ring under every object that can do the next station. */
  private markStation(name: string): void {
    this.clearStationMarks();
    for (const o of this.map.objects.filter((x) => x.name === name)) {
      const tiles = objectTiles(o, this.map.tileSize);
      const cx = (tiles.reduce((a, t) => a + t.x, 0) / tiles.length + 0.5) * TILE;
      const cy = (tiles.reduce((a, t) => a + t.y, 0) / tiles.length + 0.5) * TILE;
      const ring = this.add.ellipse(cx, cy + 18, TILE * Math.max(1, tiles.length * 0.8), 26).setStrokeStyle(4, 0xef6c18, 0.95).setDepth(OVERHEAD_DEPTH);
      if (!services.settings.get().accessibility.reducedEffects) this.tweens.add({ targets: ring, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
      this.stationMarks.push(ring);
    }
  }

  private clearStationMarks(): void {
    for (const m of this.stationMarks) m.destroy();
    this.stationMarks = [];
  }

  // ---- tracks: the race office, practice and the backyard loop ----

  private openVenue(venue: VenueDef, onClose: () => void = () => this.player.idle()): void {
    const rc = services.content;
    const career = this.save.career;
    const problem = venueProblem(rc, venue, career, this.save.flags);
    if (problem) {
      this.hud.toast(problem);
      onClose();
      return;
    }
    const pFee = practiceFee(rc, venue);
    if (venue.practiceOnly) {
      this.hud.confirm(`Ride the ${venue.name.toLowerCase()}?\nFree. Laps wear your parts and give practice XP.`, 'Ride', () => this.ride('practice', venue, pFee, onClose), onClose);
      return;
    }
    const fee = entryFee(rc, venue, this.save.flags);
    const cls = rc.racing.classes[venue.class ?? '50cc'];
    const field = (rc.riders.fields[venue.field ?? ''] ?? []).length + 1;
    const first = fee === 0 && venue.firstRaceFree;
    const text = [
      first ? "First time here? Your first race day is on us." : 'Race office. What can I do for you?',
      `${venue.class} race day: ${field} riders including the Local Champion, 2 motos of ${cls.laps} laps. Prize money to 10th in each moto.`,
    ].join('\n\n');
    const short = (p: number) => career.money < p;
    this.hud.choose(venue.name, text, [
      { label: 'Race day', note: first ? 'Entry: free (first race)' : `Entry: ${formatMoney(fee)}${short(fee) ? " — you can't afford it" : ''}`, enabled: !short(fee), onPick: () => this.ride('raceday', venue, fee, onClose) },
      { label: 'Free practice', note: `${formatMoney(pFee)}: ride laps on your own until you stop.${short(pFee) ? " You can't afford it." : ''}`, enabled: !short(pFee), onPick: () => this.ride('practice', venue, pFee, onClose) },
      { label: 'Not now', onPick: onClose },
    ], onClose);
  }

  /** Hands over to the race screen; the world sleeps until it is done. */
  private ride(mode: 'practice' | 'raceday', venue: VenueDef, fee: number, onClose: () => void): void {
    this.busy = true;
    this.path = [];
    this.player.stopWalking();
    const data: RaceSceneData = {
      mode,
      venue,
      fee,
      save: this.snapshot(),
      onDone: (save, message) => {
        this.scene.wake('hud');
        this.scene.wake();
        this.save = save;
        this.busy = false;
        onClose();
        this.hud.showCareer(this.save.career, this.save.flags);
        this.milestoneSave();
        this.hud.toast(message);
      },
    };
    this.cameras.main.fadeOut(200, 20, 20, 30);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.sleep('hud');
      this.scene.sleep();
      this.scene.launch('race', data);
      this.cameras.main.fadeIn(200, 20, 20, 30);
    });
  }

  // ---- the world map ----

  private openWorldMap(): void {
    this.hud.openWorldMap(this.map.id, (mapId, spawn) => {
      const target = services.maps.get(mapId);
      const tile = target && spawnTile(target, spawn);
      if (!target || !tile) return;
      this.leaveTo({ map: mapId, x: tile.x, y: tile.y, facing: 'up' });
    });
  }

  /** A small ring where the player clicked, so a click always shows a response. */
  private markTarget(x: number, y: number): void {
    const ring = this.add.ellipse(x, y + 8, 40, 18).setStrokeStyle(3, 0xe8dbb8, 0.9).setDepth(0.5);
    if (services.settings.get().accessibility.reducedEffects) {
      this.time.delayedCall(400, () => ring.destroy());
      return;
    }
    this.tweens.add({ targets: ring, scale: 0.4, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
  }

  // ---- walking ----

  private setPath(path: Tile[], onArrive: (() => void) | null): void {
    this.path = path;
    this.onArrive = onArrive;
    if (!this.walking) void this.walk([]);
  }

  /** Walks the queued path (or the given steps), checking doors and exits on every tile. */
  private async walk(steps: Tile[]): Promise<void> {
    if (steps.length) this.path = steps;
    this.walking = true;
    while (this.path.length) {
      const next = this.path.shift()!;
      if (!this.grid.canStep(this.player.tile, next)) {
        // Something moved into the way: re-plan to the same end tile.
        const end = this.path.at(-1) ?? next;
        this.path = findPathTowards(this.grid, this.player.tile, end);
        if (!this.path.length) break;
        continue;
      }
      await this.player.step(next);
      if (this.checkTrigger()) {
        this.walking = false;
        return;
      }
      // Keep walking smoothly if a direction key is still held at the end of a keyboard step.
      if (!this.path.length && !this.onArrive) {
        const dir = this.heldDirection();
        const to = dir && { x: this.player.tile.x + dir.x, y: this.player.tile.y + dir.y };
        if (to && this.grid.canStep(this.player.tile, to)) this.path.push(to);
      }
    }
    this.walking = false;
    this.player.stopWalking();
    const done = this.onArrive;
    this.onArrive = null;
    done?.();
  }

  /** Handles a door or exit under the player. Returns true when the player is leaving the map. */
  private checkTrigger(): boolean {
    const via = stepTriggerAt(this.map, this.player.tile);
    if (!via) return false;
    const r = services.travel.resolve(this.map, via, this.save.flags);
    if (!r) return false;
    if (r.kind === 'blocked' || r.kind === 'worldMap') {
      this.path = [];
      this.onArrive = null;
      if (r.kind === 'blocked') this.hud.toast(r.message);
      else {
        this.player.stopWalking();
        this.openWorldMap();
      }
      return false;
    }
    const entering = this.map.kind === 'area' && via.type === 'door';
    this.leaveTo({ map: r.to.map, x: r.to.tile.x, y: r.to.tile.y, facing: entering ? 'up' : 'down' }, entering);
    return true;
  }

  /** Fades out and loads another map. Leaving ends any shift; the parts made are already paid. */
  private leaveTo(position: SaveData['position'], entering = false): void {
    if (this.shift) this.endShift(`Shift ended: ${this.shift.made} ${this.shift.job.product}s made.`);
    this.busy = true;
    this.path = [];
    this.player.stopWalking();
    this.save.position = position;
    this.cameras.main.fadeOut(200, 20, 20, 30);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.zoomForMapChange(entering);
      this.scene.restart({ save: this.save });
    });
  }

  // ---- saving ----

  private snapshot(): SaveData {
    const p = this.player?.tile ?? this.save.position;
    return { ...this.save, position: { map: this.map.id, x: p.x, y: p.y, facing: this.player?.facing ?? 'down' } };
  }

  /** Saves the current spot without rotating backups. */
  private quickSave(): void {
    try {
      this.save = services.saves.update(CAREER_SLOT, this.snapshot());
    } catch {
      // Storage full or blocked: the timed autosave reports it.
    }
  }

  private writeSave(): void {
    this.save = services.saves.write(CAREER_SLOT, this.snapshot());
  }

  /** Autosave at milestones such as a finished task or batch (Spec 21b). */
  private milestoneSave(): void {
    try {
      this.writeSave();
      this.hud.saveIndicator('Autosaved');
    } catch {
      this.hud.toast('Saving failed: storage is full or blocked.');
    }
  }

  private autosave(reason: 'timer' | 'manual'): void {
    if (reason === 'timer' && (this.busy || this.hud.isDialogueOpen() || this.scene.isPaused())) return;
    try {
      this.writeSave();
      this.hud.saveIndicator(reason === 'manual' ? 'Game saved' : 'Autosaved');
    } catch {
      this.hud.toast('Saving failed: storage is full or blocked.');
    }
  }

  saveNow(): void {
    this.autosave('manual');
  }

  openPause(): void {
    if (this.busy || this.hud.isDialogueOpen()) return;
    this.hud.openPause();
  }

  quitToMenu(): void {
    this.writeSave();
    this.scene.stop('hud');
    this.scene.start('menu');
  }
}

function dist(a: Tile, b: Tile): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
