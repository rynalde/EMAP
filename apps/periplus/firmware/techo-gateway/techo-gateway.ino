// techo-gateway.ino — periplus, T-Echo USB serial gateway.
//
// Flow:
//   boot -> init SX1262 LoRa -> listen continuously -> on packet:
//     read RSSI/SNR, wrap the tag payload into a gateway JSON object,
//     print exactly one JSON line over USB serial.
//
// Libraries (Arduino Library Manager):
//   - RadioLib (Jan Gromes)
//
// Board: Adafruit nRF52 support, "LilyGo T-Echo" / "Nordic nRF52840 DK".
//   Upload usually requires DFU: double-click the reset button before upload.
//
// ⚠️ SAFETY: Ensure the LoRa antenna is connected before powering on.

#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>
#include <TinyGPSPlus.h>
#include <GxEPD2_BW.h>

#include "config.h"

// GDEH0154D67 200x200. Full-height page buffer (5 kB) so the whole screen can
// be composed in RAM and pushed in one update.
GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT>
    display(GxEPD2_154_D67(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));

// The variant exposes a single SPI object and the SX1262 already owns it, so
// the panel runs on its own bus.
SPIClass *epdSPI = nullptr;
bool displayOk = false;
uint32_t lastDisplayMs = 0;
uint32_t displayUpdates = 0;

TinyGPSPlus gps;
#define SerialGPS Serial1

// Most recently heard tags, newest first. Small and fixed — this is a status
// panel, not a log.
struct TagSeen {
  char id[20];
  float rssi;
  float snr;
  uint32_t lastMs;
  uint32_t count;
};
TagSeen recentTags[RECENT_TAGS];
int recentCount = 0;

SX1262 radio = new Module(LORA_CS, LORA_DIO1, LORA_RST, LORA_BUSY);

// RadioLib flag set from the DIO1 ISR when a packet arrives.
volatile bool receivedFlag = false;

// Link statistics, reported on a heartbeat so a silent gateway can be told
// apart from a stalled one.
uint32_t rxCount = 0;
uint32_t crcErrors = 0;
uint32_t otherErrors = 0;
uint32_t lastRxMs = 0;
float lastRssi = 0.0;
float lastSnr = 0.0;
uint32_t lastHeartbeatMs = 0;
uint32_t lastStatusLineMs = 0;

// RadioLib returns numeric codes; the common ones are worth naming because the
// distinction between "no chip on SPI" and "bad parameter" changes what to fix.
static const char *radioErrorName(int code) {
  switch (code) {
    case RADIOLIB_ERR_NONE:               return "OK";
    case RADIOLIB_ERR_CHIP_NOT_FOUND:     return "CHIP_NOT_FOUND (SPI wiring/pins)";
    case RADIOLIB_ERR_SPI_CMD_TIMEOUT:    return "SPI_CMD_TIMEOUT (BUSY pin or TCXO)";
    case RADIOLIB_ERR_SPI_CMD_INVALID:    return "SPI_CMD_INVALID";
    case RADIOLIB_ERR_SPI_CMD_FAILED:     return "SPI_CMD_FAILED";
    case RADIOLIB_ERR_INVALID_FREQUENCY:  return "INVALID_FREQUENCY (band vs module)";
    case RADIOLIB_ERR_INVALID_BANDWIDTH:  return "INVALID_BANDWIDTH";
    case RADIOLIB_ERR_INVALID_SPREADING_FACTOR: return "INVALID_SF";
    case RADIOLIB_ERR_INVALID_CODING_RATE:      return "INVALID_CR";
    case RADIOLIB_ERR_INVALID_OUTPUT_POWER:     return "INVALID_TX_POWER";
    case RADIOLIB_ERR_CRC_MISMATCH:       return "CRC_MISMATCH";
    case RADIOLIB_ERR_RX_TIMEOUT:         return "RX_TIMEOUT";
    default:                              return "unknown";
  }
}

