# Hardware

> ⚠️ **Antenna safety:** Never transmit LoRa without the antenna connected.
> Transmitting into an unmatched load can damage the radio's power amplifier.
> Always attach the antenna **before** powering either board.

Everything below is measured on the actual units in use, not read off a
datasheet. Where a value was verified on hardware it says so.

## All boards

Five board types, three independent tracking systems. Two of them share one
USB-serial transport and one bridge; the third skips both. All three write
through the same `ingest` RPC into the same two tables.

| Board | Role | Radio | Knows its position | Bring-up verified |
| --- | --- | --- | --- | --- |
| LILYGO T-Beam V1.2 (AXP2101) ×2 | GPS tag | LoRa SX1276 @923 MHz | Yes, GNSS | **Yes** |
| LILYGO T-Echo | LoRa gateway | LoRa SX1262 @923 MHz | Yes, own GNSS | **Yes** |
| Seeed XIAO nRF54L15 | CS tag | BLE Channel Sounding | **No** — only gets ranged | Not in this bring-up |
| Seeed XIAO nRF54L15 | CS gateway | BLE Channel Sounding | No GNSS on board | Not in this bring-up |
| LILYGO T-SIM7000G | Cellular tag | LTE CAT-M / NB-IoT | Yes, GNSS in the modem | Not in this bring-up |

| | LoRa system | Channel Sounding system | Cellular system |
| --- | --- | --- | --- |
| Toolchain | Arduino / PlatformIO | Zephyr / nRF Connect SDK ≥3.0.1 | Arduino / PlatformIO |
| Observation | A position (`lat`/`lng`) | A distance (`distance_m`) | A position (`lat`/`lng`) |
| Identity | ESP32 efuse MAC, 12 hex | `FICR.DEVICEID`, 16 hex | Modem IMEI, 15 digits |
| Needs a gateway | Yes, the T-Echo | Yes, the XIAO gateway | **No** |
| Holds an ingest key | No | No | **Yes**, its own |
| `devices.link` | `lora` | `ble_cs` | `cellular` |

All three refuse to fabricate their measurement: a LoRa or cellular tag with no
fix sends `lat`/`lng` as `null`, a CS gateway with a failed session sends
`distance_m: null`.

## Radio settings — identical on every board

| Setting | Value |
| --- | --- |
| Frequency | **923.0 MHz** (AS923) |
| Bandwidth | 125 kHz |
| Spreading factor | **7** |
| Coding rate | **4/5** |
| Sync word | `0x12` (private) |
| TX power | 17 dBm |
| Airtime | **234 ms** measured for a ~141-byte packet |

A mismatch in *any* of these means the gateway hears nothing, with no error to
show for it. Frequency must match the number printed on the shield can, not just
your region — a 923 MHz module driven at 868 or 915 links over a few metres and
transmits out of band.

**Why SF7 and not SF9:** at SF9/CR4-7 the same packet occupied the channel for
**1003 ms measured**. With several tags sharing one frequency that is a 33% duty
cycle each, which guarantees collisions and exceeds the duty-cycle limits of most
sub-GHz bands. SF7/CR4-5 costs ~5 dB of link budget, cheap against the measured
margin (−33 to −86 dBm).

## Tags — LILYGO T-Beam V1.2 (AXP2101) ×2

ESP32 + SX1276 + u-blox NEO-6M, 18650 holder. Board marking
`TBeam-AXP2101-V1.2`, PCB date `20230508`, FCC `2ASYE-T-BEAM`.

| Item | Verified value |
| --- | --- |
| SoC | ESP32-D0WDQ6-V3 rev3, 2 cores @ 240 MHz |
| Flash / PSRAM | 4 MB / **4 MB present** (measured, not assumed) |
| LoRa | SX1276, shield marked 923 MHz |
| PMU | **AXP2101** at I²C `0x34` |
| GNSS | u-blox NEO-6M, 9600 baud, **GPS L1 only** |
| OLED | SSD1306 128×64 at I²C `0x3C` — **populated on these units** |
| USB bridge | CH9102 (`1a86:55d4`) |

Power rails, read back from the PMU at boot:

| Rail | Powers | Measured |
| --- | --- | --- |
| DCDC1 | ESP32 core — **never switch off** | on, 3300 mV |
| ALDO2 | LoRa | on, 3300 mV |
| ALDO3 | GNSS | on, 3300 mV |

