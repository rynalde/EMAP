# Testing checklist

Work top to bottom. Each box should pass before moving on.

## Hardware safety

- [ ] Antenna connected before powering any board that transmits.
- [ ] Frequency on each shield can matches `LORA_FREQUENCY` (923.0 here).

## Boards

- [ ] T-Beam revision confirmed (`TBeam-AXP2101-V1.2` on the silkscreen).
- [ ] T-Echo LoRa module band matches the tags.

## Tag bring-up — run the self-test first

```bash
pio run -d firmware/tbeam-selftest -t upload --upload-port /dev/ttyACM0
```

- [ ] `[RESULT] i2c=2 pmu=ok oled=ok gnss=ok lora=ok`
- [ ] PMU reports DCDC1 / ALDO2 / ALDO3 all on at 3300 mV.
- [ ] `[GNSS] receiving NMEA (N bytes in 3 s)` with N > 0.
- [ ] `[GNSS] TX pin 12 confirmed` — proves the only pin plain reception cannot.

Never transmits, so this is safe without an antenna.

## Tag firmware

- [ ] Compiles and uploads.
- [ ] `[BOOT] fw=... tag_id=... (from efuse MAC)` — a unique 12-hex id. It goes
      over the air as `device_id`.
- [ ] Two tags flashed with the **same image** report **different** ids.
- [ ] `[LORA] packet sent seq=... airtime=234ms` roughly every 3 s.
- [ ] `status=` is one of `fix` / `stale` / `acquiring` / `no_gps` — never a
      fabricated coordinate.
- [ ] OLED shows the same status the payload carries.

## Gateway firmware

- [ ] Compiles and uploads (DFU).
- [ ] `[CFG]` block dumps radio settings; they match the tag exactly.
- [ ] `[LORA] init SX1262 ... ok` — this also confirms the TCXO voltage.
- [ ] `[EPD] GDEH0154D67 initialised on NRF_SPIM2`.
- [ ] E-paper is **right side up** and the uptime figure changes between
      refreshes.
- [ ] `[STAT] up=...` heartbeat every 5 s, so a silent gateway is
      distinguishable from a crashed one.
- [ ] JSON lines start with `{`; debug lines start with `[`.

## Multi-tag

- [ ] Both tags' `device_id`s appear at the gateway.
- [ ] Sent count equals received count over a minute or more.
- [ ] `crcErr` stays at 0. A rising count means signal is arriving but a
      parameter differs.
- [ ] `next=+NNNNms` differs between tags — jitter is decorrelating them.

## Bridge

Run under **Node**, not Bun — Bun cannot load `serialport`.

```bash
cd bridge && node --experimental-strip-types --env-file=.env src/index.ts
```

- [ ] `[BRIDGE] connected serial ... @ 115200 baud`
- [ ] `[BRIDGE] packet received tag=... seq=...`
- [ ] `[SUPABASE] inserted reading_id=...`
- [ ] `[BRIDGE] gateway status=...` → `[SUPABASE] gateway status updated`
- [ ] Stop every tag. Gateway status **still** updates — this is the case that
      used to send nothing at all.

## Supabase

- [ ] `readings` gains a row per packet.
- [ ] A no-fix reading stores `lat`/`lng`/`hdop` as **NULL**, not `0` or `99.99`.
- [ ] `payload->>'status'` is populated (zod strips undeclared keys, so a missing
      value here means a schema regression).
- [ ] The gateway's own `devices.last_seen_at` advances every ~15 s.
- [ ] A device losing its fix does **not** blank its stored last position.

## Map / dashboard

- [ ] `web/` centres on the gateway when it has a position.
- [ ] Tags **without** a position appear in the sidebar, not only on the map — a
      tag with no fix must not look like an offline one.
- [ ] Marker colours track status: green fix, amber stale, grey acquiring, red
      no_gps.

## Software-only smoke test (no hardware)

Validates the backend and bridge without boards. Mock mode reads stdin, so it
runs under Bun or Node.

```bash
cd bridge
echo '{"device_id":"GW001","fw":"mvp-0.2.0","received_at_ms":123,"rssi":-82,"snr":7.5,"payload":{"device_id":"AABBCCDDEEFF","seq":2,"status":"acquiring","lat":null,"lng":null,"battery_mv":3700,"sats":0,"hdop":null,"fw":"mvp-0.2.0"}}' \
  | MOCK_SERIAL=1 bun run src/index.ts
```

Expect `[SUPABASE] inserted reading_id=...`. This payload deliberately uses
`null` position and `status` — the two things a schema regression would reject or
silently drop.
