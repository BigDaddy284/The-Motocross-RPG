Your own 3D models
==================

Put .glb files here (Blender: File > Export > glTF 2.0, Format: glTF Binary) and reload the game.

  <scenery id>.glb      replaces that scenery item, e.g. hay_bale.glb or tree.glb
  race_bike.glb         replaces the race bike (race_bike_youth.glb for 85cc and under)
  race_rider.glb        replaces the rider on every race bike
  any other name        a new scenery item in the track editor, e.g. round_bale.glb

Models are in metres, standing on the ground (Blender Z = 0), front facing -Y, bikes along +X.
The Models page (the toolkit's Models card, or the game with ?models) exports the game's own
objects to start from, and lists every file here with what it does or why it isn't used.
The full rules for each type are in docs/MODELS.md.
