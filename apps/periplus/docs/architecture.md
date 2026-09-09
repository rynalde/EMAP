# Architecture

Three ways of tracking a device, one backend.

```
LILYGO T-Beam tags          Seeed XIAO nRF54L15 tags      LILYGO T-SIM7000G tags
(ESP32 + SX1276 + NEO-6M)   (BLE Channel Sounding)        (ESP32 + SIM7000G + GNSS)
  │ raw LoRa P2P, JSON        │ BLE, ranged by gateway       │
  ▼                           ▼                              │
LILYGO T-Echo gateway       XIAO CS gateway                  │ LTE CAT-M / NB-IoT
(nRF52840 + SX1262 + L76K)  (nRF54L15)                       │ HTTPS, direct
  │ USB serial, one JSON line per reading                    │ no gateway at all
  ▼                           ▼                              │
        Local TypeScript bridge  (Node — see runtime note)   │
                    │  ingest(key, payload)                  │
                    ▼                                        ▼
        Supabase  (project: periplus / lvvulorcvuxuyrnumfay)
                    │  devices, readings, latest_positions
                    ▼
        web/  Next.js map (Leaflet + OSM)      dashboard/  Vite tables
```

## The model

Two tables and one write path, because the three links have the whole model in
common: **a device reports an observation about itself or about another
device.** How it reached the network is an attribute, not a schema.

| | |
| --- | --- |
| `devices` | every tag AND every gateway, one row each. `kind` = what it is (`tag`/`gateway`), `link` = how it talks (`lora`/`ble_cs`/`cellular`) |
| `readings` | one row per observation. `reported_by` is null for a self-report and names the gateway for a relayed one |
| `latest_positions` | the view every client reads: newest reading per device, joined to the device and its reporter |
| `ingest(key, payload)` | the only write path |
| `register_device(...)` | issues an ingest key. Returns it once; only the hash is stored |

There is no `lora_*` or `cs_*` table any more, and no per-link ingest function.
Adding cellular under the old shape would have meant a third table set, a third
RPC and a third pair of views — three places to touch for every future field.

## Components

| Component | Tech | Folder |
| --- | --- | --- |
| LoRa tag firmware | Arduino / ESP32 / RadioLib / TinyGPSPlus / U8g2 | `firmware/tbeam-tag` |
| LoRa gateway firmware | Arduino / nRF52 / RadioLib / GxEPD2 / TinyGPSPlus | `firmware/techo-gateway` |
| CS tag firmware | Zephyr / nRF Connect SDK | `firmware/xiao-cs-tag` |
| CS gateway firmware | Zephyr / nRF Connect SDK | `firmware/xiao-cs-gateway` |
| Cellular tag firmware | Arduino / ESP32 / TinyGSM / ArduinoHttpClient | `firmware/tsim7000g-tag` |
| Hardware self-test | Arduino / ESP32 — bring-up diagnostics | `firmware/tbeam-selftest` |
| Bridge | TypeScript + zod + serialport | `bridge` |
| Backend | Supabase (Postgres) | `supabase` |
| Map | Next.js + React Leaflet | `web` |
| Tables | React + Vite | `dashboard` |

## Data flow

1. **Tag** reports every interval **regardless of what it knows**, carrying a
   `status` field rather than a fabricated position. A LoRa tag jitters the
   interval and checks the channel is clear first, so several tags do not
   collide.
2. **Gateway** receives, adds what only it could measure (RSSI, SNR), wraps the
   tag's own JSON under `payload`, and prints one line.
3. **Gateway self-report**, separately: on a timer, the gateway prints a line
   with **no** `payload` — that line *is* the gateway's reading. Without it a
   gateway hearing no tags would never report where it is, and the map would
   have no anchor exactly when no tag can supply one.
4. **Cellular tag** skips steps 2–3 and 5 entirely: it holds its own ingest key
   and POSTs the same payload shape to `/rest/v1/rpc/ingest` over LTE.
5. **Bridge** reads lines, skips non-JSON debug output, validates with zod,
   flattens the line to one payload, and calls `ingest`. It no longer routes:
   a line with `payload` is relayed, a line without is the gateway's own.
6. **Supabase** validates the ingest key, upserts the device, appends the
   reading. `devices.last_*` uses `coalesce(new, existing)` so a device that
   loses its fix keeps its last known position instead of blanking it.
7. **Map** polls every 5 s, centres on the gateway, plots devices that have a
   position, draws ranged tags as the circle they actually are, and lists
   whatever has neither.

## Design choices

* **Never fabricate a position.** There is no demo or fallback coordinate. When
  a device does not know where it is, it sends `null` and says why in `status`.
  A made-up value is indistinguishable from a real one once it is stored.
* **A distance is not a position.** A Channel Sounding reading has `distance_m`
  and null `lat`/`lng`. The derived circle (`origin_lat`, `origin_lng`,
  `radius_m`) is computed in the view and never stored.
* **Always report.** Silence cannot be told apart from a dead tag or a broken
  link, so it is never used to signal anything.
* **Identity from silicon.** `device_id` is the ESP32 efuse MAC, the nRF54L15
  FICR.DEVICEID, or the modem IMEI — so one firmware image serves every board
  with no provisioning step.
* **A key per writer, not per link.** Gateways and cellular tags hold ingest
  keys. LoRa and CS tags hold none: the gateway authenticates for them.
* **JSON over the air** — larger than binary, trivially debuggable.
* **Raw LoRa P2P** — no LoRaWAN yet.

## Runtime note: Node, not Bun

The bridge must run under **Node** for real hardware. Bun crashes loading the
`serialport` native module:

```
panic(main thread): unsupported uv function: uv_default_loop
```

Mock mode works under either, because it reads stdin and never loads the native
module. This is easy to miss for exactly that reason.

## Security model

`devices` holds `ingest_key_hash`, so anon has a **column grant, not a table
grant** — the hash column is unreadable. Consequences:

* `select("*")` on `devices` fails with *permission denied*; a client must list
  columns explicitly. (`latest_positions` is fine: it never selects the hash.)
* Any new column on `devices` needs its own `grant select (col)` or the clients
  cannot see it.

`register_device` is granted to `service_role` only — a role that could mint
keys would make the key pointless.

An ingest key is a shared secret validated in a `security definer` function.
MVP-level only: the anon key is public by design, so anyone holding a device's
ingest key can write readings as that device.

## Known limitations

See the root `README.md` → Known Limitations, and `docs/troubleshooting.md`.
