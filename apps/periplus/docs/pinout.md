# Pinouts

> ⚠️ Verify against your physical board revision — check the silkscreen and the
> official LilyGO repos. Pin maps differ between revisions.

The tables below were **confirmed on the actual boards** during bring-up (see
`hardware.md`), not copied from a reference design.

## T-Beam tag — V1.2 (AXP2101), ESP32 + SX1276

| Function | GPIO |
| --- | --- |
| I2C SDA | 21 |
| I2C SCL | 22 |
| GNSS TX (→ ESP32 RX) | 34 |
| GNSS RX (← ESP32 TX) | 12 |
| LoRa SCK | 5 |
| LoRa MISO | 19 |
| LoRa MOSI | 27 |
| LoRa RESET | 23 |
| LoRa DIO0 | 26 |
| LoRa DIO1 | 33 |
| LoRa DIO2 | 32 |
| LoRa CS | 18 |
| Button1 | 38 |
| PMU IRQ | 35 |
| Onboard LED | 4 (active low) |

> Note: GNSS TX/RX wiring direction matters. In `config.h`, `GPS_RX_PIN` is the
> ESP32 pin that receives GPS data (connected to the GPS module's TX), so
> `GPS_RX_PIN = 34` and `GPS_TX_PIN = 12`. GPIO34 is input-only and physically
> cannot drive a UART TX, which makes this direction the only possible one. The
> V1.2 silkscreen prints the same table from the GNSS module's point of view
> (`TX | IO34(RX)`, `RX | IO12(TX)`), which reads as reversed — it is not.

> Note: on SX1276/78 boards GPIO32 is **DIO2**, not an SX1262 `BUSY` line.
> Firmware that treats it as `BUSY` waits forever for a signal that never comes.
> Keep `LORA_BUSY` at `-1` unless the board really carries an SX1262.

Reference: https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/docs/en/t_beam/t_beam_hw.md

## T-Echo gateway — nRF52840 + SX1262, Arduino numbering

| Function | Arduino pin |
| --- | --- |
| LoRa MOSI | 22 |
| LoRa MISO | 23 |
| LoRa SCLK | 19 |
| LoRa BUSY | 17 |
| LoRa CS | 24 |
| LoRa RST | 25 |
| LoRa DIO1 | 20 |
| LoRa DIO3 | 21 |
| GPS TX | 40 |
| GPS RX | 41 |
| GPS PPS | 36 |
| GPS Wakeup | 34 |
| GPS RESET | 37 |
| Battery ADC | 4 |
| User Button | 42 (active low) |
| **Power enable** | **12** (drive HIGH or GPS stays unpowered) |
| E-paper MISO | 38 |
| E-paper MOSI | 29 |
| E-paper SCLK | 31 |
| E-paper CS | 30 |
| E-paper DC | 28 |
| E-paper RST | 2 |
| E-paper BUSY | 3 |
| E-paper backlight | 43 |

> Note: these are raw port numbers (`P0.n` = `n`, `P1.n` = `32 + n`), which work
> directly because the `nrf52840_dk_adafruit` variant maps Arduino pin N onto
> P0.N. Source: LilyGO's own `examples/Factory/utilities.h`.

> The e-paper is a **GDEH0154D67** (200×200, SSD1681) on a **separate SPI bus**
> from the SX1262. The variant exposes only one `SPI` object, which the radio
> already owns, so the panel gets its own `SPIClass` on `NRF_SPIM2`.

> The GPS is a **Quectel L76K at 9600 baud** on `Serial1`, and it will produce
> nothing at all until `Power enable` (pin 12) is driven HIGH.

Reference: https://github.com/Xinyuan-LilyGO/T-Echo

RadioLib is constructed as `Module(CS, DIO1, RST, BUSY)`.

The gateway firmware uses **all** of the above: the LoRa pins, the e-paper, and
its own GNSS (it reports its position so the map has an anchor). Earlier
revisions of this file said the GPS was unused — it is not.

## CS tag / gateway (Seeed XIAO nRF54L15)

No pin map — and nothing to verify. Channel Sounding runs on the nRF54L15's
on-die radio, and neither firmware drives a GNSS, display or PMU, so there is no
external wiring to get wrong.

| Interface | Notes |
| --- | --- |
| Radio | On-die BLE, no external module or antenna wiring |
| Flash / debug | Onboard CMSIS-DAP v2 probe, USB — no UF2 drive |
| Serial console | USB CDC at 115200 |

Board target `xiao_nrf54l15/nrf54l15/cpuapp`; Zephyr's board definition supplies
everything else. Reference: `setup-cs-firmware.md`.

## Cellular tag (LILYGO T-SIM7000G)

ESP32-WROVER-B + SIMCom SIM7000G. Everything — network *and* GNSS — goes over
the modem's AT interface on one UART; there is no separate GPS receiver to wire.

| Signal | ESP32 pin | Notes |
| --- | --- | --- |
| Modem TX | 27 | ESP32 TX → SIM7000 RX |
| Modem RX | 26 | ESP32 RX ← SIM7000 TX |
| Modem PWRKEY | 4 | Low pulse >1 s toggles the modem on/off |
| Modem DTR | 25 | Hold LOW to keep the modem out of sleep |
| LED | 12 | **Active LOW** |
| Battery ADC | 35 | 1:2 divider. The firmware reads the battery from the modem (`AT+CBC`) instead — one source, one calibration knob |
| Solar ADC | 36 | Unused by this firmware |
| SD card | SCLK 14, MISO 2, MOSI 15, CS 13 | Unused by this firmware |

> The modem draws **~2 A current spikes** on transmit. USB alone browns it out
> on many hubs, and the symptom is a board that reboots mid-POST rather than an
> obvious power fault. Keep the LiPo connected.

> **Two antennas**, on separate connectors: LTE and GNSS. Neither is optional —
> without the GNSS antenna the board will report `acquiring` forever.

> **GNSS and cellular cannot run at the same time.** LILYGO's manual: "disconnect
> the network when positioning, and turn off GPS when connecting to the network."
> The firmware alternates the two in `loop()`; leaving the receiver powered while
> the modem is attached is the usual reason a board never gets a fix.

Verify against your revision before flashing:
https://github.com/Xinyuan-LilyGO/LilyGO-T-SIM7000G
