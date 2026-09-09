"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "../lib/supabase";
import {
  type DevicePosition,
  isLocated,
  isRanged,
} from "../lib/types";
import TagPanel from "../components/TagPanel";
import RangedTagPanel from "../components/RangedTagPanel";

// Leaflet touches `window` at import time, so the map can only load in the
// browser.
const TagMap = dynamic(() => import("../components/TagMap"), {
  ssr: false,
  loading: () => <div className="mapstub">Loading map…</div>,
});

const REFRESH_MS = 5000;

export default function Page() {
  const [rows, setRows] = useState<DevicePosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // One query for every link and both kinds of device. The gateway used to need
  // a second query against its own table; it is now a row in the same view,
  // because its heartbeat is a reading like any other.
  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("latest_positions")
      .select("*")
      .order("recorded_at", { ascending: false });

    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setRows((data ?? []) as DevicePosition[]);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const tags = useMemo(() => rows.filter((r) => r.kind === "tag"), [rows]);
  const located = useMemo(() => tags.filter(isLocated), [tags]);
  // Ranged, not positioned: a tag known only as a circle around its gateway.
  const ranged = useMemo(
    () => tags.filter((t) => !isLocated(t) && t.distance_m !== null),
    [tags],
  );
  const gateway = useMemo(
    () => rows.find((r) => r.kind === "gateway") ?? null,
    [rows],
  );
  const anchor = gateway && isLocated(gateway) ? gateway : null;
  const unlocated = tags.length - located.length - ranged.length;

  return (
    <main className="shell">
      <aside className="sidebar">
        <header className="head">
          <h1>Tracked devices</h1>
          <p className="sub">
            {tags.length} tag{tags.length === 1 ? "" : "s"} &middot;{" "}
            {located.length} on map
            {ranged.length > 0 && <> &middot; {ranged.length} ranged</>}
            {unlocated > 0 && <> &middot; {unlocated} without position</>}
          </p>
        </header>

        {error && <p className="error">{error}</p>}

        {gateway && (
          <div className="gateway">
            <span className="gwdot" />
            <div>
              <div className="gwname">{gateway.label ?? gateway.device_id}</div>
              <div className="gwmeta">
                Gateway &middot; {gateway.status}
                {anchor ? (
                  <>
                    {" "}
                    &middot; {anchor.lat.toFixed(5)}, {anchor.lng.toFixed(5)}
                  </>
                ) : (
                  <> &middot; no position</>
                )}
              </div>
            </div>
          </div>
        )}

        <TagPanel tags={tags.filter((t) => t.distance_m === null)} />

        {ranged.length > 0 && (
          <>
            <h2 className="sectionhead">Ranged tags &middot; {ranged.length}</h2>
            <RangedTagPanel tags={ranged} />
          </>
        )}

        <footer className="foot">
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : "Loading…"}
          <br />
          Refreshing every {REFRESH_MS / 1000}s
        </footer>
      </aside>

      <section className="map">
        {located.length === 0 && !anchor ? (
          <div className="mapstub">
            <h2>Nothing has a position yet</h2>
            <p>
              The map centres on the gateway, and plots devices once they have a
              fix. Nothing is reporting coordinates yet — GPS devices need clear
              sky view. They are still transmitting; their status is listed on
              the left.
            </p>
          </div>
        ) : (
          <TagMap
            tags={located}
            ranged={ranged.filter(isRanged)}
            gateway={anchor}
          />
        )}
      </section>
    </main>
  );
}
