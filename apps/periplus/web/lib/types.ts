/**
 * One row of public.latest_positions — the single view every client reads.
 *
 * Covers every link and both kinds of device: a LoRa tag relayed by a gateway,
 * a Channel Sounding tag that was ranged rather than positioned, a cellular
 * tracker reporting itself, and the gateways themselves. `link` says how it
 * talks, `status` says what the measurement is worth.
 */
export type DeviceLink = "lora" | "ble_cs" | "cellular";

/**
 * The device's own account of the measurement, never inferred downstream.
 * fix/stale/acquiring/no_gps describe a position attempt, ok/poor/failed a
 * ranging attempt. Anything unrecognised is shown as unknown rather than
 * guessed at.
 */
export type ReadingStatus =
  | "fix"
  | "stale"
  | "acquiring"
  | "no_gps"
  | "ok"
  | "poor"
  | "failed"
  | "unknown";

export interface DevicePosition {
  device_id: string;
  label: string | null;
  kind: "tag" | "gateway";
  link: DeviceLink;
  board_model: string | null;
  firmware_version: string | null;
  recorded_at: string;
  device_time: string | null;
  seq: number | null;
  status: string;
  /** null whenever the device has no known position — never a placeholder. */
  lat: number | null;
  lng: number | null;
  hdop: number | null;
  sats: number | null;
  /** Channel Sounding: distance from the reporting device, not a position. */
  distance_m: number | null;
  battery_mv: number | null;
  rssi: number | null;
  snr: number | null;
  reported_by: string | null;
  reported_by_label: string | null;
  /** The reporting device's position — the centre of a ranging circle. */
  origin_lat: number | null;
  origin_lng: number | null;
  /** Set only when the tag has no position of its own but was ranged. */
  radius_m: number | null;
  payload: Record<string, unknown> | null;
}

/** A device whose position is known, so it can actually be drawn on the map. */
export interface LocatedDevice extends DevicePosition {
  lat: number;
  lng: number;
}

export function isLocated(d: DevicePosition): d is LocatedDevice {
  return typeof d.lat === "number" && typeof d.lng === "number";
}

/** A ranged tag: no position of its own, but a circle around its reporter. */
export interface RangedDevice extends DevicePosition {
  origin_lat: number;
  origin_lng: number;
  radius_m: number;
}

export function isRanged(d: DevicePosition): d is RangedDevice {
  return (
    typeof d.origin_lat === "number" &&
    typeof d.origin_lng === "number" &&
    typeof d.radius_m === "number"
  );
}

const KNOWN_STATUSES: ReadingStatus[] = [
  "fix",
  "stale",
  "acquiring",
  "no_gps",
  "ok",
  "poor",
  "failed",
];

export function statusOf(d: DevicePosition): ReadingStatus {
  return (KNOWN_STATUSES as string[]).includes(d.status)
    ? (d.status as ReadingStatus)
    : "unknown";
}

// One palette for both vocabularies, so a weak ranging and a stale fix read as
// the same degree of trust rather than as two unrelated colour schemes.
export const STATUS_COLOR: Record<ReadingStatus, string> = {
  fix: "#10b981",
  ok: "#10b981",
  stale: "#f59e0b",
  poor: "#f59e0b",
  acquiring: "#94a3b8",
  unknown: "#94a3b8",
  no_gps: "#ef4444",
  failed: "#ef4444",
};

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  fix: "Live fix",
  stale: "Last known",
  acquiring: "Acquiring",
  no_gps: "No GPS",
  ok: "Ranged",
  poor: "Weak ranging",
  failed: "Ranging failed",
  unknown: "Unknown",
};

export const LINK_LABEL: Record<DeviceLink, string> = {
  lora: "LoRa",
  ble_cs: "BLE ranging",
  cellular: "Cellular",
};

export function relativeAge(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}
