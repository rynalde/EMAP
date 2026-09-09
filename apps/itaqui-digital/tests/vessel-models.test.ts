import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  getVesselModelInfo,
  hasVesselModelPosition,
} from "../src/lib/vessel-model-info";
import type { Vessel } from "../src/lib/types";

const vessel: Vessel = {
  id: "test",
  name: "SHIP",
  status: "atracado",
  updatedAt: "2026-09-05T15:00:00Z",
  positionSource: "ais",
  coordinates: [-44.37, -2.577],
};

test("ship symbols distinguish inferred cargo, unknown class and reported length", () => {
  assert.equal(
    getVesselModelInfo({ ...vessel, cargo: "ÓLEO DIESEL" }).kind,
    "tanker",
  );
  assert.equal(
    getVesselModelInfo({ ...vessel, cargo: "FERTILIZANTE" }).kind,
    "bulk",
  );
  assert.equal(getVesselModelInfo({ ...vessel, cargo: "SOJA" }).kind, "bulk");
  assert.equal(
    getVesselModelInfo({ ...vessel, cargo: "CONTÊINER" }).kind,
    "cargo",
  );
  assert.equal(getVesselModelInfo(vessel).kind, "generic");
  assert.equal(getVesselModelInfo(vessel).inferredFromCargo, false);
  assert.equal(getVesselModelInfo(vessel).lengthSource, "symbolic");
  const known = getVesselModelInfo({ ...vessel, length: 229, heading: 350 });
  assert.equal(known.lengthSource, "reported");
  assert.equal(known.lengthMeters, 229);
  assert.equal(known.headingDegrees, 350);
  for (const length of [-1, 0, NaN, Infinity, 999])
    assert.equal(
      getVesselModelInfo({ ...vessel, length }).lengthSource,
      "symbolic",
    );
  assert.equal(
    getVesselModelInfo({ ...vessel, heading: 511 }).headingKnown,
    false,
  );
});

test("models never acquire positions for stale, unlocated or invalid reports", () => {
  assert.equal(hasVesselModelPosition(vessel), true);
  assert.equal(hasVesselModelPosition({ ...vessel, stale: true }), false);
  assert.equal(
    hasVesselModelPosition({ ...vessel, positionSource: "none" }),
    false,
  );
  assert.equal(
    hasVesselModelPosition({ ...vessel, coordinates: undefined }),
    false,
  );
  assert.equal(
    hasVesselModelPosition({ ...vessel, coordinates: [NaN, -2.57] }),
    false,
  );
  assert.equal(
    hasVesselModelPosition({ ...vessel, coordinates: [-44.37, 91] }),
    false,
  );
  assert.deepEqual(vessel.coordinates, [-44.37, -2.577]);
});

test("bundled CC0 ship GLBs contain triangle meshes and resolve their local textures", () => {
  const root = new URL("../public/models/kenney-watercraft/", import.meta.url);
  assert.match(
    readFileSync(new URL("License.txt", root), "utf8"),
    /Creative Commons Zero, CC0/,
  );
  for (const file of [
    "ship-cargo-a.glb",
    "ship-cargo-b.glb",
    "ship-cargo-c.glb",
    "boat-tug-a.glb",
  ]) {
    const bytes = readFileSync(new URL(file, root));
    assert.equal(bytes.toString("ascii", 0, 4), "glTF");
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const data = JSON.parse(
      bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
    );
    assert.ok(data.meshes.length > 0);
    for (const image of data.images ?? [])
      if (image.uri) {
        assert.ok(!image.uri.includes(":") && !image.uri.includes(".."));
        assert.ok(
          existsSync(new URL(image.uri, root)),
          `${file} needs ${image.uri}`,
        );
      }
    const triangles = data.meshes
      .flatMap((m: { primitives: { indices?: number }[] }) => m.primitives)
      .reduce(
        (sum: number, p: { indices?: number }) =>
          sum +
          (p.indices === undefined ? 0 : data.accessors[p.indices].count / 3),
        0,
      );
    assert.ok(
      triangles > 0 && triangles < 5000,
      `${file}: ${triangles} triangles`,
    );
  }
});
