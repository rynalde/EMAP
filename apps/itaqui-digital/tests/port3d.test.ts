import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FeatureCollection, Geometry } from "geojson";
import {
  headingToRotationY,
  headingVector,
  orientedBox,
  pointInPolygon,
  project,
  unproject,
} from "../src/lib/port3d/geo";
import {
  berthLayouts,
  berthedVessels,
  landRing,
  shipPose,
} from "../src/lib/port3d/layout";
import type { Vessel } from "../src/lib/types";

const cartography = JSON.parse(
  readFileSync("public/data/port-cartography.geojson", "utf8"),
) as FeatureCollection<Geometry>;

test("local projection keeps metres, east on +x and north on -z", () => {
  const origin = project([-44.3668, -2.5757]);
  assert.ok(Math.abs(origin.x) < 1e-9 && Math.abs(origin.z) < 1e-9);
  const east = project([-44.3658, -2.5757]),
    north = project([-44.3668, -2.5747]);
  assert.ok(Math.abs(east.x - 111.2) < 1, `1 mdeg lon ≈ 111 m, got ${east.x}`);
  assert.ok(
    Math.abs(north.z + 110.6) < 1,
    `1 mdeg lat ≈ 111 m, got ${north.z}`,
  );
  const back = unproject(project([-44.3701, -2.5779]));
  assert.ok(Math.abs(back[0] + 44.3701) < 1e-9);
  assert.ok(Math.abs(back[1] + 2.5779) < 1e-9);
});

test("heading rotation turns the model's +X axis onto the heading", () => {
  for (const heading of [0, 90, 305, 326, 350]) {
    const a = headingToRotationY(heading),
      v = headingVector(heading);
    // Rotação de three.js em Y: (1, 0, 0) -> (cos a, 0, -sin a).
    assert.ok(Math.abs(Math.cos(a) - v.x) < 1e-9);
    assert.ok(Math.abs(-Math.sin(a) - v.z) < 1e-9);
  }
});

test("oriented box recovers a rotated rectangle", () => {
  const angle = 0.4,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const ring = [
    [-50, -10],
    [50, -10],
    [50, 10],
    [-50, 10],
  ].map(([u, v]) => ({ x: 300 + u * c - v * s, z: -200 + u * s + v * c }));
  const box = orientedBox(ring);
  assert.ok(Math.abs(box.length - 100) < 1e-6);
  assert.ok(Math.abs(box.width - 20) < 1e-6);
  assert.ok(Math.abs(box.cx - 300) < 1e-6 && Math.abs(box.cz + 200) < 1e-6);
});

test("berths line up with the OSM quay face and ships stay in the water", () => {
  const land = landRing(cartography);
  assert.ok(land.length > 50, "coastline is closed into a land ring");
  const berths = berthLayouts(land);
  assert.equal(berths.length, 9);
  // O centro do 99 fica ao sul do fim do píer no OSM e o píer do 108 ainda não está
  // mapeado; os demais encostam na costa mapeada.
  assert.deepEqual(
    berths.filter((b) => !b.onCoast).map((b) => b.id),
    ["99", "108"],
  );
  for (const b of berths) {
    if (b.onCoast) {
      const quayDistance = Math.hypot(
        b.quay.x - b.center.x,
        b.quay.z - b.center.z,
      );
      assert.ok(
        quayDistance > 5 && quayDistance < 70,
        `${b.id}: ${quayDistance}`,
      );
    } else {
      // Sem costa mapeada, a face continua a do vizinho de mesmo rumo (100 e 106).
      const n = berths.find(
        (x) => x.onCoast && x.heading === b.heading && x.id !== b.id,
      )!;
      const offLine =
        (b.quay.x - n.quay.x) * n.normal.x + (b.quay.z - n.quay.z) * n.normal.z;
      assert.ok(Math.abs(offLine) < 1e-6, `${b.id} continues ${n.id}`);
    }
    assert.ok(!pointInPolygon(b.center, land), `${b.id} center is at sea`);
    const pose = shipPose(b, 32);
    assert.ok(
      !pointInPolygon({ x: pose.x, z: pose.z }, land),
      `${b.id} ship at sea`,
    );
    const gap = Math.hypot(pose.x - b.quay.x, pose.z - b.quay.z) - 16;
    assert.ok(Math.abs(gap - 2.5) < 1e-6, `${b.id} fender gap`);
  }
});

