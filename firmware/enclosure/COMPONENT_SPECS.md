# Component mechanical specifications

This is the enclosure's component contract. It maps the reference parts in
[`../BILL_OF_MATERIALS.md`](../BILL_OF_MATERIALS.md) to the dimensions that
affect the print. Listing-package dimensions are deliberately not used as
component dimensions.

`Exact` means the value is printed in the exact product listing or drawing.
`Envelope` means the product listing gives the outside size but not its hole
pattern. `Non-CAD` means the item is an assembly tool/consumable or remains
outside the enclosure.

## Installed or enclosure-driving parts

| Reference part / ASIN                           | Verified mechanical specification                                                                                                                                                       | CAD treatment                                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EG STARTS illuminated buttons / `B01N549IDL`    | Exact: 24-28 mm mounting hole, 32 mm plunger/top, 65 mm maximum plunger-top-to-microswitch-bottom. The exact listing separately identifies 4.8 mm switch and 6.3 mm lamp terminals.     | Eight 28.0 mm lid holes, 32 mm bezel keep-outs, and a 65 mm total-depth envelope. The 88 mm body keeps electronics out of the barrel zone.                                                    |
| Diymore ESP32-S3 DevKitC-1 N16R8 / `B0CLD4QKT1` | Exact product drawing: 63.5 x 28 mm. The two USB-C sockets project at one end.                                                                                                          | 63.5 x 28 mm marked carrier zone with four transverse tie slots; no false clone-specific mounting-hole assumptions.                                                                           |
| ARCELI INMP441 / `B0CH2TYXCZ`                   | Exact vendor drawing: 14 x 14 mm square module. It is a bottom-port MEMS board; the chip maker specifies a 0.5-1.0 mm PCB acoustic hole.                                                | Integrated 14.5 mm open-top slide rails, 1.0 mm exterior port, 5 mm gasket plenum. The microphone faces the enclosure front and is isolated from speaker wiring. No separate printed carrier. |
| AZDelivery MAX98357A / `B09PL7DSK5`             | Exact seller drawing: 18 x 19 mm; seller text gives 3 mm PCB/module thickness.                                                                                                          | 18 x 19 mm carrier allocation and tie points on the perfboard side; the amplifier remains outside any speaker cup.                                                                            |
| QUARKZMAN speaker / `B0DS6BKVQ4`                | Exact: 52 x 52 x 23 mm, 3 W, 4 ohm. The listing does not dimension the four corner-hole centres.                                                                                        | The 52 mm speaker bolts directly behind the front sound field, rotated 45 degrees. Four M3 holes are on a 31.1 mm radius (44 mm square estimate) and remain accessible behind the grille.     |
| Metal speaker grille / `B09BVV4MN6`             | Exact drawing: 66 mm outside diameter and 46 mm mesh opening. The listing does not dimension the screw-circle diameter.                                                                 | 66.6 x 0.7 mm exterior seat plus four diagonal 24-29 mm radial slots. This accepts the exact grille envelope without pretending the unpublished hole circle is known.                         |
| RUNCCI-YUN panel jack / `B0CH7WX85X`            | Exact drawing: 5.5 x 2.1 mm connector; M11 thread, 10.8 +/- 0.2 mm body, 9.0 +/- 0.2 mm threaded length, 30 mm overall before the 140 mm leads.                                         | 11.2 mm rear panel opening through a 2.4 mm wall, leaving full thread for the supplied nut and cap.                                                                                           |
| Aideepen buck converter / `B0CLRSFL13`          | Exact drawing: 46 x 27 x 14 mm body; mounting tab length shown as 10 mm; input leads 140 mm and output leads 300 mm.                                                                    | 46.6 x 27.6 mm carrier stops with strap slots and cable space. The potted module stays low on the carrier.                                                                                    |
| ELEGOO perfboard kit / `B072Z7Y19F`             | Exact sizes: 40 x 60 (6), 30 x 70 (10), 50 x 70 (7), 20 x 80 (7), and 70 x 90 mm (2); 1.6 mm thick, 2.54 mm pitch, 1 mm holes, four corner holes.                                       | The carrier locates one 70 x 90 mm board with four adjustable M3 slots. Smaller boards remain compatible with the lattice and tie slots.                                                      |
| M3 nylon hardware / `B09P8VB2G4`                | Exact product chart: female-female spacers 6/10/15/20 mm; male-female spacers 6+6/10+6/15+6/20+6 mm; M3 screws 6/12/20 mm; M3 washers and hex nuts. Hex body is shown as 5.5 mm across. | Carrier uses 6 mm spacers where required. The lid uses recessed M3 screws and captured M3 nuts from this kit; no M4 or external latch is required.                                            |
| Fafeicy ULN2803A module / `B08CHC43YC`          | The exact ASIN confirms the two-board module and electrical rating, but neither listing text nor its drawings publish PCB width, length, or mounting-hole centres.                      | It is mounted on the exact 70 x 90 mm perfboard or with the carrier's adjustable tie slots. No brittle hard-sized pocket is used.                                                             |
| JOREST fuse holders / `B0DBPQBGBQ`              | Exact listing: one 12 AWG and four 16 AWG inline holders; 300 mm loop length. The molded holder body is not dimensioned.                                                                | The selected input holder is tied to the carrier lattice with enough open cable space; it does not drive a hard pocket.                                                                       |
| Faston terminal assortment / `B0CKDYZNW9`       | Exact terminal families: 2.8, 4.8 and 6.3 mm; red 22-16 AWG, blue 16-14 AWG, yellow 12-10 AWG.                                                                                          | The 88 mm body and unobstructed zones beside each 65 mm button envelope preserve side-entry terminal and wire-bend space.                                                                     |
| QWORK silicone wire / `B0BTBBV5FK`              | Exact: 22 AWG / 0.32 mm2, 60 x 0.08 mm strands, five 10 m colours.                                                                                                                      | Signal looms use the open carrier and rear/side routing, not tight printed channels.                                                                                                          |
| H07V-K wire / `B0D3F9VTLT`                      | Exact: 1.5 mm2, six 1 m colours.                                                                                                                                                        | High-current lamp/power runs use the open carrier edges and cannot be confused with the microphone loom.                                                                                      |
| Lsnisni heat-shrink / `B0CP75WSD9`              | Exact: 4:1 dual-wall adhesive tubing, 90 mm lengths in 6/8/12/16/20 mm supplied sizes.                                                                                                  | Clearance item only; no dedicated print.                                                                                                                                                      |
| Universal 12 V 3 A adapter / `B0GRTSY1FF`       | Exact: 100-240 V AC input, 12 V 3 A / 36 W output, centre-positive 5.5 x 2.1 mm plug plus adapters.                                                                                     | Remains completely outside. Only low-voltage DC enters through the exact panel jack.                                                                                                          |

