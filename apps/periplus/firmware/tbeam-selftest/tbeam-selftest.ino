// tbeam-selftest.ino — hardware bring-up test for LilyGO T-Beam V1.2 (AXP2101).
//
// Verifies, in order, and reports every step over serial AND on the OLED if one
// is fitted:
//   1. ESP32 identity (chip, flash, PSRAM)
//   2. I2C bus scan on SDA=21 / SCL=22   -> finds PMU 0x34, OLED 0x3C
//   3. AXP2101 PMU: rail states, explicitly powers ALDO2 (LoRa) + ALDO3 (GNSS)
//   4. SSD1306 OLED, only if the scan actually saw it at 0x3C
//   5. u-blox GNSS on UART1 RX=34 / TX=12 @ 9600 — raw byte flow, then fix data
//   6. SX1276 LoRa init (RX-side only; does not transmit)
//
// ⚠️ SAFETY: attach the SMA antenna before powering on. This sketch never calls
//    transmit(), so it is safe to run without one, but the tag firmware is not.
//
// Board doc: T-Beam V1.2, PCB 20230508, FCC 2ASYE-T-BEAM.

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <RadioLib.h>
#include <TinyGPSPlus.h>
#include <XPowersLib.h>
#include <U8g2lib.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
// MUST match the frequency printed on the shield can. 923.0 is the AS923 unit
// this board doc describes. A 923 MHz module driven at 868/915 links over a few
// metres at best and sits outside its matching network.
#define LORA_FREQUENCY_MHZ 923.0

#define LORA_BANDWIDTH        125.0
#define LORA_SPREADING_FACTOR 9
#define LORA_CODING_RATE      7
#define LORA_SYNC_WORD        0x12
#define LORA_TX_POWER_DBM     17
#define LORA_CURRENT_LIMIT_MA 140

// Dump raw NMEA instead of parsed fields. Use when bytes are flowing but a fix
// never resolves — the GSV sentences show how many satellites are actually in
// view, which separates "no antenna" from "no sky view".
// Override from platformio.ini: pio run -e nmea
#ifndef ECHO_RAW_NMEA
#define ECHO_RAW_NMEA 0
#endif

// ---------------------------------------------------------------------------
// Pin map — LilyGO T-Beam V1.2 (AXP2101)
// ---------------------------------------------------------------------------
#define I2C_SDA        21
#define I2C_SCL        22

#define GPS_RX_PIN     34   // input-only pin; receives the GNSS module's TX
#define GPS_TX_PIN     12   // strapping pin (flash voltage), safe to drive post-boot
#define GPS_BAUD       9600

#define LORA_SCK        5
#define LORA_MISO      19
#define LORA_MOSI      27
#define LORA_CS        18
#define LORA_RST       23
#define LORA_DIO0      26
#define LORA_DIO1      33
#define LORA_DIO2      32   // DIO2 on SX1276/78 — NOT a SX1262 BUSY line

#define PMU_IRQ        35
#define BUTTON_PIN     38   // active low
#define LED_PIN         4   // active low

#define OLED_I2C_ADDR  0x3C
#define PMU_I2C_ADDR   0x34

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
XPowersAXP2101 pmu;
TinyGPSPlus gps;
HardwareSerial GPSSerial(1);

// This module ships with GSV/GSA switched off, so "satellites in view" is never
// reported — only "satellites used in the fix", which stays 0 until a fix
// exists. Re-enabling GSV separates a dead antenna (nothing in view, ever) from
// a poor sky view (satellites visible at low SNR but not enough for a fix).
TinyGPSCustom satsInView(gps, "GPGSV", 3);
TinyGPSCustom snrA(gps, "GPGSV", 7);
TinyGPSCustom snrB(gps, "GPGSV", 11);
TinyGPSCustom snrC(gps, "GPGSV", 15);
TinyGPSCustom snrD(gps, "GPGSV", 19);
SX1276 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST, LORA_DIO1);
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

struct {
  bool pmu = false;
  bool oled = false;
  bool gpsBytes = false;
  bool gsv = false;
  int  loraState = RADIOLIB_ERR_UNKNOWN;
  int  i2cCount = 0;
} health;

