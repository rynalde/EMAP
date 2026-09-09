# Packet format

One shape for every device: **a reading**. A LoRa tag reports a position, a
Channel Sounding gateway reports a distance, a cellular tracker reports a
position it measured itself. They differ in which fields are set, not in
structure.

## The reading

```json
{
  "device_id": "A4CF12345678",
  "seq": 42,
  "status": "fix",
  "lat": 38.722300,
  "lng": -9.139300,
  "sats": 7,
  "hdop": 1.20,
  "distance_m": null,
  "battery_mv": 4100,
  "fw": "mvp-0.2.0"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `device_id` | string | The reporting device. **Omitted** when a device reports itself — its ingest key already identifies it. Required when a gateway relays another device. |
| `seq` | int | Monotonic counter since boot. Gaps are lost packets. |
| `status` | string | What the measurement is worth. See below. |
| `lat` / `lng` | float or **null** | Position. `null` whenever unknown — never a placeholder. |
| `sats` | int | Satellites used. |
| `hdop` | float or null | Horizontal dilution of precision. `null` for the NMEA 99.99 "no usable fix" sentinel. |
| `distance_m` | float or null | Channel Sounding only: metres from the reporting gateway. `null` on a failed attempt. |
| `battery_mv` | int | Battery millivolts. `bat_mv` is accepted as an alias. |
| `rssi` / `snr` | number | Radio quality, added by the gateway on reception. |
| `gps_time` | ISO 8601 | Time from the GNSS receiver, if it has one. |
| `fw`, `label`, `board_model` | string | Device metadata; update the `devices` row. |

Any other key passes through untouched and is stored in the reading's `payload`
jsonb. Firmware diagnostics (`uptime_ms`, `rx_count`, `crc_errors`, `csq`,
`imei`, `tags_in_range`) ride along that way with no backend change.

### `status`

The device's own account of the measurement. Never inferred downstream.

| Value | Meaning | `lat`/`lng` |
| --- | --- | --- |
| `fix` | Current valid fix | live |
| `stale` | Had a fix, it aged out | last known |
| `acquiring` | Receiver is searching | `null` |
| `no_gps` | Receiver never answered, or the device has none | `null` |
| `ok` | Ranging succeeded | `null` — `distance_m` is set |
| `poor` | Ranged, but tone quality was bad | `null` — `distance_m` is set |
| `failed` | Ranging attempt produced nothing usable | `null`, and `distance_m` is `null` too |

**The device never fabricates a value.** A wrong coordinate is worse than no
coordinate, because once stored it is indistinguishable from a measured one.
The database enforces the `failed` case: a check constraint rejects a failed
reading that carries any measurement.

`status` is plain text, not an enum, so firmware may add a value without the
backend dropping otherwise-valid readings.

## Over the air (LoRa)

The tag transmits the reading object above, as one JSON string, over raw LoRa
P2P. Roughly 140 bytes; ~230 ms of airtime at SF7/CR4-5.

## Gateway → bridge (USB serial)

Exactly **one JSON object per line**. Two shapes, told apart by one key.

### Relayed — the gateway heard another device

```json
{"device_id":"GW001","fw":"mvp-0.2.0","received_at_ms":123456,"rssi":-82,"snr":7.5,
 "payload":{"device_id":"A4CF12345678","seq":42,"status":"fix","lat":38.7223,"lng":-9.1393},
 "raw_payload":"{\"device_id\":\"A4CF12345678\",...}"}
```

The envelope carries only what the gateway itself measured — a tag cannot know
its own RSSI. On merge the tag's own fields win; the gateway fills in `rssi` and
`snr` only where the tag left them unset.

A Channel Sounding gateway uses the identical shape; its `payload` just carries
`distance_m` instead of `lat`/`lng`:

```json
{"device_id":"GWCS01","fw":"cs-0.2.0","received_at_ms":123456,
 "payload":{"device_id":"a1b2c3d4e5f60718","distance_m":3.42,"status":"ok","rssi":-54}}
```

### Self-report — the line *is* the gateway's reading

```json
{"device_id":"GW001","fw":"mvp-0.2.0","status":"fix","lat":38.7223,"lng":-9.1393,
 "sats":9,"uptime_ms":600000,"rx_count":312,"crc_errors":4}
```

No `payload` key. Emitted on a timer whether or not any tag is in range,
because a gateway hearing nothing is a normal state and the map still needs an
anchor. A gateway with no GNSS reports `"status":"no_gps"` with null
coordinates rather than a placeholder.

A line carrying **only** `raw_payload` is a frame that did not parse as JSON.
The bridge logs it and moves on — there is nothing measured in it.

Non-JSON lines (`[BOOT]`, `[LORA]`, `[GPS]`, …) are debug output and are
ignored unless `BRIDGE_VERBOSE=1`.

## Cellular → Supabase (HTTPS)

No gateway and no bridge. The board POSTs to `/rest/v1/rpc/ingest`:

```http
POST /rest/v1/rpc/ingest
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json

{"p_key":"<the board's ingest key>","p_payload":{"seq":12,"status":"fix","lat":38.7223,"lng":-9.1393,"sats":9,"battery_mv":4021,"csq":18,"fw":"cell-0.1.0"}}
```

Note the missing `device_id`: the key identifies the board, so the two can
never disagree and create a duplicate device row.

## Bridge → Supabase

Same RPC, called through supabase-js:

```ts
supabase.rpc("ingest", { p_key, p_payload })
```

`p_payload` is the flattened line. There is no routing left in the bridge: the
RPC decides what the reading is from the payload —

* `device_id` absent, or equal to the key's device → **self-report**,
  `reported_by` is null
* `device_id` naming another device → **relayed**, `reported_by` is the key's
  device, and the tag inherits the gateway's `link` if it is new

## Response

```json
{"ok":true,"reading_id":123,"device_id":"A4CF12345678","reported_by":"GW001","recorded_at":"2026-09-08T12:00:00Z"}
```

Errors are raised with SQLSTATE codes the bridge classifies as permanent, so it
does not retry them: `28000` invalid ingest key, `22023` invalid parameter,
`23514` a check constraint (coordinate out of range, or a `failed` reading
carrying a measurement).
