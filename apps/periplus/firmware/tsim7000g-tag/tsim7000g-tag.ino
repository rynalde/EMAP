// tsim7000g-tag.ino — periplus, LILYGO T-SIM7000G cellular GPS tracker.
//
// Unlike the LoRa and Channel Sounding tags, this board has no gateway: it
// carries its own GNSS and its own LTE modem, so it reaches Supabase directly
// over HTTPS and holds an ingest key of its own.
//
// THE ONE CONSTRAINT THAT SHAPES THIS SKETCH
//
// The SIM7000G cannot do GNSS and cellular data at the same time. LILYGO's own
// manual is explicit: "Please disconnect the network when positioning, and turn
// off GPS when connecting to the network." So a cycle is two exclusive phases,
// never overlapping:
//
//   GNSS phase     data session down -> CGNSPWR=1 -> poll CGNSINF for a fix
//                  -> CGNSPWR=0
//   network phase  attach the APN -> POST the reading -> drop the session
//
// Leaving the receiver powered while attached is what makes a T-SIM7000G "never
// get a fix" on a bench where a bare GNSS sketch locks in seconds.
//
// Flow:
//   boot -> power modem -> read IMEI -> set RAT ->
//   loop: [GNSS phase] [network phase] every SEND_INTERVAL_MS.
//
// Libraries (install via Arduino Library Manager):
//   - TinyGSM             (Volodymyr Shymanskyy)  modem driver + GNSS
//   - ArduinoHttpClient   (Arduino)               HTTP over the modem's socket
//
// Board: "ESP32 Dev Module" (ESP32-WROVER-B). Insert a data-enabled SIM and
// attach BOTH antennas — LTE and GNSS are separate connectors.
//
// POWER: the modem draws current spikes of ~2 A when transmitting. USB alone
// browns it out on many hubs; keep the LiPo connected.

// Must be defined before TinyGsmClient.h. The plain SIM7000 profile has no TLS
// client, and Supabase is HTTPS only.
#define TINY_GSM_MODEM_SIM7000SSL
#define TINY_GSM_RX_BUFFER 1024

#include <Arduino.h>
#include <TinyGsmClient.h>
#include <ArduinoHttpClient.h>

#include "config.h"

HardwareSerial modemSerial(1);
TinyGsm modem(modemSerial);
TinyGsmClientSecure netClient(modem);
HttpClient http(netClient, SUPABASE_HOST, 443);

uint32_t seq = 0;
uint32_t lastCycleMs = 0;

// Track whether we have ever had a real fix, and the last known coordinates, so
// a transient GNSS dropout reports the last position as status="stale" rather
// than dropping straight back to null. Same rule as the LoRa tag.
bool everHadFix = false;
double lastLat = 0.0;
double lastLng = 0.0;

// Whether the GNSS receiver accepted the power-on command. Without it there is
// no way to tell "searching for satellites" from "receiver never answered",
// and those are very different faults to be standing in a field debugging.
bool gnssOn = false;

// Printed at boot so it can be registered. Not sent in the payload: the ingest
// key already identifies this board, and a device_id that disagreed with the
// registration would silently create a second device row.
String imei;

static void powerOnModem() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  // PWRKEY is edge-triggered: a low pulse of >1 s toggles the modem. The board
  // inverts it, so HIGH here is the idle level and LOW is the pulse.
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(300);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, HIGH);

  pinMode(MODEM_DTR, OUTPUT);
  digitalWrite(MODEM_DTR, LOW);   // keep the modem out of sleep

  modemSerial.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(3000);
}

// Attach to the network and open a data session. Returns false rather than
// blocking forever: the next interval retries, and a board stuck in a retry
// loop inside setup() looks identical to a dead one.
static bool connectNetwork() {
  if (modem.isGprsConnected()) return true;

  Serial.print("[NET] waiting for network ... ");
  if (!modem.waitForNetwork(NETWORK_TIMEOUT_MS)) {
    Serial.println("FAILED (no registration)");
    return false;
  }
  Serial.printf("ok (csq=%d)\n", modem.getSignalQuality());

  Serial.print("[NET] attaching APN " APN " ... ");
  if (!modem.gprsConnect(APN, GPRS_USER, GPRS_PASS)) {
    Serial.println("FAILED (check APN / SIM data plan)");
    return false;
  }
  Serial.println("ok");
  return true;
}

