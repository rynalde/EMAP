import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { PLACES } from "@/lib/port-data";
import type { Place, Vessel } from "@/lib/types";
import { getVesselModelInfo } from "@/lib/vessel-model-info";
import {
  distanceToPolyline,
  headingToRotationY,
  headingVector,
  orientedBox,
  pointInPolygon,
  polygonArea,
  polylineLength,
  project,
  sampleAlong,
  type XZ,
} from "./geo";
import {
  Batch,
  C,
  CONTAINER_COLORS,
  createMaterials,
  rng,
  type Frame,
} from "./kit";
import {
  GROUND,
  berthLayouts,
  berthedVessels,
  boundaryRing,
  landRing,
  shipPose,
  type BerthLayout,
} from "./layout";
import * as M from "./models";

export type SceneSelection =
  | {
      type: "vessel";
      vessel: Vessel;
      berth: BerthLayout;
      modelLabel: string;
      lengthSource: "reported" | "symbolic";
    }
  | { type: "illustrative"; berth: BerthLayout; modelLabel: string }
  | { type: "berth"; berth: BerthLayout; vessel?: Vessel }
  | { type: "place"; place: Place };

export type PortSceneInput = {
  boundary: Feature<Geometry>;
  cartography: FeatureCollection<Geometry>;
};

export type PortSceneEvents = {
  onSelect?: (selection: SceneSelection | null) => void;
};

export type PortSceneController = {
  setVessels(vessels: Vessel[], illustrativeFill: boolean): number;
  focus(target: "home" | string): void;
  setAutoRotate(on: boolean): void;
  setLabels(on: boolean): void;
  dispose(): void;
};

/** Equipamentos de cais por berço: composição ilustrativa coerente com o tipo de carga. */
const QUAY_EQUIPMENT: Record<string, ("mhc" | "portal" | "loader" | "arms")[]> =
  {
    "99": ["mhc", "mhc"],
    "100": ["mhc", "portal", "mhc"],
    "101": ["portal", "portal"],
    "102": ["portal", "mhc"],
    "103": ["loader", "loader"],
    "104": ["arms"],
    "105": ["portal", "loader"],
    "106": ["arms", "arms"],
    "108": ["arms", "arms"],
  };

const ILLUSTRATIVE_KIND: Record<string, M.ShipKind> = {
  "99": "cargo",
  "100": "cargo",
  "101": "generic",
  "102": "bulk",
  "103": "bulk",
  "104": "tanker",
  "105": "bulk",
  "106": "tanker",
  "108": "tanker",
};

const KIND_LABEL: Record<M.ShipKind, string> = {
  bulk: "Graneleiro",
  tanker: "Navio-tanque",
  cargo: "Porta-contêineres / carga geral",
  tug: "Rebocador",
  generic: "Carga geral",
};

type Line = XZ[];

function lines(geometry: Geometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

/** Interseção de um segmento com um retângulo expandido (Liang–Barsky), em coordenadas locais. */
function segmentHitsRect(
  a: XZ,
  b: XZ,
  cx: number,
  cz: number,
  cos: number,
  sin: number,
  hu: number,
  hv: number,
) {
  const toLocal = (p: XZ) => {
    const dx = p.x - cx,
      dz = p.z - cz;
    return [dx * cos + dz * sin, -dx * sin + dz * cos];
  };
  const [ax, az] = toLocal(a),
    [bx, bz] = toLocal(b);
  let t0 = 0,
    t1 = 1;
  const dx = bx - ax,
    dz = bz - az;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, ax + hu) &&
    clip(dx, hu - ax) &&
    clip(-dz, az + hv) &&
    clip(dz, hv - az)
  );
}

