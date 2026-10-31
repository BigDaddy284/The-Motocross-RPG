import Phaser from 'phaser';
import { newCareerState, pence } from '../core/career';
import type { SaveData } from '../core/saves';
import { spawnTile } from '../core/travel';
import { CAREER_SLOT, services } from '../services';
import { COLORS, textStyle } from '../ui/theme';
import { button, panel } from '../ui/widgets';
import { when } from './MenuScene';
import { cssSize } from '../ui/view';

export const START_MAP = 'area1-home-town';

/** Loads a career and enters the world, or offers the newest good backup if the save is damaged. */
export function startCareer(scene: Phaser.Scene, slot: string): void {
  const r = services.saves.load(slot);
  if (r.status === 'ok') {
    scene.scene.start('world', { save: r.data });
    return;
  }
  if (r.status === 'empty') return;
  const { width, height } = cssSize(scene);
  const c = scene.add.container(width / 2, height / 2);
  c.add(scene.add.rectangle(0, 0, width, height, 0, 0.6).setInteractive());
  c.add(panel(scene, 0, 0, 600, 300));
  c.add(scene.add.text(0, -110, 'This save is damaged', textStyle(26, COLORS.accent)).setOrigin(0.5));
  const body = r.backup
    ? `The damaged file has been kept in case it can be recovered.\nLoad backup ${r.backup.index} from ${when(r.backup.data.savedAt)} instead?`
    : 'The damaged file has been kept in case it can be recovered.\nThere is no good backup to load.';
  c.add(scene.add.text(0, -30, body, textStyle(17, COLORS.cream, { align: 'center', wordWrap: { width: 540 } })).setOrigin(0.5));
  if (r.backup) {
    const idx = r.backup.index;
    c.add(button(scene, -130, 90, 'Load backup', () => {
      const data = services.saves.restoreBackup(slot, idx);
      if (data) scene.scene.start('world', { save: data });
    }, 220, 42));
  }
  c.add(button(scene, r.backup ? 130 : 0, 90, 'Cancel', () => c.destroy(), 220, 42));
}

// TEST ONLY, REMOVE BEFORE RELEASE (Boss, 28 Oct 2026): a new rider named "moneymoneymoney" starts
// with £50,000 for testing. Listed under "Before release" in the README.
const TEST_MONEY_NAME = 'moneymoneymoney';
const TEST_MONEY = 50000;

/** A fresh career at the Home Town new-game spawn. Overwrites slot 1, keeping it as backup 1. */
export function newCareer(scene: Phaser.Scene, pick: { look: string; name: string; brand: string }): void {
  const home = services.maps.get(START_MAP)!;
  const t = spawnTile(home, 'new_game')!;
  const { bikes, story } = services.content;
  const data: Omit<SaveData, 'version' | 'savedAt'> = {
    rider: { name: pick.name, look: pick.look },
    position: { map: START_MAP, x: t.x, y: t.y, facing: 'down' },
    flags: {},
    stats: { playSeconds: 0 },
    career: newCareerState(bikes, story, pick.brand),
    van: null,
    driving: false,
  };
  if (pick.name.toLowerCase() === TEST_MONEY_NAME) data.career.money = pence(TEST_MONEY); // TEST ONLY, REMOVE BEFORE RELEASE
  const saved = services.saves.write(CAREER_SLOT, data);
  scene.scene.start('world', { save: saved, intro: true });
}
