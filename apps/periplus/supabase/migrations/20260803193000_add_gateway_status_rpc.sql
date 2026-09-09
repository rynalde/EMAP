-- Gateway status heartbeat
--
-- The gateway's position previously rode along inside the packets it relayed
-- from tags. That meant a gateway hearing no tags never reported where it was,
-- so the map had no anchor exactly when it was least able to get one from a
-- tag. A gateway with no tags in range is a normal state, not an error.
--
-- This RPC lets the gateway report itself independently of tag traffic. It
-- touches only lora_gateways and never inserts readings, so a heartbeat cannot
-- be mistaken for a tag observation.

create or replace function public.ingest_lora_gateway_status(
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
  v_lat double precision;
  v_lng double precision;
  v_status text;
  v_sats integer;
begin
  select id into v_gateway_id
  from public.lora_gateways
  where gateway_key_hash = encode(extensions.digest(p_gateway_key, 'sha256'), 'hex');

  if v_gateway_id is null then
    raise exception 'Invalid gateway key' using errcode = '28000';
  end if;

  v_lat := nullif(p_payload->>'gateway_lat', '')::double precision;
  v_lng := nullif(p_payload->>'gateway_lng', '')::double precision;
  v_status := nullif(p_payload->>'gateway_status', '');
  v_sats := nullif(p_payload->>'gateway_sats', '')::integer;

  -- coalesce: a gateway that loses its fix keeps its last known position
  -- rather than blanking the map anchor.
  update public.lora_gateways
  set last_seen_at = now(),
      firmware_version = coalesce(p_payload->>'gateway_fw', firmware_version),
      last_lat = coalesce(v_lat, last_lat),
      last_lng = coalesce(v_lng, last_lng),
      last_gps_status = coalesce(v_status, last_gps_status),
      last_gps_sats = coalesce(v_sats, last_gps_sats),
      metadata = metadata || jsonb_build_object('last_status_at', now())
  where id = v_gateway_id;

  return jsonb_build_object(
    'ok', true,
    'gateway_id', v_gateway_id,
    'received_at', now()
  );
end;
$function$;

-- Same exposure as ingest_lora_packet: anon calls it holding the gateway key.
revoke all on function public.ingest_lora_gateway_status(text, jsonb) from public;
revoke execute on function public.ingest_lora_gateway_status(text, jsonb) from authenticated;
grant execute on function public.ingest_lora_gateway_status(text, jsonb) to anon, service_role;
