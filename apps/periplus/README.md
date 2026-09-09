# periplus

A small, working MVP for tracking devices three different ways — **LoRa**,
**Bluetooth Channel Sounding**, and **cellular** — behind one backend.

> *περίπλους* — the ancient Greek log of positions recorded in order along a
> route. Which is what `public.readings` is.

Goal: prove that a device can report where it is (or how far away it is) over
whichever radio suits it, and that the data reaches Supabase reliably through a
single write path.

```
LILYGO T-Beam tags          Seeed XIAO nRF54L15 tags     LILYGO T-SIM7000G tags
  ↓ raw LoRa P2P, JSON        ↓ BLE Channel Sounding       │
LILYGO T-Echo gateway       XIAO CS gateway                │ LTE CAT-M / NB-IoT
  ↓ USB serial JSON           ↓ USB serial JSON            │ HTTPS, no gateway
       Local TypeScript bridge  (Node — Bun cannot load serialport)
                        ↓ ingest(key, payload)            ↓
       Supabase: periplus / lvvulorcvuxuyrnumfay
                        ↓ devices, readings, latest_positions
       web/ Next.js map          dashboard/ Vite tables
```

## Boards used

| Board | Role | Radio | Bring-up verified |
| --- | --- | --- | --- |
| LILYGO T-Beam V1.2 (AXP2101) ×2 | GPS tag | LoRa SX1276 @923 MHz | **Yes** — ESP32-D0WDQ6-V3, 4 MB PSRAM, NEO-6M, SSD1306 OLED populated |
| LILYGO T-Echo | LoRa gateway | LoRa SX1262 @923 MHz | **Yes** — nRF52840, Quectel L76K GNSS, GDEH0154D67 e-paper |
| Seeed XIAO nRF54L15 | CS tag | BLE Channel Sounding | Not in this bring-up |
| Seeed XIAO nRF54L15 | CS gateway | BLE Channel Sounding | Not in this bring-up |
| LILYGO T-SIM7000G | Cellular tag | LTE CAT-M / NB-IoT + GNSS | Not in this bring-up |

Three independent tracking systems. Two share one USB-serial transport and one
bridge; the cellular board skips both and talks to Supabase itself. All three
write through the same RPC into the same two tables. The LoRa and cellular
boards build with Arduino/PlatformIO; the XIAO boards need Zephyr / nRF Connect
SDK ≥ 3.0.1.

Measured end to end: two LoRa tags at 3 s, **59 sent / 59 received / 0 CRC
errors**. Full detail and the gotchas in `docs/hardware.md`.

> ⚠️ **Antenna safety:** Never transmit LoRa without the antenna connected.
> Attach the antenna before powering either board, or you can damage the radio.
> The T-SIM7000G needs **two** antennas — LTE and GNSS.

## Repository layout

```
firmware/
  tbeam-tag/        ESP32 T-Beam GPS tag sketch
  techo-gateway/    nRF52 T-Echo USB serial gateway sketch
  xiao-cs-tag/      XIAO nRF54L15 Channel Sounding tag (Zephyr/NCS)
  xiao-cs-gateway/  XIAO nRF54L15 Channel Sounding gateway (Zephyr/NCS)
  tsim7000g-tag/    ESP32 + SIM7000G cellular tag — no gateway, posts directly
  tbeam-selftest/   ESP32 hardware bring-up self-test (never transmits)
bridge/             TypeScript serial -> Supabase bridge (Node; gateways only)
supabase/           devices / readings schema migrations + seed
web/                Next.js map view (Leaflet + OpenStreetMap)
dashboard/          Minimal React + Vite tables
docs/               Architecture, hardware, pinout, setup, testing, troubleshooting
```

## One backend, three links

| | **LoRa tag** (T-Beam) | **CS tag** (XIAO nRF54L15) | **Cellular tag** (T-SIM7000G) |
| --- | --- | --- | --- |
| Knows where it is | Yes, from GNSS | **No** — it only gets ranged | Yes, from the modem's GNSS |
| Reports | A position (`lat`/`lng`) | A distance (`distance_m`) | A position (`lat`/`lng`) |
| Identity | efuse MAC, 12 hex | `FICR.DEVICEID`, 16 hex | modem IMEI, 15 digits |
| Needs a gateway | Yes | Yes | **No** |
| Holds an ingest key | No | No | **Yes**, its own |
| Reports when lost | Always, with a `status` | Always, with a `status` | Always, with a `status` |
| `devices.link` | `lora` | `ble_cs` | `cellular` |

All three are rows in the same two tables — the radio is a column, not a
schema. What is deliberately *not* merged: `lat`/`lng` and `distance_m` are
separate columns. A distance is a different kind of observation from a
coordinate, and absolute position for a ranged tag is *derived* by a view as an
origin plus a radius — never written into a position column as if it were a fix.

