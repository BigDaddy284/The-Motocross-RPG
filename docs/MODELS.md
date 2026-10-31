# Your own 3D models: rules for each type

The race view draws every object from shapes in code. You can swap any of them, add new scenery, or replace the race bike and rider with your own models from Blender (Boss, 31 Oct 2026). The checks are in `src/core/modModels.ts`. A model that breaks a rule is skipped, and the game draws its own object instead: it never stops the game. The **Models** page lists each file in the folder with what it does or what is wrong with it.

## How it works

1. Open **Models** from the toolkit, or with the **Models…** button in the track editor. With `npm run dev` this is http://localhost:5173/?models.
2. Pick an object and click **Export**. You get a `.glb` file at the object's real size.
3. In Blender, use **File › Import › glTF 2.0**. Change the model, then use **File › Export › glTF 2.0** with **Format: glTF Binary (.glb)**.
4. Save the file into `public/mods/models/` and reload the game. The track editor's palette picks up new items when it loads from the dev server.

The file name decides what the model does:

| File name | What it does |
|---|---|
| the id of a scenery item, e.g. `hay_bale.glb` | replaces that item on every track |
| `race_bike.glb` | replaces the race bike for classes over 85cc, and for youth classes too if there is no youth model |
| `race_bike_youth.glb` | replaces the race bike for 85cc and under |
| `race_rider.glb` | replaces the rider on every race bike |
| any other name, e.g. `round_bale.glb` | a new scenery item called "Round bale" in the track editor's Scenery palette |

## Rules for every model

- **File name:** lower-case letters, digits, `-` and `_`, ending `.glb`. No spaces or capitals. At most 48 characters before `.glb`.
- **File size:** at most 8 MB.
- **Format:** glTF Binary (`.glb`) only. Not `.gltf`, `.blend`, `.fbx` or `.obj`.
- **Units:** metres, so 1 Blender unit is 1 m. The race view scales it for you.
- **Ground:** the lowest point sits on the ground at Blender Z = 0, give or take 5 cm. The rider is the one exception (see below).
- **Facing:** the front faces Blender **−Y** (what you see in Front view, numpad 1). Items such as stands and banners face the track. Bikes point along **+X**.
- **Origin:** the middle of the footprint, at ground level. The item is placed and turned around it.
- **Colours:** materials keep their Base Color and Image Texture. Use simple materials (Principled BSDF). Node effects, lights, cameras and animation are dropped.
- **Pivot:** use Apply › All Transforms before you export. The game reads the node transforms either way, but this keeps Blender and the game agreeing.

## Rules for each type

| Type | Triangles | Size limits | Ground | Notes |
|---|---|---|---|---|
| **Scenery, replacing an item** (`tree.glb`, `van.glb`, `bike_stand.glb`…) | 20,000 | longest side 30 m, height 16 m | on the ground | Drawn at its own size when the item is at its default size. When an item is placed longer or deeper (a long tyre wall or line of tape), the model stretches with it, and its height grows only with the smaller stretch. Start from the exported file so it matches the default footprint. |
| **Scenery, new item** (`round_bale.glb`) | 20,000 | longest side 30 m, height 16 m | on the ground | Its footprint in the editor is the model's length (X) by depth (Y), drawn in grey on the 2D map. Resizing it in the editor stretches it the same way. |
| **Scenery bikes** (`bike_stand`, `bike_trailer`, paddock vans and haulers) | 20,000 | as scenery | on the ground | These are plain scenery: one model, one look. They aren't recoloured by brand or rider. |
| **Race bike** (`race_bike.glb`, `race_bike_youth.glb`) | 6,000 | 1.4 m to 2.6 m long along X, at most 1.6 m tall | wheels on the ground | Points along +X, with the middle of the wheelbase at the origin. Every bike in the race uses it, so keep it light. Name materials **Plastics**, **Frame** and **Plate** to get each rider's brand colours. Other materials keep their own colour. |
| **Race rider** (`race_rider.glb`) | 6,000 | at most 2.4 m long, 2 m tall | boots 0 to 0.6 m up, on the pegs | Sits on the bike in the same space as the exported `race_bike.glb`. Export both and model the rider on the bike. Name materials **Helmet**, **Visor**, **Jersey**, **Pants**, **Boots** and **Gloves** to get each rider's gear colours. The rider leans and moves as one piece. There are no moving arms or legs. |
| **Locked items** | — | — | — | `marshal`, `flagger`, `pit_crew`, `cheer` (fans), `start_official`, `start_gate`, `finish_arch` and `sprint_start` move, wave flags or stretch to fit the track, so they can't be replaced. A file with one of these names is listed as not used. |

Material names ignore case and Blender's `.001` endings, so `plastics.001` counts as Plastics.

## Tips

- **Triangles:** check the count in Blender with Overlays › Statistics. Use a **Decimate** modifier to cut it down. A field has 16 bikes and riders, so every bike triangle counts 16 times over.
- **Grey model in Blender:** an exported game object keeps its colours in its materials. If it looks grey, switch the viewport to Material Preview (Z › Material Preview).
- **Textures:** keep images to 1024 × 1024 or smaller and pack them into the `.glb`. The export does this by default.
- **Seeing it:** the Models page shows each file in your folder turning on a 1 m grid, with its size and triangle count. A rejected file shows the reason in red.
- **Sharing:** mod tracks that use a new model item only work where the same `.glb` is in `public/mods/models/`.
- **Folder mode:** the track editor opened from disk (Open folder…) can't measure models, so it doesn't list new model items. Run it through `npm run dev` or Toolkit.cmd.