// Dump everything that has to agree with the tag. A mismatch in any one of
// these means the gateway hears nothing, with no error to show for it.
static void logConfig() {
  Serial.println("[CFG] ---- radio ----");
  Serial.printf("[CFG] freq       %.1f MHz\n", (double)LORA_FREQUENCY);
  Serial.printf("[CFG] bandwidth  %.1f kHz\n", (double)LORA_BANDWIDTH);
  Serial.printf("[CFG] spreadingF %d\n", LORA_SPREADING_FACTOR);
  Serial.printf("[CFG] codingRate 4/%d\n", LORA_CODING_RATE);
  Serial.printf("[CFG] syncWord   0x%02X (SX126x maps this to 0x1424)\n", LORA_SYNC_WORD);
  Serial.println("[CFG] preamble   8 symbols, CRC on, explicit header");
  Serial.println("[CFG] ---- wiring ----");
  Serial.printf("[CFG] SPI  SCK=%d MISO=%d MOSI=%d\n", LORA_SCLK, LORA_MISO, LORA_MOSI);
  Serial.printf("[CFG] CTRL CS=%d RST=%d BUSY=%d DIO1=%d\n",
                LORA_CS, LORA_RST, LORA_BUSY, LORA_DIO1);
  Serial.println("[CFG] ALL of the radio values above must match the tag exactly.");
}

// Pull "device_id":"..." out of the payload without a JSON parser — the tag
// builds the object by hand, so the shape is known and fixed.
static bool extractTagId(const String &payload, char *out, size_t outLen) {
  int k = payload.indexOf("\"device_id\":\"");
  if (k < 0) return false;
  int start = k + 13;
  int end = payload.indexOf('"', start);
  if (end < 0) return false;
  size_t n = (size_t)(end - start);
  if (n >= outLen) n = outLen - 1;
  memcpy(out, payload.c_str() + start, n);
  out[n] = '\0';
  return true;
}

// Insert or refresh a tag, keeping the list ordered most-recent-first.
static void noteTag(const char *id, float rssi, float snr) {
  int found = -1;
  for (int i = 0; i < recentCount; i++) {
    if (strcmp(recentTags[i].id, id) == 0) { found = i; break; }
  }
  TagSeen entry;
  if (found >= 0) {
    entry = recentTags[found];
    for (int i = found; i > 0; i--) recentTags[i] = recentTags[i - 1];
  } else {
    memset(&entry, 0, sizeof(entry));
    strncpy(entry.id, id, sizeof(entry.id) - 1);
    // Push everything down; the oldest falls off the end.
    int last = (recentCount < RECENT_TAGS) ? recentCount++ : RECENT_TAGS - 1;
    for (int i = last; i > 0; i--) recentTags[i] = recentTags[i - 1];
  }
  entry.rssi = rssi;
  entry.snr = snr;
  entry.lastMs = millis();
  entry.count++;
  recentTags[0] = entry;
}

static void initGNSS() {
  SerialGPS.setPins(GPS_RX_PIN, GPS_TX_PIN);
  SerialGPS.begin(GPS_BAUD);
  Serial.printf("[GNSS] Serial1 up: RX=%d TX=%d @ %d baud\n",
                GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD);
}