uint32_t lastDisplayMs = 0;
uint32_t lastSerialMs = 0;
uint32_t bootMs = 0;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
static void reportChip() {
  Serial.printf("[CHIP] %s rev%d  %d core(s) @ %lu MHz\n",
                ESP.getChipModel(), ESP.getChipRevision(),
                ESP.getChipCores(), (unsigned long)getCpuFrequencyMhz());
  Serial.printf("[CHIP] flash %u MB, PSRAM %u bytes\n",
                ESP.getFlashChipSize() / (1024 * 1024), ESP.getPsramSize());
}

// Scan the shared bus. This is the authoritative answer to "is an OLED fitted?"
// — the V1.2 ships the SSD1306 footprint unpopulated on most units.
static void scanI2C() {
  Serial.println("[I2C] scanning SDA=21 SCL=22 ...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      health.i2cCount++;
      const char *who = "";
      if (addr == PMU_I2C_ADDR) who = "  <- AXP2101 PMU";
      if (addr == OLED_I2C_ADDR) who = "  <- SSD1306 OLED";
      Serial.printf("[I2C] found 0x%02X%s\n", addr, who);
      if (addr == OLED_I2C_ADDR) health.oled = true;
    }
  }
  if (health.i2cCount == 0) {
    Serial.println("[I2C] NOTHING on the bus — wiring or power fault");
  }
  if (!health.oled) {
    Serial.println("[I2C] no OLED at 0x3C — display is a footprint only on this");
    Serial.println("[I2C] revision unless you soldered one on. Serial output only.");
  }
}

static void initPMU() {
  if (!pmu.begin(Wire, AXP2101_SLAVE_ADDRESS, I2C_SDA, I2C_SCL)) {
    Serial.println("[PMU] AXP2101 NOT found at 0x34 — cannot power GNSS/LoRa rails");
    return;
  }
  health.pmu = true;
  Serial.printf("[PMU] AXP2101 online, chip id 0x%02X\n", pmu.getChipID());

  // The doc lists these as enabled by default, but the GNSS will never produce
  // a byte if ALDO3 came up off, so set them explicitly rather than trusting it.
  pmu.setALDO2Voltage(3300);   // LoRa
  pmu.enableALDO2();
  pmu.setALDO3Voltage(3300);   // GNSS
  pmu.enableALDO3();

  pmu.setChargeTargetVoltage(XPOWERS_AXP2101_CHG_VOL_4V2);
  pmu.setChargerConstantCurr(XPOWERS_AXP2101_CHG_CUR_500MA);

  // DCDC1 is the ESP32 core on V1.2 (it was DCDC3 on V1.1). Never disable it.
  Serial.printf("[PMU] DCDC1 %-3s %4u mV  (ESP32 core)\n",
                pmu.isEnableDC1() ? "on" : "off", pmu.getDC1Voltage());
  Serial.printf("[PMU] ALDO2 %-3s %4u mV  (LoRa)\n",
                pmu.isEnableALDO2() ? "on" : "off", pmu.getALDO2Voltage());
  Serial.printf("[PMU] ALDO3 %-3s %4u mV  (GNSS)\n",
                pmu.isEnableALDO3() ? "on" : "off", pmu.getALDO3Voltage());
  Serial.printf("[PMU] battery %u mV %d%%  connected=%s charging=%s vbus=%s\n",
                pmu.getBattVoltage(), pmu.getBatteryPercent(),
                pmu.isBatteryConnect() ? "yes" : "no",
                pmu.isCharging() ? "yes" : "no",
                pmu.isVbusIn() ? "yes" : "no");
}

static void initOLED() {
  if (!health.oled) return;
  oled.begin();
  oled.setBusClock(400000);
  oled.setFont(u8g2_font_5x7_tf);
  Serial.println("[OLED] SSD1306 initialised at 0x3C");
}

