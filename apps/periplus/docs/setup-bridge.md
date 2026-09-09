# Bridge setup

The bridge reads JSON lines from a **gateway** over USB serial and forwards
each reading to Supabase.

It is only needed for gateways. A cellular tag (`firmware/tsim7000g-tag`)
reaches the same `ingest` RPC over LTE and never passes through here.

## 1. Install a runtime

**Node.js 20+ is required for real hardware.** Bun crashes loading the
`serialport` native module:

```
panic(main thread): unsupported uv function: uv_default_loop
```

Bun is fine for mock mode, which reads stdin and never loads that module — which
is exactly why this is easy to miss.

## 2. Install dependencies

```bash
cd bridge
bun install        # or: npm install
```

> The `serialport` native module is only needed for real hardware. If it fails
> to build, you can still use **mock mode** (below).

## 3. Configure

```bash
cp ../.env.example .env
```

Fill in `.env`:

```env
SUPABASE_URL=https://lvvulorcvuxuyrnumfay.supabase.co
SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
GATEWAY_KEY=<the key register_device printed once>
SERIAL_PORT=/dev/tty.usbmodemXXXX
SERIAL_BAUD=115200
```

Find your serial port:

| OS | Typical port |
| --- | --- |
| macOS | `/dev/tty.usbmodemXXXX` or `/dev/tty.SLAB_USBtoUART` |
| Linux | `/dev/ttyACM0` or `/dev/ttyUSB0` |
| WSL2 | `/dev/ttyACM0`, after `usbipd attach` — see `troubleshooting.md` |
| Windows | `COM3` |

## 4. Run

### Against real hardware

```bash
node --experimental-strip-types --env-file=.env src/index.ts
```

```
[BRIDGE] connected serial /dev/ttyACM0 @ 115200 baud
[BRIDGE] self device=GW001 status=acquiring (no position) rssi=?
[SUPABASE] reading_id=9 device=GW001
[BRIDGE] relay device=DC43A9BBBC2C status=fix (38.7223, -9.1393) rssi=-44
[SUPABASE] reading_id=10 device=DC43A9BBBC2C
```

It is not a service — nothing reaches Supabase unless this is running.

### Mock mode (no hardware)

Reads JSON from stdin instead of serial:

```bash
echo '{"device_id":"GW001","fw":"mvp-0.2.0","received_at_ms":123,"rssi":-82,"snr":7.5,"payload":{"device_id":"AABBCCDDEEFF","seq":1,"status":"acquiring","lat":null,"lng":null,"battery_mv":3700,"sats":0,"hdop":null,"fw":"mvp-0.2.0"}}' \
  | MOCK_SERIAL=1 bun run src/index.ts
```

A ranging line and a gateway self-report go through the same command:

```bash
echo '{"device_id":"GWCS01","fw":"cs-0.2.0","payload":{"device_id":"a1b2c3d4e5f60718","distance_m":3.42,"status":"ok","rssi":-54}}' \
  | MOCK_SERIAL=1 bun run src/index.ts

echo '{"device_id":"GW001","fw":"mvp-0.2.0","status":"fix","lat":38.7223,"lng":-9.1393,"sats":9}' \
  | MOCK_SERIAL=1 bun run src/index.ts
```

## Behavior

* Ignores any serial line that does not start with `{` (debug logs).
* Validates JSON with zod; logs `[ERROR] invalid packet ...` and skips bad lines.
* Flattens the line to one payload:
  * has `payload` → the tag's own reading, with the gateway's measured `rssi`
    and `snr` filled in where the tag left them unset.
  * no `payload` → the line itself is the gateway's reading.
  * `raw_payload` only, no `status` → a frame that did not parse as JSON;
    logged as a diagnostic and skipped.
* Calls `ingest` with exponential-backoff retry on transient failures.
* Does **not** retry clear client errors (invalid ingest key, coordinate out of
  range, a `failed` reading carrying a measurement).

There is no routing left here — every line reaches the same RPC, which works
out from the payload whether the reading is relayed or self-reported.

`lat`/`lng`/`hdop`/`distance_m` are `.nullable()` in the zod schema, not just
`.optional()`. Devices send an explicit `null` when they have nothing to report,
and `.optional()` alone permits `undefined` but **rejects `null`** — every
no-fix reading would be dropped. Unknown keys `.passthrough()` instead of being
stripped, so firmware diagnostics reach the payload jsonb without a schema
change.

Set `BRIDGE_VERBOSE=1` to echo device debug lines as `[DEVICE] ...`.

See `troubleshooting.md` if the port won't open.