static void initDisplay() {
  epdSPI = new SPIClass(NRF_SPIM2, EPD_MISO, EPD_SCLK, EPD_MOSI);
  epdSPI->begin();
  display.epd2.selectSPI(*epdSPI, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init();
  // Rotation 3 is the T-Echo's physical orientation — LilyGO's own factory
  // firmware uses the same value. Rotation 1 renders the screen upside down.
  display.setRotation(3);
  display.setTextColor(GxEPD_BLACK);
  displayOk = true;
  Serial.println("[EPD] GDEH0154D67 initialised on NRF_SPIM2");
}

// Draws content only. Window selection, buffer clearing and the page loop are
// handled by refreshDisplay(), which calls this once per page.
static void drawScreen() {
  char line[48];
  int y = 0;

  display.setFont(NULL);
  display.setTextSize(2);
  display.setCursor(0, y);
  display.print(GATEWAY_ID);
  display.setTextSize(1);
  snprintf(line, sizeof(line), "%lus", (unsigned long)(millis() / 1000));
  display.setCursor(200 - 6 * strlen(line), y + 4);
  display.print(line);
  y += 20;
  display.drawFastHLine(0, y, 200, GxEPD_BLACK);
  y += 6;

  // --- gateway's own position ---
  bool gpsFix = gps.location.isValid() && gps.location.age() < 10000;
  snprintf(line, sizeof(line), "GPS %s  sat %02d",
           gpsFix ? "fix" : (gps.charsProcessed() == 0 ? "no_gps" : "acquiring"),
           gps.satellites.isValid() ? gps.satellites.value() : 0);
  display.setCursor(0, y);
  display.print(line);
  y += 11;

  if (gps.location.isValid()) {
    snprintf(line, sizeof(line), " %.6f", gps.location.lat());
    display.setCursor(0, y); display.print(line); y += 10;
    snprintf(line, sizeof(line), " %.6f", gps.location.lng());
    display.setCursor(0, y); display.print(line); y += 12;
  } else {
    display.setCursor(0, y); display.print(" --.------"); y += 10;
    display.setCursor(0, y); display.print(" --.------"); y += 12;
  }

  display.drawFastHLine(0, y, 200, GxEPD_BLACK);
  y += 10;

  // --- link counters ---
  snprintf(line, sizeof(line), "RX %lu   CRC %lu   ERR %lu",
           (unsigned long)rxCount, (unsigned long)crcErrors,
           (unsigned long)otherErrors);
  display.setCursor(0, y);
  display.print(line);
  y += 13;

  display.drawFastHLine(0, y, 200, GxEPD_BLACK);
  y += 10;

  // --- recent tags ---
  display.setCursor(0, y);
  display.print("TAGS");
  y += 11;

  if (recentCount == 0) {
    display.setCursor(0, y);
    display.print(" none heard yet");
  } else {
    for (int i = 0; i < recentCount; i++) {
      snprintf(line, sizeof(line), "%s", recentTags[i].id);
      display.setCursor(0, y);
      display.print(line);
      y += 9;
      snprintf(line, sizeof(line), "  %ddBm %.0fdB %lus x%lu",
               (int)lround(recentTags[i].rssi), recentTags[i].snr,
               (unsigned long)((millis() - recentTags[i].lastMs) / 1000),
               (unsigned long)recentTags[i].count);
      display.setCursor(0, y);
      display.print(line);
      y += 12;
    }
  }
}

// Redrawing blocks the receive loop, so it happens on a timer rather than per
// packet. A partial refresh is fast but leaves ghosting, so a full one runs
// periodically to clear it.
static void refreshDisplay() {
  if (!displayOk) return;
  bool full = (displayUpdates % DISPLAY_FULL_EVERY) == 0;
  uint32_t t0 = millis();

  // Paged API rather than a direct display() call: after a full refresh GxEPD2
  // powers the panel off, and the firstPage/nextPage cycle is what re-runs the
  // controller init. Driving it directly left the screen stuck on its first
  // image. A partial window covering the whole screen gives a fast refresh.
  if (full) {
    display.setFullWindow();
  } else {
    display.setPartialWindow(0, 0, display.width(), display.height());
  }

  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    drawScreen();
  } while (display.nextPage());

  uint32_t took = millis() - t0;
  displayUpdates++;
  lastDisplayMs = millis();
  // The radio is deaf for this whole window — a packet arriving mid-refresh is
  // lost. Logged so the cost is visible rather than showing up as mystery gaps
  // in the sequence numbers.
  Serial.printf("[EPD] %s refresh took %lums (radio deaf for that window)\n",
                full ? "full" : "partial", (unsigned long)took);
}