// ---------------------------------------------------------------------------
// u-blox UBX helpers
// ---------------------------------------------------------------------------
// Frame: B5 62 <class> <id> <len_lo> <len_hi> <payload> <ck_a> <ck_b>
// Checksum is 8-bit Fletcher over everything from <class> to the end of payload.
static void ubxSend(uint8_t cls, uint8_t id, const uint8_t *payload, uint16_t len) {
  uint8_t head[6] = {0xB5, 0x62, cls, id, (uint8_t)(len & 0xFF), (uint8_t)(len >> 8)};
  uint8_t ckA = 0, ckB = 0;
  for (int i = 2; i < 6; i++) { ckA += head[i]; ckB += ckA; }
  for (uint16_t i = 0; i < len; i++) { ckA += payload[i]; ckB += ckA; }

  GPSSerial.write(head, 6);
  if (len) GPSSerial.write(payload, len);
  GPSSerial.write(ckA);
  GPSSerial.write(ckB);
  GPSSerial.flush();
}

// CFG-MSG, 3-byte form: set the output rate of one NMEA sentence on the current
// port. Volatile — not saved with CFG-CFG, so a power cycle restores whatever
// the module had before. NMEA class is 0xF0; GSA is 0x02, GSV is 0x03.
static void setNmeaRate(uint8_t msgId, uint8_t rate) {
  uint8_t p[3] = {0xF0, msgId, rate};
  ubxSend(0x06, 0x01, p, 3);
  delay(120);
}

// Poll a UBX message and wait for its reply.
// Returns payload length, -1 on timeout, or -2 if the receiver NAKed the poll
// (which means it does not implement that message at all).
static int ubxPoll(uint8_t cls, uint8_t id, uint8_t *out, int maxLen,
                   uint32_t timeoutMs) {
  ubxSend(cls, id, nullptr, 0);

  uint32_t deadline = millis() + timeoutMs;
  int state = 0, len = 0, idx = 0;
  uint8_t rc = 0, ri = 0;

  while (millis() < deadline) {
    if (!GPSSerial.available()) { delay(2); continue; }
    uint8_t c = GPSSerial.read();
    switch (state) {
      case 0: state = (c == 0xB5) ? 1 : 0; break;
      case 1: state = (c == 0x62) ? 2 : 0; break;
      case 2: rc = c; state = 3; break;
      case 3: ri = c; state = 4; break;
      case 4: len = c; state = 5; break;
      case 5:
        len |= (c << 8);
        idx = 0;
        if (len > 1024) { state = 0; break; }   // implausible, resync
        state = (len == 0) ? 6 : 7;
        break;
      case 7:
        if (idx < maxLen) out[idx] = c;
        if (++idx >= len) state = 6;
        break;
      case 6: state = 8; break;                 // ck_a
      case 8:                                   // ck_b — frame complete
        if (rc == cls && ri == id) return (len < maxLen) ? len : maxLen;
        if (rc == 0x05 && ri == 0x00) return -2;  // ACK-NAK
        state = 0;
        break;
    }
  }
  return -1;
}

// UBX-MON-VER: software/hardware version plus extension strings. On u-blox 8
// the extensions list the supported constellations outright.
static void pollMonVer() {
  uint8_t buf[320];
  int n = ubxPoll(0x0A, 0x04, buf, sizeof(buf), 2500);
  if (n < 30) {
    Serial.println("[GNSS] MON-VER no reply");
    return;
  }
  Serial.printf("[GNSS] sw=%.30s\n", (char *)buf);
  if (n >= 40) Serial.printf("[GNSS] hw=%.10s\n", (char *)buf + 30);
  for (int off = 40; off + 30 <= n; off += 30) {
    Serial.printf("[GNSS] ext=%.30s\n", (char *)buf + off);
  }
}

