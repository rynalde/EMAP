# Troubleshooting

## LoRa: gateway never receives anything

* **Frequency/params mismatch** — tag and gateway must share `LORA_FREQUENCY`,
  bandwidth, spreading factor, coding rate, and sync word. Double-check both
  `config.h` files.
* **Wrong LoRa chip selected** — on the T-Beam, define the correct
  `LORA_CHIP_SX1276` vs `LORA_CHIP_SX1262`.
* **Antenna** — confirm the antenna is attached on both boards.
* **Distance/orientation** — start with the boards a few meters apart.
* **`radio.begin` FAILED code** — usually wrong CS/RST/BUSY/DIO pins; verify
  against `pinout.md` and your board revision.

## Tag: no GPS fix

* GPS needs a clear sky view; indoors it may never fix. The tag keeps
  transmitting regardless, with `status` reporting why:
  * `no_gps` — no NMEA bytes at all. A power (ALDO3) or wiring fault, not a
    satellite problem.
  * `acquiring` — receiver is alive but has no fix. Needs sky view or time.
  * `stale` — had a fix, it aged out; `lat`/`lng` are the last known position.
  * `fix` — live position.
* Check `[GPS] status=acquiring ... sats=N` — N should climb outdoors.
* Satellites *used* stays 0 until a fix exists. To see satellites *in view*,
  run `firmware/tbeam-selftest`, which re-enables the GSV sentence over UBX.
* Verify `GPS_RX_PIN`/`GPS_TX_PIN` and `GPS_BAUD` (usually 9600).

## T-Echo: upload fails

* Enter DFU mode: **double-click** the reset button, then upload immediately.
* Make sure the **Adafruit nRF52** board package is installed and the correct
  T-Echo target is selected.

## Bridge: `Missing required env vars`

* Copy `.env.example` to `bridge/.env` and fill in `SUPABASE_ANON_KEY`.
* With Node, load it: `node --env-file=.env ...` (Bun auto-loads `.env`).

## Bridge: serial port won't open

* Wrong port name — list ports (`ls /dev/tty.*` on macOS, `ls /dev/ttyACM*` on
  Linux) and set `SERIAL_PORT`.
* Port busy — close the Arduino IDE Serial Monitor (only one process can hold
  the port).
* Permissions (Linux) — add your user to the `dialout` group:
  `sudo usermod -aG dialout $USER` then re-login.
* `serialport` native build failed — use **mock mode** (`MOCK_SERIAL=1`) to test
  the rest of the pipeline.

## Bridge: `Invalid gateway key`

* `GATEWAY_KEY` must hash to a row in
  `public.devices(ingest_key_hash)`. The key is stored only as a hash, so
  it cannot be looked up — check it with:
  `select exists(select 1 from public.devices where ingest_key_hash = encode(extensions.digest('<your key>','sha256'),'hex'));`
  If that returns false, rotate the key (see the repo README) and update `bridge/.env`.

## Bridge: `invalid packet (schema)`

* The line is JSON but missing required fields. The payload must include a
  `device_id`. Check the gateway output against `packet-format.md`.

## Supabase: the reading is filed against the gateway, not the tag

* The relayed `payload` had no `device_id`, so `ingest` treated the line as the
  gateway reporting itself. Fix the tag firmware payload.

## Dashboard: "No tags yet"

* Run the bridge (real or mock) to push a packet, or run `supabase/seed.sql`.
* Confirm `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set in
  `dashboard/.env`.
* Check the browser console for RLS or network errors.

## WSL2: no serial port appears

WSL2 has no USB passthrough by default. `/dev/ttyS*` entries are inert stubs, not
your board. Install [usbipd-win](https://github.com/dorssel/usbipd-win), then in
an **admin** PowerShell:

```bash
usbipd list
```

```bash
usbipd bind --busid 1-3
```

Then attach (this one does **not** need admin, but must be repeated after every
reboot or replug):

```bash
usbipd attach --wsl --busid 1-3
```

`bind` persists; `attach` does not. Add `--auto-attach` to survive a device
re-enumeration mid-flash.

**The nRF52 needs binding twice.** It changes USB identity between application
(`239a:8029`) and bootloader (`239a:002a`) mode, and `bind` is per identity. Bind
each once and both halves of the DFU cycle work from then on.

## T-Echo: DFU never triggers

The 1200-baud touch is unreliable over USB/IP. A **double-click of reset** enters
the bootloader manually and waits indefinitely, unlike the touch-entered one
which times out. Then flash with `-e techo-dfu` (touch disabled).

## Bridge: crashes on start

```
panic(main thread): unsupported uv function: uv_default_loop
```

Bun cannot load the `serialport` native module. Use Node for real hardware. Mock
mode works under either because it reads stdin.

## Nothing reaches Supabase

* Is the bridge actually running? It is not a service.
* `Invalid ingest key` → `GATEWAY_KEY` no longer hashes to a `devices` row.
  Only the hash is stored, so the key cannot be recovered —
  rotate it (see the root README).
* Readings arrive but a field is missing → check it against the zod schema in
  `bridge/src/packetSchema.ts`. Unknown keys pass through to the payload jsonb,
  but a declared field with the wrong type rejects the whole line.
* No-fix readings rejected → `lat`/`lng` need `.nullable()`, not just
  `.optional()`. Devices send an explicit `null`.

## Board is silent and will not flash

A T-Beam whose USB bridge enumerates but which emits nothing and ignores the ROM
bootloader is usually **powered off**: the CH9102 runs from USB VBUS while the
ESP32 runs from the AXP2101's DCDC1, gated by the **PWR button**. Press it.

## Gateway e-paper is blank, upside down, or frozen

* Upside down → rotation must be **3**.
* Frozen on the first image → the paged `firstPage()`/`nextPage()` cycle is what
  re-runs the controller init. Calling `display()` directly leaves it stuck after
  the first full refresh powers the panel off.
* Blank → check `Power enable` (P0.12) is HIGH.
