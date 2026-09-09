-- Unified device schema — one model for every tracking link
-- Project: periplus (ref: lvvulorcvuxuyrnumfay)
--
-- WHY THIS REPLACES THE lora_* / cs_* TABLES
--
-- The backend grew one table set per radio: lora_gateways + lora_tags +
-- lora_tag_readings for LoRa, cs_tags + cs_observations for Bluetooth Channel
-- Sounding. Adding cellular trackers (LILYGO T-SIM7000G, which reaches Supabase
-- directly over LTE with no gateway at all) would have meant a third set, a
-- third ingest RPC and a third pair of views — three places to change for every
-- future field.
--
-- What the three actually have in common is the whole model: a device reports
-- an observation about itself or about another device. The link it used is an
-- attribute, not a schema. So:
--
--   devices   every tag AND every gateway, one row each
--   readings  one row per observation, whatever carried it
--
-- WHAT IS DELIBERATELY PRESERVED
--
--   * Never fabricate. lat/lng and distance_m stay nullable and are only ever
--     written from something a device actually measured. A derived position is
--     a VIEW (latest_positions.origin_*/radius_m), never a stored row.
--   * A distance is not a position. A Channel Sounding reading has distance_m
--     and null lat/lng — the two never get confused because they are different
--     columns, not because they are different tables.
--   * Ingest keys are stored only as a SHA-256 hash and never readable via the
--     API (column grant, not table grant).
--
-- Idempotent (safe to re-run). Backfills from the old tables when they exist,
-- then drops them.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
-- device_id is whatever silicon already guarantees to be unique on that board,
-- so every board runs an identical firmware image with no provisioning step:
--   lora     ESP32 efuse MAC, 12 hex chars
--   ble_cs   nRF54L15 FICR.DEVICEID, 16 hex chars
--   cellular the modem IMEI, 15 digits
--
-- kind is what the device IS, link is how it talks. A gateway and the tags it
-- hears share a link; a device that reports itself (cellular) is its own
-- reporter. Both are plain text with a check rather than enums: adding a link
-- must not require an ALTER TYPE on a live database.
create table if not exists public.devices (
  device_id text primary key,
  kind text not null default 'tag' check (kind in ('tag', 'gateway')),
  link text not null check (link in ('lora', 'ble_cs', 'cellular')),
  label text,
  board_model text,
  firmware_version text,
  -- Set only on devices that write to the API: gateways, and cellular tags that
  -- have no gateway. A LoRa or CS tag never holds a key — the gateway that
  -- hears it authenticates on its behalf.
  ingest_key_hash text unique,
  last_seen_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_battery_mv integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_lat_range check (last_lat is null or (last_lat between -90 and 90)),
  constraint devices_lng_range check (last_lng is null or (last_lng between -180 and 180))
);

