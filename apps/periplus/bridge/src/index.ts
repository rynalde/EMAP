import { createLineSource } from "./serial.ts";
import { loadConfig, SupabaseSink } from "./supabase.ts";
import { buildIngestPayload, gatewayLineSchema } from "./packetSchema.ts";

/**
 * Serial -> Supabase bridge.
 *
 * Needed only for gateways, which reach the network over USB. Cellular tags
 * post to the same `ingest` RPC directly and never pass through here.
 *
 * Pipeline:
 *   1. Open serial port (or stdin when MOCK_SERIAL=1).
 *   2. Read one line at a time.
 *   3. Ignore non-JSON debug lines ([DEBUG], [BOOT], [GPS], ...).
 *   4. Parse + validate JSON with zod.
 *   5. Flatten to one payload — a relayed reading, or the gateway's own.
 *   6. Call ingest().
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const sink = new SupabaseSink(config);

  const serialPath = process.env.SERIAL_PORT ?? "/dev/ttyACM0";
  const baudRate = Number(process.env.SERIAL_BAUD ?? "115200");

  const source = createLineSource({ path: serialPath, baudRate });

  // Track in-flight ingests so we can drain them before exiting (otherwise the
  // success/failure log — or the delivery itself — can be cut off on shutdown).
  const pending = new Set<Promise<void>>();
  let shuttingDown = false;

  // Single shutdown path shared by close/SIGINT/SIGTERM. Stops accepting new
  // lines, closes the source, then drains every in-flight ingest (looping so
  // jobs queued during the drain are also awaited) before exiting.
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    source.removeAllListeners("line");
    console.log("\n[BRIDGE] shutting down...");
    await source.close().catch(() => {});
    while (pending.size > 0) {
      await Promise.allSettled([...pending]);
    }
    console.log("[BRIDGE] shutdown complete");
    process.exit(code);
  };

  source.on("open", () => {
    const where = process.env.MOCK_SERIAL === "1" ? "stdin (mock)" : serialPath;
    console.log(`[BRIDGE] connected serial ${where} @ ${baudRate} baud`);
  });

  source.on("error", (err: Error) => {
    console.error(`[ERROR] serial error: ${err.message}`);
  });

  source.on("close", () => {
    void shutdown(0);
  });

  source.on("line", (raw: string) => {
    if (shuttingDown) return;
    const job = handleLine(raw, sink).finally(() => pending.delete(job));
    pending.add(job);
  });

  await source.open();

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
}

// Exported for the dispatch tests: what reaches the RPC is the one thing here
// that silently corrupts data if it goes wrong, so it is worth asserting.
export async function handleLine(raw: string, sink: SupabaseSink): Promise<void> {
  const line = raw.trim();
  if (line.length === 0) return;

  // Machine-readable lines must start with `{`. Everything else is a debug log.
  if (!line.startsWith("{")) {
    if (process.env.BRIDGE_VERBOSE === "1") {
      console.log(`[DEVICE] ${line}`);
    }
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    console.error(`[ERROR] invalid packet (not JSON): ${line}`);
    return;
  }

  const parsed = gatewayLineSchema.safeParse(json);
  if (!parsed.success) {
    console.error(
      `[ERROR] invalid packet (schema): ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    return;
  }

  const gatewayLine = parsed.data;

  // The gateway emits raw_payload-only lines for frames that did not parse as
  // JSON. There is nothing measured in them — log as a diagnostic and move on.
  if (!gatewayLine.payload && gatewayLine.status === undefined) {
    console.warn(
      `[BRIDGE] non-JSON frame, skipping: ${gatewayLine.raw_payload ?? line}`,
    );
    return;
  }

  const payload = buildIngestPayload(gatewayLine);

  console.log(`[BRIDGE] ${describe(gatewayLine.payload ? "relay" : "self", payload)}`);

  try {
    const result = await sink.ingest(payload);
    console.log(`[SUPABASE] reading_id=${result.reading_id} device=${result.device_id}`);
  } catch (err) {
    console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** One log line covering every reading shape, so nothing needs its own branch. */
function describe(kind: string, p: Record<string, unknown>): string {
  const where =
    p.lat != null && p.lng != null
      ? `${p.lat}, ${p.lng}`
      : p.distance_m != null
        ? `${p.distance_m}m away`
        : "no position";
  return `${kind} device=${p.device_id ?? "self"} status=${p.status ?? "?"} (${where}) rssi=${p.rssi ?? "?"}`;
}

// Guarded so the dispatch tests can import handleLine without main() opening a
// serial port as a side effect of the import.
if (import.meta.main) {
  main().catch((err) => {
    console.error(`[ERROR] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
