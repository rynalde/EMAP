-- Bluetooth Channel Sounding ranging — tags and proximity observations
-- Project: periplus (ref: lvvulorcvuxuyrnumfay)
--
-- A CS tag is a second class of tracked device. It has no GPS and never knows
-- where it is; a gateway measures the distance to it and reports that instead
-- of a position fix. So a CS tag is NOT a lora_tags row with null coordinates:
-- a distance is a different kind of observation from a position, and forcing it
-- into lat/lng would put a value in lora_tag_readings that no gateway ever
-- measured.
--
-- Deliberately separate:
--   cs_tags          identity only — no position columns, by design
--   cs_observations  the tag's equivalent of a position fix
--
-- Deliberately shared:
--   lora_gateways    a CS gateway authenticates exactly like a LoRa one. The
--                    key-hash mechanism already exists; a second one would be
--                    two things to rotate and two things to get wrong.
--
-- IMPORTANT:
--   * Does NOT touch lora_tags, lora_tag_readings or ingest_lora_packet.
--   * Does NOT touch the pre-existing public.tags table.
--   * Idempotent (safe to re-run).

create extension if not exists pgcrypto with schema extensions;

-- tag_uid is the 64-bit FICR.DEVICEID of the nRF54L15, lowercase hex. It is
-- factory-programmed, survives reflash and full erase, and is independent of
-- the BLE address (which randomises). Same philosophy as the T-Beam deriving
-- its tag_id from the efuse MAC: identical firmware on every board, no
-- provisioning step, no stored state to lose.
create table if not exists public.cs_tags (
  tag_uid text primary key,
  label text,
  board_model text not null default 'Seeed XIAO nRF54L15',
  firmware_version text,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 16 hex chars. Rejects a truncated or mangled UID at the boundary rather
  -- than silently creating a second identity for the same physical tag.
  constraint cs_tags_uid_format check (tag_uid ~ '^[0-9a-f]{16}$')
);

create table if not exists public.cs_observations (
  id bigserial primary key,
  gateway_id uuid not null references public.lora_gateways(id) on update cascade on delete cascade,
  tag_uid text not null references public.cs_tags(tag_uid) on update cascade on delete cascade,
  -- null when the ranging attempt failed. The firmware never invents a value:
  -- a fabricated distance is indistinguishable from a measured one once it is
  -- in the database. Same rule the GPS tag follows with lat/lng.
  distance_m double precision,
  quality text not null,
  rssi integer,
  observed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  -- Channel Sounding is a short-range technique; a kilometre is already far
  -- past anything physical. Guards against a garbage decode the same way the
  -- lat/lng range checks guard against a coordinate that is not on Earth.
  constraint cs_observations_distance_range
    check (distance_m is null or (distance_m >= 0 and distance_m <= 1000)),
  -- The invariant that makes a failed measurement readable: if the gateway
  -- says the attempt failed, there must be no number attached to it.
  constraint cs_observations_failed_has_no_distance
    check (quality <> 'failed' or distance_m is null)
);

create index if not exists cs_observations_tag_time_idx on public.cs_observations(tag_uid, observed_at desc);
create index if not exists cs_observations_gateway_time_idx on public.cs_observations(gateway_id, observed_at desc);
create index if not exists cs_observations_observed_at_idx on public.cs_observations(observed_at desc);

-- Reuses the existing trigger function rather than defining a second one.
drop trigger if exists cs_tags_set_updated_at on public.cs_tags;
create trigger cs_tags_set_updated_at
before update on public.cs_tags
for each row execute function public.lora_set_updated_at();

-- Latest distance per tag. Mirrors lora_latest_tag_positions in shape and in
-- the security_invoker setting, which makes the view enforce the *querying*
-- role's RLS instead of the creator's.
create or replace view public.cs_latest_tag_distances
with (security_invoker = on) as
select distinct on (o.tag_uid)
  o.tag_uid,
  t.label as tag_label,
  o.gateway_id,
  g.label as gateway_label,
  o.observed_at,
  o.distance_m,
  o.quality,
  o.rssi,
  o.payload
from public.cs_observations o
join public.cs_tags t on t.tag_uid = o.tag_uid
left join public.lora_gateways g on g.id = o.gateway_id
-- id desc breaks the tie on observed_at. now() is the *transaction* timestamp,
-- so two observations written in one transaction carry the identical value and
-- "latest" would otherwise be whichever row the plan happened to reach first.
order by o.tag_uid, o.observed_at desc, o.id desc;

-- Derived position, as a VIEW and never as stored rows.
--
-- A tag has no position of its own. What is actually known is "somewhere on a
-- circle of radius distance_m around the gateway" — so that is what this
-- exposes: an origin and a radius, not a lat/lng pretending to be a fix.
-- Writing this into lora_tag_readings would make a computed guess
-- indistinguishable from a measured coordinate.
--
-- With one gateway this is the best available answer. Multilateration from
-- three or more gateways would replace it, and would still belong in a view.
create or replace view public.cs_tag_derived_positions
with (security_invoker = on) as
select
  d.tag_uid,
  d.tag_label,
  d.gateway_id,
  d.gateway_label,
  d.observed_at,
  d.distance_m,
  d.quality,
  g.last_lat as origin_lat,
  g.last_lng as origin_lng,
  d.distance_m as radius_m
from public.cs_latest_tag_distances d
join public.lora_gateways g on g.id = d.gateway_id;

