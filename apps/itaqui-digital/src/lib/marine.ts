export const MARINE_SOURCE_URL =
  "https://open-meteo.com/en/docs/marine-weather-api";

const variables = [
  "sea_level_height_msl",
  "wave_height",
  "wave_period",
  "wave_direction",
  "ocean_current_velocity",
  "ocean_current_direction",
  "sea_surface_temperature",
] as const;

export const MARINE_API_URL =
  "https://marine-api.open-meteo.com/v1/marine?" +
  new URLSearchParams({
    latitude: "-2.57735",
    longitude: "-44.3702884",
    current: variables.join(","),
    hourly: variables.join(","),
    timezone: "America/Fortaleza",
    timeformat: "unixtime",
    forecast_hours: "48",
    cell_selection: "sea",
    wind_speed_unit: "kn",
  });

export type MarinePoint = {
  time: number;
  seaLevel: number | null;
  waveHeight: number | null;
  wavePeriod: number | null;
  waveDirection: number | null;
  currentSpeed: number | null;
  currentDirection: number | null;
  waterTemperature: number | null;
};

export type MarineData = {
  source: "Open-Meteo Marine";
  sourceUrl: string;
  fetchedAt: string;
  timezone: "America/Fortaleza";
  datum: "MSL";
  requestedCoordinates: [number, number];
  gridCoordinates: [number, number];
  gridDistanceKm: number;
  current: MarinePoint;
  hourly: MarinePoint[];
};

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function point(time: number, values: RecordValue): MarinePoint {
  return {
    time,
    seaLevel: finite(values.sea_level_height_msl),
    waveHeight: finite(values.wave_height),
    wavePeriod: finite(values.wave_period),
    waveDirection: finite(values.wave_direction),
    currentSpeed: finite(values.ocean_current_velocity),
    currentDirection: finite(values.ocean_current_direction),
    waterTemperature: finite(values.sea_surface_temperature),
  };
}

function verifyUnits(value: unknown) {
  const units = record(value);
  const expected = ["m", "m", "s", "°", "kn", "°", "°C"];
  if (
    units.time !== "unixtime" ||
    variables.some((variable, index) => units[variable] !== expected[index])
  )
    throw new Error("Unexpected marine units");
}

/** Keep missing coastal data null: a missing wave estimate is not a calm sea. */
export function parseMarineData(value: unknown, now = Date.now()): MarineData {
  const data = record(value);
  const current = record(data.current);
  const hourly = record(data.hourly);
  const latitude = finite(data.latitude);
  const longitude = finite(data.longitude);
  const time = finite(current.time);
  if (
    latitude === null ||
    longitude === null ||
    Math.abs(latitude + 2.57735) > 0.5 ||
    Math.abs(longitude + 44.3702884) > 0.5 ||
    time === null ||
    time < now / 1000 - 3 * 3600 ||
    time > now / 1000 + 3600 ||
    !Array.isArray(hourly.time)
  )
    throw new Error("Unavailable or outdated marine forecast");

  verifyUnits(data.current_units);
  verifyUnits(data.hourly_units);
  const points = hourly.time
    .flatMap((entry, index) => {
      const timestamp = finite(entry);
      if (timestamp === null) return [];
      return [
        point(
          timestamp,
          Object.fromEntries(
            variables.map((variable) => [
              variable,
              Array.isArray(hourly[variable]) ? hourly[variable][index] : null,
            ]),
          ),
        ),
      ];
    })
    .filter((entry) => entry.time >= time - 3600)
    .sort((a, b) => a.time - b.time);
  if (
    points.length < 2 ||
    !points.some(
      (entry) =>
        entry.seaLevel !== null ||
        entry.waveHeight !== null ||
        entry.currentSpeed !== null ||
        entry.waterTemperature !== null,
    )
  )
    throw new Error("No marine forecast data");

  const radians = Math.PI / 180;
  const latDelta = (latitude + 2.57735) * radians;
  const lonDelta = (longitude + 44.3702884) * radians;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(latitude * radians) *
      Math.cos(-2.57735 * radians) *
      Math.sin(lonDelta / 2) ** 2;
  return {
    source: "Open-Meteo Marine",
    sourceUrl: MARINE_SOURCE_URL,
    fetchedAt: new Date(now).toISOString(),
    timezone: "America/Fortaleza",
    datum: "MSL",
    requestedCoordinates: [-44.3702884, -2.57735],
    gridCoordinates: [longitude, latitude],
    gridDistanceKm:
      Math.round(6371 * 2 * Math.asin(Math.sqrt(haversine)) * 10) / 10,
    current: point(time, current),
    hourly: points,
  };
}

/** Separate paths preserve real gaps in the forecast instead of inventing data. */
export function seaLevelSegments(points: MarinePoint[]): MarinePoint[][] {
  const segments: MarinePoint[][] = [];
  let segment: MarinePoint[] = [];
  for (const entry of points) {
    if (entry.seaLevel === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else {
      if (
        segment.length &&
        entry.time - segment[segment.length - 1].time > 3600
      ) {
        segments.push(segment);
        segment = [];
      }
      segment.push(entry);
    }
  }
  if (segment.length) segments.push(segment);
  return segments;
}
