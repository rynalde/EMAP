import { useCallback } from "react";
import { supabase, type Reading } from "../lib/supabase.ts";
import { fmtInt, fmtNum, fmtTime } from "../lib/format.ts";
import { usePolledQuery } from "../lib/usePolledQuery.ts";

export function ReadingsTable() {
  const query = useCallback(
    () =>
      supabase
        .from("readings")
        .select(
          "id, device_id, reported_by, seq, recorded_at, status, lat, lng, distance_m, battery_mv, rssi, snr",
        )
        .order("recorded_at", { ascending: false })
        .limit(25),
    [],
  );
  const { rows, error, loading } = usePolledQuery<Reading>(query);

  return (
    <section>
      <h2>Recent readings</h2>
      {error && <p className="error">Error: {error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No readings yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>id</th>
              <th>device_id</th>
              <th>seq</th>
              <th>recorded_at</th>
              <th>status</th>
              <th>lat</th>
              <th>lng</th>
              <th>distance_m</th>
              <th>battery_mv</th>
              <th>rssi</th>
              <th>snr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.device_id}</td>
                <td>{fmtInt(r.seq)}</td>
                <td>{fmtTime(r.recorded_at)}</td>
                <td>{r.status}</td>
                <td>{fmtNum(r.lat)}</td>
                <td>{fmtNum(r.lng)}</td>
                <td>{fmtNum(r.distance_m, 2)}</td>
                <td>{fmtInt(r.battery_mv)}</td>
                <td>{fmtInt(r.rssi)}</td>
                <td>{fmtNum(r.snr, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