-- Ingest one ranging observation.
--
-- Separate RPC from ingest_lora_packet, not a branch inside it: that function
-- requires a tag_id and unconditionally inserts a lora_tag_readings row, so a
-- ranging result routed through it would become a position reading.
create or replace function public.ingest_cs_ranging(
  p_gateway_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_gateway_id uuid;
  v_tag_uid text;
  v_distance_m double precision;
  v_quality text;
  v_rssi integer;
  v_observation_id bigint;
begin
  -- The bridge still sends the plaintext key; it is hashed here for comparison,
  -- so the secret is never stored. Identical to ingest_lora_packet.
  select id into v_gateway_id
  from public.lora_gateways
  where gateway_key_hash = encode(extensions.digest(p_gateway_key, 'sha256'), 'hex');

  if v_gateway_id is null then
    raise exception 'Invalid gateway key' using errcode = '28000';
  end if;

  v_tag_uid := lower(nullif(p_payload->>'tag_uid', ''));

  if v_tag_uid is null then
    raise exception 'Missing tag_uid in payload' using errcode = '22023';
  end if;

  -- Kept as a plain string rather than an enum so a future firmware quality
  -- value cannot make the bridge drop otherwise-valid observations. Same
  -- reasoning as the tag's `status` field. Defaults to 'unknown' rather than
  -- to 'ok' — an unlabelled measurement is not a good one.
  v_quality := coalesce(nullif(p_payload->>'quality', ''), 'unknown');
  v_distance_m := nullif(p_payload->>'distance_m', '')::double precision;
  v_rssi := nullif(p_payload->>'rssi', '')::integer;

  -- A failed attempt carries no distance even if the firmware sent one. This
  -- normalises rather than raising, so one malformed line cannot stall a
  -- gateway that is otherwise reporting correctly.
  if v_quality = 'failed' then
    v_distance_m := null;
  end if;

  update public.lora_gateways
  set last_seen_at = now(),
      firmware_version = coalesce(p_payload->>'gateway_fw', firmware_version),
      metadata = metadata || jsonb_build_object('last_ranging_at', now())
  where id = v_gateway_id;

  insert into public.cs_tags(tag_uid, label, firmware_version, last_seen_at, metadata)
  values (
    v_tag_uid,
    coalesce(p_payload->>'tag_label', v_tag_uid),
    p_payload->>'fw',
    now(),
    jsonb_build_object('first_seen_payload', p_payload)
  )
  on conflict (tag_uid) do update
  set last_seen_at = excluded.last_seen_at,
      firmware_version = coalesce(excluded.firmware_version, public.cs_tags.firmware_version),
      updated_at = now();

  insert into public.cs_observations(gateway_id, tag_uid, distance_m, quality, rssi, payload)
  values (v_gateway_id, v_tag_uid, v_distance_m, v_quality, v_rssi, p_payload)
  returning id into v_observation_id;

  return jsonb_build_object(
    'ok', true,
    'observation_id', v_observation_id,
    'tag_uid', v_tag_uid,
    'gateway_id', v_gateway_id,
    'observed_at', now()
  );
end;
$function$;

-- Same exposure as ingest_lora_packet: the bridge authenticates with the anon
-- key while holding the gateway key. Nothing signed-in calls this.
revoke all on function public.ingest_cs_ranging(text, jsonb) from public;
revoke execute on function public.ingest_cs_ranging(text, jsonb) from authenticated;
grant execute on function public.ingest_cs_ranging(text, jsonb) to anon, service_role;

alter table public.cs_tags enable row level security;
alter table public.cs_observations enable row level security;

drop policy if exists "mvp_read_cs_tags" on public.cs_tags;
create policy "mvp_read_cs_tags" on public.cs_tags for select to anon, authenticated using (true);

drop policy if exists "mvp_read_cs_observations" on public.cs_observations;
create policy "mvp_read_cs_observations" on public.cs_observations for select to anon, authenticated using (true);

-- Bootstrap the Channel Sounding gateway with a RANDOM key, only when one does
-- not already exist. Same rules as the LoRa gateway: never plant a predictable
-- key, never clobber a rotated one.
--
-- ORDERING NOTE: the base migration seeds the T-Echo gateway under a broader
-- guard — `where not exists (select 1 from public.lora_gateways)` — meaning it
-- creates that row only while the table is *entirely* empty. Run in timestamp
-- order on a fresh database that is fine: the T-Echo row is created first, then
-- this one. But applying this migration to a database whose lora_gateways is
-- still empty permanently blocks the T-Echo seed, because the table is no
-- longer empty afterwards. If that has happened, insert the T-Echo row by hand
-- rather than re-running the base migration and expecting it to appear.
--
-- The guard below is label-scoped precisely so this migration does not have the
-- same failure mode.
--
-- It is a separate lora_gateways row from the T-Echo because it is a separate
-- physical device — one row for two boards would attribute the T-Echo's
-- position to the XIAO, which is exactly the kind of invented coordinate the
-- rest of this schema goes out of its way to avoid.
--
-- The plaintext key is printed ONCE, here, and then exists nowhere but your
-- bridge .env. If you lose it, rotate rather than trying to recover it.
with new_key as (
  select encode(extensions.gen_random_bytes(24), 'hex') as k
), inserted as (
  insert into public.lora_gateways(gateway_key_hash, label, board_model, firmware_version, metadata)
  select
    encode(extensions.digest(k, 'sha256'), 'hex'),
    'dev-cs-gateway-001',
    'Seeed XIAO nRF54L15',
    'cs-0.1.0',
    jsonb_build_object('purpose', 'Bluetooth Channel Sounding ranging gateway')
  from new_key
  where not exists (
    select 1 from public.lora_gateways where label = 'dev-cs-gateway-001'
  )
  returning id
)
select k as copy_this_into_bridge_env_CS_GATEWAY_KEY
from new_key
where exists (select 1 from inserted);