The firmware sets ALDO2/ALDO3 explicitly rather than trusting the defaults: a
board that came up with the GNSS rail off produces zero NMEA, which reads like a
wiring fault.

> **V1.1 vs V1.2:** on V1.1 the ESP32 ran from the AXP192's DCDC3; on V1.2 it
> runs from the AXP2101's **DCDC1**. Porting power-saving code that disables
> DCDC1 cuts power to the processor mid-execution. `XPowersLib` has no unified
> PMU class — it exposes `XPowersAXP192` and `XPowersAXP2101` separately, so the
> firmware keeps one instance of each and uses whichever answers.

### Tag identity

No `TAG_ID` setting. Each board derives a globally unique id at boot from its
factory-programmed 48-bit efuse MAC, so one firmware image serves every tag with
no per-board build or provisioning. The units in use report:

```
D447A9BBBC2C
DC43A9BBBC2C
```

A full RFC-4122 UUID would be 36 characters of airtime on every packet forever
for no extra uniqueness. Map this id to a UUID in the database if the wider
system needs one, where the bytes are free.

### GNSS quirks on these units

* Ships with **GSA and GSV disabled** — only `RMC` and `GGA` are emitted. GSV is
  what reports *satellites in view*, so without it you lose the "6 visible but
  no fix yet" signal. `firmware/tbeam-selftest` re-enables both over UBX
  `CFG-MSG` (volatile, not saved to the module).
* `hdop` of **99.99** is the NMEA "no usable fix" sentinel, and `TinyGPSPlus`
  reports it as a *valid* parse. The firmware sends `null` instead so a sentinel
  is never stored as a measurement.
* **No demo/fallback location.** See `packet-format.md` → `status`.

## Gateway — LILYGO T-Echo (nRF52840 + SX1262)

LoRa receiver, e-paper status screen, its own GNSS, USB serial out.

| Item | Verified value |
| --- | --- |
| MCU | nRF52840 |
| LoRa | SX1262, TCXO at RadioLib's default **1.6 V** (works) |
| GNSS | **Quectel L76K**, 9600 baud, on `Serial1` |
| Display | **GDEH0154D67**, 200×200, SSD1681 controller |
| PlatformIO board | `nrf52840_dk_adafruit` |

### Why `nrf52840_dk_adafruit`

PlatformIO has no dedicated T-Echo board and none is needed. LilyGO's own repo
targets the same board, and its `pca10056` variant maps Arduino pin N straight
onto **P0.N** (and `32+N` onto P1.N) — exactly the raw port numbering the pin
table uses. The board's factory firmware even reports itself as "nRF52840 DK".

### Two gotchas that cost real time

* **`Power enable` (P0.12) must be driven HIGH** or the GNSS rail stays dark and
  the receiver produces nothing.
* **The e-paper needs its own SPI bus.** `SPI_INTERFACES_COUNT` is 1 and the
  SX1262 owns it, so the panel gets a second `SPIClass` on `NRF_SPIM2`. Bare
  `SPI.begin()` puts the radio bus on the variant defaults (P1.13/14/15) instead
  of the T-Echo's P0.19/22/23, and the SX1262 never answers.

### E-paper refresh cost

Updates **block the receive loop** — the radio hears nothing while the panel
writes. Measured:

| Refresh | Duration |
| --- | --- |
| Partial | **433 ms** |
| Full | **4388 ms** |

So the screen redraws on a timer with partial refreshes, and the first full one
runs during setup *before* the radio starts listening. A full refresh while
listening cost 4 packets in testing. Rotation is **3**; rotation 1 renders the
screen upside down.

### USB identities

The nRF52 changes USB identity between modes, which matters when passing it
through to WSL2 — each identity must be bound separately:

| VID:PID | Mode |
| --- | --- |
| `239a:80da` | LilyGO factory firmware |
| `239a:002a` | Adafruit DFU bootloader |
| `239a:8029` | This project's firmware |

## Power

* **Tags:** Li-ion 18650, voltage read over I²C from the PMU as `battery_mv`
  (there is no battery-voltage divider on a GPIO on V1.2). With no cell fitted,
  `battery_mv` reads 0 and `vbus` reads yes.
* **Gateway:** USB from the bridge host.

## Multi-tag operation

