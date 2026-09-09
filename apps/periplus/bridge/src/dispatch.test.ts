import { expect, test } from "bun:test";
import { handleLine } from "./index.ts";
import type { SupabaseSink } from "./supabase.ts";

/**
 * Every line now reaches the same RPC, so what these assert is *what* gets sent
 * rather than *where* it goes. That is where the silent corruption lives: a
 * relayed reading whose device_id got lost is filed against the gateway, and a
 * ranging distance that leaks into lat/lng becomes indistinguishable from a
 * measured fix once it is in the database.
 */
function fakeSink(): { sink: SupabaseSink; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const sink = {
    ingest: async (payload: Record<string, unknown>) => {
      calls.push(payload);
      return {
        ok: true,
        reading_id: 1,
        device_id: String(payload.device_id ?? "self"),
        reported_by: null,
        recorded_at: "",
      };
    },
  };
  return { sink: sink as unknown as SupabaseSink, calls };
}

const UID = "a1b2c3d4e5f60718";

test("a relayed reading keeps the tag's identity, not the gateway's", async () => {
  const { sink, calls } = fakeSink();
  await handleLine(
    JSON.stringify({
      device_id: "GW001",
      fw: "mvp-0.2.0",
      rssi: -82,
      snr: 7.5,
      payload: { device_id: "A4CF12345678", seq: 1, status: "fix", lat: 38.7223, lng: -9.1393 },
    }),
    sink,
  );

  expect(calls.length).toBe(1);
  // The gateway's own id must not survive the merge, or the RPC files the
  // reading against the gateway and reported_by comes out null.
  expect(calls[0]!.device_id).toBe("A4CF12345678");
  expect(calls[0]!.lat).toBe(38.7223);
  // Measured by the gateway on reception, so the tag could not have sent it.
  expect(calls[0]!.rssi).toBe(-82);
  expect(calls[0]!.snr).toBe(7.5);
});

test("a tag that reports its own rssi is not overwritten by the gateway's", async () => {
  const { sink, calls } = fakeSink();
  await handleLine(
    JSON.stringify({
      device_id: "GW001",
      rssi: -82,
      payload: { device_id: "A4CF12345678", status: "acquiring", lat: null, lng: null, rssi: -40 },
    }),
    sink,
  );

  expect(calls[0]!.rssi).toBe(-40);
  // An explicit null must survive: it is the device saying it has no position.
  expect(calls[0]!.lat).toBe(null);
});

test("a ranging reading carries a distance and never a coordinate", async () => {
  const { sink, calls } = fakeSink();
  await handleLine(
    JSON.stringify({
      device_id: "GWCS01",
      fw: "cs-0.2.0",
      payload: { device_id: UID, distance_m: 3.42, status: "ok", rssi: -54 },
    }),
    sink,
  );

  expect(calls.length).toBe(1);
  expect(calls[0]!.device_id).toBe(UID);
  expect(calls[0]!.distance_m).toBe(3.42);
  expect(calls[0]!.lat).toBeUndefined();
  expect(calls[0]!.lng).toBeUndefined();
});

test("a failed ranging attempt keeps its null distance rather than a number", async () => {
  const { sink, calls } = fakeSink();
  await handleLine(
    JSON.stringify({
      device_id: "GWCS01",
      payload: { device_id: UID, distance_m: null, status: "failed" },
    }),
    sink,
  );

  expect(calls[0]!.distance_m).toBe(null);
  expect(calls[0]!.status).toBe("failed");
});

test("a gateway reporting itself sends its own reading, unnested", async () => {
  const { sink, calls } = fakeSink();
  await handleLine(
    JSON.stringify({
      device_id: "GW001",
      fw: "mvp-0.2.0",
      status: "fix",
      lat: 38.7,
      lng: -9.1,
      sats: 7,
      uptime_ms: 60000,
    }),
    sink,
  );

  expect(calls.length).toBe(1);
  expect(calls[0]!.device_id).toBe("GW001");
  expect(calls[0]!.lat).toBe(38.7);
  // Unknown keys pass through to the payload jsonb instead of being stripped.
  expect(calls[0]!.uptime_ms).toBe(60000);
});

test("a non-JSON frame is a diagnostic and is never ingested", async () => {
  const { sink, calls } = fakeSink();
  await handleLine(
    JSON.stringify({ device_id: "GW001", raw_payload: "garbage from the air" }),
    sink,
  );

  expect(calls.length).toBe(0);
});

test("an out-of-range coordinate is rejected rather than stored", async () => {
  const { sink, calls } = fakeSink();
  await handleLine(
    JSON.stringify({
      device_id: "GW001",
      payload: { device_id: "A4CF12345678", status: "fix", lat: 991.0, lng: -9.1 },
    }),
    sink,
  );

  expect(calls.length).toBe(0);
});
