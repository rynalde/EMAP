// tbeam-tag.ino — periplus, T-Beam battery-powered GPS tag.
//
// Flow:
//   boot -> derive tag id from efuse MAC -> init PMU/battery -> init GPS ->
//   init LoRa -> loop: read GPS, build JSON payload (position + status, never
//   a fabricated one), transmit over raw LoRa P2P every SEND_INTERVAL_MS.
//
// Libraries (install via Arduino Library Manager):
//   - RadioLib            (Jan Gromes)         radio driver, SX127x + SX126x
//   - TinyGPSPlus         (Mikal Hart)         NMEA parsing
//   - XPowersLib          (lewisxhe)           AXP192 / AXP2101 PMU (optional)
//
// Board: "T-Beam" / ESP32 Dev Module. Set the correct LoRa chip in config.h.
//
// ⚠️ SAFETY: Never transmit LoRa without the antenna connected. You can damage
//    the radio's power amplifier. Attach the antenna before powering on.

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <RadioLib.h>
#include <TinyGPSPlus.h>

#include "config.h"

#if defined(LORA_CHIP_SX1262)
SX1262 radio = new Module(LORA_CS, LORA_DIO1, LORA_RST, LORA_BUSY);
#else
SX1276 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST, LORA_DIO1);
#endif

TinyGPSPlus gps;
HardwareSerial GPSSerial(1);

#if __has_include(<XPowersLib.h>)
#include <XPowersLib.h>
#define HAVE_PMU 1
// XPowersLib has no unified PMU class: the T-Beam carries an AXP192 on older
// revisions and an AXP2101 on newer ones. Keep one instance of each and use
// whichever answers on the I2C bus. (enableBattDetection() is not part of
// XPowersLibInterface, so a base-class pointer would not reach it.)
XPowersAXP2101 pmu2101;
XPowersAXP192 pmu192;
bool pmuOk = false;
bool pmuIs2101 = false;
#endif

#if __has_include(<U8g2lib.h>)
#include <U8g2lib.h>
#define HAVE_OLED 1
// SSD1306 128x64 on the shared I2C bus. The V1.2 ships this footprint
// unpopulated, so the panel is probed before use rather than assumed.
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
bool oledOk = false;
#endif

// Globally unique per-board identifier, sent as `device_id` — the one field
// every device in this project reports under, whatever radio it carries.
// Derived at boot from the ESP32's factory-programmed 48-bit efuse MAC. Every tag runs the identical firmware
// image and self-assigns its id — no per-board build, no provisioning step, no
// stored state to lose, and it survives reflash and factory-erase.
//
// A full RFC-4122 UUID string would be 36 characters. Over LoRa that is airtime
// paid on every single packet forever, for no extra uniqueness: the efuse MAC
// is already globally unique and fits in 12 hex characters. If the wider system
// needs canonical UUIDs, map this id to one in the database, where the extra
// bytes are free.
char tagId[13];

uint32_t seq = 0;
uint32_t lastSendMs = 0;
uint32_t sendDelayMs = SEND_INTERVAL_MS;   // re-rolled with jitter each cycle
uint32_t deferrals = 0;                    // cycles skipped because channel was busy
uint32_t bootMs = 0;
int lastTxState = RADIOLIB_ERR_UNKNOWN;   // shown on the OLED; UNKNOWN = not sent yet

// Track whether we have ever had a real fix, and the last known coordinates, so
// that a transient GPS dropout reports the last position as status="stale"
// rather than dropping straight back to null.
bool everHadFix = false;
double lastLat = 0.0;
double lastLng = 0.0;

static void initTagId() {
  uint64_t mac = ESP.getEfuseMac();
  snprintf(tagId, sizeof(tagId), "%04X%08X",
           (uint16_t)(mac >> 32), (uint32_t)mac);
  // Seed from the same unique value, so two tags never draw the same jitter
  // sequence and cannot stay phase-locked to each other.
  randomSeed((uint32_t)mac ^ (uint32_t)(mac >> 32));
}

// Interval + a random slice. Several tags sharing one frequency transmit as a
// pure-ALOHA network: nothing coordinates them, so two on an identical fixed
// period that drift into alignment would then collide on every cycle forever.
// Jitter guarantees they walk apart again.
static uint32_t nextSendDelay() {
  return SEND_INTERVAL_MS + (uint32_t)random(0, SEND_JITTER_MS + 1);
}

