# XIAO nRF54L15 Channel Sounding gateway firmware

Measures the **distance to nearby tags** using Bluetooth Channel Sounding and
prints **one JSON line per ranging result** over USB serial — the same transport
the T-Echo LoRa gateway already uses, consumed by the same bridge.

Based on the nRF Connect SDK sample
`nrf/samples/bluetooth/channel_sounding/ras_initiator`.

## Board

```
Seeed Studio XIAO nRF54L15
Zephyr board target: xiao_nrf54l15/nrf54l15/cpuapp
```

Requires **nRF Connect SDK v3.0.1 or newer**; built and verified against
**v3.4.0**.

## Output format

One JSON object per line, in exactly the shape the LoRa gateway uses: the tag's
own reading nested under `payload`, wrapped in an envelope naming the gateway
that heard it. A ranging result just carries `distance_m` where a GPS tag
carries `lat`/`lng`:

```json
{"device_id":"CSGW01","fw":"cs-0.1.0","received_at_ms":12345,
 "payload":{"device_id":"a1b2c3d4e5f60718","distance_m":3.42,"status":"ok","rssi":-54}}
```

A line with **no** `payload` is the gateway's own reading:

```json
{"device_id":"CSGW01","fw":"cs-0.1.0","status":"no_gps",
 "lat":null,"lng":null,"sats":0,"uptime_ms":12345,"tags_in_range":2}
```

This board has **no GNSS**, so it reports `no_gps` and null coordinates rather
than a placeholder position. Debug lines start with `[`; the bridge discards any
line not starting with `{`. Full spec: `../../docs/packet-format.md`.

### It never fabricates a distance

A failed ranging attempt reports `"distance_m": null, "status": "failed"` — not
a stale or guessed value. Same rule the GPS tag follows for `lat`/`lng`: a
made-up number is indistinguishable from a measured one once it is in the
database. The database enforces it too (a `failed` reading cannot carry any
measurement).

A tag that was advertising but could not be ranged still produces a `failed`
observation rather than silence, so "present but unrangeable" does not look
identical to "not there".

## Multiple tags

Tags are discovered by the UID in their advertising data, kept in a small
round-robin table (8 slots), and ranged **in turn** — the radio cannot scan and
range simultaneously, so the two take turns:

```
scan (2s) -> pick next tag -> range it (4s) -> disconnect -> repeat
```

A tag not heard from for 60 s is dropped from the rotation. Tags are matched on
UID rather than address, because the BLE address randomises.

**It does not stall when a tag disappears.** Every wait in the ranging sequence
is bounded (10 s), and the disconnect callback wakes every one of them, so a tag
that vanishes mid-session costs one session — not the gateway. The upstream
sample reboots on disconnect; this firmware deliberately does not, because that
would drop every other tag and the serial link to the bridge with it.

## Build

```bash
export PATH="$HOME/.venv/ncs/bin:$HOME/.local/bin:$PATH"
export ZEPHYR_BASE=~/ncs/zephyr
cd ~/ncs
west build -p always -b xiao_nrf54l15/nrf54l15/cpuapp \
  -d /tmp/cs-gw-build /path/to/firmware/xiao-cs-gateway
```

Output: `/tmp/cs-gw-build/xiao-cs-gateway/zephyr/zephyr.hex`.

## Flash

No UF2 bootloader — onboard **CMSIS-DAP v2**. See
`../../docs/setup-cs-firmware.md`.

## Configuration

`Kconfig`:

| Option | Default | Meaning |
| --- | --- | --- |
| `CS_GATEWAY_ID` | `CSGW01` | Label in every serial line. |
| `CS_GATEWAY_FW_VERSION` | `cs-0.1.0` | Reported upstream. |
| `CS_GATEWAY_RANGING_DWELL_MS` | 4000 | How long one tag holds the radio. |
| `CS_GATEWAY_REPORT_MIN_MS` | 1000 | Min gap between reported observations. |
| `CS_GATEWAY_SCAN_WINDOW_MS` | 2000 | Share given to discovering tags. |
| `CS_GATEWAY_STATUS_MS` | 30000 | Heartbeat interval. |

`CS_GATEWAY_ID` is a label only — the bridge authenticates to Supabase with the
gateway key in its own `.env`, not with this value.

Channel Sounding produces fresh estimates at about **10 Hz**. Reporting all of
them would write ~860k rows per tag per day for no extra information, since they
all come from the same median window — so `CS_GATEWAY_REPORT_MIN_MS` paces the
output the way the T-Beam tag paces itself with `SEND_INTERVAL_MS`. Measured on
hardware: ~0.7 observations/second reaching the database.

**Distance calibration:** the reported metres come from the SDK's `cs_de`
estimator, filtered through a 9-sample median (raw CS estimates are noisy and a
median rejects outliers a mean would smear). Real hardware has a real offset —
antenna placement, board orientation and enclosure all shift it. Measure at a
known distance before trusting absolute values; the estimator is in
`get_distance()` in `src/main.c`.

## Verifying it works

```
[00:00:00.xxx] <inf> cs_gateway: Starting Channel Sounding gateway (fw cs-0.1.0)
[00:00:00.xxx] <inf> cs_gateway: gateway_id=CSGW01
[00:00:02.xxx] <inf> cs_gateway: New tag uid=a1b2c3d4e5f60718 rssi=-52
[00:00:02.xxx] <inf> cs_gateway: Ranging tag uid=a1b2c3d4e5f60718
{"device_id":"CSGW01",...,"payload":{"device_id":"a1b2c3d4e5f60718",...,"distance_m":1.87,...}}
```

Move the two boards apart — `distance_m` should track it. If it does not, that
is the calibration note above, not a wiring fault.
