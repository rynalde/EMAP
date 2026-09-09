-- LoRa GPS Tracker MVP — isolated schema
-- Project: periplus (ref: lvvulorcvuxuyrnumfay)
--
-- IMPORTANT:
--   * Do NOT use or modify the existing public.tags table.
--   * All MVP objects are prefixed with lora_ to stay isolated.
--   * This migration is idempotent (safe to re-run).

create extension if not exists pgcrypto with schema extensions;

-- Only a SHA-256 hash of the gateway key is stored — never the key itself.
-- Same convention as public.tags.device_secret_hash. The key is 24 random bytes
-- (192 bits), so a fast hash is right; this is not a low-entropy password that
-- would need bcrypt/argon2 stretching.
create table if not exists public.lora_gateways (
  id uuid primary key default gen_random_uuid(),
  gateway_key_hash text not null,
  label text not null,
  board_model text not null default 'LILYGO T-Echo SX1262',
  firmware_version text,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upgrade path for databases created back when the key was stored in plaintext.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lora_gateways'
      and column_name = 'gateway_key'
  ) then
    alter table public.lora_gateways add column if not exists gateway_key_hash text;

    update public.lora_gateways
    set gateway_key_hash = encode(extensions.digest(gateway_key, 'sha256'), 'hex')
    where gateway_key_hash is null;

    alter table public.lora_gateways alter column gateway_key_hash set not null;
    alter table public.lora_gateways drop column gateway_key;
  end if;
end
$$;

create unique index if not exists lora_gateways_key_hash_key
  on public.lora_gateways(gateway_key_hash);

create table if not exists public.lora_tags (
  tag_id text primary key,
  label text,
  board_model text not null default 'LILYGO T-Beam ESP32 LoRa GPS',
  firmware_version text,
  last_seen_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_battery_mv integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lora_tags_lat_range check (last_lat is null or (last_lat between -90 and 90)),
  constraint lora_tags_lng_range check (last_lng is null or (last_lng between -180 and 180))
);

create table if not exists public.lora_tag_readings (
  id bigserial primary key,
  tag_id text not null references public.lora_tags(tag_id) on update cascade on delete cascade,
  gateway_id uuid references public.lora_gateways(id) on update cascade on delete set null,
  seq integer,
  gps_time timestamptz,
  received_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  hdop numeric,
  sats integer,
  battery_mv integer,
  rssi integer,
  snr numeric,
  raw_payload text,
  payload jsonb not null default '{}'::jsonb,
  constraint lora_tag_readings_lat_range check (lat is null or (lat between -90 and 90)),
  constraint lora_tag_readings_lng_range check (lng is null or (lng between -180 and 180))
);

create index if not exists lora_tag_readings_tag_time_idx on public.lora_tag_readings(tag_id, received_at desc);
create index if not exists lora_tag_readings_gateway_time_idx on public.lora_tag_readings(gateway_id, received_at desc);
create index if not exists lora_tag_readings_received_at_idx on public.lora_tag_readings(received_at desc);

-- search_path is pinned so a role-local search_path cannot redirect the names
-- resolved inside the function. Only now() is used, and it lives in pg_catalog.
create or replace function public.lora_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lora_gateways_set_updated_at on public.lora_gateways;
create trigger lora_gateways_set_updated_at
before update on public.lora_gateways
for each row execute function public.lora_set_updated_at();

drop trigger if exists lora_tags_set_updated_at on public.lora_tags;
create trigger lora_tags_set_updated_at
before update on public.lora_tags
for each row execute function public.lora_set_updated_at();

-- security_invoker makes the view enforce the *querying* role's RLS policies.
-- Without it the view runs with the creator's rights and silently bypasses them.
create or replace view public.lora_latest_tag_positions
with (security_invoker = on) as
select distinct on (tr.tag_id)
  tr.tag_id,
  t.label as tag_label,
  tr.gateway_id,
  g.label as gateway_label,
  tr.received_at,
  tr.gps_time,
  tr.lat,
  tr.lng,
  tr.hdop,
  tr.sats,
  tr.battery_mv,
  tr.rssi,
  tr.snr,
  tr.seq,
  tr.payload
from public.lora_tag_readings tr
join public.lora_tags t on t.tag_id = tr.tag_id
left join public.lora_gateways g on g.id = tr.gateway_id
order by tr.tag_id, tr.received_at desc;

