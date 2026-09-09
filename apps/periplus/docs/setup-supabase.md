# Supabase setup

```
Project ref:  lvvulorcvuxuyrnumfay
Project name: periplus
Region:       sa-east-1
```

> ⚠️ Use this existing project only. Do **not** create a new project, and do
> **not** modify the existing `public.tags` table.

## 1. Apply the migrations

Open the Supabase SQL editor and run, in order:

1. `supabase/migrations/20260602154012_create_lora_mvp_schema.sql`
2. `supabase/migrations/20260803190000_add_gateway_position.sql`
3. `supabase/migrations/20260803193000_add_gateway_status_rpc.sql`
4. `supabase/migrations/20260804120000_create_cs_ranging_schema.sql`
5. `supabase/migrations/20260908120000_unify_device_schema.sql`

On a **fresh** database you can skip straight to (5): it creates everything and
its backfill blocks are guarded on tables that will not exist. On a database
that already carries bring-up data, run them in order — (5) copies the old rows
across before dropping the old tables.

> `supabase db push` does **not** work on this project — it is shared with a
> second application whose migrations live in another repo, so `db push` aborts
> with `LegacyDbPushMissingLocalError`. Do not apply its suggested fixes
> (`migration repair --status reverted` falsifies real history; `db pull` would
> import the other app's schema here). See `supabase/README.md`.
>
> `supabase link --project-ref lvvulorcvuxuyrnumfay` and
> `supabase migration list` both work fine for inspection.

Every migration is idempotent (safe to re-run). After (5) the schema is:

* `public.devices` — every tag and every gateway
* `public.readings` — one row per observation
* `public.latest_positions` (view) — what the clients read
* `public.ingest(text, jsonb)` (RPC) — the only write path
* `public.register_device(text, text, text, text, text)` — issues ingest keys

RLS is on and read-only for `anon`/`authenticated`. `devices.ingest_key_hash` is
excluded by a column grant, so it is never readable through the API.

Migration (5) drops `lora_gateways`, `lora_tags`, `lora_tag_readings`,
`cs_tags`, `cs_observations`, their views and their three ingest functions.
Ingest keys already in the field are carried over, so gateways keep working.

## 2. Register the devices that write

Only devices that talk to the API need a key: **gateways** and **cellular
tags**. LoRa and Channel Sounding tags get their rows created automatically on
the first reading their gateway relays.

```sql
select public.register_device(
  'GW001', 'gateway', 'lora', 'LILYGO T-Echo SX1262', 'techo-lora-gateway'
);
```

The key is printed **once**. Copy it into `bridge/.env` as `GATEWAY_KEY` right
then (never commit it). Only a SHA-256 hash is stored, so it cannot be read back
— re-run `register_device` with the same `device_id` to rotate it.

For a cellular board, use the IMEI it prints at boot:

```sql
select public.register_device(
  '869951039335207', 'tag', 'cellular', 'LILYGO T-SIM7000G', 'truck-01'
);
```

`register_device` is granted to `service_role` only, so it works from the SQL
editor and is unreachable from any client.

## 3. Get the anon key

Supabase Dashboard → Project Settings → API → Project API keys → **anon public**.
Put it in `bridge/.env` (`SUPABASE_ANON_KEY`), `dashboard/.env`
(`VITE_SUPABASE_ANON_KEY`), `web/.env.local` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
and each cellular board's `config.h` (`SUPABASE_ANON_KEY`).

## 4. Validate with a test reading

In the SQL editor:

```sql
select public.ingest(
  '<the key register_device printed>',
  '{
    "device_id": "AABBCCDDEEFF",
    "seq": 1,
    "status": "fix",
    "lat": 38.7223,
    "lng": -9.1393,
    "battery_mv": 4100,
    "sats": 7,
    "hdop": 1.2,
    "rssi": -82,
    "snr": 7.5,
    "fw": "mvp-0.2.0"
  }'::jsonb
);
```

Then:

```sql
select device_id, kind, link, status, lat, lng, battery_mv, recorded_at
from public.latest_positions
where device_id = 'AABBCCDDEEFF';
```

Expected: one `AABBCCDDEEFF` row, `link` inherited from the gateway whose key
you used, and `reported_by` naming that gateway.

`supabase/seed.sql` runs exactly this.

## Security notes (MVP)

* An ingest key is shared-secret, MVP-level auth — not production auth. Only its
  SHA-256 hash (`devices.ingest_key_hash`) is stored.
* Writes only happen via the `security definer` `ingest` function.
* A cellular tag holds its key in firmware, so a stolen board is a leaked key.
  Rotate that device rather than every device.
* Rotate the dev keys before any real deployment.
