// Balance check for No-Turn Takedown (Boss, 30 Oct 2026): a new rider at each level on a bike at
// 90% races a Farmland race day and a knockout on Takedown Strip with the same seed, and prints how
// often each is won, podiumed and (for the knockout) how often the final is reached. The knockout's
// buff and noise in racing.json sim.knockout are tuned so its win chance matches a race day's.
// Run with: npx vite-node tools/sim/knockout.ts [days]
import { readFileSync } from 'node:fs';
import { checkContent } from '../../src/core/content';
import { newCareerState } from '../../src/core/career';
import { RaceDay, entryFee, playerEntrant, PLAYER_ID, type RaceContent } from '../../src/core/raceDay';
import { Knockout } from '../../src/core/knockout';
import { loadModTracks, modVenue } from '../../src/core/modTracks';
import { MemoryStore } from '../../src/core/storage';
import { xpForLevel } from '../../src/core/skills';
import { loadManifest, loadMaps, rawContent } from '../../tests/helpers';
const days = Number(process.argv[2] ?? 100);
const content = checkContent(rawContent(), loadManifest(), loadMaps()).content!;
const rc: RaceContent = content;

const FILE = 'takedown-strip.track.json';
const [mod] = loadModTracks(rc, [{ file: FILE, text: readFileSync(`public/mods/tracks/${FILE}`, 'utf8') }], new MemoryStore());
const kv = modVenue(mod, 'area1-home-town');
const farm = content.tracks.venues.find((v) => v.id === 'venue-farmland')!;
function rider(level: number, cond: number) {
  const c = newCareerState(content.bikes, content.story, 'hondmoto', Math.random);
  for (const p of Object.values(c.bike.parts)) p.condition = cond;
  for (const ch of content.skills.leads[0].children) c.skills.xp[ch.id] = xpForLevel(level);
  return playerEntrant(rc, c, 'You');
}
for (const level of [1, 5, 10, 15, 20]) {
  let dayWin = 0, dayPod = 0, koWin = 0, koPod = 0, koFinal = 0;
  for (let d = 0; d < days; d++) {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    {
    const day = new RaceDay(rc, farm, rider(level, 0.9), seed, 0);
    for (let m = 0; m < 2; m++) { day.assignGates(day.gatesForPlayer().free[0]); const s = day.startMoto('steady'); s.runToEnd(); day.finishMoto(s); }
    const p = day.dayResult().overall.find((r) => r.player)!.position; if (p === 1) dayWin++; if (p <= 3) dayPod++;
    }
    const k = new Knockout(rc, kv, rider(level, 0.9), seed, 0);
    const s = k.startSeeding('steady'); s.runToEnd(); k.finishSeeding(s);
    while (!k.done) { const h = k.next!; const sim = k.startHeat(h, 'steady', h.riders.includes(PLAYER_ID) ? k.gatesForPlayer(h).free[0] : undefined); sim.runToEnd(); k.finishHeat(h, sim); }
    const r = k.dayResult().position; if (r === 1) koWin++; if (r <= 3) koPod++; if (r <= 4) koFinal++;
  }
  console.log(`level ${level}: race day win ${(100*dayWin/days).toFixed(0)}% podium ${(100*dayPod/days).toFixed(0)}% | knockout win ${(100*koWin/days).toFixed(0)}% podium ${(100*koPod/days).toFixed(0)}% final ${(100*koFinal/days).toFixed(0)}%`);
}
