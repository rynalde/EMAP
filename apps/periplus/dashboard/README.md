# Dashboard — minimal latest positions view

A tiny React + Vite app that reads from Supabase and shows:

* **Latest device positions** (`latest_positions` view — every link, tags and
  gateways alike)
* **Recent readings** (`readings`, last 25)

Both tables auto-refresh every 10 seconds. A map is intentionally out of scope
for the MVP — table first.

## Setup

```bash
cd dashboard
cp ../.env.example .env       # fill in VITE_SUPABASE_ANON_KEY
npm install                   # or: bun install
npm run dev
```

Vite needs the `VITE_`-prefixed variables:

```env
VITE_SUPABASE_URL=https://lvvulorcvuxuyrnumfay.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
```

Open http://localhost:5173.

## Notes

* The anon key is safe to ship to the browser — RLS allows **read-only** access
  to the `lora_*` tables/view, and writes only happen via the gateway-key RPC.
* If you see "No tags yet", run the bridge (real or mock) to push a packet, or
  run `supabase/seed.sql`.

## Build

```bash
npm run build      # outputs to dist/
npm run preview
```