// Machine-readable status line, emitted on a timer regardless of tag traffic.
//
// The gateway's own reading. Its position used to travel only inside relayed
// tag packets, so a gateway hearing no tags never reported where it was — and a
// gateway with no tags in range is a normal state, not a fault.
//
// Uses the same field names a tag does, because it IS a reading: the gateway is
// a device that happens to know where it is. Carrying no "payload" key is what
// tells the bridge the line is about the gateway itself.
static void emitStatusLine() {
  bool gwFix = gps.location.isValid() && gps.location.age() < 10000;
  const char *gwStatus = gwFix ? "fix"
                       : (gps.charsProcessed() == 0 ? "no_gps" : "acquiring");

  String line = "{";
  line += "\"device_id\":\"" GATEWAY_ID "\",";
  line += "\"fw\":\"" FW_VERSION "\",";
  line += "\"status\":\"" + String(gwStatus) + "\",";
  if (gwFix) {
    line += "\"lat\":" + String(gps.location.lat(), 6) + ",";
    line += "\"lng\":" + String(gps.location.lng(), 6) + ",";
  } else {
    line += "\"lat\":null,\"lng\":null,";
  }
  line += "\"sats\":" +
          String(gps.satellites.isValid() ? gps.satellites.value() : 0) + ",";
  line += "\"uptime_ms\":" + String(millis()) + ",";
  line += "\"rx_count\":" + String(rxCount) + ",";
  line += "\"crc_errors\":" + String(crcErrors);
  line += "}";

  Serial.println(line);
}

static void heartbeat() {
  uint32_t up = millis() / 1000;
  if (rxCount == 0) {
    Serial.printf("[STAT] up=%lus listening, NO packets yet  crcErr=%lu otherErr=%lu\n",
                  (unsigned long)up, (unsigned long)crcErrors,
                  (unsigned long)otherErrors);
  } else {
    Serial.printf("[STAT] up=%lus rx=%lu lastRssi=%.1f lastSnr=%.1f lastSeen=%lus ago "
                  "crcErr=%lu otherErr=%lu\n",
                  (unsigned long)up, (unsigned long)rxCount, lastRssi, lastSnr,
                  (unsigned long)((millis() - lastRxMs) / 1000),
                  (unsigned long)crcErrors, (unsigned long)otherErrors);
  }
}

#if defined(ESP32) || defined(ESP8266)
ICACHE_RAM_ATTR
#endif
void onReceive() {
  receivedFlag = true;
}

// Escape a string for safe embedding inside a JSON string literal.
static String jsonEscape(const String &in) {
  String out;
  out.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:   out += c;      break;
    }
  }
  return out;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[BOOT] T-Echo gateway starting");
  Serial.println("[BOOT] fw=" FW_VERSION " gateway=" GATEWAY_ID);
  Serial.println("[BOOT] ANTENNA WARNING: ensure LoRa antenna is connected!");

  // The nrf52840_dk_adafruit variant defaults SPI to P1.13/P1.14/P1.15, but the
  // T-Echo wires the SX1262 to P0.19/P0.22/P0.23. Without repointing the bus
  // first, SPI talks to three unconnected pins and the radio never answers.
  // Argument order is (MISO, SCK, MOSI) — not the usual SCK-first ordering.
  SPI.setPins(LORA_MISO, LORA_SCLK, LORA_MOSI);
  SPI.begin();

  // Peripheral rail — the GPS stays dark without this.
  pinMode(POWER_ENABLE_PIN, OUTPUT);
  digitalWrite(POWER_ENABLE_PIN, HIGH);
  delay(50);

  initDisplay();
  initGNSS();

  logConfig();

  Serial.print("[LORA] init SX1262 ... ");
  int state = radio.begin(LORA_FREQUENCY, LORA_BANDWIDTH, LORA_SPREADING_FACTOR,
                          LORA_CODING_RATE, LORA_SYNC_WORD, LORA_TX_POWER_DBM);
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("ok");
  } else {
    Serial.printf("FAILED code=%d %s\n", state, radioErrorName(state));
    Serial.println("[LORA] halted. The gateway cannot receive in this state.");
    while (true) delay(1000);
  }

  // Receive-only node: raise the LNA gain rather than leaving AGC to settle,
  // and report what the radio actually ended up configured with.
  radio.setCurrentLimit(140);

  // Nominal LoRa bitrate: SF * (BW / 2^SF) * 4/CR. Useful as a sanity check
  // that SF/BW/CR ended up where they were meant to.
  double symbolRate = (LORA_BANDWIDTH * 1000.0) / (double)(1UL << LORA_SPREADING_FACTOR);
  double bitrate = LORA_SPREADING_FACTOR * symbolRate * 4.0 / (double)LORA_CODING_RATE;
  Serial.printf("[LORA] datarate  ~%.0f bps (SF%d BW%.0f CR4/%d)\n",
                bitrate, LORA_SPREADING_FACTOR, (double)LORA_BANDWIDTH,
                LORA_CODING_RATE);

  // Paint the first screen BEFORE the radio starts listening. A full refresh
  // takes ~4.4 s, and doing it once reception is live loses every packet that
  // arrives in that window.
  refreshDisplay();

  radio.setDio1Action(onReceive);

  state = radio.startReceive();
  if (state == RADIOLIB_ERR_NONE) {
    Serial.println("[LORA] listening...");
    Serial.println("[LORA] debug lines start with '['; machine-readable lines start with '{'");
  } else {
    Serial.printf("[LORA] startReceive FAILED code=%d %s\n", state, radioErrorName(state));
  }
}