See `docs/architecture.md` and `docs/packet-format.md`.

## Quick start (software-only, no hardware)

You can exercise the entire backend + bridge path without boards.

1. **Supabase** — apply the migrations and register a gateway
   (`docs/setup-supabase.md`). The schema never touches the existing
   `public.tags` table.

2. **Bridge** — run in mock mode:

   ```bash
   cd bridge
   cp ../.env.example .env      # fill in SUPABASE_ANON_KEY and GATEWAY_KEY
   bun install
   echo '{"device_id":"GW001","fw":"mvp-0.2.0","received_at_ms":123,"rssi":-82,"snr":7.5,"payload":{"device_id":"AABBCCDDEEFF","seq":1,"status":"acquiring","lat":null,"lng":null,"battery_mv":3700,"sats":0,"hdop":null,"fw":"mvp-0.2.0"}}' \
     | MOCK_SERIAL=1 bun run src/index.ts
   # -> [SUPABASE] reading_id=... device=AABBCCDDEEFF
   ```

3. **Dashboard**:

   ```bash
   cd dashboard
   cp ../.env.example .env       # fill in VITE_SUPABASE_ANON_KEY
   npm install && npm run dev    # http://localhost:5173
   ```

4. **Map** (Next.js):

   ```bash
   cd web
   cp .env.example .env.local    # fill in NEXT_PUBLIC_SUPABASE_ANON_KEY
   bun install
   PORT=3100 bun run dev         # http://localhost:3100
   ```

## Full hardware bring-up

Follow the docs in order:

1. `docs/setup-arduino.md` — flash the LoRa boards. (Channel Sounding:
   `docs/setup-cs-firmware.md`. Cellular:
   `firmware/tsim7000g-tag/README.md`.)
2. `docs/setup-supabase.md` — apply schema, register devices, validate.
3. `docs/setup-bridge.md` — connect a gateway to Supabase.
4. `docs/testing-checklist.md` — end-to-end verification.

## Supabase backend

Existing project (do **not** create a new one):

```
Project ref:  lvvulorcvuxuyrnumfay
Project name: periplus
Region:       sa-east-1
```

The whole schema:

```
public.devices            every tag and every gateway; kind + link say which
public.readings           one row per observation, whatever produced it
public.latest_positions   (view) newest reading per device — what clients read
public.ingest(...)        (RPC) the only write path
public.register_device(...)  issues an ingest key; service_role only
```

There is no `lora_*` or `cs_*` table any more. The
`20260908120000_unify_device_schema` migration backfills from them (ingest keys
included, so gateways in the field keep working) and then drops them.

An ingest key is generated by `register_device`, printed **once**, and never
committed. Copy it into `bridge/.env` — or a cellular board's `config.h` — at
that moment: only a SHA-256 hash is stored, so it cannot be read back. Lost it?
Rotate by re-registering the same device:

```sql
-- prints a new key once; store it immediately
select public.register_device('GW001', 'gateway', 'lora');
```

It is a shared secret: the anon key is public by design, so anyone who also has
a device's ingest key can write readings as that device.

## Never a fabricated position

There is no demo or fallback coordinate anywhere in the firmware. A device that
does not know where it is sends `lat`/`lng` as `null` and says why in `status`
(`fix` / `stale` / `acquiring` / `no_gps`). A ranging attempt that failed sends
`distance_m` as `null` with `status: "failed"`, and the database rejects a
failed reading that carries any measurement. A made-up value is
indistinguishable from a real one once it is stored.

Devices also report on **every** interval regardless of what they know — silence
cannot be told apart from a dead tag or a broken link, so it never carries
meaning.

## Known limitations

* JSON packets are larger than binary packets.
* Raw LoRa P2P has no multi-gateway deduplication yet.
* Ingest keys are MVP-level security, **not** production auth.
* No LoRaWAN yet.
* No enclosure / power optimization yet.
* Single gateway; no multi-gateway dedup.
* At 3 s intervals the LoRa channel supports roughly 8–10 tags before collisions
  bite.
* E-paper refresh makes the T-Echo radio-deaf for 433 ms per redraw.
* The cellular tag has no offline buffer and no deep sleep: readings taken out
  of coverage are dropped, and battery life is hours rather than weeks.
* Ranged tags are located from one gateway only — a circle, not a point.
  Multilateration would need three.

## Next steps

* Binary payload encoding to cut airtime.
* Real device auth (signed payloads) instead of a shared key.
* Multi-gateway dedup and RSSI-based gateway selection.
* Offline buffering on the cellular tag.
* LoRaWAN migration if scaling beyond one gateway.

## License

See `LICENSE`.