test("only fresh EMAP berth assignments get a 3D ship", () => {
  const base: Vessel = {
    id: "a",
    name: "A",
    status: "atracado",
    berth: "103",
    updatedAt: "2026-09-05T00:00:00Z",
    positionSource: "berth",
  };
  const map = berthedVessels([
    base,
    { ...base, id: "dup", name: "DUPLICATE" },
    { ...base, id: "old", berth: "101", stale: true },
    { ...base, id: "none", berth: "102", positionSource: "none" },
    { ...base, id: "anch", berth: "104", status: "fundeado" },
    { ...base, id: "unk", berth: "777" },
    { ...base, id: "ok", name: "B", berth: "106" },
  ]);
  assert.deepEqual([...map.keys()].sort(), ["103", "106"]);
  assert.equal(map.get("103")?.name, "A");
});

test("satellite-derived structures stand on land and reference real berths", async () => {
  const { REFERENCE } = await import("../src/lib/port3d/reference");
  const { BERTHS } = await import("../src/lib/port-data");
  const land = landRing(cartography);
  assert.ok(REFERENCE.tanks.length > 100, "tank farms were digitised");
  for (const t of REFERENCE.tanks) {
    assert.ok(t.r >= 3 && t.r <= 32, `tank radius ${t.r}`);
    assert.ok(["white", "beige", "rust", "gray", "water"].includes(t.kind));
    assert.ok(pointInPolygon(project([t.lon, t.lat]), land), "tank on land");
  }
  for (const b of REFERENCE.buildings) {
    assert.ok(b.length >= b.width && b.width > 2, `${b.id} dimensions`);
    assert.ok(pointInPolygon(project([b.lon, b.lat]), land), `${b.id} on land`);
  }
  const ids = new Set(BERTHS.map((b) => b.id));
  for (const j of REFERENCE.jetties)
    assert.ok(
      j.berths.every((id) => ids.has(id)),
      "jetty berths exist",
    );
  assert.match(REFERENCE.source.captured, /^\d{4}-\d{2}-\d{2}$/);
});

test("road smoothing keeps ends and junctions and builds upward-facing strips", async () => {
  const { smooth, junctionNodes, FlatMesh, stations } =
    await import("../src/lib/port3d/roads");
  const a = [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 50, z: 50 },
    { x: 100, z: 50 },
  ];
  const b = [
    { x: 50, z: 50 },
    { x: 50, z: 120 },
  ];
  const fixed = junctionNodes([a, b]);
  const s = smooth(a, fixed);
  assert.deepEqual(s[0], a[0]);
  assert.deepEqual(s[s.length - 1], a[3]);
  // O nó compartilhado com a outra via não se move; a curva no (50, 0) é arredondada.
  assert.ok(s.some((p) => p.x === 50 && p.z === 50));
  assert.ok(!s.some((p) => p.x === 50 && p.z === 0));
  const mesh = new FlatMesh();
  mesh.strip(s, 8, 3);
  const g = mesh.geometry();
  const n = g.getAttribute("normal");
  for (let i = 0; i < n.count; i++) assert.ok(n.getY(i) > 0.99, "faces up");
  const marks = [...stations(s, 10, 5)];
  assert.ok(marks.length >= 12 && marks.length <= 16, `${marks.length} marks`);
});

test("tour easing is continuous, monotonic and ends where it starts moving", async () => {
  const { tourEase } = await import("../src/lib/port3d/geo");
  assert.equal(tourEase(0), 0);
  assert.equal(tourEase(1), 1);
  let prev = 0,
    maxStep = 0;
  const n = 1500;
  for (let i = 1; i <= n; i++) {
    const e = tourEase(i / n);
    assert.ok(e >= prev, "monotonic");
    maxStep = Math.max(maxStep, e - prev);
    prev = e;
  }
  // Nenhum quadro avança mais que a velocidade de cruzeiro (sem saltos).
  assert.ok(maxStep <= (1 / n / (1 - 0.06)) * 1.001, `step ${maxStep}`);
});