Tags transmit as a pure-ALOHA network — nothing coordinates them. Two mitigations
in firmware, both needed:

* **Interval jitter** seeded from the efuse MAC. Without it, two tags on an
  identical fixed period that drift into alignment collide on *every* cycle.
* **Listen-before-talk** (channel activity detection) before each transmit, so a
  tag defers rather than talking over a packet in flight and destroying both.

Measured with two tags at a 3 s interval: **59 sent, 59 received, 0 CRC errors**.
At ~15% combined duty cycle this scales to roughly 8–10 tags before collisions
bite; past that, lengthen the interval or move to a binary payload.

## Channel Sounding boards — Seeed XIAO nRF54L15 ×2

A second, independent radio system. These measure **distance**, not position, and
were **not part of the LoRa bring-up above** — the values here come from the
firmware sources and their READMEs, not from bench measurement.

| Item | Value |
| --- | --- |
| MCU | Nordic nRF54L15 |
| Zephyr board target | `xiao_nrf54l15/nrf54l15/cpuapp` |
| SDK | nRF Connect SDK **≥ 3.0.1**, built against v3.4.0 |
| Radio | Bluetooth **Channel Sounding** (needs a qualified host + controller) |
| GNSS | **None** |
| Debug / flash | Onboard **CMSIS-DAP v2** probe — **no UF2 bootloader**, so no drag-and-drop drive |
| Identity | 64-bit `FICR.DEVICEID` via Zephyr `hwinfo`, 16 lowercase hex |

Two roles from the same board:

| Firmware | CS role | Based on NCS sample |
| --- | --- | --- |
| `firmware/xiao-cs-tag` | Reflector + RAS server | `channel_sounding/ras_reflector` |
| `firmware/xiao-cs-gateway` | Initiator | `channel_sounding/ras_initiator` |

### Why the identity is `FICR.DEVICEID`

Factory-programmed into silicon, so it survives reflash, full erase and BLE
address randomisation. Deliberately **not** the BLE MAC — that randomises, which
would make one tag look like an endless stream of new ones — and not generated at
boot, so it never changes. If the UID cannot be read the tag **refuses to
advertise** rather than coming up anonymous, because unattributable observations
in the database are worse than a visibly dead tag.

### No external pin map

Unlike the LoRa boards there is nothing to wire: the radio is on-die and there is
no GNSS, display or PMU. The only tuning knob is the advertising interval
(`TAG_ADV_INTERVAL_MIN`/`MAX`, currently 250–350 ms) — widen it to trade
discovery latency for battery life, since advertising is the tag's only radio
activity between ranging sessions.

### Shared with the LoRa path

Same USB-serial JSON transport, same bridge, same `devices` table for gateway
authentication, same `ingest` RPC. A CS gateway line looks exactly like a LoRa
one: the tag's reading nested under `payload`, just carrying `distance_m` where
a GPS tag carries `lat`/`lng`. Its self-report line says `"status":"no_gps"`
with null coordinates — honest for a board with no GNSS.

Full detail: `setup-cs-firmware.md`, `packet-format.md`, and the two firmware
READMEs.

## LILYGO T-SIM7000G — cellular tag

ESP32-WROVER-B + SIMCom SIM7000G. The modem carries the GNSS receiver, so there
is no separate GPS chip and no second UART — position and network both go over
the same AT interface.

**What makes it different:** no gateway. It reaches Supabase itself over LTE, so
it holds an ingest key of its own and never touches the bridge. That is also
what makes it the only board here that needs a per-board build: a key identifies
a device, so two boards sharing one would be one device in the database.

Practical constraints, before ordering hardware:

* **CAT-M or NB-IoT coverage is not universal.** Check your carrier before
  committing. A 2G/3G-only SIM will not attach with `NETWORK_MODE 38`.
* **Two antennas**, LTE and GNSS, on separate connectors.
* **~2 A current spikes** on transmit. USB alone browns it out on many hubs; the
  symptom is a board that reboots mid-POST rather than an obvious power fault.
  Keep the LiPo connected.
* **Battery life is hours, not weeks** at the default 30 s interval — there is
  no deep sleep, because re-attaching to the network on every wake costs more
  than it saves at that cadence.

Full detail: `../firmware/tsim7000g-tag/README.md`.

## Pin tables

See `pinout.md`.
