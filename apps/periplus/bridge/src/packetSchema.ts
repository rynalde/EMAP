import { z } from "zod";

/**
 * One reading, whatever produced it.
 *
 * A GPS tag reports lat/lng, a Channel Sounding gateway reports distance_m for
 * the tag it ranged, a cellular tracker reports lat/lng straight from its own
 * modem. They are the same shape because they are the same thing: a device's
 * account of one measurement. `status` says which fields are meaningful.
 */
export const readingSchema = z
  .object({
    // Omitted when the device is reporting itself — its ingest key already
    // identifies it. Required only when a gateway relays another device.
    device_id: z.string().min(1).optional(),
    seq: z.number().int().nonnegative().optional(),
    // fix | stale | acquiring | no_gps for a position,
    // ok | poor | failed for a ranging attempt.
    // Plain string rather than an enum so a future firmware value cannot make
    // the bridge drop otherwise-valid readings.
    status: z.string().optional(),
    // .nullable() matters as much as .optional(): a device with no position
    // sends an explicit `null` rather than omitting the key or inventing a
    // coordinate. Zod's .optional() only permits `undefined`, so without
    // .nullable() every reading from a device without a fix is rejected.
    lat: z.number().gte(-90).lte(90).nullable().optional(),
    lng: z.number().gte(-180).lte(180).nullable().optional(),
    // null when the receiver reports the 99.99 "no usable fix" sentinel.
    hdop: z.number().nullable().optional(),
    sats: z.number().int().nonnegative().optional(),
    // Channel Sounding: distance from the reporting device, not a position.
    // null when the ranging attempt failed — same rule as lat/lng.
    distance_m: z.number().nonnegative().nullable().optional(),
    battery_mv: z.number().int().optional(),
    // Some firmware revisions emit bat_mv instead.
    bat_mv: z.number().int().optional(),
    rssi: z.number().optional(),
    snr: z.number().optional(),
    gps_time: z.string().optional(),
    fw: z.string().optional(),
    label: z.string().optional(),
  })
  // Unknown keys pass through instead of being stripped. The RPC reads the
  // fields above and stores the whole object as jsonb, so firmware diagnostics
  // (uptime_ms, rx_count, crc_errors, …) reach the database without a bridge
  // change — and without a list of pass-through fields to keep in sync.
  .passthrough();

export type Reading = z.infer<typeof readingSchema>;

/**
 * One JSON line printed by a gateway over USB serial.
 *
 * A line with `payload` is a relayed reading — the gateway heard another device
 * and wrapped that device's own JSON, adding the radio metadata it measured.
 * A line without `payload` IS the gateway's own reading: its position, or just
 * a heartbeat saying it is alive and hearing nothing.
 *
 * Relayed:
 *   {"device_id":"GW001","fw":"mvp-0.2.0","rssi":-82,"snr":7.5,
 *    "payload":{"device_id":"A4CF12345678","seq":9,"status":"fix","lat":38.7,"lng":-9.1}}
 *
 * Self:
 *   {"device_id":"GW001","fw":"mvp-0.2.0","status":"fix","lat":38.7,"lng":-9.1,"sats":9}
 */
export const gatewayLineSchema = readingSchema.extend({
  payload: readingSchema.optional(),
  // The gateway emits this alone for frames that did not parse as JSON. Such a
  // line carries no payload and is a diagnostic, not a reading.
  raw_payload: z.string().optional(),
});

export type GatewayLine = z.infer<typeof gatewayLineSchema>;

/**
 * Flatten one serial line into the single jsonb object the ingest RPC reads.
 *
 * For a relayed line the tag's own fields win and the gateway contributes only
 * what the tag could not know — the radio metadata it measured on reception.
 * For a self-report the line already is the reading.
 */
export function buildIngestPayload(
  line: GatewayLine,
): Record<string, unknown> {
  const { payload, raw_payload, ...envelope } = line;

  if (!payload) {
    return raw_payload === undefined ? envelope : { ...envelope, raw_payload };
  }

  const merged: Record<string, unknown> = { ...payload };

  // Measured by the gateway on reception, so the tag cannot have sent them.
  // Still guarded: a tag that does report its own value keeps it.
  for (const key of ["rssi", "snr"] as const) {
    if (envelope[key] !== undefined && merged[key] === undefined) {
      merged[key] = envelope[key];
    }
  }
  if (raw_payload !== undefined) merged.raw_payload = raw_payload;

  return merged;
}
