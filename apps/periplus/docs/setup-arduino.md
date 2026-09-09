# Firmware setup

Three sketches across two MCUs:

| Sketch | MCU | Board |
| --- | --- | --- |
| `firmware/tbeam-tag` | ESP32 | T-Beam V1.2 |
| `firmware/tbeam-selftest` | ESP32 | T-Beam V1.2 — bring-up diagnostics |
| `firmware/techo-gateway` | nRF52840 | T-Echo |

## PlatformIO (recommended)

Each project has a `platformio.ini`, so board, libraries and upload settings are
already pinned. Install PlatformIO Core, then:

```bash
pio run -d firmware/tbeam-tag -t upload --upload-port /dev/ttyACM0
```

```bash
pio run -d firmware/tbeam-selftest -t upload --upload-port /dev/ttyACM0
```

```bash
pio run -d firmware/techo-gateway -e techo -t upload --upload-port /dev/ttyACM0
```

```bash
pio device monitor -b 115200
```

`src_dir` points at the project root in each, so the `.ino` files stay put and
the Arduino IDE workflow below keeps working from the same sources.

**One image for every tag** — there are no per-board environments. Each T-Beam
derives its own `device_id` from its efuse MAC, so the identical binary can be
flashed to any number of tags.

### T-Echo upload

Two environments, because the nRF52 changes USB identity between application and
bootloader mode:

| Env | Use |
| --- | --- |
| `techo` | 1200-baud touch reboots the board into DFU automatically |
| `techo-dfu` | No touch — board is **already** in DFU (double-click reset) |

The touch is unreliable over USB/IP; a manually-entered bootloader waits
indefinitely, so `techo-dfu` after a double-click reset is the dependable path.

## Arduino IDE

### Board support

**ESP32** (T-Beam) — add to Additional Boards Manager URLs:

```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```

Install **esp32** by Espressif, select **T-Beam** (or "ESP32 Dev Module").

| Setting | Value |
| --- | --- |
| CPU Frequency | 240 MHz (WiFi/BT) |
| Flash Mode / Size | QIO / 4 MB |
| Partition Scheme | Default 4 MB with spiffs |
| Upload Speed | 921600 |

**Adafruit nRF52** (T-Echo) — add:

```
https://www.adafruit.com/package_adafruit_index.json
```

Install **Adafruit nRF52**, select **Nordic nRF52840 DK** (this is the correct
target — see `hardware.md` for why) or **LilyGo T-Echo** if listed.

### Libraries

| Library | Author | Used by |
| --- | --- | --- |
| RadioLib | Jan Gromes | all |
| TinyGPSPlus | Mikal Hart | tag, selftest, gateway |
| XPowersLib | lewisxhe | tag, selftest — PMU / battery |
| U8g2 | olikraus | tag, selftest — SSD1306 OLED |
| GxEPD2 | zinggjm | gateway — e-paper |
| Adafruit GFX Library | Adafruit | gateway — GxEPD2 dependency |

The tag pulls XPowersLib and U8g2 in behind `#if __has_include(...)`, so it
compiles without them and simply loses the PMU and OLED features. PlatformIO
needs `lib_ldf_mode = deep+` to see through that; it is already set.

## config.h

```bash
cp firmware/tbeam-tag/config.example.h     firmware/tbeam-tag/config.h
cp firmware/techo-gateway/config.example.h firmware/techo-gateway/config.h
```

`config.h` is gitignored. `firmware/tbeam-selftest` needs none — every value is
in the sketch.

**All radio parameters must match between tag and gateway**: frequency,
bandwidth, spreading factor, coding rate and sync word. Set `LORA_FREQUENCY` to
the number printed on the shield can, not just your region. Defaults here are
923.0 / 125 / SF7 / CR4-5 / `0x12`.

## Upload

* **T-Beam:** select board + port, Upload. If it will not enter download mode,
  hold **IO38**, tap **RST**, release IO38, then upload.
* **T-Echo:** **double-click reset** to enter DFU, then Upload. Retry the
  double-click if the first attempt times out.

## Verify

Serial Monitor at **115200 baud**.

Start with `firmware/tbeam-selftest` on a new T-Beam — it tests each subsystem
separately so a failure points at one thing, and it never transmits, so it is
safe without an antenna. It ends with a single line:

```
[RESULT] i2c=2 pmu=ok oled=ok gnss=ok lora=ok
```

Then flash the real firmware. See the per-firmware READMEs for expected output.

> ⚠️ Antenna must be connected before powering a board that transmits.
