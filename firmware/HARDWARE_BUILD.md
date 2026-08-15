# Family Message Box hardware build

## Build status

The firmware and server boundary assume the reference components below.
The default and only firmware target is the Diymore ESP32-S3 DevKitC-1 N16R8.
The enclosure must not be closed until every check in the bench acceptance
section passes.

The EG STARTS B01N549IDL buttons have a confirmed 12 V operating voltage. Each
button exposes two independent microswitch terminals and two independent LED
terminals. The ESP32 must never drive an LED directly. The software produces
active-high 3.3 V logic for eight external low-side driver channels. Measure one
LED's current on arrival to confirm the driver and 12 V supply sizing; this does
not change the firmware.

## Reference hardware inventory

See [`BILL_OF_MATERIALS.md`](BILL_OF_MATERIALS.md) for component specifications,
wiring supplies, tools, and acceptable equivalent parts.

| Part        | Example product                                        | Software/electrical consequence                                                              |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Controller  | Diymore ESP32-S3 DevKitC-1 N16R8, B0CLD4QKT1           | Use only `esp32-s3-wroom-1-n16r8`; firmware checks for 16 MB flash and 8 MB PSRAM at boot    |
| Buttons     | EG STARTS illuminated arcade buttons, B01N549IDL       | Eight normally-open microswitches plus eight separate, confirmed 12 V LED circuits           |
| Microphone  | ARCELI INMP441 I2S module, B0CH2TYXCZ                  | 3.3 V, left I2S slot, 16 kHz capture                                                         |
| Amplifier   | AZDelivery MAX98357A 3 W mono I2S breakout, B09PL7DSK5 | 5 V supply, 3.3 V I2S logic, admin volume range 0–100%; loud audio may distort at full scale |
| Speaker     | QUARKZMAN 3 W 4 ohm speaker, B0DS6BKVQ4                | One speaker on the amplifier bridge output; never connect either lead to ground              |
| Final board | ELEGOO double-sided prototype PCB kit, B072Z7Y19F      | Soldered final wiring; mini breadboards are bench-only                                       |
| Enclosure   | Printable enclosure in `enclosure/exports`             | Designed around the reference parts; print and dry-fit before final wiring                   |

The printable enclosure, validation gate, print files, and assembly instructions
are in [`enclosure/README.md`](enclosure/README.md). Builders who choose a
wooden or alternate enclosure must preserve the same clearances, strain relief,
grille protection, and child-safe closeout checks before final assembly.

Ferrules do not replace female blade terminals.
The button assemblies need insulated quick-disconnect terminals sized to the
actual blades (commonly 4.8 mm on the microswitch and 6.3 mm on the lamp holder).
Verify with calipers before ordering or crimping.

## Electrical requirements

- Eight 3.3 V-compatible logic-level low-side MOSFET channels, or an equivalent
  eight-channel sinking driver board, each with a 47 k to 100 k gate/input
  pull-down. Avoid relay boards and active-low modules; the checked firmware
  deliberately emits active-high lamp control.
- A regulated 12 V lamp rail. The cleanest single-input build is a certified
  12 V supply feeding the lamps plus a regulated 12 V-to-5 V buck converter
  rated for at least 3 A for the ESP32 and amplifier. Alternatively, retain a
  certified 5 V/3 A USB-C supply and add a suitably rated 5 V-to-12 V boost
  converter only for the lamps.
- A 2.5 A to 3 A input fuse, power switch, strain relief, and insulated female
  quick-disconnect terminals for the button assemblies.
- 100 nF microphone decoupling, 10 uF plus 100 nF amplifier decoupling, and a
  470 uF low-ESR capacitor at the 5 V distribution point.

Do not assemble the final unit solely on the supplied solderless breadboards;
their jumper contacts are not a reliable child-product interconnect.

## Fixed build assumptions

- Controller: an ESP32-S3 DevKitC-1-compatible N16R8 board.
- Microphone: the reference INMP441 I2S breakout, powered from 3.3 V.
- Amplifier: the reference MAX98357A breakout, powered from 5 V.
- Speaker: the reference 4 ohm, 3 W speaker.
- Lamps: the reference 12 V LEDs, controlled through eight
  external active-high low-side driver channels.
- Supply: regulated 12 V lamp rail and regulated 5 V/3 A logic/audio rail. No
  mains voltage enters the wooden enclosure.
