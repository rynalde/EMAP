import { readFileSync, writeFileSync } from "node:fs";
import { parsePortHtml, parsePortLinks } from "../src/lib/port-parser";
const [vesselsHtml, homeHtml] = process.argv.slice(2);
if (!vesselsHtml || !homeHtml)
  throw new Error(
    "Uso: npx tsx scripts/capture-snapshot.ts navios.html home.html",
  );
writeFileSync(
  "src/data/port-snapshot.json",
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      source: "https://www.portodoitaqui.com.br/porto-agora/navios/atracados",
      vessels: parsePortHtml(readFileSync(vesselsHtml, "utf8")),
      links: parsePortLinks(readFileSync(homeHtml, "utf8")),
    },
    null,
    2,
  ),
);
