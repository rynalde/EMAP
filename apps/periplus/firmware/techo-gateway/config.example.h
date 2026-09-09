// config.example.h — copy to config.h and adjust for your board/region.
//
// IMPORTANT: config.h is gitignored.
#pragma once

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
#define GATEWAY_ID    "GW001"
#define FW_VERSION    "mvp-0.1.0"

// ---------------------------------------------------------------------------
// LoRa radio — MUST match the T-Beam tag settings exactly.
// ---------------------------------------------------------------------------
#define LORA_FREQUENCY        915.0     // MHz  (868.0 for EU)
// SF7 + CR4/5 rather than SF9 + CR4/7: at SF9 a ~140-byte packet occupies the
// channel for a full second (measured 1003 ms). With several tags sharing one
// frequency and no coordination, that guarantees collisions and blows past the
// duty-cycle limits of most sub-GHz bands. SF7/CR4/5 cuts it to ~230 ms at a
// cost of roughly 5 dB of link budget, which is cheap given the measured
// margin. Tag and gateway MUST match.
#define LORA_BANDWIDTH        125.0     // kHz
#define LORA_SPREADING_FACTOR 7         // 7..12
#define LORA_CODING_RATE      5         // 5..8 -> 4/5..4/8
#define LORA_SYNC_WORD        0x12      // private network
#define LORA_TX_POWER_DBM     17        // dBm (rx-only, but set for symmetry)

// ---------------------------------------------------------------------------
// Pin map — T-Echo (SX1262), Adafruit nRF52 Arduino numbering.
// VERIFY against your board revision.
// Ref: https://github.com/Xinyuan-LilyGO/T-Echo
// ---------------------------------------------------------------------------
#define LORA_MOSI     22
#define LORA_MISO     23
#define LORA_SCLK     19
#define LORA_CS       24
#define LORA_RST      25
#define LORA_BUSY     17
#define LORA_DIO1     20
#define LORA_DIO3     21

// ---------------------------------------------------------------------------
// On-board peripherals — T-Echo
// ---------------------------------------------------------------------------
// The nrf52840_dk_adafruit variant maps Arduino pin N onto P0.N (and 32+N onto
// P1.N), so these are the raw port numbers from LilyGO's own pin table.
// Ref: https://github.com/Xinyuan-LilyGO/T-Echo examples/Factory/utilities.h

// Must be driven HIGH or the GPS and peripheral rail stay unpowered.
#define POWER_ENABLE_PIN   12   // P0.12

// E-paper: GDEH0154D67, 200x200, SSD1681 controller. Its own SPI bus, separate
// from the SX1262 — the variant only exposes one SPI object, so the display
// gets a second SPIClass on NRF_SPIM2.
#define EPD_MISO           38   // P1.6
#define EPD_MOSI           29   // P0.29
#define EPD_SCLK           31   // P0.31
#define EPD_CS             30   // P0.30
#define EPD_DC             28   // P0.28
#define EPD_RST             2   // P0.2
#define EPD_BUSY            3   // P0.3
#define EPD_BACKLIGHT      43   // P1.11

// Quectel L76K on Serial1.
#define GPS_RX_PIN         41   // P1.9 — nRF52 receives GPS data here
#define GPS_TX_PIN         40   // P1.8
#define GPS_BAUD         9600

// ---------------------------------------------------------------------------
// Display behaviour
// ---------------------------------------------------------------------------
// E-paper refreshes are slow and block the receive loop, and the panel wears
// with every cycle. Packets arrive every few seconds, so the screen is redrawn
// on a timer instead of per packet.

// How often the gateway reports its own position and counters, independent of
// tag traffic. A gateway hearing no tags must still tell the dashboard where it
// is, or the map has no anchor precisely when it cannot get one from a tag.
#define GATEWAY_STATUS_MS    15000

#define DISPLAY_REFRESH_MS   20000
// Partial refreshes are fast but leave ghosting; a full one clears it.
// Measured on this panel: partial 433 ms, full 4388 ms. The radio is deaf for
// that whole window, so full refreshes are kept rare — at a 20 s cadence this
// is roughly one every 20 minutes. The first one runs during setup, before the
// radio starts listening, so it costs nothing.
#define DISPLAY_FULL_EVERY   60
// How many distinct tags to list.
#define RECENT_TAGS          4