// Listen before talk. Channel activity detection is cheap (a few symbols) and
// stops this tag from transmitting on top of a packet already in flight —
// which would otherwise destroy both its own packet and the other tag's.
static bool waitForClearChannel() {
  uint32_t deadline = millis() + LBT_MAX_WAIT_MS;
  do {
    if (radio.scanChannel() == RADIOLIB_CHANNEL_FREE) {
      return true;
    }
    delay(random(20, 90));   // random backoff, so two waiters do not resync
  } while (millis() < deadline);
  return false;
}

static void initPMU() {
#ifdef HAVE_PMU
  // Try AXP2101 first, then AXP192. Either may be present depending on revision.
  if (pmu2101.begin(Wire, AXP2101_SLAVE_ADDRESS, I2C_SDA, I2C_SCL)) {
    pmuOk = true;
    pmuIs2101 = true;
    Serial.println("[BOOT] PMU AXP2101 detected");
  } else if (pmu192.begin(Wire, AXP192_SLAVE_ADDRESS, I2C_SDA, I2C_SCL)) {
    pmuOk = true;
    pmuIs2101 = false;
    Serial.println("[BOOT] PMU AXP192 detected");
  } else {
    Serial.println("[BOOT] no PMU detected (battery_mv will be estimated)");
  }
  if (pmuOk) {
    // Explicitly power the GPS + LoRa rails. Both PMUs are meant to bring these
    // up enabled, but a board that came up with the GNSS rail off produces no
    // NMEA at all, which reads like a wiring fault. The rail names differ per
    // revision: V1.2/AXP2101 uses ALDO2 (LoRa) + ALDO3 (GNSS), V1.1/AXP192 uses
    // LDO2 + LDO3. Never touch DCDC1 on V1.2 — that is the ESP32 core itself.
    if (pmuIs2101) {
      pmu2101.setALDO2Voltage(3300);
      pmu2101.enableALDO2();
      pmu2101.setALDO3Voltage(3300);
      pmu2101.enableALDO3();
      pmu2101.enableBattDetection();
    } else {
      pmu192.setLDO2Voltage(3300);
      pmu192.enableLDO2();
      pmu192.setLDO3Voltage(3300);
      pmu192.enableLDO3();
      pmu192.enableBattDetection();
    }
  }
#endif
}

static int readBatteryMv() {
#ifdef HAVE_PMU
  if (pmuOk) {
    // millivolts
    return (int)(pmuIs2101 ? pmu2101.getBattVoltage() : pmu192.getBattVoltage());
  }
#endif
  return 0; // unknown; gateway/Supabase treats 0/absent as no reading
}

// Defined further down next to the payload builder; declared here so the OLED
// shows the same status string that goes out over the air.
static const char *gpsStatus(bool haveFix, bool havePosition);

static void initOLED() {
#ifdef HAVE_OLED
  // Probe before driving it: writing to an absent panel is harmless but leaves
  // a misleading "display ok" impression in the boot log.
  Wire.beginTransmission(OLED_I2C_ADDR);
  if (Wire.endTransmission() != 0) {
    Serial.println("[OLED] none at 0x3C (footprint unpopulated) — serial only");
    return;
  }
  oled.begin();
  oled.setBusClock(400000);
  oled.setFont(u8g2_font_5x7_tf);
  oledOk = true;
  Serial.println("[OLED] SSD1306 detected at 0x3C");

  oled.clearBuffer();
  oled.drawStr(0, 7, "LoRa GPS Tag");
  oled.drawStr(0, 17, (String(tagId) + "  " FW_VERSION).c_str());
  oled.drawStr(0, 30, "booting...");
  oled.sendBuffer();
#endif
}

