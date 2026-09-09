import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface IngestResult {
  ok: boolean;
  reading_id: number;
  device_id: string;
  /** null when the device reported itself; the gateway's id when it relayed. */
  reported_by: string | null;
  recorded_at: string;
}

export interface BridgeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  ingestKey: string;
}

export function loadConfig(): BridgeConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  // LORA_GATEWAY_KEY is the pre-unification name. Accepted so a bridge with a
  // working .env keeps running after the rename instead of failing at boot.
  const ingestKey = process.env.GATEWAY_KEY ?? process.env.LORA_GATEWAY_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
  if (!ingestKey) missing.push("GATEWAY_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Copy .env.example to bridge/.env and fill them in.`,
    );
  }

  return {
    supabaseUrl: supabaseUrl!,
    supabaseAnonKey: supabaseAnonKey!,
    ingestKey: ingestKey!,
  };
}

export class SupabaseSink {
  private client: SupabaseClient;
  private config: BridgeConfig;

  // Plain field assignment rather than a constructor parameter property — see
  // the note in serial.ts: Node's strip-only type removal rejects those, and
  // Node is the only runtime here that can load the native serialport module.
  constructor(config: BridgeConfig) {
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false },
    });
  }

  /**
   * Call the ingest RPC with exponential-backoff retry for transient failures.
   * Throws on the final attempt.
   *
   * One method for every kind of reading: a relayed GPS fix, a ranging result
   * and a gateway heartbeat differ only in which payload fields are set, and
   * the RPC routes on that. There is nothing left for the bridge to decide.
   */
  async ingest(
    payload: Record<string, unknown>,
    maxRetries = 3,
  ): Promise<IngestResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // A transport failure (DNS, reset, blocked host) rejects the call rather
      // than returning { error }, so catch both shapes and classify uniformly.
      try {
        const { data, error } = await this.client.rpc("ingest", {
          p_key: this.config.ingestKey,
          p_payload: payload,
        });

        if (!error) {
          return data as IngestResult;
        }
        lastError = error;
      } catch (err) {
        lastError = err;
      }

      // Don't retry clear client-side errors (bad key, bad payload).
      if (!isTransient(lastError)) {
        break;
      }

      if (attempt < maxRetries) {
        const delayMs = 1000 * 2 ** attempt; // 1s, 2s, 4s
        await sleep(delayMs);
      }
    }

    throw new Error(`ingest failed: ${formatError(lastError)}`);
  }
}

// Postgres/PostgREST errors carry a structured `code`. These are permanent
// (retrying cannot help): a bad ingest key, a malformed payload, a value out
// of range, a constraint violation, or any PostgREST request error.
const NON_TRANSIENT_CODES = new Set<string>([
  "28000", // invalid_authorization (RPC: invalid ingest key)
  "22023", // invalid_parameter_value
  "22003", // numeric_value_out_of_range
  "22P02", // invalid_text_representation (bad cast)
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23514", // check_violation (lat/lng/distance range)
]);

function isTransient(error: unknown): boolean {
  const code = getErrorCode(error);

  // No structured code almost always means a transport/network failure
  // (fetch failed, DNS, connection reset, timeout) — worth retrying.
  if (!code) return true;

  if (NON_TRANSIENT_CODES.has(code)) return false;
  // PostgREST request/schema errors (PGRST1xx etc.) are permanent.
  if (code.startsWith("PGRST")) return false;

  // Any other recognized SQLSTATE is treated as a client/permanent error so we
  // don't hammer the server; genuine outages surface as code-less fetch errors.
  return false;
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return undefined;
}

function formatError(error: unknown): string {
  if (!error) return "unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const e = error as { message?: string; details?: string; hint?: string };
    return [e.message, e.details, e.hint].filter(Boolean).join(" | ") || JSON.stringify(error);
  }
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
