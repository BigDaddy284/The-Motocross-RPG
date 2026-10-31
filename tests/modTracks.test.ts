import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newCareerState } from '../src/core/career';
import { checkContent } from '../src/core/content';
import { routeArrival } from '../src/core/guides';
import { MOD_PLACE, MOD_PREFIX, TRACK_FILE, forgetImport, importedFiles, keepImport, loadModTracks, modVenue, readModTrack } from '../src/core/modTracks';
import { RaceDay, entryFee, playerEntrant } from '../src/core/raceDay';
import { MemoryStore } from '../src/core/storage';
import { loadManifest, loadMaps, rawContent } from './helpers';

const maps = loadMaps();
const fresh = () => checkContent(rawContent(), loadManifest(), maps).content!;
const content = fresh();
const DIR = 'public/mods/tracks';
const farmland = () => structuredClone(content.tracks.tracks.find((t) => t.id === 'farmland')!);
const asFile = (track: unknown) => JSON.stringify({ format: TRACK_FILE, version: 1, track });

describe('the mods folder', () => {
  it('holds only track files the game can race (and its README)', () => {
    const files = readdirSync(DIR);
    expect(files).toContain('first-try-mx.track.json');
    for (const f of files.filter((n) => n.endsWith('.json'))) {
      const m = readModTrack(content, f, readFileSync(`${DIR}/${f}`, 'utf8'), 'folder');
      expect(m.problems, f).toEqual([]);
      expect(m.track!.id.startsWith(MOD_PREFIX)).toBe(true);
    }
  });

  it('lists the example by its name, under its own id so it never clashes with the game’s tracks', () => {
    const rc = fresh();
    const folder = [{ file: 'first-try-mx.track.json', text: readFileSync(`${DIR}/first-try-mx.track.json`, 'utf8') }];
    const mods = loadModTracks(rc, folder, new MemoryStore());
    expect(mods.map((m) => [m.name, m.file])).toEqual([['First Try MX (example mod)', 'first-try-mx.track.json']]);
    expect(rc.tracks.tracks.filter((t) => t.id === 'farmland')).toHaveLength(1);
    expect(rc.tracks.tracks.some((t) => t.id === 'mod.first-try-mx')).toBe(true);
    // Loading again replaces, never doubles up.
    loadModTracks(rc, folder, new MemoryStore());
    expect(rc.tracks.tracks.filter((t) => t.id.startsWith(MOD_PREFIX))).toHaveLength(1);
  });
});

describe('checking a mod track like the game’s own', () => {
  const problems = (text: string) => readModTrack(content, 'x.track.json', text, 'folder').problems;

  it('reads the track editor’s export, or a bare track', () => {
    expect(problems(asFile(farmland()))).toEqual([]);
    expect(problems(JSON.stringify(farmland()))).toEqual([]);
  });

  it('takes a finish-line jump and a tunnel through a deck, as the editor saves them', () => {
    const t = farmland();
    const jump = t.sections.find((s) => s.type === 'tabletop')!;
    jump.finish = true;
    jump.tunnel = 'walk';
    (t as unknown as { features: unknown[] }).features = [{ type: 'tabletop', at: 0, len: 16, passing: 0.3, finish: true, tunnel: 'walk' }];
    expect(problems(asFile(t))).toEqual([]);
    jump.tunnel = 'drain' as never;
    expect(problems(asFile(t)).join()).toMatch(/tunnel.*must be one of track, walk/);
  });

  it('refuses what isn’t a raceable track, and says why', () => {
    expect(problems('not json')).toEqual(['the file is not valid JSON']);
    expect(problems('{"hello": 1}')[0]).toMatch(/not a track file/);
    expect(problems(asFile({ ...farmland(), draft: true }))[0]).toMatch(/unfinished/);
    expect(problems(asFile({ ...farmland(), start: undefined })).join()).toMatch(/no start straight/);
    const t = farmland();
    t.sections[0].type = 'loop_the_loop';
    expect(problems(asFile(t)).join()).toMatch(/no section "loop_the_loop"/);
    const s = farmland();
    s.scenery = [...(s.scenery ?? []), { type: 'giant_robot', x: 1, y: 1 } as never];
    expect(problems(asFile(s)).join()).toMatch(/no scenery "giant_robot"/);
    expect(problems(asFile({ ...farmland(), practiceOnly: true })).join()).toMatch(/practice-only/);
  });
});

describe('importing in the game', () => {
  it('keeps imports in this browser, replaces one of the same name, and removes it', () => {
    const store = new MemoryStore();
    keepImport(store, 'mine.track.json', asFile({ ...farmland(), name: 'Mine' }));
    keepImport(store, 'mine.track.json', asFile({ ...farmland(), name: 'Mine v2' }));
    const rc = fresh();
    const mods = loadModTracks(rc, [], store);
    expect(mods.map((m) => [m.name, m.source, m.track?.id])).toEqual([['Mine v2', 'imported', 'mod.imp.mine']]);
    forgetImport(store, 'mine.track.json');
    expect(importedFiles(store)).toEqual([]);
    expect(loadModTracks(rc, [], store)).toEqual([]);
    expect(rc.tracks.tracks.some((t) => t.id.startsWith(MOD_PREFIX))).toBe(false);
  });
});

describe('racing a mod track', () => {
  it('is a 50cc race day against the local field, with Farmland’s entry, prizes and wear', () => {
    const rc = fresh();
    const [mod] = loadModTracks(rc, [{ file: 'loop.track.json', text: asFile({ ...farmland(), name: 'My Loop' }) }], new MemoryStore());
    const venue = modVenue(mod, 'area1-home-town');
    const farm = rc.tracks.venues.find((v) => v.track === 'farmland')!;
    expect(venue).toMatchObject({ name: 'My Loop', track: 'mod.loop', class: farm.class, field: farm.field });
    expect(entryFee(rc, venue, { first_race_done: true })).toBe(entryFee(rc, farm, { first_race_done: true }));
    // No free first race on a mod track.
    expect(entryFee(rc, venue, {})).toBe(entryFee(rc, farm, { first_race_done: true }));

    const career = newCareerState(rc.bikes, rc.story, rc.bikes.brands[0].id);
    const d = new RaceDay(rc, venue, playerEntrant(rc, career, 'Test'), 5, entryFee(rc, venue, {}));
    expect(d.field).toHaveLength(16);
    for (let m = 0; m < 2; m++) {
      d.assignGates(d.gatesForPlayer().free[0]);
      const sim = d.startMoto('steady');
      sim.runToEnd();
      d.finishMoto(sim);
    }
    expect(d.done).toBe(true);
    expect(d.dayResult().overall).toHaveLength(16);
  });

  it('is on the venue road and every lane, picked rather than taken by default', () => {
    for (const r of content.world.routes) expect(r.to, r.map).toContain(MOD_PLACE);
    const home = maps.get('area1-home-town')!;
    const road = home.objects.find((o) => o.type === 'exit' && o.name === 'To the venue route')!;
    const to = routeArrival(home, road, content.world, maps, MOD_PLACE);
    expect(typeof to === 'string' ? to : to.map).toBe('venue-motocross');
  });
});
