# Adding the two games to the portal

The portal plays each game from a Web export in this folder:

| Game | Godot project | Export to |
|---|---|---|
| Haat Bazaar (market memory) | `Dimentia_Memory_Game` | `public/games/haat-bazaar/index.html` |
| Tator Gatha (loom patterns) | `Tator Gatha` | `public/games/tator-gatha/index.html` |

When `index.html` is there, the Games page shows **Play**. Refresh the page after exporting.

## 1. Fix three things first

I read both projects before wiring them in. These will stop the web versions from working:

1. **Haat Bazaar opens the wrong scene.** The main scene is `gamelevel.tscn` (the walking path).
   Nothing opens `market_game.tscn`, which is the actual shopping game. Set
   *Project Settings > Application > Run > Main Scene* to `market_game.tscn`, or add a button that opens it.
2. **Haat Bazaar scene paths have the wrong capital letters.** `regionmenu.gd` opens
   `res://GameLevel.tscn` and `gamelevel.gd` opens `res://RegionMenu.tscn`, but the files are
   `gamelevel.tscn` and `regionmenu.tscn`. Windows forgives this in the editor. Exported games
   (Web, Android) do not, so change the strings to lowercase.
3. **Tator Gatha can never be finished.** `reference_pattern.gd` makes the 4th colour
   `Color.YELLOW`, but the game only has Red, Green and Blue buttons. Add a Yellow button
   (and a `check_color_input(Color.YELLOW)` handler) or change the 4th colour.

## 2. Export for the Web (once per game)

1. Open the project in Godot 4.
2. Set the renderer to **Compatibility** (dropdown at the top right of the editor).
   Both projects use Forward+, which browsers cannot run.
3. *Editor > Manage Export Templates > Download and Install* (only needed once).
4. *Project > Export > Add... > Web*. Leave *Thread Support* off.
5. *Export Project...* into the folder from the table above, with the file name `index.html`.
   Godot writes `index.html` plus `.js`, `.wasm` and `.pck` files next to it; keep them together.

The portal server sends the right file types and the cross-origin isolation headers Godot needs,
so there is nothing else to configure. Open it through the portal (`http://localhost:8000`),
not by double-clicking `index.html`.

## 3. Send results to the portal (optional, recommended)

Without this, the games still play, and a caregiver can import the desktop log files instead
(Games > Import results file).

1. Copy [`portal_bridge.gd`](portal_bridge.gd) into each Godot project.
2. *Project Settings > Globals (Autoload)*: path `res://portal_bridge.gd`, name `PortalBridge`.
3. Add one line to each game:

**Haat Bazaar**: in `market_game.gd`, inside `_save_trip_to_telemetry()`, right after
`var trip_dict: Dictionary = current_trip.to_dict()`:

```gdscript
PortalBridge.send_session("haat", trip_dict)
```

**Tator Gatha**: in `game_controller.gd`, at the end of `record_telemetry()`:

```gdscript
PortalBridge.send_event("tator", telemetry_entry)
```

The bridge only runs in Web builds, so the desktop versions keep writing their `.jsonl` files as before.

## Where desktop results are saved (for importing)

- `%APPDATA%\Godot\app_userdata\Dimentia_Memory_Game\market_telemetry.jsonl`
- `%APPDATA%\Godot\app_userdata\Tator Gatha\loom_telemetry.jsonl`

Importing the same file twice is safe; sessions already in the portal are skipped.
