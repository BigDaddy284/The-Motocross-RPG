# Adding Assets, Models, Tracks and Content to Motocross RPG

This guide shows you how to add your own content to **Motocross RPG: The Road to Legend** so that it really shows up in the game and in the track editor. You do not need to know how to program.

Everything here was checked against the game as it is today (Alpha v1, game version 0.3.0, October 2026). Where something could not be checked, the guide says so.

> **The one-sentence summary:** you can add **map pictures** (tiles and props), **whole race tracks**, and a few kinds of **track parts** without programming. **3D models, sounds, new bikes and new player looks need a programmer**, because the game has no way to load them from a file yet.

---

## Contents

1. [Words you will see in this guide](#1-words-you-will-see-in-this-guide)
2. [Before you start: getting the game on your computer](#2-before-you-start-getting-the-game-on-your-computer)
3. [The different types of content](#3-the-different-types-of-content)
4. [Reference tables: file types, sizes and limits](#4-reference-tables-file-types-sizes-and-limits)
5. [How to add each kind of asset](#5-how-to-add-each-kind-of-asset)
6. [Adding a complete track](#6-adding-a-complete-track)
7. [Example files you can copy](#7-example-files-you-can-copy)
8. [Troubleshooting](#8-troubleshooting)
9. [Things that could not be checked](#9-things-that-could-not-be-checked)

---

## 1. Words you will see in this guide

| Word | What it means |
| --- | --- |
| **Asset** | Any piece of content the game uses: a picture, a track, a map. |
| **PNG** | A type of picture file whose name ends in `.png`. It can have see-through parts. The game's art is all PNG. |
| **Pixel** | One tiny coloured dot in a picture. A picture that is "64 × 64 pixels" is 64 dots wide and 64 dots tall. |
| **Transparent** | See-through. A transparent pixel shows whatever is behind it. |
| **Tile** | A small square picture, 64 × 64 pixels in this game. Maps are built from tiles laid side by side, like a floor made of square slabs. |
| **Prop** | A picture that stands on the map, such as a lamp post, a bin or a tree. Props can be bigger than one tile. |
| **Map** | One place you can walk around in the game, such as Home Town or the inside of the bike shop. |
| **Track** | A race circuit. Tracks are made in the **track editor** and raced in the **race view**. |
| **Race view** | The 3D race screen, where the bikes ride round the track. |
| **Grid unit** | The track editor measures tracks on a grid that is 100 units wide and 60 units tall. One grid unit is about 2.7 metres in the race. |
| **JSON file** | A text file (name ends in `.json`) that the game reads for its data, such as the list of tracks. You can open one in any text editor, like Notepad. |
| **Folder path** | Where a file lives, written with slashes. `public/mods/tracks/` means: the `public` folder, then the `mods` folder inside it, then the `tracks` folder inside that. |
| **Repo** | Short for "repository": the folder that holds the whole game, called `the-motocross-rpg`. |
| **Mod track** | A race track made by a player. It is raced from **Mod Track** on the venue road. |
| **Draft** | An unfinished track. You can save it, but the game will not race it. |
| **Race-ready** | A track that has passed all of the game's checks, so the game can race it. |

---

## 2. Before you start: getting the game on your computer

Most of the work in this guide happens in the game's own folder on your computer.

1. Get a copy of the game folder (the repo). If you are not sure how, ask whoever runs the project to give you a copy of the `the-motocross-rpg` folder.
2. Install **Node.js** (the "LTS" version) from <https://nodejs.org>. This is a free program that runs the game on your own computer.
3. Open a terminal (on Windows: the "Command Prompt" or "PowerShell"; on a Mac: "Terminal") in the game folder.
4. Type this and press Enter. It downloads what the game needs. You only do this once.

   ```
   npm install
   ```

5. Type this and press Enter to start the game on your computer:

   ```
   npm run dev
   ```

6. It prints an address, usually <http://localhost:5173>. Open that address in **Chrome** or **Edge**.

**What you should see:** the game's menu, with **New career**, **Continue**, **Load**, **Settings**, **Archive**, **Info** and **Exit**.

Leave the terminal window open while you work. Closing it stops the game.

**Why Chrome or Edge?** Both editors can save straight into your game folder only in Chrome or Edge. In other browsers, saving downloads the file instead, and you then copy it into the right folder yourself.

### Checking your work: the game's tests

The game has a set of automatic checks called **tests**. After you change something, you can run them:

```
npm test
```

**What you should see:** a summary at the end saying how many tests passed, with `failed` nowhere in it. If a test fails, it prints which file and what is wrong. Section 8 explains the common ones.

---

## 3. The different types of content

This table shows every kind of content and whether you can add it yourself.

- **Yes** means you can add it with the editors or by placing files, with no programming.
- **Partly** means some of it works without programming, but not all of it.
- **Needs a programmer** means the game has no way to load it from a file; someone has to change the game's code.

| Content | Used for | Where it belongs | Can you add it yourself? |
| --- | --- | --- | --- |
| Map tiles (ground pictures) | The ground of the walk-around maps: grass, roads, paths, water | Main game maps, made in the **map editor** | **Yes** (see section 5.1, and the separate *Map Editor Tile Guide*) |
| Map props (objects on the map) | Lamp posts, fences, bins, trees on the walk-around maps | Main game maps, map editor | **Yes** (section 5.2) |
| Buildings on the map | Houses, shops and workshops you can walk into | Main game maps, map editor's **Buildings** box | **Partly**: you can build a new building from existing pictures (section 5.3) |
| Complete race tracks | New circuits to race | **Track editor**, raced from **Mod Track** | **Yes** (section 6) |
| Jumps, doubles, tabletops, berms, whoops and other track features | The obstacles on a track | Track editor, **Features** | **Yes**, using the 16 feature types that already exist. New *types* need a programmer. |
| Ground round a race track | The grass, dirt or concrete round the track in the race view | Track editor, **Ground** mode | **Yes**, using the 10 that exist. A new ground type is **Partly** (section 5.4). |
| Surface patches on a track | Coloured patches of mud, sand, water and so on along the track | Track editor, **Surfaces** mode | **Yes**, using the 6 that exist. A new colour is **Partly** (section 5.5). |
| Scenery round a race track | Banners, hay bales, stands, trees, vans, fans | Track editor, **Scenery** mode | **Yes**, using the 31 that exist. New scenery is **Partly**: it shows only as a plain coloured box in the race (section 5.6). |
| Banner and sponsor board text | Your own words on banners | Track editor, Scenery | **Yes**: select a banner and type the text |
| Character looks (people) | How a person on the map looks | Main game maps | **Partly**: you can redraw an existing person (section 5.7). A new person or new player look needs a programmer or the art import tool. |
| 3D models (bikes, vans, objects in the race) | Anything in the 3D race view | Race view | **Needs a programmer.** The game has **no 3D model loader**: there is no way to load a model file (such as `.glb`, `.gltf`, `.fbx` or `.obj`). Every 3D shape in the race, including the bikes, vans, trees and stands, is built by the game's code from simple shapes. |
| Bikes and bike parts | The bikes you buy and race, and their parts | Shops, race | **Needs a programmer** for new bikes and parts. They are game data, not art, and the race bikes are drawn by code. |
| Vans on the walk-around map | The van you drive | Main game | **Needs the art team's van tools** (section 5.8). Not a beginner task. |
| Textures and materials for 3D | Surface pictures on 3D objects | Race view | Only the **ground round the track** uses picture files. Everything else in the race view is plain colour set by code. |
| Animations | Moving pictures | Main game maps | **Partly**: people walk using their sprite sheets, and animated props are possible through the Tiled source maps (section 5.2). There is no animation import for the race view. |
| Sounds and music | Sound effects, music | Everywhere | **Not supported.** The game has no sound yet. Its Settings screen says: "The test build has no sound yet; these are saved for later." |
| Item and part icons | Pictures in menus | Menus | **Not used.** The game's menus are text only; there are no icon files to replace. |
| Whole new maps (new areas) | A new town or venue to walk round | Main game | **Needs a programmer** for a new outdoor area (the list of area maps is written inside the art import tool). A new *interior* can be copied from an existing one with the map editor's building tools (section 5.3). |

---

## 4. Reference tables: file types, sizes and limits

Each value has a label:

- **Required**: the game or editor will not work properly without it.
- **Maximum**: the game or editor checks this and refuses anything bigger.
- **Recommended**: a sensible choice for good results. Nothing stops you doing otherwise.
- **Not yet confirmed**: this could not be established from the project.

### 4.1 Pictures for the walk-around maps (tiles and props)

| What | Value | Label |
| --- | --- | --- |
| File type | PNG, with the file name ending in lower-case `.png` | **Required**: the map editor only lists files ending in `.png`. A `.PNG`, `.jpg` or `.gif` file will not appear in it. |
| Colour type | RGBA (colour with a see-through channel) | **Recommended**: every picture in the game is RGBA. |
| Ground tile size | **64 × 64 pixels** | **Required** for a ground tile to fit its square. The map grid is 64 pixels; the map editor and the art import tool both refuse maps with any other tile size. |
| Ground tile shape | Square | **Required** (follows from 64 × 64). |
| Prop size | Any size. The game's props are 64 × 64, 64 × 128, 64 × 192, 128 × 64, 128 × 128, 128 × 160, 128 × 192, 192 × 128 and 256 × 192 pixels | **Recommended**: whole multiples of 64 so the prop lines up with the squares. Not enforced. |
| Furniture inside buildings | Any size. The game's furniture ranges from 32 × 70 to 140 × 92 pixels | Not enforced. |
| Transparency | Ground tiles should have no see-through pixels. Props should be see-through round the outside | **Recommended**. A see-through hole in a ground tile shows black in the game. |
| File name | Lower-case letters, numbers and hyphens, such as `dry-grass-1.png` | **Recommended**. This matches every existing tile. Names are **case-sensitive** on the published website, so `Grass.png` and `grass.png` are different files. |
| File size on disk | No limit in the project | **Not yet confirmed** (no limit found). The game's tiles are about 5 to 10 KB each. |
| How many tiles | No limit in the project | **Not yet confirmed** (no limit found). The game already has over 1,000 pictures. |

### 4.2 Pictures for the race view (track editor ground and scenery)

| What | Value | Label |
| --- | --- | --- |
| File type | PNG | **Required**: the game adds `.png` to the name itself. |
| Where | Inside a folder directly under `public/assets/art/area-map/tiled/tiles/`, such as `.../tiles/terrain-common/dirt-1.png` | **Required** |
| Name written in `trackParts.json` | `folder/name` with **no** `.png`, all lower case, such as `terrain-common/dirt-1` | **Required**: the game checks it is lower-case letters, numbers, `_`, `-` and `.`, with exactly one `/`. |
| Ground picture size | 64 × 64 pixels, square, no see-through pixels | **Recommended**: the race view stretches the picture to fill each ground square (2 × 2 grid units by default), so a non-square picture looks squashed. Every existing ground picture is 64 × 64. |

### 4.3 People (character sprite sheets)

A **sprite sheet** is one picture that holds every frame of a person's animation in a grid.

| What | Value | Label |
| --- | --- | --- |
| File type | PNG | **Required** |
| One frame | 64 × 64 pixels | **Required** (set in the game's manifest) |
| Feet position in a frame | Pixel 32 across, 63 down (bottom middle) | **Required** for the person to stand on the ground properly |
| Walk sheet | 6 frames across × 4 rows = **384 × 256 pixels**. Rows top to bottom: facing down, left, right, up | **Required** |
| Action sheet (`.act.png`) | 3 frames across (idle 1, idle 2, reach) × 4 rows = **192 × 256 pixels** | **Required** |
| Speed | Walk 10 frames a second; idle 3 frames a second | Set by the game |

### 4.4 Tracks

| What | Value | Label |
| --- | --- | --- |
| File type | `.track.json`, made by the track editor | **Required**: do not write one by hand |
| File name when saved by the editor | Made from the name you type: lower case, with spaces and symbols turned into `-`, at most 60 characters, then `.track.json` | Set by the editor |
| The track area | 100 × 60 grid units (about 270 × 162 metres) | **Maximum**: a track that crosses the edge is a draft until it is back inside |
| Crossing the edge while you work | Up to 12 grid units | **Maximum** (the editor stops you going further) |
| Scenery outside the edge | Up to 20 grid units | **Maximum** |
| Route points | At least 3, in a closed loop | **Required** for racing |
| Track width | 1 to 12 grid units (new tracks start at 3.4) | **Maximum** and minimum, checked by the game |
| Start straight length | At least 12 grid units | **Required** |
| Start straight joining angle | 75° or less | **Maximum** |
| Start board official's walk | At most 8 grid units | **Maximum** |
| Track height (hills and dips) | 36 metres up to 36 metres down | **Maximum** |
| Hill tool length | 6 to 48 grid units a click | Set by the editor |
| Hill tool height | 0.5 to 5 metres a click | Set by the editor |
| Steepness along the track | More than 35% gets a warning | Warning only |
| Ground steepness | Steeper than 45° (a wall) | **Maximum**: an error |
| Feature length while placing | 2 to 60 grid units | Set by the editor |
| Length of the whole lap | No limit found | **Not yet confirmed** |
| Number of features or scenery items | No limit found | **Not yet confirmed** |
| File size | 4,000,000 characters when saved through `npm run dev` | **Maximum** (only for that way of saving). No limit was found for importing in the game. |

---

## 5. How to add each kind of asset

### 5.1 Map tiles (ground pictures)

Tiles have their own detailed guide: **[MAP_EDITOR_TILE_GUIDE.md](MAP_EDITOR_TILE_GUIDE.md)**. Here is the short version.

- **Used for:** the ground of the walk-around maps.
- **Belongs to:** the main game, edited with the **map editor** (`tools/map-editor.html`).
- **File type:** PNG, 64 × 64 pixels.
- **Where it goes:** a folder inside `public/assets/art/`, for example `public/assets/art/area-map/tiled/tiles/my-tiles/dry-grass-1.png`.
- **Registration needed:** none. The map editor finds every PNG in that folder when you open it.

Steps:

1. Make your 64 × 64 PNG (copy an existing tile to start, so the size is right).
2. Make a new folder: `public/assets/art/area-map/tiled/tiles/my-tiles/`.
3. Put your PNG in it.
4. Open `tools/map-editor.html` in Chrome or Edge (double-click it, or go to <http://localhost:5173/tools/map-editor.html> while `npm run dev` is running).
5. Click **Open folder…** and pick the `public` folder inside the game folder.
6. Pick a map in the list at the top (for example `venue-motocross`).
7. In the **Palette** list on the right, pick `my-tiles`. Your tile appears.
8. Click it, then click the map to paint.
9. Click **Save**.
10. Reload the game page and walk to that spot.

![The map editor with a new tile in the palette, painted next to a tree on Farmland](screenshots/guides/map-editor-new-tile-painted.jpg)

*The map editor after painting a new yellow "dry grass" tile (top right, in the `my-tiles` palette group) onto the Farmland map.*

![The same tile in the game](screenshots/guides/game-new-tile-farmland.jpg)

*The same tile in the game, on Farmland MX.*

> ⚠️ **Do not edit Home Town for practice.** Home Town's map file is protected by a test. Any change to it makes `npm test` fail with "Home Town changed". Practise on another map, such as `venue-motocross`.

### 5.2 Map props (objects that stand on the map)

- **Used for:** lamp posts, fences, bins, signs, trees and other objects on the walk-around maps.
- **Belongs to:** the main game, map editor.
- **File type:** PNG, any size (multiples of 64 are recommended), see-through round the outside.
- **Where it goes:** the same as tiles: a folder inside `public/assets/art/`, for example `public/assets/art/area-map/tiled/tiles/my-props/`.
- **Registration needed:** none.

Steps:

1. Make your PNG. Draw the object standing at the **bottom** of the picture, because the editor lines the bottom of the picture up with the bottom of a square.
2. Put it in `public/assets/art/area-map/tiled/tiles/my-props/`.
3. Open the map editor and **Open folder…** the `public` folder (as in 5.1).
4. In **Layers** on the left, click **Objects** (on indoor maps it is called **Furniture**). Use **Overhead** instead for things that should be drawn above the player, such as a tree's leaves.
5. Pick your prop in the **Palette**. The palette shows its size, such as `64×128`, in the corner if it is bigger than one square.
6. Click empty ground on the map. The prop is placed centred on that square, with its bottom edge on the bottom of the square. Hold **Alt** while placing to place it freely instead of on the grid.
7. To move it: pick the **Objects** tool (**V**), then drag it. **Del** deletes the selected prop.
8. **Props do not block the player on their own.** To stop the player walking through it, click the **Collision** layer and paint the squares under it with the **Brush** (**B**). The **Eraser** (**E**) frees them again.
9. Click **Save**, then reload the game.

**Animated props:** the game can play a prop as an animation (it does this for the track banner and the chimney smoke), but the animation frames have to be set up in the **Tiled** source files by the art team. A prop placed from the map editor's palette is always a still picture.

### 5.3 Buildings

- **Used for:** buildings on the outdoor maps, with doors into an interior map.
- **Belongs to:** the main game, map editor, **Buildings** box on the left. The list of buildings is saved in `public/data/buildings.json`.
- **Pictures it can use:** pieces of the existing building pictures, or any prop picture in the `industrial-props` or `town-props` folders under `public/assets/art/area-map/tiled/tiles/`.

Steps:

1. Open the map editor and **Open folder…** the `public` folder (or the whole game folder). The Buildings box needs this to find `public/data/buildings.json`. If you open only `public/assets`, it says "No building library found".
2. Open an outdoor map.
3. In **Buildings**, click **New…**.
4. Type a **Name** and an **Id**. The id must be lower case, like `bld.home.my_house` (letters, numbers, dots, dashes and underscores).
5. Set the **Footprint** size (each side 1 to 120 squares) and paint it: **Solid** for walls, **Walkable** for a doorway or porch, **None** for squares that are not part of the building.
6. Under **Pictures**, choose a picture and click **Add**, then drag it into place with **Move picture**.
7. Add a **Door** (on a Walkable square) and a **Return** (the square you come back out onto, not on a Solid square).
8. Under **Interior**, choose an interior to copy and click **New interior from this**, so the building has its own inside.
9. Read the list of problems under the picture. When it is empty, click **Save to library**.
10. Pick the building in the list and click **Place**. It turns green where it fits and red, with the reason, where it does not. Click to put it down.
11. Click **Save**, then run `npm test` to check that every door and exit still works.

Restrictions:

- Buildings cannot be turned round, because each picture is drawn for one direction.
- Ticking **Unfinished** saves the building as a draft, which cannot be placed yet.
- Once a building is placed on a map, its id, footprint, pictures, doors and returns cannot be changed. Remove it from the map first, or use **Save as new building**.

### 5.4 A new kind of ground for race tracks

The track editor's **Ground** mode paints the ground round a race track. It has 10 kinds: Grass, Grass (darker), Grass and flowers, Long grass, Dirt, Dirt (darker), Gravel, Concrete, Tarmac and Arena floor. They are listed in `public/data/trackParts.json`.

You can add an eleventh by adding one entry to that file. This is **data, not code**, but there is an important catch about sharing (step 9).

1. Make a 64 × 64 PNG with no see-through pixels.
2. Put it in a folder directly inside `public/assets/art/area-map/tiled/tiles/`, for example `public/assets/art/area-map/tiled/tiles/my-tiles/dry-grass-1.png`.
3. Open `public/data/trackParts.json` in a text editor (such as Notepad or VS Code).
4. Find the line that starts `"ground": [`. Each line under it is one kind of ground, for example:

   ```json
   {"id": "dirt", "name": "Dirt", "art": "terrain-common/dirt-1", "color": "#9a6a3c"},
   ```

5. Copy the `Dirt` line and paste the copy just before the line with `"arena_floor"` (or after it: then put a comma after the `}` of the line before yours, and none after your own line if it is the last). Change it to describe yours:

   ```json
   {"id": "dry_grass", "name": "Dry grass", "art": "my-tiles/dry-grass-1", "color": "#b8b04a"},
   ```

   - `id`: a new name for the game to use. Lower-case letters, numbers, `_`, `-` and `.` only. It must not be used by another ground.
   - `name`: what the editor shows.
   - `art`: the folder and file name **without** `.png`.
   - `color`: a colour the game uses if the picture cannot be loaded, written as `#` and six letters or numbers.

6. Save the file.
7. Run `npm test`. A mistake in the file stops the game starting, and the test names the problem.
8. Open the track editor through `npm run dev` (section 6.2) and press **3** for **Ground**. Your ground appears in the list and you can paint with it or choose it as the **Base**.

   ![The track editor's Ground mode with a new "Dry grass" ground chosen as the base](screenshots/guides/track-editor-new-ground-type.jpg)

   *A test copy of the game with a new "Dry grass" ground added. It shows in the Ground list (bottom right) and in the race view.*

9. **The catch:** a track that uses your new ground only works in a copy of the game that also has your new entry. Anyone else who imports that track gets the message `no ground "dry_grass" in data/trackParts.json`, and the track is refused. **For a track you want to share, use only the game's own ground.**

### 5.5 A new colour of surface patch

Surface patches (Mud, Sand, Water splash, Ruts, Loose stones, Concrete pad) are coloured stripes along the track. They are listed under `"surfaces"` in `public/data/trackParts.json`, like this:

```json
{"id": "mud", "name": "Mud", "color": "#5a3d22"},
```

You can add a new one the same way as a new ground (copy a line, give it a new `id`, `name` and `color`). It has no picture: **it only changes the colour drawn on the track**. Surface patches do not change how the race is ridden. The same sharing catch applies as for ground.

### 5.6 New scenery for race tracks

Scenery is listed under `"scenery"` in `public/data/trackParts.json`. You can add a new entry, but you need to know what will happen:

- **In the track editor**, it appears in the **Scenery** list, using the `art` picture if you give one (only for the small button picture and the flat map).
- **In the race view, it is drawn as a plain box** in its `color`, about 0.6 metres tall, the size of its `w` and `h`. The game builds every scenery item's 3D shape with code, and a new id has no code yet, so it gets this simple box.

![A new "Crate stack" scenery item: a proper picture on its button, but a plain brown box in the race view](screenshots/guides/track-editor-new-scenery-box.jpg)

*A new "Crate stack" scenery item. Its button (bottom right) uses the crates picture, but in the race view it is a plain brown box.*

To give new scenery a real 3D shape, a programmer has to add it to the game's race view code. The same sharing catch applies as for ground.

An entry looks like this:

```json
{"id": "crate_stack", "name": "Crate stack", "w": 2, "h": 2, "art": "industrial-props/crates", "color": "#8a6a44"},
```

- `w` and `h`: the size on the track grid, in grid units.
- `art` (optional): a picture in the tiles folder, without `.png`.
- `color`: its colour, written as `#` and six letters or numbers.

### 5.7 People (changing how someone looks)

**Redrawing an existing person** (no registration needed):

1. Find their two sheets in `public/assets/art/characters/npcs/`, for example `npc-01-garage-mechanic.png` (walking) and `npc-01-garage-mechanic.act.png` (standing and reaching).
2. Make a backup copy of both files somewhere outside the game folder.
3. Redraw them. **Keep exactly the same size** (384 × 256 for walking, 192 × 256 for the action sheet) and the same frame layout: 64 × 64 frames, rows facing down, left, right and up, with the feet at the bottom middle of each frame.
4. Save them over the old files with the same names.
5. Reload the game.

**Adding a new person or a new look:** the game finds its people through `public/assets/manifest.json`, which is written by the art import tool (`npm run import-art`, see the warning in 5.9). Giving a person a brand-new sheet means adding it to the art folder's `characters/characters.json` and running the import, then naming the sheet in that person's `sprite` in `public/data/npcs.json`. **The player's own looks are a fixed list of four inside the game's code**, so a new player look needs a programmer.

### 5.8 Vans on the walk-around map

Each van is a large sheet of pictures (for example 768 × 320 pixels) with a matching data file that says where each view of the van is. These are made by the art team's van tools and checked against `public/data/vehicles.json` (each van's length in squares must match). **This is not a beginner task.** Ask the developer.

### 5.9 A warning about the art import tool

The game has a tool, `npm run import-art`, that rebuilds **every** map and copies **every** picture from the project's shared **art folder** (a separate folder that holds the original Tiled maps). It deletes `public/assets/art/` and `public/assets/maps/` and makes them again.

When this guide was written (27 October 2026), running it would **undo work**: the game's maps have been changed directly since the last import, and those changes are not in the art folder. A test run on a copy removed the "Engine rebuilder with lock-up" interior, renamed two venue maps and removed some tiles.

**Do not run `npm run import-art` unless the developer says the art folder is up to date.** The steps in this guide do not need it.

---

## 6. Adding a complete track

### 6.1 How tracks work

- A track is made in the **track editor** (`tools/track-editor.html`). You do **not** write a track file by hand: the editor makes it for you.
- Each player-made track is saved as its own file, `<name>.track.json`, in **`public/mods/tracks/`**. The editor never saves player tracks into the game's own `tracks.json`.
- The game finds them by itself: every `.json` file in `public/mods/tracks/` (except `index.json`) is listed under **Mod Track** on the venue road.
- A mod track race day is a **50cc race day against the local riders**, with the same entry fee, prize money, XP and parts wear as Farmland MX. There is no free practice and no area to walk round: picking it goes straight to the gate pick.

### 6.2 Opening the track editor

The best way is through `npm run dev`, because then saving goes straight into the right folder and you can race the track at once.

1. In the game folder, run `npm run dev` (see section 2).
2. In Chrome or Edge, go to <http://localhost:5173/tools/track-editor.html>.
3. Click **Load the tracks from this server** (on the welcome card, after "Or:").

![The track editor's welcome card](screenshots/guides/track-editor-welcome.jpg)

**What you should see:** the track list on the left with **First Try MX (example mod)**, the 3D **race view** in the middle, and the **Layout**, **Surfaces**, **Ground**, **Scenery** and **Height** modes on the right. The status line at the bottom says how many tracks were loaded.

![The track editor with the example track loaded](screenshots/guides/track-editor-example-track.jpg)

Other ways to open it:

- **Double-click `tools/track-editor.html`** and click **Open folder…**, then pick the game folder or its `public` folder. In Chrome and Edge, Save then writes into `public/mods/tracks/`. Opened this way, the race view runs the **published** game from the internet, so you need to be online, and it will not show any new pictures you have added on your computer.
- **On the published website**, at `…/Motocross-RPG/tools/track-editor.html`. Saving downloads the file.

> The track editor needs a mouse and keyboard. It is not usable on a phone (but racing a track on a phone works, through **Import track file** in the game).

### 6.3 Building a new track, step by step

1. Click **New** (under the track list). A new, empty track is made, and the editor starts drawing its route straight away.
2. **Draw the route:** click the ground point by point to make the shape of the lap. Each click adds a point.
3. **Close the route:** click the first point again (the green ring). The route box says "Closed the route".
4. **Add the start straight:** under **Start and finish**, click **Start straight**. It follows your mouse pointer. Move its end (the ring) onto the route where the riders should join it. It is **green** where it can go and **red, with the reason,** where it can't.
   - **Q** and **E** turn it, **F** brings it in from the other side, **,** and **.** make it shorter or longer.
   - Click (or press **Enter**) to place it. **Esc** cancels.
5. **Add the finish line:** click **Finish line** under Start and finish, move the chequered bar onto the route, and click.
6. **Add features** (jumps, berms and so on): see 6.4.
7. **Add the start board official** (the person who holds up the start board): click **Start board official**, then click the ground beside the start straight, just ahead of the gate and clear of the track. Select them and click **Plan walk** to give them a walk, or **Draw route** to click their walk yourself.
8. **Dress the track:** use **Ground** (key **3**) to paint the ground and **Scenery** (key **4**) to add banners, hay bales, stands and so on.
9. **Check it:** read the **Checks** list on the left. Red lines are errors that stop the track racing; yellow lines are warnings to look at.
10. Click **Ready to race**. The editor runs the game's own checks. If something is wrong, it says "Not ready yet" and names the problem.
11. Click **Save** (or press **Ctrl+S**). The first time, it asks you to **name the track**. The name becomes the file name. For example, "Practice Oval" is saved as `public/mods/tracks/practice-oval.track.json`.

**What you should see after saving:** the status line says `Saved public/mods/tracks/practice-oval.track.json`, the Route box says **Race-ready**, and the track list shows your track with its file name under it.

![A new track made in the editor: a closed route, a start straight, a finish line, a tabletop and a berm](screenshots/guides/track-editor-practice-oval.jpg)

*A simple track built with the steps above: a rectangle with a start straight (bottom), finish line (top left), tabletop jump and a berm. The Route box says Race-ready.*

### 6.4 Jumps, doubles, tabletops and other features

Features are placed **on top of** the route. In **Layout** mode, the **Features** box lists the 16 types the game knows:

| Corners | Jumps | Rough ground | Hills |
| --- | --- | --- | --- |
| Flat corner, Berm, Rutted corner, Hairpin, Fast sweeper | Tabletop, Double, Step-up, Rhythm section | Whoops, Braking bumps, Sand, Mud low point | Uphill, Downhill |

1. Click a feature type, such as **Tabletop**.
2. Move the pointer onto the route. A band shows where it would go. **,** and **.** make it shorter or longer (2 to 60 grid units).
3. Click to place it.
4. Afterwards, drag it along the route, drag its **white diamonds** to stretch it, or press **Del** to remove it. Its line and jump height are under **Sections**.

Good to know:

- A feature rides as its type **whatever shape you draw**. A Hairpin on a gentle bend still rides as a Hairpin.
- Between features, the route rides as plain track. Corners are **not** worked out from the shape: if you want a berm, place a Berm.
- Two features that overlap are allowed, with a warning.
- The **first corner** is not a feature: it is worked out from where the start straight joins the route.
- You **cannot** make new feature types without a programmer. They come from `public/data/racing.json`, which the editor only reads.

### 6.5 Draft or race-ready?

The **Route** box at the top of Layout mode shows the track's state:

| State | What it means | Can you save it? | Will the game race it? |
| --- | --- | --- | --- |
| **Draft** | Unfinished | Yes | No |
| **Draft with warnings** | Unfinished, with things to look at in Checks | Yes | No |
| **Ready for validation** | The route is closed, it has a start straight and a finish line, and the checks pass | Yes | Not yet: click **Ready to race** |
| **Race-ready** | It has passed **Ready to race** | Yes | Yes |

A track goes back to being a draft if you open its route, remove its finish line, or move part of it outside the track area.

> ⚠️ A draft saved into `public/mods/tracks/` still shows in the game's Mod Track list, greyed out, with the reason it can't be raced. It also makes `npm test` fail ("holds only track files the game can race"). Keep drafts somewhere else, or finish them, before running the tests.

### 6.6 What makes a track fail

The game refuses a track that:

- is marked as an unfinished draft;
- is marked **Practice only**;
- has no start straight, or a start straight that is shorter than 12 grid units, doesn't end on the lap, meets the lap at more than 75°, or runs into the lap before it joins;
- uses a section, ground, surface or scenery that the game does not know (for example one added to someone else's `trackParts.json`);
- has scenery standing on the racing surface (only the **Start gate** and **Finish arch** are built to go over the track);
- has a cheering fan on the track, where they stand or where their walk ends;
- has a start board official standing or ending their walk on the track, walking through the riders lined up at the gate, or walking more than 8 grid units;
- has ground steeper than 45°, or goes more than 36 metres up or down.

> ⚠️ **Keep the race view working when you click Ready to race.** The checks on the start board official are done by the race view. If the editor is showing the plain 2D map instead (because it could not reach the game), **Ready to race** cannot check the official, and a track with the official in a bad spot can pass in the editor but be refused by the game. This happened during testing for this guide.

### 6.7 Testing the track in the game

**Quick test (with `npm run dev`):**

1. Save the track.
2. Click **Race it in the game** above the race view. A new tab opens a race day on your track straight away, with a new test rider. (If you have unsaved changes, it asks first, because the game races the saved file.)

**Full test, as a player:**

1. Reload the game page.
2. Play a career until you can travel on the venue road, and choose **Mod Track**.
3. Your track is listed by its name, with its file name under it. Pick it, then **Race day**.

![A race starting on the new track](screenshots/guides/game-practice-oval-race.jpg)

*The new track in a real race: 16 riders lined up at the start gate.*

### 6.8 Moving tracks between the editor and the game

| You want to… | Do this |
| --- | --- |
| Put a track in **your own** copy of the game | Save it from the track editor (it goes into `public/mods/tracks/`), or copy a `.track.json` file into `public/mods/tracks/` yourself. With `npm run dev`, the game picks it up on its next page load. |
| Put a track in a **built** copy of the game | After copying it into `public/mods/tracks/`, run `npm run build`. The build writes the list of tracks (`index.json`), because a website can't list a folder by itself. |
| Race a track on **any** copy, including the published site or a phone | In the game: **Mod Track** → **Import track file**, and pick the `.track.json`. It is kept **in that browser only**. To take it out again, pick it and choose **Remove it**. |
| Share a track | In the track editor, select it and click **Export**. This downloads `<id>.track.json`. Send that file. |
| Carry on editing a track someone sent you | In the track editor, click **Import…** and pick the file. It becomes a new mod track; Save asks for its name. |

**Rules for sharing:** another player's game checks your track exactly like its own. Use only the game's own ground, surfaces and scenery (not ones you added to `trackParts.json`), and make sure the track is **Race-ready** before you export it.

**Giving a track its own place in the career** (a venue with its own map and race office, like Farmland MX) needs developer work in `public/data/tracks.json` and a map, so it is not covered here.

---

## 7. Example files you can copy

**Never change or overwrite the originals.** Copy them first, and change the copy.

### 7.1 A finished track made by the editor: `docs/examples/practice-oval.track.json`

- **What it is:** the "Practice Oval" built with the steps in section 6.3 while writing this guide. It is a rectangle with a start straight, a finish line, a **Tabletop** and a **Berm**, and a start board official with a planned walk.
- **Why it works:** it was made entirely by the track editor, marked **Ready to race** with the race view running, saved, passed the game's own mod track test, and was raced in the game.
- **How to use it:** in the track editor, click **Import…** and pick this file. Change it as you like and Save it under a new name.
- **What you can change:** everything, in the editor.
- **What must stay:** the first lines `"format": "mxrpg-track"` and `"version": 1`. Don't edit the file by hand; let the editor do it.
- It lives in `docs/`, not in `public/mods/tracks/`, so it is **not** part of the game until you import or copy it.

### 7.2 The game's own example track: `public/mods/tracks/first-try-mx.track.json`

- **What it is:** a small track shipped as a mod track, called "First Try MX (example mod)". It has a start straight, jumps, a mud and a sand stretch, hills and 40 scenery items.
- **Why it works:** the game's tests check that every file in this folder can be raced.
- **How to use it:** in the track editor, select it and click **Duplicate**. The copy is a new mod track; Save asks for its name. Do not save over the original.

### 7.3 A plain grass tile: `public/assets/art/area-map/tiled/tiles/terrain-common/grass-plain-1.png`

- **What it is:** a 64 × 64 RGBA PNG of plain grass, used all over the outdoor maps and as the race view's **Grass** ground.
- **How to use it:** copy it into your own folder, rename the copy, and paint over it. It is the right size and type already.
- **What must stay:** 64 × 64 pixels, PNG, no see-through pixels.

### 7.4 A tall prop: `public/assets/art/area-map/tiled/tiles/town-props/noticeboard.png`

- **What it is:** a 64 × 128 PNG prop (one square wide, two tall), see-through round the outside.
- **How to use it:** copy it as a starting point for a one-square-wide object that stands taller than the player.
- **What must stay:** the bottom of the object at the bottom of the picture.

### 7.5 A person: `public/assets/art/characters/npcs/npc-01-garage-mechanic.png` and `.act.png`

- **What it is:** Paul Phoenix's walk sheet (384 × 256) and action sheet (192 × 256), the mechanic at Phoenix MX; `tools/art/phoenix-mx.py` drew him and the garage's sign from the earlier mechanic and sign.
- **How to use it:** look at it to see the frame layout before redrawing someone (section 5.7).

### 7.6 A ground and a scenery entry: `public/data/trackParts.json`

- The `"ground"` and `"scenery"` lists in this file are the working examples for sections 5.4 to 5.6. For example, the **Tree** scenery uses `"art": "town-props/tree"`, and the **Dirt** ground uses `"art": "terrain-common/dirt-1"`.

---

## 8. Troubleshooting

### My new picture does not appear in the map editor's palette

Likely causes and fixes:

1. **Wrong ending.** The file must end in lower-case `.png`. Rename `Tile.PNG` to `tile.png`.
2. **Wrong folder.** It must be inside `public/assets/art/` (but not in `art/characters/` or `art/buildings/sheets/`, which the palette skips).
3. **The editor was opened before you added the file.** Click **Open folder…** again and pick the folder again.
4. **You loaded the maps from the server.** "Load the … game maps from this server" only lists pictures that a map already uses. Use **Open folder…** instead.
5. **You are looking in the wrong group.** Pick **All tiles** in the Palette list, or type part of the name in **Search tiles by name…**.

### The editor can't find my files ("No maps found")

You picked the wrong folder. Pick the game folder, its `public` folder, or `public/assets`. For the track editor, pick the game folder, `public` or `public/data` ("No tracks.json found" means the same thing).

### My tile looks stretched, cut off or in the wrong place

- Ground tiles must be exactly **64 × 64**. A taller tile sticks up out of its square; a wider one spills into the next square.
- In the race view, ground pictures are stretched to fit a square. A picture that is not square looks squashed.
- The palette shows a size such as `64×128` on any picture that is not 64 × 64. Check it.

### A see-through tile shows black holes in the game

Ground tiles are drawn on a black background. Fill every pixel, or put your see-through picture on the **Ground detail** layer above a filled ground tile.

### My new picture shows in the editor but not in the game

1. **Reload the game page.** The game keeps a copy of each map's ground while it is open.
2. **The map was not saved.** Look for "● unsaved" at the top of the map editor, and click **Save**.
3. **The saved file went to your Downloads folder.** In browsers other than Chrome and Edge (or if you opened the folder a certain way), Save downloads the file instead, and the button says **Save (download)**. Copy the downloaded file over the one named in the status line, such as `public/assets/maps/venue-motocross.json`.
4. **You edited the Tiled source map (`.tmj`) instead of the game map.** Tiled maps only reach the game after `npm run import-art` (read the warning in 5.9 first).

### My track does not appear under Mod Track

1. It is not in `public/mods/tracks/`. Check the status line when you saved: it names where the file went. If it says "Downloaded", move the file into `public/mods/tracks/` yourself.
2. The game page was not reloaded after saving.
3. You are playing a **built** copy and did not run `npm run build` after adding the track.
4. The file does not end in `.json`.

### My track is in the list but greyed out, or says "Can't be raced"

Pick it to see the reasons. Common ones:

| Message | What to do |
| --- | --- |
| `the track is unfinished: mark it Ready to race in the track editor first` | Open it in the editor, click **Ready to race**, then **Save**. |
| `no start straight…` | Add a start straight (section 6.3, step 4). |
| `the start straight is … grid units long; it needs at least 12…` | Make it longer with **.** while placing it, or drag its points. |
| `the start straight meets the lap at …°` | Turn it with **Q**/**E** so it joins at 75° or less, heading the way the lap runs. |
| `the start official's route ends on the track…` | Select the official and move them clear of the track, then **Plan walk**. Make sure the race view is showing when you click **Ready to race**. |
| `no ground "…"` / `no scenery "…"` / `no surface "…"` | The track uses a part this copy of the game doesn't have. Replace it with one of the game's own parts. |
| `it is a practice-only track, so it has no race start` | Untick **Practice only** under Track. |
| `this is not a track file: export one from the track editor` | The file isn't a track. Export it again from the editor. |
| `the file is not valid JSON` | The file was damaged or edited by hand. Export it again. |

### Ready to race says "Not ready yet"

Read the message and the **Checks** list. Click a check to jump to the problem. The most common causes: the route is still open (click its first point, or **Close the route**), the start straight or finish line is missing, a scenery item stands on the track, or part of the route is outside the dashed track area.

### The game refuses to start: "The game data has problems and cannot start"

A data file such as `public/data/trackParts.json` has a mistake. The screen names the file and the field. Common causes:

- a missing or extra comma between lines;
- an `id` with capital letters or spaces;
- two entries with the same `id` ("is used twice");
- a `color` that isn't `#` followed by hex digits.

Undo your change, or fix the line it names, and reload. `npm test` shows the same message.

### `npm test` fails with "Home Town changed"

You saved the Home Town map. It is protected by a test, so any change to it fails. Undo the change (for example, put back the original `public/assets/maps/area1-home-town.json`). Only the developer should change Home Town.

### `npm test` fails with "holds only track files the game can race"

A file in `public/mods/tracks/` is a draft or fails the checks. Finish it in the editor, or move it out of that folder.

### My track works in the editor but not in the race

- **Race it in the game** races the **saved** file. Save first.
- If you opened the editor by double-clicking it, its race view runs the **published** game, which may be different from your copy. Use `npm run dev` and <http://localhost:5173/tools/track-editor.html> instead.
- The official's checks need the race view. If the editor was showing the plain 2D map when you clicked Ready to race, re-open it with the race view showing and click **Check**.

### My new scenery is a plain box in the race

That is expected. See section 5.6: the 3D shape of each scenery item is made by the game's code, and a new item needs a programmer to give it one.

### My 3D model, sound or video will not load

The game has no way to load these from files. See the table in section 3.

### The race view says it can't reach the game, or shows a plain 2D map

Opened from your computer's files, the track editor needs an internet connection to run the race view. Use `npm run dev` instead (section 6.2), or check your connection.

---

## 9. Things that could not be checked

- **Size limits for picture files and number of tiles:** no limit was found in the project, so none is given. Very large pictures may still be slow.
- **Lap length and number of features or scenery items:** no limit was found. Very long or busy tracks may be slow in the race view.
- **The Tiled app's own menus:** this guide does not describe the separate Tiled program, because it is not part of the game and could not be run here.
- **The art folder:** it lives outside the game folder, in the project's shared files. It was checked on 27 October 2026 and was out of step with the game (section 5.9). The developer should bring it up to date before anyone uses `npm run import-art` again.
- **Opening the editors in Safari or Firefox:** the editors were tested in Chromium (the engine Chrome and Edge are built on). Saving in other browsers downloads the file, as the editors say, but other browsers were not tested.