// GNSS phase. Powers the receiver, polls until it reports a usable fix or
// GNSS_FIX_TIMEOUT_MS elapses, then powers it back down so the network phase
// can attach. Returns true only on a real fix.
//
// The data session is dropped FIRST: this is the half of the constraint that is
// easy to forget, because a stale session left over from the previous cycle is
// invisible until the receiver silently never locks.
static bool acquireFix(float *lat, float *lng, int *usat, float *hdop) {
  if (modem.isGprsConnected()) {
    modem.gprsDisconnect();
  }

  gnssOn = modem.enableGPS();
  if (!gnssOn) {
    Serial.println("[GNSS] power on FAILED (receiver did not answer)");
    return false;
  }

  float speed = 0, alt = 0;
  int vsat = 0;
  bool haveFix = false;
  uint32_t start = millis();

  // Unsigned subtraction, so this stays correct across the millis() rollover.
  while (millis() - start < GNSS_FIX_TIMEOUT_MS) {
    // The 0,0 guard is not paranoia: some SIM7000 firmware answers with a
    // "valid" frame of zeroes before the first lock, and null-island is a
    // coordinate the database would happily store.
    if (modem.getGPS(lat, lng, &speed, &alt, &vsat, usat, hdop) &&
        *lat != 0.0f && *lng != 0.0f) {
      haveFix = true;
      break;
    }
    delay(GNSS_POLL_INTERVAL_MS);
  }

  Serial.printf("[GNSS] %s after %lu ms (sats=%d/%d)\n",
                haveFix ? "fix" : "no fix", (unsigned long)(millis() - start),
                *usat, vsat);

  // Off before the network phase, per the manual. Done even when the fix
  // failed: the constraint is about the receiver being powered, not about
  // whether it succeeded.
  modem.disableGPS();
  return haveFix;
}

// GNSS state reported alongside every reading, in the same vocabulary the LoRa
// tag uses:
//   "fix"       current valid fix; lat/lng are live
//   "stale"     had a fix, it aged out; lat/lng are the last known position
//   "acquiring" GNSS is powered and searching; lat/lng are null
//   "no_gps"    the receiver did not answer at all; lat/lng are null
//
// The tag NEVER fabricates a position. When it does not know where it is, it
// says so and sends null — a wrong coordinate is worse than no coordinate.
static const char *gnssStatus(bool haveFix) {
  if (haveFix) return "fix";
  if (everHadFix) return "stale";
  return gnssOn ? "acquiring" : "no_gps";
}

static String buildPayload(const char *status, bool havePosition, double lat,
                           double lng, int sats, float accuracy, int batteryMv) {
  // Hand-built JSON avoids a JSON library for a payload this small. Unknown
  // numeric fields are emitted as null rather than a sentinel: the ingest RPC
  // maps null straight through, whereas 0 would be stored as a measurement.
  String json = "{";
  json += "\"seq\":" + String(seq) + ",";
  json += "\"status\":\"" + String(status) + "\",";
  if (havePosition) {
    json += "\"lat\":" + String(lat, 6) + ",";
    json += "\"lng\":" + String(lng, 6) + ",";
  } else {
    json += "\"lat\":null,\"lng\":null,";
  }
  json += "\"sats\":" + String(sats) + ",";
  // The SIM7000 reports HDOP directly; 0 means it had nothing to report.
  json += "\"hdop\":" + (accuracy > 0.0f ? String(accuracy, 2) : String("null")) + ",";
  json += "\"battery_mv\":" + (batteryMv > 0 ? String(batteryMv) : String("null")) + ",";
  // Signal quality as reported by the modem (0..31, 99 = unknown). Read during
  // the network phase, so it describes the link this reading actually went out
  // on. Not a column — it lands in the payload jsonb, where diagnostics belong.
  json += "\"csq\":" + String(modem.getSignalQuality()) + ",";
  json += "\"imei\":\"" + imei + "\",";
  json += "\"board_model\":\"" BOARD_MODEL "\",";
  json += "\"fw\":\"" FW_VERSION "\"";
  json += "}";
  return json;
}