## Tools and alternates that do not create printed geometry

| Reference part / ASIN                       | Review result                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| Solder flux syringes / `B0CSRNKF2X`         | Assembly consumable; no enclosure geometry.                                       |
| Owootecc 0.6 mm solder / `B07SRXWBDS`       | Assembly consumable; no enclosure geometry.                                       |
| Metal soldering-tip cleaners / `B0CCNK7SX8` | Bench tool; no enclosure geometry.                                                |
| AUKENIEN IC assortment / `B0BVLNYPMD`       | Spares; the reference ULN2803A module is the installed driver path.               |
| 7 x 100 mm glue sticks / `B0CNXHQPZJ`       | Internal strain relief only; not used as the lid lock.                            |
| Ferrule crimping set / `B0FQP6KDL4`         | Assembly tool/terminals; no printed geometry.                                     |
| Beizkna soldering iron / `B09B3GRVTM`       | Bench tool; no enclosure geometry.                                                |
| flintronic 4-32 mm step bit / `B0B1Q4WMT8`  | Useful for alternate drilled enclosures; not required for the printed enclosure.  |
| GTIWUNG mini breadboards / `B08LD68864`     | Bench-only prototypes; deliberately excluded from the closed enclosure.           |
| Stanley toolbox / `B013ERLQDK`              | Project storage; no enclosure geometry.                                           |
| Generic wooden box                          | Optional alternate enclosure path; preserve the printed design's clearances.      |

## Honest limits

The vendor drawings provide exact outside envelopes for the critical parts but
do not publish the grille screw circle, speaker corner-hole centres, or Fafeicy
breakout PCB dimensions. The design therefore uses slotted or tie-down mounting
only at those three interfaces. That is intentional tolerance, not a request
for another fit coupon. The button opening, microphone pocket, speaker/grille
envelopes, DC jack, buck converter, ESP32, perfboard and M3 closure are all
driven by the reference-component drawings above.
