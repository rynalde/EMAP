-- Gateway position
--
-- The T-Echo gateway carries its own GNSS. Recording where the gateway is lets
-- the map centre on it, which matters because tags without a fix contribute no
-- coordinates at all — without this the map has nothing to anchor to.
--
-- Stored on lora_gateways rather than per reading: a gateway is stationary
-- relative to the tags it hears, so only the latest position is interesting.

alter table public.lora_gateways
  add column if not exists last_lat double precision,
  add column if not exists last_lng double precision,
  add column if not exists last_gps_status text,
  add column if not exists last_gps_sats integer;

-- Same range guards the tag tables use, so a malformed payload cannot store a
-- coordinate that is not on Earth.
alter table public.lora_gateways
  drop constraint if exists lora_gateways_lat_range;
alter table public.lora_gateways
  add constraint lora_gateways_lat_range
  check (last_lat is null or (last_lat between -90 and 90));

alter table public.lora_gateways
  drop constraint if exists lora_gateways_lng_range;
alter table public.lora_gateways
  add constraint lora_gateways_lng_range
  check (last_lng is null or (last_lng between -180 and 180));

-- lora_gateways is exposed to anon by COLUMN grant, not a table grant, so that
-- gateway_key_hash stays unreadable. New columns are not covered by the earlier
-- grant and have to be added explicitly, or the dashboard cannot see them.
grant select (last_lat, last_lng, last_gps_status, last_gps_sats)
  on public.lora_gateways to anon, authenticated;

-- Replaces the function to also record the gateway's own position, carried on
-- the same payload the bridge already sends.
create or replace function public.ingest_lora_packet(
  p_gateway_key text,
  p_payload jsonb,
  p_raw_payload text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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
  v_gw_lat double precision;
  v_gw_lng double precision;
  v_gw_status text;
  v_gw_sats integer;
begin
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

  v_gw_lat := nullif(p_payload->>'gateway_lat', '')::double precision;
  v_gw_lng := nullif(p_payload->>'gateway_lng', '')::double precision;
  v_gw_status := nullif(p_payload->>'gateway_status', '');
  v_gw_sats := nullif(p_payload->>'gateway_sats', '')::integer;

  -- coalesce so a gateway that loses its fix keeps its last known position
  -- instead of blanking the map anchor on the next packet.
  update public.lora_gateways
  set last_seen_at = now(),
      firmware_version = coalesce(p_payload->>'gateway_fw', firmware_version),
      last_lat = coalesce(v_gw_lat, last_lat),
      last_lng = coalesce(v_gw_lng, last_lng),
      last_gps_status = coalesce(v_gw_status, last_gps_status),
      last_gps_sats = coalesce(v_gw_sats, last_gps_sats),
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
$function$;

revoke all on function public.ingest_lora_packet(text, jsonb, text) from public;
revoke execute on function public.ingest_lora_packet(text, jsonb, text) from authenticated;
grant execute on function public.ingest_lora_packet(text, jsonb, text) to anon, service_role;