void loop() {
  // Keep the gateway's own GPS parsed between packets.
  while (SerialGPS.available()) {
    gps.encode(SerialGPS.read());
  }

  if (millis() - lastHeartbeatMs >= 5000) {
    lastHeartbeatMs = millis();
    heartbeat();
  }

  if (millis() - lastStatusLineMs >= GATEWAY_STATUS_MS) {
    lastStatusLineMs = millis();
    emitStatusLine();
  }

  // Redraw only when nothing is pending, so a slow panel update never delays
  // handling a packet that has already landed.
  if (!receivedFlag && millis() - lastDisplayMs >= DISPLAY_REFRESH_MS) {
    refreshDisplay();
  }

  if (!receivedFlag) {
    return;
  }
  receivedFlag = false;

  String payload;
  int state = radio.readData(payload);

  if (state == RADIOLIB_ERR_NONE) {
    float rssi = radio.getRSSI();
    float snr = radio.getSNR();
    uint32_t nowMs = millis();

    rxCount++;
    lastRxMs = nowMs;
    lastRssi = rssi;
    lastSnr = snr;

    Serial.printf("[LORA] rx #%lu len=%u rssi=%.1f dBm snr=%.1f dB freqErr=%.0f Hz\n",
                  (unsigned long)rxCount, payload.length(), rssi, snr,
                  (double)radio.getFrequencyError());
    Serial.printf("[LORA] raw: %s\n", payload.c_str());

    char seenId[20];
    if (extractTagId(payload, seenId, sizeof(seenId))) {
      noteTag(seenId, rssi, snr);
    }

    // The tag transmits a JSON object. Embed it directly under "payload" if it
    // looks like JSON; otherwise pass it through as raw_payload only.
    bool looksJson = payload.length() > 0 && payload[0] == '{';

    // The envelope carries only what the gateway itself measured on reception —
    // a tag cannot know its own RSSI. The gateway's position is no longer
    // repeated here: emitStatusLine() reports it on its own timer, so it
    // reaches the map whether or not any tag is in range.
    String line = "{";
    line += "\"device_id\":\"" GATEWAY_ID "\",";
    line += "\"fw\":\"" FW_VERSION "\",";
    line += "\"received_at_ms\":" + String(nowMs) + ",";
    line += "\"rssi\":" + String((int)lround(rssi)) + ",";
    line += "\"snr\":" + String(snr, 1) + ",";
    if (looksJson) {
      line += "\"payload\":" + payload + ",";
    }
    line += "\"raw_payload\":\"" + jsonEscape(payload) + "\"";
    line += "}";

    // Exactly one JSON object per line over USB serial.
    Serial.println(line);
  } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    crcErrors++;
    // A packet arrived and was demodulated but failed CRC: the link exists but
    // is marginal, or a parameter differs from the tag.
    Serial.printf("[LORA] rx CRC MISMATCH (#%lu) — signal present but corrupt\n",
                  (unsigned long)crcErrors);
  } else {
    otherErrors++;
    Serial.printf("[LORA] rx failed code=%d %s\n", state, radioErrorName(state));
  }

  // Resume listening.
  radio.startReceive();
}
