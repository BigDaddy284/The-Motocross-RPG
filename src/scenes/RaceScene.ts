import Phaser from 'phaser';
import { bikeStats, conditionFactor, formatMoney, type Bike } from '../core/career';
import { formatTime, gateBonus, type LapTrace, type MotoSim, type RaceEvent, type RiderResult } from '../core/race';
import { PLAYER_ID, RaceDay, applyRide, playerEntrant, practiceSim, sumXp, trackById, type MotoRecord, type VenueDef } from '../core/raceDay';
import { Knockout, type KnockoutHeat, roundName } from '../core/knockout';
import { finishChampionship, nextRoundVenue, rewardTexture, recordRound, roundOptions, standings, titlePossible, type ActiveChampionship, type ChampionshipDef } from '../core/championship';
import { noteActivity } from '../core/shops';
import { challengePrize, rigChallenge, type ChallengeDef } from '../core/challenge';
import { challengeRuns, challengeWins, venueDays, venueWins } from '../core/records';
import type { SaveData } from '../core/saves';
import { services } from '../services';
import { COLORS, textStyle } from '../ui/theme';
import { button, panel, penMeter, type Button, type PenMeter } from '../ui/widgets';
import { directorFor, ROW_SIZE, type RaceDirector } from '../core/riderAI';
import { isNoTurn, NO_TURN_GATES, SPRINT_QUEUE, startGeom } from '../core/trackGeom';
import { RaceView } from '../world/RaceView';
import { view } from '../ui/view';
import { gearColour, kitFor, type RaceLook } from '../world/raceBike';

// Race day and practice: gate pick, the live race screen with its pit board, auto-complete,
// moto and day results, and practice laps. The simulation does the racing; this screen only
// plays it back (GDD 11.1). Laid out on a 1280 × 720 design, scaled to fit the window and
// widened (or heightened) to the window's shape: the live race screen stretches its track view,
// panels and buttons to fill the screen, and the other screens sit in the middle (Boss, 28 Oct 2026).

const W = 1280;
const H = 720;
/**
 * Race seconds per real second at each speed button (Pause, 1× to 4×). Boss, 28 Oct 2026: 1× is
 * the old 2× and 4× the old 8×, with 2× and 3× true multiples between.
 */
const SPEEDS = [0, 2, 4, 6, 8];
const SPEED_LABELS = ['Pause', '1×', '2×', '3×', '4×'];
const DEFAULT_SPEED = 1;
/** How many laps a pit board message can be set for; 0 is to the flag. */
const BOARD_LAPS = [1, 2, 3, 0];
/** Width of the pen meter in the race bar and on the pit board. */
const PEN_W = 116;

export interface RaceSceneData {
  mode: 'practice' | 'raceday' | 'challenge';
  venue: VenueDef;
  save: SaveData;
  /** The entry or practice fee in pence, taken when the day is over. */
  fee: number;
  /** A championship round: the championship whose next round this is (it must be active in the save). */
  champ?: ChampionshipDef;
  /** A challenge race (core/challenge.ts): one moto against the challenger, for their stake. */
  challenge?: ChallengeDef;
  onDone: (save: SaveData, message: string) => void;
}

interface Checkpoints {
  t: number[];
  /** Distance in laps (lap 2 halfway round is 1.5). */
  d: number[];
}

/** Outlined text over the track: readable on grass, dirt or sky (Boss, 28 Oct 2026). */
const OVERLAY: Phaser.Types.GameObjects.Text.TextStyle = {
  stroke: '#14141a',
  strokeThickness: 5,
  shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 4, stroke: true, fill: true },
};
/** One standings row's height, and the room kept under them for the race log. */
const TOWER_ROW = 23;
const FEED_H = 150;

/** The rows of the standings that fit, scrolled so the player's row is always in view (near the middle). */
function towerWindow(rows: string[], mine: number, fit: number): string[] {
  if (rows.length <= fit) return rows;
  const start = Math.max(0, Math.min(rows.length - fit, mine - Math.floor(fit / 2)));
  return rows.slice(start, start + fit);
}

export class RaceScene extends Phaser.Scene {
  private args!: RaceSceneData;
  private save!: SaveData;
  private root!: Phaser.GameObjects.Container;
  private screen!: Phaser.GameObjects.Container;
  private day: RaceDay | null = null;
  private sim: MotoSim | null = null;
  private view: RaceView | null = null;
  private director: RaceDirector | null = null;
  /** Real seconds since the last frame, for the view's camera. */
  private frameDt = 0;
  private cps = new Map<string, Checkpoints>();
  private traces: LapTrace[] = [];
  private raceEvents: RaceEvent[] = [];
  private eventIndex = 0;
  private feed: string[] = [];
  private clock = 0;
  private speed = DEFAULT_SPEED;
  private paused = false;
  private live = false;
  private retiredAt: number | null = null;
  private realStart = 0;
  private colors = new Map<string, number>();
  /** Each rider's race-day bike and gear (Boss's brief, 24 Oct 2026: Race day bike colours). */
  private looks = new Map<string, RaceLook>();
  private names = new Map<string, string>();
  private ui: Record<string, Phaser.GameObjects.Text> = {};
  /** The pen in the race bar: its ink is the message changes left. */
  private pen: PenMeter | null = null;
  private modal: Phaser.GameObjects.Container | null = null;
  private towerRows = 16;
  /** Set by clear(): the next frame fits the new menu screen to the window. */
  private fitDirty = false;
  private skipButton: Button | null = null;
  /** The design's size: 1280 × 720 widened or heightened to the window's shape (fit). */
  private dw = W;
  private dh = H;
  private bg!: Phaser.GameObjects.Rectangle;
  private detail = false;
  private onTick: (() => void) | null = null;
  private explained = false;
  /** Auto-complete: the race plays out on screen with no pit board, holding the starting message. */
  private auto = false;
  /** Laps the next pit board message is set for (BOARD_LAPS), and the leader's lap when the board next comes out. */
  private boardLaps = 1;
  private boardAt = 0;
  /** Laps you have finished, as far as the clock has got: the pit board comes out as you cross the line. */
  private myLaps = 0;
  /** What Details last showed (tab, bike snapshot, timing points passed), to redraw it only when that changes. */
  private detailKey = '';
  /** The player's bike after each lap the simulation has run, by the race time the player finished that lap. */
  private wearAt: { t: number; parts: Bike['parts'] }[] = [];
  /**
   * Practice: your XP and bike after each lap the simulation has run, by when you finish it. With
   * other riders out, the simulation runs laps as the first of them crosses the line, so it can be
   * a lap ahead of you: laps, XP and wear count as far as the lap you are on.
   */
  private practiceAt: { end: number; xp: Record<string, number>; parts: Bike['parts'] }[] = [];
  private detailTab: 'bike' | 'sections' = 'bike';
  private detailTabs: Button[] = [];
  /** The live screen is showing qualifying, not a moto. */
  private qualifying = false;
  /** A No-Turn Takedown's knockout (core/knockout.ts), in place of a race day; the heat being ridden, or null for the seeding run. */
  private ko: Knockout | null = null;
  private koHeat: KnockoutHeat | null = null;
  /** The player's seeding time and seed, shown over the first bracket. */
  private koSeedNote = '';
  /** The seeding run is wrapping up: the player has their time. */
  private koSeedDone = false;

  constructor() {
    super('race');
  }

  init(data: RaceSceneData): void {
    this.args = data;
    this.save = structuredClone(data.save);
    this.day = null;
    this.ko = null;
    this.koHeat = null;
    this.sim = null;
    this.modal = null;
    this.onTick = null;
    this.qualifying = false;
    this.explained = !!this.save.flags.first_race_done;
    this.realStart = performance.now();
  }

