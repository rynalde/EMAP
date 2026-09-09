import { load } from "cheerio";
import { BERTHS } from "./port-data";
import type { Vessel, VesselStatus } from "./types";
export function parsePortDate(text: string) {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return "";
  return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2]}-${m[1]}T00:00:00-03:00`;
}
export function parsePortHtml(html: string, now = Date.now()): Vessel[] {
  const $ = load(html),
    vessels: Vessel[] = [];
  for (const [section, status] of [
    ["atracados", "atracado"],
    ["fundeados", "fundeado"],
    ["esperados", "esperado"],
  ] as const) {
    $(`#${section} tr`).each((_, row) => {
      const cells = $(row)
        .find("td")
        .map((_, el) => $(el).text().trim())
        .get();
      if (cells.length < 10) return;
      const berthed = status === "atracado",
        offset = berthed ? 1 : 0;
      const imo = cells[offset];
      if (!/^\d{7}$/.test(imo)) return;
      const berth = berthed
        ? String(Number(cells[0].replace(/\D/g, "")))
        : undefined;
      const place = BERTHS.find((p) => p.id === berth);
      const updatedAt = parsePortDate(cells[cells.length - 1]);
      const stale =
        !updatedAt || now - new Date(updatedAt).getTime() > 7 * 86400000;
      vessels.push({
        id: `emap-${imo}-${status}`,
        imo,
        name: cells[offset + 1],
        status: status as VesselStatus,
        berth,
        length: Number(cells[berthed ? 4 : 3].replace(",", ".")),
        cargo: cells[berthed ? 6 : 5],
        quantity: cells[berthed ? 7 : 6],
        draft: cells[berthed ? 8 : 7],
        agency: cells[berthed ? 9 : 8],
        eta: status === "esperado" ? parsePortDate(cells[9]) : undefined,
        updatedAt,
        stale,
        coordinates: place && !stale ? place.coordinates : undefined,
        heading: place?.heading,
        positionSource: place && !stale ? "berth" : "none",
      });
    });
  }
  return vessels;
}
export function parsePortLinks(html: string) {
  const $ = load(html);
  return $("#porto-agora a")
    .map((_, el) => ({
      label: $(el).find("img").attr("alt") || $(el).text().trim(),
      url: $(el).attr("href") || "",
    }))
    .get()
    .filter(
      (x) =>
        x.url.startsWith("https://www.portodoitaqui.com/") &&
        x.url.includes(".pdf"),
    );
}