- Recording: 16 kHz, mono, signed 16-bit PCM in PSRAM, 3 to 30 seconds.
- Playback: authenticated 16 kHz mono PCM from the LAN server, duplicated into
  both I2S slots for the amplifier.

Check that the module label ends in `N16R8` before flashing. The generic
PlatformIO board definition is an 8 MB, no-PSRAM target and is not sufficient.
This project overrides it with the supported board's 16 MB flash and octal
8 MB PSRAM configuration and performs a runtime capacity check.

## GPIO and wiring

The checked-in `include/pins.h` map avoids the ESP32-S3 strapping pins, native
USB pins, octal flash/PSRAM pins, UART0 pins, and the RGB LED GPIO used by
either DevKitC-1 revision. GPIO39-42 are intentionally repurposed from external
JTAG; normal USB-C COM flashing remains available.

| Function            |        ESP32-S3 GPIO | Connection                             |
| ------------------- | -------------------: | -------------------------------------- |
| Button 1 to 6       |   4, 5, 6, 7, 15, 16 | Microswitch NO; microswitch COM to GND |
| Lamp 1 to 6 control | 8, 9, 10, 11, 12, 13 | Driver logic input only                |
| Button 7 to 8       |               39, 40 | Microswitch NO; microswitch COM to GND |
| Lamp 7 to 8 control |               41, 42 | ULN2803A inputs 7B and 8B only         |
| INMP441 SCK/BCLK    |                   17 | Microphone SCK                         |
| INMP441 WS          |                   18 | Microphone WS                          |
| INMP441 SD          |                   21 | Microphone SD                          |
| MAX98357A BCLK      |                   14 | Amplifier BCLK                         |
| MAX98357A LRC       |                   47 | Amplifier LRC                          |
| MAX98357A DIN       |                    2 | Amplifier DIN                          |
| MAX98357A SD        |                    1 | Amplifier SD/mute                      |

INMP441:

- VDD to 3.3 V, GND to common GND.
- L/R to GND so the microphone transmits in the left I2S slot.
- Add 100 nF ceramic decoupling between VDD and GND at the breakout.
- Keep SCK, WS, and SD short and away from the speaker wires and lamp-current
  wiring.

MAX98357A:

- VIN to the 5 V distribution rail, GND to common GND.
- Connect the 4 ohm speaker only between amplifier `+` and `-`. The output is
  bridge-tied; neither speaker terminal goes to ground.
- Fit at least 10 uF plus 100 nF across VIN/GND at the amplifier breakout, and a
  470 uF low-ESR bulk capacitor near the 5 V star point.
- Twist the two speaker wires together and keep them away from the microphone.

Buttons and lamps:

- Switch contacts and lamp contacts are electrically separate.
- The switch uses the ESP32 internal pull-up: GPIO to NO, COM to GND.
- Each 12 V lamp uses its own low-side MOSFET/driver channel. Add a 47 k to 100 k
  pull-down at each driver input/gate so every lamp stays off during reset.
- Power the lamps from the regulated 12 V rail; never connect them to the ESP32
  5 V or 3.3 V rail.
- All low-voltage supplies and the ESP32 must share ground at the power star
  point. Do not share lamp current through the microphone ground trace.
- The supplied LED assemblies are rated for 12 V. Do not add a second resistor
  unless inspection of the delivered assembly shows it is a bare LED rather
  than the advertised rated-voltage assembly.

## Power distribution

Bring the external low-voltage supply to a fused distribution point. For the
preferred single-supply arrangement, use a regulated 12 V input and run:

1. a direct 12 V branch to the eight lamp positives;
2. a 12 V branch through a 5 V/3 A buck converter to the DevKitC-1 `5V` and
   `GND` pins;
3. a separate 5 V branch from that converter to MAX98357A `VIN` and `GND`.

Use a 2.5 A to 3 A resettable fuse or inline fuse at the enclosure entry,
strain-relieve the low-voltage power lead, and cover every exposed conductor.
Do not power the amplifier or lamps through the ESP32 3.3 V regulator. The 5 V converter
must provide 3 A continuous output for Wi-Fi and audio transients. Select the
12 V supply after measuring one delivered lamp and adding all eight lamp loads to
the 5 V converter input power with at least 25% headroom.

