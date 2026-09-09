import { useCallback } from "react";
import { supabase, type LatestPosition } from "../lib/supabase.ts";
import { fmtInt, fmtNum, fmtTime } from "../lib/format.ts";
import { usePolledQuery } from "../lib/usePolledQuery.ts";

export function LatestPositionsTable() {
  const query = useCallback(
    () =>
      supabase
        .from("latest_positions")
        .select("*")
        .order("recorded_at", { ascending: false }),
    [],
  );
  const { rows, error, loading } = usePolledQuery<LatestPosition>(query);

  return (
    <section>
      <h2>Latest device positions</h2>
      {error && <p className="error">Error: {error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No devices yet. Send a reading through the bridge or a cellular tag.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>device_id</th>
              <th>kind</th>
              <th>link</th>
              <th>recorded_at</th>
              <th>status</th>
              <th>lat</th>
              <th>lng</th>
              <th>distance_m</th>
              <th>battery_mv</th>
              <th>rssi</th>
              <th>snr</th>
              <th>sats</th>
              <th>hdop</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.device_id}>
                <td>{r.label ?? r.device_id}</td>
                <td>{r.kind}</td>
                <td>{r.link}</td>
                <td>{fmtTime(r.recorded_at)}</td>
                <td>{r.status}</td>
                <td>{fmtNum(r.lat)}</td>
                <td>{fmtNum(r.lng)}</td>
                <td>{fmtNum(r.distance_m, 2)}</td>
                <td>{fmtInt(r.battery_mv)}</td>
                <td>{fmtInt(r.rssi)}</td>
                <td>{fmtNum(r.snr, 1)}</td>
                <td>{fmtInt(r.sats)}</td>
                <td>{fmtNum(r.hdop, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