// Live status panel. Mirrors what goes out over LoRa so the board can be read
// in the field without a serial console attached.
static void drawStatus(int batteryMv) {
#ifdef HAVE_OLED
  if (!oledOk) return;

  char line[32];
  bool haveFix = gps.location.isValid() && gps.location.age() < 5000;

  oled.clearBuffer();

  snprintf(line, sizeof(line), "%s seq%lu", tagId, (unsigned long)seq);
  oled.drawStr(0, 7, line);
  oled.drawHLine(0, 9, 128);

  // Same status vocabulary as the serial log and the LoRa payload, so what is
  // on the panel matches what the software receives.
  snprintf(line, sizeof(line), "%s sat%02d hdop%.1f",
           gpsStatus(haveFix, haveFix || everHadFix),
           gps.satellites.isValid() ? gps.satellites.value() : 0,
           gps.hdop.isValid() ? gps.hdop.hdop() : 0.0);
  oled.drawStr(0, 19, line);

  if (haveFix || everHadFix) {
    snprintf(line, sizeof(line), "lat %.6f",
             haveFix ? gps.location.lat() : lastLat);
    oled.drawStr(0, 28, line);
    snprintf(line, sizeof(line), "lng %.6f",
             haveFix ? gps.location.lng() : lastLng);
    oled.drawStr(0, 37, line);
  } else {
    oled.drawStr(0, 28, "lat  --.------");
    oled.drawStr(0, 37, "lng  --.------");
  }

  if (gps.time.isValid()) {
    snprintf(line, sizeof(line), "UTC %02d:%02d:%02d",
             gps.time.hour(), gps.time.minute(), gps.time.second());
  } else {
    snprintf(line, sizeof(line), "UTC --:--:--");
  }
  oled.drawStr(0, 46, line);

  if (batteryMv > 0) {
    snprintf(line, sizeof(line), "BAT %dmV", batteryMv);
  } else {
    snprintf(line, sizeof(line), "BAT n/a");
  }
  oled.drawStr(0, 55, line);

  snprintf(line, sizeof(line), "%.1fMHz %s", (double)LORA_FREQUENCY,
           lastTxState == RADIOLIB_ERR_NONE ? "TX ok"
           : lastTxState == RADIOLIB_ERR_UNKNOWN ? "idle" : "TX ERR");
  oled.drawStr(0, 64, line);

  oled.sendBuffer();
#else
  (void)batteryMv;
#endif
}

static void initLoRa() {
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);

  Serial.print("[LORA] init ... ");
  int state = radio.begin(LORA_FREQUENCY, LORA_BANDWIDTH, LORA_SPREADING_FACTOR,
                          LORA_CODING_RATE, LORA_SYNC_WORD, LORA_TX_POWER_DBM);
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("ok");
  } else {
    Serial.printf("FAILED code=%d (check chip select in config.h)\n", state);
    while (true) delay(1000);
  }
}

static void feedGPS(uint32_t forMs) {
  uint32_t start = millis();
  while (millis() - start < forMs) {
    while (GPSSerial.available() > 0) {
      gps.encode(GPSSerial.read());
    }
    delay(1);
  }
}

// GPS state reported alongside every packet, so the software can tell a real
// position from a stale one and a starving receiver from a dead one.
//
//   "fix"       current valid fix; lat/lng are live
//   "stale"     had a fix, it aged out; lat/lng are the last known position
//   "acquiring" NMEA is flowing but no fix yet; lat/lng are null
//   "no_gps"    no bytes from the receiver at all; lat/lng are null
//
// The tag NEVER fabricates a position. When it does not know where it is, it
// says so and sends null — a wrong coordinate is worse than no coordinate.
static const char *gpsStatus(bool haveFix, bool havePosition) {
  if (haveFix) return "fix";
  if (havePosition) return "stale";
  if (gps.charsProcessed() == 0) return "no_gps";
  return "acquiring";
}

