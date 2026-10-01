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
//   - TinyGSM             (Volodymyr Shymanskyy)  modem driver, GNSS, sockets
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

#include "config.h"

// Defaults for a config.h written before these existed: HTTPS straight to
// Supabase, which is what every board did until then.
#ifndef SUPABASE_TLS
#define SUPABASE_TLS 1
#endif
#ifndef SUPABASE_PORT
#define SUPABASE_PORT 443
#endif

HardwareSerial modemSerial(1);
TinyGsm modem(modemSerial);
#if SUPABASE_TLS
TinyGsmClientSecure netClient(modem);
#else
// Plain TCP. See SUPABASE_TLS in config.example.h for when and why.
TinyGsmClient netClient(modem);
#endif

// How long to wait for the server's reply once the request is out.
static const uint32_t HTTP_TIMEOUT_MS = 20000;

// Most bytes one AT+CASEND accepts. postReading() sends in a single write, so
// this is the ceiling on the whole request, headers included.
static const size_t MODEM_MAX_SEND = 1460;

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
  pinMode(MODEM_DTR, OUTPUT);
  digitalWrite(MODEM_DTR, LOW);   // keep the modem out of sleep

  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, HIGH);
  modemSerial.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);

  // PWRKEY TOGGLES the modem, it does not switch it on. The modem is powered
  // from the battery rail, so it survives an ESP32 reset (upload, serial
  // monitor opening, watchdog) — pulsing unconditionally would switch an
  // already-running modem OFF. Ask first; pulse only if it stays silent.
  if (modem.testAT(1000)) {
    Serial.println("[MODEM] already on");
    return;
  }

  // The board inverts PWRKEY, so HIGH is idle and LOW is the >1 s pulse.
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(3000);
}

