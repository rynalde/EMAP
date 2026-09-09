// config.example.h — copy to config.h and fill in for your board and SIM.
//
// IMPORTANT: config.h is gitignored. Never commit real keys.
#pragma once

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
#define FW_VERSION            "cell-0.2.0"
#define BOARD_MODEL           "LILYGO T-SIM7000G"

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------
// Host only — no scheme, no path. The board POSTs to /rest/v1/rpc/ingest.
#define SUPABASE_HOST         "lvvulorcvuxuyrnumfay.supabase.co"

// Public anon key. It is public by design and is NOT what authenticates this
// board; it only gets the request past PostgREST.
#define SUPABASE_ANON_KEY     ""

// This board's ingest key, from:
//   select public.register_device('<device_id>', 'tag', 'cellular',
//                                 'LILYGO T-SIM7000G', '<label>');
//
// A SHARED SECRET: anyone holding it can write readings as this device. It is
// printed once by register_device and stored only as a hash — rotate by
// re-running register_device rather than trying to recover it.
//
// Unlike a LoRa tag, this board talks to Supabase directly, so it needs a key
// of its own. It reports as whichever device the key belongs to and never
// sends a device_id, so the two can never disagree.
#define INGEST_KEY            ""

// ---------------------------------------------------------------------------
// Cellular
// ---------------------------------------------------------------------------
// From your carrier. Most CAT-M/NB-IoT SIMs need only the APN.
#define APN                   "internet"
#define GPRS_USER             ""
#define GPRS_PASS             ""

// SIM PIN, or "" when the SIM has none.
#define SIM_PIN               ""

// Radio access technology. SIM7000 numbering:
//   2 = automatic, 13 = GSM only, 38 = LTE only, 51 = GSM + LTE
// LTE only is the right default for a CAT-M/NB-IoT SIM: `automatic` will camp
// on 2G where it exists and burn far more power for less throughput.
#define NETWORK_MODE          38
// Preferred LTE mode: 1 = CAT-M, 2 = NB-IoT, 3 = both.
// CAT-M first: NB-IoT attaches slowly and many networks do not carry it.
#define PREFERRED_MODE        1

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
// Cellular data is metered and the modem is the biggest current draw on the
// board, so this is far longer than the LoRa tag's 3 s. Every interval sends a
// reading whether or not there is a fix — silence is ambiguous.
//
// This is the interval between the START of one cycle and the next, not the
// gap between them. A cycle that spends the full GNSS_FIX_TIMEOUT_MS searching
// already outlasts this, so the effective period is
// max(SEND_INTERVAL_MS, actual cycle duration): a board under open sky reports
// every 30 s, one that cannot see satellites settles into a slower rhythm on
// its own instead of hammering the modem.
#define SEND_INTERVAL_MS      30000

// How long to wait for the network and for the data session before giving up
// and retrying on the next interval.
#define NETWORK_TIMEOUT_MS    60000

// ---------------------------------------------------------------------------
// GNSS
// ---------------------------------------------------------------------------
// The SIM7000G cannot run GNSS and cellular data at once (LILYGO's manual:
// "disconnect the network when positioning, and turn off GPS when connecting to
// the network"), so the receiver is powered only for this window and shut down
// before the modem attaches. That makes the timeout a real budget rather than a
// safety net.
//
// A cold start with no almanac genuinely takes ~60 s under open sky; warm
// starts are a few seconds, so raising this costs nothing on a board that is
// already tracking. Lower it if you would rather report "acquiring" quickly
// than wait for a first fix.
#define GNSS_FIX_TIMEOUT_MS   90000

// How often to ask the receiver (AT+CGNSINF) while waiting. Polling faster does
// not make satellites arrive sooner; it only keeps the UART and the CPU busy.
#define GNSS_POLL_INTERVAL_MS 2000

// ponytail: staleness is decided by whether the receiver still reports a fix,
// not by a clock. The board has no time source it trusts until GNSS gives it
// one, so an age threshold would be measuring against millis() since boot.

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------
// Read from the modem (AT+CBC), which measures its own VBAT rail — the battery.
// Every board's rail differs slightly; measure with a multimeter once and put
// the difference here rather than trusting the reading blind.
//
// The board also exposes a battery divider on GPIO35 (and solar on GPIO36) if
// you ever want a reading that does not depend on the modem being awake.
#define BATTERY_MV_OFFSET     0

// ---------------------------------------------------------------------------
// Pin map — VERIFY against your board revision before flashing!
// Defaults are the LILYGO T-SIM7000G V1.0 mapping, confirmed against
// https://github.com/Xinyuan-LilyGO/LilyGO-T-SIM7000G
// ---------------------------------------------------------------------------
#define MODEM_TX_PIN   27   // ESP32 TX -> SIM7000 RX
#define MODEM_RX_PIN   26   // ESP32 RX <- SIM7000 TX
#define MODEM_PWRKEY   4    // pulse to power the modem on
#define MODEM_DTR      25
#define MODEM_BAUD     115200

#define LED_PIN        12   // active LOW on this board
