# Map Editor Tile Guide

This guide teaches you how the tiles in **Motocross RPG** work, how to make your own, and how to paint them onto a map with the game's **map editor**. You do not need to know how to program.

Everything here was checked against the game and its map editor as they are today (Alpha v1, game version 0.3.0, October 2026). Where something could not be checked, the guide says so.

For other kinds of content (tracks, track parts, people, buildings), see the companion guide, **[ADDING_ASSETS_AND_TRACKS.md](ADDING_ASSETS_AND_TRACKS.md)**.

---

## Contents

1. [Words you will see in this guide](#1-words-you-will-see-in-this-guide)
2. [How the tile system works](#2-how-the-tile-system-works)
3. [Tile rules: the exact sizes and formats](#3-tile-rules-the-exact-sizes-and-formats)
4. [The kinds of tiles in the game](#4-the-kinds-of-tiles-in-the-game)
5. [Making tiles that join up without seams](#5-making-tiles-that-join-up-without-seams)
6. [Making a tile and getting it into the editor](#6-making-a-tile-and-getting-it-into-the-editor)
7. [Painting with the map editor](#7-painting-with-the-map-editor)
8. [Example tiles you can copy](#8-example-tiles-you-can-copy)
9. [Common mistakes and limits](#9-common-mistakes-and-limits)
10. [Practice exercise: your first tile from start to finish](#10-practice-exercise-your-first-tile-from-start-to-finish)
11. [Things that could not be checked](#11-things-that-could-not-be-checked)

---

## 1. Words you will see in this guide

| Word | What it means |
| --- | --- |
| **Tile** | A small square picture, **64 × 64 pixels** in this game. Maps are made of tiles laid side by side in rows, like a floor made of square slabs. |
| **Pixel** | One tiny coloured dot in a picture. |
| **PNG** | A type of picture file whose name ends in `.png`. It can have see-through parts. Every tile in the game is a PNG. |
| **Transparent** | See-through. A transparent pixel shows whatever is underneath it. |
| **Map** | One place you can walk round in the game, such as Home Town, Farmland MX or the inside of the bike shop. |
| **Cell** or **square** | One space on the map's grid. Each cell is 64 × 64 pixels and holds one tile per layer. |
| **Layer** | Maps are made of layers stacked on top of each other, like sheets of see-through plastic. The ground is on the bottom layer; details, objects and the collision map sit above it. |
| **Prop** | A picture that stands on the map, such as a lamp post, a bin or a tree. A prop can be bigger than one cell. |
| **Collision** | Which cells the player cannot walk through. It is a separate layer, painted in red in the editor. |
| **Palette** | The list of tiles on the right of the map editor that you can pick from. |
| **Brush** | The tile you are painting with. |
| **Seam** | A visible line where two tiles meet, because their edges don't match. |
| **Autotile** or **corner set** | A set of tiles drawn so that two kinds of ground (such as grass and dirt) blend into each other smoothly, whatever shape the border makes. |
| **Atlas** or **sheet** | One big picture holding many smaller pictures in a grid. |
| **Folder path** | Where a file lives, written with slashes. `public/assets/maps/` means: the `public` folder, then `assets` inside it, then `maps` inside that. |
| **Repo** | The folder that holds the whole game, called `the-motocross-rpg`. |
| **Tiled** | A free map-making program that the art team uses for the "source" copies of the maps. You don't need it for this guide. |

---

## 2. How the tile system works

### 2.1 The big picture

- Every map in the game is a grid of **64 × 64 pixel cells**. Farmland MX, for example, is 30 cells wide and 22 cells tall.
- Each tile is **its own PNG file**. The game does not cut tiles out of big atlas sheets. (Only buildings and people use sheets.)
- The maps the game loads are in **`public/assets/maps/`**, one file per map, such as `venue-motocross.json`.
- The tile pictures the game loads are in **`public/assets/art/`**. Outdoor tiles are in folders under `public/assets/art/area-map/tiled/tiles/`, and indoor tiles under `public/assets/art/buildings/tiled/tiles/`.
- A map file doesn't contain pictures. It contains a **list of picture paths** (such as `art/area-map/tiled/tiles/terrain-common/grass-plain-1.png`) and, for every cell, **which picture from the list goes there**.

### 2.2 Two copies of every map

The project keeps two copies of each map. It's worth knowing which is which, because only one of them is what the game shows.

| | Game maps | Tiled source maps |
| --- | --- | --- |
| Where | `public/assets/maps/*.json`, inside the game folder | The project's shared **art folder** (outside the game folder), for example `art/area-map/tiled/maps/venue-motocross.tmj` |
| What reads them | The game, directly | The art import tool, `npm run import-art`, which turns them into game maps |
| Edit them with | The map editor | The map editor, or the Tiled program |
| Shows in the game | **Straight away** (after saving and reloading the page) | Only after someone runs `npm run import-art` |

> ⚠️ **Edit the game maps for now.** On 27 October 2026, the art folder was checked and found to be **out of date**: the game maps have been changed since the last import. Running `npm run import-art` today would throw those changes away (in a test it removed an interior map, renamed two venues and removed some tiles). This guide only uses the game maps, so you never need the import tool. Leave it to the developer.
>
> The map editor's own Help says to edit the Tiled source for changes that should last. That is the long-term plan, but it is only safe once the art folder has been brought up to date.

### 2.3 Layers

When you open a map in the editor, its layers are listed on the left under **Layers**. Outdoor maps have:

| Layer | What goes on it | Drawn |
| --- | --- | --- |
| **Ground** | The ground: grass, dirt, roads, water. Every cell should have one. | At the bottom |
| **Ground detail** | Things lying on the ground: flowers, oil stains, road markings, parking lines | On top of Ground |
| **Objects** | Props the player can walk in front of and behind: lamp posts, bins, fences | Sorted with the player, by how far down the map they stand |
| **Overhead** | Things always drawn above the player, such as tree tops | On top of everything |
| **Collision** | Which cells are blocked (shown in red) | Not drawn in the game |
| **Data** | Doors, spawn points (where the player appears), exits and triggers | Not drawn in the game |
| **Partitions** | Thin walls between cells (view only) | Not drawn in the game |
| **Grid** | The grid lines (view only) | Not drawn in the game |

Indoor maps have **Room** (floor and walls) instead of Ground, and **Furniture** instead of Objects.

Each layer has an eye (👁) to hide it and a slider to make it see-through while you work. Neither changes the saved map.

**Important:** pictures never block the player by themselves. Only the **Collision** layer does.

### 2.4 How the game draws a tile

This decides what happens if a tile isn't exactly 64 × 64:

- A ground tile is drawn with its **bottom-left corner** at the bottom-left corner of its cell, at its real size.
- A taller tile sticks **up** into the cell above. A wider tile spills **right** into the next cell.
- Under the ground there is black, so a see-through pixel in a ground tile shows as black.
- The game remembers each map's ground while the page is open. After you change a map, **reload the game page** to see the change.

---

## 3. Tile rules: the exact sizes and formats

Each value has a label:

- **Required**: the game or editor will not work properly without it.
- **Maximum**: the game or editor checks this and refuses anything bigger.
- **Recommended**: a sensible choice that matches the existing art. Nothing stops you doing otherwise.
- **Not yet confirmed**: this could not be established from the project.

| Question | Answer | Label |
| --- | --- | --- |
| **Tile size** | **64 × 64 pixels** | **Required** for ground tiles. The map editor refuses to open a Tiled map with any other tile size ("tiles are …, expected 64"), and so does the art import tool ("tiles must be 64 px"). |
| **File type** | PNG, with the name ending in lower-case **`.png`** | **Required**: the editor only lists files ending in `.png`. `.PNG`, `.jpg`, `.gif` and `.webp` files do not appear. |
| **Colour format** | RGBA, 8 bits per channel (32-bit PNG with a see-through channel) | **Recommended**: every tile in the game is saved this way. |
| **Transparency in ground tiles** | None: fill every pixel | **Recommended**: see-through pixels show black in the game. |
| **Transparency in Ground detail tiles and props** | See-through round the outside | **Required** for them to look right, because they sit on top of something else. |
| **Edges against transparency** | Hard (each pixel fully see-through or fully solid) | **Recommended** by the project's art style. The only half see-through colour allowed is a soft drop shadow (about 30%) under objects. |
| **Outlines** | Ground tiles: none. Objects: dark near-black outline (colour `#27292c` or close), 1 to 2 pixels | **Recommended** by the art style |
| **Light** | Soft, from the top left | **Recommended** by the art style |
| **Colours** | The project's 120-colour reference palette (in the shared art folder at `art/palette/`) | **Recommended** for official art; mod art is not limited to it |
| **Prop sizes** | Whole multiples of 64, such as 64 × 128 (a lamp post) or 128 × 64 (a fence section) | **Recommended**. Not enforced. |
| **Naming** | Lower-case letters, numbers and hyphens, such as `dry-grass-1.png` | **Recommended**: matches the outdoor tiles (indoor furniture uses underscores, such as `bench_blue+shadow.png`). Avoid spaces and capital letters: names are **case-sensitive** on the published website. |
| **Numbered variations** | Same name with `-1`, `-2`, `-3`… on the end, such as `grass-plain-1.png` to `grass-plain-6.png` | **Recommended** (this is how the game's tiles do it). The editor treats each one as a separate tile; nothing picks between them at random. |
| **Folders** | Your own new folder inside `public/assets/art/area-map/tiled/tiles/` (outdoor) or `public/assets/art/buildings/tiled/tiles/` (indoor) | **Recommended**. Any folder inside `public/assets/art/` works, **except** `art/characters/` and `art/buildings/sheets/`, which the palette skips. The folder's name becomes the palette group's name. |
| **Separate files or an atlas?** | **Separate files**, one PNG per tile | **Required**. The editor's palette and the game only use single-tile files. |
| **Animated ground tiles** | Not possible | **Hard limit**: a ground cell holds one still picture. |
| **Animated props** | Possible only through the Tiled source maps (an animation set on the tile in Tiled's tileset) | Set up by the art team; the map editor can't make new ones |
| **File size on disk** | No limit found. The game's tiles are about 5 to 10 KB each | **Not yet confirmed** |
| **Number of tiles** | No limit found. The game already uses over 1,000 pictures | **Not yet confirmed** |
| **Map size** | No limit found; the biggest map, Home Town, is 60 × 45 cells | **Not yet confirmed** |

---

## 4. The kinds of tiles in the game

These are the folders of tiles the game uses today, in `public/assets/art/`:

| Folder (palette group) | What's in it | Layer to use |
| --- | --- | --- |
| `area-map/tiled/tiles/terrain-common` | Plain grass (6), grass with flowers (4), dirt (2), road (3), concrete slabs and verge, path verges, door aprons, and the **grass-to-dirt corner set** | Ground, Ground detail |
| `area-map/tiled/tiles/ground-edges` | Gravel, long grass, and corner sets for grass with concrete, pavement, gravel and long grass; parking lines, hazard stripe, oil stain | Ground, Ground detail |
| `area-map/tiled/tiles/water-and-roads` | Water (3), the **grass-to-water corner set**, road markings, road patch and trench | Ground, Ground detail |
| `area-map/tiled/tiles/roads` | Kerbs and pavements round roads (`street-…` tiles) | Ground |
| `area-map/tiled/tiles/roadworks` | Roadworks barrier, signs, sandbags, traffic cone | Objects |
| `area-map/tiled/tiles/stamps` | Pieces of bigger pictures cut into cells, such as the backyard practice loop (`backyard-loop-<row>-<column>.png`) | Ground |
| `area-map/tiled/tiles/town-props` | Lamp post, bins, fences, hedges, trees, bench, noticeboard, signs | Objects, Overhead |
| `area-map/tiled/tiles/industrial-props` | Crates, pallets, containers, skips, palisade fences | Objects |
| `area-map/tiled/tiles/venue-frontage` | Venue entrance pieces: rail fences, track banners, chequered flags, floodlight, track hut | Objects |
| `buildings/tiled/tiles/interior-rooms` | Floors and walls for indoor maps | Room |
| `buildings/tiled/tiles/interior-furniture` | Benches, beds, counters, racks, workshop machines | Furniture |
| `buildings/tiled/tiles/interior-exits` | Pieces of room pictures used round the exits | Room |

Only the tiles that a map actually uses are in the game folder. The full sets (including spare tiles no map uses yet) are in the shared art folder.

### 4.1 Corner sets (autotiles)

Where two kinds of ground meet, such as grass and dirt, the game uses a **corner set** of 14 tiles named `<first>-<second>-01.png` to `-14.png`, for example `grass-dirt-01.png`.

Think of each tile's four corners: top left (NW), top right (NE), bottom left (SW) and bottom right (SE). In each corner the ground is either the first kind (grass) or the second (dirt). The number in the name says which corners are the second kind. Add up the numbers for each corner that is dirt:

| Corner | Top left (NW) | Top right (NE) | Bottom left (SW) | Bottom right (SE) |
| --- | --- | --- | --- | --- |
| Number | 8 | 4 | 2 | 1 |

Examples:

- `grass-dirt-01`: only the bottom right is dirt (1).
- `grass-dirt-03`: the bottom half is dirt (2 + 1).
- `grass-dirt-05`: the right half is dirt (4 + 1).
- `grass-dirt-12`: the top half is dirt (8 + 4).
- `grass-dirt-14`: everything except the bottom right is dirt (8 + 4 + 2).
- **00** (all grass) and **15** (all dirt) aren't in the set: use a plain grass or dirt tile instead.

![The 14 tiles of the grass-to-dirt corner set, numbered 01 to 14](screenshots/guides/tile-corner-set-grass-dirt.png)

*The grass-to-dirt corner set from the shared art folder. Tile 01 has dirt in the bottom-right corner; tile 03 has the bottom half dirt; tile 05 has the right half dirt.*

The map editor **does not pick corner tiles for you**. You choose each one yourself. (The Tiled program can do it automatically with these sets, using the art folder's `area-ground.tsj`.)

### 4.2 Road surrounds

The `street-XXXXXXXX.png` tiles in `roads` are the kerb, pavement and verge that go **round** a road. The road itself is the plain `road-1`, `road-2` or `road-3` tiles. Each of the 8 digits stands for one neighbouring cell, in the order **N, NE, E, SE, S, SW, W, NW** (north is up). A `1` means that neighbour is road. For example, `street-00001000` is for a cell with road directly below it (S).

---

## 5. Making tiles that join up without seams

A **seam** is a line you can see where two tiles meet. Here is how to avoid one.

### 5.1 Plain fill tiles (one kind of ground)

A fill tile, such as plain grass, sits next to copies of itself and next to its numbered variations.

1. **Make the edges wrap round.** Whatever touches the left edge must carry on naturally from the right edge, and the same for top and bottom. Most drawing programs have an "offset" or "wrap" filter that moves the picture by half its size (32 pixels) so the edges land in the middle, where you can see and fix them.
2. **Keep the same average colour** in every variation, so a patch of mixed variations doesn't look patchy.
3. **Don't put a big, eye-catching detail** (like one bright flower) in a fill tile, or the repeat becomes obvious. Put details on the **Ground detail** layer instead, as the game does with its flowers.
4. **Test it:** paint a 4 × 4 block with your tile and a block mixing it with its variations. Zoom out (**−**) and look for lines or repeating patterns.

### 5.2 Corner sets (two kinds of ground meeting)

1. **Start from the two fill tiles** (for example `grass-plain-1` and `dirt-1`), so the inside of each corner matches the plain ground exactly.
2. **Cross each edge at the same place.** In the game's sets, the border between the two kinds of ground crosses a tile's edge **at its middle (around pixel 32)**. If every tile in the set does the same, any two tiles that should join will join. Look at `grass-dirt-03` and `grass-dirt-05` to see this.
3. **Corners of the cell are all one kind.** A cell's corner is shared with three other cells, so each corner pixel area must be fully the first or fully the second kind of ground, as its number says.
4. **Draw the border the same way in every tile**: the same outline colour and the same width of rough edge.
5. **Make all 14**, numbered as in section 4.1, so every shape of border can be built.
6. **Test it:** paint a small blob of the second ground on the first and fill in the corner tiles round it, choosing each one by its number.

### 5.3 Props bigger than one cell

1. Make the picture a whole number of cells: 64 × 128 for one cell wide and two tall.
2. Stand the object on the **bottom edge** of the picture, in the middle. The editor lines the bottom of the picture up with the bottom of the cell it's placed on.
3. Leave the rest see-through.

---

## 6. Making a tile and getting it into the editor

### 6.1 What you need

- A drawing program that saves PNG with transparency. Free choices include **GIMP**, **Krita**, **LibreSprite** or **Piskel** (a website). Paid: **Aseprite**. Even Windows Paint saves PNG, but it can't make see-through pixels.
- **Chrome** or **Edge**, so the map editor can save straight into the game folder.
- The game folder. If you want to see your tile in the game afterwards, you also need **Node.js** installed and `npm install` run once in the game folder (the companion guide's section 2 explains how).

### 6.2 Step by step

1. **Copy an existing tile** to start from, so the size and format are right. For example, copy `public/assets/art/area-map/tiled/tiles/terrain-common/grass-plain-1.png`. **Never draw over the original.**
2. **Make your own folder** for your tiles: `public/assets/art/area-map/tiled/tiles/my-tiles/`.
3. **Put the copy in your folder and rename it**, for example `my-tiles/dry-grass-1.png` (lower case, hyphens, ending in `.png`).
4. **Open the copy in your drawing program** and change it. Keep it 64 × 64.
5. **Save it as PNG** (in GIMP: *File → Export As*, then choose PNG). If the program asks, keep the transparency ("alpha") channel.
6. **Open the map editor**: double-click `tools/map-editor.html` in the game folder so it opens in Chrome or Edge.
   - Or, if the game is running with `npm run dev`, go to <http://localhost:5173/tools/map-editor.html>.

   ![The map editor's welcome card: "Open your map files"](screenshots/guides/map-editor-welcome.jpg)

7. Click **Open folder…** and choose the **`public`** folder inside the game folder. (Choosing `public/assets` or the whole game folder works too, but only `public` or the whole game folder let the **Buildings** box find its list of buildings.) The browser asks for permission to see the folder; allow it, and allow it to **save changes** too.

   **What you should see:** the map list at the top fills in, such as `area1-home-town`, and a map opens.

8. **Pick a map** from the list at the top.
9. **Find your tile:** on the right, under **Palette**, open the list and pick **`my-tiles`**. Your tile appears. (Or pick **All tiles** and type `dry` in **Search tiles by name…**.)

There is **nothing to register**. The editor lists every PNG in the folder you opened, as soon as you open it.

> **If you opened the editor with "Load the … game maps from this server"** (a button that appears when the editor runs through `npm run dev`), the palette only shows tiles that a map already uses, so a new tile won't be there. Use **Open folder…** instead.

### 6.3 Adding a tile to the Tiled source maps (only if the developer asks)

This is for when the art folder is back in step with the game (see section 2.2). It needs a text editor and care.

1. Put the PNG in the art folder, for example `art/area-map/tiled/tiles/my-tiles/dry-grass-1.png`.
2. Open `art/area-map/tiled/area-ground.tsj` in a text editor. It has a list called `"tiles"`. Each entry looks like this:

   ```json
   {"id": 480, "image": "tiles/my-tiles/dry-grass-1.png", "imagewidth": 64, "imageheight": 64,
    "properties": [{"name": "name", "type": "string", "value": "dry-grass-1"}]}
   ```

3. Add an entry with an **`id` no other tile uses and below 1000**. (On 27 October 2026 the highest id in use was 473.) Ids 1000 and up belong to the props tileset, so a ground tile with an id of 1000 or more would clash.
4. Open the art folder in the map editor (**Open folder…**, pick the `art` folder). The tile appears in the palette as **`area-ground / my-tiles`**.
5. Paint it on a `.tmj` map and save. It reaches the game the next time the developer runs `npm run import-art`.

Note: `area-ground.tsj` is made by the art team's tool `art/area-map/tools/tiled_sets.py`. Running that tool again writes a fresh file, so hand-made additions like yours would be lost. Tell the art team about your tile.

---

## 7. Painting with the map editor

### 7.1 The screen

- **Top bar:** **Open folder…**, the map list, **Save**, **Download**, **↶ Undo**, **↷ Redo**, zoom **−** / **+** / **Fit**, and **Help**. "● unsaved" appears when you have changes that are not saved yet.
- **Left:** **Tools**, **Buildings**, **Layers**, **Selection**, **Replace tiles** and **Checks**.
- **Middle:** the map.
- **Right:** the **Brush** (the tile you are painting with) and the **Palette**.
- **Bottom:** the cell under the pointer, the active layer and messages.

![The map editor with a new tile painted on Farmland MX](screenshots/guides/map-editor-new-tile-painted.jpg)

*The map editor with Farmland MX open, the Ground layer active, and the `my-tiles` palette group showing a new tile.*

### 7.2 Tools

| Tool | Key | What it does |
| --- | --- | --- |
| **Brush** | **B** | Click or drag to paint the brush tile on the active layer. **Shift**+drag paints a rectangle. Hold **Alt** and click to pick up the tile under the pointer. |
| **Eraser** | **E** | Click or drag to clear cells. **Shift**+drag clears a rectangle. On the Collision layer it unblocks cells. |
| **Picker** | **I** | Click a tile on the map to make it the brush. **Drag** over several cells to copy them all as a **stamp**, then paint the stamp with the Brush. |
| **Fill** | **F** | Click a cell to fill every connected cell that has the same tile. If there's a selection, it stays inside it. |
| **Select** | **M** | Drag a box to select. Drag inside the box to move what's in it; **Alt**+drag to move a copy. |
| **Objects** | **V** | Click a prop or a Data marker to select it, drag to move it (snaps to cells; hold **Alt** for single pixels), **Del** deletes a prop. With a prop picked in the palette, click empty ground to place it. |
| **Pan** | **H** | Drag to move round the map. You can also hold **Space** and drag, or drag with the right or middle mouse button. |

### 7.3 Keyboard shortcuts

| Keys | What they do |
| --- | --- |
| **Ctrl+S** | Save |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** or **Ctrl+Shift+Z** | Redo |
| **Ctrl+C**, **Ctrl+X**, **Ctrl+V** | Copy, cut and paste the selection (after pasting, click to put it down) |
| **Ctrl+A** | Select the whole map |
| **Ctrl+O** | Open folder |
| **Del** | Clear the selection (or delete the selected prop) |
| **Esc** | Cancel what you are doing |
| **Mouse wheel** | Zoom in or out where the pointer is |
| **+** / **−** | Zoom in / out |
| **0** | Fit the whole map in view |
| **G** | Show or hide the grid |
| **C** | Show or hide the red collision overlay |
| **[** and **]** | Step to the layer above or below |
| **Arrow keys** | Move the view (hold **Shift** to move faster) |

The **Help** button (top right) shows a short version of all of this.

### 7.4 Painting step by step

1. Under **Layers**, click the layer you want to paint on, for example **Ground**. The bottom bar shows the active layer.
2. In the **Palette**, click a tile. It appears under **Brush**.
3. Press **B** for the Brush.
4. Click a cell to paint one tile, or drag to paint a line.
5. To paint a big area, hold **Shift** and drag a rectangle, or use **Fill** (**F**) on an area of the same tile.
6. Made a mistake? Press **Ctrl+Z**.

### 7.5 Erasing

- **E** for the Eraser, then click or drag. **Shift**+drag clears a rectangle.
- Erasing on **Ground** leaves an empty cell, which is **black** in the game. Paint a ground tile there instead.
- Erasing on **Ground detail** is safe: the ground shows through.

### 7.6 Replacing one tile with another

To change every one of a tile into another (for example, all `grass-plain-1` into your `dry-grass-1`):

1. Make the tile layer active (such as **Ground**).
2. Pick the tile to find as the brush, then click **Use brush** under **Find**.
3. Pick the new tile as the brush, then click **Use brush** under **With**.
4. Click **Replace**. **Swap** exchanges the two tiles everywhere instead.

It works on the whole active layer, or only inside the selection if there is one.

### 7.7 Copying, moving and swapping areas

1. Press **M** (Select) and drag a box.
2. Under **Selection**, choose **All layers** (moves tiles, collision, props and markers together) or **Active layer only**.
3. Then:
   - drag inside the box to move it, or **Alt**+drag to move a copy;
   - **Copy** / **Cut** / **Paste** (or **Ctrl+C** / **X** / **V**, then click to put it down);
   - **Clear** empties it;
   - **Fill** fills it with the brush tile;
   - **Swap with…** exchanges it with another area of the same size.

Copies never duplicate Data markers (doors, spawn points), and Clear never deletes them, so you can't break a door by accident this way.

### 7.8 Collision (where the player can walk)

1. Click **Collision** under Layers. Blocked cells are red.
2. **Brush** (**B**) blocks a cell. **Eraser** (**E**) frees it.
3. Press **C** at any time to show or hide the red overlay.

Rule of thumb: block water, walls, fences and the bottom of props the player shouldn't walk through. Leave paths, doors and spawn points free.

### 7.9 Saving and checking

1. Look at **Checks** on the left. It should say **"✓ Every door, spawn, exit and trigger is on a free tile."** If not, it lists what is blocked: free those cells on the Collision layer.
2. Click **Save** (or **Ctrl+S**).
   - In Chrome and Edge, the file is saved straight into `public/assets/maps/`.
   - In other browsers the button says **Save (download)**. The file goes to your Downloads folder, and a message says where to copy it, for example over `public/assets/maps/venue-motocross.json`.
3. In the game folder, run `npm test` to check that doors, spawn points and people still work.
4. Reload the game page.

### 7.10 What you can't do in the map editor

- **Turn or flip tiles.** There is no rotate or flip; draw a separate tile instead.
- **Random variations.** There is no "random brush"; paint each variation yourself.
- **Automatic corner tiles.** Choose each corner tile by its number (section 4.1).
- **Make a prop animated** (section 3).
- **Add a new outdoor map.** The list of outdoor maps is written in the art import tool, so a new one needs the developer.

---

## 8. Example tiles you can copy

Copy these to start from. **Do not change or overwrite the originals.**

| Example | Size | Why it is a good example | What to change | What to keep |
| --- | --- | --- | --- | --- |
| `public/assets/art/area-map/tiled/tiles/terrain-common/grass-plain-1.png` | 64 × 64 | A plain ground fill tile with edges that wrap | The colours and texture | 64 × 64, no see-through pixels, edges that wrap |
| `public/assets/art/area-map/tiled/tiles/terrain-common/dirt-1.png` | 64 × 64 | A second fill tile, also used as the race view's Dirt | Colours and texture | As above |
| `public/assets/art/area-map/tiled/tiles/terrain-common/grass-dirt-03.png` | 64 × 64 | A corner tile: the border crosses the left and right edges at the middle | The look of the border | Where the border meets the edges |
| `public/assets/art/area-map/tiled/tiles/water-and-roads/water-1.png` | 64 × 64 | A fill tile for water, with variations `water-2` and `water-3` | Colours | Size; keep the variations alike so a pond looks even |
| `public/assets/art/area-map/tiled/tiles/town-props/noticeboard.png` | 64 × 128 | A tall prop, one cell wide, standing on the bottom edge, see-through round it | The object | Bottom edge, transparency, width of 64 |
| `public/assets/art/area-map/tiled/tiles/town-props/tree.png` | 128 × 160 | A big prop over several cells | The object | Trunk at the bottom middle |

---

## 9. Common mistakes and limits

**Hard limit** means the game or editor will not allow it. **Recommendation** means it works, but looks or behaves badly.

| Symptom | Cause | Fix | Hard limit or recommendation? |
| --- | --- | --- | --- |
| My tile isn't in the palette | The file ends in `.PNG`, `.jpg` or another type | Save as PNG and name it ending in lower-case `.png` | **Hard limit** |
| My tile isn't in the palette | It's in `art/characters/` or `art/buildings/sheets/`, or outside `public/assets/art/` | Move it to your own folder inside `public/assets/art/area-map/tiled/tiles/` | **Hard limit** |
| My tile isn't in the palette | You added it after opening the folder, or opened the maps "from this server" | Click **Open folder…** and choose the folder again | Hard limit |
| Wrong palette group | The group is named after the folder the file is in | Put it in a folder with the name you want | Recommendation |
| The tile sticks up into the cell above, or spills into the next | It isn't 64 × 64 | Resize to 64 × 64. The palette shows the size (such as `64×128`) on any tile that isn't 64 × 64 | **Hard limit** for ground (the grid is 64); recommendation for props |
| Black spots on the ground in the game | See-through pixels in a ground tile, or an erased Ground cell | Fill every pixel; paint ground in every cell | Recommendation |
| Visible lines between tiles | The edges don't wrap, or corner borders cross the edge at different places | See section 5 | Recommendation |
| The editor says the map's "tiles must be 64 px" | A Tiled map was made with a different tile size | Make the map with 64 × 64 tiles | **Hard limit** |
| The player walks through my prop | Pictures don't block | Paint those cells on the **Collision** layer | Hard limit (by design) |
| The player can't reach a door after my change | A door, spawn point or exit is on a blocked cell | Read **Checks**; free that cell on Collision | **Hard limit**: `npm test` fails |
| My change isn't in the game | Not saved, saved to Downloads, or the game page wasn't reloaded | Save, copy the downloaded file into `public/assets/maps/` if needed, reload the game page | — |
| My change to the Tiled `.tmj` map isn't in the game | Tiled maps only reach the game through `npm run import-art` | Edit the game map (`public/assets/maps/`) instead, for now (section 2.2) | — |
| `npm test` fails: "Home Town changed" | Home Town's map is protected by a test | Undo the change to `public/assets/maps/area1-home-town.json`. Only the developer edits Home Town | **Hard limit** (test) |
| My tile looks right on one computer but missing on the website | File names are case-sensitive on the website (`Grass.png` is not `grass.png`) | Use only lower case | **Hard limit** on the website |
| My tile disappeared after someone ran `npm run import-art` | The import rebuilds `public/assets/art/` and the maps from the art folder | Keep a copy of your tiles outside the game folder; add them to the art folder too (section 6.3) | **Hard limit** |
| Corner tiles join wrongly | The wrong number was picked | Work out the number from the corners (section 4.1) | Recommendation |
| A different-coloured block in a field | A variation has a different average colour | Even out the colours across variations | Recommendation |

### Originals you must not overwrite

- Anything in `public/assets/art/` that the game already uses. Make **copies** in your own folder instead.
- `public/assets/maps/area1-home-town.json` (protected by a test).
- `public/assets/manifest.json` (written by the art import tool).
- Anything in the shared art folder, unless the art team asks you to.

---

## 10. Practice exercise: your first tile from start to finish

In this exercise you make a yellowy "dry grass" tile, paint a patch of it at **Farmland MX**, and see it in the game. This was tested while writing this guide; the screenshots come from that test.

You only change two things, and both can be undone: you add **one new file** in a **new folder**, and you change the **Farmland** map. You don't touch any original tile.

**Before you start:** make a backup copy of `public/assets/maps/venue-motocross.json` somewhere outside the game folder (such as your Desktop). That is the original you will change; with the backup you can always put it back.

### Step 1: Copy a tile

1. In the game folder, go to `public/assets/art/area-map/tiled/tiles/`.
2. Make a new folder there called **`my-tiles`**.
3. Go into `terrain-common`, **copy** `grass-plain-1.png` (copy, don't move), and paste it into `my-tiles`.
4. Rename the copy in `my-tiles` to **`dry-grass-1.png`**.

**What you should have:** `public/assets/art/area-map/tiled/tiles/my-tiles/dry-grass-1.png`, and `terrain-common/grass-plain-1.png` still where it was.

### Step 2: Change it

1. Open `my-tiles/dry-grass-1.png` in your drawing program.
2. Make it look like dry grass. An easy way: use the program's hue or colour-balance tool to turn the green yellowy-brown. (In GIMP: *Colors → Hue-Saturation*.)
3. Check the size is still **64 × 64** (in GIMP: *Image → Canvas Size*).
4. Save it as PNG over `my-tiles/dry-grass-1.png` (in GIMP: *File → Overwrite dry-grass-1.png*, or *Export As*).

### Step 3: Add it to the editor

1. Double-click `tools/map-editor.html` to open it in **Chrome** or **Edge**.
2. Click **Open folder…** and choose the game's **`public`** folder. Allow the browser to see and save to it.
3. In the map list at the top, choose **`venue-motocross`**.
4. On the right, in the **Palette** list, choose **`my-tiles`**.

**What you should see:** your yellow tile in the palette.

### Step 4: Paint it

1. Under **Layers**, click **Ground**.
2. Click your tile in the palette. It shows under **Brush**.
3. Press **B** (Brush).
4. Find an open grassy area. The player arrives at Farmland at the bottom, near the lane in the middle, so somewhere near there is easy to find in the game.
5. Hold **Shift** and drag a rectangle about 3 × 3 cells.
6. Look at **Checks**: it should still say "✓ Every door, spawn, exit and trigger is on a free tile."

![The new dry grass tile painted next to the tree on Farmland](screenshots/guides/map-editor-new-tile-painted.jpg)

### Step 5: Save

1. Click **Save** (or press **Ctrl+S**).

**What you should see:** "● unsaved" disappears, and the message at the bottom says `Saved venue-motocross.json. Run npm test to check doors and spawns.` (or similar). If the button said **Save (download)**, the file went to your Downloads folder: copy `venue-motocross.json` from there over `public/assets/maps/venue-motocross.json`.

### Step 6: Reopen it to check

1. Close the editor tab and open `tools/map-editor.html` again.
2. **Open folder…**, choose `public`, and choose `venue-motocross`.
3. Your patch should still be there. In the Palette list, **Used in this map** now includes `dry-grass-1`.

### Step 7: Run the checks

1. Open a terminal in the game folder.
2. Run `npm test`.

**What you should see:** every test passes. (If "Home Town changed" fails, you saved Home Town by mistake: put that file back.)

### Step 8: See it in the game

1. Run `npm run dev` and open <http://localhost:5173> in your browser (or reload it if it was already open).
2. Load a career that has already reached Farmland MX, or start a new career and follow the **Journal** until it says you can race at Farmland MX (the local racer outside the local garage tells you where it is). Then head west out of Home Town and choose **Farmland MX**.
3. Walk up from where you arrive to your patch.

**What you should see:** your dry grass in the game.

![The new tile in the game at Farmland MX](screenshots/guides/game-new-tile-farmland.jpg)

*The dry grass patch at Farmland MX, in the game.*

### Step 9: Tidy up (optional)

To put everything back as it was:

1. Copy your backup over `public/assets/maps/venue-motocross.json`.
2. Delete the `my-tiles` folder (or keep it for your next tile).

---

## 11. Things that could not be checked

- **The Tiled program's own menus:** only the map editor was tested. The Tiled route in section 6.3 was tested by editing the tileset file by hand and opening it in the map editor, not in Tiled itself.
- **File size and tile count limits:** none were found in the project, so none are given.
- **Map size limits:** none were found. Nothing bigger than Home Town (60 × 45) has been tried.
- **Browsers other than Chrome and Edge:** the editor was tested in Chromium (the engine Chrome and Edge are built on). Other browsers download the map when you save, as the editor says, but were not tested.
- **The shared art folder:** it was checked on 27 October 2026 and was out of step with the game (section 2.2). When the developer brings it up to date, the advice to edit only the game maps can change.
