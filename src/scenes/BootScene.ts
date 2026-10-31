import Phaser from 'phaser';
import { CONTENT_FILES, checkContent, type Manifest, type RawContent } from '../core/content';
import type { BakedMap } from '../core/mapTypes';
import { newCareerState, type BikesData, type WorldData } from '../core/career';
import { fetchFolder, loadModTracks } from '../core/modTracks';
import type { VenueDef } from '../core/raceDay';
import { rewardTexture, type ChampionshipsData } from '../core/championship';
import { bikeImage, worldMapTexture } from '../core/worldMap';
import { SAVE_VERSION, type SaveData } from '../core/saves';
import { Travel } from '../core/travel';
import { formatError } from '../core/validate';
import { services } from '../services';
import { COLORS, textStyle } from '../ui/theme';
import { START_MAP } from './careerFlow';
import type { RaceSceneData } from './RaceScene';
import { view } from '../ui/view';
import { bikeImagePath, bikeTexture, vanTexture, vanTurnTexture } from '../world/VanView';
import { HEADINGS } from '../core/vehicles';
import { loadModModels } from '../world/modModels';

// Loads the manifest, every baked map's data and the content files, checks them all, then loads
// the character and van sheets. Map images load later, the first time each map is visited.

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const { width, height } = view(this);
    const label = this.add.text(width / 2, height / 2, 'Loading…', textStyle(22)).setOrigin(0.5);
    this.load.on('progress', (v: number) => label.setText(`Loading… ${Math.round(v * 100)}%`));
    this.load.json('manifest', 'assets/manifest.json');
    for (const [k, file] of Object.entries(CONTENT_FILES)) this.load.json(`content:${k}`, file);
  }

  create(): void {
    const manifest = this.cache.json.get('manifest') as Manifest;
    for (const m of manifest.maps) this.load.json(`map:${m.id}`, `assets/maps/${m.id}.json`);
    for (const [id, sheet] of Object.entries(manifest.characters.sheets)) {
      const [fw, fh] = manifest.characters.frame;
      this.load.spritesheet(`chr:${id}:walk`, `assets/${sheet.walk}`, { frameWidth: fw, frameHeight: fh });
      this.load.spritesheet(`chr:${id}:act`, `assets/${sheet.act}`, { frameWidth: fw, frameHeight: fh });
      // The push-up frames are side on, so wider than a walk frame: up, then down.
      if (sheet.fit) this.load.spritesheet(`chr:${id}:fit`, `assets/${sheet.fit}`, { frameWidth: 96, frameHeight: 64 });
    }
    for (const [id, sheet] of Object.entries(manifest.vehicles ?? {})) {
      this.load.image(vanTexture(id), `assets/${sheet.image}`);
      if (sheet.turn) this.load.image(vanTurnTexture(id), `assets/${sheet.turn.image}`);
    }
    // The bike on its stand in each brand, for the load bed of the Old Rusty Truck.
    for (const b of (this.cache.json.get('content:bikes') as BikesData | undefined)?.brands ?? []) {
      for (const model of ['youth', 'adult']) for (const h of HEADINGS) this.load.image(bikeTexture(model, b.id, h), `assets/${bikeImagePath(model, b.id, h)}`);
    }
    // Badges and trophies (championships.json rewards).
    const champs = this.cache.json.get('content:championships') as ChampionshipsData | undefined;
    for (const c of champs?.championships ?? []) for (const r of c.rewards) if (r.image) this.load.image(rewardTexture(r.image), `assets/${r.image}`);
    // The world map, its zone versions and a map bike for every class and brand.
    const wm = (this.cache.json.get('content:world') as WorldData | undefined)?.worldMap;
    const bikes = this.cache.json.get('content:bikes') as BikesData | undefined;
    if (wm) {
      for (const img of [wm.image, ...wm.zones.flatMap((z) => (z.image ? [z.image] : []))]) this.load.image(worldMapTexture(img), `assets/${img}`);
      for (const c of bikes?.classes ?? []) for (const b of bikes?.brands ?? []) {
        const img = bikeImage(wm, { class: c.id, brand: b.id, parts: {} });
        this.load.image(worldMapTexture(img), `assets/${img}`);
      }
    }
    this.load.once('complete', () => this.finish(manifest));
    this.load.start();
  }

  private finish(manifest: Manifest): void {
    const maps = new Map<string, BakedMap>();
    for (const m of manifest.maps) maps.set(m.id, this.cache.json.get(`map:${m.id}`) as BakedMap);
    const raw = Object.fromEntries(Object.keys(CONTENT_FILES).map((k) => [k, this.cache.json.get(`content:${k}`)])) as RawContent;
    const { content, errors } = checkContent(raw, manifest, maps);
    if (!content || errors.length) {
      this.showErrors(errors.map(formatError));
      return;
    }
    services.manifest = manifest;
    services.content = content;
    services.maps = maps;
    services.travel = new Travel(maps, content.world.locks);
    void Promise.all([fetchFolder(import.meta.env.BASE_URL), loadModModels(import.meta.env.BASE_URL, content.trackParts.scenery)]).then(([folder, added]) => {
      // New scenery from the models folder (world/modModels.ts), before mod tracks that may use it are checked.
      content.trackParts.scenery.push(...added);
      services.modFolder = folder;
      services.modTracks = loadModTracks(content, folder, services.store);
      this.startGame();
    });
  }

  private startGame(): void {
    const { content } = services;
    const params = new URLSearchParams(window.location.search);
    // The track editor's race view, in a frame inside the editor (TrackEditScene).
    if (params.has('editview')) return void this.scene.start('trackedit');
    // The models page: export the game's objects for Blender, and see what the models folder holds (ModelsScene).
    if (params.has('models')) return void this.scene.start('models');
    const test = params.get('testtrack');
    if (test && content.tracks.tracks.some((t) => t.id === test)) this.testRide(test);
    else this.scene.start('menu');
  }

  /**
   * Dev only: ?testtrack=<track id> goes straight to a race day on that track with a new rider
   * and the local field, without a venue or a save, to try a track from the track editor.
   */
  private testRide(trackId: string): void {
    const { bikes, story, tracks } = services.content;
    const track = tracks.tracks.find((t) => t.id === trackId)!;
    const career = newCareerState(bikes, story, bikes.brands[0].id);
    for (const part of Object.values(career.bike.parts)) part.condition = 1;
    const save: SaveData = { version: SAVE_VERSION, savedAt: new Date().toISOString(), rider: { name: 'Tester', look: '' }, position: { map: START_MAP, x: 0, y: 0, facing: 'down' }, flags: { first_race_done: true }, stats: { playSeconds: 0 }, career, van: null, driving: false };
    const venue: VenueDef = { id: `test-${trackId}`, name: track.name, map: START_MAP, track: trackId, class: '50cc', field: 'area1.local' };
    const data: RaceSceneData = { mode: track.practiceOnly ? 'practice' : 'raceday', venue, save, fee: 0, onDone: () => this.scene.start('menu') };
    this.scene.start('race', data);
  }

  /** A content problem stops the game with the file and field named, rather than failing later. */
  private showErrors(lines: string[]): void {
    this.children.removeAll();
    const { width } = view(this);
    this.add.text(width / 2, 60, 'The game data has problems and cannot start', textStyle(24, COLORS.accent)).setOrigin(0.5);
    this.add.text(40, 110, lines.slice(0, 20).join('\n'), textStyle(16, COLORS.cream, { wordWrap: { width: width - 80 } }));
    for (const l of lines) console.error(l);
  }
}
