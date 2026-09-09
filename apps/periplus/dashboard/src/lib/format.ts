// Postgres `numeric` columns (snr, hdop) are serialized by PostgREST as JSON
// *strings* to preserve precision, while double precision (lat/lng) and integer
// columns come back as numbers. These helpers accept either and never call a
// number-only method on a string.

export function fmtNum(
  value: number | string | null | undefined,
  digits = 4,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export function fmtInt(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return String(n);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}