// UBX-CFG-GNSS exists only on u-blox 7 and later. A NAK or silence here is the
// definitive answer to "can this receiver do more than GPS?" — no.
static void pollCfgGnss() {
  uint8_t buf[160];
  int n = ubxPoll(0x06, 0x3E, buf, sizeof(buf), 2500);
  if (n == -2 || n < 4) {
    Serial.println("[GNSS] CFG-GNSS unsupported -> GPS-only receiver (u-blox 6 class)");
    Serial.println("[GNSS] extra constellations are not reachable in firmware");
    return;
  }
  Serial.printf("[GNSS] CFG-GNSS: trkChHw=%u trkChUse=%u blocks=%u\n",
                buf[1], buf[2], buf[3]);
  static const char *names[] = {"GPS", "SBAS", "Galileo", "BeiDou",
                                "IMES", "QZSS", "GLONASS"};
  for (int i = 0; i < buf[3]; i++) {
    int off = 4 + i * 8;
    if (off + 8 > n) break;
    uint8_t gnssId = buf[off];
    uint32_t flags = (uint32_t)buf[off + 4] | ((uint32_t)buf[off + 5] << 8) |
                     ((uint32_t)buf[off + 6] << 16) | ((uint32_t)buf[off + 7] << 24);
    Serial.printf("[GNSS]   %-8s %-8s resCh=%u maxCh=%u\n",
                  gnssId < 7 ? names[gnssId] : "?",
                  (flags & 0x01) ? "ENABLED" : "disabled",
                  buf[off + 1], buf[off + 2]);
  }
}

// UBX-MON-HW: AGC and noise counters indicate whether the RF front end is
// seeing a real antenna. Dumped as hex as well as decoded, because field
// offsets shift across receiver generations and a wrong offset would read as
// confident nonsense.
static void pollMonHW() {
  uint8_t buf[128];
  int n = ubxPoll(0x0A, 0x09, buf, sizeof(buf), 1500);
  if (n < 22) {
    Serial.println("[GNSS] MON-HW no reply");
    return;
  }
  Serial.printf("[GNSS] MON-HW %d bytes:", n);
  for (int i = 0; i < n; i++) Serial.printf(" %02X", buf[i]);
  Serial.println();

  static const char *aStat[] = {"INIT", "DONTKNOW", "OK", "SHORT", "OPEN"};
  uint16_t noise = buf[16] | (buf[17] << 8);
  uint16_t agc = buf[18] | (buf[19] << 8);
  Serial.printf("[GNSS] noise=%u agc=%u/8191 antenna=%s power=%s jam=%u/255\n",
                noise, agc,
                buf[20] < 5 ? aStat[buf[20]] : "?",
                buf[21] == 1 ? "ON" : (buf[21] == 0 ? "OFF" : "?"),
                n > 45 ? buf[45] : 0);
}

static void initGNSS() {
  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.printf("[GNSS] UART1 up: RX=%d TX=%d @ %d baud\n",
                GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);

  // Give the receiver a moment, then confirm bytes are physically arriving.
  // Zero bytes means a power (ALDO3) or wiring problem, not a satellite problem.
  uint32_t start = millis();
  while (millis() - start < 3000) {
    while (GPSSerial.available()) {
      gps.encode(GPSSerial.read());
    }
    delay(10);
  }
  health.gpsBytes = gps.charsProcessed() > 0;
  Serial.printf("[GNSS] %s (%lu bytes in 3 s)\n",
                health.gpsBytes ? "receiving NMEA" : "NO DATA — check ALDO3 and RX pin 34",
                (unsigned long)gps.charsProcessed());
  if (!health.gpsBytes) return;

  // Turning GSA/GSV back on doubles as a test of the GNSS TX line (GPIO12) —
  // the only pin in the map that simply receiving NMEA does not exercise.
  Serial.println("[GNSS] enabling GSA + GSV via UBX CFG-MSG ...");
  setNmeaRate(0x02, 1);   // GSA
  setNmeaRate(0x03, 1);   // GSV

  pollMonVer();
  pollCfgGnss();
  pollMonHW();

  uint32_t t = millis();
  while (millis() - t < 4000) {
    while (GPSSerial.available()) gps.encode(GPSSerial.read());
    delay(10);
  }

  health.gsv = satsInView.isValid();
  if (health.gsv) {
    Serial.printf("[GNSS] GSV enabled — satellites in view = %s\n", satsInView.value());
    Serial.println("[GNSS] TX pin 12 confirmed (the module acted on our command)");
  } else {
    Serial.println("[GNSS] GSV did not appear — TX pin 12 may not reach the module,");
    Serial.println("[GNSS] or UBX input is disabled on this port");
  }
}

