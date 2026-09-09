import { LatestPositionsTable } from "./components/LatestPositionsTable.tsx";
import { ReadingsTable } from "./components/ReadingsTable.tsx";

export function App() {
  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: 1100,
        margin: "0 auto",
        padding: "1.5rem",
        color: "#1a1a1a",
      }}
    >
      <header>
        <h1>periplus</h1>
        <p style={{ color: "#666" }}>
          Live view of <code>latest_positions</code> and <code>readings</code> —
          LoRa, BLE ranging and cellular in one table. Auto-refreshes every 10s.
        </p>
      </header>

      <LatestPositionsTable />
      <ReadingsTable />

      <style>{`
        section { margin-top: 2rem; }
        h2 { font-size: 1.1rem; border-bottom: 2px solid #eee; padding-bottom: .3rem; }
        table { border-collapse: collapse; width: 100%; font-size: .9rem; }
        th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #eee; }
        th { background: #fafafa; font-weight: 600; }
        tr:hover td { background: #f6f9ff; }
        code { background: #f2f2f2; padding: .1rem .3rem; border-radius: 4px; }
        .error { color: #b00020; }
      `}</style>
    </main>
  );
}