// POST one reading to the same RPC every other device writes through.
static bool postReading(const String &payload) {
  // Explicit String(): the left operand of the first + is a string literal,
  // and leaning on Arduino's implicit char*->String promotion there is the
  // one place in this sketch where a core version could turn it into a
  // compile error rather than a concatenation.
  String body = String("{\"p_key\":\"" INGEST_KEY "\",\"p_payload\":") + payload + "}";

  http.beginRequest();
  http.post("/rest/v1/rpc/ingest");
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("apikey", SUPABASE_ANON_KEY);
  http.sendHeader("Authorization", "Bearer " SUPABASE_ANON_KEY);
  http.sendHeader("Content-Length", body.length());
  http.beginBody();
  http.print(body);
  http.endRequest();

  int status = http.responseStatusCode();
  String response = http.responseBody();
  http.stop();

  if (status == 200) {
    Serial.printf("[HTTP] 200 %s\n", response.c_str());
    return true;
  }
  Serial.printf("[HTTP] %d %s\n", status, response.c_str());
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);   // active LOW: off

  Serial.println("[BOOT] T-SIM7000G cellular tag starting");
  Serial.println("[BOOT] fw=" FW_VERSION);
  Serial.println("[BOOT] ANTENNA WARNING: attach BOTH the LTE and GNSS antennas.");

  powerOnModem();

  Serial.print("[MODEM] init ... ");
  if (!modem.init()) {
    Serial.println("FAILED — retrying with restart");
    modem.restart();
  } else {
    Serial.println("ok");
  }
  Serial.printf("[MODEM] %s\n", modem.getModemInfo().c_str());

  if (strlen(SIM_PIN) > 0 && modem.getSimStatus() != 3) {
    modem.simUnlock(SIM_PIN);
  }

  imei = modem.getIMEI();
  // The IMEI is the natural device_id for this board. It is NOT sent in the
  // payload — the ingest key already decides which device row this is — so it
  // is printed here to be reconciled with the registration:
  //   update public.devices set device_id = '<imei>' where device_id = '<the
  //   id you registered>';   -- readings follow, the FK is ON UPDATE CASCADE
  Serial.printf("[MODEM] imei=%s  <-- this board's device_id\n", imei.c_str());

  modem.setNetworkMode(NETWORK_MODE);
  modem.setPreferredMode(PREFERRED_MODE);

  // Neither GNSS nor the data session is started here: loop() owns both, and
  // starting one in setup() is exactly how the two end up overlapping.
}

void loop() {
  // seq == 0 forces the first cycle to run immediately instead of waiting out
  // one full interval before the board says anything.
  if (seq != 0 && millis() - lastCycleMs < SEND_INTERVAL_MS) {
    return;
  }
  lastCycleMs = millis();

  // --- GNSS phase (data session down) --------------------------------------
  float lat = 0, lng = 0, hdop = 0;
  int usat = 0;
  bool haveFix = acquireFix(&lat, &lng, &usat, &hdop);

  if (haveFix) {
    lastLat = lat;
    lastLng = lng;
    everHadFix = true;
  } else if (everHadFix) {
    // Lost a previously-acquired fix: keep reporting the last known position,
    // flagged as stale so the software can age it out on its own terms.
    lat = lastLat;
    lng = lastLng;
  }

  bool havePosition = haveFix || everHadFix;
  const char *status = gnssStatus(haveFix);

  if (havePosition) {
    Serial.printf("[GNSS] status=%s lat=%.6f lng=%.6f sats=%d hdop=%.2f\n",
                  status, lat, lng, usat, hdop);
  } else {
    Serial.printf("[GNSS] status=%s no position yet, sats=%d\n", status, usat);
  }

  // --- Network phase (receiver down) ---------------------------------------
  // A reading goes out on every cycle regardless of GNSS state. Silence is
  // ambiguous — it cannot be told apart from a dead tag or a dropped session.
  if (!connectNetwork()) {
    Serial.println("[NET] offline, dropping this reading");
    // ponytail: no offline buffer. A reading missed while out of coverage is
    // lost. Add a queue in NVS/SD if gap-free tracks matter.
    return;
  }

  int batteryMv = (int)modem.getBattVoltage() + BATTERY_MV_OFFSET;
  Serial.printf("[BAT] battery_mv=%d\n", batteryMv);

  seq++;
  String payload = buildPayload(status, havePosition, lat, lng, usat, hdop, batteryMv);

  digitalWrite(LED_PIN, LOW);    // active LOW: on while transmitting
  postReading(payload);
  digitalWrite(LED_PIN, HIGH);

  // Always drop the session, success or not: the next cycle opens with GNSS,
  // which cannot run while it is up. Re-attaching costs a few seconds and is
  // not optional on this modem.
  modem.gprsDisconnect();
}
