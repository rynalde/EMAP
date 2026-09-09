// config.example.h — copy to config.h and adjust for your board/region.
//
// IMPORTANT: config.h is gitignored. Never commit real keys.
#pragma once

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
// There is no TAG_ID setting. Each board derives its own globally unique id at
// boot from the ESP32's factory-programmed 48-bit efuse MAC, so every tag runs
// the identical firmware image with no per-board build or provisioning step,
// and the id survives reflashing and factory-erase.
#define FW_VERSION        "mvp-0.1.0"

// ---------------------------------------------------------------------------
// LoRa radio
// ---------------------------------------------------------------------------
// Set the frequency printed on the shield can of YOUR board — not just your
// region. The value must match the module's matching network:
//   433 MHz (SX1278): 433.0   -> CN470 / EU433
//   868 MHz (SX1276): 868.0   -> EU868
//   915 MHz (SX1276): 915.0   -> US915 / AU915
//   923 MHz (SX1276): 923.0   -> AS923
#define LORA_FREQUENCY        915.0     // MHz
// SF7 + CR4/5 rather than SF9 + CR4/7: at SF9 a ~140-byte packet occupies the
// channel for a full second (measured 1003 ms). With several tags sharing one
// frequency and no coordination, that guarantees collisions and blows past the
// duty-cycle limits of most sub-GHz bands. SF7/CR4/5 cuts it to ~230 ms at a
// cost of roughly 5 dB of link budget, which is cheap given the measured
// margin. Tag and gateway MUST match.
#define LORA_BANDWIDTH        125.0     // kHz
#define LORA_SPREADING_FACTOR 7         // 7..12
#define LORA_CODING_RATE      5         // 4/5..4/8  -> 5..8
#define LORA_SYNC_WORD        0x12      // private network; gateway must match
#define LORA_TX_POWER_DBM     17        // dBm

// Select the LoRa chip on YOUR T-Beam. Define exactly ONE.
//   SX1276 / SX1278 are the most common older T-Beams.
//   SX1262 is on newer T-Beam Supreme / some 1.x revisions.
#define LORA_CHIP_SX1276   1
// #define LORA_CHIP_SX1262   1

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
#define SEND_INTERVAL_MS              3000     // send a packet every N ms

// Random extra delay added to every interval. Without it, two tags on the same
// fixed period that happen to align stay aligned and collide on every single
// cycle. The jitter is seeded from the efuse MAC, so no two tags share a
// sequence. Keep it a meaningful fraction of the interval.
#define SEND_JITTER_MS                800

// Listen-before-talk: how long to wait for a clear channel before giving up on
// this cycle. Must comfortably exceed one packet's airtime (~230 ms at SF7).
#define LBT_MAX_WAIT_MS               600

// ---------------------------------------------------------------------------
// Position reporting
// ---------------------------------------------------------------------------
// There is no demo/fallback location. The tag transmits on every interval
// regardless of GPS state and reports a "status" field describing it:
//
//   fix        current valid fix, lat/lng live
//   stale      fix aged out, lat/lng are the last known position
//   acquiring  NMEA flowing but no fix yet, lat/lng null
//   no_gps     no bytes from the receiver at all, lat/lng null
//
// A fabricated coordinate is worse than no coordinate: it is indistinguishable
// from a real one downstream. When the tag does not know where it is, it says
// so and sends null.

// ---------------------------------------------------------------------------
// Pin map — VERIFY against your board revision before flashing!
// Defaults below are the common T-Beam SX1276/SX1278 mapping.
// Ref: https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/docs/en/t_beam/t_beam_hw.md
// ---------------------------------------------------------------------------
#define I2C_SDA        21
#define I2C_SCL        22

// SSD1306 128x64 OLED. Shares the I2C bus with the PMU (0x34). Shipped as an
// unpopulated footprint on many boards — the firmware probes for it and falls
// back to serial-only output when absent, so this is safe to leave defined.
#define OLED_I2C_ADDR  0x3C

#define GPS_RX_PIN     34   // GPS TX -> ESP32 RX
#define GPS_TX_PIN     12   // GPS RX <- ESP32 TX
#define GPS_BAUD       9600

#define LORA_SCK       5
#define LORA_MISO      19
#define LORA_MOSI      27
#define LORA_CS        18
#define LORA_RST       23
#define LORA_DIO0      26   // SX127x: DIO0 (RxDone/TxDone). Verify on your board.
#define LORA_DIO1      33
#define LORA_DIO2      32   // SX127x only. On SX1262 boards GPIO32 is BUSY instead.
#define LORA_BUSY      -1   // SX1262 only; keep -1 on SX1276/78 or init will hang

#define BUTTON_PIN     38
#define PMU_IRQ        35
