# Family Message Box — final Ender-3 V3 SE files

The three current G-code files are sliced in CuraEngine 5.13 for the **Creality
Ender-3 V3 SE**, **0.4 mm nozzle**, and **ELEGOO matte PLA**. The `.gcode`
outputs are ignored in normal Git commits because they are machine/material
artifacts, not deployable server source. Regenerate them with
[`../slice.sh`](../slice.sh), or use the release/handoff bundle prepared for the
printer.

## Current jobs

| Order | Source file | SD-card name | Cura estimate | Filament |
| ---: | --- | --- | ---: | ---: |
| 1 | `01-electronics-carrier.gcode` | `BOX_TRAY.gcode` | 33 m 21 s | 3.2 m |
| 2 | `02-control-lid.gcode` | `BOX_LID.gcode` | 6 h 48 m | 47.1 m |
| 3 | `03-enclosure-base.gcode` | `BOX_BASE.gcode` | 12 h 54 m | 92.7 m |

Total Cura estimate: **20 h 16 m** and **143.0 m** of filament across three
separate jobs. No individual print reaches 13 hours.

## Improvement over the superseded slice

| Piece | Previous estimate | Current estimate |
| --- | ---: | ---: |
| Electronics tray | 7 h 41 m | 33 m 21 s |
| Microphone carrier | 34 m | Eliminated; integrated into body |
| Speaker cup | 6 h 07 m | Eliminated; direct internal speaker mount |
| Control lid | 17 h 54 m | 6 h 48 m |
| Enclosure body | 70 h 40 m | 12 h 54 m |
| Fit/closure coupons | 12 h 52 m | Eliminated; reference-listing dimensions used |
| Complete set | 115 h 52 m | 20 h 16 m |

The old files remain in this directory only as historical artifacts. They are
not copied into `sd-card-ready` and must not be used for the current enclosure.

## Final slicer profile

- Layer height: 0.32 mm; first layer: 0.24 mm
- Line width: 0.45 mm through the 0.4 mm nozzle
- Walls: 2, with local CAD reinforcement at load points
- Top/bottom: 4 / 4 layers
- Infill: 12% cubic
- General / outer-wall / infill speed: 70 / 40 / 70 mm/s
- Nozzle: 220 C throughout
- Bed: 65 C throughout
- Cooling: 0% first layer, gently ramping to 60% at layer 8
- First-layer flow: 105% at 15 mm/s
- Adhesion: 5 mm brim
- Retraction: 0.8 mm at 40 mm/s
- Supports: off

Import `family-message-box-fast-elegoo-matte-pla.curaprofile` into Cura if the STL
files ever need to be re-sliced. The checked-in `slice.sh` reproduces the three
current files and `slice-manifest.json` records their hashes and estimates.

## Before pressing Print

1. Keep the air-conditioner from blowing across the open printer. A 22 C room
   is fine; a moving cold draft is not.
2. Wash the plate with warm water and plain dish soap, rinse and dry it, then
   avoid touching the print area.
3. Run automatic levelling.
4. Watch the entire first-layer brim. Adjacent lines must merge smoothly. Stop
   the job if they remain round/separate or a corner begins to lift.
5. Keep the SpacePi at 50 C and confirm the spool feeds freely.

The carrier now has a permanent 0.24 mm-high, 14 mm-wide cross-shaped adhesion
web beneath its middle ribs. This directly addresses the observed failure where
the outside frame stuck but the narrow middle structure lifted.

PLA is acceptable for this indoor build, but it can creep in heat or sustained
load. Keep the finished box out of sun and hot cars. Inspect the grille, rear
tongues, recessed screw towers and all loose-part risks before child use.