// Attach to the network and open a data session. Returns false rather than
// blocking forever: the next interval retries, and a board stuck in a retry
// loop inside setup() looks identical to a dead one.
static bool connectNetwork() {
  if (modem.isGprsConnected()) return true;

  // gprsDisconnect() ends with AT+CGATT=0, a full detach. On LTE that also
  // deregisters (CEREG 0,0 — not even searching) and the modem stays that way
  // until told to attach, so without this every cycle after the first sat out
  // NETWORK_TIMEOUT_MS and dropped its reading. Returns once attached, or
  // gives up on its own; waitForNetwork below is the real verdict.
  modem.sendAT(GF("+CGATT=1"));
  modem.waitResponse(NETWORK_TIMEOUT_MS);

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

  // The GNSS antenna is active and its supply hangs off the modem's GPIO4 on
  // this board: without it the receiver runs but hears nothing (sats=0/0 on an
  // open sky). Harmless on revisions that power the antenna permanently.
  modem.sendAT(GF("+SGPIO=0,4,1,1"));
  modem.waitResponse();

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
  if (!haveFix) {
    // getGPS() fills nothing until there is a fix, so the count above reads
    // 0/0 even with satellites in view. The raw frame still carries them
    // (field 15 = in view, field 19 = best C/N0): "no fix, 8 in view" and "no
    // fix, antenna dead" are different faults.
    Serial.printf("[GNSS] raw %s\n", modem.getGPSraw().c_str());
  }

  // Off before the network phase, per the manual. Done even when the fix
  // failed: the constraint is about the receiver being powered, not about
  // whether it succeeded.
  modem.disableGPS();
  modem.sendAT(GF("+SGPIO=0,4,1,0"));
  modem.waitResponse();
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
//
// Hand-rolled rather than ArduinoHttpClient, for one reason: the request must
// leave in ONE write. TinyGSM turns every client write into its own AT+CASEND,
// and firmware R1529 answers those with a bare OK instead of the "+CASEND:"
// TinyGSM waits for, so each write stalls ~1 s on a timeout. ArduinoHttpClient
// writes header by header; on the bench one request took over 30 s to dribble
// out and the Cloudflare edge hung up half way through the headers.
//
// HTTP/1.1 and NOT "Connection: close": the reply is read while the socket is
// still open, then we close it ourselves. The modem frees a socket the moment
// the server closes it, and TinyGSM refuses to read one it has seen close (the
// SIM7000 crashes if asked). Over HTTP/1.0 the reply arrived and the close
// landed 2 ms behind it, so the reply was lost every time.
static bool postReading(const String &payload) {
  String body = String("{\"p_key\":\"" INGEST_KEY "\",\"p_payload\":") + payload + "}";

  String request = String("POST /rest/v1/rpc/ingest HTTP/1.1\r\n"
                          "Host: " SUPABASE_HOST "\r\n"
                          "Content-Type: application/json\r\n"
                          "apikey: " SUPABASE_ANON_KEY "\r\n"
                          "Authorization: Bearer " SUPABASE_ANON_KEY "\r\n"
                          "Content-Length: ") +
                   String(body.length()) + "\r\n\r\n" + body;

  if (request.length() > MODEM_MAX_SEND) {
    Serial.printf("[HTTP] request is %u bytes, one send holds %u — not sent\n",
                  (unsigned)request.length(), (unsigned)MODEM_MAX_SEND);
    return false;
  }

  if (!netClient.connect(SUPABASE_HOST, SUPABASE_PORT)) {
    Serial.println("[HTTP] connect FAILED");
    return false;
  }
  netClient.print(request);

  // Read until the body is as long as Content-Length says. A reply without one
  // (chunked) is read until the timeout; Supabase and the tunnel both send it.
  String response;
  int bodyAt = -1;
  long contentLength = -1;
  uint32_t start = millis();
  while (millis() - start < HTTP_TIMEOUT_MS && netClient.connected()) {
    while (netClient.available()) response += (char)netClient.read();
    if (bodyAt < 0) {
      bodyAt = response.indexOf("\r\n\r\n");
      if (bodyAt >= 0) {
        String head = response.substring(0, bodyAt);
        head.toLowerCase();
        int at = head.indexOf("\r\ncontent-length:");
        if (at >= 0) contentLength = head.substring(at + 17).toInt();
      }
    }
    if (bodyAt >= 0 && contentLength >= 0 &&
        (long)response.length() - (bodyAt + 4) >= contentLength) {
      break;
    }
    delay(100);   // each available() is an AT round trip; do not spin on it
  }
  netClient.stop();

  // "HTTP/1.1 200 OK" -> 200. No status line at all (timeout, reset) -> 0.
  int status = response.startsWith("HTTP/")
                   ? response.substring(response.indexOf(' ') + 1).toInt()
                   : 0;
  String reply = bodyAt >= 0 ? response.substring(bodyAt + 4) : response;

  Serial.printf("[HTTP] %d %s\n", status, reply.c_str());
  return status == 200;
}

// Bring the modem to a known state: powered, initialised, SIM unlocked, radio
// access technology set. Runs at boot, and again whenever the modem stops
// answering mid-run.
static void startModem() {
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

  modem.setNetworkMode(NETWORK_MODE);
  modem.setPreferredMode(PREFERRED_MODE);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);   // active LOW: off

  Serial.println("[BOOT] T-SIM7000G cellular tag starting");
  Serial.println("[BOOT] fw=" FW_VERSION);
  Serial.println("[BOOT] ANTENNA WARNING: attach BOTH the LTE and GNSS antennas.");

  startModem();

  imei = modem.getIMEI();
  // The IMEI is the natural device_id for this board. It is NOT sent in the
  // payload — the ingest key already decides which device row this is — so it
  // is printed here to be reconciled with the registration:
  //   update public.devices set device_id = '<imei>' where device_id = '<the
  //   id you registered>';   -- readings follow, the FK is ON UPDATE CASCADE
  Serial.printf("[MODEM] imei=%s  <-- this board's device_id\n", imei.c_str());

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
  // On the bench the SIM7000 has gone silent (and once rebooted) around the
  // GNSS phase. Cause not pinned down; a LiPo sagging under GNSS + radio load
  // is the suspect. Left alone, a silent modem costs a full NETWORK_TIMEOUT_MS
  // to notice and then fails every cycle after, so ask first and bring it back.
  if (!modem.testAT(1000)) {
    Serial.println("[MODEM] stopped answering, restarting it");
    startModem();
  }

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
