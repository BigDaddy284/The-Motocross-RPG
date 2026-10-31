import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { HudScene } from './scenes/HudScene';
import { MenuScene } from './scenes/MenuScene';
import { NewCareerScene } from './scenes/NewCareerScene';
import { RaceScene } from './scenes/RaceScene';
import { SettingsScene } from './scenes/SettingsScene';
import { ModelsScene } from './scenes/ModelsScene';
import { TrackEditScene } from './scenes/TrackEditScene';
import { WorldScene } from './scenes/WorldScene';
import { DPR } from './ui/view';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#14141e',
  pixelArt: true,
  roundPixels: true,
  // Drawn at the screen's real resolution and shown at CSS size (see ui/view.ts); fitScreen keeps it full-window.
  scale: { mode: Phaser.Scale.NONE, width: window.innerWidth * DPR, height: window.innerHeight * DPR, zoom: 1 / DPR },
  input: { activePointers: 2 },
  scene: [BootScene, MenuScene, NewCareerScene, SettingsScene, WorldScene, HudScene, RaceScene, TrackEditScene, ModelsScene],
});

/**
 * The size the game can show at: the visible part of the page. In a phone browser (not added to
 * the home screen) the toolbars cover some of the window, so it's the visual viewport there, or
 * the game's own box (sized to the visible height by the page's CSS).
 */
function screenSize(): { w: number; h: number } {
  const box = document.getElementById('game')?.getBoundingClientRect();
  const vv = window.visualViewport;
  const w = Math.min(window.innerWidth, box?.width || Infinity, vv ? vv.width * vv.scale : Infinity);
  const h = Math.min(window.innerHeight, box?.height || Infinity, vv ? vv.height * vv.scale : Infinity);
  return { w, h };
}

function fitScreen(): void {
  const { w: cw, h: ch } = screenSize();
  const w = Math.round(cw * DPR);
  const h = Math.round(ch * DPR);
  if (w !== game.scale.width || h !== game.scale.height) game.scale.resize(w, h);
}
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', () => setTimeout(fitScreen, 200));
window.visualViewport?.addEventListener('resize', fitScreen);
// Safari ignores user-scalable=no: stop pinch and double-tap zoom, which push the game off screen.
for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
fitScreen();

// Exposed for automated playtests and debugging in the browser console.
(window as unknown as { game: Phaser.Game }).game = game;