export function createPortScene(
  host: HTMLElement,
  input: PortSceneInput,
  events: PortSceneEvents = {},
): PortSceneController {
  performance.mark("port3d:start");
  const small = Math.min(host.clientWidth, host.clientHeight) < 700;
  const reducedMotion =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Renderizador, câmera e luzes ----------
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.domElement.className = "port3d-canvas";
  host.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(host.clientWidth, host.clientHeight);
  labelRenderer.domElement.className = "port3d-labels";
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const horizon = new THREE.Color("#dcebf1");
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(horizon, 2600, 7500);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(
    fovFor(host.clientWidth / host.clientHeight),
    host.clientWidth / host.clientHeight,
    2,
    12000,
  );
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.36;
  controls.minDistance = 45;
  controls.maxDistance = 3400;
  controls.screenSpacePanning = false;
  controls.autoRotateSpeed = 0.35;

  scene.add(new THREE.HemisphereLight("#e2eefa", "#8c8e84", 0.95));
  const sun = new THREE.DirectionalLight("#fff0d6", 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
  const sc = sun.shadow.camera;
  sc.left = -1500;
  sc.right = 1500;
  sc.top = 1500;
  sc.bottom = -1500;
  sc.near = 100;
  sc.far = 5000;
  sc.updateProjectionMatrix();
  scene.add(sun, sun.target);

  const materials = createMaterials();
  const disposables: { dispose(): void }[] = [
    materials.solid,
    materials.glass,
    materials.glow,
    envTexture,
    pmrem,
  ];

  // ---------- Geometria de referência ----------
  const land = landRing(input.cartography);
  const harbour = boundaryRing(input.boundary);
  const berths = berthLayouts(land);
  const center = harbour.reduce(
    (acc, p) => ({
      x: acc.x + p.x / harbour.length,
      z: acc.z + p.z / harbour.length,
    }),
    { x: 0, z: 0 },
  );
  // Sol a noroeste, a ~45°: as sombras caem para o lado da câmera e dão volume à cena.
  sun.position.set(center.x - 1150, 1700, center.z - 1250);
  sun.target.position.set(center.x, 0, center.z);

  const roads: { line: Line; width: number; kind: string }[] = [];
  const rails: Line[] = [];
  const buildings: XZ[][] = [];
  const tanks: XZ[][] = [];
  for (const f of input.cartography.features) {
    const kind = String(f.properties?.kind ?? ""),
      category = String(f.properties?.category ?? "");
    if (category === "road")
      for (const l of lines(f.geometry))
        roads.push({
          line: l.map(project),
          kind,
          width:
            kind === "tertiary" || kind === "tertiary_link"
              ? 11
              : kind === "unclassified"
                ? 8.5
                : 6.5,
        });
    else if (category === "railway")
      for (const l of lines(f.geometry)) rails.push(l.map(project));
    else if (category === "building" && f.geometry.type === "Polygon") {
      const ring = f.geometry.coordinates[0].map(project);
      (kind === "storage_tank" ? tanks : buildings).push(ring);
    }
  }

  const statics = new Batch();
  const root = statics.frame();
  const g = root.sub(0, GROUND, 0);
  const r = rng(20260926);

  // ---------- Água ----------
  const waterUniforms = { uTime: { value: 0 } };
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: C.water,
    roughness: 0.32,
    metalness: 0.08,
    flatShading: true,
  });
  waterMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float w = sin(position.x * 0.045 + uTime * 0.8) * 0.35
          + cos(position.y * 0.052 - uTime * 0.6) * 0.3
          + sin((position.x + position.y) * 0.12 + uTime * 1.5) * 0.12;
        transformed.z += w;`,
      );
  };
  const waterGeometry = new THREE.PlaneGeometry(7000, 7000, 150, 150);
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.set(center.x - 600, 0, center.z);
  waterMaterial.vertexColors = true;
  waterMaterial.color.set("#ffffff");
  {
    // Água mais clara junto ao cais e variação sutil entre as facetas.
    const pos = waterGeometry.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const deep = new THREE.Color(C.water),
      shallow = new THREE.Color("#3ea3e4"),
      tint = new THREE.Color();
    const wr = rng(5);
    for (let i = 0; i < pos.count; i++) {
      const p = {
        x: pos.getX(i) + water.position.x,
        z: -pos.getY(i) + water.position.z,
      };
      const d = land.length ? distanceToPolyline(p, land) : 1000;
      const k = Math.min(1, d / 220);
      tint
        .lerpColors(shallow, deep, k * k * (3 - 2 * k))
        .multiplyScalar(0.96 + wr() * 0.08);
      colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    waterGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  water.receiveShadow = true;
  const farGeometry = new THREE.PlaneGeometry(40000, 40000);
  const farMaterial = new THREE.MeshStandardMaterial({
    color: C.water,
    roughness: 0.5,
  });
  const farWater = new THREE.Mesh(farGeometry, farMaterial);
  farWater.rotation.x = -Math.PI / 2;
  farWater.position.y = -0.6;
  scene.add(water, farWater);
  disposables.push(waterGeometry, waterMaterial, farGeometry, farMaterial);

  // ---------- Terreno ----------
  let landTop: THREE.Mesh | null = null;
  if (land.length > 2) {
    const shape = new THREE.Shape(
      land.map((p) => new THREE.Vector2(p.x, -p.z)),
    );
    const walls = new THREE.ExtrudeGeometry(shape, {
      depth: GROUND + 6 - 0.05,
      bevelEnabled: false,
    })
      .rotateX(-Math.PI / 2)
      .translate(0, -6, 0);
    statics.addGeometry(walls, C.quayWall);
    walls.dispose();

    const top = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const tex = groundTexture(harbour, small ? 2048 : 4096);
    const pos = top.getAttribute("position");
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - tex.minX) / tex.width;
      uv[i * 2 + 1] = 1 - (pos.getZ(i) - tex.minZ) / tex.height;
    }
    top.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    top.translate(0, GROUND, 0);
    const topMaterial = new THREE.MeshStandardMaterial({
      map: tex.texture,
      roughness: 0.95,
    });
    landTop = new THREE.Mesh(top, topMaterial);
    landTop.receiveShadow = true;
    scene.add(landTop);
    disposables.push(top, topMaterial, tex.texture);
  }

  // ---------- Cais: aventais, faixas de borda, defensas e cabeços ----------
  const quayLines: Line[] = [];
  for (const b of berths) {
    const ry = headingToRotationY(b.heading);
    const L = b.length + 36;
    const apron = 32;
    const f = root.sub(
      b.quay.x + (b.normal.x * apron) / 2,
      0,
      b.quay.z + (b.normal.z * apron) / 2,
      ry,
    );
    // Laje sobre estacas/paredão: corpo escuro e capa de concreto.
    f.box(L, GROUND + 6 - 0.45, apron, C.quayWall, 0, -6, 0);
    f.box(L, 0.42, apron, C.concreteLight, 0, GROUND - 0.45, 0);
    const edge = f.sub(0, GROUND, -apron / 2); // face do cais em z local = -apron/2
    for (let x = -L / 2 + 1; x < L / 2 - 1; x += 2.4)
      edge.box(
        1.2,
        0.35,
        0.6,
        Math.round(x / 2.4) % 2 ? C.black : C.markingYellow,
        x,
        0,
        0.5,
      );
    for (let x = -L / 2 + 8; x < L / 2 - 4; x += 18) {
      M.bollard(edge, x, 2.2);
      edge.box(3.2, 2.6, 1, C.black, x, -3.2, -0.45);
    }
    // Trilhos dos guindastes e faixa de rolamento.
    edge.box(L, 0.08, 0.35, C.rail, 0, 0.02, 4);
    edge.box(L, 0.08, 0.35, C.rail, 0, 0.02, 14);
    edge.box(L, 0.04, 0.3, C.marking, 0, 0.02, 21);
    for (let x = -L / 2 + 20; x < L / 2 - 10; x += 55)
      M.lightPole(edge, x, 27, 24);
    quayLines.push([
      { x: b.quay.x - b.along.x * (L / 2), z: b.quay.z - b.along.z * (L / 2) },
      { x: b.quay.x + b.along.x * (L / 2), z: b.quay.z + b.along.z * (L / 2) },
    ]);

    // Equipamentos: lado do mar do referencial local (+X) voltado para o navio.
    const seaward = Math.atan2(b.normal.z, -b.normal.x);
    const kit = QUAY_EQUIPMENT[b.id] ?? [];
    kit.forEach((item, i) => {
      const t =
        (i - (kit.length - 1) / 2) * Math.min(90, b.length / kit.length);
      const p = {
        x: b.quay.x + b.along.x * t + b.normal.x * 9,
        z: b.quay.z + b.along.z * t + b.normal.z * 9,
      };
      const e = root.sub(p.x, GROUND, p.z, seaward);
      const slew = (r() - 0.5) * 0.9;
      if (item === "mhc")
        M.mobileHarborCrane(
          e,
          [C.yellow, C.green, C.blue][i % 3],
          slew,
          0.5 + r() * 0.25,
        );
      else if (item === "portal")
        M.portalCrane(
          e,
          [C.green, C.yellow, C.white][(i + Number(b.id)) % 3],
          slew,
        );
      else if (item === "loader") M.shipLoader(e.sub(-6, 0, 0), C.yellow);
      else M.loadingArms(e, 3);
    });
  }

  // ---------- Vias e ferrovias do OSM ----------
  const ribbon = (
    line: Line,
    width: number,
    height: number,
    color: string,
    y = 0,
    extend = true,
  ) => {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.2) continue;
      const f = g.sub(
        (a.x + b.x) / 2,
        y,
        (a.z + b.z) / 2,
        Math.atan2(-(b.z - a.z), b.x - a.x),
      );
      f.box(len + (extend ? width * 0.9 : 0), height, width, color);
    }
  };
  for (const road of roads) {
    ribbon(road.line, road.width, 0.1, C.asphalt, 0.01);
    if (road.width >= 8.5) {
      const total = polylineLength(road.line);
      for (let d = 4; d < total - 4; d += 10) {
        const s = sampleAlong(road.line, d);
        g.sub(s.x, 0.11, s.z, s.angle).box(4, 0.03, 0.3, C.marking);
      }
    }
  }
  for (const rail of rails) {
    ribbon(rail, 3.6, 0.3, C.ballast, 0.02);
    const total = polylineLength(rail);
    for (let d = 1; d < total; d += 3.2) {
      const s = sampleAlong(rail, d);
      g.sub(s.x, 0.32, s.z, s.angle).box(0.6, 0.12, 2.6, C.sleeper);
    }
    for (const off of [-0.72, 0.72]) {
      const shifted = offsetLine(rail, off);
      ribbon(shifted, 0.16, 0.22, C.rail, 0.44, false);
    }
  }

  // ---------- Edificações do OSM ----------
  const obstacles: { c: XZ; radius: number }[] = [];
  for (const ring of buildings) {
    const box = orientedBox(ring);
    const f = g.sub(box.cx, 0, box.cz, box.angle);
    const area = polygonArea(ring);
    if (area > 4000)
      M.gableWarehouse(f, box.length, box.width, 14, C.white, C.wallBlue);
    else if (area > 800) M.office(f, box.length, box.width, 3);
    else M.office(f, box.length, box.width, 1, C.red);
    obstacles.push({
      c: { x: box.cx, z: box.cz },
      radius: Math.hypot(box.length, box.width) / 2,
    });
  }
  for (const ring of tanks) {
    const c = ring.reduce(
      (a, p) => ({ x: a.x + p.x / ring.length, z: a.z + p.z / ring.length }),
      { x: 0, z: 0 },
    );
    const radius = Math.sqrt(polygonArea(ring) / Math.PI);
    M.storageTank(g.sub(c.x, 0, c.z), radius, radius * 1.1);
    obstacles.push({ c, radius: radius + 6 });
  }

  // ---------- Correia do TEGRAM e dutos até os píeres de líquidos (traçados ilustrativos) ----------
  const place = (id: string) =>
    project(PLACES.find((p) => p.id === id)!.coordinates);
  const berth = (id: string) => berths.find((b) => b.id === id)!;
  const inland = (b: BerthLayout, d: number, t = 0): XZ => ({
    x: b.quay.x + b.normal.x * d + b.along.x * t,
    z: b.quay.z + b.normal.z * d + b.along.z * t,
  });
  const extraCorridors: Line[] = [];
  const tegram = place("tegram"),
    liquids = place("liquidos");
  const b103 = berth("103"),
    b104 = berth("104"),
    b105 = berth("105"),
    b106 = berth("106"),
    b108 = berth("108");
  const conveyorPath: Line = [
    { x: tegram.x - 40, z: tegram.z + 60 },
    { x: tegram.x - 160, z: tegram.z + 520 },
    inland(b103, 24, 45),
  ];
  for (let i = 1; i < conveyorPath.length; i++)
    M.conveyor(
      g,
      [conveyorPath[i - 1].x, conveyorPath[i - 1].z],
      [conveyorPath[i].x, conveyorPath[i].z],
      13,
    );
  // Dutos seguem pelo píer, do berço 104 até o 108.
  const pipePath: Line = [
    inland(b104, 26, 40),
    inland(b105, 19, 60),
    inland(b106, 19, 0),
    inland(b108, 19, 0),
  ];
  for (let i = 1; i < pipePath.length; i++)
    M.pipeRack(
      g,
      [pipePath[i - 1].x, pipePath[i - 1].z],
      [pipePath[i].x, pipePath[i].z],
    );
  extraCorridors.push(conveyorPath, pipePath);

  // ---------- Pátios: preenchimento em três escalas de células livres ----------
  const axis = headingVector(350),
    cos = axis.x,
    sin = axis.z;
  const blockers: { line: Line; margin: number }[] = [
    ...roads.map((x) => ({ line: x.line, margin: x.width / 2 + 1.5 })),
    ...rails.map((line) => ({ line, margin: 3.5 })),
    ...quayLines.map((line) => ({ line, margin: 36 })),
    ...extraCorridors.map((line) => ({ line, margin: 5 })),
  ];
  const inside = (p: XZ) =>
    pointInPolygon(p, harbour) && pointInPolygon(p, land);
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const p of harbour) {
    const u = p.x * cos + p.z * sin,
      v = -p.x * sin + p.z * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const cellAngle = -Math.atan2(sin, cos);
  const tegramDist = (p: XZ) => Math.hypot(p.x - tegram.x, p.z - tegram.z);
  const liquidDist = (p: XZ) => Math.hypot(p.x - liquids.x, p.z - liquids.z);
  const southZ = project([-44.3668, -2.5795]).z;
  const placed: { u: number; v: number; hu: number; hv: number }[] = [];
  const free = (u: number, v: number, U: number, V: number) => {
    if (
      placed.some(
        (p) =>
          Math.abs(p.u - u) < p.hu + U / 2 + 3 &&
          Math.abs(p.v - v) < p.hv + V / 2 + 3,
      )
    )
      return null;
    const c = { x: u * cos - v * sin, z: u * sin + v * cos };
    for (const su of [-0.5, 0, 0.5])
      for (const sv of [-0.5, 0, 0.5])
        if (
          !inside({
            x: c.x + su * U * cos - sv * V * sin,
            z: c.z + su * U * sin + sv * V * cos,
          })
        )
          return null;
    if (
      obstacles.some(
        (o) =>
          Math.hypot(o.c.x - c.x, o.c.z - c.z) <
          o.radius + Math.max(U, V) / 2 + 4,
      )
    )
      return null;
    for (const { line, margin } of blockers)
      for (let i = 1; i < line.length; i++)
        if (
          segmentHitsRect(
            line[i - 1],
            line[i],
            c.x,
            c.z,
            cos,
            sin,
            U / 2 + margin,
            V / 2 + margin,
          )
        )
          return null;
    placed.push({ u, v, hu: U / 2, hv: V / 2 });
    return c;
  };
  const scales = [
    { U: 66, V: 42 },
    { U: 40, V: 26 },
    { U: 26, V: 15 },
  ];
  scales.forEach(({ U, V }, level) => {
    for (let u = minU + U / 2; u < maxU; u += U / 2)
      for (let v = minV + V / 2; v < maxV; v += V / 2) {
        const c = free(u, v, U, V);
        if (!c) continue;
        const f = g.sub(c.x, 0, c.z, cellAngle);
        const roll = r();
        const tank = liquidDist(c) < 340,
          grain = tegramDist(c) < 420,
          south = c.z > southZ;
        if (level === 0) {
          if (tank) {
            M.bundWall(f, U - 2, V - 2);
            const tr = 11 + r() * 3;
            M.storageTank(
              f.sub(-15, 0, 0),
              tr,
              13 + r() * 5,
              tankColor(r),
              tankBand(r),
            );
            M.storageTank(
              f.sub(15, 0, 0),
              tr,
              13 + r() * 5,
              tankColor(r),
              tankBand(r),
            );
          } else if (grain) {
            if (roll < 0.7)
              M.archWarehouse(f, U - 6, V - 8, C.wallBlue, C.roof);
            else
              for (let i = 0; i < 4; i++)
                M.silo(f.sub(-22 + i * 14.5, 0, 0), 6, 26);
          } else if (south || roll < 0.3) {
            M.containerBlock(f.sub(0, 0, -6), 6, 4, 4, r);
            if (roll < 0.55)
              M.rtgCrane(
                f.sub(-8 + r() * 16, 0, -6),
                roll < 0.3 ? C.white : C.yellow,
              );
            else M.reachStacker(f.sub(-20, 0, 14), roll < 0.8 ? C.blue : C.red);
            M.lightPole(f, U / 2 - 1, V / 2 - 1, 24);
          } else if (roll < 0.62) {
            M.gableWarehouse(
              f,
              U - 6,
              V - 10,
              12,
              C.white,
              roll < 0.46 ? C.wallBlue : C.red,
            );
          } else {
            const color = [C.fertilizer, C.coal, C.ironOre, C.grain][
              Math.floor(r() * 4)
            ];
            M.stockpile(f, U - 10, V - 12, 9 + r() * 5, color);
            M.forklift(f.sub(U / 2 - 4, 0, V / 2 - 2), C.yellow);
          }
        } else if (level === 1) {
          if (tank) {
            M.bundWall(f, U - 2, V - 2);
            M.storageTank(f.sub(-9, 0, 0), 8.5, 11, tankColor(r), tankBand(r));
            M.storageTank(f.sub(10, 0, 0), 8.5, 11, tankColor(r), tankBand(r));
          } else if (grain) {
            if (roll < 0.5)
              M.archWarehouse(f, U - 4, V - 6, C.wallBlue, C.roof);
            else
              for (let i = 0; i < 3; i++)
                M.silo(f.sub(-12 + i * 12, 0, 0), 5, 22);
          } else if (south || roll < 0.45) {
            M.containerBlock(f, 5, 3, 3, r);
            if (roll < 0.25) M.reachStacker(f.sub(0, 0, V / 2 - 1), C.blue);
          } else if (roll < 0.7) {
            M.gableWarehouse(
              f,
              U - 4,
              V - 8,
              9,
              C.offWhite,
              roll < 0.58 ? C.wallBlue : C.teal,
            );
          } else if (roll < 0.85) {
            M.stockpile(
              f,
              U - 8,
              V - 8,
              7,
              [C.fertilizer, C.coal, C.ironOre][Math.floor(r() * 3)],
            );
          } else {
            M.office(f, U - 14, V - 10, 2, roll < 0.93 ? C.wallBlue : C.red);
          }
        } else {
          if (tank) {
            M.storageTank(f, 6, 8, tankColor(r), tankBand(r));
          } else if (roll < 0.42) {
            M.containerBlock(f, 4, 2, 3, r);
          } else if (roll < 0.62) {
            for (let i = 0; i < 2; i++)
              M.truck(
                f.sub(0, 0, -3.6 + i * 7.2),
                [C.red, C.blue, C.white][Math.floor(r() * 3)],
                r() > 0.4 ? CONTAINER_COLORS[Math.floor(r() * 6)] : null,
              );
          } else if (roll < 0.82) {
            for (let x = -10; x <= 10; x += 2.6)
              for (const z of [-3.5, 3.5])
                if (r() > 0.25)
                  M.car(
                    f.sub(x, 0, z, Math.PI / 2),
                    [C.white, C.offWhite, C.steel, C.red, C.blue, C.black][
                      Math.floor(r() * 6)
                    ],
                  );
          } else {
            M.pallets(f, r, U - 2, V - 2);
            M.forklift(f.sub(U / 2 - 3, 0, 0), C.yellow);
          }
        }
      }
  });

  // ---------- Portaria no acesso terrestre ----------
  const gate = place("acesso");
  const nearestRoad = roads
    .filter((x) => x.width >= 8.5)
    .map((x) => ({ x, d: distanceToPolyline(gate, x.line) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearestRoad) {
    const line = nearestRoad.x.line;
    let best = 0,
      bestD = Infinity;
    const total = polylineLength(line);
    for (let d = 0; d < total; d += 5) {
      const s = sampleAlong(line, d);
      const dd = Math.hypot(s.x - gate.x, s.z - gate.z);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    const s = sampleAlong(line, best);
    M.checkpoint(
      g.sub(s.x, 0, s.z, s.angle + Math.PI / 2),
      nearestRoad.x.width + 6,
    );
  }

  // ---------- Trens nas linhas mais longas ----------
  const longRails = rails
    .map((line) => ({ line, len: polylineLength(line) }))
    .filter((x) => x.len > 260)
    .sort((a, b) => b.len - a.len)
    .slice(0, 4);
  longRails.forEach(({ line, len }, k) => {
    const start = len * (0.12 + 0.1 * k);
    const nearLiquids = liquidDist(sampleAlong(line, len / 2)) < 500;
    const cars = Math.min(14, Math.floor((len * 0.7) / 16));
    for (let i = 0; i < cars; i++) {
      const s = sampleAlong(line, start + i * 16.2);
      const f = g.sub(s.x, 0.5, s.z, s.angle);
      if (i === 0) M.locomotive(f, k % 2 ? C.orange : C.yellow);
      else if (nearLiquids) M.tankWagon(f, i % 3 ? C.white : C.offWhite);
      else if (k % 2) M.flatWagon(f, r);
      else M.hopperWagon(f, i % 4 ? C.rust : C.steelDark);
    }
  });

  // ---------- Vegetação no continente fora do porto ----------
  // Maciços de mata: sementes aleatórias com árvores agrupadas ao redor.
  for (let i = 0, placed = 0; i < 900 && placed < 1100; i++) {
    const seed = {
      x: center.x - 200 + (r() - 0.3) * 2800,
      z: center.z + (r() - 0.5) * 2800,
    };
    const count = 3 + Math.floor(r() * 7);
    for (let k = 0; k < count; k++) {
      const p = { x: seed.x + (r() - 0.5) * 60, z: seed.z + (r() - 0.5) * 60 };
      if (!pointInPolygon(p, land) || pointInPolygon(p, harbour)) continue;
      if (
        distanceToPolyline(p, land) < 14 ||
        distanceToPolyline(p, harbour) < 8
      )
        continue;
      M.tree(g.sub(p.x, 0, p.z, r() * 6), 0, 0, 0.6 + r() * 0.9, r);
      placed++;
    }
  }

  const staticGroup = statics.build(materials, "estatico");
  performance.measure("port3d:build", "port3d:start");
  scene.add(staticGroup);
  staticGroup.children.forEach((m) =>
    disposables.push((m as THREE.Mesh).geometry),
  );

  // ---------- Caminhões animados nas vias ----------
  const truckRoutes = roads
    .map((x) => ({ ...x, len: polylineLength(x.line) }))
    .filter((x) => x.len > 180)
    .sort((a, b) => b.len - a.len)
    .slice(0, 16);
  const trucks = truckRoutes.map((route, i) => {
    const b = new Batch();
    M.truck(
      b.frame(),
      [C.red, C.blue, C.yellow, C.white, C.orange][i % 5],
      r() > 0.25 ? CONTAINER_COLORS[i % CONTAINER_COLORS.length] : null,
    );
    const group = b.build(materials, "caminhao");
    group.children.forEach((m) => disposables.push((m as THREE.Mesh).geometry));
    scene.add(group);
    return {
      group,
      route,
      pos: r() * route.len,
      dir: r() > 0.5 ? 1 : -1,
      speed: 6 + r() * 5,
    };
  });
  const placeTruck = (t: (typeof trucks)[number]) => {
    const s = sampleAlong(t.route.line, t.pos);
    const angle = t.dir > 0 ? s.angle : s.angle + Math.PI;
    // Mão direita: desloca o caminhão para a faixa do seu sentido.
    const side = t.route.width / 4;
    t.group.position.set(
      s.x + Math.sin(angle) * -side,
      GROUND + 0.12,
      s.z + Math.cos(angle) * -side,
    );
    t.group.rotation.y = angle;
  };
  trucks.forEach(placeTruck);

  // ---------- Rótulos ----------
  const labels = new THREE.Group();
  scene.add(labels);
  const makeLabel = (text: string, cls: string, onClick?: () => void) => {
    const el = document.createElement(onClick ? "button" : "div");
    el.className = `port3d-label ${cls}`;
    el.textContent = text;
    if (onClick) {
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
    }
    return new CSS2DObject(el);
  };
  for (const b of berths) {
    const label = makeLabel(b.id, "berth", () => {
      events.onSelect?.({ type: "berth", berth: b, vessel: current.get(b.id) });
      focus(b.id);
    });
    label.element.setAttribute("aria-label", `${b.name}: aproximar`);
    const p = inland(b, 4);
    label.position.set(p.x, GROUND + 40, p.z);
    labels.add(label);
  }
  for (const p of PLACES.filter((x) => x.category !== "berth")) {
    const label = makeLabel(p.name, "place", () => {
      events.onSelect?.({ type: "place", place: p });
      focus(p.id);
    });
    const q = project(p.coordinates);
    label.position.set(q.x, GROUND + 55, q.z);
    labels.add(label);
  }

  // ---------- Navios (dinâmicos, a partir da programação) ----------
  let ships = new THREE.Group();
  scene.add(ships);
  let current = new Map<string, Vessel>();
  const shipLabels = new THREE.Group();
  labels.add(shipLabels);
  const disposeShips = () => {
    ships.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    scene.remove(ships);
    shipLabels.children.slice().forEach((l) => {
      (l as CSS2DObject).element.remove();
      shipLabels.remove(l);
    });
  };

  function setVessels(vessels: Vessel[], illustrativeFill: boolean) {
    disposeShips();
    ships = new THREE.Group();
    ships.name = "navios";
    scene.add(ships);
    current = berthedVessels(vessels);
    const sr = rng(7);
    for (const b of berths) {
      const vessel = current.get(b.id);
      if (!vessel && !illustrativeFill) continue;
      const info = vessel ? getVesselModelInfo(vessel) : null;
      const kind: M.ShipKind = info
        ? info.kind
        : (ILLUSTRATIVE_KIND[b.id] ?? "generic");
      const length = Math.min(
        360,
        Math.max(
          60,
          info ? info.lengthMeters : b.length * (0.72 + sr() * 0.15),
        ),
      );
      const batch = new Batch();
      const dims = M.ship(
        batch.frame(),
        kind === "generic" && !vessel ? "cargo" : kind,
        length,
        rng(Number(b.id) * 97 + length),
      );
      const group = batch.build(materials, "navio");
      const pose = shipPose(b, dims.beam);
      group.position.set(pose.x, 0, pose.z);
      group.rotation.y = pose.rotationY;
      const selection: SceneSelection = vessel
        ? {
            type: "vessel",
            vessel,
            berth: b,
            modelLabel: info!.label,
            lengthSource: info!.lengthSource,
          }
        : { type: "illustrative", berth: b, modelLabel: KIND_LABEL[kind] };
      group.userData.selection = selection;
      ships.add(group);
      const label = makeLabel(
        vessel ? vessel.name : "Ilustrativo",
        vessel ? "ship" : "ship illustrative",
        () => events.onSelect?.(selection),
      );
      label.position.set(pose.x, 30, pose.z);
      shipLabels.add(label);
    }
    return current.size;
  }

  // ---------- Câmera e foco ----------
  const homeBerth = berths.find((b) => b.id === "102") ?? berths[0];
  const homeTarget = new THREE.Vector3(
    homeBerth.quay.x + homeBerth.normal.x * 160,
    0,
    homeBerth.quay.z + homeBerth.normal.z * 160 - 120,
  );
  const home = {
    target: homeTarget,
    position: homeTarget.clone().add(new THREE.Vector3(-760, 560, 600)),
  };
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  let tween: {
    from: [THREE.Vector3, THREE.Vector3];
    to: [THREE.Vector3, THREE.Vector3];
    t: number;
    start: number;
  } | null = null;
  function focus(id: "home" | string) {
    let target: THREE.Vector3, position: THREE.Vector3;
    const b = berths.find((x) => x.id === id);
    const p = PLACES.find((x) => x.id === id);
    if (b) {
      target = new THREE.Vector3(b.quay.x, GROUND, b.quay.z);
      position = target
        .clone()
        .add(
          new THREE.Vector3(
            -b.normal.x * 260 - b.along.x * 140,
            190,
            -b.normal.z * 260 - b.along.z * 140,
          ),
        );
    } else if (p) {
      const q = project(p.coordinates);
      target = new THREE.Vector3(q.x, GROUND, q.z);
      position = target.clone().add(new THREE.Vector3(-380, 330, 300));
    } else {
      target = home.target.clone();
      position = home.position.clone();
    }
    tween = {
      from: [camera.position.clone(), controls.target.clone()],
      to: [position, target],
      t: 0,
      start: performance.now(),
    };
  }

  // ---------- Interação ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  const pick = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(ships, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData.selection) o = o.parent;
    return (o?.userData.selection as SceneSelection | undefined) ?? null;
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
    tween = null;
  };
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    down = null;
    events.onSelect?.(pick(e));
  };
  let hoverFrame = 0;
  const onMove = (e: PointerEvent) => {
    if (e.buttons || hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      renderer.domElement.style.cursor = pick(e) ? "pointer" : "";
    });
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);

  const resize = () => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  // ---------- Laço de renderização ----------
  const clock = new THREE.Clock();
  const bound = 2600;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    waterUniforms.uTime.value += dt;
    if (!reducedMotion)
      for (const t of trucks) {
        t.pos += t.dir * t.speed * dt;
        if (t.pos > t.route.len - 4 || t.pos < 4) {
          t.dir *= -1;
          t.pos = Math.min(t.route.len - 4, Math.max(4, t.pos));
        }
        placeTruck(t);
      }
    if (tween) {
      tween.t = Math.min(1, (performance.now() - tween.start) / 1400);
      const k =
        tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2;
      camera.position.lerpVectors(tween.from[0], tween.to[0], k);
      controls.target.lerpVectors(tween.from[1], tween.to[1], k);
      if (tween.t >= 1) tween = null;
    }
    controls.target.x = Math.max(
      center.x - bound,
      Math.min(center.x + bound, controls.target.x),
    );
    controls.target.z = Math.max(
      center.z - bound,
      Math.min(center.z + bound, controls.target.z),
    );
    controls.target.y = Math.max(0, Math.min(60, controls.target.y));
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  return {
    setVessels,
    focus,
    setAutoRotate(on) {
      controls.autoRotate = on && !reducedMotion;
    },
    setLabels(on) {
      labels.visible = on;
      labelRenderer.domElement.style.display = on ? "" : "none";
    },
    dispose() {
      renderer.setAnimationLoop(null);
      cancelAnimationFrame(hoverFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      disposeShips();
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      (scene.background as THREE.Texture | null)?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };
}

/** Em telas em pé, abre o campo de visão para manter a mesma largura de cena. */
const fovFor = (aspect: number) =>
  aspect >= 1 ? 34 : Math.min(62, 34 / Math.sqrt(Math.max(aspect, 0.3)));

const tankColor = (r: () => number) =>
  [C.white, C.white, C.offWhite, "#d7dadb", "#c9ced1"][Math.floor(r() * 5)];
const tankBand = (r: () => number) =>
  r() < 0.45
    ? [C.green, C.wallBlue, C.red, C.yellow][Math.floor(r() * 4)]
    : undefined;

function offsetLine(line: Line, d: number): Line {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)],
      b = line[Math.min(line.length - 1, i + 1)];
    const dx = b.x - a.x,
      dz = b.z - a.z,
      len = Math.hypot(dx, dz) || 1;
    return { x: p.x - (dz / len) * d, z: p.z + (dx / len) * d };
  });
}

function skyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#8ec9ec");
  grad.addColorStop(0.55, "#c4e3f2");
  grad.addColorStop(1, "#e4f0f2");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Textura do topo do terreno: vegetação fora do porto e concreto dentro do polígono do OSM. */
function groundTexture(harbour: XZ[], size: number) {
  const margin = 80;
  const minX = Math.min(...harbour.map((p) => p.x)) - margin,
    maxX = Math.max(...harbour.map((p) => p.x)) + margin,
    minZ = Math.min(...harbour.map((p) => p.z)) - margin,
    maxZ = Math.max(...harbour.map((p) => p.z)) + margin;
  const width = maxX - minX,
    height = maxZ - minZ,
    scale = size / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.land;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Manchas de vegetação para quebrar a cor chapada.
  const r = rng(99);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = r() > 0.5 ? C.landDark : "#a9bd77";
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(
      r() * canvas.width,
      r() * canvas.height,
      (8 + r() * 40) * scale,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const path = () => {
    ctx.beginPath();
    harbour.forEach((p, i) => {
      const x = (p.x - minX) * scale,
        y = (p.z - minZ) * scale;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  };
  path();
  ctx.fillStyle = C.concrete;
  ctx.fill();
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = C.concreteDark;
  ctx.stroke();
  // Juntas de pavimento em grade, sutis, só dentro do porto.
  ctx.save();
  path();
  ctx.clip();
  ctx.strokeStyle = "rgba(90, 96, 102, 0.18)";
  ctx.lineWidth = Math.max(1, 0.4 * scale);
  for (let x = 0; x < canvas.width; x += 12 * scale) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 12 * scale) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, minX, minZ, width, height };
}
