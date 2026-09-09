import { useEffect, useRef, useState } from "react";

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Polls a Supabase query on an interval with a single in-flight guard and
 * proper cancellation, so slow responses don't overlap or call setState after
 * unmount. Shared by every table so the lifecycle lives in one place.
 */
export function usePolledQuery<T>(
  // Supabase's query builder is a thenable (PromiseLike), not a real Promise.
  queryFn: () => PromiseLike<QueryResult<T>>,
  intervalMs = 10_000,
): { rows: T[]; error: string | null; loading: boolean } {
  // Keep the latest queryFn without re-subscribing the interval each render.
  const queryRef = useRef(queryFn);
  queryRef.current = queryFn;

  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function load() {
      if (inFlight) return; // drop overlapping ticks
      inFlight = true;
      try {
        const { data, error } = await queryRef.current();
        if (cancelled) return;
        if (error) {
          setError(error.message);
        } else {
          setError(null);
          setRows(data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id = setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { rows, error, loading };
}
