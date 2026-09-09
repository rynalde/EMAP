# Bridge — USB serial → Supabase

Reads JSON lines printed by a gateway over USB serial, validates them, and
forwards each reading to the `ingest` Supabase RPC.

```
gateway (USB serial JSON)  →  bridge  →  Supabase RPC ingest
```

Gateways only. A cellular tag (`firmware/tsim7000g-tag`) calls the same RPC
over LTE and never passes through here.

## Requirements

* [Bun](https://bun.sh) (preferred) **or** Node.js 20+.
* The Supabase migration applied (see `../supabase/README.md`).
* A gateway plugged in, or use **mock mode** (no hardware needed).

## Setup

```bash
cd bridge
cp ../.env.example .env      # then edit .env and fill in SUPABASE_ANON_KEY
bun install                  # or: npm install
```

Edit `.env`:

```env
SUPABASE_URL=https://lvvulorcvuxuyrnumfay.supabase.co
SUPABASE_ANON_KEY=<your anon key>
GATEWAY_KEY=<the key register_device printed once>
SERIAL_PORT=/dev/tty.usbmodemXXXX   # macOS; Linux: /dev/ttyACM0 ; Windows: COM3
SERIAL_BAUD=115200
```

> Bun auto-loads `.env`. With Node, run with `node --env-file=.env ...`.

## Run against real hardware

```bash
bun run dev          # opens SERIAL_PORT and streams to Supabase
```

Expected logs:

```
[BRIDGE] connected serial /dev/tty.usbmodem1101 @ 115200 baud
[BRIDGE] relay device=A4CF12345678 status=fix (38.7223, -9.1393) rssi=-82
[SUPABASE] reading_id=42 device=A4CF12345678
```

## Run in mock mode (no hardware)

Mock mode reads JSON lines from **stdin** instead of a serial port, so you can
test the full Supabase path with fake packets.

```bash
# Pipe a single fake gateway line:
echo '{"device_id":"GW001","fw":"mvp-0.2.0","received_at_ms":123,"rssi":-82,"snr":7.5,"payload":{"device_id":"A4CF12345678","seq":1,"status":"fix","lat":38.7223,"lng":-9.1393,"battery_mv":4100,"sats":7,"hdop":1.2,"fw":"mvp-0.2.0"}}' \
  | MOCK_SERIAL=1 bun run src/index.ts
```

Debug lines (anything not starting with `{`) are ignored. Set `BRIDGE_VERBOSE=1`
to echo them as `[DEVICE] ...`.

## How it works

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Wires the pipeline; line filtering and logging. |
| `src/serial.ts` | `SerialLineSource` (real) and `StdinLineSource` (mock). |
| `src/supabase.ts` | Config loading + `ingest` RPC with retry/backoff. |
| `src/packetSchema.ts` | zod schema + line flattening (rssi/snr → payload). |
| `src/dispatch.test.ts` | Asserts what reaches the RPC (`bun test`). |

## Troubleshooting

* **`Missing required env vars`** — copy `.env.example` to `.env` and fill it in.
* **`Invalid ingest key`** — `GATEWAY_KEY` must hash to a row in `devices`.
* **Serial won't open** — check the port name and that nothing else (Arduino IDE
  Serial Monitor) holds the port. See `../docs/troubleshooting.md`.
* **`serialport` build fails** — use mock mode, or install build tools; the
  native module is only needed for real hardware.
