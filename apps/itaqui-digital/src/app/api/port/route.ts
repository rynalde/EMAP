import { parsePortHtml, parsePortLinks } from "@/lib/port-parser";
import snapshot from "@/data/port-snapshot.json";
export const runtime = "nodejs";
export async function GET() {
  const source =
    "https://www.portodoitaqui.com.br/porto-agora/navios/atracados";
  const results = await Promise.allSettled([
    fetch(source, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(12000),
    }).then(async (r) => {
      if (!r.ok) throw Error("EMAP indisponível");
      const vessels = parsePortHtml(await r.text());
      if (!vessels.length) throw Error("Formato da programação alterado");
      return vessels;
    }),
    fetch("https://website.portodoitaqui.com.br/home", {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(12000),
    }).then(async (r) => (r.ok ? parsePortLinks(await r.text()) : [])),
  ]);
  const vessels =
    results[0].status === "fulfilled"
      ? results[0].value
      : snapshot.vessels.map((v) => ({
          ...v,
          stale: true,
          coordinates: undefined,
          positionSource: "none",
        }));
  return Response.json({
    vessels,
    source,
    stale: results[0].status === "rejected",
    fetchedAt:
      results[0].status === "fulfilled"
        ? new Date().toISOString()
        : snapshot.fetchedAt,
    links:
      results[1].status === "fulfilled" && results[1].value.length
        ? results[1].value
        : snapshot.links,
    error:
      results[0].status === "rejected"
        ? "EMAP indisponível. Exibindo uma consulta arquivada; posições ocultas."
        : undefined,
  });
}
