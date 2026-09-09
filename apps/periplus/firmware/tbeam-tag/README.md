# T-Beam GPS LoRa Tag firmware

Battery-powered GPS tag. Reads GPS, builds a small JSON payload, and transmits
it over **raw LoRa P2P** every `SEND_INTERVAL_MS`.

> ⚠️ **Never transmit LoRa without the antenna connected.** Attach the antenna
> before powering the board, or you risk damaging the radio.

## Board

```
LILYGO T-Beam ESP32 LoRa GPS
```

Verify your physical revision before flashing — the LoRa chip (SX1276/78 vs
SX1262), frequency band (868 vs 915), PMU (AXP192 vs AXP2101) and pin map vary:

* https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series
* https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/docs/en/t_beam/t_beam_hw.md

See `../../docs/pinout.md` for the documented pin table.

## Toolchain

1. Arduino IDE (or arduino-cli).
2. Install **ESP32** board support (Boards Manager → "esp32" by Espressif).
3. Install libraries (Library Manager):
   * `RadioLib` (Jan Gromes)
   * `TinyGPSPlus` (Mikal Hart)
   * `XPowersLib` (lewisxhe) — optional, for AXP192/AXP2101 battery voltage.
   * `U8g2` (olikraus) — optional, for the SSD1306 OLED status panel.
4. Board: **T-Beam** (or "ESP32 Dev Module"). Upload speed 921600 is fine.

## Configure

```bash
cp config.example.h config.h
```

Edit `config.h`:

* `LORA_FREQUENCY` — must match the frequency printed on the shield can
  (`868.0` EU, `915.0` US, `923.0` AS923). **Tag and gateway must match.**
* Define the correct chip: `LORA_CHIP_SX1276` **or** `LORA_CHIP_SX1262`.
* Verify the pin map against your board revision.

There is no demo/fallback location. The tag transmits every `SEND_INTERVAL_MS`
whatever the GPS state and reports a `status` field — see *Payload* below.

`config.h` is gitignored.

## Build & upload

* Open `tbeam-tag.ino` in the Arduino IDE, select the board + port, click Upload.
* Or with arduino-cli:

```bash
arduino-cli compile --fqbn esp32:esp32:t-beam firmware/tbeam-tag
arduino-cli upload  --fqbn esp32:esp32:t-beam -p /dev/ttyACM0 firmware/tbeam-tag
```

## Expected serial output (115200 baud)

```
[BOOT] T-Beam tag starting
[BOOT] PMU AXP2101 detected
[GPS] serial started
[LORA] init ... ok
[GPS] waiting for fix... sats=3
[GPS] fix lat=38.722300 lng=-9.139300 sats=7 hdop=1.20
[BAT] battery_mv=4100
[LORA] packet sent seq=1 len=118
```

Indoors with no fix (after the timeout):

```
[GPS] no fix, using demo location
[LORA] packet sent seq=1 ...
```

## OLED status panel

If an SSD1306 128×64 is fitted at `0x3C`, the firmware drives it automatically —
it probes the bus at boot and falls back to serial-only when nothing answers, so
the same build runs on boards with and without the panel.

```
TAG001 seq12
--------------------
FIX  sat07 hdop1.2
lat 38.722300
lng -9.139300
UTC 14:22:31
BAT 4102mV
923.0MHz TX ok
```

The fix field reads `WAIT` before the first fix, `FIX` while locked, and `HOLD`
when a previously-acquired fix has gone stale and the last known position is
being reported instead.

## Payload

See `../../docs/packet-format.md`. Example:

```json
{"device_id":"A4CF12345678","seq":1,"status":"fix","fix":true,"lat":38.7223,"lng":-9.1393,"battery_mv":4100,"sats":7,"hdop":1.2,"fw":"mvp-0.1.0"}
```
