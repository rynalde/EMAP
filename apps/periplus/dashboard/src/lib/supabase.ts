import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail fast and loud rather than building a non-functional client that only
  // surfaces opaque 401s at query time.
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to dashboard/.env and fill them in.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

// Note: snr and hdop are Postgres `numeric` and arrive as strings (see
// lib/format.ts). lat/lng (double precision) and integer columns arrive as
// numbers. The types below reflect what the wire actually delivers.

/** One row of public.latest_positions — every link, tags and gateways alike. */
export interface LatestPosition {
  device_id: string;
  label: string | null;
  kind: "tag" | "gateway";
  link: string;
  recorded_at: string;
  status: string;
  lat: number | null;
  lng: number | null;
  hdop: number | string | null;
  sats: number | null;
  /** Channel Sounding: a distance from the reporter, not a position. */
  distance_m: number | null;
  battery_mv: number | null;
  rssi: number | null;
  snr: number | string | null;
  seq: number | null;
  reported_by_label: string | null;
}

/** One row of public.readings. */
export interface Reading {
  id: number;
  device_id: string;
  reported_by: string | null;
  seq: number | null;
  recorded_at: string;
  status: string;
  lat: number | null;
  lng: number | null;
  distance_m: number | null;
  battery_mv: number | null;
  rssi: number | null;
  snr: number | string | null;
}