## Firmware and provisioning

1. Install PlatformIO.
2. Copy `include/device_config.example.h` to `include/device_config.h`.
3. Enter Wi-Fi, LAN API host/port, device ID, and the server bootstrap token.
   The ESP32-S3 uses 2.4 GHz Wi-Fi; a phone or server may use 5 GHz as long as
   both bands are on the same LAN. Reserve the API server's address in DHCP so
   the configured host and its TLS certificate do not drift.
4. For HTTPS, set `TLS_CERT_PATH` and `TLS_KEY_PATH` on the API server, set
   `API_TLS=true` in the device config, and paste the private LAN root CA PEM
   into `ROOT_CA_PEM`. Use the API's HTTPS port, not the phone-only PWA dev
   proxy. The firmware refuses TLS without a CA; it never silently uses an
   insecure client.
5. Build the supported N16R8 target:

   ```bash
   pio run -d firmware -e esp32-s3-wroom-1-n16r8
   ```

6. Flash and monitor:

   ```bash
   pio run -d firmware -e esp32-s3-wroom-1-n16r8 -t upload
   pio device monitor -d firmware
   ```

For the two-USB-port Diymore board, use the connector labelled `COM` for the
initial flash and serial monitor. The firmware keeps `Serial` on UART0 for that
USB-to-UART bridge; the native connector labelled `USB` is not required.

On first connection the firmware registers the device and stores the returned
credential in NVS. After that succeeds, remove the bootstrap token from the
local config and reflash. Normal firmware uploads preserve NVS.

After the OTA bootstrap image is installed, future updates can be staged from
the admin Settings page on an iPhone or with the repository's
`firmware:package` and `firmware:upload` commands. Every image must be signed by
the offline ECDSA private key; the ESP32 contains only its public key. It writes
the inactive application slot, verifies the exact length and SHA-256, asks
ESP-IDF to validate the complete image, then reboots. The new slot is confirmed
only after the hardware and authenticated API checks pass. A failed first boot
rolls back to the previous slot.

Reserve the Mac/server address in DHCP. If that LAN address changes, update
`API_HOST`, rebuild, and use USB once more because the ESP32 cannot reach the OTA
server at the old address.

The API must be reachable from the LAN. A non-loopback server bind requires a
long random `DEVICE_BOOTSTRAP_TOKEN` and must not seed the known development
credential. Keep the admin surface on the trusted LAN and do not port-forward
it from the router.

## Bench acceptance

Run these checks with the lid open and a current-limited bench supply first.

1. **Power-off continuity:** no short between 5 V and GND; no speaker terminal
   connected to GND; every lamp load is isolated from its GPIO.
2. **Power rails:** 12 V stays within tolerance with all eight lamps on; 5 V stays
   within tolerance while the speaker plays; microphone VDD remains near 3.3 V.
3. **Boot:** serial reports 16 MB flash and 8 MB PSRAM and does not report an
   I2S or duplicate-pin fault. Lamps remain off during reset.
4. **Switches:** each held switch creates exactly one press; no neighbouring
   button triggers.
5. **Recording:** tap an idle assigned button, speak for more than three
   seconds, tap again, and verify the recorded voice arrives through the
   configured messaging adapter. Repeat at the 30-second auto-stop boundary.
6. **Upload recovery:** disconnect Wi-Fi after recording. The firmware must
   retain the recording in PSRAM, reconnect, and upload it once with the same
   idempotency key.
7. **Incoming queue:** send two voice notes from one assigned contact. Only the
   matching lamp flashes. One press plays and acknowledges both notes in order,
   then turns the lamp off.
8. **Playback failure:** disconnect the server before pressing a flashing
   button. The lamp must remain flashing and the message must remain waiting.
9. **Audio quality:** verify no clipping, speaker howl, lamp-switch noise, or
   Wi-Fi buzz. Reposition the microphone and speaker or lower volume before
   changing digital gain.
10. **Thermal/current soak:** play and flash repeatedly for 30 minutes. Check
    the supply, driver, amplifier, connectors, and enclosure for abnormal heat.
11. **Child-safe closeout:** fit strain relief, insulated terminals, rounded
    internal edges, secure fasteners, a speaker grille, and a microphone grille
    that cannot be pushed into the electronics.

Do not call the physical unit complete until all eleven checks pass on the
actual components.
