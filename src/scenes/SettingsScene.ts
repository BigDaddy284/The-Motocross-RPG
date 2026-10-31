import Phaser from 'phaser';
import { TEXT_MAX, TEXT_MIN, ZOOM_CONTROLS, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type Settings } from '../core/settings';
import { services } from '../services';
import { COLORS, textStyle } from '../ui/theme';
import { button, panel, slider, toggle } from '../ui/widgets';
import { cssSize, DPR } from '../ui/view';

// Settings apply as soon as they change and save automatically (GDD 20.1).

type Tab = 'Audio' | 'Display' | 'Accessibility' | 'Gameplay' | 'Controls';
const TABS: Tab[] = ['Audio', 'Display', 'Accessibility', 'Gameplay', 'Controls'];

export class SettingsScene extends Phaser.Scene {
  private back: 'menu' | 'world' = 'menu';
  private tab: Tab = 'Audio';

  constructor() {
    super('settings');
  }

  init(data: { back?: 'menu' | 'world' }): void {
    this.back = data.back ?? 'menu';
  }

  create(): void {
    // Opened from the pause menu it must draw over the world and HUD.
    this.scene.bringToTop();
    this.draw();
    this.scale.on('resize', this.draw, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.draw, this));
    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private draw(): void {
    this.children.removeAll(true);
    // Laid out on an 800 × 600 page; the camera zooms it to fit the screen.
    const width = 800;
    const height = 600;
    const css = cssSize(this);
    const k = Math.min(1, css.width / width, css.height / height);
    this.cameras.main.setZoom(k * DPR).centerOn(width / 2, height / 2);
    const cx = width / 2;
    if (this.back === 'menu') this.add.rectangle(-4000, -4000, 8000 + width, 8000 + height, COLORS.ink).setOrigin(0);
    else this.add.rectangle(-4000, -4000, 8000 + width, 8000 + height, 0, 0.55).setOrigin(0).setInteractive();
    const w = 760;
    const h = 560;
    panel(this, cx, height / 2, w, h);
    const top = height / 2 - h / 2;
    const left = cx - w / 2 + 32;
    this.add.text(cx, top + 32, 'Settings', textStyle(30, COLORS.accent)).setOrigin(0.5);

    const tabW = (w - 40) / TABS.length;
    TABS.forEach((t, i) => {
      const b = button(this, cx - w / 2 + 20 + tabW * (i + 0.5), top + 82, t, () => {
        this.tab = t;
        this.draw();
      }, tabW - 6, 36);
      if (t === this.tab) (b.list[0] as Phaser.GameObjects.Rectangle).setStrokeStyle(2, COLORS.accent);
    });

    const s = services.settings.get();
    const rowY = (i: number) => top + 140 + i * 52;
    const label = (i: number, text: string) => this.add.text(left, rowY(i), text, textStyle(18)).setOrigin(0, 0.5);
    const sliderX = left + 230;
    const sliderW = Math.max(120, w - 360);
    const upd = <C extends keyof Settings, K extends keyof Settings[C]>(c: C, k: K) => (v: Settings[C][K]) => services.settings.update(c, k, v);

    switch (this.tab) {
      case 'Audio':
        label(0, 'Master volume'); slider(this, sliderX, rowY(0), sliderW, 0, 100, s.audio.master, upd('audio', 'master'));
        label(1, 'Music'); slider(this, sliderX, rowY(1), sliderW, 0, 100, s.audio.music, upd('audio', 'music'));
        label(2, 'Bike engines'); slider(this, sliderX, rowY(2), sliderW, 0, 100, s.audio.engines, upd('audio', 'engines'));
        label(3, 'Crowd'); slider(this, sliderX, rowY(3), sliderW, 0, 100, s.audio.crowd, upd('audio', 'crowd'));
        label(4, 'Mute all'); toggle(this, sliderX + 26, rowY(4), s.audio.muted, upd('audio', 'muted'));
        this.add.text(left, rowY(5), 'The test build has no sound yet; these are saved for later.', textStyle(15, COLORS.muted)).setOrigin(0, 0.5);
        break;
      case 'Display':
        label(0, 'Map zoom (%)'); slider(this, sliderX, rowY(0), sliderW, ZOOM_MIN, ZOOM_MAX, s.display.zoom, upd('display', 'zoom'), ZOOM_STEP);
        label(1, 'Full screen');
        toggle(this, sliderX + 26, rowY(1), this.scale.isFullscreen, (v) => {
          services.settings.update('display', 'fullscreen', v);
          if (v) this.scale.startFullscreen();
          else this.scale.stopFullscreen();
        });
        label(2, 'Zoom control');
        ZOOM_CONTROLS.forEach((z, i) => {
          button(this, sliderX + 80 + i * 170, rowY(2), z === 'slider' ? 'Slider' : '+ and −', () => {
            services.settings.update('display', 'zoomControl', z);
            this.draw();
          }, 160, 38).setSelected(s.display.zoomControl === z);
        });
        this.add.text(left, rowY(3), 'The on-screen zoom: a Zoom button that opens a slider, or + and − buttons.', textStyle(15, COLORS.muted)).setOrigin(0, 0.5);
        break;
      case 'Accessibility':
        label(0, 'Text size (%)'); slider(this, sliderX, rowY(0), sliderW, TEXT_MIN, TEXT_MAX, s.accessibility.textScale, upd('accessibility', 'textScale'), 10);
        label(1, 'Reduced effects'); toggle(this, sliderX + 26, rowY(1), s.accessibility.reducedEffects, upd('accessibility', 'reducedEffects'));
        label(2, 'High contrast'); toggle(this, sliderX + 26, rowY(2), s.accessibility.highContrast, upd('accessibility', 'highContrast'));
        break;
      case 'Gameplay':
        label(0, 'Tutorial prompts'); toggle(this, sliderX + 26, rowY(0), s.gameplay.tutorialPrompts, upd('gameplay', 'tutorialPrompts'));
        label(1, 'Context hints'); toggle(this, sliderX + 26, rowY(1), s.gameplay.contextHints, upd('gameplay', 'contextHints'));
        label(2, 'Repeated reminders'); toggle(this, sliderX + 26, rowY(2), s.gameplay.reminders, upd('gameplay', 'reminders'));
        // TEST ONLY, REMOVE BEFORE RELEASE (Boss, 30 Oct 2026): test ride tracks on your own.
        label(3, 'TEST: Ride alone (no AI)'); toggle(this, sliderX + 26, rowY(3), s.gameplay.testRideAlone, upd('gameplay', 'testRideAlone'));
        break;
      case 'Controls': {
        const c = s.controls;
        const rows = [
          ['Move', `${c.up} ${c.left} ${c.down} ${c.right}  or arrow keys`],
          ['Click or tap', 'Walk there, talk to an NPC, use an object'],
          ['Talk / use', `${c.interact} or Space`],
          ['Zoom', 'Mouse wheel, + and - keys, or the zoom buttons'],
          ['Pause menu', c.menu],
        ];
        rows.forEach(([a, b], i) => {
          label(i, a);
          this.add.text(sliderX, rowY(i), b, textStyle(17, COLORS.muted)).setOrigin(0, 0.5);
        });
        this.add.text(left, rowY(5), 'Rebinding keys comes in a later build.', textStyle(15, COLORS.muted)).setOrigin(0, 0.5);
        break;
      }
    }

    button(this, cx - 130, top + h - 40, 'Restore defaults', () => {
      services.settings.restoreDefaults();
      this.draw();
    }, 220, 42);
    button(this, cx + 130, top + h - 40, 'Back', () => this.close(), 220, 42);
  }

  private close(): void {
    if (this.back === 'menu') this.scene.start('menu');
    else {
      this.scene.stop();
      this.scene.resume('world');
      this.scene.resume('hud');
    }
  }
}