-- ---------------------------------------------------------------------------
-- readings
-- ---------------------------------------------------------------------------
-- One row per observation. reported_by is the device that produced it:
--   null                a self-report (cellular tag, or a gateway's heartbeat)
--   another device_id   relayed (a gateway heard a tag)
--
-- status is the device's own account of the measurement and is never inferred
-- here: fix | stale | acquiring | no_gps for a position, ok | poor | failed for
-- a ranging attempt. Plain text, so firmware may add a value without the
-- backend dropping otherwise-valid readings.
create table if not exists public.readings (
  id bigserial primary key,
  device_id text not null references public.devices(device_id) on update cascade on delete cascade,
  reported_by text references public.devices(device_id) on update cascade on delete set null,
  recorded_at timestamptz not null default now(),
  device_time timestamptz,
  seq integer,
  status text not null default 'unknown',
  lat double precision,
  lng double precision,
  hdop numeric,
  sats integer,
  -- Channel Sounding measures a distance from the reporting device, not a
  -- point. Its own column so it can never be read as a coordinate.
  distance_m double precision,
  battery_mv integer,
  rssi integer,
  snr numeric,
  payload jsonb not null default '{}'::jsonb,
  constraint readings_lat_range check (lat is null or (lat between -90 and 90)),
  constraint readings_lng_range check (lng is null or (lng between -180 and 180)),
  -- A kilometre is already far past anything Channel Sounding can measure.
  constraint readings_distance_range
    check (distance_m is null or (distance_m >= 0 and distance_m <= 1000)),
  -- The invariant that keeps a failed measurement readable: if the device says
  -- the attempt failed, no number is attached to it.
  constraint readings_failed_has_no_measurement
    check (status <> 'failed' or (distance_m is null and lat is null and lng is null))
);

-- A Channel Sounding UID is a fixed-width hex string, so a truncated or mangled
-- one can be caught at the boundary instead of silently becoming a second
-- identity for the same physical tag — the guard the old cs_tags table carried.
--
-- Scoped to CS *tags*: a CS gateway's id is configured, not derived from
-- silicon (CSGW01), and efuse MACs and IMEIs vary in width across board
-- revisions and carriers. Added by ALTER so re-running the migration applies it
-- to a table that already exists.
alter table public.devices
  drop constraint if exists devices_ble_cs_uid_format;
alter table public.devices
  add constraint devices_ble_cs_uid_format
  check (kind <> 'tag' or link <> 'ble_cs' or device_id ~ '^[0-9a-f]{16}$');

create index if not exists readings_device_time_idx on public.readings(device_id, recorded_at desc);
create index if not exists readings_reporter_time_idx on public.readings(reported_by, recorded_at desc);
create index if not exists readings_recorded_at_idx on public.readings(recorded_at desc);

-- search_path is pinned so a role-local search_path cannot redirect the names
-- resolved inside the function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at
before update on public.devices
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- latest_positions — the one view every client reads
-- ---------------------------------------------------------------------------
-- Replaces lora_latest_tag_positions, cs_latest_tag_distances and
-- cs_tag_derived_positions. Gateways appear here too (their heartbeat is a
-- reading like any other), so the map takes its anchor from the same query
-- instead of a second one against a gateway table.
--
-- origin_* / radius_m is the Channel Sounding derived position: what is
-- actually known about a ranged tag is "somewhere on a circle of radius
-- distance_m around the reporting device". Computed here and never stored — a
-- guess written into lat/lng would be indistinguishable from a measured fix.
--
-- security_invoker makes the view enforce the *querying* role's RLS instead of
-- the creator's.
create or replace view public.latest_positions
with (security_invoker = on) as
select distinct on (r.device_id)
  r.device_id,
  d.label,
  d.kind,
  d.link,
  d.board_model,
  d.firmware_version,
  r.recorded_at,
  r.device_time,
  r.seq,
  r.status,
  r.lat,
  r.lng,
  r.hdop,
  r.sats,
  r.distance_m,
  r.battery_mv,
  r.rssi,
  r.snr,
  r.reported_by,
  rep.label as reported_by_label,
  rep.last_lat as origin_lat,
  rep.last_lng as origin_lng,
  case when r.lat is null then r.distance_m end as radius_m,
  r.payload
from public.readings r
join public.devices d on d.device_id = r.device_id
left join public.devices rep on rep.device_id = r.reported_by
-- id desc breaks the tie on recorded_at: now() is the *transaction* timestamp,
-- so two readings written in one transaction carry the identical value and
-- "latest" would otherwise be whichever row the plan happened to reach first.
order by r.device_id, r.recorded_at desc, r.id desc;

-- ---------------------------------------------------------------------------
-- ingest — the one write path
-- ---------------------------------------------------------------------------
-- Replaces ingest_lora_packet, ingest_lora_gateway_status and ingest_cs_ranging.
-- The three differed only in which columns they read; the routing they encoded
-- falls out of the payload instead:
--
--   device_id absent or equal to the key's device  -> a self-report
--   device_id naming another device                -> relayed, reported_by = key's device
--
-- so a gateway heartbeat, a relayed LoRa fix, a ranging result and a cellular
-- tracker's own fix are all one code path.
create or replace function public.ingest(
  p_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_auth public.devices;
  v_device_id text;
  v_reported_by text;
  v_status text;
  v_lat double precision;
  v_lng double precision;
  v_distance_m double precision;
  v_battery_mv integer;
  v_reading_id bigint;
begin
  -- The device sends the plaintext key; it is hashed here for comparison, so
  -- the secret is never stored.
  select * into v_auth
  from public.devices
  where ingest_key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');

  if v_auth.device_id is null then
    raise exception 'Invalid ingest key' using errcode = '28000';
  end if;

  -- `id` and the old `tag_id`/`tag_uid` spellings are accepted so a board still
  -- running pre-unification firmware keeps reporting instead of failing silently.
  v_device_id := coalesce(
    nullif(p_payload->>'device_id', ''),
    nullif(p_payload->>'tag_id', ''),
    nullif(p_payload->>'tag_uid', ''),
    nullif(p_payload->>'id', ''),
    v_auth.device_id
  );

  v_reported_by := case when v_device_id = v_auth.device_id then null else v_auth.device_id end;

  -- Channel Sounding UIDs are hex and the firmware emits them lowercase.
  -- Normalising here means a case change in firmware cannot create a second
  -- identity for one physical tag — the rule the old ingest_cs_ranging applied.
  if v_reported_by is not null and v_auth.link = 'ble_cs' then
    v_device_id := lower(v_device_id);
  end if;

  v_status := coalesce(nullif(p_payload->>'status', ''), nullif(p_payload->>'quality', ''), 'unknown');
  v_lat := nullif(p_payload->>'lat', '')::double precision;
  v_lng := nullif(p_payload->>'lng', '')::double precision;
  v_distance_m := nullif(p_payload->>'distance_m', '')::double precision;
  v_battery_mv := coalesce(
    nullif(p_payload->>'battery_mv', '')::integer,
    nullif(p_payload->>'bat_mv', '')::integer
  );

  -- A failed attempt carries no measurement even if the firmware sent one.
  -- Normalised rather than raised, so one malformed line cannot stall a device
  -- that is otherwise reporting correctly.
  if v_status = 'failed' then
    v_distance_m := null;
    v_lat := null;
    v_lng := null;
  end if;

  -- A relayed device inherits the reporter's link (a gateway only ever hears
  -- tags on its own radio), so tag firmware spends no airtime saying so.
  insert into public.devices(
    device_id, kind, link, label, board_model, firmware_version,
    last_seen_at, last_lat, last_lng, last_battery_mv, metadata
  )
  values (
    v_device_id,
    case when v_reported_by is null then v_auth.kind else 'tag' end,
    coalesce(nullif(p_payload->>'link', ''), v_auth.link),
    coalesce(nullif(p_payload->>'label', ''), v_device_id),
    nullif(p_payload->>'board_model', ''),
    nullif(p_payload->>'fw', ''),
    now(), v_lat, v_lng, v_battery_mv,
    jsonb_build_object('first_seen_payload', p_payload)
  )
  on conflict (device_id) do update
  -- coalesce so a device that loses its fix keeps its last known position
  -- instead of blanking the map anchor on the next reading.
  set last_seen_at = excluded.last_seen_at,
      last_lat = coalesce(excluded.last_lat, public.devices.last_lat),
      last_lng = coalesce(excluded.last_lng, public.devices.last_lng),
      last_battery_mv = coalesce(excluded.last_battery_mv, public.devices.last_battery_mv),
      firmware_version = coalesce(excluded.firmware_version, public.devices.firmware_version),
      board_model = coalesce(excluded.board_model, public.devices.board_model),
      updated_at = now();

  insert into public.readings(
    device_id, reported_by, device_time, seq, status,
    lat, lng, hdop, sats, distance_m, battery_mv, rssi, snr, payload
  )
  values (
    v_device_id,
    v_reported_by,
    nullif(p_payload->>'gps_time', '')::timestamptz,
    nullif(p_payload->>'seq', '')::integer,
    v_status,
    v_lat, v_lng,
    nullif(p_payload->>'hdop', '')::numeric,
    nullif(p_payload->>'sats', '')::integer,
    v_distance_m,
    v_battery_mv,
    nullif(p_payload->>'rssi', '')::integer,
    nullif(p_payload->>'snr', '')::numeric,
    p_payload
  )
  returning id into v_reading_id;

  return jsonb_build_object(
    'ok', true,
    'reading_id', v_reading_id,
    'device_id', v_device_id,
    'reported_by', v_reported_by,
    'recorded_at', now()
  );
end;
$function$;

-- Devices authenticate with the anon key while holding their ingest key, so
-- anon needs EXECUTE. Nothing signed-in calls this.
revoke all on function public.ingest(text, jsonb) from public;
revoke execute on function public.ingest(text, jsonb) from authenticated;
grant execute on function public.ingest(text, jsonb) to anon, service_role;

-- ---------------------------------------------------------------------------
-- register_device — issue an ingest key
-- ---------------------------------------------------------------------------
-- Every gateway and every cellular tag needs its own key, so this stopped being
-- a one-off seed block and became an operation. Returns the plaintext key ONCE:
-- only the hash is stored and it cannot be read back, so copy it straight into
-- the device's config and rotate if lost.
--
-- Not granted to anon: a role that could mint keys would make the key
-- pointless. Run it from the SQL editor, which connects as postgres.
create or replace function public.register_device(
  p_device_id text,
  p_kind text,
  p_link text,
  p_board_model text default null,
  p_label text default null
)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_key text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into public.devices(device_id, kind, link, label, board_model, ingest_key_hash)
  values (
    p_device_id, p_kind, p_link,
    coalesce(p_label, p_device_id), p_board_model,
    encode(extensions.digest(v_key, 'sha256'), 'hex')
  )
  on conflict (device_id) do update
  -- Re-running rotates the key rather than failing, which is the operation you
  -- actually want when a key is lost. It is never reachable by anon.
  set ingest_key_hash = excluded.ingest_key_hash,
      kind = excluded.kind,
      link = excluded.link,
      board_model = coalesce(excluded.board_model, public.devices.board_model),
      updated_at = now();

  return v_key;
end;
$function$;

-- `revoke ... from public` is not enough on Supabase: anon and authenticated
-- hold their own EXECUTE grants from the schema's default privileges, and a
-- revoke from PUBLIC does not touch those. Without the explicit revoke below,
-- anyone holding the anon key — which ships in the dashboard bundle — could
-- mint an ingest key for any device and write readings as any gateway, which
-- is the whole thing the key is there to prevent.
revoke all on function public.register_device(text, text, text, text, text) from public;
revoke execute on function public.register_device(text, text, text, text, text) from anon, authenticated;
grant execute on function public.register_device(text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Exposure
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.readings enable row level security;

drop policy if exists "mvp_read_devices" on public.devices;
create policy "mvp_read_devices" on public.devices for select to anon, authenticated using (true);

drop policy if exists "mvp_read_readings" on public.readings;
create policy "mvp_read_readings" on public.readings for select to anon, authenticated using (true);

-- ingest_key_hash must never be readable through the API. RLS is row-level
-- only, so the policy above would otherwise expose every column to anon, whose
-- key ships in the dashboard bundle. A column GRANT omits it while leaving the
-- rest readable.
--
-- Defence in depth: the column holds a hash, not the key, so leaking it would
-- not by itself let anyone call ingest — but there is no reason to publish it.
--
-- NOTE: a new column on devices needs its own `grant select (col)` here, or the
-- clients cannot see it.
revoke select on public.devices from anon, authenticated;
grant select (
  device_id, kind, link, label, board_model, firmware_version,
  last_seen_at, last_lat, last_lng, last_battery_mv, metadata, created_at, updated_at
) on public.devices to anon, authenticated;

grant select on public.readings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill from the lora_* / cs_* tables, then drop them
-- ---------------------------------------------------------------------------
-- Guarded per table so this runs unchanged on a fresh database (where none of
-- them exist) and on the dev database (where they hold real bring-up data).
--
-- Ingest keys are carried over, so gateways already in the field keep working
-- without being re-registered.
do $$
begin
  if to_regclass('public.lora_gateways') is not null then
    insert into public.devices(
      device_id, kind, link, label, board_model, firmware_version,
      ingest_key_hash, last_seen_at, last_lat, last_lng, metadata
    )
    select
      g.id::text,
      'gateway',
      -- The CS gateway is the only non-LoRa row the old schema could hold; it
      -- shared lora_gateways because the key mechanism was already there.
      case when g.board_model ilike '%nRF54%' then 'ble_cs' else 'lora' end,
      g.label,
      g.board_model,
      g.firmware_version,
      g.gateway_key_hash,
      g.last_seen_at,
      g.last_lat,
      g.last_lng,
      g.metadata
    from public.lora_gateways g
    on conflict (device_id) do nothing;
  end if;

  if to_regclass('public.lora_tags') is not null then
    insert into public.devices(
      device_id, kind, link, label, board_model, firmware_version,
      last_seen_at, last_lat, last_lng, last_battery_mv, metadata
    )
    select t.tag_id, 'tag', 'lora', t.label, 'LILYGO T-Beam', t.firmware_version,
           t.last_seen_at, t.last_lat, t.last_lng, t.last_battery_mv, t.metadata
    from public.lora_tags t
    on conflict (device_id) do nothing;
  end if;

  if to_regclass('public.cs_tags') is not null then
    insert into public.devices(
      device_id, kind, link, label, board_model, firmware_version,
      last_seen_at, metadata
    )
    select c.tag_uid, 'tag', 'ble_cs', c.label, c.board_model, c.firmware_version,
           c.last_seen_at, c.metadata
    from public.cs_tags c
    on conflict (device_id) do nothing;
  end if;

  if to_regclass('public.lora_tag_readings') is not null then
    insert into public.readings(
      device_id, reported_by, recorded_at, device_time, seq, status,
      lat, lng, hdop, sats, battery_mv, rssi, snr, payload
    )
    select
      r.tag_id, r.gateway_id::text, r.received_at, r.gps_time, r.seq,
      -- Readings written before the status field existed carry no account of
      -- themselves; inferring "fix" from a stored coordinate is the closest
      -- honest reading, and 'unknown' is used rather than guessing otherwise.
      coalesce(nullif(r.payload->>'status', ''), case when r.lat is not null then 'fix' else 'unknown' end),
      r.lat, r.lng, r.hdop, r.sats, r.battery_mv, r.rssi, r.snr,
      case when r.raw_payload is null then r.payload
           else r.payload || jsonb_build_object('raw_payload', r.raw_payload) end
    from public.lora_tag_readings r;
  end if;

  if to_regclass('public.cs_observations') is not null then
    insert into public.readings(
      device_id, reported_by, recorded_at, status, distance_m, rssi, payload
    )
    select o.tag_uid, o.gateway_id::text, o.observed_at, o.quality, o.distance_m, o.rssi, o.payload
    from public.cs_observations o;
  end if;
end
$$;

-- Views first (they depend on the tables), then the functions they replaced,
-- then the tables. Nothing here is reachable any more: the bridge, both
-- frontends and every firmware image use `ingest` and `latest_positions`.
drop view if exists public.cs_tag_derived_positions;
drop view if exists public.cs_latest_tag_distances;
drop view if exists public.lora_latest_tag_positions;

drop function if exists public.ingest_lora_packet(text, jsonb, text);
drop function if exists public.ingest_lora_gateway_status(text, jsonb);
drop function if exists public.ingest_cs_ranging(text, jsonb);

drop table if exists public.cs_observations;
drop table if exists public.cs_tags;
drop table if exists public.lora_tag_readings;
drop table if exists public.lora_tags;
drop table if exists public.lora_gateways;

-- Dropped last: the old trigger function is only unreferenced once its tables
-- are gone. public.set_updated_at() replaces it.
drop function if exists public.lora_set_updated_at();
