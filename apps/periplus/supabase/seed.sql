-- Unified device schema — registration and validation
--
-- Run this after the migrations, from the Supabase SQL editor. Nothing here is
-- automatic: every device that WRITES needs a key, and a key exists exactly
-- once, in plaintext, in the output below. Copy each one straight into the
-- device's config and rotate if lost — only the hash is stored.
--
-- Devices that write:
--   * gateways        (T-Echo LoRa, XIAO Channel Sounding) — they report on
--                     behalf of the tags they hear
--   * cellular tags   (T-SIM7000G) — no gateway, they reach Supabase directly
--
-- Devices that do NOT get a key: LoRa and Channel Sounding tags. They never
-- touch the API; the gateway authenticates for them and their row is created on
-- the first reading.

-- --- Gateways -------------------------------------------------------------
-- device_id is yours to choose for a gateway (it is configured, not derived
-- from silicon). Keep it matching GATEWAY_ID in the firmware config.
select public.register_device(
  'GW001', 'gateway', 'lora', 'LILYGO T-Echo SX1262', 'techo-lora-gateway'
) as copy_into_bridge_env_GATEWAY_KEY;

-- select public.register_device(
--   'GWCS01', 'gateway', 'ble_cs', 'Seeed XIAO nRF54L15', 'xiao-cs-gateway'
-- ) as copy_into_bridge_env_GATEWAY_KEY;

-- --- Cellular tags --------------------------------------------------------
-- device_id MUST be the modem's IMEI: the board reads its own IMEI at boot and
-- reports under it, so a mismatch here creates a second row for one board.
-- Read it from the serial log on first boot, or with AT+GSN.
--
-- select public.register_device(
--   '869951039335207', 'tag', 'cellular', 'LILYGO T-SIM7000G', 'truck-01'
-- ) as copy_into_TSIM_CONFIG_INGEST_KEY;

-- --- Validation -----------------------------------------------------------
-- Substitute the key printed above. A cellular tag's own report looks exactly
-- like this, minus device_id (its key already identifies it).
--
-- select public.ingest('<the key printed above>', '{
--   "device_id": "TAG001",
--   "seq": 1,
--   "status": "fix",
--   "lat": 38.7223,
--   "lng": -9.1393,
--   "battery_mv": 4100,
--   "sats": 7,
--   "hdop": 1.2,
--   "rssi": -82,
--   "snr": 7.5,
--   "fw": "mvp-0.2.0"
-- }'::jsonb);

-- Then verify — one query covers every link:
select device_id, kind, link, status, lat, lng, distance_m, battery_mv, recorded_at
from public.latest_positions
order by recorded_at desc;
