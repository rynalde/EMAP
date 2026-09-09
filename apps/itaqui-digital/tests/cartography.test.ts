import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  featureBounds,
  featureCenter,
  featureAttributes,
  searchText,
  type CartographyData,
} from "../src/lib/cartography";
const data = JSON.parse(
  readFileSync(
    new URL("../public/data/port-cartography.geojson", import.meta.url),
    "utf8",
  ),
) as CartographyData;
const metadata = JSON.parse(
  readFileSync(
    new URL("../public/data/port-cartography-meta.json", import.meta.url),
    "utf8",
  ),
);
test("published cartography retains source identity, valid geometry and consistent category totals", () => {
  assert.ok(data.features.length > 0);
  assert.equal(metadata.boundary.id, "osm-relation-10189309");
  assert.ok(
    !data.features.some(
      (f) =>
        f.properties.id === "osm-relation-10189307" ||
        f.properties.id === "osm-relation-20125198",
    ),
  );
  assert.equal(
    new Set(data.features.map((f) => f.id)).size,
    data.features.length,
  );
  const counts: Record<string, number> = {
    building: 0,
    road: 0,
    railway: 0,
    area: 0,
    pier: 0,
    water: 0,
  };
  for (const f of data.features) {
    assert.equal(f.id, f.properties.id);
    assert.match(
      f.properties.sourceUrl,
      /^https:\/\/www\.openstreetmap\.org\/(way|relation|node)\/\d+$/,
    );
    const [[west, south], [east, north]] = featureBounds(f);
    assert.ok([west, south, east, north].every(Number.isFinite));
    assert.ok(west <= east && south <= north);
    assert.ok(west >= -45 && east <= -43 && south >= -4 && north <= -1);
    if (f.geometry.type === "Polygon")
      for (const ring of f.geometry.coordinates)
        assert.deepEqual(ring[0], ring.at(-1));
    counts[f.properties.category] = (counts[f.properties.category] ?? 0) + 1;
    const center = featureCenter(f);
    assert.ok(
      center[0] >= west &&
        center[0] <= east &&
        center[1] >= south &&
        center[1] <= north,
    );
  }
  assert.deepEqual(counts, metadata.counts);
});
test("cartographic search ignores accents and details retain measured/source attributes", () => {
  assert.equal(searchText("ÁREA de Armazenagem"), "area de armazenagem");
  const building = data.features.find(
    (f) => f.properties.category === "building" && f.properties.areaM2,
  )!;
  assert.ok(
    featureAttributes(building).some(
      (a) => a.label === "Área do contorno" && a.value.endsWith("m²"),
    ),
  );
});