static void initLoRa() {
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  health.loraState = radio.begin(LORA_FREQUENCY_MHZ, LORA_BANDWIDTH,
                                 LORA_SPREADING_FACTOR, LORA_CODING_RATE,
                                 LORA_SYNC_WORD, LORA_TX_POWER_DBM);
  if (health.loraState == RADIOLIB_ERR_NONE) {
    radio.setCurrentLimit(LORA_CURRENT_LIMIT_MA);
    Serial.printf("[LORA] SX1276 ok @ %.1f MHz SF%d BW%.0f\n",
                  (double)LORA_FREQUENCY_MHZ, LORA_SPREADING_FACTOR,
                  (double)LORA_BANDWIDTH);
    Serial.println("[LORA] verify this matches the frequency on the shield can");
  } else if (health.loraState == RADIOLIB_ERR_CHIP_NOT_FOUND) {
    Serial.println("[LORA] SX1276 NOT FOUND — SPI wiring or ALDO2 is off");
  } else {
    Serial.printf("[LORA] init failed code=%d\n", health.loraState);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
static void drawBootSummary() {
  if (!health.oled) return;
  oled.clearBuffer();
  oled.drawStr(0, 7, "T-Beam V1.2 selftest");
  oled.drawHLine(0, 9, 128);
  char line[32];
  snprintf(line, sizeof(line), "I2C   %d device(s)", health.i2cCount);
  oled.drawStr(0, 20, line);
  snprintf(line, sizeof(line), "PMU   %s", health.pmu ? "AXP2101 ok" : "NOT FOUND");
  oled.drawStr(0, 30, line);
  snprintf(line, sizeof(line), "GNSS  %s", health.gpsBytes ? "NMEA flowing" : "no data");
  oled.drawStr(0, 40, line);
  snprintf(line, sizeof(line), "LoRa  %s",
           health.loraState == RADIOLIB_ERR_NONE ? "SX1276 ok" : "FAILED");
  oled.drawStr(0, 50, line);
  snprintf(line, sizeof(line), "%.1f MHz", (double)LORA_FREQUENCY_MHZ);
  oled.drawStr(0, 62, line);
  oled.sendBuffer();
}

static void drawLive() {
  if (!health.oled) return;
  char line[32];
  bool fix = gps.location.isValid() && gps.location.age() < 5000;

  oled.clearBuffer();

  // "use" = satellites used in the fix (GGA), "vis" = satellites in view (GSV).
  // vis climbing while use stays 0 means the antenna works and it just needs
  // more sky; vis stuck at 0 points at the antenna itself.
  snprintf(line, sizeof(line), "%s use%02d vis%s h%.0f",
           fix ? "FIX " : "WAIT",
           gps.satellites.isValid() ? gps.satellites.value() : 0,
           satsInView.isValid() ? satsInView.value() : "?",
           gps.hdop.isValid() ? gps.hdop.hdop() : 0.0);
  oled.drawStr(0, 7, line);
  oled.drawHLine(0, 9, 128);

  if (gps.location.isValid()) {
    snprintf(line, sizeof(line), "lat %.6f", gps.location.lat());
    oled.drawStr(0, 19, line);
    snprintf(line, sizeof(line), "lng %.6f", gps.location.lng());
    oled.drawStr(0, 28, line);
  } else {
    oled.drawStr(0, 19, "lat  --.------");
    oled.drawStr(0, 28, "lng  --.------");
  }

  snprintf(line, sizeof(line), "alt %.0fm  %.1fkm/h",
           gps.altitude.isValid() ? gps.altitude.meters() : 0.0,
           gps.speed.isValid() ? gps.speed.kmph() : 0.0);
  oled.drawStr(0, 37, line);

  if (gps.time.isValid()) {
    snprintf(line, sizeof(line), "UTC %02d:%02d:%02d  rx%lu",
             gps.time.hour(), gps.time.minute(), gps.time.second(),
             (unsigned long)gps.sentencesWithFix());
  } else {
    snprintf(line, sizeof(line), "UTC --:--:--  rx%lu",
             (unsigned long)gps.sentencesWithFix());
  }
  oled.drawStr(0, 46, line);

  if (health.pmu) {
    snprintf(line, sizeof(line), "BAT %umV %d%% %s",
             pmu.getBattVoltage(), pmu.getBatteryPercent(),
             pmu.isCharging() ? "CHG" : "");
  } else {
    snprintf(line, sizeof(line), "BAT no PMU");
  }
  oled.drawStr(0, 55, line);

  snprintf(line, sizeof(line), "LoRa %.1f %s", (double)LORA_FREQUENCY_MHZ,
           health.loraState == RADIOLIB_ERR_NONE ? "ok" : "ERR");
  oled.drawStr(0, 64, line);

  oled.sendBuffer();
}

static void printLive() {
  bool fix = gps.location.isValid() && gps.location.age() < 5000;
  Serial.printf("[GNSS] %s sats=%d hdop=%.2f chars=%lu sentences=%lu checksumErr=%lu\n",
                fix ? "FIX" : "no-fix",
                gps.satellites.isValid() ? gps.satellites.value() : 0,
                gps.hdop.isValid() ? gps.hdop.hdop() : 0.0,
                (unsigned long)gps.charsProcessed(),
                (unsigned long)gps.sentencesWithFix(),
                (unsigned long)gps.failedChecksum());
  // Satellites *in view* comes from GSV and is the real health signal: a
  // receiver with a working antenna sees satellites long before it can fix.
  Serial.printf("[GNSS] in view=%s  SNR: %s %s %s %s\n",
                satsInView.isValid() ? satsInView.value() : "n/a",
                snrA.isValid() && *snrA.value() ? snrA.value() : "-",
                snrB.isValid() && *snrB.value() ? snrB.value() : "-",
                snrC.isValid() && *snrC.value() ? snrC.value() : "-",
                snrD.isValid() && *snrD.value() ? snrD.value() : "-");
  if (gps.location.isValid()) {
    Serial.printf("[GNSS] lat=%.6f lng=%.6f alt=%.1fm age=%lums\n",
                  gps.location.lat(), gps.location.lng(),
                  gps.altitude.isValid() ? gps.altitude.meters() : 0.0,
                  (unsigned long)gps.location.age());
  }
  if (health.pmu) {
    Serial.printf("[PMU]  batt=%umV %d%% charging=%s vbus=%s\n",
                  pmu.getBattVoltage(), pmu.getBatteryPercent(),
                  pmu.isCharging() ? "yes" : "no",
                  pmu.isVbusIn() ? "yes" : "no");
  }
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  bootMs = millis();

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);        // active low — on, as a "running" indicator
  pinMode(BUTTON_PIN, INPUT);        // GPIO38 has no internal pull-up

  Serial.println();
  Serial.println("========================================");
  Serial.println("T-Beam V1.2 (AXP2101) self-test");
  Serial.println("========================================");

  reportChip();

  Wire.begin(I2C_SDA, I2C_SCL);
  scanI2C();
  initPMU();
  initOLED();
  initGNSS();
  initLoRa();

  Serial.println("----------------------------------------");
  Serial.printf("[RESULT] i2c=%d pmu=%s oled=%s gnss=%s lora=%s\n",
                health.i2cCount,
                health.pmu ? "ok" : "FAIL",
                health.oled ? "ok" : "absent",
                health.gpsBytes ? "ok" : "FAIL",
                health.loraState == RADIOLIB_ERR_NONE ? "ok" : "FAIL");
  Serial.println("----------------------------------------");

  drawBootSummary();
  delay(4000);
}

void loop() {
  while (GPSSerial.available()) {
    int c = GPSSerial.read();
#if ECHO_RAW_NMEA
    Serial.write(c);
#endif
    gps.encode(c);
  }

  uint32_t now = millis();

  if (now - lastDisplayMs >= 500) {
    lastDisplayMs = now;
    drawLive();
  }

#if !ECHO_RAW_NMEA
  if (now - lastSerialMs >= 2000) {
    lastSerialMs = now;
    printLive();
  }
#endif
}
