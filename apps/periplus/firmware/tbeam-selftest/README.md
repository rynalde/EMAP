# T-Beam V1.2 (AXP2101) hardware self-test

Bring-up firmware that proves each subsystem on the board independently, so a
failure points at one thing instead of the whole stack. It **never transmits**,
so it is safe to run without the SMA antenna attached (the tag firmware is not).

## What it checks

| Step | Reports |
| --- | --- |
| ESP32 identity | chip model, revision, cores, flash size, PSRAM (measured, not assumed) |
| I²C scan | every responding address on SDA 21 / SCL 22 — this is what answers "is an OLED fitted?" |
| AXP2101 PMU | chip id, DCDC1 / ALDO2 / ALDO3 state and voltage, battery mV / %, charging, VBUS |
| SSD1306 OLED | only initialised if the scan actually saw `0x3C` |
| u-blox GNSS | raw byte flow on UART1 first, then fix / sats / HDOP / position / UTC |
| SX1276 LoRa | `radio.begin()` at the configured frequency; distinguishes "chip not found" from other faults |

The PMU step **explicitly enables ALDO2 (LoRa) and ALDO3 (GNSS)** rather than
assuming they came up on. A board whose GNSS rail is off produces zero NMEA
bytes, which is easy to misread as a wiring fault.

## Frequency

`LORA_FREQUENCY_MHZ` defaults to **923.0 (AS923)**, matching a shield marked
923 MHz. Change it at the top of the sketch to whatever is printed on your
shield can — a 923 MHz module driven at 868 or 915 links over a few metres and
transmits out of band.

## Build, flash, watch

```bash
pio run -d firmware/tbeam-selftest -t upload --upload-port /dev/ttyUSB0
```

```bash
pio device monitor -p /dev/ttyUSB0 -b 115200
```

If the board does not enter download mode on its own: hold **IO38**, tap
**RST**, release IO38, then start the upload.

## Reading the result

The boot sequence ends with a single summary line:

```
[RESULT] i2c=1 pmu=ok oled=absent gnss=ok lora=ok
```

Then it prints live GNSS and battery data every 2 s, and drives the OLED at 2 Hz
if one is present.

| Symptom | Meaning |
| --- | --- |
| `i2c=0` | Nothing on the bus at all — power or solder fault, not firmware |
| `pmu=FAIL` | No response at `0x34`; the ESP32 is up but the PMU is not |
| `oled=absent` | Normal. V1.2 ships the SSD1306 footprint unpopulated |
| `gnss=FAIL` | Zero bytes in 3 s — check ALDO3 is on and that RX really is GPIO34 |
| `lora=FAIL` | `CHIP_NOT_FOUND` means SPI wiring or ALDO2 off; other codes are config |

Sentences arriving with empty fields is normal on a cold start — the receiver is
alive and simply has not acquired satellites. Set `ECHO_RAW_NMEA` to `1` to dump
the raw sentences instead of parsed fields.
