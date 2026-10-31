import Phaser from 'phaser';
import { bikeProblem, bikeStats, formatMoney, journal, pence, statMax, type CareerState } from '../core/career';
import { childLevel, childXp, leadLevel, leadXp, levelProgress } from '../core/skills';
import { nextRoundVenue, rewardTexture, standings } from '../core/championship';
import {
  buyPart,
  dumpSpare,
  fitSpare,
  notMine,
  repairPart,
  repairQuote,
  resaleValue,
  tradeIn,
  sellSpare,
  sellsFor,
  shopStock,
  slotName,
  spareCount,
  statChange,
  type Result,
  type ShopDef,
  type StockItem,
} from '../core/shops';
import type { DialogueLine } from '../core/content';
import { repairLent } from '../core/errands';
import { PACE_BAND, REP_ZONE, goodRep, onPace, type DrillDef } from '../core/training';
import { ensureAnims } from '../world/Character';
import { careerRecords, recordText } from '../core/records';
import { services } from '../services';
import { COLORS, hex, textStyle } from '../ui/theme';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../core/settings';
import { button, panel, slider, statBar } from '../ui/widgets';
import type { WorldScene } from './WorldScene';
import { HUD_BAR, cssSize, view } from '../ui/view';
import { worldMapTexture, type WorldMapData, type WorldMapZone } from '../core/worldMap';

// Screen-space layer over the world: map name, money and task, messages, the dialogue box, the
// bike / bag / task panel, confirm boxes, the work progress bar, the pause menu and
// touch buttons. Runs alongside the world scene at a fixed zoom.

type PanelTab = 'bike' | 'bag' | 'task' | 'skills' | 'records';
export type ShopTab = 'buy' | 'sell' | 'repair' | 'fit';

/** The smallest page panels are laid out on (see page()). */
const PAGE_W = 940;
const PAGE_H = 600;

export class HudScene extends Phaser.Scene {
  private dialogue: Phaser.GameObjects.Container | null = null;
  /** The open dialogue and the line it's on, so a resize can build it again to fit (Boss, 29 Oct 2026). */
  private dialogueAt: { args: [string, string, DialogueLine[], () => void]; line: number } | null = null;
  private pause: Phaser.GameObjects.Container | null = null;
  private toastText!: Phaser.GameObjects.Text;
  private toastBg!: Phaser.GameObjects.Rectangle;
  private titleText!: Phaser.GameObjects.Text;
  private saveText!: Phaser.GameObjects.Text;
  private moneyText!: Phaser.GameObjects.Text;
  private taskText!: Phaser.GameObjects.Text;
  private shiftText!: Phaser.GameObjects.Text;
  private progressBox: Phaser.GameObjects.Container | null = null;
  /** The bike panel, a confirm box or a choice: anything that takes over input until closed. */
  private modal: Phaser.GameObjects.Container | null = null;
  private onModalClose: (() => void) | null = null;
  private career: CareerState | null = null;
  private flags: Record<string, boolean> = {};
  private uiButtons: Phaser.GameObjects.Container[] = [];
  /** The zoom slider that pops out beside the Zoom button. */
  private zoomPop: Phaser.GameObjects.Container | null = null;
  private zoomDragging = false;
  private advance: (() => void) | null = null;

  constructor() {
    super('hud');
  }

  private get world(): WorldScene {
    return this.scene.get('world') as WorldScene;
  }

  /** A text size after the player's Text size setting, eased down a little on narrow phone screens. */
  private ts(size: number): number {
    const narrow = Math.min(1, Math.max(0.72, Math.min(cssSize(this).width, cssSize(this).height * 1.6) / 900));
    return Math.round((size * services.settings.get().accessibility.textScale * narrow) / 100);
  }

  /** A text size after the player's Text size setting, for panels laid out on page(). */
  private pts(size: number): number {
    return Math.round((size * services.settings.get().accessibility.textScale) / 100);
  }

  /**
   * Narrows a one-line text to `maxW` if it is wider (never widens it). Panel columns sit at set
   * places, so a long label at a big Text size, or in a wider font (Windows draws these labels in
   * Trebuchet MS), would otherwise run into the next column.
   */
  private fitWidth(o: Phaser.GameObjects.Text, maxW: number): Phaser.GameObjects.Text {
    o.setScale(1);
    if (o.width > maxW) o.setScale(maxW / o.width);
    return o;
  }

  /**
   * Panels and boxes are laid out on a page at least PAGE_W × PAGE_H and scaled down by k to fit
   * smaller screens, such as a phone on its side, so nothing spills off the screen.
   */
  private page(): { width: number; height: number; k: number } {
    const { width, height } = view(this);
    const k = Math.min(1, width / PAGE_W, height / PAGE_H);
    return { width: width / k, height: height / k, k };
  }

