# T-SIM7000G Cellular GPS Tag firmware

Standalone GPS tracker. Reads its own GNSS, builds the same reading JSON every
other device in this project sends, and POSTs it straight to Supabase over LTE
every `SEND_INTERVAL_MS`.

**No gateway.** This is what makes it different from the LoRa and Channel
Sounding tags: it reaches the network itself, so it holds an ingest key of its
own and never passes through `bridge/`.

> ⚠️ **Attach both antennas before powering on.** LTE and GNSS are separate
> connectors on this board.

> ⚠️ **Keep the LiPo connected.** The modem draws ~2 A spikes when
> transmitting. USB alone browns it out on many hubs, and the symptom is a
> board that reboots mid-POST rather than an obvious power fault.

## Board

```
LILYGO T-SIM7000G  —  ESP32-WROVER-B + SIMCom SIM7000G (LTE CAT-M / NB-IoT + GNSS)
```

The SIM7000G module carries the GNSS receiver, so there is no separate GPS chip
and no second UART: everything goes over the modem's AT interface.

Verify the pin map against your revision before flashing:

* https://github.com/Xinyuan-LilyGO/LilyGO-T-SIM7000G

See `../../docs/pinout.md` for the documented pin table.

## GNSS and cellular do not run at the same time

This is a property of the module, not a choice in this firmware. LILYGO's manual
is explicit:

> Please disconnect the network when positioning, and turn off GPS when
> connecting to the network.

So one cycle is two phases that never overlap:

```
GNSS phase      data session down -> AT+CGNSPWR=1 -> poll AT+CGNSINF -> CGNSPWR=0
network phase   attach APN -> POST the reading -> drop the session
```

Leaving the receiver powered while the modem is attached is the usual reason a
T-SIM7000G "never gets a fix" on a bench where a bare GNSS sketch locks in
seconds. It also means **re-attaching to LTE on every cycle is not optional** —
that cost is why `SEND_INTERVAL_MS` is 30 s and not 3 s.

The wait for a fix is bounded by `GNSS_FIX_TIMEOUT_MS`, so the effective report
period is `max(SEND_INTERVAL_MS, actual cycle duration)`: under open sky the
board reports every 30 s; with no sky view it settles into a slower rhythm on
its own rather than hammering the modem.

## SIM card

Needs a **data-enabled** SIM. CAT-M or NB-IoT coverage varies enormously by
country and carrier — check yours supports one of them before ordering
hardware, because a plain 2G/3G-only SIM will not attach at all with
`NETWORK_MODE 38`.

## Toolchain

1. Arduino IDE (or arduino-cli / PlatformIO).
2. Install **ESP32** board support (Boards Manager → "esp32" by Espressif).
3. Install libraries (Library Manager):
   * `TinyGSM` (Volodymyr Shymanskyy)
   * `ArduinoHttpClient` (Arduino)
4. Board: **ESP32 Dev Module**. Upload speed 921600 is fine.

## Configure

```bash
cp config.example.h config.h
```

Fill in `SUPABASE_HOST`, `SUPABASE_ANON_KEY`, `APN`, and `INGEST_KEY`.

`APN` is the only one you cannot get from the project — it comes from your
carrier.

`INGEST_KEY` does not exist until the board is registered. It does **not** need
the IMEI: the board never sends a `device_id`, so the key alone decides which
row it writes to and the id is just the label you chose. Register with any
stable name and go:

```sql
select public.register_device(
  'CELLTAG01', 'tag', 'cellular', 'LILYGO T-SIM7000G', 'truck-01'
);
```

Copy the key it prints into `config.h`. The key is shown **once** and stored
only as a hash — re-run `register_device` to rotate it rather than trying to
recover it.

To adopt the IMEI as the id later, read it from the serial log and rename the
row — readings follow, because the foreign key is `on update cascade`:

```sql
update public.devices set device_id = '869951039335207' where device_id = 'CELLTAG01';
```

Renaming keeps the key working. Re-running `register_device` under a new id
would instead create a *second* device and rotate the key.

One `config.h` per board: the key is what identifies the device, so two boards
sharing a key are one device as far as the database is concerned.

## What it sends

The same shape as every other reading — see `../../docs/packet-format.md`:

```json
{
  "seq": 12,
  "status": "fix",
  "lat": 38.722300,
  "lng": -9.139300,
  "sats": 9,
  "hdop": 1.20,
  "battery_mv": 4021,
  "csq": 18,
  "imei": "869951039335207",
  "board_model": "LILYGO T-SIM7000G",
  "fw": "cell-0.2.0"
}
```

wrapped as `{"p_key": "...", "p_payload": { ... }}` and POSTed to
`/rest/v1/rpc/ingest`.

It sends **no `device_id`**: the ingest key already identifies the board, so
the two can never disagree and create a duplicate device row.

`status` follows the same vocabulary as the LoRa tag — `fix`, `stale`,
`acquiring`, `no_gps` — and `lat`/`lng` are `null` whenever the position is
unknown. The board never invents a coordinate.

## Serial output

```
[BOOT] T-SIM7000G cellular tag starting
[BOOT] fw=cell-0.2.0
[BOOT] ANTENNA WARNING: attach BOTH the LTE and GNSS antennas.
[MODEM] init ... ok
[MODEM] SIM7000G R1529
[MODEM] imei=869951039335207  <-- this board's device_id
[GNSS] fix after 34120 ms (sats=9/12)
[GNSS] status=fix lat=-8.063169 lng=-34.871139 sats=9 hdop=1.20
[NET] waiting for network ... ok (csq=18)
[NET] attaching APN internet ... ok
[BAT] battery_mv=4021
[HTTP] 200 {"ok":true,"reading_id":41,"device_id":"CELLTAG01",...}
```

The GNSS line always comes before the network lines — that ordering *is* the
mutual exclusion. If you ever see them interleaved, the phases have been broken
apart and the fix will stop arriving.

## Known limitations

* **No offline buffer.** A reading taken out of coverage is dropped, not
  queued. Fine for live tracking, not for gap-free tracks.
* **No deep sleep.** The modem and ESP32 stay powered between readings, so
  battery life is hours, not weeks. Sleeping means re-attaching to the network
  on every wake, which costs more than it saves at a 30 s interval.
* **TLS is not certificate-verified.** The SIM7000's SSL stack accepts the
  server without checking a CA. The ingest key still authenticates *writes*, so
  this is an eavesdropping/MITM exposure, not an open write path.
