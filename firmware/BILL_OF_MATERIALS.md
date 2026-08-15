# Bill of materials

This is a reference build, not a required shopping list. Equivalent parts are
welcome when their electrical and mechanical specifications match. Verify every
delivered component with a multimeter and calipers before wiring or printing.

| Quantity | Component | Required specification | Example/reference |
| ---: | --- | --- | --- |
| 1 | ESP32-S3 development board | N16R8: 16 MB flash, 8 MB octal PSRAM | ESP32-S3 DevKitC-1-compatible N16R8 |
| 8 | Illuminated arcade button | Normally-open switch, separate 12 V LED, 24–28 mm panel hole | EG STARTS B01N549IDL or equivalent |
| 1 | I2S microphone | INMP441, 3.3 V, approximately 14 mm square | INMP441 breakout |
| 1 | I2S amplifier | MAX98357A mono, 3 W, 5 V input, 3.3 V logic | MAX98357A breakout |
| 1 | Speaker | 4 ohm, 3 W, approximately 52 × 52 × 23 mm | Small full-range speaker |
| 1 | Lamp driver | Eight active-high low-side sinking channels | ULN2803A module or eight logic-level MOSFET channels |
| 1 | Power supply | Certified regulated 12 V supply with at least 25% measured headroom | Size after measuring all eight LEDs |
| 1 | Buck converter | Regulated 12 V to 5 V, at least 3 A continuous | Protected DC-DC module |
| 1 | Prototype board | Approximately 70 × 90 mm | Double-sided perfboard |
| 1 | Power inlet | Panel-mount 5.5 × 2.1 mm DC jack, M11 body | Match the CAD or adjust it |
| 1 | Input fuse and holder | 2.5–3 A, accessible and insulated | Inline blade fuse holder |
| 1 | Power switch | Rated above the measured 12 V load | Panel-mount low-voltage switch |
| 1 set | Fasteners | M3 screws, nuts, and insulating spacers | Measure lengths during dry fit |
| 1 set | Wiring hardware | 22 AWG flexible wire, ferrules, insulated blade terminals, heat-shrink | Size terminals to actual button tabs |
| 1 set | Decoupling | 100 nF ceramics, 10 µF, and 470 µF low-ESR capacitor | See the wiring guide |
| 1 | Printed enclosure | Base, control lid, and electronics tray | Files in `enclosure/exports` |

## Tools and consumables

- Current-limited bench supply or an inline current meter
- Multimeter, calipers, soldering iron, lead-free solder, and flux
- Ferrule and quick-disconnect crimp tools
- Heat-shrink, cable ties, strain relief, and closed-cell microphone gasket
- FDM printer with a 220 × 220 mm or larger build area, 0.4 mm nozzle, and PLA

Brand names and vendor identifiers are examples only and are not endorsements.
Availability, prices, and listings change; select parts by specification. The
[mechanical component notes](enclosure/COMPONENT_SPECS.md) explain which
dimensions are encoded in the supplied CAD.
