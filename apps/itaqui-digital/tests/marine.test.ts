import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARINE_API_URL,
  parseMarineData,
  seaLevelSegments,
} from "../src/lib/marine";
import { GET } from "../src/app/api/marine/route";

const time = Date.parse("2026-09-05T20:00:00Z") / 1000;
const units = {
  time: "unixtime",
  sea_level_height_msl: "m",
  wave_height: "m",
  wave_period: "s",
  wave_direction: "°",
  ocean_current_velocity: "kn",
  ocean_current_direction: "°",
  sea_surface_temperature: "°C",
};
const fixture = {
  latitude: -2.5416641,
  longitude: -44.374985,
  current_units: units,
  hourly_units: units,
  current: {
    time,
    sea_level_height_msl: -0.35,
    wave_height: null,
    wave_period: null,
    wave_direction: null,
    ocean_current_velocity: 2.7,
    ocean_current_direction: 21,
    sea_surface_temperature: 29.3,
  },
  hourly: {
    time: [time, time + 3600, time + 7200, time + 10800],
    sea_level_height_msl: [-0.35, 0, null, 1.2],
    wave_height: [null, null, null, null],
    wave_period: [null, null, null, null],
    wave_direction: [null, null, null, null],
    ocean_current_velocity: [2.7, 2.1, 0, 1.8],
    ocean_current_direction: [21, 22, 0, 180],
    sea_surface_temperature: [29.3, 29.3, 29.2, 29.2],
  },
};

test("marine request selects sea cells, UTC epoch timestamps and verified knots parameter", () => {
  const params = new URL(MARINE_API_URL).searchParams;
  assert.equal(params.get("wind_speed_unit"), "kn");
  assert.equal(params.get("cell_selection"), "sea");
  assert.equal(params.get("timeformat"), "unixtime");
  assert.equal(params.get("forecast_hours"), "48");
  assert.ok(params.get("hourly")?.includes("sea_level_height_msl"));
});

test("marine data preserves negative MSL heights, zeroes and missing coastal waves", () => {
  const data = parseMarineData(fixture, time * 1000);
  assert.equal(data.current.seaLevel, -0.35);
  assert.equal(data.current.waveHeight, null);
  assert.equal(data.current.currentSpeed, 2.7);
  assert.equal(data.hourly[1].seaLevel, 0);
  assert.equal(data.hourly[2].currentSpeed, 0);
  assert.equal(data.datum, "MSL");
  assert.deepEqual(data.gridCoordinates, [-44.374985, -2.5416641]);
  assert.equal(data.gridDistanceKm, 4);
  assert.equal(data.fetchedAt, "2026-09-05T20:00:00.000Z");
});

test("marine chart keeps gaps instead of bridging unavailable levels", () => {
  const data = parseMarineData(fixture, time * 1000);
  assert.deepEqual(
    seaLevelSegments(data.hourly).map((s) => s.length),
    [2, 1],
  );
  assert.equal(seaLevelSegments([data.hourly[0], data.hourly[3]]).length, 2);
});

test("marine validator rejects incorrect units, stale forecasts and remote cells", () => {
  assert.throws(
    () =>
      parseMarineData(
        {
          ...fixture,
          current_units: { ...units, ocean_current_velocity: "km/h" },
        },
        time * 1000,
      ),
    /units/,
  );
  assert.throws(
    () => parseMarineData(fixture, (time + 4 * 3600) * 1000),
    /outdated/,
  );
  assert.throws(
    () => parseMarineData({ ...fixture, latitude: 0 }, time * 1000),
    /Unavailable/,
  );
  assert.throws(() => parseMarineData({ error: true }, time * 1000));
});

test("invalid timestamps do not shift aligned forecast values", () => {
  const data = parseMarineData(
    {
      ...fixture,
      hourly: {
        ...fixture.hourly,
        time: [time, null, time + 7200, time + 10800],
      },
    },
    time * 1000,
  );
  assert.equal(data.hourly[1].seaLevel, null);
  assert.equal(data.hourly[2].seaLevel, 1.2);
});

test("marine API returns an explicit unavailable response when provider fails", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("unavailable", { status: 503 }),
  );
  const response = await GET();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.equal(typeof data.error, "string");
  assert.equal(data.current, undefined);
  assert.equal(data.hourly, undefined);
});
