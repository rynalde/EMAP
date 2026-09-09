# Tag map (Next.js)

Live map of tag positions, read from Supabase. Next.js App Router + React Leaflet
with OpenStreetMap tiles — **no map API key required**.

This sits alongside `dashboard/` (Vite + React), which shows the same data as
tables. Both read the same `latest_positions` view; neither writes.

## Setup

```bash
cp .env.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same anon key the Vite dashboard uses —
public by design in this MVP).

```bash
bun install
```

```bash
bun run dev
```

Port 3000 may already be taken by another project; use `PORT=3100 bun run dev`.

## What it shows

The sidebar lists **every** tag, the map plots only those with a position.

That split is deliberate. Tags transmit on every interval whether or not they
have a satellite fix, reporting a `status` instead of a fabricated coordinate —
see `docs/packet-format.md`. A tag sitting indoors is working correctly and
still reporting; dropping it from the UI because `lat`/`lng` are `null` would
make a healthy device look identical to a dead one.

| `status` | Marker | Meaning |
| --- | --- | --- |
| `fix` | green | Live position |
| `stale` | amber | Fix aged out; last known position |
| `acquiring` | grey | Receiver alive, no fix yet — list only |
| `no_gps` | red | No data from the receiver at all — list only |

Markers carry RSSI, SNR, satellite count, HDOP and battery in a popup. The view
refreshes every 5 s, roughly matching the tags' 3 s transmit interval.

## Notes

* Leaflet is loaded via `next/dynamic` with `ssr: false` — it touches `window`
  at import time and cannot be server-rendered.
* Markers are `divIcon`s rather than Leaflet's default image marker, whose asset
  URLs break under bundlers, and it lets the pin carry the status colour.