  create(): void {
    const { width, height } = view(this);
    this.bg = this.add.rectangle(0, 0, width, height, COLORS.ink).setOrigin(0);
    this.root = this.add.container(0, 0);
    this.screen = this.add.container(0, 0);
    this.root.add(this.screen);
    this.fit();
    this.scale.on('resize', this.relayout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.relayout, this));
    if (this.args.mode === 'practice') this.startPractice();
    else if (this.args.challenge) this.showChallengeStart(this.args.challenge);
    else {
      const career = this.save.career;
      const champ = this.champ;
      const round = champ ? roundOptions(services.content, champ.def, champ.active) : undefined;
      // TEST ONLY, REMOVE BEFORE RELEASE: Settings > Gameplay > "TEST: Ride alone" races with no AI riders.
      const alone = services.settings.get().gameplay.testRideAlone;
      const seed = (Math.random() * 2 ** 32) >>> 0;
      if (!champ && this.args.venue.track && isNoTurn(trackById(services.content, this.args.venue.track))) {
        // A No-Turn Takedown: a knockout, not motos (Boss, 30 Oct 2026).
        this.ko = new Knockout(services.content, this.args.venue, playerEntrant(services.content, career, this.save.rider.name, 0, this.save.flags), seed, this.args.fee, alone);
        this.setupField();
        this.showKoSeedingStart();
        return;
      }
      this.day = new RaceDay(services.content, this.args.venue, playerEntrant(services.content, career, this.save.rider.name, 0, this.save.flags), seed, this.args.fee, round, undefined, alone);
      this.setupField();
      if (this.day.qualifyingDue) this.showQualifyingStart();
      else this.showGatePick();
    }
  }

  /** Names, bikes and gear colours for the day's field. */
  private setupField(): void {
    (this.ko?.field ?? this.day!.field).forEach((e, i) => {
      this.names.set(e.id, e.player ? 'You' : e.name);
      const gear = kitFor(e, i);
      this.looks.set(e.id, { brand: e.bike.brand, cls: e.bike.class, gear });
      this.colors.set(e.id, e.player ? COLORS.accent : gearColour(gear));
    });
  }

  /** The championship this race day is a round of, with its state in this scene's save. */
  private get champ(): { def: ChampionshipDef; active: ActiveChampionship; round: number } | null {
    const def = this.args.champ;
    const active = def && this.save.career.champs?.active[def.id];
    return def && active ? { def, active, round: active.rounds.length + 1 } : null;
  }

  /** "Farmland MX · 50cc race day", or the championship and round. */
  private dayTitle(): string {
    if (this.ko) return `${this.args.venue.name} · ${this.ko.cls} No-Turn Takedown`;
    const day = this.day!;
    if (this.args.challenge) return `${this.args.challenge.name} · ${day.laps} laps`;
    const c = this.champ;
    return `${this.args.venue.name} · ${day.cls} ${c ? `${c.def.short} round ${c.round} of ${c.def.rounds.length}` : 'race day'}`;
  }

  /** Sizes the design to the window's shape: at least 1280 × 720, as wide or tall as the window allows. */
  private fit(): void {
    const { width, height } = view(this);
    const k = Math.min(width / W, height / H);
    this.dw = width / k;
    this.dh = height / k;
    this.root.setScale(k).setPosition(0, 0);
    this.bg.setSize(width, height);
    // Screens laid out on 1280 × 720 sit in the middle; the live race screen fills it all (startLive).
    this.screen.setScale(1).setPosition((this.dw - W) / 2, (this.dh - H) / 2);
  }

  /**
   * Scales a menu screen (gate pick, results, standings) up to fill the window, as far as its own
   * content reaches rather than the whole 1280 × 720 it is laid out on, so it uses the room on a
   * wide phone screen (Boss, 28 Oct 2026). Never smaller than it was laid out, and at most 1.6×.
   */
  private fitContent(): void {
    this.screen.setScale(1).setPosition(0, 0);
    const k = this.root.scaleX;
    const b = this.screen.getBounds();
    if (!b.width || !b.height) return this.fit();
    const x = b.x / k;
    const y = b.y / k;
    const w = b.width / k;
    const h = b.height / k;
    const s = Math.max(1, Math.min((this.dw - 40) / w, (this.dh - 40) / h, 1.6));
    this.screen.setScale(s).setPosition(this.dw / 2 - (x + w / 2) * s, this.dh / 2 - (y + h / 2) * s);
  }

  /** The window changed size: the screen showing keeps its layout, scaled to fit; the next one fills it again. */
  private relayout(): void {
    const { width, height } = view(this);
    const k = Math.min(width / this.dw, height / this.dh);
    this.root.setScale(k).setPosition((width - this.dw * k) / 2, (height - this.dh * k) / 2);
    this.bg.setSize(width, height);
  }

  update(_t: number, dt: number): void {
    // A menu screen is built after clear(): grow it to fill the window, once it is all there.
    if (this.fitDirty) {
      this.fitDirty = false;
      if (!this.live) this.fitContent();
    }
    if (!this.live || this.paused || this.modal) return;
    // The real time since the last frame, so 1× is real time even when frames come slowly (the
    // game loop smooths and trims its own delta), capped so a stalled tab doesn't leap ahead.
    const real = Math.min(250, this.game.loop.rawDelta || dt) / 1000;
    this.frameDt = real;
    // Before the gate drops (negative race time) the line-up and the start board run in real
    // time at any speed, so the five-second hold is always five seconds; Pause still stops it.
    const speed = SPEEDS[this.speed];
    if (this.clock < 0 && speed > 0) {
      const pre = Math.min(real, -this.clock);
      this.clock = Math.min(0, this.clock + pre) + (real - pre) * speed;
    } else this.clock += real * speed;
    this.onTick?.();
  }

  // ---- small helpers ----

  private clear(): void {
    this.screen.removeAll(true);
    this.fit();
    this.fitDirty = true;
    this.ui = {};
    this.pen = null;
    this.view = null;
    this.skipButton = null;
    this.live = false;
    this.onTick = null;
  }

  private text(x: number, y: number, s: string, size = 18, color: number = COLORS.cream, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, textStyle(size, color, extra));
    this.screen.add(t);
    return t;
  }

  private btn(x: number, y: number, label: string, fn: () => void, w = 220, h = 46, into: Phaser.GameObjects.Container = this.screen): Button {
    const b = button(this, x, y, label, fn, w, h);
    into.add(b);
    return b;
  }

  private box(x: number, y: number, w: number, h: number, into: Phaser.GameObjects.Container = this.screen): Phaser.GameObjects.Rectangle {
    const p = panel(this, x + w / 2, y + h / 2, w, h);
    into.add(p);
    return p;
  }

  private openModal(w: number, h: number): Phaser.GameObjects.Container {
    this.modal?.destroy();
    const c = this.add.container(this.dw / 2, this.dh / 2);
    c.add(this.add.rectangle(0, 0, this.dw, this.dh, 0, 0.55).setInteractive());
    c.add(panel(this, 0, 0, w, h).setInteractive());
    this.root.add(c);
    this.modal = c;
    return c;
  }

  private closeModal(): void {
    this.modal?.destroy();
    this.modal = null;
  }

  private header(title: string, sub: string): void {
    this.text(W / 2, 26, title, 30, COLORS.accent).setOrigin(0.5, 0);
    this.text(W / 2, 68, sub, 18, COLORS.muted).setOrigin(0.5, 0);
  }

  // ---- race day: gate pick and how to race ----

  private showGatePick(): void {
    const day = this.day!;
    if (day.sprint) return this.showStartOrder();
    this.clear();
    const n = day.motoNumber;
    this.header(this.dayTitle(), `Moto ${n} of ${day.motoCount} · ${day.laps} laps · ${day.field.length} riders`);
    const { taken, free } = day.gatesForPlayer();
    const myTurn = day.pickOrder.indexOf(PLAYER_ID) + 1;
    const how = n > 1 ? 'Gate picks for moto 2 go in moto 1 finishing order.' : day.qualifying ? 'Gate picks for moto 1 go in qualifying order.' : 'Gate picks for moto 1 are drawn at random.';
    this.text(W / 2, 108, `${how} You pick ${ordinal(myTurn)}. Inside gates get a better start.`, 22).setOrigin(0.5, 0);

    let chosen = free[0];
    // One gate per rider, laid out as the start is: gates 1 to 8 are the front row and 9 to 16 the
    // second row, each straight behind the gate 8 before it.
    const count = day.gateCount;
    const perRow = Math.min(count, ROW_SIZE);
    const rows = Math.ceil(count / ROW_SIZE);
    const rowH = 60;
    const gh = 46;
    const y0 = 178;
    const gw = 70;
    const gx = W / 2 - (perRow * gw) / 2 + gw / 2;
    const gateButtons: Button[] = [];
    for (let g = 0; g < count; g++) {
      const row = Math.floor(g / ROW_SIZE);
      const x = gx + (g % ROW_SIZE) * gw;
      const y = y0 + row * rowH;
      const who = taken.get(g);
      const bonus = gateBonus(day.track, g);
      if (who) {
        const r = this.add.rectangle(x, y, gw - 8, gh, COLORS.inkLine).setStrokeStyle(2, COLORS.panelLight);
        this.screen.add(r);
        this.text(x, y + 4, gateBadges(this.names).get(who) ?? '', 18, COLORS.muted).setOrigin(0.5);
      } else {
        const b = this.btn(x, y, bonus > 0 ? `+${bonus}%` : bonus < 0 ? `${bonus}%` : '0%', () => {
          chosen = g;
          gateButtons.forEach((o) => o.setSelected(o === b));
        }, gw - 8, gh);
        b.setSelected(g === chosen);
        gateButtons.push(b);
      }
      // The gate's number in its top corner, over the button.
      this.text(x - gw / 2 + 7, y - gh / 2 + 1, `${g + 1}`, 14, COLORS.muted).setOrigin(0, 0);
    }
    for (let row = 0; row < rows; row++) this.text(gx - gw / 2 - 12, y0 + row * rowH, ['Front row', 'Second row'][row], 18, COLORS.muted).setOrigin(1, 0.5);
    this.text(W / 2, 266, 'Taken gates show who has them. The % is the start bonus.', 18, COLORS.muted).setOrigin(0.5, 0);

    // How to race it.
    const { racing } = services.content;
    this.box(100, 286, 1080, 356);
    const message = this.messagePicker(300);
    this.text(130, 462, `In a race, the pit board comes out when your message runs out (every lap, or the laps you set it for) and you can change your message ${racing.ink} times a moto. Auto-complete plays the same race out on screen with no pit board, holding your message all race. Either way, you retire at ${racing.sim.retireAtBroken} broken parts.`, 19, COLORS.cream, { wordWrap: { width: 1020 }, lineSpacing: 2 });
    this.btn(W / 2 - 300, 600, 'Race', () => this.go(chosen, message(), false), 260, 52);
    this.btn(W / 2, 600, 'Auto-complete', () => this.go(chosen, message(), true), 260, 52);
    this.btn(W / 2 + 300, 600, 'Bike check', () => this.showBike(), 260, 52);
    if (n > 1) this.btn(W / 2, 682, 'Leave early', () => this.confirmLeave(), 200, 44);
  }

  /**
   * An enduro sprint's moto: no gates to pick. Riders leave the start line one at a time, the
   * interval apart, in qualifying order for moto 1 (fastest first) and moto 1's finishing order
   * for moto 2.
   */
  private showStartOrder(): void {
    const day = this.day!;
    this.clear();
    const n = day.motoNumber;
    const { racing } = services.content;
    const gap = this.sprintInterval();
    this.header(this.dayTitle(), `Moto ${n} of ${day.motoCount} · ${day.laps} timed laps · ${day.field.length} riders · one at a time`);
    const myTurn = day.pickOrder.indexOf(PLAYER_ID) + 1;
    const how = n > 1 ? 'Riders leave in moto 1 finishing order.' : 'Riders leave in qualifying order, fastest first.';
    this.text(W / 2, 108, `${how} You go ${ordinal(myTurn)}, ${(myTurn - 1) * gap} seconds after the first rider.`, 22).setOrigin(0.5, 0);
    this.text(W / 2, 146, `One rider leaves the start every ${gap} seconds. After each lap you roll back down the return lane and queue to go again. Lowest total time over the ${day.laps} timed laps wins.`, 18, COLORS.muted, { wordWrap: { width: 1100 }, align: 'center' }).setOrigin(0.5, 0);
    const order = day.pickOrder.map((id, i) => `${String(i + 1).padStart(2)} ${id === PLAYER_ID ? '▶ You' : (this.names.get(id) ?? id)}`);
    const half = Math.ceil(order.length / 2);
    this.text(220, 196, order.slice(0, half).join('\n'), 15, COLORS.cream, { lineSpacing: 2 }).setFontFamily('Consolas, "Courier New", monospace');
    this.text(700, 196, order.slice(half).join('\n'), 15, COLORS.cream, { lineSpacing: 2 }).setFontFamily('Consolas, "Courier New", monospace');
    this.box(100, 340, 1080, 300);
    const message = this.messagePicker(352);
    this.text(130, 508, `The pit board comes out as you finish each lap, and you can change your message ${racing.ink} times a moto. Auto-complete holds your message all race. You retire at ${racing.sim.retireAtBroken} broken parts.`, 19, COLORS.cream, { wordWrap: { width: 1020 }, lineSpacing: 2 });
    this.btn(W / 2 - 300, 600, 'Race', () => this.go(-1, message(), false), 260, 52);
    this.btn(W / 2, 600, 'Auto-complete', () => this.go(-1, message(), true), 260, 52);
    this.btn(W / 2 + 300, 600, 'Bike check', () => this.showBike(), 260, 52);
    if (n > 1) this.btn(W / 2, 682, 'Leave early', () => this.confirmLeave(), 200, 44);
  }

  /** Seconds between riders leaving a sprint's start line. */
  private sprintInterval(): number {
    return services.content.racing.sim.sprint?.interval ?? 10;
  }

  /**
   * A sprint rider's timed tests finished by the clock: from leaving the start line to the
   * finish line, lap by lap (the return lane and the queue aren't timed).
   */
  private sprintTimes(id: string): number[] {
    const out: number[] = [];
    for (const tr of this.traces) {
      const t = tr.times[id];
      if (!t || t.length !== tr.marks.length) continue;
      const away = tr.secs[0] === 0 && tr.secs[1] === SPRINT_QUEUE ? t[2] : t[0];
      if (t.at(-1)! <= this.clock) out.push(t.at(-1)! - away);
    }
    return out;
  }

  /** What a sprint rider is doing now, for the overlay: on the test, rolling back, or waiting to go (and how long). */
  private sprintStatus(id: string): string {
    for (const tr of this.traces) {
      const t = tr.times[id];
      if (!t) continue;
      const queued = tr.secs[1] === SPRINT_QUEUE;
      const away = queued ? t[2] : t[0];
      if (away === undefined) continue;
      if (queued && this.clock < t[1]) return 'Rolling back down the return lane';
      if (this.clock < away) return `Waiting at the start: away in ${Math.ceil(away - this.clock)}s`;
      if (t.length === tr.marks.length && this.clock >= t.at(-1)!) continue;
      return `On test ${tr.lap}: ${formatTime(this.clock - away)}`;
    }
    return 'Finished';
  }

  /** The starting message buttons, from y down: returns the message picked. */
  private messagePicker(y: number): () => string {
    const { racing } = services.content;
    this.text(130, y, 'Starting message', 24, COLORS.accent);
    let message = 'steady';
    const msgButtons: Button[] = [];
    racing.messages.forEach((m, i) => {
      const b = this.btn(250 + i * 280, y + 62, m.name, () => {
        message = m.id;
        msgButtons.forEach((o, j) => o.setSelected(j === i));
      }, 240, 48);
      b.setSelected(m.id === message);
      msgButtons.push(b);
      this.text(130 + i * 280, y + 94, m.desc, 18, COLORS.muted, { wordWrap: { width: 250 } });
    });
    return () => message;
  }

  // ---- championship rounds: qualifying (Spec 12.2) ----

  private showQualifyingStart(): void {
    const day = this.day!;
    if (day.sprint) return this.showSprintQualifying();
    const laps = day.round!.qualifyingLaps;
    this.clear();
    this.header(this.dayTitle(), `Qualifying · an out lap and ${laps} timed laps · ${day.field.length} riders`);
    this.text(W / 2, 108, 'Your best timed lap sets your place in the gate pick for moto 1. Qualifying scores no points.', 22).setOrigin(0.5, 0);
    this.text(W / 2, 146, 'Everyone goes out together from a random spot on the start; the out lap from the gate is not timed.', 18, COLORS.muted).setOrigin(0.5, 0);
    this.box(100, 286, 1080, 356);
    const message = this.messagePicker(300);
    const { racing } = services.content;
    this.text(130, 462, `The pit board comes out each lap as in a moto, with ${racing.ink} message changes. Auto-complete holds your message all session. Parts wear as in a race, and there are no repairs at the track.`, 19, COLORS.cream, { wordWrap: { width: 1020 }, lineSpacing: 2 });
    this.btn(W / 2 - 300, 600, 'Qualify', () => this.goQualifying(message(), false), 260, 52);
    this.btn(W / 2, 600, 'Auto-complete', () => this.goQualifying(message(), true), 260, 52);
    this.btn(W / 2 + 300, 600, 'Bike check', () => this.showBike(), 260, 52);
  }

  /** A sprint's qualifying: one timed lap, one rider at a time in a random order, to set the start order. */
  private showSprintQualifying(): void {
    const day = this.day!;
    this.clear();
    this.header(this.dayTitle(), `Qualifying · one timed lap · ${day.field.length} riders · one at a time`);
    this.text(W / 2, 108, 'Your time on one timed lap sets your place in the start order for moto 1: the fastest go first. Qualifying scores no points.', 22, COLORS.cream, { wordWrap: { width: 1100 }, align: 'center' }).setOrigin(0.5, 0);
    this.text(W / 2, 176, `Riders leave the start line one at a time, ${this.sprintInterval()} seconds apart, in a random order. You go ${ordinal(day.pickOrder.indexOf(PLAYER_ID) + 1)}.`, 18, COLORS.muted).setOrigin(0.5, 0);
    this.box(100, 286, 1080, 356);
    const message = this.messagePicker(300);
    this.text(130, 462, 'Auto-complete holds your message for the lap. Parts wear as in a race, and there are no repairs at the track.', 19, COLORS.cream, { wordWrap: { width: 1020 }, lineSpacing: 2 });
    this.btn(W / 2 - 300, 600, 'Qualify', () => this.goQualifying(message(), false), 260, 52);
    this.btn(W / 2, 600, 'Auto-complete', () => this.goQualifying(message(), true), 260, 52);
    this.btn(W / 2 + 300, 600, 'Bike check', () => this.showBike(), 260, 52);
  }

  private goQualifying(message: string, auto: boolean): void {
    this.sim = this.day!.startQualifying(message);
    this.auto = auto;
    this.qualifying = true;
    this.startLive();
  }

  private showQualifyingResults(): void {
    const day = this.day!;
    const rec = day.finishQualifying(this.sim!);
    this.qualifying = false;
    this.clear();
    this.header('Qualifying results', this.dayTitle());
    const rows = rec.results.map((r) => {
      const name = (r.player ? `${this.save.rider.name} (you)` : r.name).padEnd(22).slice(0, 22);
      const best = r.bestLap !== null ? formatTime(r.bestLap, 3) : '—';
      return `${String(r.position).padStart(2)}  ${name} ${best.padStart(8)}  ${(r.position === 1 ? 'Pole' : r.gap).padStart(9)}`;
    });
    const t = this.text(40, 110, ['Pos Rider                      Best        Gap', ...rows].join('\n'), 16, COLORS.cream, { lineSpacing: 5 }).setFontFamily('Consolas, "Courier New", monospace');
    const mine = rec.results.findIndex((r) => r.player);
    const lh = t.height / (rows.length + 1);
    this.screen.add(this.add.rectangle(34, 110 + lh * (mine + 1), 640, lh, COLORS.accentDark, 0.45).setOrigin(0, 0));
    this.screen.bringToTop(t);
    const me = rec.results[mine];
    this.box(740, 110, 500, 470);
    this.text(764, 126, 'Your qualifying', 24, COLORS.accent);
    const xp = Object.values(rec.xp).reduce((a, b) => a + b, 0);
    this.text(764, 170, [
      me.bestLap === null ? 'No timed lap' : `${ordinal(me.position)} fastest${me.position === 1 ? (day.sprint ? ': you go first!' : ': pole position!') : ''}`,
      `${day.sprint ? 'Timed lap' : 'Best timed lap'}: ${me.bestLap !== null ? formatTime(me.bestLap, 3) : '—'}`,
      day.sprint ? `You leave the start ${ordinal(me.position)} in moto 1.` : `You pick your gate ${ordinal(me.position)} for moto 1.`,
      `Rider XP: ${xp.toFixed(0)}`,
    ].join('\n'), 20, COLORS.cream, { lineSpacing: 10, wordWrap: { width: 450 } });
    this.btn(990, 640, 'Moto 1', () => this.showGatePick(), 260, 50);
  }

  private confirmLeave(): void {
    const c = this.openModal(620, 240);
    c.add(this.add.text(0, -60, "Leave before moto 2? It counts as a DNF.\nYou keep everything you earned in moto 1.", textStyle(20, COLORS.cream, { align: 'center' })).setOrigin(0.5));
    c.add(button(this, -130, 50, 'Leave', () => {
      this.closeModal();
      this.day!.leaveEarly();
      this.showDayResults();
    }, 200, 46));
    c.add(button(this, 130, 50, 'Stay', () => this.closeModal(), 200, 46));
  }

  private showBike(): void {
    const career = this.save.career;
    const bike = this.ko?.player.bike ?? this.day?.player.bike ?? career.bike;
    const c = this.openModal(620, 520);
    c.add(this.add.text(0, -230, 'Your bike', textStyle(24, COLORS.accent)).setOrigin(0.5));
    services.content.bikes.slots.forEach((s, i) => {
      const p = bike.parts[s.id];
      const cond = p ? Math.round(p.condition * 100) : 0;
      const y = -180 + i * 34;
      c.add(this.add.text(-270, y, s.name, textStyle(17)));
      c.add(this.add.rectangle(-30, y + 11, 200, 12, COLORS.panelLight).setOrigin(0, 0.5));
      c.add(this.add.rectangle(-30, y + 11, Math.max(1, 2 * cond), 12, cond === 0 ? 0xb03030 : cond <= 20 ? COLORS.accent : 0x6fa84a).setOrigin(0, 0.5));
      c.add(this.add.text(185, y, cond === 0 ? 'Broken' : `${cond}%`, textStyle(17, cond <= 20 ? COLORS.accent : COLORS.cream)));
    });
    c.add(this.add.text(0, 170, 'No repairs at the track. Parts wear as you ride.', textStyle(15, COLORS.muted)).setOrigin(0.5));
    c.add(button(this, 0, 220, 'Close', () => this.closeModal(), 200, 44));
  }

  private go(gate: number, message: string, auto: boolean): void {
    const day = this.day!;
    // A sprint has no gates: riders leave in the start order (RaceDay.startMoto).
    if (!day.sprint) day.assignGates(gate);
    this.sim = day.startMoto(message);
    this.auto = auto;
    if (auto) {
      this.startLive();
      return;
    }
    if (!this.explained) {
      this.explained = true;
      const c = this.openModal(760, 400);
      c.add(this.add.text(0, -160, 'Your first race', textStyle(26, COLORS.accent)).setOrigin(0.5));
      c.add(this.add.text(0, -20, [
        'The race runs itself: your skills and your bike decide how fast you go.',
        'You are the orange rider with the arrow over you. The tower on the right is the running order.',
        'Each time the leader crosses the line, the pit board comes out. Pick a message, or keep the one you have.',
        'Goal for today: finish both motos.',
      ].join('\n\n'), textStyle(18, COLORS.cream, { align: 'center', wordWrap: { width: 680 } })).setOrigin(0.5));
      c.add(button(this, 0, 160, "Let's go", () => {
        this.closeModal();
        this.startLive();
      }, 220, 46));
      return;
    }
    this.startLive();
  }

  // ---- the live race screen ----

  private startLive(): void {
    const sim = this.sim!;
    this.clear();
    const from = startGeom(sim.track).from;
    // Riders already out in practice set off before 0 (MotoSim's startAt).
    this.cps = new Map(sim.riders.map((r) => [r.e.id, { t: [r.time], d: [from] }]));
    this.boardLaps = 1;
    this.boardAt = 0;
    this.myLaps = 0;
    this.wearAt = sim.playerBike ? [{ t: 0, parts: structuredClone(sim.playerBike.parts) }] : [];
    this.practiceAt = [];
    this.detailTab = 'bike';
    this.traces = [];
    this.raceEvents = [];
    this.eventIndex = 0;
    this.feed = [];
    this.clock = 0;
    this.paused = false;
    this.retiredAt = null;
    this.detail = false;

    const practice = this.args.mode === 'practice';
    // The whole window: the track view takes the room past 1280 × 720, the side column stays on the right.
    this.screen.setPosition(0, 0);
    const { dw, dh } = this;
    const vw = dw - 380;
    const right = dw - 350;
    this.box(16, 16, vw, 54);
    this.ui.title = this.text(32, 30, '', 20, COLORS.cream);
    // Your message, then the pen: one section of ink per message change (racing data's ink).
    this.ui.ink = this.text(vw - PEN_W - 14, 30, '', 20, COLORS.accent).setOrigin(1, 0);
    this.pen = penMeter(this, vw - PEN_W, 43, services.content.racing.ink, PEN_W);
    this.screen.add(this.pen);
    this.pen.setVisible(!practice);
    // Riders ride up to the start in the order they picked their gates.
    this.director = directorFor(sim, services.content.bikes, services.content.racing.messages, this.day?.pickOrder);
    // The view keeps the 1280 × 720 layout's scale (900 wide), so a wider one shows more track, not bigger bikes.
    // The track takes the whole height (Boss, 28 Oct 2026): your position, lap, gaps and bike float
    // over its top-left corner as outlined text, and the race log sits under the standings.
    this.view = new RaceView(this, this.screen, sim.track, services.content.trackParts, 16, 82, vw, dh - 98, undefined, { scaleWidth: 900 });
    this.view.hasStart = !practice;
    // Fireworks at the finish only where riders race to the line together, not in qualifying or a knockout's seeding run.
    this.view.showFireworks = !practice && !this.qualifying && !(this.ko && !this.koHeat);
    // The flag man and the pit boards count the race's laps.
    this.view.setLaps(practice ? undefined : sim.totalLaps ?? undefined);
    this.ui.me = this.text(30, 94, '', 18, COLORS.cream, { lineSpacing: 4, ...OVERLAY });
    this.box(right, 16, 334, dh - 160);
    // The standings show as many rows as fit above the log, scrolled to keep you in view.
    this.towerRows = Math.max(6, Math.floor((dh - 160 - 28 - FEED_H) / TOWER_ROW));
    this.ui.tower = this.text(right + 16, 30, '', 16, COLORS.cream, { lineSpacing: 7 });
    this.ui.feed = this.text(right + 16, 30 + this.towerRows * TOWER_ROW + 12, '', 14, COLORS.cream, { lineSpacing: 5, wordWrap: { width: 302 } });
    this.ui.detail = this.text(right + 16, 76, '', 15, COLORS.cream, { lineSpacing: 5 }).setVisible(false);
    // Details: the bike's parts, or section times.
    this.detailTabs = (['bike', 'sections'] as const).map((tab, i) => {
      const b = this.btn(right + 85 + i * 160, 46, tab === 'bike' ? 'Bike' : 'Section times', () => {
        this.detailTab = tab;
        this.detailTabs.forEach((o, j) => o.setSelected(j === i));
        this.renderDetail();
      }, 150, 34);
      b.setSelected(tab === this.detailTab);
      b.setVisible(false);
      return b;
    });

    // Speed buttons and actions.
    const speedButtons = SPEED_LABELS.map((l, i) => this.btn(right + 32 + i * 64, dh - 116, l, () => {
      this.speed = i;
      this.paused = false;
      speedButtons.forEach((b, j) => b.setSelected(j === i));
    }, 60, 40));
    speedButtons[this.speed].setSelected(true);
    if (practice) {
      this.btn(right + 92, dh - 60, 'Stop riding', () => this.stopPractice(), 170, 44);
      this.btn(right + 260, dh - 60, 'Details', () => this.toggleDetail(), 130, 44);
    } else {
      this.btn(right + 82, dh - 60, 'Retire', () => this.confirmRetire(), 150, 44);
      this.btn(right + 250, dh - 60, 'Details', () => this.toggleDetail(), 150, 44);
    }
    this.addLap(sim.nextLap());
    // A race opens with the start procedure: the line-up, then the board and the five-second
    // hold, all in negative race time up to the gate drop at 0 (riderAI lineUp, RaceView updateStart).
    this.clock = practice ? 0 : -this.director.prestart;
    this.live = true;
    this.onTick = () => this.tick();
    this.tick();
  }

  private toggleDetail(): void {
    this.detail = !this.detail;
    this.ui.tower.setVisible(!this.detail);
    this.ui.feed.setVisible(!this.detail);
    this.ui.detail.setVisible(this.detail);
    this.detailTabs.forEach((b) => b.setVisible(this.detail));
    this.renderDetail();
  }

  private addLap(trace: LapTrace): void {
    const sim = this.sim!;
    for (const [id, times] of Object.entries(trace.times)) {
      const cp = this.cps.get(id)!;
      for (let i = 1; i < times.length; i++) {
        cp.t.push(times[i]);
        cp.d.push(trace.marks[i]);
      }
    }
    // The bike as the simulation left it after this lap, shown once the player has ridden it.
    const mine = trace.times[PLAYER_ID];
    if (sim.playerBike && mine) this.wearAt.push({ t: mine[mine.length - 1], parts: structuredClone(sim.playerBike.parts) });
    if (this.args.mode === 'practice' && sim.playerBike && mine) this.practiceAt.push({ end: mine[mine.length - 1], xp: { ...sim.xp }, parts: structuredClone(sim.playerBike.parts) });
    this.traces.push(trace);
    this.director?.addLap(trace);
    this.raceEvents.push(...trace.events);
    this.raceEvents.sort((a, b) => a.t - b.t);
    this.renderDetail();
  }

  /**
   * Where each rider is at the current clock, in laps, and how many checkpoints they have passed.
   * A rider who has taken the flag keeps their finishing time, which fixes their place.
   */
  private positions(): { id: string; dist: number; k: number; out: boolean; finished: boolean; finishT: number; gate: number }[] {
    const sim = this.sim!;
    const res = [];
    for (const r of sim.riders) {
      const cp = this.cps.get(r.e.id)!;
      let k = 0;
      while (k + 1 < cp.t.length && cp.t[k + 1] <= this.clock) k++;
      let dist = cp.d[k];
      if (k + 1 < cp.t.length && this.clock > cp.t[k]) dist += ((this.clock - cp.t[k]) / (cp.t[k + 1] - cp.t[k])) * (cp.d[k + 1] - cp.d[k]);
      const lastLap = sim.totalLaps;
      const finished = lastLap !== null && cp.d[k] >= lastLap - 1e-9;
      const out = (r.retired && k === cp.t.length - 1 && !finished) || (r.e.player && this.retiredAt !== null);
      res.push({ id: r.e.id, dist, k, out, finished, finishT: finished ? cp.t[k] : Infinity, gate: r.e.gate });
    }
    return res;
  }

  /**
   * Running order as drawn: riders who have finished first, in the order they took the flag, then
   * the rest furthest round first, riders who are out at the bottom.
   */
  private runningOrder<T extends { dist: number; out: boolean; finishT: number; gate: number }>(pos: T[]): T[] {
    return [...pos].sort((a, b) => Number(a.out) - Number(b.out) || a.finishT - b.finishT || b.dist - a.dist || a.gate - b.gate);
  }

  /** When a rider passed race distance d, from their timing points (the clock if they haven't yet). */
  private timeAt(id: string, d: number): number {
    const cp = this.cps.get(id)!;
    let k = 0;
    while (k + 1 < cp.d.length && cp.d[k + 1] < d) k++;
    if (k + 1 >= cp.d.length) return this.clock;
    const t = cp.t[k] + ((d - cp.d[k]) / Math.max(1e-9, cp.d[k + 1] - cp.d[k])) * (cp.t[k + 1] - cp.t[k]);
    return Math.min(this.clock, t);
  }

  /** How far behind rider a rider b is: at the flag once both have finished, else now against when a passed this spot. */
  private behind(a: { id: string; finished: boolean; finishT: number }, b: { id: string; dist: number; finished: boolean; finishT: number }): number {
    if (b.finished) return a.finished ? b.finishT - a.finishT : 0;
    return Math.max(0, this.clock - this.timeAt(a.id, b.dist));
  }

  private tick(): void {
    const sim = this.sim!;
    const practice = this.args.mode === 'practice';
    // The leader reaches the end of the latest lap we have: the simulation runs the next one.
    const latest = this.traces.at(-1)!;
    const lapEnds = Object.values(latest.times).filter((t) => t.length === latest.marks.length).map((t) => t.at(-1)!);
    const leaderCross = lapEnds.length ? Math.min(...lapEnds) : Infinity;
    if (!sim.finished && this.clock >= leaderCross) {
      if (practice) {
        this.clock = leaderCross;
        this.addLap(sim.nextLap());
        if (sim.finished) this.stopPractice(true);
      } else this.addLap(sim.nextLap());
    }
    // You cross the line: the pit board comes out then, whoever is leading.
    if (!practice && this.crossLine()) return;
    // Lap traces only exist up to the latest lap, so a non-leader parked at its end just waits.
    const lastT = Math.max(...[...this.cps.values()].map((c) => c.t.at(-1)!));
    if (!practice && sim.finished && this.clock >= lastT) {
      this.live = false;
      this.render();
      this.time.delayedCall(800, () => this.finishMoto());
      return;
    }
    while (this.eventIndex < this.raceEvents.length && this.raceEvents[this.eventIndex].t <= this.clock) this.say(this.raceEvents[this.eventIndex++]);
    this.render();
  }

  /**
   * Counts your laps off as the clock passes your own line crossings, and brings the pit board out
   * when one is due: once per crossing, at the moment you cross, on every lap but the last.
   */
  private crossLine(): boolean {
    const sim = this.sim!;
    const tr = this.traces.find((x) => x.lap === this.myLaps + 1);
    const mine = tr?.times[PLAYER_ID];
    if (!tr || !mine || mine.length !== tr.marks.length || this.clock < mine.at(-1)!) return false;
    this.myLaps = tr.lap;
    // Only while you are still racing into another lap.
    const next = this.traces.find((x) => x.lap === tr.lap + 1);
    if (this.auto || this.retiredAt !== null || tr.lap >= sim.totalLaps! || tr.lap < this.boardAt || (next && !next.times[PLAYER_ID])) return false;
    this.clock = mine.at(-1)!;
    this.render();
    this.pitBoard();
    return true;
  }

  /**
   * Runs the lap you are starting again after a change at the pit board, when the simulation ran
   * it as the leader crossed the line. Riders who got there before you ride it exactly as before
   * (MotoSim.redoLap), so nothing already on screen moves. False when it is too late for that (you
   * were lapped and the lap after is already under way): the change then counts from the next lap.
   */
  private redoMyLap(change: () => void): boolean {
    const sim = this.sim!;
    if (sim.lap !== this.myLaps + 1) return false;
    const old = this.traces.pop()!;
    for (const [id, times] of Object.entries(old.times)) {
      const cp = this.cps.get(id)!;
      cp.t.length -= times.length - 1;
      cp.d.length -= times.length - 1;
    }
    if (sim.playerBike && old.times[PLAYER_ID]) this.wearAt.pop();
    const gone = new Set(old.events);
    this.raceEvents = this.raceEvents.filter((e) => !gone.has(e));
    this.director?.dropLap(old);
    this.addLap(sim.redoLap(change));
    this.eventIndex = this.raceEvents.filter((e) => e.t <= this.clock).length;
    return true;
  }

  private render(): void {
    const sim = this.sim!;
    const pos = this.positions();
    const practice = this.args.mode === 'practice';
    const order = this.runningOrder(pos);
    const leader = order[0];
    // Time behind the leader: at the finish line once both have finished, else at the last timing point the rider passed.
    const gap = (p: (typeof pos)[0]) => this.behind(leader, p);
    this.refreshDetail();
    const poses = this.director?.poses(this.clock) ?? [];
    // In qualifying the numbers over the bikes are the order of best timed laps, as in the tower;
    // in a sprint, the order on time.
    const sprint = !!this.day?.sprint && !practice;
    const labels = sprint ? this.sprintOrder(pos).map((r) => r.p) : this.qualifying ? this.qualifyingOrder(pos).map((r) => r.p) : order;
    this.view?.update(poses.map((p) => ({
      pose: p,
      color: this.colors.get(p.id) ?? COLORS.accent,
      look: this.looks.get(p.id),
      label: String(labels.findIndex((o) => o.id === p.id) + 1),
      player: p.id === PLAYER_ID,
      startRow: this.director!.startRow(p.id),
    })), this.clock, this.frameDt, this.focus(pos, leader.id));

    const me = pos.find((p) => p.id === PLAYER_ID)!;
    const myLap = Math.max(1, Math.min(Math.floor(me.dist) + 1, sim.totalLaps ?? Infinity));
    const msg = services.content.racing.messages.find((m) => m.id === sim.playerMessage)!;
    if (practice) {
      this.ui.title.setText(`${this.args.venue.name} · Practice · Lap ${myLap}`);
      this.ui.ink.setText('');
      const p = { lapTimes: this.practiceLaps() };
      const best = p.lapTimes.length ? Math.min(...p.lapTimes) : null;
      const xp = Object.values(this.practiceXpNow()).reduce((a, b) => a + b, 0);
      this.ui.me.setText([`Laps done: ${p.lapTimes.length}`, `Last lap: ${p.lapTimes.length ? formatTime(p.lapTimes.at(-1)!) : '—'}`, `Best lap: ${best !== null ? formatTime(best) : '—'}`, `Practice XP: ${xp.toFixed(1)}`].join('\n'));
      this.ui.feed.setText(this.bikeLines().join('\n'));
      const laps = p.lapTimes.map((t, i) => `Lap ${String(i + 1).padStart(3)}   ${formatTime(t)}${t === best ? '  best' : ''}`).slice(-(this.towerRows - 2));
      this.ui.tower.setText(['Lap times', '', ...laps].join('\n')).setFontFamily('Consolas, "Courier New", monospace');
      return;
    }
    const total = sim.totalLaps!;
    if (sprint) {
      this.renderSprint(pos, me);
      return;
    }
    if (this.qualifying) {
      this.renderQualifying(pos, me);
      return;
    }
    if (this.ko) {
      this.renderKo(pos, me, order);
      return;
    }
    this.ui.title.setText(`${this.args.venue.name} · Moto ${this.day!.motoNumber} · Lap ${Math.max(1, Math.min(Math.floor(leader.dist) + 1, total))} of ${total}${this.auto ? ' · Auto-complete' : ''}`);
    const until = this.auto || this.boardAt === Infinity ? ' to the flag' : this.boardAt > this.myLaps ? ` to lap ${this.boardAt}` : '';
    this.ui.ink.setText(`${msg.name}${until}`);
    this.pen?.setLevel(sim.ink);

    const rank = order.findIndex((o) => o.id === PLAYER_ID);
    const ahead = order[rank - 1];
    const behind = order[rank + 1];
    const lines = [];
    if (me.out) lines.push('You are out of this moto.');
    else {
      lines.push(`Position: ${ordinal(rank + 1)} of ${order.length}`);
      lines.push(`Your lap: ${myLap} of ${total}`);
      const split = (a: (typeof pos)[0], b: (typeof pos)[0]) => this.behind(a, b).toFixed(1);
      if (ahead) lines.push(`Ahead: ${this.names.get(ahead.id)} ${split(ahead, me)}s`);
      if (behind && !behind.out) lines.push(`Behind: ${this.names.get(behind.id)} ${split(me, behind)}s`);
      const broken = this.brokenParts();
      lines.push(broken.length ? `Broken: ${broken.join(', ')}` : 'Bike: nothing broken');
    }
    this.ui.me.setText(lines.join('\n'));
    this.ui.feed.setText(this.feed.slice(-5).join('\n'));
    const rows = order.map((p, i) => {
      const name = (this.names.get(p.id) ?? '').padEnd(15).slice(0, 15);
      const g = p.out ? 'OUT' : i === 0 ? (p.finished ? formatTime(p.finishT) : 'Leader') : `+${gap(p).toFixed(1)}`;
      return `${String(i + 1).padStart(2)}  ${p.id === PLAYER_ID ? '▶ ' : '  '}${name} ${g.padStart(7)}`;
    });
    this.ui.tower.setText(towerWindow(rows, rank, this.towerRows).join('\n'));
    this.ui.tower.setFontFamily('Consolas, "Courier New", monospace');
    if (!this.skipButton && (me.out || me.finished)) {
      this.skipButton = this.btn(16 + (this.dw - 380) / 2, this.dh - 50, 'Skip to results', () => {
        while (!sim.finished) this.addLap(sim.nextLap());
        this.live = false;
        this.finishMoto();
      }, 300, 40);
    }
  }

  /**
   * Who the camera follows: you, or the leader once you are out. In a knockout's seeding run,
   * while you wait your turn or once you are done, the rider out on their run who left last.
   */
  private focus(pos: ReturnType<RaceScene['positions']>, leader: string): string {
    const me = pos.find((p) => p.id === PLAYER_ID)!;
    if (this.ko && !this.koHeat) {
      const away = (id: string) => this.cps.get(id)!.t[0];
      if (this.clock >= away(PLAYER_ID) && !me.finished && !me.out) return PLAYER_ID;
      const out = pos.filter((p) => !p.finished && !p.out && away(p.id) <= this.clock).sort((a, b) => away(b.id) - away(a.id));
      return out[0]?.id ?? PLAYER_ID;
    }
    return me.out ? leader : PLAYER_ID;
  }

  /**
   * Each rider's best timed lap so far (the out lap, lap 1, isn't timed), from when they passed
   * each finish line. Null until they have done one.
   */
  private bestTimed(id: string): number | null {
    const cp = this.cps.get(id)!;
    const ends = new Map<number, number>();
    for (let i = 0; i < cp.t.length && cp.t[i] <= this.clock; i++) {
      const d = cp.d[i];
      if (d >= 1 && Math.abs(d - Math.round(d)) < 1e-9) ends.set(Math.round(d), cp.t[i]);
    }
    let best: number | null = null;
    for (const [lap, t] of ends) {
      const before = ends.get(lap - 1);
      if (lap >= 2 && before !== undefined) best = best === null ? t - before : Math.min(best, t - before);
    }
    return best;
  }

  /** Riders by best timed lap so far, then those with no time yet furthest round first. */
  private qualifyingOrder<T extends { id: string; dist: number }>(pos: T[]): { p: T; best: number | null }[] {
    const rows = pos.map((p) => ({ p, best: this.bestTimed(p.id) }));
    return rows.sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || b.p.dist - a.p.dist);
  }

  /** The live screen in qualifying: the tower is the order of best timed laps. */
  private renderQualifying(pos: ReturnType<RaceScene['positions']>, me: ReturnType<RaceScene['positions']>[number]): void {
    const sim = this.sim!;
    const total = sim.totalLaps!;
    const myLap = Math.max(1, Math.min(Math.floor(me.dist) + 1, total));
    const msg = services.content.racing.messages.find((m) => m.id === sim.playerMessage)!;
    this.ui.title.setText(`${this.args.venue.name} · Qualifying · ${myLap === 1 ? 'Out lap' : `Timed lap ${myLap - 1} of ${total - 1}`}${this.auto ? ' · Auto-complete' : ''}`);
    const until = this.auto || this.boardAt === Infinity ? ' to the flag' : this.boardAt > this.myLaps ? ` to lap ${this.boardAt}` : '';
    this.ui.ink.setText(`${msg.name}${until}`);
    this.pen?.setLevel(sim.ink);
    const rows = this.qualifyingOrder(pos);
    const pole = rows[0].best;
    const mine = rows.findIndex((r) => r.p.id === PLAYER_ID);
    const myBest = rows[mine].best;
    const lines = [];
    if (me.out) lines.push('You are out of qualifying.');
    else {
      lines.push(myBest === null ? 'No timed lap yet' : `Provisional: ${ordinal(mine + 1)} of ${rows.length}`);
      lines.push(myLap === 1 ? 'Out lap: not timed' : `Timed lap ${myLap - 1} of ${total - 1}`);
      lines.push(`Your best: ${myBest !== null ? formatTime(myBest, 3) : '—'}${myBest !== null && pole !== null && mine > 0 ? `  (+${(myBest - pole).toFixed(3)}s)` : ''}`);
      const broken = this.brokenParts();
      lines.push(broken.length ? `Broken: ${broken.join(', ')}` : 'Bike: nothing broken');
    }
    this.ui.me.setText(lines.join('\n'));
    this.ui.feed.setText(this.feed.slice(-5).join('\n'));
    const tower = rows.map((r, i) => {
      const name = (this.names.get(r.p.id) ?? '').padEnd(15).slice(0, 15);
      const g = r.best === null ? (r.p.out ? 'OUT' : '—') : i === 0 ? formatTime(r.best, 3) : `+${(r.best - pole!).toFixed(3)}`;
      return `${String(i + 1).padStart(2)}  ${r.p.id === PLAYER_ID ? '▶ ' : '  '}${name} ${g.padStart(7)}`;
    });
    this.ui.tower.setText(['Best timed laps', ...towerWindow(tower, mine, this.towerRows - 1)].join('\n'));
    this.ui.tower.setFontFamily('Consolas, "Courier New", monospace');
    if (!this.skipButton && (me.out || me.finished)) {
      this.skipButton = this.btn(16 + (this.dw - 380) / 2, this.dh - 50, 'Skip to results', () => {
        while (!sim.finished) this.addLap(sim.nextLap());
        this.live = false;
        this.finishMoto();
      }, 300, 40);
    }
  }

  /**
   * A sprint's order on time: riders with the most timed laps done first, then the lowest total
   * time over them; riders yet to finish a lap in the order they leave; anyone out at the bottom.
   */
  private sprintOrder<T extends { id: string; out: boolean; gate: number }>(pos: T[]): { p: T; times: number[]; total: number }[] {
    const rows = pos.map((p) => {
      const times = this.sprintTimes(p.id);
      return { p, times, total: times.reduce((a, b) => a + b, 0) };
    });
    return rows.sort((a, b) => Number(a.p.out) - Number(b.p.out) || b.times.length - a.times.length || a.total - b.total || a.p.gate - b.p.gate);
  }

  /** The live screen in an enduro sprint (or its qualifying): the tower is the order on total time. */
  private renderSprint(pos: ReturnType<RaceScene['positions']>, me: ReturnType<RaceScene['positions']>[number]): void {
    const sim = this.sim!;
    const total = sim.totalLaps!;
    const mineTimes = this.sprintTimes(PLAYER_ID);
    const myLap = Math.min(mineTimes.length + 1, total);
    const msg = services.content.racing.messages.find((m) => m.id === sim.playerMessage)!;
    const what = this.qualifying ? 'Qualifying · one timed lap' : `Moto ${this.day!.motoNumber} · Lap ${myLap} of ${total}`;
    this.ui.title.setText(`${this.args.venue.name} · ${what}${this.auto ? ' · Auto-complete' : ''}`);
    const until = this.auto || this.boardAt === Infinity ? ' to the flag' : this.boardAt > this.myLaps ? ` to lap ${this.boardAt}` : '';
    this.ui.ink.setText(`${msg.name}${until}`);
    this.pen?.setLevel(sim.ink);
    const rows = this.sprintOrder(pos);
    const lead = rows[0];
    const rank = rows.findIndex((r) => r.p.id === PLAYER_ID);
    const mine = rows[rank];
    const lines = [];
    if (me.out) lines.push(this.qualifying ? 'You are out of qualifying.' : 'You are out of this moto.');
    else {
      lines.push(mine.times.length ? `On time: ${ordinal(rank + 1)} of ${rows.length}` : `Started ${ordinal(me.gate + 1)} of ${rows.length}: no time yet`);
      lines.push(this.sprintStatus(PLAYER_ID));
      if (mineTimes.length) lines.push(`Last lap: ${formatTime(mineTimes.at(-1)!, 3)}   Total: ${formatTime(mine.total, 3)}`);
      const broken = this.brokenParts();
      lines.push(broken.length ? `Broken: ${broken.join(', ')}` : 'Bike: nothing broken');
    }
    this.ui.me.setText(lines.join('\n'));
    this.ui.feed.setText(this.feed.slice(-5).join('\n'));
    const tower = rows.map((r, i) => {
      const name = (this.names.get(r.p.id) ?? '').padEnd(15).slice(0, 15);
      const g = r.p.out ? 'OUT' : !r.times.length ? '—' : i === 0 ? formatTime(r.total) : r.times.length < lead.times.length ? `${r.times.length}/${total}` : `+${(r.total - lead.total).toFixed(1)}`;
      return `${String(i + 1).padStart(2)}  ${r.p.id === PLAYER_ID ? '▶ ' : '  '}${name} ${g.padStart(7)}`;
    });
    this.ui.tower.setText([this.qualifying ? 'Qualifying times' : 'Total time', ...towerWindow(tower, rank, this.towerRows - 2)].join('\n'));
    this.ui.tower.setFontFamily('Consolas, "Courier New", monospace');
    if (!this.skipButton && (me.out || me.finished)) {
      this.skipButton = this.btn(16 + (this.dw - 380) / 2, this.dh - 50, 'Skip to results', () => {
        while (!sim.finished) this.addLap(sim.nextLap());
        this.live = false;
        this.finishMoto();
      }, 300, 40);
    }
  }

  /** Redraws Details when what it shows has moved on: you crossed the line (new wear, a new lap of section times). */
  private refreshDetail(): void {
    if (!this.detail) return;
    const mine = this.cps.get(PLAYER_ID);
    const key = `${this.detailTab} ${this.bikeNow()?.lap ?? -1} ${mine ? mine.t.filter((t) => t <= this.clock).length : 0}`;
    if (key !== this.detailKey) this.renderDetail();
  }

  private renderDetail(): void {
    const t = this.ui.detail;
    const sim = this.sim;
    if (!t || !sim || !this.detail) return;
    const mine = this.cps.get(PLAYER_ID);
    this.detailKey = `${this.detailTab} ${this.bikeNow()?.lap ?? -1} ${mine ? mine.t.filter((x) => x <= this.clock).length : 0}`;
    t.setFontFamily('Consolas, "Courier New", monospace');
    if (this.detailTab === 'bike') return void t.setText(this.bikeDetail().join('\n'));
    const done = [...this.traces].reverse().find((tr) => (tr.times[PLAYER_ID]?.length ?? 0) === tr.marks.length && tr.times[PLAYER_ID].at(-1)! <= this.clock);
    if (!done) return void t.setText('Section times\n\nAfter your first full lap.');
    const lines = [`Section times, lap ${done.lap}`, 'yours  vs the fastest', ''];
    done.secs.forEach((si, i) => {
      const dur = (id: string) => {
        const a = done.times[id];
        return a && a.length > i + 1 ? a[i + 1] - a[i] : Infinity;
      };
      const mine = dur(PLAYER_ID);
      const best = Math.min(...Object.keys(done.times).map(dur));
      const name = si === -2 ? 'First corner' : si < 0 ? 'Start straight' : (services.content.racing.sections[sim.track.sections[si].type]?.name ?? sim.track.sections[si].type);
      lines.push(`${name.padEnd(15).slice(0, 15)} ${mine.toFixed(1).padStart(5)} ${mine - best > 0.05 ? `+${(mine - best).toFixed(1)}` : ' best'}`);
    });
    t.setText(lines.join('\n'));
  }

  /** The player's bike as of the last time they crossed the line (or at the gate), from the simulation's own wear. */
  private bikeNow(): { parts: Bike['parts']; lap: number } | null {
    if (!this.sim?.playerBike || !this.wearAt.length) return null;
    let i = 0;
    while (i + 1 < this.wearAt.length && this.wearAt[i + 1].t <= this.clock + 1e-6) i++;
    return { parts: this.wearAt[i].parts, lap: i };
  }

  /**
   * Each part's condition, what its wear costs (its share of the bike's stats, from the bike's own
   * condition rule) and a warning when it is low or broken.
   */
  private partStatus(parts: Bike['parts']): { name: string; c: number; loss: number; warn: string }[] {
    const lowAt = services.content.racing.wear.lowAt;
    return services.content.bikes.slots.map((s) => {
      const c = parts[s.id]?.condition ?? 0;
      return { name: s.name, c, loss: 1 - conditionFactor(c), warn: c <= 0 ? 'BROKEN' : c <= lowAt ? 'LOW' : '' };
    });
  }

  /** The bike's stats now against the same bike with every part new. */
  private statStatus(parts: Bike['parts']): { name: string; now: number; fresh: number }[] {
    const bike = this.sim!.playerBike!;
    const now = bikeStats(services.content.bikes, { ...bike, parts });
    const fresh = bikeStats(services.content.bikes, { ...bike, parts: Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, { ...p, condition: 1 }])) });
    return services.content.bikes.stats.map((st) => ({ name: st.name, now: now[st.id] ?? 0, fresh: fresh[st.id] ?? 0 }));
  }

  private bikeDetail(): string[] {
    const b = this.bikeNow();
    if (!b) return ['No bike data.'];
    const lowAt = Math.round(services.content.racing.wear.lowAt * 100);
    const short = (n: string) => n.replace('Intake and exhaust', 'Intake/exhaust').replace('Bodywork and controls', 'Bodywork').replace('Wheels and tyres', 'Wheels/tyres');
    const rows = this.partStatus(b.parts).map((p) => `${short(p.name).padEnd(14).slice(0, 14)}${(p.c <= 0 ? '--' : `${(p.c * 100).toFixed(1)}%`).padStart(7)}${`-${(p.loss * 100).toFixed(1)}%`.padStart(7)} ${p.warn}`);
    const stats = this.statStatus(b.parts).map((x) => `${x.name.padEnd(11).slice(0, 11)} ${String(x.now).padStart(4)}  of ${String(x.fresh).padStart(3)} new`);
    return [b.lap ? `Your bike after lap ${b.lap}` : 'Your bike at the gate', 'Part             Cond   Loss', ...rows, '', 'Stats', ...stats, '', 'Loss: what wear costs.', `LOW: ${lowAt}% or less.`];
  }

  private brokenParts(): string[] {
    const parts = this.bikeNow()?.parts;
    if (!parts) return [];
    return services.content.bikes.slots.filter((s) => parts[s.id]?.condition <= 0).map((s) => s.name);
  }

  private bikeLines(): string[] {
    const bike = this.sim?.playerBike;
    if (!bike) return [];
    const parts = services.content.bikes.slots.map((s) => ({ name: s.name, c: bike.parts[s.id]?.condition ?? 0 })).sort((a, b) => a.c - b.c).slice(0, 4);
    return ['Most worn parts', ...parts.map((p) => `${p.name}: ${p.c <= 0 ? 'Broken' : `${Math.round(p.c * 100)}%`}`)];
  }

  /** Turns a race event into a line for the feed, if it involves the rider or is a crash. */
  private say(e: RaceEvent): void {
    const sim = this.sim!;
    const section = (i: number) => (i < 0 ? 'start' : (services.content.racing.sections[sim.track.sections[i]?.type]?.name ?? 'track').toLowerCase());
    const name = (id: string) => this.names.get(id) ?? id;
    const slot = (id: string) => services.content.bikes.slots.find((s) => s.id === id)?.name.toLowerCase() ?? id;
    let line: string | null = null;
    switch (e.kind) {
      case 'pass':
        if (e.rider === PLAYER_ID) line = `You passed ${name(e.other)} at the ${section(e.section)}.`;
        else if (e.other === PLAYER_ID) line = `${name(e.rider)} passed you at the ${section(e.section)}.`;
        break;
      case 'failedPass':
        if (e.rider === PLAYER_ID) line = `You couldn't get past ${name(e.other)}.`;
        break;
      case 'mistake': {
        const crash = e.outcome === 'minor_crash' || e.outcome === 'serious_crash';
        if (e.rider === PLAYER_ID) {
          const what = e.outcome === 'small' ? 'Small mistake' : e.outcome === 'big' ? 'Big moment' : e.outcome === 'minor_crash' ? 'You went down' : 'Big crash';
          line = e.with === 'loop_out' ? `You looped it out of the gate (−${e.lost.toFixed(1)}s).` : `${what} at the ${section(e.section)} (−${e.lost.toFixed(1)}s).`;
          if (e.damaged.length) line += ` ${e.outcome === 'serious_crash' ? 'Broken' : 'Damaged'}: ${e.damaged.map(slot).join(', ')}.`;
        } else if (crash) line = e.with === 'loop_out' ? `${name(e.rider)} looped it out of the gate!` : `${name(e.rider)} crashed at the ${section(e.section)}.`;
        break;
      }
      case 'breakdown':
        if (e.rider === PLAYER_ID) line = `Your ${slot(e.slot)} has broken!`;
        break;
      case 'retire':
        line = e.rider === PLAYER_ID ? `You're out: ${e.reason.toLowerCase()}.` : `${name(e.rider)} retires.`;
        if (e.rider === PLAYER_ID && this.retiredAt === null) this.retiredAt = e.t;
        break;
    }
    if (!line) return;
    // Repeats of the same line (a run of failed passes) stack up as one.
    const last = this.feed.at(-1);
    const m = last?.match(/^(.*?)(?: \(×(\d+)\))?$/);
    if (m && m[1] === line) this.feed[this.feed.length - 1] = `${line} (×${Number(m[2] ?? 1) + 1})`;
    else this.feed.push(line);
  }

  private pitBoard(): void {
    const sim = this.sim!;
    const { racing } = services.content;
    const c = this.openModal(1180, 620);
    const pos = this.positions();
    const order = this.runningOrder(pos);
    const rank = order.findIndex((o) => o.id === PLAYER_ID) + 1;
    const total = sim.totalLaps!;
    const left = total - this.myLaps;
    c.add(this.add.text(0, -278, `Pit board · you've done lap ${this.myLaps} of ${total}`, textStyle(24, COLORS.accent)).setOrigin(0.5));
    const line = this.add.text(-PEN_W / 2 - 8, -240, `You're ${ordinal(rank)}. Message now: ${racing.messages.find((m) => m.id === sim.playerMessage)!.name}. Ink left:`, textStyle(18)).setOrigin(0.5);
    c.add(line);
    c.add(penMeter(this, line.x + line.width / 2 + 12, -240, racing.ink, PEN_W).setLevel(sim.ink));

    // How long the message holds: the board stays away until then, so the race runs on through the line.
    c.add(this.add.text(-560, -196, 'Show it for', textStyle(18, COLORS.cream)));
    const choices = BOARD_LAPS.filter((n) => n === 0 || n < left);
    if (!choices.includes(this.boardLaps)) this.boardLaps = choices[0];
    const lapButtons = choices.map((n, i) => {
      const b = button(this, -400 + i * 118, -184, n === 0 ? 'To the flag' : `${n} lap${n > 1 ? 's' : ''}`, () => {
        this.boardLaps = n;
        lapButtons.forEach((o, j) => o.setSelected(j === i));
      }, 112, 40);
      b.setSelected(n === this.boardLaps);
      c.add(b);
      return b;
    });
    const set = () => {
      this.boardAt = this.boardLaps === 0 ? Infinity : this.myLaps + this.boardLaps;
      this.closeModal();
    };
    racing.messages.forEach((m, i) => {
      const y = -112 + i * 74;
      const current = m.id === sim.playerMessage;
      const b = button(this, -440, y, current ? `Keep ${m.name}` : m.name, () => {
        if (!current) {
          if (sim.ink <= 0) return;
          // The new message counts from the lap you are starting now.
          if (!this.redoMyLap(() => sim.changeMessage(m.id))) sim.changeMessage(m.id);
        }
        set();
      }, 230, 50);
      b.setSelected(current);
      b.setEnabled(current || sim.ink > 0);
      c.add(b);
      c.add(this.add.text(-312, y, `${m.desc}${current ? '' : sim.ink > 0 ? '  (uses 1 ink)' : '  (no ink left)'}`, textStyle(16, COLORS.muted, { wordWrap: { width: 300 } })).setOrigin(0, 0.5));
    });
    c.add(this.add.text(-560, 110, 'When it runs out the board comes out again; keeping a message is free.', textStyle(15, COLORS.muted, { wordWrap: { width: 540 } })));

    // The bike, from the same wear the race runs on.
    const bike = this.bikeNow();
    c.add(this.add.text(40, -196, bike?.lap ? `Your bike after lap ${bike.lap}` : 'Your bike', textStyle(20, COLORS.accent)));
    c.add(this.add.text(392, -192, 'cond', textStyle(14, COLORS.muted)));
    c.add(this.add.text(462, -192, 'loss', textStyle(14, COLORS.muted)));
    if (bike) {
      this.partStatus(bike.parts).forEach((p, i) => {
        const y = -158 + i * 29;
        const pct = p.c * 100;
        const col = p.c <= 0 ? 0xb03030 : p.warn ? COLORS.accent : 0x6fa84a;
        c.add(this.add.text(40, y, p.name, textStyle(15)));
        c.add(this.add.rectangle(236, y + 10, 150, 10, COLORS.panelLight).setOrigin(0, 0.5));
        c.add(this.add.rectangle(236, y + 10, Math.max(1, 1.5 * pct), 10, col).setOrigin(0, 0.5));
        c.add(this.add.text(392, y, p.c <= 0 ? 'Broken' : `${pct.toFixed(1)}%`, textStyle(15, p.warn ? COLORS.accent : COLORS.cream)));
        c.add(this.add.text(462, y, `−${(p.loss * 100).toFixed(1)}%${p.warn === 'LOW' ? '  low' : ''}`, textStyle(15, p.warn ? COLORS.accent : COLORS.muted)));
      });
      const stats = this.statStatus(bike.parts).map((x) => `${x.name} ${x.now}/${x.fresh}`).join('   ');
      c.add(this.add.text(40, 140, `Stats now / new: ${stats}`, textStyle(14, COLORS.muted, { wordWrap: { width: 520 } })));
      c.add(this.add.text(40, 186, `Loss is what wear takes off that part's share of its stats. Low (${Math.round(racing.wear.lowAt * 100)}% or less) wears faster.`, textStyle(14, COLORS.muted, { wordWrap: { width: 520 } })));
    }

    c.add(button(this, -150, 262, "It's over, bike blown", () => {
      this.closeModal();
      // You pull off at the line, so the lap you were starting is run without you.
      this.redoMyLap(() => sim.retirePlayer("It's over, bike blown"));
      this.retireNow();
    }, 280, 46));
    c.add(button(this, 170, 262, 'Watch on', set, 200, 46));
  }

  private confirmRetire(): void {
    // Nothing to retire from before the gate drops.
    if (this.retiredAt !== null || this.clock < 0) return;
    const c = this.openModal(560, 220);
    const what = this.qualifying || (this.ko && !this.koHeat) ? 'You pull off and set no more times.' : this.ko ? 'You pull off: a DNF, and out of this heat.' : 'You pull off and score a DNF for this moto.';
    c.add(this.add.text(0, -50, `It's over, bike blown?\n${what}`, textStyle(20, COLORS.cream, { align: 'center' })).setOrigin(0.5));
    c.add(button(this, -120, 55, 'Retire', () => {
      this.closeModal();
      this.retireNow();
    }, 200, 46));
    c.add(button(this, 120, 55, 'Keep racing', () => this.closeModal(), 200, 46));
  }

  private retireNow(): void {
    this.sim!.retirePlayer("It's over, bike blown");
    this.retiredAt = this.clock;
    this.director?.retire(PLAYER_ID, this.clock);
    this.feed.push('You pull off the track.');
  }

  // ---- results ----

  private finishMoto(): void {
    if (this.qualifying) return this.showQualifyingResults();
    if (this.ko) return this.koFinished();
    const day = this.day!;
    const rec = day.finishMoto(this.sim!);
    if (this.args.challenge) this.showChallengeResults(this.args.challenge, rec);
    else this.showMotoResults(rec);
  }

  private resultTable(results: RiderResult[], x: number, y: number, points = true): void {
    const rows = results.map((r) => {
      const name = (r.player ? `${this.save.rider.name} (you)` : r.name).padEnd(22).slice(0, 22);
      const pts = r.retired ? 0 : (services.content.racing.points[r.position - 1] ?? 0);
      const best = r.bestLap !== null ? formatTime(r.bestLap) : '—';
      return `${String(r.position).padStart(2)}  ${name} ${(r.retired ? `DNF` : r.gap).padStart(9)}  ${best.padStart(6)}${points ? String(pts).padStart(5) : ''}`;
    });
    const head = `Pos Rider                       Gap   Best${points ? '  Pts' : ''}`;
    const t = this.text(x, y, [head, ...rows].join('\n'), 16, COLORS.cream, { lineSpacing: 5 }).setFontFamily('Consolas, "Courier New", monospace');
    const mine = results.findIndex((r) => r.player);
    if (mine >= 0) {
      const lh = t.height / (rows.length + 1);
      const bar = this.add.rectangle(x - 6, y + lh * (mine + 1), 660, lh, COLORS.accentDark, 0.45).setOrigin(0, 0);
      this.screen.add(bar);
      this.screen.bringToTop(t);
    }
  }

  private showMotoResults(rec: MotoRecord): void {
    const day = this.day!;
    this.clear();
    const n = day.motos.length;
    this.header(`Moto ${n} results`, this.dayTitle());
    this.resultTable(rec.results, 40, 110);
    const me = rec.results.find((r) => r.player)!;
    this.box(740, 110, 500, 470);
    const xp = Object.values(rec.xp).reduce((a, b) => a + b, 0);
    this.text(764, 126, 'Your moto', 24, COLORS.accent);
    this.text(764, 170, [
      me.retired ? `DNF: ${me.reason ?? 'retired'}` : `Finished ${ordinal(me.position)}${me.position === 1 ? '. You won!' : ''}`,
      `Points: ${rec.points}`,
      `Prize money: ${formatMoney(rec.prize)}`,
      `Passes: ${rec.passes}`,
      `Rider XP: ${xp.toFixed(0)}`,
    ].join('\n'), 20, COLORS.cream, { lineSpacing: 10 });
    // The best-placed champion racing (the Area 1 and Local Champions can both be there).
    const champ = rec.results.find((r) => r.tag?.endsWith('Champion') && !r.player);
    if (champ) this.text(764, 380, `The ${champ.tag}, ${champ.name}, was ${champ.retired ? 'out' : ordinal(champ.position)}.`, 16, COLORS.muted, { wordWrap: { width: 450 } });
    if (day.done) this.btn(990, 640, 'Day results', () => this.showDayResults(), 260, 50);
    else {
      this.btn(860, 640, `Moto ${n + 1}`, () => this.showGatePick(), 220, 50);
      this.btn(1110, 640, 'Leave early', () => this.confirmLeave(), 220, 50);
    }
  }

  private showDayResults(): void {
    const day = this.day!;
    this.clear();
    const res = day.dayResult();
    this.header('Race day results', `${this.dayTitle()} · overall by combined moto finishes`);
    const rows = res.overall.map((r) => {
      const name = (r.player ? `${this.save.rider.name} (you)` : r.name).padEnd(22).slice(0, 22);
      const ps = r.positions.map((p) => (p === null ? 'DNF' : String(p))).map((s) => s.padStart(4)).join('');
      return `${String(r.position).padStart(2)}  ${name}${ps}${String(r.points).padStart(6)}`;
    });
    const t = this.text(40, 110, ['Pos Rider                   M1  M2   Pts', ...rows].join('\n'), 16, COLORS.cream, { lineSpacing: 5 }).setFontFamily('Consolas, "Courier New", monospace');
    const mine = res.overall.findIndex((r) => r.player);
    const lh = t.height / (rows.length + 1);
    this.screen.add(this.add.rectangle(34, 110 + lh * (mine + 1), 520, lh, COLORS.accentDark, 0.45).setOrigin(0, 0));
    this.screen.bringToTop(t);

    // Money, XP and the bike go back on the career.
    const career = this.save.career;
    const prizes = day.motos.reduce((a, m) => a + m.prize, 0);
    const money = prizes + res.podiumBonus - this.args.fee;
    const xp = sumXp(...day.motos.map((m) => m.xp), day.qualifying?.xp ?? {});
    const payout = applyRide(services.content, career, day.player.bike, money, xp);
    const c = career.counters;
    const myRows = day.motos.map((m) => m.results.find((r) => r.player)!);
    c['race.days'] = (c['race.days'] ?? 0) + 1;
    noteActivity(services.content.shops, career, 'raceDay');
    c['race.motos'] = (c['race.motos'] ?? 0) + myRows.filter((r) => !r.retired).length;
    c['race.wins'] = (c['race.wins'] ?? 0) + myRows.filter((r) => !r.retired && r.position === 1).length;
    const me = res.overall.find((r) => r.player)!;
    if (me.position <= 3) c['race.podiums'] = (c['race.podiums'] ?? 0) + 1;
    // Records: wins out of race days at each track (core/records.ts).
    const vid = this.args.venue.id;
    c[venueDays(vid)] = (c[venueDays(vid)] ?? 0) + 1;
    if (me.position === 1) c[venueWins(vid)] = (c[venueWins(vid)] ?? 0) + 1;
    const finishedBoth = me.positions.every((p) => p !== null);
    const firstDay = !this.save.flags.first_race_done;
    this.save.flags.first_race_done = true;
    if (finishedBoth) this.save.flags.first_race_finished = true;

    this.box(580, 110, 680, 530);
    this.text(604, 124, `${ordinal(me.position)} overall`, 26, COLORS.accent);
    const champ = this.champ;
    const lines = [
      `Entry: ${this.args.fee ? `−${formatMoney(this.args.fee)}` : 'free (first race)'}`,
      `Moto prizes: ${formatMoney(prizes)}`,
      `Podium bonus: ${formatMoney(res.podiumBonus)}`,
      `Net: ${money >= 0 ? '+' : ''}${formatMoney(money)}`,
      `Money now: ${formatMoney(career.money)}`,
    ];
    if (firstDay) lines.push('', finishedBoth ? 'Goal done: you finished both motos.' : 'Goal: finish both motos. Try again next time.');
    lines.push('', 'Rider XP', ...this.xpLines(payout.xp));
    this.text(604, 170, lines.join('\n'), 17, COLORS.cream, { lineSpacing: 4, wordWrap: { width: 310 } });
    const ups = payout.levelUps.map((u) => `${u.name} → level ${u.level}`);
    const wear = this.wearLines(this.args.save.career.bike.parts, career.bike.parts);
    let y = 170;
    if (ups.length) {
      const t = this.text(930, y, ['Level up!', ...ups].join('\n'), 17, 0x9fe07a, { lineSpacing: 4 });
      y += t.height + 24;
    }
    this.text(930, y, ['Bike wear today', ...wear].join('\n'), 15, COLORS.muted, { lineSpacing: 4 });
    if (champ) {
      recordRound(champ.active, this.args.venue, day);
      this.btn(W / 2 + 300, 670, 'Championship standings', () => this.showStandings(champ.def, champ.active), 300, 50);
      return;
    }
    this.btn(W / 2 + 300, 670, 'Back to the paddock', () => this.done(`Race day done: ${ordinal(me.position)} overall, ${money >= 0 ? '+' : ''}${formatMoney(money)}.`), 300, 50);
  }

  /** The championship table after a round, and the final result after the last one (Spec 12.5). */
  private showStandings(def: ChampionshipDef, active: ActiveChampionship): void {
    const { points } = services.content.racing;
    this.clear();
    const done = active.rounds.length;
    const last = nextRoundVenue(def, active) === null;
    this.header(`${def.name} · ${last ? 'final standings' : `after round ${done} of ${def.rounds.length}`}`, `${def.class} · points for every moto, the same ${active.field.length + 1} riders every round`);
    const table = standings(points, active);
    const name = (id: string) => (id === PLAYER_ID ? `${this.save.rider.name} (you)` : services.content.riders.riders.find((r) => r.id === id)?.name ?? id);
    const rows = table.map((r) => `${String(r.position).padStart(2)}  ${name(r.id).padEnd(22).slice(0, 22)}${def.rounds.map((_, i) => String(r.byRound[i] ?? '').padStart(5)).join('')}${String(r.points).padStart(6)}`);
    const head = `Pos Rider                 ${def.rounds.map((_, i) => `  R${i + 1}`.padStart(5)).join('')}   Pts`;
    const t = this.text(40, 110, [head, ...rows].join('\n'), 15, COLORS.cream, { lineSpacing: 4 }).setFontFamily('Consolas, "Courier New", monospace');
    const mine = table.findIndex((r) => r.player);
    const lh = t.height / (rows.length + 1);
    this.screen.add(this.add.rectangle(34, 110 + lh * (mine + 1), 330 + def.rounds.length * 42, lh, COLORS.accentDark, 0.45).setOrigin(0, 0));
    this.screen.bringToTop(t);

    const me = table[mine];
    const leader = table[0];
    this.box(740, 110, 500, 500);
    const career = this.save.career;
    if (!last) {
      const venue = services.content.tracks.venues.find((v) => v.id === nextRoundVenue(def, active));
      const possible = titlePossible(def, points, active);
      this.text(764, 126, `You're ${ordinal(me.position)}`, 26, COLORS.accent);
      this.text(764, 176, [
        me.position === 1 ? `You lead by ${me.points - (table[1]?.points ?? 0)} points.` : `${leader.points - me.points} points behind ${name(leader.id)}.`,
        `Next: round ${done + 1} at ${venue?.name ?? 'the next track'}. Sign on there at the race office.`,
        '',
        possible ? 'The title is still possible.' : "The title is out of reach now. Finish it for a top-three place, or start it again from any race office.",
      ].join('\n'), 19, COLORS.cream, { lineSpacing: 6, wordWrap: { width: 450 } });
      this.btn(W / 2 + 300, 670, 'Back to the paddock', () => this.done(`${def.short} round ${done}: ${ordinal(me.position)} in the championship.`), 300, 50);
      return;
    }
    const fin = finishChampionship(career, this.save.flags, def, points);
    this.text(764, 126, fin.position === 1 ? 'Champion!' : `${ordinal(fin.position)} in the championship`, 28, COLORS.accent);
    const lines = [];
    if (fin.position === 1) lines.push(fin.firstWin && def.won ? def.won : `You won the ${def.name} again.`);
    else lines.push(`${name(leader.id)} won it with ${leader.points} points.`);
    if (fin.title) lines.push('', `You earned ${fin.title}.`);
    if (fin.money) lines.push(`Championship prize: ${formatMoney(fin.money)}`);
    if (fin.position > 3) lines.push('', 'The top three win a prize. Enter again from any race office.');
    lines.push('', `Money now: ${formatMoney(career.money)}`);
    this.text(764, 176, lines.join('\n'), 19, COLORS.cream, { lineSpacing: 6, wordWrap: { width: 450 } });
    // The badge or trophy won, as it shows in the Task tab.
    const image = fin.title ? def.rewards[fin.position - 1]?.image : undefined;
    if (image && this.textures.exists(rewardTexture(image))) this.screen.add(this.add.image(990, 500, rewardTexture(image)).setDisplaySize(160, 160));
    this.btn(W / 2 + 300, 670, 'Back to the paddock', () => this.done(fin.position === 1 ? `${def.name}: champion!` : `${def.name}: ${ordinal(fin.position)}.`), 300, 50);
  }

  private xpLines(xp: Record<string, number>): string[] {
    const names = new Map(services.content.skills.leads.flatMap((l) => l.children.map((c) => [c.id, c.name] as const)));
    return Object.entries(xp).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${names.get(k) ?? k}: +${v < 10 ? v.toFixed(1) : v.toFixed(0)}`);
  }

  private wearLines(before: Record<string, { condition: number }>, after: Record<string, { condition: number }>): string[] {
    return services.content.bikes.slots
      .map((s) => ({ s, b: before[s.id]?.condition ?? 0, a: after[s.id]?.condition ?? 0 }))
      .filter((x) => x.b - x.a >= 0.005)
      .sort((x, y) => y.b - y.a - (x.b - x.a))
      .slice(0, 7)
      .map((x) => `${x.s.name}: ${Math.round(x.b * 100)}% → ${x.a <= 0 ? 'Broken' : `${Math.round(x.a * 100)}%`}`);
  }

  // ---- challenges (Boss, 28 Oct 2026) ----

  /** The start screen: the stake, the field and the starting message. The gate is drawn. */
  private showChallengeStart(def: ChallengeDef): void {
    this.clear();
    const solo = !def.others;
    const challenger = services.content.riders.riders.find((r) => r.id === def.challenger);
    this.header(`${def.name} · ${def.laps} laps`, solo ? `One on one against ${challenger?.name ?? 'the challenger'}` : `${def.others + 2} riders · one moto`);
    this.text(W / 2, 108, `Entry ${formatMoney(this.args.fee)}. Win and you get it back plus ${formatMoney(this.args.fee)} more. Anything but first wins nothing.`, 22).setOrigin(0.5, 0);
    this.text(W / 2, 146, 'Gates are drawn for a challenge. Parts wear as in a race, and there are no repairs at the track.', 18, COLORS.muted).setOrigin(0.5, 0);
    this.box(100, 286, 1080, 356);
    const message = this.messagePicker(300);
    const { racing } = services.content;
    this.text(130, 462, `The pit board comes out each lap, with ${racing.ink} message changes. Auto-complete holds your message all race. You retire at ${racing.sim.retireAtBroken} broken parts.`, 19, COLORS.cream, { wordWrap: { width: 1020 }, lineSpacing: 2 });
    this.btn(W / 2 - 300, 600, 'Race', () => this.goChallenge(def, message(), false), 260, 52);
    this.btn(W / 2, 600, 'Auto-complete', () => this.goChallenge(def, message(), true), 260, 52);
    this.btn(W / 2 + 300, 600, 'Bike check', () => this.showBike(), 260, 52);
  }

  private goChallenge(def: ChallengeDef, message: string, auto: boolean): void {
    const rig = rigChallenge(services.content, def, playerEntrant(services.content, this.save.career, this.save.rider.name, 0, this.save.flags), message);
    this.day = rig.day;
    this.setupField();
    this.sim = this.day.startMoto(message);
    this.auto = auto;
    this.explained = true;
    this.startLive();
  }

  private showChallengeResults(def: ChallengeDef, rec: MotoRecord): void {
    this.clear();
    this.header('Challenge result', this.dayTitle());
    this.resultTable(rec.results, 40, 110, false);
    const me = rec.results.find((r) => r.player)!;
    const career = this.save.career;
    const prize = challengePrize(def, me.position, me.retired);
    const money = prize - this.args.fee;
    const payout = applyRide(services.content, career, this.day!.player.bike, money, rec.xp);
    const c = career.counters;
    c[challengeRuns(def.id)] = (c[challengeRuns(def.id)] ?? 0) + 1;
    if (prize) c[challengeWins(def.id)] = (c[challengeWins(def.id)] ?? 0) + 1;
    noteActivity(services.content.shops, career, 'activity');
    this.box(740, 110, 500, 530);
    this.text(764, 126, me.retired ? `DNF: ${me.reason ?? 'retired'}` : prize ? `You won!` : `Finished ${ordinal(me.position)}`, 26, COLORS.accent);
    const lines = [
      `Entry: −${formatMoney(this.args.fee)}`,
      `Winnings: ${formatMoney(prize)}`,
      `Net: ${money >= 0 ? '+' : ''}${formatMoney(money)}`,
      `Money now: ${formatMoney(career.money)}`,
      '',
      'Rider XP',
      ...this.xpLines(payout.xp),
      ...payout.levelUps.map((u) => `Level up! ${u.name} → level ${u.level}`),
      '',
      'Bike wear',
      ...this.wearLines(this.args.save.career.bike.parts, career.bike.parts).slice(0, 5),
    ];
    this.text(764, 172, lines.join('\n'), 17, COLORS.cream, { lineSpacing: 4, wordWrap: { width: 450 } });
    this.btn(990, 670, 'Back', () => this.done(prize ? `${def.name}: you won ${formatMoney(prize)}!` : `${def.name}: ${me.retired ? 'DNF' : ordinal(me.position)}, no winnings this time.`), 260, 50);
  }

  // ---- practice ----

  private startPractice(): void {
    const career = this.save.career;
    this.sim = practiceSim(services.content, this.args.venue, playerEntrant(services.content, career, this.save.rider.name, 0, this.save.flags), (Math.random() * 2 ** 32) >>> 0, services.settings.get().gameplay.testRideAlone);
    // You, and any riders already out on track (practiceRiders on the venue).
    this.sim.riders.forEach(({ e }, i) => {
      this.names.set(e.id, e.player ? 'You' : e.name);
      const gear = kitFor(e, i);
      this.looks.set(e.id, { brand: e.bike.brand, cls: e.bike.class, gear });
      this.colors.set(e.id, e.player ? COLORS.accent : gearColour(gear));
    });
    this.startLive();
  }

  private practiceXpNow(): Record<string, number> {
    return this.practiceNow()?.xp ?? this.sim?.xp ?? {};
  }

  /** Where your practice has got to: the lap you are on (or the last one run), with its XP and wear. */
  private practiceNow(): { end: number; xp: Record<string, number>; parts: Bike['parts'] } | undefined {
    return this.practiceAt.find((s) => s.end > this.clock + 1e-6) ?? this.practiceAt.at(-1);
  }

  /** Your lap times so far, as far as the clock has got. */
  private practiceLaps(): number[] {
    const done = this.practiceAt.filter((s) => s.end <= this.clock + 1e-6).length;
    return this.sim!.player!.lapTimes.slice(0, done);
  }

  private stopPractice(forced = false): void {
    if (!this.live && !forced) return;
    this.live = false;
    const sim = this.sim!;
    const career = this.save.career;
    const before = structuredClone(career.bike.parts);
    // Stopping counts the lap you are on, as riding alone always has; a broken bike counts every lap run.
    const now = forced ? null : this.practiceNow();
    const laps = forced ? sim.player!.lapTimes : this.practiceLaps();
    const payout = applyRide(services.content, career, now ? { ...sim.playerBike!, parts: now.parts } : sim.playerBike, -this.args.fee, now?.xp ?? sim.xp);
    const p = { lapTimes: laps };
    if (p.lapTimes.length) noteActivity(services.content.shops, career, 'activity');
    const c = this.openModal(760, 520);
    c.add(this.add.text(0, -220, forced ? 'Practice over: your bike is broken' : 'Practice done', textStyle(26, COLORS.accent)).setOrigin(0.5));
    const best = p.lapTimes.length ? formatTime(Math.min(...p.lapTimes)) : '—';
    const lines = [`Laps: ${p.lapTimes.length}   Best lap: ${best}${this.args.fee ? `   Practice fee: ${formatMoney(this.args.fee)}` : ''}`, '', 'Practice XP (about a tenth of race XP)', ...this.xpLines(payout.xp), '', ...this.wearLines(before, career.bike.parts).slice(0, 4)];
    c.add(this.add.text(-330, -180, lines.join('\n'), textStyle(17, COLORS.cream, { lineSpacing: 4 })));
    if (payout.levelUps.length) c.add(this.add.text(-330, 150, payout.levelUps.map((u) => `Level up! ${u.name} is now level ${u.level}.`).join('\n'), textStyle(17, 0x9fe07a)));
    c.add(button(this, 0, 215, 'Done', () => this.done(`Practice: ${p.lapTimes.length} laps, best ${best}.`), 220, 46));
  }

  // ---- No-Turn Takedown knockouts (Boss, 30 Oct 2026) ----

  /** The seeding run: everyone on their own, the seeding interval apart, to set the bracket. */
  private showKoSeedingStart(): void {
    const ko = this.ko!;
    this.clear();
    const gap = ko.rules.seedInterval;
    this.header(this.dayTitle(), `Seeding run · ${ko.field.length} riders · one at a time`);
    this.text(W / 2, 108, `A straight drag strip, four riders at a time. First, everyone rides one timed seeding run on their own, ${gap} seconds apart. You go second, and the bracket comes up as soon as you have your time.`, 21, COLORS.cream, { wordWrap: { width: 1100 }, align: 'center' }).setOrigin(0.5, 0);
    this.text(W / 2, 176, `Seeding times split the field into heats of ${ko.rules.heatSize}, the fastest kept apart. The first ${ko.rules.through} in each heat go through, round by round, to a final of ${ko.rules.heatSize}: the best of ${ko.rules.finalRuns} runs, each scoring its place (1 for a win), lowest total wins.`, 18, COLORS.muted, { wordWrap: { width: 1100 }, align: 'center' }).setOrigin(0.5, 0);
    this.box(100, 286, 1080, 356);
    const message = this.messagePicker(300);
    this.text(130, 462, 'There is no pit board on a run this short: your starting message holds to the finish line. Parts wear as in a race, and there are no repairs at the track.', 19, COLORS.cream, { wordWrap: { width: 1020 }, lineSpacing: 2 });
    // No Auto-complete on a No-Turn Takedown: every run is a single short one (Boss, 31 Oct 2026).
    this.btn(W / 2 - 150, 600, 'Seeding run', () => this.goKo(null, message()), 260, 52);
    this.btn(W / 2 + 150, 600, 'Bike check', () => this.showBike(), 260, 52);
  }

  /** A heat's start: who is in it, the four gates (two each side of the starter's box) and the message. */
  private showKoHeatStart(heat: KnockoutHeat): void {
    const ko = this.ko!;
    const round = ko.rounds[heat.round];
    this.clear();
    const what = round.final ? `Final · run ${heat.runs.length + 1} of ${ko.rules.finalRuns}` : `${round.name} · heat ${heat.index + 1} of ${round.heats.length}`;
    this.header(this.dayTitle(), what);
    const pts = ko.points(heat);
    const seed = (id: string) => ko.seedOrder.indexOf(id) + 1;
    const rows = ko.pickOrder(heat).map((id) => {
      const name = (id === PLAYER_ID ? `▶ ${this.save.rider.name} (you)` : `  ${this.names.get(id) ?? id}`).padEnd(26).slice(0, 26);
      return `${name} seed ${String(seed(id)).padStart(2)}${round.final ? `   ${String(pts.get(id) ?? 0).padStart(2)} pts` : ''}`;
    });
    const how = round.final ? (heat.runs.length ? 'Gate picks go in order on points, lowest first.' : 'Gate picks go in seeding order.') : `Gate picks go in seeding order. The first ${ko.rules.through} to the finish line go through.`;
    this.text(W / 2, 104, how, 20).setOrigin(0.5, 0);
    this.text(W / 2 - 250, 140, rows.join('\n'), 17, COLORS.cream, { lineSpacing: 4 }).setFontFamily('Consolas, "Courier New", monospace');

    const { taken, free } = ko.gatesForPlayer(heat);
    let chosen = free[0];
    const gw = 110;
    const y = 258;
    const xs = [W / 2 - 2.1 * gw, W / 2 - 1.05 * gw, W / 2 + 1.05 * gw, W / 2 + 2.1 * gw];
    const gateButtons: Button[] = [];
    for (let g = 0; g < NO_TURN_GATES; g++) {
      const who = taken.get(g);
      if (who) {
        this.screen.add(this.add.rectangle(xs[g], y, gw - 10, 46, COLORS.inkLine).setStrokeStyle(2, COLORS.panelLight));
        this.text(xs[g], y + 4, gateBadges(this.names).get(who) ?? '', 18, COLORS.muted).setOrigin(0.5);
      } else {
        const b = this.btn(xs[g], y, `Gate ${g + 1}`, () => {
          chosen = g;
          gateButtons.forEach((o) => o.setSelected(o === b));
        }, gw - 10, 46);
        b.setSelected(g === chosen);
        gateButtons.push(b);
      }
    }
    // The starter's box: a plain black box (Boss, 30 Oct 2026).
    this.screen.add(this.add.rectangle(W / 2, y, gw - 10, 46, 0x000000).setStrokeStyle(2, COLORS.panelLight));
    this.box(100, 296, 1080, 290);
    const message = this.messagePicker(310);
    this.text(130, 470, 'Your starting message holds to the finish line.', 19, COLORS.cream);
    this.btn(W / 2 - 150, 630, 'Race', () => this.goKo(heat, message(), chosen), 260, 52);
    this.btn(W / 2 + 150, 630, 'Bike check', () => this.showBike(), 260, 52);
  }

  private goKo(heat: KnockoutHeat | null, message: string, gate?: number): void {
    const ko = this.ko!;
    this.koHeat = heat;
    this.koSeedDone = false;
    this.sim = heat ? ko.startHeat(heat, message, gate) : ko.startSeeding(message);
    this.auto = false;
    this.startLive();
  }

  /** A rider's seeding time once they have crossed the finish line: from leaving the gate. */
  private seedTime(p: { id: string; finished: boolean; finishT: number }): number | null {
    return p.finished ? p.finishT - this.cps.get(p.id)!.t[0] : null;
  }

  /** The live screen in a knockout: seeding times in the seeding run, else the heat's running order. */
  private renderKo(pos: ReturnType<RaceScene['positions']>, me: ReturnType<RaceScene['positions']>[number], order: ReturnType<RaceScene['positions']>): void {
    const sim = this.sim!;
    const ko = this.ko!;
    const heat = this.koHeat;
    const msg = services.content.racing.messages.find((m) => m.id === sim.playerMessage)!;
    this.ui.ink.setText(msg.name);
    this.pen?.setLevel(sim.ink);
    const name = (id: string) => (this.names.get(id) ?? '').padEnd(15).slice(0, 15);
    const lines: string[] = [];
    const broken = this.brokenParts();
    let tower: string[];
    let rank: number;
    let head: string;
    if (!heat) {
      this.ui.title.setText(`${this.args.venue.name} · Seeding run`);
      const rows = pos.map((p) => ({ p, t: this.seedTime(p) })).sort((a, b) => Number(a.p.out) - Number(b.p.out) || (a.t ?? Infinity) - (b.t ?? Infinity) || a.p.gate - b.p.gate);
      rank = rows.findIndex((r) => r.p.id === PLAYER_ID);
      const best = rows[0].t;
      const away = this.cps.get(PLAYER_ID)!.t[0];
      if (me.out) lines.push('You are out of the seeding run.');
      else if (this.clock < away) lines.push(`Waiting by the platform: away in ${Math.ceil(away - this.clock)}s`);
      else if (!me.finished) lines.push(`On your run: ${formatTime(this.clock - away, 1)}`);
      else lines.push(`Seeding time: ${formatTime(rows[rank].t!, 3)}`, `${ordinal(rank + 1)} fastest so far`);
      lines.push(broken.length ? `Broken: ${broken.join(', ')}` : 'Bike: nothing broken');
      tower = rows.map((r, i) => {
        const g = r.p.out ? 'OUT' : r.t === null ? '—' : i === 0 || best === null ? formatTime(r.t, 2) : `+${(r.t - best).toFixed(2)}`;
        return `${String(i + 1).padStart(2)}  ${r.p.id === PLAYER_ID ? '▶ ' : '  '}${name(r.p.id)} ${g.padStart(7)}`;
      });
      head = 'Seeding times';
      // Once the player has their time, the rest of the field's runs are done off screen and the
      // bracket comes up, rather than watching 30 more riders go (Boss, 31 Oct 2026).
      if ((me.finished || me.out) && !this.koSeedDone) {
        this.koSeedDone = true;
        this.time.delayedCall(2000, () => {
          if (!this.live || this.sim !== sim) return;
          while (!sim.finished) this.addLap(sim.nextLap());
          this.live = false;
          this.finishMoto();
        });
      }
    } else {
      const round = ko.rounds[heat.round];
      this.ui.title.setText(`${this.args.venue.name} · ${round.final ? `Final · run ${heat.runs.length + 1} of ${ko.rules.finalRuns}` : `${round.name} · heat ${heat.index + 1}`}`);
      rank = order.findIndex((o) => o.id === PLAYER_ID);
      if (me.out) lines.push('You are out of this run.');
      else lines.push(`Position: ${ordinal(rank + 1)} of ${order.length}`, round.final ? 'Each run scores its place: lowest total wins' : `The first ${ko.rules.through} go through`);
      lines.push(broken.length ? `Broken: ${broken.join(', ')}` : 'Bike: nothing broken');
      const leader = order[0];
      tower = order.map((p, i) => {
        const g = p.out ? 'OUT' : i === 0 ? (p.finished ? formatTime(p.finishT - this.cps.get(p.id)!.t[0], 2) : 'Leader') : `+${this.behind(leader, p).toFixed(2)}`;
        return `${String(i + 1).padStart(2)}  ${p.id === PLAYER_ID ? '▶ ' : '  '}${name(p.id)} ${g.padStart(7)}`;
      });
      head = round.final ? 'Final' : round.name;
    }
    this.ui.me.setText(lines.join('\n'));
    this.ui.feed.setText(this.feed.slice(-5).join('\n'));
    this.ui.tower.setText([head, ...towerWindow(tower, rank, this.towerRows - 1)].join('\n'));
    this.ui.tower.setFontFamily('Consolas, "Courier New", monospace');
    if (heat && !this.skipButton && (me.out || me.finished)) {
      this.skipButton = this.btn(16 + (this.dw - 380) / 2, this.dh - 50, 'Skip to results', () => {
        while (!sim.finished) this.addLap(sim.nextLap());
        this.live = false;
        this.finishMoto();
      }, 300, 40);
    }
  }

  /** The seeding run or a heat's run is over: its results. */
  private koFinished(): void {
    const ko = this.ko!;
    const heat = this.koHeat;
    if (!heat) {
      // Straight to the bracket with the player's time and seed (Boss, 31 Oct 2026).
      const rec = ko.finishSeeding(this.sim!);
      const me = rec.results.find((r) => r.player)!;
      this.koSeedNote = `Your seeding run: ${me.bestLap !== null ? formatTime(me.bestLap, 3) : 'no time'}, seed ${me.position} of ${rec.results.length}`;
      this.koNext();
      return;
    }
    const results = ko.finishHeat(heat, this.sim!);
    const round = ko.rounds[heat.round];
    this.clear();
    this.header(round.final ? `Final · run ${heat.runs.length} of ${ko.rules.finalRuns}` : `${round.name} · heat ${heat.index + 1} results`, this.dayTitle());
    this.resultTable(results, 40, 110, false);
    const me = results.find((r) => r.player)!;
    this.box(740, 110, 500, 470);
    const lines: string[] = [me.retired ? `DNF: ${me.reason ?? 'retired'}` : `Finished ${ordinal(me.position)}${me.position === 1 ? '. You won the run!' : ''}`];
    if (round.final) {
      const pts = ko.points(heat);
      const table = [...heat.riders].sort((a, b) => pts.get(a)! - pts.get(b)!).map((id) => `${(id === PLAYER_ID ? 'You' : this.names.get(id) ?? id).padEnd(18).slice(0, 18)} ${String(pts.get(id)).padStart(3)}`);
      lines.push('', ko.isOver(heat) ? 'Final points' : 'Points so far (lowest wins)', ...table);
    } else if (ko.isOver(heat)) {
      lines.push(heat.through.includes(PLAYER_ID) ? 'You go through!' : 'You are out.', '', `Through: ${heat.through.map((id) => (id === PLAYER_ID ? 'you' : this.names.get(id))).join(' and ')}`);
    }
    this.text(764, 126, 'Your run', 24, COLORS.accent);
    this.text(764, 170, lines.join('\n'), 19, COLORS.cream, { lineSpacing: 6, wordWrap: { width: 450 } }).setFontFamily('Consolas, "Courier New", monospace');
    this.btn(990, 640, ko.done ? 'Day results' : 'Continue', () => this.koNext(), 260, 50);
  }

  /** Runs the CPU riders' heats up to the player's next one (or to the end once the player is out), then shows where things stand. */
  private koNext(): void {
    const ko = this.ko!;
    const before = ko.rounds.length;
    const ran = ko.runUntilPlayer();
    if (ko.done || !ko.next) return this.showKoDayResults();
    const heat = ko.next;
    if (!ran.length && ko.rounds.length === before && heat.runs.length) return this.showKoHeatStart(heat);
    this.showKoBracket(heat);
  }

  /**
   * The bracket so far, drawn two-sided like a printed tournament bracket (Boss, 30 Oct 2026): the
   * top half of the first round down the left, the bottom half down the right, each round a column
   * nearer the middle and the final in the centre. Rounds not drawn up yet are empty boxes.
   */
  private showKoBracket(next: KnockoutHeat): void {
    const ko = this.ko!;
    this.clear();
    this.header('The bracket', this.koSeedNote || this.dayTitle());
    this.koSeedNote = '';
    const first = ko.rounds[0].heats.length;
    if (first < 2 || (first & (first - 1)) !== 0) return this.showKoBracketColumns(next);
    const depth = Math.log2(first);
    const g = this.add.graphics().lineStyle(2, COLORS.muted, 0.9);
    this.screen.add(g);
    const top = 128;
    const bottom = 620;
    const boxW = 158;
    const boxH = 82;
    // Columns: depth on the left, the final, then depth on the right.
    const colW = (W - 40) / (2 * depth + 1);
    const colX = (c: number) => 20 + colW * (c + 0.5);
    const boxAt = (r: number, i: number) => {
      if (r === depth) return { x: colX(depth), y: (top + bottom) / 2, side: 0 };
      const half = first >> (r + 1);
      const side = i < half ? -1 : 1;
      const j = side < 0 ? i : i - half;
      return { x: colX(side < 0 ? r : 2 * depth - r), y: top + ((j + 0.5) * (bottom - top)) / half, side };
    };
    const who = (id: string) => (id === PLAYER_ID ? this.save.rider.name : (this.names.get(id) ?? id));
    for (let r = 0; r <= depth; r++) {
      const round = ko.rounds[r];
      const n = first >> r;
      const title = round?.name ?? roundName(n, n * ko.rules.heatSize);
      for (const c of r === depth ? [depth] : [r, 2 * depth - r]) this.text(colX(c), 104, title, 14, COLORS.accent).setOrigin(0.5, 0);
      for (let i = 0; i < n; i++) {
        const { x, y, side } = boxAt(r, i);
        // The elbow to the box this heat's riders go on to.
        if (r < depth) {
          const to = boxAt(r + 1, i >> 1);
          const from = x - (side * boxW) / 2;
          const into = to.x + (side * boxW) / 2;
          const mid = (from + into) / 2;
          g.lineBetween(from, y, mid, y).lineBetween(mid, y, mid, to.y).lineBetween(mid, to.y, into, to.y);
        }
        const heat = round?.heats[i];
        const mine = !!heat?.riders.includes(PLAYER_ID);
        const box = this.add.rectangle(x, y, boxW, boxH, COLORS.ink).setStrokeStyle(heat === next ? 3 : 2, heat === next ? COLORS.accent : COLORS.panelLight);
        this.screen.add(box);
        if (!heat) continue;
        const pts = round.final ? ko.points(heat) : null;
        const lines = heat.riders.map((id) => {
          const mark = !round.final && heat.through.includes(id) ? '✓' : ' ';
          const tail = pts && heat.runs.length ? ` ${pts.get(id)}` : '';
          return `${mark}${who(id).slice(0, 17 - tail.length).padEnd(17 - tail.length)}${tail}`;
        });
        this.text(x - boxW / 2 + 6, y - boxH / 2 + 4, [round.final ? 'Final' : `Heat ${i + 1}`, ...lines].join('\n'), 12, mine ? COLORS.accent : COLORS.cream, { lineSpacing: 1 }).setFontFamily('Consolas, "Courier New", monospace');
      }
    }
    this.koBracketFooter(next);
  }

  /** The bracket for a field that does not fill one: each round's heats in columns. */
  private showKoBracketColumns(next: KnockoutHeat): void {
    const ko = this.ko!;
    const who = (id: string) => (id === PLAYER_ID ? '▶ You' : `  ${this.names.get(id) ?? id}`);
    // A column for every four heats: the round of 32 takes two.
    const cols: { title: string; heats: KnockoutHeat[]; final: boolean }[] = [];
    for (const round of ko.rounds) {
      for (let i = 0; i < round.heats.length; i += 4) cols.push({ title: i ? '' : round.name, heats: round.heats.slice(i, i + 4), final: round.final });
    }
    const colW = Math.min(240, (W - 60) / Math.max(1, cols.length));
    cols.forEach((col, ci) => {
      const lines = [col.title, ''];
      for (const h of col.heats) {
        lines.push(col.final ? 'Final' : `Heat ${h.index + 1}`);
        for (const id of h.riders) lines.push(`${!col.final && h.through.includes(id) ? '✓' : ' '}${who(id).padEnd(17).slice(0, 17)}`);
        lines.push('');
      }
      this.text(30 + ci * colW, 104, lines.join('\n'), 13, COLORS.cream, { lineSpacing: 1 }).setFontFamily('Consolas, "Courier New", monospace');
    });
    this.koBracketFooter(next);
  }

  private koBracketFooter(next: KnockoutHeat): void {
    const ko = this.ko!;
    const round = ko.rounds[next.round];
    this.text(40, 670, `The first ${ko.rules.through} in each heat go through (✓) to the next box along. Your heats are in orange.`, 16, COLORS.muted).setOrigin(0, 0.5);
    this.btn(1090, 670, round.final ? 'To the final' : `${round.name}: heat ${next.index + 1}`, () => this.showKoHeatStart(next), 300, 50);
  }

  /** The day: everyone's place by how far they got, then prize money, XP and the bike back on the career. */
  private showKoDayResults(): void {
    const ko = this.ko!;
    this.clear();
    const res = ko.dayResult();
    this.header('Race day results', `${this.dayTitle()} · placed by how far each rider got`);
    const rows = res.places.map((p) => {
      const name = (p.player ? `${this.save.rider.name} (you)` : p.name).padEnd(22).slice(0, 22);
      return `${String(p.position).padStart(2)}  ${name} ${p.reached.padEnd(14)}${p.points !== undefined ? String(p.points).padStart(4) : ''}`;
    });
    const half = 16;
    const mine = res.places.findIndex((p) => p.player);
    const t = this.text(40, 110, ['Pos Rider                  Out in        Pts', ...rows.slice(0, half)].join('\n'), 14, COLORS.cream, { lineSpacing: 4 }).setFontFamily('Consolas, "Courier New", monospace');
    if (mine < half) {
      const lh = t.height / (half + 1);
      this.screen.add(this.add.rectangle(34, 110 + lh * (mine + 1), 520, lh, COLORS.accentDark, 0.45).setOrigin(0, 0));
      this.screen.bringToTop(t);
    }
    if (mine >= half) this.text(40, 110 + t.height + 8, `…\n${rows[mine]}`, 14, COLORS.accent).setFontFamily('Consolas, "Courier New", monospace');

    const career = this.save.career;
    const money = res.prize + res.podiumBonus - this.args.fee;
    const payout = applyRide(services.content, career, ko.player.bike, money, res.xp);
    const c = career.counters;
    c['race.days'] = (c['race.days'] ?? 0) + 1;
    noteActivity(services.content.shops, career, 'raceDay');
    c['race.motos'] = (c['race.motos'] ?? 0) + ko.playerRuns;
    c['race.wins'] = (c['race.wins'] ?? 0) + ko.playerWins;
    if (res.position <= 3) c['race.podiums'] = (c['race.podiums'] ?? 0) + 1;
    const vid = this.args.venue.id;
    c[venueDays(vid)] = (c[venueDays(vid)] ?? 0) + 1;
    if (res.position === 1) c[venueWins(vid)] = (c[venueWins(vid)] ?? 0) + 1;
    this.save.flags.first_race_done = true;

    this.box(580, 110, 680, 530);
    const me = res.places[mine];
    this.text(604, 124, `${ordinal(res.position)} overall${res.position === 1 ? ': you won the takedown!' : ''}`, 26, COLORS.accent);
    const lines = [
      `Out in: ${me.reached === 'Final' ? 'the final' : me.reached}`,
      `Entry: ${this.args.fee ? `−${formatMoney(this.args.fee)}` : 'free (first race)'}`,
      `Prize money: ${formatMoney(res.prize)}`,
      `Podium bonus: ${formatMoney(res.podiumBonus)}`,
      `Net: ${money >= 0 ? '+' : ''}${formatMoney(money)}`,
      `Money now: ${formatMoney(career.money)}`,
      '',
      'Rider XP',
      ...this.xpLines(payout.xp),
    ];
    this.text(604, 170, lines.join('\n'), 17, COLORS.cream, { lineSpacing: 4, wordWrap: { width: 310 } });
    const ups = payout.levelUps.map((u) => `${u.name} → level ${u.level}`);
    const wear = this.wearLines(this.args.save.career.bike.parts, career.bike.parts);
    let y = 170;
    if (ups.length) {
      const u = this.text(930, y, ['Level up!', ...ups].join('\n'), 17, 0x9fe07a, { lineSpacing: 4 });
      y += u.height + 24;
    }
    this.text(930, y, ['Bike wear today', ...wear].join('\n'), 15, COLORS.muted, { lineSpacing: 4 });
    this.btn(W / 2 + 300, 670, 'Back to the paddock', () => this.done(`No-Turn Takedown done: ${ordinal(res.position)} overall, ${money >= 0 ? '+' : ''}${formatMoney(money)}.`), 300, 50);
  }

  // ---- back to the world ----

  private done(message: string): void {
    this.save.stats.playSeconds += (performance.now() - this.realStart) / 1000;
    const { onDone } = this.args;
    const save = this.save;
    this.scene.stop();
    onDone(save, message);
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function initials(name: string): string {
  if (name === 'You') return 'You';
  return name.split(' ').map((p) => p[0]).join('');
}

/** Each rider's gate badge: their initials, or, where two in the field share them, the first two letters of the first name and the surname's initial (Jason and Jordan Styles: JaS, JoS). */
export function gateBadges(names: Map<string, string>): Map<string, string> {
  const plain = new Map([...names].map(([id, n]) => [id, initials(n)]));
  const count = new Map<string, number>();
  for (const b of plain.values()) count.set(b, (count.get(b) ?? 0) + 1);
  return new Map([...plain].map(([id, b]) => {
    if (count.get(b)! < 2 || b === 'You') return [id, b];
    const parts = names.get(id)!.split(' ');
    return [id, `${parts[0].slice(0, 2)}${parts.slice(1).map((p) => p[0]).join('')}`];
  }));
}
