import type { Vessel } from "./types";
export function parseAISMessage(
  data: Record<string, unknown>,
  now = Date.now(),
): Vessel | null {
  const meta = (data.MetaData ?? {}) as Record<string, unknown>;
  const message = (data.Message ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const report = message[String(data.MessageType)];
  if (
    ![
      "PositionReport",
      "StandardClassBPositionReport",
      "ExtendedClassBPositionReport",
    ].includes(String(data.MessageType)) ||
    !report ||
    report.Valid === false
  )
    return null;
  const lat = Number(report.Latitude ?? meta.latitude ?? meta.Latitude),
    lon = Number(report.Longitude ?? meta.longitude ?? meta.Longitude);
  const mmsi = String(meta.MMSI ?? report.UserID ?? "");
  if (
    !/^\d{9}$/.test(mmsi) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -2.85 ||
    lat > -2.2 ||
    lon < -44.65 ||
    lon > -44.1
  )
    return null;
  const sourceDate =
    typeof meta.time_utc === "string"
      ? Date.parse(
          meta.time_utc
            .trim()
            .replace(/\s+UTC$/, "Z")
            .replace(/\s\+0000Z$/, "Z")
            .replace(" ", "T")
            .replace(/(\.\d{3})\d+/, "$1"),
        )
      : NaN;
  if (typeof meta.time_utc === "string" && !Number.isFinite(sourceDate))
    return null;
  const timestamp = Number.isFinite(sourceDate) ? sourceDate : now;
  if (now - timestamp > 15 * 60000 || timestamp > now + 60000) return null;
  const heading = Number(report.TrueHeading),
    course = Number(report.Cog),
    speed = Number(report.Sog);
  const nav = Number(report.NavigationalStatus);
  return {
    id: `ais-${mmsi}`,
    mmsi,
    name: String(meta.ShipName || mmsi)
      .replace(/@/g, "")
      .trim(),
    status: nav === 5 ? "atracado" : nav === 1 ? "fundeado" : "navegando",
    coordinates: [lon, lat],
    heading:
      heading >= 0 && heading < 360
        ? heading
        : course >= 0 && course < 360
          ? course
          : undefined,
    speed:
      Number.isFinite(speed) && speed >= 0 && speed < 102.3 ? speed : undefined,
    updatedAt: new Date(timestamp).toISOString(),
    positionSource: "ais",
    stale: false,
  };
}