  create(): void {
    this.dialogue = null;
    this.dialogueAt = null;
    this.pause = null;
    this.modal = null;
    this.progressBox = null;
    const outline = { stroke: '#14141e', strokeThickness: 4 };
    this.titleText = this.add.text(16, 14, '', textStyle(this.ts(20), COLORS.cream, outline));
    this.moneyText = this.add.text(16, 44, '', textStyle(this.ts(20), COLORS.accent, { ...outline, fontStyle: 'bold' }));
    this.taskText = this.add.text(16, 74, '', textStyle(this.ts(16), COLORS.cream, { ...outline, wordWrap: { width: 420 } }));
    this.shiftText = this.add.text(0, 0, '', textStyle(this.ts(18), COLORS.cream, { ...outline, align: 'center' })).setOrigin(0.5, 0);
    // Toasts sit above panels, so a shop's "Bought" message shows over the shop.
    this.toastBg = this.add.rectangle(0, 0, 10, 10, COLORS.ink, 0.88).setStrokeStyle(2, COLORS.panelLight).setVisible(false).setDepth(10);
    this.toastText = this.add.text(0, 0, '', textStyle(this.ts(18), COLORS.cream, { align: 'center' })).setOrigin(0.5).setVisible(false).setDepth(11);
    this.saveText = this.add.text(0, 0, '', textStyle(this.ts(16), COLORS.muted, { stroke: '#14141e', strokeThickness: 3 })).setOrigin(1, 0).setAlpha(0);
    this.zoomPop = null;
    this.wayArrow = null;
    this.layout();
    this.scale.on('resize', this.layout, this);
    // Keep the slider in step when the mouse wheel or + and - change the zoom, and swap the
    // on-screen zoom control when the setting changes.
    let control = services.settings.get().display.zoomControl;
    const unsub = services.settings.onChange((s) => {
      if (s.display.zoomControl !== control) {
        control = s.display.zoomControl;
        this.closeZoom();
        this.layout();
      }
      if (this.zoomPop && !this.zoomDragging) this.openZoom();
    });
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.layout, this);
      unsub();
    });

    const kb = this.input.keyboard!;
    // One owner for these keys, so a press that closes a dialogue or menu can't also reopen it.
    const use = () => {
      if (this.pause || this.modal) return;
      if (this.dialogue) this.advance?.();
      else this.world.interactFacing();
    };
    kb.on('keydown-E', use);
    kb.on('keydown-SPACE', use);
    kb.on('keydown-ENTER', () => this.dialogue && this.advance?.());
    kb.on('keydown-ESC', () => {
      if (this.pause) this.closePause();
      else if (this.modal) this.closeModal();
      else if (!this.dialogue) this.world.openPause();
    });
    const togglePanel = (e?: KeyboardEvent) => {
      e?.preventDefault();
      if (this.modal && this.panelOpen) this.closeModal();
      else if (!this.modal && !this.pause && !this.dialogue) this.openPanel('bike');
    };
    kb.addCapture('TAB');
    kb.on('keydown-TAB', togglePanel);
    kb.on('keydown-I', togglePanel);
    kb.on('keydown-B', togglePanel);
    kb.on('keydown-M', () => !this.modal && !this.pause && !this.dialogue && this.world.openWorldMap());
    kb.on('keydown-K', () => !this.modal && !this.pause && !this.dialogue && this.openPanel('skills'));
  }

  private panelOpen = false;
  /** Runs when the bike and bag panel closes, such as shutting the van's back doors. */
  private panelDone: (() => void) | null = null;
  /** True while the rider is driving the van: shows the Get out button. */
  private driving = false;
  private bagPage = 0;
  /** Saves and refreshes the money line after a shop, repair or bag change. Set by the world. */
  onShopChange: (() => void) | null = null;

  private layout(): void {
    const { width, height } = view(this);
    for (const b of this.uiButtons) b.destroy();
    // Small buttons along the bottom (Boss, 28 Oct 2026: the column down the right side was in
    // the way of east exits on phones), the right-hand ones laid out from the right edge in.
    const y = height - HUD_BAR / 2;
    const bh = HUD_BAR - 14;
    const fs = 16;
    let right = width - 8;
    const add = (label: string, w: number, onClick: () => void) => {
      const b = button(this, right - w / 2, y, label, onClick, w, bh, fs);
      right -= w + 6;
      return b;
    };
    const free = (f: () => void) => () => !this.modal && !this.dialogue && f();
    // The menu in the bottom-left corner, the rest at the right, leaving the middle clear for the
    // venues' south exits (Boss, 28 Oct 2026).
    this.uiButtons = [button(this, 8 + 21, y, '☰', () => this.world.openPause(), 42, bh, fs)];
    // The zoom control is a Zoom button with a pop-out slider, or + and − buttons (Settings > Display).
    if (services.settings.get().display.zoomControl === 'buttons') {
      this.uiButtons.push(add('+', 38, () => this.world.zoomBy(ZOOM_STEP)), add('−', 38, () => this.world.zoomBy(-ZOOM_STEP)));
    } else this.uiButtons.push(add('Zoom', 62, () => (this.zoomPop ? this.closeZoom() : this.openZoom())));
    this.uiButtons.push(add('Bike', 56, free(() => this.openPanel('bike'))));
    if (services.content.world.worldMap) this.uiButtons.push(add('Map', 52, free(() => this.world.openWorldMap())));
    if (this.driving) this.uiButtons.push(add('Get out', 78, free(() => this.world.getOut())));
    if (this.zoomPop) this.openZoom();
    this.saveText.setPosition(width - 70, 18);
    this.shiftText.setPosition(width / 2, 14);
    this.taskText.setWordWrapWidth(Math.min(520, width - 140));
    this.toastText.setPosition(width / 2, height - HUD_BAR - 30);
    this.toastText.setWordWrapWidth(Math.min(700, width - 60));
    this.fitToast();
    // The dialogue box is placed and wrapped for the window it opened in: build it again for this one.
    if (this.dialogue && this.dialogueAt) this.openDialogue(...this.dialogueAt.args, this.dialogueAt.line);
  }

  /** A draggable zoom slider beside the Zoom button. Mouse wheel and + and - still zoom too. */
  private openZoom(): void {
    this.zoomPop?.destroy();
    const { width, height } = view(this);
    const w = 300;
    // Just above the button row, at the right.
    const c = this.add.container(width - 8 - w / 2, height - HUD_BAR - 34);
    c.add(panel(this, 0, 0, w, 56).setInteractive());
    c.add(this.add.text(-w / 2 + 14, 0, 'Zoom', textStyle(this.ts(16))).setOrigin(0, 0.5));
    this.zoomPop = c;
    // The slider sits outside the panel's container so its drag maths works in screen space.
    const sl = slider(this, c.x - w / 2 + 76, c.y, 150, ZOOM_MIN, ZOOM_MAX, services.settings.get().display.zoom, (v) => {
      this.zoomDragging = true;
      services.settings.update('display', 'zoom', v);
      this.zoomDragging = false;
    }, ZOOM_STEP, (v) => `${v}%`);
    c.once('destroy', () => sl.destroy());
  }

  /** Closes the zoom slider. Returns true if it was open, so a click on the world only closes it. */
  closeZoom(): boolean {
    const open = !!this.zoomPop;
    this.zoomPop?.destroy();
    this.zoomPop = null;
    return open;
  }

  setDriving(on: boolean): void {
    if (this.driving === on) return;
    this.driving = on;
    if (this.scene.isActive()) this.layout();
  }

  /** True when a pointer is over a HUD button or panel, so the world ignores the click. */
  pointerOnUi(p: Phaser.Input.Pointer): boolean {
    return !!this.pause || !!this.modal || this.input.hitTestPointer(p).length > 0;
  }

  /** Money and the current task, shown under the map name. */
  showCareer(career: CareerState, flags: Record<string, boolean>): void {
    this.career = career;
    this.flags = flags;
    this.moneyText.setText(formatMoney(career.money));
    this.taskText.setText(`Task: ${journal(services.content.story, career, flags)}`);
  }

  private wayArrow: Phaser.GameObjects.Container | null = null;

  /**
   * 4A (Boss, 28 Oct 2026): an arrow at the screen edge pointing to the tutorial marker while it is
   * off screen, with where it leads. x and y are on screen in CSS pixels, angle in degrees (0 points right).
   */
  showWayArrow(a: { x: number; y: number; angle: number; label: string; sub?: string } | null): void {
    if (!a) {
      this.wayArrow?.setVisible(false);
      return;
    }
    if (!this.wayArrow) {
      const g = this.add.graphics();
      const pts = (k: number) => [[-14 - k, -8 - k], [4, -8 - k], [4, -20 - k * 1.6], [28 + k * 1.8, 0], [4, 20 + k * 1.6], [4, 8 + k], [-14 - k, 8 + k]].map(([x, y]) => new Phaser.Math.Vector2(x, y));
      g.fillStyle(COLORS.ink, 1).fillPoints(pts(3), true);
      g.fillStyle(COLORS.accent, 1).fillPoints(pts(0), true);
      const outline = { stroke: '#14141e', strokeThickness: 4 };
      const label = this.add.text(0, 0, '', textStyle(this.ts(17), 0xffffff, { ...outline, fontStyle: 'bold' })).setName('label');
      const sub = this.add.text(0, 0, '', textStyle(this.ts(14), COLORS.cream, outline)).setName('sub');
      this.wayArrow = this.add.container(0, 0, [g, label, sub]).setDepth(5);
      if (!services.settings.get().accessibility.reducedEffects) this.tweens.add({ targets: g, x: 6, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const [g, label, sub] = this.wayArrow.list as [Phaser.GameObjects.Graphics, Phaser.GameObjects.Text, Phaser.GameObjects.Text];
    g.setRotation(Phaser.Math.DegToRad(a.angle));
    label.setText(a.label);
    sub.setText(a.sub ?? '');
    // The words sit on the side of the arrow away from the edge it points at.
    const rad = Phaser.Math.DegToRad(a.angle);
    const dx = -Math.cos(rad);
    const dy = -Math.sin(rad);
    const ox = dx * 40;
    const oy = dy * 40;
    const ax = Math.abs(dx) > 0.5 ? (dx > 0 ? 0 : 1) : 0.5;
    const ay = Math.abs(dy) > 0.5 ? (dy > 0 ? 0 : 1) : 0.5;
    const h = label.height + (a.sub ? sub.height : 0);
    label.setOrigin(ax, 0).setPosition(ox, oy - h * ay);
    sub.setOrigin(ax, 0).setPosition(ox, oy - h * ay + label.height);
    this.wayArrow.setPosition(a.x, a.y).setVisible(true);
  }

  showShift(text: string | null): void {
    this.shiftText.setText(text ?? '');
  }

  showMapTitle(title: string): void {
    this.titleText.setText(title);
  }

  toast(message: string): void {
    this.toastText.setText(message).setVisible(true).setAlpha(1);
    this.fitToast();
    this.toastBg.setVisible(true).setAlpha(1);
    this.tweens.killTweensOf([this.toastText, this.toastBg]);
    this.tweens.add({ targets: [this.toastText, this.toastBg], alpha: 0, delay: 2600, duration: 400 });
  }

  private fitToast(): void {
    const b = this.toastText.getBounds();
    this.toastBg.setPosition(this.toastText.x, this.toastText.y).setSize(b.width + 32, b.height + 18).setOrigin(0.5);
    this.toastBg.setDisplaySize(b.width + 32, b.height + 18);
  }

  saveIndicator(text: string): void {
    this.saveText.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.saveText);
    this.tweens.add({ targets: this.saveText, alpha: 0, delay: 1500, duration: 500 });
  }

  /** True while a dialogue or a panel that takes over input is open, so the world waits. */
  isDialogueOpen(): boolean {
    return !!this.dialogue || !!this.modal;
  }

  /** Shows lines one at a time; click, tap, E, Space or Enter moves on. */
  openDialogue(npcName: string, riderName: string, lines: DialogueLine[], onClose: () => void, from = 0): void {
    this.dialogue?.destroy();
    const at = { args: [npcName, riderName, lines, onClose] as [string, string, DialogueLine[], () => void], line: from };
    this.dialogueAt = at;
    const { width, height, k } = this.page();
    const w = Math.min(960, width - 24);
    const pad = 20;
    const nameStyle = textStyle(this.pts(18), COLORS.accent, { fontStyle: 'bold' });
    const bodyStyle = textStyle(this.pts(20), COLORS.cream, { wordWrap: { width: w - 2 * pad - 8 }, lineSpacing: 4 });
    const name = this.add.text(0, 0, 'M', nameStyle);
    const body = this.add.text(0, 0, '', bodyStyle);
    // Size the box to the longest line at the chosen text size, so big text never spills out.
    const nameH = name.height;
    const tallest = Math.max(...lines.map((l) => body.setText(l.text).height));
    const hintH = this.pts(16) + 16;
    const h = Math.max(140, pad + nameH + 8 + tallest + hintH + pad / 2);
    const c = this.add.container((width / 2) * k, (height - h / 2 - 12) * k).setScale(k);
    const bg = panel(this, 0, 0, w, h).setInteractive({ useHandCursor: true });
    name.setPosition(-w / 2 + pad, -h / 2 + pad - 4);
    // Next and Close as a black-on-orange button in the corner, so it's plain where to click (Boss, 28 Oct 2026).
    const hint = this.add.text(w / 2 - 22, h / 2 - 14, '', textStyle(this.pts(16), COLORS.ink, { fontStyle: 'bold' })).setOrigin(1, 1);
    const hintBg = this.add.rectangle(0, 0, 10, 10, COLORS.accent).setOrigin(1, 1).setInteractive({ useHandCursor: true });
    c.add([bg, name, body, hintBg, hint]);
    this.dialogue = c;
    let i = from;
    const show = () => {
      at.line = i;
      const line = lines[i];
      const narrator = line.speaker === 'narrator';
      name.setText(line.speaker === 'npc' ? npcName : line.speaker === 'player' ? riderName : '');
      body.setText(line.text).setFontStyle(narrator ? 'italic' : '').setColor(hex(narrator ? 0xcfc6b0 : COLORS.cream));
      body.setPosition(-w / 2 + pad, narrator ? -h / 2 + pad : -h / 2 + pad + nameH + 4);
      hint.setText(i < lines.length - 1 ? 'Next ▸' : 'Close ▸');
      hintBg.setPosition(hint.x + 10, hint.y + 6).setSize(hint.width + 20, hint.height + 12);
      hintBg.input?.hitArea.setTo(0, 0, hintBg.width, hintBg.height);
    };
    const close = () => {
      c.destroy();
      this.dialogue = null;
      this.dialogueAt = null;
      this.advance = null;
      onClose();
    };
    // Skip the key press or click that opened the box.
    let ready = from > 0;
    if (!ready) this.time.delayedCall(150, () => (ready = true));
    this.advance = () => {
      if (!ready) return;
      i += 1;
      if (i >= lines.length) close();
      else show();
    };
    bg.on('pointerup', () => this.advance?.());
    hintBg.on('pointerup', () => this.advance?.());
    show();
  }

  // ---- panels that take over input ----

  private openModal(c: Phaser.GameObjects.Container, onClose: (() => void) | null = null): void {
    this.closeModal();
    this.modal = c;
    this.onModalClose = onClose;
  }

  closeModal(): void {
    const done = this.onModalClose;
    this.modal?.destroy();
    this.modal = null;
    this.onModalClose = null;
    this.panelOpen = false;
    done?.();
  }

  private backdrop(c: Phaser.GameObjects.Container, w: number, h: number, closeOnClick: boolean): void {
    const { width, height } = this.page();
    const shade = this.add.rectangle(0, 0, width, height, 0, 0.5).setInteractive();
    if (closeOnClick) shade.on('pointerup', () => this.closeModal());
    c.add(shade);
    c.add(panel(this, 0, 0, w, h).setInteractive());
  }

  /**
   * The world map (Boss, 28 Oct 2026): Boss's layout of the areas, with the rider's biggest bike in
   * the middle of the zone they're in. Fills the screen; a click, Esc or Close shuts it.
   */
  showWorldMap(wm: WorldMapData, zone: WorldMapZone | null, here: string, bike: string | null, onClose: () => void): void {
    const { width, height } = view(this);
    const c = this.add.container(0, 0);
    c.add(this.add.rectangle(width / 2, height / 2, width, height, COLORS.ink, 0.94).setInteractive().on('pointerup', () => this.closeModal()));
    const [iw, ih] = wm.size;
    const top = 58;
    const k = Math.min((width - 24) / iw, (height - top - 16) / ih);
    const x0 = (width - iw * k) / 2;
    const y0 = top + (height - top - 16 - ih * k) / 2;
    const key = worldMapTexture(zone?.image ?? wm.image);
    if (this.textures.exists(key)) c.add(this.add.image(x0, y0, key).setOrigin(0).setScale(k));
    if (zone && bike && this.textures.exists(worldMapTexture(bike))) {
      // The map image is drawn at 2 px a pixel; the bike's image is already doubled, so it scales with the map.
      c.add(this.add.image(x0 + zone.at[0] * k, y0 + zone.at[1] * k, worldMapTexture(bike)).setScale(k));
    }
    const outline = { stroke: '#14141e', strokeThickness: 4 };
    const where = zone ? (here && here !== zone.name ? `${here}, ${zone.name}` : zone.name) : here;
    const title = this.add.text(16, 30, 'World map', textStyle(this.ts(24), COLORS.accent, { ...outline, fontStyle: 'bold' })).setOrigin(0, 0.5);
    c.add(title);
    c.add(this.fitWidth(this.add.text(title.x + title.width + 18, 30, `You're here: ${where}`, textStyle(this.ts(18), COLORS.cream, outline)).setOrigin(0, 0.5), width - title.width - 170));
    c.add(button(this, width - 64, 30, 'Close', () => this.closeModal(), 100, 40));
    this.openModal(c, onClose);
  }

  /** A yes / no box. Esc or No cancels. */
  confirm(text: string, yes: string, onYes: () => void, onNo: () => void): void {
    const { width, height, k } = this.page();
    const w = Math.min(560, width - 32);
    const c = this.add.container((width / 2) * k, (height / 2) * k).setScale(k);
    this.backdrop(c, w, 220, false);
    c.add(this.add.text(0, -50, text, textStyle(this.pts(20), COLORS.cream, { align: 'center', wordWrap: { width: w - 60 } })).setOrigin(0.5));
    let answered = false;
    c.add(button(this, -120, 55, yes, () => {
      answered = true;
      this.closeModal();
      onYes();
    }, 200, 46));
    c.add(button(this, 120, 55, 'Not now', () => this.closeModal(), 200, 46));
    this.openModal(c, () => !answered && onNo());
  }

  /** A box with a few choices, such as the race office's menu. Esc or the last button closes it. */
  /** A menu of buttons with notes beside them; `centre` puts the buttons in the middle, for a menu without notes. */
  choose(title: string, text: string, options: { label: string; note?: string; enabled?: boolean; onPick: () => void }[], onClose: () => void, centre = false): void {
    const { width, height, k } = this.page();
    const w = Math.min(720, width - 32);
    const textObj = this.add.text(0, 0, text, textStyle(this.pts(18), COLORS.cream, { wordWrap: { width: w - 60 }, lineSpacing: 4 }));
    // A menu with no text starts its buttons just under the title.
    const textH = text ? textObj.height : -20;
    // Rows close up (down to 54 apart) when a long list would run off the page.
    const gap = options.length > 1 ? Math.max(54, Math.min(64, Math.floor((height - 24 - 166 - textH) / (options.length - 1)))) : 64;
    const h = 166 + textH + (options.length - 1) * gap;
    const c = this.add.container((width / 2) * k, (height / 2) * k).setScale(k);
    this.backdrop(c, w, h, false);
    c.add(this.add.text(0, -h / 2 + 32, title, textStyle(26, COLORS.accent)).setOrigin(0.5));
    textObj.setPosition(-w / 2 + 30, -h / 2 + 62);
    c.add(textObj);
    let picked = false;
    options.forEach((o, i) => {
      const y = -h / 2 + 116 + textH + i * gap;
      const b = button(this, centre ? 0 : -w / 2 + 150, y, o.label, () => {
        picked = true;
        this.closeModal();
        o.onPick();
      }, 250, 48);
      b.setEnabled(o.enabled !== false);
      c.add(b);
      if (o.note) c.add(this.add.text(-w / 2 + 290, y, o.note, textStyle(this.pts(15), COLORS.muted, { wordWrap: { width: w - 310 } })).setOrigin(0, 0.5));
    });
    this.openModal(c, () => !picked && onClose());
  }

  /** A bar that fills over `ms`, for work at a station. Resolves when it is full. */
  progress(label: string, ms: number): Promise<void> {
    this.progressBox?.destroy();
    const { width, height, k } = this.page();
    const w = 320;
    const c = this.add.container((width / 2) * k, (height - 140) * k).setScale(k);
    c.add(panel(this, 0, 0, w + 40, 70));
    c.add(this.add.text(0, -14, label, textStyle(this.pts(17))).setOrigin(0.5));
    c.add(this.add.rectangle(-w / 2, 14, w, 12, COLORS.panelLight).setOrigin(0, 0.5));
    const fill = this.add.rectangle(-w / 2, 14, 1, 12, COLORS.accent).setOrigin(0, 0.5);
    c.add(fill);
    this.progressBox = c;
    return new Promise((resolve) => {
      this.tweens.add({
        targets: fill,
        width: w,
        duration: ms,
        onComplete: () => {
          c.destroy();
          if (this.progressBox === c) this.progressBox = null;
          resolve();
        },
      });
    });
  }

  /**
   * A Fitness drill's round (core/training.ts): how to play and Start, the round itself, then what
   * it gave with Again and Done. A round can't be failed: `onFinish` runs for every finished round
   * and returns the lines to show (the XP and any level-ups). Esc or Done leaves.
   */
  openDrill(drill: DrillDef, who: { player: string; coach?: string }, onFinish: () => string[], onClose: () => void): void {
    const { width, height, k } = this.page();
    const w = Math.min(860, width - 32);
    const h = 360;
    const c = this.add.container((width / 2) * k, (height / 2) * k).setScale(k);
    this.backdrop(c, w, h, false);
    c.add(this.add.text(0, -h / 2 + 32, drill.name, textStyle(26, COLORS.accent)).setOrigin(0.5));
    const body = this.add.container(0, 0);
    c.add(body);
    const kb = this.input.keyboard!;
    let stop: (() => void) | null = null;
    const clear = () => {
      stop?.();
      stop = null;
      body.removeAll(true);
    };
    const intro = () => {
      clear();
      body.add(this.add.text(0, -60, drill.how, textStyle(this.pts(18), COLORS.cream, { align: 'center', wordWrap: { width: w - 70 }, lineSpacing: 4 })).setOrigin(0.5));
      body.add(this.add.text(0, 10, `About ${Math.round(drill.ms / 1000)} seconds. Every round you finish counts.`, textStyle(this.pts(15), COLORS.muted)).setOrigin(0.5));
      body.add(button(this, -120, 100, 'Start', () => round(), 200, 46));
      body.add(button(this, 120, 100, 'Not now', () => this.closeModal(), 200, 46));
    };
    const done = (score: string) => {
      clear();
      const lines = onFinish();
      body.add(this.add.text(0, -70, score, textStyle(this.pts(20), COLORS.cream, { align: 'center' })).setOrigin(0.5));
      body.add(this.add.text(0, -10, lines.join('\n'), textStyle(this.pts(17), 0x9fe07a, { align: 'center', lineSpacing: 4 })).setOrigin(0.5));
      body.add(button(this, -120, 100, 'Again', () => round(), 200, 46));
      body.add(button(this, 120, 100, 'Done', () => this.closeModal(), 200, 46));
    };
    // A floating word over the picture ("+1", "Miss") that drifts up and fades.
    const pop = (holder: Phaser.GameObjects.Container, x: number, y: number, text: string, color: number) => {
      const o = this.add.text(x, y, text, textStyle(this.pts(20), color)).setOrigin(0.5);
      holder.add(o);
      this.tweens.add({ targets: o, y: y - 36, alpha: 0, duration: 700, onComplete: () => o.destroy() });
    };
    const round = () => {
      clear();
      // The picture on the left half (Boss, 29 Oct 2026), the timing bar on the right.
      const half = w / 2;
      const vx = -half / 2 + 10;
      const rx = half / 2 - 10;
      const vis = this.add.container(vx, 30).setScale(Math.min(1, (half - 20) / 380));
      vis.add(this.add.rectangle(0, -10, 370, 220, 0x161b26, 0.85).setStrokeStyle(2, COLORS.panelLight));
      const bw = w - 60;
      const timeBg = this.add.rectangle(-bw / 2, -h / 2 + 66, bw, 8, COLORS.panelLight).setOrigin(0, 0.5);
      const timeFill = this.add.rectangle(-bw / 2, -h / 2 + 66, bw, 8, COLORS.blue).setOrigin(0, 0.5);
      const label = this.add.text(rx, 80, '', textStyle(this.pts(20), COLORS.cream, { align: 'center' })).setOrigin(0.5);
      const tip = this.add.text(rx, 120, drill.game === 'reps' ? 'Space or tap' : 'Hold Space or press and hold', textStyle(this.pts(14), COLORS.muted)).setOrigin(0.5);
      // The whole box is the button, so a tap anywhere on it counts.
      const pad = this.add.rectangle(0, 20, w, h - 40, 0, 0.001).setInteractive();
      body.add([pad, vis, timeBg, timeFill, label, tip]);
      let t = 0;
      let down = false;
      let tick: (dt: number) => void = () => {};
      let finish: () => string = () => '';
      if (drill.game === 'reps') {
        // A marker swings across the bar; a press while it's in the green zone is a good rep. The
        // rider on the mat does a clean push-up for a good rep and a wobbly half one for a miss.
        const sb = 200;
        const bar = this.add.rectangle(rx - sb / 2, -10, sb, 26, COLORS.panelLight).setOrigin(0, 0.5);
        const zone = this.add.rectangle(rx - sb / 2 + sb * REP_ZONE[0], -10, sb * (REP_ZONE[1] - REP_ZONE[0]), 26, 0x4f9a3a).setOrigin(0, 0.5);
        const marker = this.add.rectangle(rx - sb / 2, -10, 8, 40, COLORS.accent);
        const streakText = this.add.text(rx, -60, '', textStyle(this.pts(16), 0x9fe07a)).setOrigin(0.5);
        body.add([bar, zone, marker, streakText]);
        // The exercise mat in the bedroom, and the rider on it in their push-up frames.
        vis.add(this.add.rectangle(0, 70, 320, 14, 0x3b6ea8).setStrokeStyle(2, 0x2a4f7a));
        const fitKey = `chr:${who.player}:fit`;
        const RIDER_X = 10;
        const rider = this.textures.exists(fitKey) ? this.add.sprite(RIDER_X, 66, fitKey, 0).setOrigin(0.5, 1).setScale(3) : null;
        if (rider) vis.add(rider);
        const pose = { d: 0 };
        const show = () => rider?.active && rider.setFrame(pose.d > 0.5 ? 1 : 0);
        show();
        let good = 0;
        let tries = 0;
        let streak = 0;
        let wait = 0;
        let pos = 0;
        const rep = () => {
          if (wait > 0) return;
          wait = 480;
          tries += 1;
          const ok = goodRep(pos);
          if (ok) good += 1;
          streak = ok ? streak + 1 : 0;
          zone.setFillStyle(ok ? 0x7fd65a : 0xc0392b);
          this.time.delayedCall(160, () => zone.active && zone.setFillStyle(0x4f9a3a));
          this.tweens.killTweensOf(pose);
          if (rider) {
            rider.x = RIDER_X;
            this.tweens.killTweensOf(rider);
          }
          if (ok) {
            // A full rep: down to the floor and back up.
            this.tweens.add({ targets: pose, d: 1, duration: 150, hold: 140, yoyo: true, ease: 'Sine.easeInOut', onUpdate: show, onComplete: show });
            pop(vis, -40, -70, streak >= 3 ? `+1  x${streak}` : '+1', 0x9fe07a);
          } else {
            // A miss: the arms give, a shake, and back up.
            this.tweens.add({ targets: pose, d: 0.45, duration: 160, yoyo: true, hold: 120, onUpdate: show, onComplete: show });
            if (rider) this.tweens.add({ targets: rider, x: RIDER_X + 3, duration: 40, yoyo: true, repeat: 3 });
            pop(vis, -40, -70, 'Miss', 0xe0705a);
          }
        };
        pad.on('pointerdown', rep);
        const key = () => rep();
        kb.on('keydown-SPACE', key);
        stop = () => kb.off('keydown-SPACE', key);
        tick = (dt) => {
          wait = Math.max(0, wait - dt);
          pos = 0.5 - 0.5 * Math.cos((t / 1500) * Math.PI);
          marker.setX(rx - sb / 2 + sb * pos);
          label.setText(`Good reps: ${good}`);
          streakText.setText(streak >= 2 ? `Streak x${streak}` : '');
        };
        finish = () => `${good} good reps out of ${tries}.`;
      } else {
        // Holding speeds up, letting go eases off. Inside the green band the rider keeps a steady
        // full pace round the track; outside it they slow, so more green means more laps.
        const bh = 150;
        const bx = rx - 50;
        const bar = this.add.rectangle(bx, -10, 40, bh, COLORS.panelLight);
        const band = this.add.rectangle(bx, -10 + bh / 2 - bh * PACE_BAND[1], 40, bh * (PACE_BAND[1] - PACE_BAND[0]), 0x4f9a3a).setOrigin(0.5, 0);
        const marker = this.add.rectangle(bx, 0, 60, 6, COLORS.accent);
        const info = this.add.text(bx + 50, -10, '', textStyle(this.pts(16), COLORS.cream, { lineSpacing: 6 })).setOrigin(0, 0.5);
        body.add([bar, band, marker, info]);
        label.setY(92);
        tip.setY(126);
        // The track: green infield, red lanes with white lines, the coach watching from the middle.
        const RX = 150;
        const RY = 66;
        const TY = 16;
        const g = this.add.graphics().setY(TY);
        g.fillStyle(0x4f8a3a).fillEllipse(0, 0, (RX + 26) * 2, (RY + 26) * 2);
        g.lineStyle(34, 0xb5483a).strokeEllipse(0, 0, RX * 2, RY * 2);
        g.lineStyle(2, 0xf2efe6).strokeEllipse(0, 0, (RX - 17) * 2, (RY - 17) * 2).strokeEllipse(0, 0, (RX + 17) * 2, (RY + 17) * 2).strokeEllipse(0, 0, RX * 2, RY * 2);
        g.fillStyle(0x6aa84f).fillEllipse(0, 0, (RX - 18) * 2, (RY - 18) * 2);
        // The start and finish line at 6 o'clock, in front of the coach: a lap counts as the rider crosses it.
        g.lineStyle(3, 0xf2efe6).lineBetween(0, RY - 17, 0, RY + 17);
        vis.add(g);
        const hasCoach = !!who.coach && this.textures.exists(`chr:${who.coach}:act`);
        if (hasCoach) {
          ensureAnims(this, who.coach!);
          vis.add(this.add.sprite(0, TY + 16, `chr:${who.coach}:act`, 0).setOrigin(0.5, 1).play(`${who.coach}:idle-down`));
        }
        ensureAnims(this, who.player);
        const runner = this.add.sprite(0, 0, `chr:${who.player}:walk`, 0).setOrigin(0.5, 0.95).setScale(0.85);
        vis.add(runner);
        const lapMs = drill.ms / 4;
        let pace = 0.3;
        let onFor = 0;
        let drift = 0;
        let ang = -Math.PI / 2;
        let run = 0;
        let speed = 0;
        let dir = '';
        const press = () => (down = true);
        const release = () => (down = false);
        pad.on('pointerdown', press).on('pointerup', release).on('pointerout', release);
        kb.on('keydown-SPACE', press);
        kb.on('keyup-SPACE', release);
        stop = () => {
          kb.off('keydown-SPACE', press);
          kb.off('keyup-SPACE', release);
        };
        const laps = () => Math.floor(run / (Math.PI * 2));
        tick = (dt) => {
          const s = dt / 1000;
          drift += (Math.random() - 0.5) * s * 0.6;
          drift = Math.max(-0.08, Math.min(0.08, drift));
          pace = Math.max(0, Math.min(1, pace + (down ? 0.55 : -0.4) * s + drift * s));
          marker.setY(-10 + bh / 2 - bh * pace);
          const on = onPace(pace);
          if (on) onFor += dt;
          // Full speed in the band; too slow jogs, too fast soon blows up and slows to a stagger.
          const want = on ? 1 : pace < PACE_BAND[0] ? 0.35 + 0.4 * (pace / PACE_BAND[0]) : 0.55;
          speed += (want - speed) * Math.min(1, s * 3);
          const step = ((Math.PI * 2) / lapMs) * dt * speed;
          ang += step;
          run += step;
          // Anticlockwise, the way a running track is run.
          const x = RX * Math.cos(ang);
          const y = RY * Math.sin(-ang);
          const dx = -Math.sin(ang) * RX;
          const dy = -Math.cos(ang) * RY;
          const d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
          runner.setPosition(x, TY + y);
          // The far side of the track draws behind the coach, the near side in front.
          vis.bringToTop(runner);
          if (y < 0 && hasCoach) vis.moveDown(runner);
          if (d !== dir) {
            dir = d;
            runner.play(`${who.player}:walk-${d}`);
          }
          runner.anims.timeScale = 0.6 + speed * 1.2;
          runner.setTint(on ? 0xffffff : 0xffc8b8);
          const pct = t > 0 ? Math.round((onFor / t) * 100) : 0;
          info.setText(`Laps: ${laps()}\nOn pace: ${pct}%`);
          label.setText(on ? 'On pace' : pace > PACE_BAND[1] ? 'Too fast, ease off' : 'Too slow, push on');
        };
        finish = () => `${laps()} ${laps() === 1 ? 'lap' : 'laps'}, on pace ${Math.round((onFor / Math.max(1, t)) * 100)}% of the time.`;
      }
      let over = false;
      const ev = this.time.addEvent({
        delay: 16,
        loop: true,
        callback: () => {
          // A removed loop can still fire again in the same frame: a round only ends once.
          if (over) return;
          const dt = 16;
          t += dt;
          tick(dt);
          timeFill.width = bw * Math.max(0, 1 - t / drill.ms);
          if (t >= drill.ms) {
            over = true;
            const score = finish();
            done(score);
          }
        },
      });
      const prev = stop;
      stop = () => {
        ev.remove();
        prev?.();
      };
    };
    c.once('destroy', () => stop?.());
    intro();
    this.openModal(c, onClose);
  }

  /** Bike, bag and task in one panel (the task journal lives in the bag until the home PC, Spec 21b). */
  openPanel(tab: PanelTab, onClose?: () => void): void {
    const career = this.career;
    if (!career) {
      onClose?.();
      return;
    }
    // Switching tabs reopens the panel: keep its close action for the final close.
    const done = onClose ?? this.panelDone;
    this.panelDone = null;
    const { bikes, items, story } = services.content;
    const { width, height, k } = this.page();
    const w = Math.min(900, width - 24);
    const h = Math.min(560, height - 24);
    const c = this.add.container((width / 2) * k, (height / 2) * k).setScale(k);
    this.backdrop(c, w, h, true);
    const left = -w / 2 + 28;
    const top = -h / 2 + 24;
    const tabNames: Record<PanelTab, string> = { bike: 'Bike', bag: 'Bag', task: 'Task', skills: 'Skills', records: 'Records' };
    (['bike', 'bag', 'task', 'skills', 'records'] as PanelTab[]).forEach((t, i) => {
      const b = button(this, left + 60 + i * 130, top + 22, tabNames[t], () => this.openPanel(t), 120, 40);
      b.setSelected(t === tab);
      c.add(b);
    });
    c.add(button(this, w / 2 - 46, top + 22, '✕', () => this.closeModal(), 44, 40));
    const y0 = top + 70;
    const body = (x: number, y: number, text: string, size = 16, color: number = COLORS.cream, wrap = w - 56) => {
      const o = this.add.text(x, y, text, textStyle(this.pts(size), color, { wordWrap: { width: wrap } }));
      c.add(o);
      return o;
    };
    /** One line, narrowed to fit maxW. */
    const line = (x: number, y: number, text: string, size: number, color: number, maxW: number) => {
      const o = this.fitWidth(this.add.text(x, y, text, textStyle(this.pts(size), color)), maxW);
      c.add(o);
      return o;
    };

    if (tab === 'bike') {
      const bike = career.bike;
      const brand = bikes.brands.find((b) => b.id === bike.brand);
      const px = 20;
      line(left, y0, `${brand?.starter ?? bike.brand}  ·  ${bike.class}`, 22, COLORS.accent, px - 16 - left);
      const problem = bikeProblem(bikes, bike);
      const note = body(left, y0 + 32, problem ?? 'Runs. Ready for the backyard, and for the tracks once you have a motor.', 16, problem ? COLORS.accent : COLORS.muted, w / 2 - 40);
      const stats = bikeStats(bikes, bike);
      const max = statMax(bikes, bike.class);
      // The stats start below the note, however many lines it takes.
      const statsY = Math.max(y0 + 100, note.y + note.height + 22);
      bikes.stats.forEach((st, i) => c.add(statBar(this, left, statsY + i * 34, st.name, w / 2 - 260, max, 110).setValue(stats[st.id])));
      line(px, y0, 'Parts', 20, COLORS.accent, w / 2 - 28 - px);
      // Columns: the part's name, its grade, a bar and the percentage, each kept to its own space.
      const barW = w / 2 - 330;
      const pctX = px + 240 + barW;
      bikes.slots.forEach((slot, i) => {
        const part = bike.parts[slot.id];
        const y = y0 + 40 + i * 32;
        const cond = part ? Math.round(part.condition * 100) : 0;
        line(px, y, slot.name, 15, COLORS.cream, 182);
        line(px + 190, y, part ? `G${part.grade}` : '—', 15, COLORS.muted, 34);
        c.add(this.add.rectangle(px + 230, y + 10, barW, 10, COLORS.panelLight).setOrigin(0, 0.5));
        c.add(this.add.rectangle(px + 230, y + 10, Math.max(1, (barW * cond) / 100), 10, cond === 0 ? 0xb03030 : cond <= 20 ? COLORS.accent : 0x6fa84a).setOrigin(0, 0.5));
        line(pctX, y, cond === 0 ? 'Broken' : `${cond}%`, 15, cond === 0 ? COLORS.accent : COLORS.cream, w / 2 - 12 - pctX);
      });
    } else if (tab === 'bag') {
      const limit = services.content.shops.spareLimit;
      body(left, y0, 'Bag', 22, COLORS.accent);
      body(left + 90, y0 + 6, `Spare parts: ${spareCount(career)} of ${limit}`, 15, COLORS.muted);
      if (!career.bag.length) body(left, y0 + 40, 'Your bag is empty.', 16, COLORS.muted);
      // Story items first, then spares; spares get a Dump button (Spec 7.2: deleted, no resale).
      let y = y0 + 40;
      const rows = career.bag.map((b, i) => ({ b, i })).sort((a, b) => Number(!!a.b.part) - Number(!!b.b.part));
      const perPage = Math.max(1, Math.floor((h / 2 - 50 - y) / 52));
      const pages = Math.max(1, Math.ceil(rows.length / perPage));
      this.bagPage = Math.min(this.bagPage, pages - 1);
      for (const { b, i } of rows.slice(this.bagPage * perPage, (this.bagPage + 1) * perPage)) {
        if (b.part) {
          const p = b.part;
          const name = bikes.slots.find((s) => s.id === p.slot)?.name ?? p.slot;
          const cond = p.condition <= 0 ? 'Broken' : `${Math.round(p.condition * 100)}%`;
          if (p.owner) {
            // Lent for an errand (core/errands.ts): not the rider's to fit, sell or dump.
            body(left, y, `G${p.grade} ${name} (${p.owner.name}'s)`, 17);
            body(left, y + 24, `${cond} · ${p.owner.repaired ? `Repaired: take it back to ${p.owner.name}.` : `Get it repaired at the garage, then take it back to ${p.owner.name}.`}`, 14, COLORS.muted, w - 220);
            c.add(button(this, w / 2 - 90, y + 20, 'Dump', () => this.toast(notMine(p)), 110, 36));
            y += 52;
            continue;
          }
          body(left, y, `G${p.grade} ${name} (spare)`, 17);
          body(left, y + 24, `${cond} · ${p.class}. Fit it at the garage bench, or sell it at a parts shop.`, 14, COLORS.muted, w - 220);
          c.add(button(this, w / 2 - 90, y + 20, 'Dump', () => {
            this.confirm(`Send your G${p.grade} ${name.toLowerCase()} to the dump?\nIt's gone for good, with nothing back.`, 'Dump it', () => {
              dumpSpare(career, i);
              this.onShopChange?.();
              this.openPanel('bag');
            }, () => this.openPanel('bag'));
          }, 110, 36));
        } else {
          const def = items[b.id];
          body(left, y, def?.name ?? b.id, 18);
          body(left, y + 24, def?.desc ?? '', 15, COLORS.muted);
        }
        y += 52;
      }
      if (pages > 1) this.pager(c, 0, h / 2 - 34, this.bagPage, pages, (pg) => {
        this.bagPage = pg;
        this.openPanel('bag');
      });
    } else if (tab === 'task') {
      body(left, y0, 'Task', 22, COLORS.accent);
      body(left, y0 + 40, journal(story, career, this.flags), 18);
      body(left, y0 + 110, `Money: ${formatMoney(career.money)}`, 18);
      const shifts = Object.entries(career.counters).filter(([k]) => k.startsWith('job.'));
      const names = Object.fromEntries(services.content.world.jobs.map((j) => [j.id, j.name]));
      shifts.forEach(([k, n], i) => body(left, y0 + 146 + i * 28, `${names[k] ?? k}s finished: ${n}`, 16, COLORS.muted));
      const c0 = career.counters;
      let y = y0 + 160 + shifts.length * 28;
      if (c0['race.days']) {
        body(left, y, `Race days: ${c0['race.days']}   Moto wins: ${c0['race.wins'] ?? 0}   Podiums: ${c0['race.podiums'] ?? 0}`, 16, COLORS.muted);
        y += 28;
      }
      // Championships under way, then the badges and trophies won (Spec 12.5).
      for (const line of champLines(services.content, career, this.flags)) {
        body(left, y, line, 16, COLORS.muted);
        y += 28;
      }
      // The badges and trophies themselves, in a row.
      const won = services.content.championships.championships.map((d) => d.rewards[0]).filter((r) => r?.image && r.flag && this.flags[r.flag]);
      won.forEach((r, i) => {
        if (this.textures.exists(rewardTexture(r.image!))) c.add(this.add.image(left + 48 + i * 108, y + 56, rewardTexture(r.image!)).setDisplaySize(96, 96));
      });
    } else if (tab === 'records') {
      // Wins out of attempts at everything that can be raced again (core/records.ts).
      body(left, y0, 'Records', 22, COLORS.accent);
      const groups = careerRecords(services.content, career);
      if (!groups.length) body(left, y0 + 40, 'Nothing yet. Race days, championships and challenges are counted here, wins out of attempts.', 16, COLORS.muted);
      let y = y0 + 40;
      for (const g of groups) {
        body(left, y, g.title, 18, COLORS.cream);
        y += 28;
        for (const r of g.lines) {
          line(left + 16, y, recordText(r), 16, COLORS.muted, w - 72);
          y += 26;
        }
        y += 10;
      }
    } else {
      // Skills: each lead skill with its child skills, level and progress to the next level (GDD 6.1).
      const { skills } = services.content;
      const colW = (w - 56) / skills.leads.length;
      // The note goes at the foot first, so the rows can share out the room above it.
      const foot = body(left, 0, 'Racing and practice train Rider Ability. Training minigames for every skill come in later builds.', 14, COLORS.muted);
      foot.setY(h / 2 - 14 - foot.height);
      skills.leads.forEach((lead, i) => {
        const x = left + i * colW;
        const lx = leadXp(career.skills, lead);
        const head = line(x, y0, lead.name, 20, COLORS.accent, colW - 16);
        const level = line(x, Math.max(y0 + 28, head.y + head.height - 2), `Level ${leadLevel(skills, career.skills, lead)} · ${Math.floor(lx).toLocaleString()} XP`, 15, COLORS.cream, colW - 16);
        const barW = colW - 40;
        const leadBarY = Math.max(y0 + 58, level.y + level.height + 6);
        c.add(this.add.rectangle(x, leadBarY, barW, 8, COLORS.panelLight).setOrigin(0, 0.5));
        c.add(this.add.rectangle(x, leadBarY, Math.max(1, barW * levelProgress(lx, lead.multiplier, skills.maxLevel)), 8, COLORS.accent).setOrigin(0, 0.5));
        const first = leadBarY + 18;
        const rowH = Math.min(48, (foot.y - 6 - first) / Math.max(1, lead.children.length));
        lead.children.forEach((ch, j) => {
          const y = first + j * rowH;
          const xp = childXp(career.skills, ch.id);
          const lv = this.add.text(x + barW, y, `${childLevel(skills, career.skills, ch.id)}`, textStyle(this.pts(15), COLORS.accent)).setOrigin(1, 0);
          c.add(lv);
          const name = line(x, y, ch.name, 15, COLORS.cream, barW - lv.width - 8);
          const barY = y + Math.min(rowH - 8, Math.max(26, name.height + 4));
          c.add(this.add.rectangle(x, barY, barW, 6, COLORS.panelLight).setOrigin(0, 0.5));
          c.add(this.add.rectangle(x, barY, Math.max(1, barW * levelProgress(xp, 1, skills.maxLevel)), 6, 0x6fa84a).setOrigin(0, 0.5));
        });
      });
    }
    this.openModal(c, () => {
      const d = this.panelDone;
      this.panelDone = null;
      d?.();
    });
    this.panelDone = done;
    this.panelOpen = true;
  }

  /** Prev and Next buttons with the page number between them. */
  private pager(c: Phaser.GameObjects.Container, x: number, y: number, page: number, pages: number, go: (page: number) => void): void {
    c.add(button(this, x - 130, y, '◂ Prev', () => go(page - 1), 110, 36).setEnabled(page > 0));
    c.add(this.add.text(x, y, `${page + 1} / ${pages}`, textStyle(this.pts(15), COLORS.muted)).setOrigin(0.5));
    c.add(button(this, x + 130, y, 'Next ▸', () => go(page + 1), 110, 36).setEnabled(page < pages - 1));
  }

  /**
   * A shop, or the garage's services: Buy and Sell where it sells parts, Repairs where it repairs,
   * and Fit a spare where it has a bench (GDD 8.3 to 8.5). Every change goes straight onto the career.
   */
  openShop(shop: ShopDef, tab: ShopTab, onClose: () => void, page = 0): void {
    const career = this.career;
    if (!career) return;
    const { bikes, shops } = services.content;
    const tabs: [ShopTab, string][] = [];
    if (shop.sells) tabs.push(['buy', 'Buy'], ['sell', 'Sell']);
    if (shop.repairs) tabs.push(['repair', 'Repairs']);
    if (shop.fitFee !== undefined) tabs.push(['fit', 'Fit a spare']);
    if (!tabs.some(([t]) => t === tab)) tab = tabs[0][0];
    // Laid out at 900 × 600, then scaled down to fit a small screen such as a phone on its side.
    const { width, height } = view(this);
    const w = 900;
    const h = 600;
    const k = Math.min(1, (width - 16) / w, (height - 16) / h);
    const c = this.add.container(width / 2, height / 2).setScale(k);
    const shade = this.add.rectangle(0, 0, width / k, height / k, 0, 0.5).setInteractive();
    shade.on('pointerup', () => this.closeModal());
    c.add([shade, panel(this, 0, 0, w, h).setInteractive()]);
    const left = -w / 2 + 28;
    const top = -h / 2 + 22;
    // Moving between tabs and boxes inside the shop isn't closing it, so the world's onClose waits.
    this.onModalClose = null;
    const inner = (fn: () => void) => {
      this.onModalClose = null;
      fn();
    };
    const reopen = (t: ShopTab = tab, pg = 0) => this.openShop(shop, t, onClose, pg);
    const text = (x: number, y: number, t: string, size = 16, color: number = COLORS.cream, wrap = w - 56) => {
      const o = this.add.text(x, y, t, textStyle(this.pts(size), color, { wordWrap: { width: wrap } }));
      c.add(o);
      return o;
    };
    /** One line, narrowed to fit maxW: for the columns of a list, which sit at set places. */
    const line = (x: number, y: number, t: string, size: number, color: number, maxW: number) => {
      const o = this.fitWidth(this.add.text(x, y, t, textStyle(this.pts(size), color)), maxW);
      c.add(o);
      return o;
    };
    /** Applies a shop action, shows what happened and redraws the panel. */
    const done = (r: Result, t: ShopTab = tab, pg = 0) => {
      this.toast(r.message);
      if (r.ok) this.onShopChange?.();
      reopen(t, pg);
    };

    const title = text(left, top, shop.name, 24, COLORS.accent);
    // Kept above the tab buttons (their tops are at top + 46) at any Text size.
    if (title.height > 44) title.setScale(44 / title.height);
    const money = text(0, top + 4, `Money: ${formatMoney(career.money)}`, 18, COLORS.accent);
    money.setX(w / 2 - 80 - money.width);
    c.add(button(this, w / 2 - 46, top + 16, '✕', () => this.closeModal(), 44, 40));
    tabs.forEach(([t, label], i) => {
      const b = button(this, left + 80 + i * 170, top + 66, label, () => reopen(t), 160, 40);
      b.setSelected(t === tab);
      c.add(b);
    });
    const greeting = text(left, top + 96, shop.greeting, 15, COLORS.muted);
    const y0 = greeting.y + greeting.height + 34;
    const cls = career.bike.class;
    const spareRows = career.bag.map((b, i) => ({ part: b.part, i })).filter((r) => r.part);
    const yours = (slot: string) => {
      const p = career.bike.parts[slot];
      return p ? `G${p.grade} ${p.condition <= 0 ? 'broken' : `${Math.round(p.condition * 100)}%`}` : 'none';
    };
    const listPage = (rows: number, rowH: number) => {
      const perPage = Math.max(1, Math.floor((h / 2 - 60 - y0) / rowH));
      const pages = Math.max(1, Math.ceil(rows / perPage));
      const pg = Math.min(page, pages - 1);
      if (pages > 1) this.pager(c, 0, h / 2 - 32, pg, pages, (n) => reopen(tab, n));
      return { from: pg * perPage, to: (pg + 1) * perPage, pg };
    };

    if (tab === 'buy') {
      if (!sellsFor(shop, cls)) text(left, y0, `Nothing here for a ${cls}.`, 17, COLORS.muted);
      const stock = shopStock(shops, shop, career, cls);
      const [lo, hi] = shop.sells!.grades;
      text(left + 222, y0 - 26, 'Yours', 14, COLORS.muted);
      shop.sells!.slots.forEach((slot, i) => {
        if (!sellsFor(shop, cls)) return;
        const y = y0 - 6 + i * 46;
        const name = bikes.slots.find((s) => s.id === slot)?.name ?? slot;
        line(left, y + 8, name, 16, COLORS.cream, 215);
        line(left + 222, y + 8, yours(slot), 15, career.bike.parts[slot]?.condition <= 0 ? COLORS.accent : COLORS.muted, 170);
        for (let g = lo; g <= hi; g++) {
          const item = stock.find((s) => s.slot === slot && s.grade === g);
          const label = !item ? `G${g}: none in` : item.soldOut ? `G${g}: sold out` : `G${g}  ${formatMoney(item.price)}`;
          const b = button(this, left + 400 + (g - lo) * 160, y + 18, label, () => item && inner(() => this.offerPart(shop, item, () => reopen(), (r) => done(r))), 150, 40);
          b.setEnabled(!!item && !item.soldOut && career.money >= item.price - tradeIn(shops, career, item));
          c.add(b);
        }
      });
      text(left, h / 2 - 30, 'New parts: 100%, no modifiers. Stock changes after 3 race days or 10 shifts and practice sessions.', 13, COLORS.muted);
    } else if (tab === 'sell') {
      if (!spareRows.length) text(left, y0, 'You have no spare parts to sell. Parts you take off the bike go in your bag.', 16, COLORS.muted);
      const { from, to, pg } = listPage(spareRows.length, 46);
      spareRows.slice(from, to).forEach(({ part, i }, k) => {
        const p = part!;
        const y = y0 + k * 46;
        const value = resaleValue(shops, shop, career, p);
        const special = shop.sells!.slots.includes(p.slot);
        line(left, y + 6, `G${p.grade} ${bikes.slots.find((s) => s.id === p.slot)?.name ?? p.slot}`, 16, COLORS.cream, 260);
        line(left + 270, y + 6, `${Math.round(p.condition * 100)}%${special ? '' : ' · not their line, half price'}`, 14, COLORS.muted, w / 2 - 200 - (left + 270));
        if (p.owner) {
          c.add(button(this, w / 2 - 110, y + 16, 'Not yours', () => this.toast(notMine(p)), 170, 38));
          return;
        }
        const b = button(this, w / 2 - 110, y + 16, value === null ? "Won't buy" : `Sell ${formatMoney(value)}`, () => {
          const sell = () => done(sellSpare(shops, shop, career, i), 'sell', pg);
          // Small sales are one click; bigger ones ask first (GDD 8.3).
          if (value !== null && value >= 5000) inner(() => this.confirm(`Sell your G${p.grade} ${slotName(bikes, p.slot)} for ${formatMoney(value)}?`, 'Sell', sell, () => reopen('sell', pg)));
          else sell();
        }, 170, 38);
        b.setEnabled(value !== null);
        c.add(b);
      });
    } else if (tab === 'repair') {
      bikes.slots.forEach((slot, i) => {
        const y = y0 - 12 + i * 34;
        const part = career.bike.parts[slot.id];
        line(left, y + 4, slot.name, 15, COLORS.cream, 200);
        line(left + 210, y + 4, yours(slot.id), 15, part?.condition <= 0 ? COLORS.accent : COLORS.muted, 112);
        if (!part) return;
        const q = repairQuote(shops, slot.id, part, cls);
        if (!q.ok) {
          line(left + 330, y + 4, q.reason, 14, COLORS.muted, w / 2 - 20 - (left + 330));
          return;
        }
        const b = button(this, left + 420, y + 12, `Repair ${formatMoney(q.cost)}`, () => inner(() => {
          this.confirm(
            `Repair your G${part.grade} ${slot.name.toLowerCase()} (${Math.round(part.condition * 100)}%)?\nIt comes back as G${q.grade} at 100%, for ${formatMoney(q.cost)}. Every repair drops a grade.`,
            'Repair',
            () => done(repairPart(shops, bikes, career, slot.id)),
            () => reopen(),
          );
        }), 170, 32);
        b.setEnabled(career.money >= q.cost);
        c.add(b);
        line(left + 520, y + 4, `→ G${q.grade} at 100%`, 14, COLORS.muted, w / 2 - 20 - (left + 520));
      });
      // Parts lent for an errand are repaired from the bag, the same way (core/errands.ts).
      spareRows.filter((r) => r.part!.owner).forEach(({ part, i }, k) => {
        const p = part!;
        const y = y0 - 12 + (bikes.slots.length + 0.5 + k) * 34;
        const name = slotName(bikes, p.slot);
        line(left, y + 4, `${p.owner!.name[0].toUpperCase()}${p.owner!.name.slice(1)}'s ${name.toLowerCase()}`, 15, COLORS.cream, 320);
        if (p.owner!.repaired) return void line(left + 330, y + 4, `Repaired: take it back.`, 14, COLORS.muted, w / 2 - 20 - (left + 330));
        const q = repairQuote(shops, p.slot, p, p.class);
        if (!q.ok) return void line(left + 330, y + 4, q.reason, 14, COLORS.muted, w / 2 - 20 - (left + 330));
        const b = button(this, left + 420, y + 12, `Repair ${formatMoney(q.cost)}`, () => inner(() => {
          this.confirm(
            `Repair ${p.owner!.name}'s G${p.grade} ${name.toLowerCase()} (${Math.round(p.condition * 100)}%)?\nIt goes back as G${q.grade} at 100%, for ${formatMoney(q.cost)}. You get the cost back when you return it.`,
            'Repair',
            () => done(repairLent(shops, bikes, career, i)),
            () => reopen(),
          );
        }), 170, 32);
        b.setEnabled(career.money >= q.cost);
        c.add(b);
        line(left + 520, y + 4, `→ G${q.grade} at 100%`, 14, COLORS.muted, w / 2 - 20 - (left + 520));
      });
    } else {
      const fee = pence(shop.fitFee ?? 0);
      if (!spareRows.length) text(left, y0, 'You have no spare parts to fit. Buy one as a spare at a parts shop.', 16, COLORS.muted);
      const { from, to, pg } = listPage(spareRows.length, 46);
      spareRows.slice(from, to).forEach(({ part, i }, k) => {
        const p = part!;
        const y = y0 + k * 46;
        line(left, y + 6, `G${p.grade} ${bikes.slots.find((s) => s.id === p.slot)?.name ?? p.slot} · ${Math.round(p.condition * 100)}%`, 16, COLORS.cream, 300);
        line(left + 310, y + 6, `Replaces your ${yours(p.slot)}`, 14, COLORS.muted, w / 2 - 200 - (left + 310));
        const b = button(this, w / 2 - 110, y + 16, fee ? `Fit ${formatMoney(fee)}` : 'Fit', () => done(fitSpare(shops, bikes, shop, career, i), 'fit', pg), 170, 38);
        b.setEnabled(!!p.owner || (career.money >= fee && p.class === cls));
        c.add(b);
      });
    }
    this.openModal(c, onClose);
  }

  /** The buy box for one part: fit it now, take it as a spare, or leave it. */
  private offerPart(shop: ShopDef, item: StockItem, back: () => void, done: (r: Result) => void): void {
    const career = this.career!;
    const { bikes, shops } = services.content;
    const name = bikes.slots.find((s) => s.id === item.slot)?.name ?? item.slot;
    const old = career.bike.parts[item.slot];
    const change = statChange(bikes, career, item.slot, { grade: item.grade, condition: 1 });
    const lines = [
      `${formatMoney(item.price)}. New, at 100%, with no modifiers.`,
      old ? `On your bike now: G${old.grade}, ${old.condition <= 0 ? 'broken' : `${Math.round(old.condition * 100)}%`}.` : '',
      change.length ? `Fitted: ${change.map((s) => `${s.name} ${s.from} → ${s.to}`).join(', ')}.` : '',
    ].filter(Boolean);
    const off = tradeIn(shops, career, item);
    if (off) lines.splice(1, 0, `Trade in your set on the bike: ${formatMoney(off)} off, ${formatMoney(item.price - off)} fitted.`);
    const oldGoes = !old ? '' : off ? 'Your old set is traded in.' : old.condition <= 0 ? 'Your broken one goes to the dump.' : 'Your old one goes in your bag.';
    this.choose(`G${item.grade} ${name}`, lines.join('\n'), [
      { label: off ? `Buy and fit ${formatMoney(item.price - off)}` : 'Buy and fit', note: `${shop.name} fits it free. ${oldGoes}`, onPick: () => done(buyPart(shops, bikes, career, item, true)) },
      { label: 'Buy as a spare', note: 'Carry it in your bag. The garage fits spares on its bench.', onPick: () => done(buyPart(shops, bikes, career, item, false)) },
      { label: 'Not now', onPick: back },
    ], back);
  }

  openPause(): void {
    if (this.pause) return;
    const { width, height, k } = this.page();
    this.scene.pause('world');
    const c = this.add.container((width / 2) * k, (height / 2) * k).setScale(k);
    c.add(this.add.rectangle(0, 0, width, height, 0, 0.55).setInteractive());
    c.add(panel(this, 0, 0, 340, 360));
    c.add(this.add.text(0, -140, 'Paused', textStyle(28, COLORS.accent)).setOrigin(0.5));
    const items: [string, () => void][] = [
      ['Resume', () => this.closePause()],
      ['Save now', () => {
        this.world.saveNow();
        this.closePause();
      }],
      ['Settings', () => {
        this.closePause(false);
        this.scene.pause();
        this.scene.launch('settings', { back: 'world' });
      }],
      ['Main menu', () => {
        this.closePause();
        this.world.quitToMenu();
      }],
    ];
    items.forEach(([label, fn], i) => c.add(button(this, 0, -70 + i * 58, label, fn, 240, 46)));
    this.pause = c;
  }

  private closePause(resumeWorld = true): void {
    this.pause?.destroy();
    this.pause = null;
    if (resumeWorld) this.scene.resume('world');
  }
}

/** The Task tab's championship lines: each one under way, then what has been won. */
function champLines(c: typeof services.content, career: CareerState, flags: Record<string, boolean>): string[] {
  const out: string[] = [];
  for (const def of c.championships.championships) {
    const active = career.champs?.active[def.id];
    if (!active) continue;
    const venue = c.tracks.venues.find((v) => v.id === nextRoundVenue(def, active));
    const me = standings(c.racing.points, active).find((r) => r.player)!;
    out.push(`${def.name}: round ${active.rounds.length + 1} of ${def.rounds.length} next at ${venue?.name ?? '?'}${active.rounds.length ? `, ${me.points} points (${me.position}${me.position === 1 ? 'st' : me.position === 2 ? 'nd' : me.position === 3 ? 'rd' : 'th'})` : ''}.`);
  }
  const won = c.championships.championships.flatMap((d) => d.rewards[0]?.flag && flags[d.rewards[0].flag] ? [d.rewards[0].title ?? d.name] : []);
  if (won.length) out.push(`Won: ${won.map((t) => t.replace(/^the /, '')).join(', ')}.`);
  return out;
}