create or replace function public.ingest_lora_packet(
  p_gateway_key text,
  p_payload jsonb,
  p_raw_payload text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_gateway_id uuid;
  v_tag_id text;
  v_seq integer;
  v_lat double precision;
  v_lng double precision;
  v_hdop numeric;
  v_sats integer;
  v_battery_mv integer;
  v_rssi integer;
  v_snr numeric;
  v_gps_time timestamptz;
  v_reading_id bigint;
begin
  -- The bridge still sends the plaintext key; it is hashed here for comparison,
  -- so no client change is needed and the secret is never stored.
  select id into v_gateway_id
  from public.lora_gateways
  where gateway_key_hash = encode(extensions.digest(p_gateway_key, 'sha256'), 'hex');

  if v_gateway_id is null then
    raise exception 'Invalid gateway key' using errcode = '28000';
  end if;

  v_tag_id := coalesce(nullif(p_payload->>'tag_id', ''), nullif(p_payload->>'id', ''));

  if v_tag_id is null then
    raise exception 'Missing tag_id in payload' using errcode = '22023';
  end if;

  v_seq := nullif(p_payload->>'seq', '')::integer;
  v_lat := nullif(p_payload->>'lat', '')::double precision;
  v_lng := nullif(p_payload->>'lng', '')::double precision;
  v_hdop := nullif(p_payload->>'hdop', '')::numeric;
  v_sats := nullif(p_payload->>'sats', '')::integer;
  v_battery_mv := coalesce(nullif(p_payload->>'battery_mv', '')::integer, nullif(p_payload->>'bat_mv', '')::integer);
  v_rssi := nullif(p_payload->>'rssi', '')::integer;
  v_snr := nullif(p_payload->>'snr', '')::numeric;
  v_gps_time := nullif(p_payload->>'gps_time', '')::timestamptz;

  update public.lora_gateways
  set last_seen_at = now(),
      firmware_version = coalesce(p_payload->>'gateway_fw', firmware_version),
      metadata = metadata || jsonb_build_object('last_payload_at', now())
  where id = v_gateway_id;

  insert into public.lora_tags(tag_id, label, firmware_version, last_seen_at, last_lat, last_lng, last_battery_mv, metadata)
  values (
    v_tag_id,
    coalesce(p_payload->>'tag_label', v_tag_id),
    p_payload->>'fw',
    now(),
    v_lat,
    v_lng,
    v_battery_mv,
    jsonb_build_object('first_seen_payload', p_payload)
  )
  on conflict (tag_id) do update
  set last_seen_at = excluded.last_seen_at,
      last_lat = coalesce(excluded.last_lat, public.lora_tags.last_lat),
      last_lng = coalesce(excluded.last_lng, public.lora_tags.last_lng),
      last_battery_mv = coalesce(excluded.last_battery_mv, public.lora_tags.last_battery_mv),
      firmware_version = coalesce(excluded.firmware_version, public.lora_tags.firmware_version),
      updated_at = now();

  insert into public.lora_tag_readings(tag_id, gateway_id, seq, gps_time, lat, lng, hdop, sats, battery_mv, rssi, snr, raw_payload, payload)
  values (v_tag_id, v_gateway_id, v_seq, v_gps_time, v_lat, v_lng, v_hdop, v_sats, v_battery_mv, v_rssi, v_snr, p_raw_payload, p_payload)
  returning id into v_reading_id;

  return jsonb_build_object(
    'ok', true,
    'reading_id', v_reading_id,
    'tag_id', v_tag_id,
    'gateway_id', v_gateway_id,
    'received_at', now()
  );
end;
$$;

-- The bridge authenticates with the anon key, so anon needs EXECUTE. Nothing
-- signed-in calls this RPC, so `authenticated` is deliberately not granted.
revoke all on function public.ingest_lora_packet(text, jsonb, text) from public;
revoke execute on function public.ingest_lora_packet(text, jsonb, text) from authenticated;
grant execute on function public.ingest_lora_packet(text, jsonb, text) to anon, service_role;

alter table public.lora_gateways enable row level security;
alter table public.lora_tags enable row level security;
alter table public.lora_tag_readings enable row level security;

drop policy if exists "mvp_read_lora_gateways" on public.lora_gateways;
create policy "mvp_read_lora_gateways" on public.lora_gateways for select to anon, authenticated using (true);

drop policy if exists "mvp_read_lora_tags" on public.lora_tags;
create policy "mvp_read_lora_tags" on public.lora_tags for select to anon, authenticated using (true);

drop policy if exists "mvp_read_lora_tag_readings" on public.lora_tag_readings;
create policy "mvp_read_lora_tag_readings" on public.lora_tag_readings for select to anon, authenticated using (true);

-- gateway_key_hash must never be readable through the API. RLS is row-level
-- only, so the read policy above would otherwise expose every column to anon,
-- whose key ships in the dashboard bundle. Column-level GRANTs omit it while
-- leaving the rest readable. (id + label are what
-- lora_latest_tag_positions joins on.)
--
-- This is defence in depth: the column holds a hash, not the key, so leaking it
-- would not by itself let anyone call ingest_lora_packet — but there is no
-- reason to publish it either.
revoke select on public.lora_gateways from anon, authenticated;
grant select (
  id, label, board_model, firmware_version, last_seen_at, metadata, created_at, updated_at
) on public.lora_gateways to anon, authenticated;

-- Bootstrap a dev gateway with a RANDOM key, only when no gateway exists yet.
--
-- This used to seed a hardcoded 'dev-gateway-key-change-me'. That is a shared
-- secret committed to a public repo: combined with the anon key (which is
-- public by design) it let anyone call ingest_lora_packet and write readings.
-- Re-running the migration must never plant a known key, and must never
-- clobber a rotated one — hence the `where not exists` guard.
--
-- The plaintext key is printed ONCE by this statement and then exists nowhere
-- but bridge/.env. If you lose it, rotate rather than trying to recover it.
with new_key as (
  select encode(extensions.gen_random_bytes(24), 'hex') as k
), inserted as (
  insert into public.lora_gateways(gateway_key_hash, label, board_model, firmware_version, metadata)
  select
    encode(extensions.digest(k, 'sha256'), 'hex'),
    'dev-t-echo-gateway-001',
    'LILYGO T-Echo SX1262',
    'mvp-0.1.0',
    jsonb_build_object('purpose', 'local USB serial LoRa receiver MVP')
  from new_key
  where not exists (select 1 from public.lora_gateways)
  returning id
)
select k as copy_this_into_bridge_env_LORA_GATEWAY_KEY
from new_key
where exists (select 1 from inserted);
