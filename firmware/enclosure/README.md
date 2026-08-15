# Family Message Box printable enclosure

This folder contains the editable and print-ready enclosure for the actual
eight-button hardware in [`../BILL_OF_MATERIALS.md`](../BILL_OF_MATERIALS.md).
The mechanical research and the few unavoidable listing gaps are recorded in
[`COMPONENT_SPECS.md`](COMPONENT_SPECS.md).

## What changed

The enclosure has been rebuilt around the reference components rather than a
universal fit coupon:

- eight 28 mm openings for the reference 24-28 mm EG STARTS button specification;
- eight 35.6 mm recessed circular sticker positions;
- `FAMILY MESSAGE BOX` engraved into the front;
- a correctly oriented 14 mm square INMP441 slide-in holder with a short,
  gasketable 1 mm acoustic path;
- a 66 mm grille seat and 46 mm protected sound field for the 52 x 52 x 23 mm
  speaker;
- an 11.2 mm opening for the exact M11 panel jack;
- a skeletal carrier for the 70 x 90 mm perfboard, 63.5 x 28 mm ESP32,
  46 x 27 x 14 mm buck, 18 x 19 mm amplifier and ULN driver, with a
  one-layer-high 14 mm adhesion web beneath the narrow middle ribs;
- hidden rear tongues and two deeply recessed M3 service screws, using hardware
  already in the reference M3 kit. This is a tool-secured, child-deterrent
  closure; nothing projects from the box for a latch.

The integrated microphone rails and direct speaker mounting eliminate the old
microphone-carrier and speaker-cup prints. The actual set is only three pieces.

## Print files

| File | Purpose |
| --- | --- |
| `exports/family-message-box-base.stl` | 204 x 184 x 88 mm enclosure body |
| `exports/family-message-box-control-lid.stl` | Eight-button/eight-label lid |
| `exports/family-message-box-electronics-tray.stl` | Lightweight component carrier |
| `exports/family-message-box-preview.png` | Closed preview |
| `exports/family-message-box-exploded-preview.png` | Lid/body relationship |
| `print-ready/*.gcode` | Ignored generated Ender-3 V3 SE jobs for ELEGOO matte PLA |
| `print-ready/family-message-box-fast-elegoo-matte-pla.curaprofile` | Importable Cura profile |

Older nominal/coupon exports are retained only as historical files and are not
part of this build. Use the three files named above.

## Dimensions and print-time design

| Feature | Final value |
| --- | ---: |
| Body | 204 W x 184 D x 88 H mm |
| Wall / floor skin | 1.8 / 1.4 mm, with a 3 mm floor grid and local 3 mm panels |
| Lid | 199.6 x 179.6 x 4 mm; 6 mm only at two small screw pads |
| Button opening / maximum assembly depth | 28 / 65 mm |
| Sticker recess | 35.6 mm diameter x 0.5 mm deep |
| Microphone PCB / acoustic port | 14 x 14 mm / 1.0 mm |
| Speaker / grille | 52 x 52 x 23 mm / 66 mm outer, 46 mm mesh |
| Panel-jack cutout | 11.2 mm for the exact M11 body |
| Closure | Two hidden rear tongues plus two recessed M3 screws |

The reliable profile uses 0.32 mm layers, two walls, four top/bottom layers,
12% cubic infill, 220 C matte-PLA temperature and a 70 mm/s maximum material
speed. The thinner shell is not uniformly flimsy: the lid ledge,
floor mounts, button panel, grille area and child-deterrent screw towers retain
dedicated reinforcement.

## Assembly notes

1. Print the base open side up, the lid presentation face up, and the carrier
   rail side up. Supports are disabled for all three.
2. Mount the square speaker behind the circular grille at 45 degrees. Its four
   fasteners sit on the cardinal holes; the grille uses the four diagonal
   slots. Confirm the speaker cone moves freely before tightening.
3. Place a thin closed-cell gasket behind the microphone port. Slide the
   INMP441 down the open-top rails with its acoustic-hole face toward the front.
   Do not cover the hole with glue or mesh adhesive.
4. Use one 70 x 90 mm ELEGOO perfboard on the left carrier zone. Use reference
   M3 hardware or cable ties through the marked slots for the ESP32, potted buck
   converter and fuse holder. Keep the ESP32 antenna end clear of metal and
   leave both USB sockets serviceable.
5. Keep microphone/data wiring on the left. Keep 12 V lamp current, the ULN
   driver, fuse and buck on the right. Twist the speaker pair and keep it away
   from the microphone loom.
6. Fit M3 nuts into the two side-entry traps near the front. Slide the lid's
   rear tongues under their hidden roofs, lower the front, then install the two
   recessed M3 screws. The required tool must be stored away from the child.
7. Complete every bench and child-safe closeout test in
   [`../HARDWARE_BUILD.md`](../HARDWARE_BUILD.md) before child use.

The closure is child-deterrent, not a certified child-safety lock. PLA can creep
under heat or long-term load, so keep the box indoors, out of sun and hot cars,
and inspect the tongues, screw towers, grille and loose parts regularly.

## Rebuild and validate

Docker must be running:

```bash
./firmware/enclosure/export.sh
node ./firmware/enclosure/validate_exports.mjs
```

The validator checks the three STL envelopes, closed mesh topology, exact
source contracts, preview images and a freshness manifest. Generated `.gcode`
files are not part of normal Git deploy commits; regenerate them with
`slice.sh` or attach them to a release/handoff bundle when the printer setup is
the target.
