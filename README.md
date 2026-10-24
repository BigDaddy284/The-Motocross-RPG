# Motocross RPG: The Road to Legend

A single-player, offline motocross career RPG. Start as an unknown rider with a broken 50cc and work your way up to legend.

This is **test build 0.4**: shops and repairs. After the garage mechanic's tutorial and the van, sign on at Farmland MX and race two motos against the Local Champion and 14 other riders, or put laps in on the backyard loop. Every lap trains your Rider Ability skills and wears your bike, and now you can buy parts, fit spares and pay for repairs in Home Town. All art is placeholder art in the agreed style, imported from the project's art threads.

## Play it

- **In a browser:** once GitHub Pages is switched on (Settings > Pages > Source: GitHub Actions), every push to `main` publishes the game to this repo's Pages site.
- **On your own computer:** install [Node.js](https://nodejs.org) (LTS), then:

  ```
  npm install
  npm run dev
  ```

  and open the address it prints (usually http://localhost:5173).

### Controls

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Walk | WASD or arrow keys, or click where you want to go | Tap where you want to go |
| Talk to an NPC or use an object | Click it, or face it and press E or Space | Tap it |
| Next line of dialogue | Click, E, Space or Enter | Tap the box |
| Zoom (50% to 200%) | Mouse wheel, + and -, or the Zoom button's slider | Zoom button, then drag the slider |
| Bike, bag and current task | Tab, I or B | Bike button |
| Skills | K, or the Skills tab in the Bike panel | Bike button, then Skills |
| Pause menu (save, settings) | Esc | ☰ button |

## What's in this build

### New in test build 0.4: parts shops and repairs

Following GDD 8.3 to 8.5 and Spec 7.4 and 14.4 to 14.6. Shops open once the opening chain is done; talk to the shopkeeper or click their counter.

- **General bike shop:** top end, bottom end, intake and exhaust, drivetrain, forks, shock, and bodywork and controls. **Tyres and wheels:** wheels and tyres, and brakes. Both stock Grades 1 to 3 for 50cc and 65cc (Spec 14.5a). Grade 1 is always on the shelf; Grade 2 and 3 parts come and go, and each one sells out until the stock changes. Stock changes after 3 race days or 10 other activities (finished shift batches and practice sessions), Spec 14.6. Frames aren't sold: they come from your sponsor or the class dealer.
- **Prices** follow Spec 14.4: each grade costs 2× the one below. A Grade 1 top end is £35, tyres £25, forks £120. New parts are at 100% with no modifiers. The buy box shows how each bike stat would change.
- **Buy and fit** (the shop fits it free) or **buy as a spare**. A part you take off goes in your bag; a broken one goes straight to the dump. You can carry 20 spares.
- **Sell** spares at either shop: price × (20% + 40% × condition) × demand (0.9 to 1.1, new at each stock change), and half that at the shop that doesn't specialise in the part. Broken parts can't be sold.
- **The garage** (talk to the mechanic, or use the counter or the workbench): **repairs** bring a Grade 2 or higher part back to 100%, one grade down, for 70% of a new part at that grade (Spec 7.4). Grade 1 and broken parts can't be repaired, only replaced. **Fit a spare** from your bag on the bench for £5.
- **Bag:** spares show their grade and condition, with a Dump button.
- New content file `shops.json` (prices, shop stock, repair and resale numbers), checked at start-up. Saves stay at version 3; the stock state is added on your first shop visit.

### New in test build 0.3: XP, practice and the first race day

Checked against the rest of the "Starter career slice" checklist (Systems Specification section 22), apart from the Local Champion championship, which comes next:

- **Skills and XP.** All three lead skills and their 19 child skills (GDD 6.1) on the OSRS XP table, with the lead skills at 5× (Rider Ability, Mechanical Engineer) and 4× (Fitness). Rider Ability XP gives Mechanical Engineer a 5% cross-skill bonus, and so on round the triangle (GDD 6.2). A Skills tab shows every level and the progress to the next one, and results show level-ups.
- **The race simulation** (Spec 10). Each lap is worked out section by section from your skills and your bike's stats: start gates with a bonus curve, clean air and traffic after the first corner, noise that Consistency narrows, mistakes and rare crashes that damage the parts the section puts at risk, passing within a second of the rider ahead, and ruts that deepen moto by moto. The same engine runs live and auto-complete, and a test checks that a held message gives exactly the same result both ways.
- **Wear** by distance on every part (Spec 7.3): youth classes at ×0.8, faster wear below 20%, knock-on from worn and broken parts, and a small chance of a random breakage. A broken engine part ends your moto; 4 broken parts retire you.
- **Farmland MX race day.** Talk to the track official at the race office. The first race day is free, then entry is £20. 16 riders including the Local Champion, 2 motos of 5 laps. Pick your gate (moto 1 in random order, moto 2 in moto 1 finishing order), pick a starting message, then race live or auto-complete. Leaving before moto 2 counts as a DNF.
- **The race screen.** The track with every rider as a dot (you are orange), the running order with gaps, your position, the gaps ahead and behind, your broken parts, a feed of passes and mistakes, and the section times of your last lap under Details. Play it at 2×, 8× or 32×, or pause.
- **The pit board** comes out each time the leader crosses the line: STEADY, PUSH or SAVE BIKE, 3 changes per moto, plus "It's over, bike blown" to retire.
- **Results.** Each moto shows positions, gaps, best laps, points, prize money (3× entry to the winner, paid to 10th) and XP. The day shows the overall order, the podium bonus, your money, XP by skill and what wore on your bike.
- **Backyard practice.** Click the dirt loop behind your rented room. Ride laps on your own until you stop: free, practice XP at a tenth of the race rate, and real wear. Farmland MX also has free practice for £5.
- **Testing only:** shift pay is tripled (`testPayMultiplier: 3` in `world.json`), so a fabrication bracket pays £2.25 and a piston £3.75. Set it back to 1 before Final v1.
- Saves are now version 3; a test build 0.2 save upgrades with every skill at level 1.
- New content files, all checked at start-up: `skills.json`, `racing.json` (every race rule and tuning number), `tracks.json` (track sections and venues) and `riders.json` (the CPU riders and the local field). `npx vite-node tools/sim/balance.ts 300 1` runs 300 race days and prints the spread of results, crashes, money, XP and wear, for tuning.

### New in test build 0.2: the starter career slice

Checked against the "Starter career slice" part of the Systems Specification checklist (section 22), up to the van:

- Character creation: pick a rider, type a rider name (it can't be changed later), and choose one of four starter 50cc bikes: Yamamoto, Kwakmoto, Sukimoto or Hondmoto. Each leans a different way with the same overall total.
- Money and a bike: you start with £150 and a second-hand bike whose Grade 1 parts are at 50–80% condition, with the top end at 0%. The Bike panel shows the six bike stats, every part's grade and condition, your bag and your current task. The task also shows on screen under your money.
- The opening chain, run by the garage mechanic. You get a used top end, pay £90 to fit it on the garage bench, and earn £120 for it. Then come errands to the bike shop, tyre shop and engine rebuilder, two customer bike services, and a visit to the van seller. It can't be skipped, and it pays out so you reach the van £80 short.
- Until the chain is done, roadworks block the west road and the NPCs outside it don't acknowledge you. When it ends, the roadworks are cleared away and a fresh tarmac patch is left behind.
- Repeatable shifts at the fabrication shop (20 brackets at 75p) and the engine rebuilder (16 pistons at £1.25). Each part is a pass through three stations: click the highlighted station, wait for it, and move on. You're paid per part, even if you stop early.
- The used van for £600. A final task loads your bike and spares from your rented room, which opens the venue route and the world map. You can drive to Farmland MX, Quarry MX and Woodland MX and look around. The local racer points you to Farmland MX.
- Saves are now version 2. A test build 0.1 save upgrades on load and starts the opening chain with a Hondmoto. Autosave also runs after every task step and every finished batch.
- New content files, all checked at start-up: `bikes.json` (stats, part slots, brands), `items.json`, `story.json` (the opening chain, step by step) and `world.json` (locks, world map, shift jobs).

### From test build 0.1

Checked against the first-build checklist in the Systems Specification, section 22:

- Main menu that opens straight away: New career, Continue, Load, Settings, Archive, Info, Exit.
- Settings that apply at once, save automatically and have Restore Defaults.
- Home Town, the Industrial Zone and all 12 interiors, built from the art threads' Tiled maps with the finished buildings.
- WASD and click-to-move. Clicking a blocked tile walks to the nearest reachable tile; clicking an NPC walks to a free tile beside them and opens dialogue.
- Doors load the interior, and leaving returns you to the tile outside that building.
- Map caching: a map's images and ground are kept after the first visit, so going back is near-instant.
- Content checks: every data file is checked when the game starts, and a broken file stops the game with the file and field named.
- Versioned saves with 5 rotating backups. A damaged save is kept and the newest good backup is offered.
- Autosave every 5 minutes, plus Save now in the pause menu.

## How the project is laid out

| Path | What it holds |
| --- | --- |
| `src/core/` | Game rules with no graphics: pathfinding, saves, settings, content checks, doors and exits, money, bikes and the opening chain (`career.ts`), story changes to maps (`mapState.ts`), skills and XP (`skills.ts`), the race simulation (`race.ts`), race days, practice and venues (`raceDay.ts`), and shops, repairs and spares (`shops.ts`). Covered by tests. |
| `src/scenes/` | Phaser screens: boot, menus, settings, the world, the on-screen HUD, and the race and practice screen. |
| `src/world/` | Drawing maps and characters. |
| `public/data/` | Game content as JSON: NPCs, dialogue, bikes, items, the opening chain (`story.json`), the world map, locks and shift jobs (`world.json`), and shops and repairs (`shops.json`). Every file is checked when the game starts. |
| `public/assets/` | Art and baked maps, written by the import tool. Don't edit by hand. |
| `tools/import-art.mjs` | Copies the art from the shared art folder and bakes each Tiled map into one game-ready file. |
| `tools/map-editor.html` | Standalone map and tile editor for the game maps and the Tiled sources. |
| `tests/` | Unit tests, plus checks that every door, exit and NPC on the real maps works. |

### Technology

TypeScript, [Phaser 3](https://phaser.io) and [Vite](https://vitejs.dev), with [Vitest](https://vitest.dev) for tests. Saves are JSON in the browser's storage; a desktop app wrapper (Tauri) with saves as files comes in a later build. None of the Adventure Land code is used.

### Updating the art

When the art threads change a map or sprite, run the import tool against the shared art folder and commit the result:

```
npm run import-art -- /path/to/art
npm test
```

### Editing maps

`tools/map-editor.html` is a map and tile editor for this game. It is one file with no build step: open it in Chrome or Edge (double-click it), click **Open folder…** and pick either:

- `public/assets` to edit the **game maps** exactly as the game loads them, or
- the shared `art` folder to edit the **Tiled source maps** (`.tmj`).

It paints tiles on every ground layer, edits collision, moves, copies, clears and swaps regions (buildings move with their doors), places and moves props, and checks that doors, spawns and exits sit on free tiles. In Chrome and Edge, Save writes straight back into the folder; other browsers download the file instead. An unchanged map saves back byte for byte.

`npm run import-art` rebuilds every game map from the Tiled sources, so edits made only to a game map are lost the next time the art is imported. For changes that should last, edit the `.tmj` map, then run the import. After saving, run `npm test`.

### Checks

```
npm test          # unit tests and map checks
npm run build     # type check and production build into dist/
```