static String buildPayload(const char *status, bool haveFix, bool havePosition,
                           double lat, double lng, int sats, double hdop,
                           int batteryMv) {
  // Hand-built JSON keeps the payload small and avoids a JSON lib dependency.
  // Unknown numeric fields are emitted as JSON null rather than a sentinel:
  // the ingest function maps null straight through, whereas 0 or 99.99 would
  // be stored as if it were a measurement.
  String json = "{";
  json += "\"device_id\":\"" + String(tagId) + "\",";
  json += "\"seq\":" + String(seq) + ",";
  json += "\"status\":\"" + String(status) + "\",";
  json += "\"fix\":" + String(haveFix ? "true" : "false") + ",";
  if (havePosition) {
    json += "\"lat\":" + String(lat, 6) + ",";
    json += "\"lng\":" + String(lng, 6) + ",";
  } else {
    json += "\"lat\":null,\"lng\":null,";
  }
  json += "\"battery_mv\":" + String(batteryMv) + ",";
  json += "\"sats\":" + String(sats) + ",";
  // 99.99 is the NMEA "no usable fix" sentinel, and TinyGPSPlus reports it as a
  // valid parse. Emitting it as a number would store a sentinel as if it were a
  // real dilution-of-precision measurement.
  bool hdopUsable = gps.hdop.isValid() && hdop > 0.0 && hdop < 99.0;
  json += "\"hdop\":" + (hdopUsable ? String(hdop, 2) : String("null")) + ",";
  json += "\"fw\":\"" FW_VERSION "\"";
  json += "}";
  return json;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  bootMs = millis();
  initTagId();
  Serial.println("[BOOT] T-Beam tag starting");
  Serial.printf("[BOOT] fw=%s tag_id=%s (from efuse MAC)\n", FW_VERSION, tagId);
  Serial.println("[BOOT] ANTENNA WARNING: ensure LoRa antenna is connected!");

  // Shared bus: PMU at 0x34 and the OLED footprint at 0x3C.
  Wire.begin(I2C_SDA, I2C_SCL);

  initPMU();
  initOLED();

  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("[GPS] serial started");

  initLoRa();
}

void loop() {
  // Continuously feed the GPS parser between transmissions.
  feedGPS(50);

  if (millis() - lastSendMs < sendDelayMs && seq != 0) {
    return;
  }

  bool haveFix = gps.location.isValid() && gps.location.age() < 5000;
  int sats = gps.satellites.isValid() ? gps.satellites.value() : 0;
  double hdop = gps.hdop.isValid() ? gps.hdop.hdop() : 0.0;
  int batteryMv = readBatteryMv();

  double lat = 0.0, lng = 0.0;

  if (haveFix) {
    lat = gps.location.lat();
    lng = gps.location.lng();
    lastLat = lat;
    lastLng = lng;
    everHadFix = true;
  } else if (everHadFix) {
    // Lost a previously-acquired fix: keep reporting the last known position,
    // flagged as stale so the software can age it out on its own terms.
    lat = lastLat;
    lng = lastLng;
  }

  // A packet goes out on every interval regardless of GPS state. Silence is
  // ambiguous — it cannot be told apart from a dead tag or a broken link.
  bool havePosition = haveFix || everHadFix;
  const char *status = gpsStatus(haveFix, havePosition);

  seq++;

  if (havePosition) {
    Serial.printf("[GPS] status=%s lat=%.6f lng=%.6f sats=%d hdop=%.2f\n",
                  status, lat, lng, sats, hdop);
  } else {
    Serial.printf("[GPS] status=%s no position yet, sats=%d nmea_bytes=%lu\n",
                  status, sats, (unsigned long)gps.charsProcessed());
  }
  Serial.printf("[BAT] battery_mv=%d\n", batteryMv);

  String payload = buildPayload(status, haveFix, havePosition, lat, lng,
                                sats, hdop, batteryMv);

  // Stamp the interval from the START of the cycle, not the end.
  // radio.transmit() blocks for the whole airtime, so stamping afterwards made
  // the real period interval+airtime — a requested 3 s came out as 4 s.
  lastSendMs = millis();
  sendDelayMs = nextSendDelay();

  if (!waitForClearChannel()) {
    // Another tag held the channel for the whole window. Skipping is the right
    // move: transmitting anyway would corrupt both packets rather than one.
    // The next cycle uses fresh jitter, so the two will not stay in lockstep.
    deferrals++;
    Serial.printf("[LORA] channel busy for %dms, deferring seq=%lu (deferrals=%lu)\n",
                  LBT_MAX_WAIT_MS, (unsigned long)seq, (unsigned long)deferrals);
    drawStatus(batteryMv);
    return;
  }

  uint32_t txStart = millis();
  int state = radio.transmit(payload);
  lastTxState = state;
  if (state == RADIOLIB_ERR_NONE) {
    Serial.printf("[LORA] packet sent seq=%lu len=%u airtime=%lums next=+%lums\n",
                  (unsigned long)seq, payload.length(),
                  (unsigned long)(millis() - txStart),
                  (unsigned long)sendDelayMs);
  } else {
    Serial.printf("[LORA] transmit failed code=%d\n", state);
  }

  drawStatus(batteryMv);
}
