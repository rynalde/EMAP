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
  orientedBox,
  pointInPolygon,
  polygonArea,
  rayHit,
  polylineLength,
  project,
  sampleAlong,
  unproject,
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
  ringSegments,
  shipPose,
  type BerthLayout,
} from "./layout";
import * as M from "./models";
import { REFERENCE } from "./reference";
import { FlatMesh, junctionNodes, nodeKey, smooth, stations } from "./roads";
import {
  LC,
  LC_COLOR,
  classAt,
  isVegetation,
  terrainGeometry,
  type LandCover,
} from "./terrain";

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
  /** Cobertura do solo ESA WorldCover; sem ela, o entorno fica com a cor padrão. */
  landcover?: LandCover | null;
};

export type PortSceneEvents = {
  onSelect?: (selection: SceneSelection | null) => void;
  /** O tour guiado terminou ou foi interrompido pelo usuário. */
  onTourEnd?: () => void;
};

export type PortSceneController = {
  setVessels(vessels: Vessel[], illustrativeFill: boolean): number;
  focus(target: "home" | string): void;
  setAutoRotate(on: boolean): void;
  setLabels(on: boolean): void;
  startTour(): void;
  stopTour(): void;
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
    "106": ["arms"],
    "108": ["arms"],
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

  // Linhas suavizadas uma única vez: desenho, caminhões, trens e portaria usam as mesmas.
  const fixedNodes = junctionNodes([...roads.map((x) => x.line), ...rails]);
  for (const road of roads) road.line = smooth(road.line, fixedNodes);
  for (let i = 0; i < rails.length; i++)
    rails[i] = smooth(rails[i], fixedNodes);

  const statics = new Batch();
  const root = statics.frame();
  const g = root.sub(0, GROUND, 0);
  const r = rng(20260926);

  // ---------- Água ----------
  const waterUniforms = { uTime: { value: 0 } };
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: C.water,
    roughness: 0.3,
    metalness: 0.08,
  });
  // Ondulação suave: a malha oscila devagar e as normais das marolas são calculadas por
  // pixel (em vez de facetas), com atenuação à distância para não cintilar.
  waterMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nvarying vec2 vWater;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vWater = position.xy;
        transformed.z += sin(position.x * 0.045 + uTime * 0.8) * 0.35
          + cos(position.y * 0.052 - uTime * 0.6) * 0.3;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nvarying vec2 vWater;",
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        {
          vec2 p = vWater;
          vec2 g = vec2(0.0);
          vec2 d;
          d = normalize(vec2(1.0, 0.35));  g += d * 0.045 * cos(dot(d, p) * 0.07 + uTime * 0.9);
          d = normalize(vec2(-0.4, 1.0));  g += d * 0.04 * cos(dot(d, p) * 0.13 - uTime * 1.3);
          d = normalize(vec2(0.8, -0.6));  g += d * 0.03 * cos(dot(d, p) * 0.31 + uTime * 1.9);
          d = normalize(vec2(-0.9, -0.2)); g += d * 0.025 * cos(dot(d, p) * 0.57 - uTime * 2.4);
          g *= clamp(1.0 - length(vViewPosition) / 2600.0, 0.15, 1.0);
          // Plano girado -90° em X: normal local (x, y, z) vira (x, z, -y) no mundo.
          vec3 local = normalize(vec3(-g, 1.0));
          normal = normalize((viewMatrix * vec4(local.x, local.z, -local.y, 0.0)).xyz);
        }`,
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
  // Bem abaixo da ondulação (±0,65 m) do plano próximo, para não atravessá-lo.
  farWater.position.y = -3;
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
    const tex = groundTexture(
      harbour,
      land,
      small ? 2048 : 4096,
      input.landcover,
    );
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

  // ---------- Relevo e vegetação do entorno (ESA WorldCover) ----------
  const jettyBerths = new Set(REFERENCE.jetties.flatMap((j) => j.berths));
  const jettyLines = REFERENCE.jetties.map((j) => j.path.map(project));
  if (input.landcover) {
    // Lâmina d'água livre diante dos berços e sob as pontes de acesso aos píeres.
    const keepWater = (p: XZ) => {
      if (pointInPolygon(p, land)) return false;
      for (const b of berths) {
        const dx = p.x - b.quay.x,
          dz = p.z - b.quay.z;
        const t = dx * b.along.x + dz * b.along.z,
          n = dx * b.normal.x + dz * b.normal.z;
        if (Math.abs(t) < b.length / 2 + 70 && n < 8 && n > -120) return true;
      }
      return jettyLines.some((l) => distanceToPolyline(p, l) < 40);
    };
    // Obstáculos com caixa envolvente para descartar rápido o que está longe.
    const obstacleLines = [
      ...roads.map((x) => ({ line: x.line, margin: x.width / 2 + 8 })),
      ...rails.map((line) => ({ line, margin: 8 })),
      ...REFERENCE.conveyors.map((c) => ({
        line: c.path.map(project),
        margin: 6,
      })),
    ].map((o) => {
      const xs = o.line.map((p) => p.x),
        zs = o.line.map((p) => p.z);
      return {
        ...o,
        box: [
          Math.min(...xs) - o.margin,
          Math.max(...xs) + o.margin,
          Math.min(...zs) - o.margin,
          Math.max(...zs) + o.margin,
        ],
      };
    });
    const footprints = [
      ...REFERENCE.buildings.map((b) => ({
        c: project([b.lon, b.lat]),
        r: Math.hypot(b.length, b.width) / 2 + 8,
      })),
      ...REFERENCE.tanks.map((t) => ({
        c: project([t.lon, t.lat]),
        r: t.r + 8,
      })),
      ...buildings.map((ring) => {
        const box = orientedBox(ring);
        return {
          c: { x: box.cx, z: box.cz },
          r: Math.hypot(box.length, box.width) / 2 + 8,
        };
      }),
    ];
    const clearCanopy = (p: XZ) =>
      pointInPolygon(p, land) &&
      (footprints.some((f) => Math.hypot(f.c.x - p.x, f.c.z - p.z) < f.r) ||
        obstacleLines.some(
          (o) =>
            p.x > o.box[0] &&
            p.x < o.box[1] &&
            p.z > o.box[2] &&
            p.z < o.box[3] &&
            distanceToPolyline(p, o.line) < o.margin,
        ));
    const terrain = terrainGeometry(
      input.landcover,
      small ? 3 : 2,
      keepWater,
      clearCanopy,
    );
    statics.addGeometry(terrain);
    terrain.dispose();
  }

  // ---------- Cais: aventais, faixas de borda, defensas e cabeços ----------
  for (const b of berths) {
    const ry = headingToRotationY(b.heading);
    if (jettyBerths.has(b.id)) {
      jettyBerth(root, b, ry);
      equip(b);
      continue;
    }
    const L = b.length + 36;
    // Em píeres estreitos o avental não passa da largura do terrapleno.
    const depth = rayHit(
      { x: b.quay.x + b.normal.x * 2, z: b.quay.z + b.normal.z * 2 },
      b.normal,
      ringSegments(land),
      32,
    );
    const apron = depth === null ? 32 : Math.max(14, depth + 2);
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
    if (apron > 18) edge.box(L, 0.08, 0.35, C.rail, 0, 0.02, 14);
    if (apron > 24) edge.box(L, 0.04, 0.3, C.marking, 0, 0.02, 21);
    for (let x = -L / 2 + 20; x < L / 2 - 10; x += 55)
      M.lightPole(edge, x, Math.min(27, apron - 3), 24);

    equip(b);
  }

  // Equipamentos: lado do mar do referencial local (+X) voltado para o navio.
  function equip(b: BerthLayout) {
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
  const shoulder = new FlatMesh(),
    asphalt = new FlatMesh(),
    paint = new FlatMesh(),
    ballast = new FlatMesh(),
    steel = new FlatMesh();
  const rank = (w: number) => (w >= 11 ? 2 : w >= 8.5 ? 1 : 0);
  for (const road of roads) {
    const y = GROUND + 0.06 + rank(road.width) * 0.004;
    // Acostamento claro por baixo dá contorno nítido; nas junções o asfalto o cobre.
    shoulder.strip(road.line, road.width + 1.6, GROUND + 0.03);
    asphalt.strip(road.line, road.width, y);
    // Tampas redondas nas pontas e nós de junção fecham as emendas entre vias.
    const nodes = road.line.filter(
      (p, i, all) =>
        i === 0 || i === all.length - 1 || fixedNodes.has(nodeKey(p)),
    );
    for (const p of nodes) {
      shoulder.disc(p, road.width / 2 + 0.8, GROUND + 0.03);
      asphalt.disc(p, road.width / 2, y);
    }
    if (road.width >= 8.5) {
      // Faixa central tracejada, interrompida nos cruzamentos.
      const clear = road.width / 2 + 7;
      for (const s of stations(road.line, 10, 5)) {
        if (nodes.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < clear))
          continue;
        const c = Math.cos(s.angle),
          sn = -Math.sin(s.angle);
        const hx = c * 2,
          hz = sn * 2,
          wx = -sn * 0.14,
          wz = c * 0.14;
        const a = { x: s.x - hx - wx, z: s.z - hz - wz },
          b = { x: s.x + hx - wx, z: s.z + hz - wz },
          cc = { x: s.x + hx + wx, z: s.z + hz + wz },
          d = { x: s.x - hx + wx, z: s.z - hz + wz };
        paint.tri(a, b, cc, GROUND + 0.075);
        paint.tri(a, cc, d, GROUND + 0.075);
      }
    }
  }
  for (const rail of rails) {
    ballast.strip(rail, 3.4, GROUND + 0.025);
    for (const s of stations(rail, 1.8, 0.9))
      g.sub(s.x, 0.03, s.z, s.angle).box(0.5, 0.1, 2.5, C.sleeper);
    for (const off of [-0.72, 0.72])
      steel.strip(offsetLine(rail, off), 0.18, GROUND + 0.16);
  }
  const flat: [FlatMesh, string][] = [
    [shoulder, C.concreteLight],
    [asphalt, C.asphalt],
    [paint, C.marking],
    [ballast, C.ballast],
    [steel, C.rail],
  ];
  for (const [mesh, color] of flat) {
    const geometry = mesh.geometry();
    statics.addGeometry(geometry, color);
    geometry.dispose();
  }

  // ---------- Edificações do OSM ----------
  const refTanks = REFERENCE.tanks.map((t) => ({
    ...t,
    p: project([t.lon, t.lat]),
  }));
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
    if (refTanks.some((t) => Math.hypot(t.p.x - c.x, t.p.z - c.z) < radius + 6))
      continue;
    M.storageTank(g.sub(c.x, 0, c.z), radius, radius * 1.1);
    obstacles.push({ c, radius: radius + 6 });
  }

  const place = (id: string) =>
    project(PLACES.find((p) => p.id === id)!.coordinates);
  const inland = (b: BerthLayout, d: number, t = 0): XZ => ({
    x: b.quay.x + b.normal.x * d + b.along.x * t,
    z: b.quay.z + b.normal.z * d + b.along.z * t,
  });
  const liquids = place("liquidos");
  const liquidDist = (p: XZ) => Math.hypot(p.x - liquids.x, p.z - liquids.z);

  // ---------- Estruturas posicionadas pela imagem de satélite ----------
  for (const b of REFERENCE.buildings) {
    const p = project([b.lon, b.lat]);
    const f = g.sub(p.x, 0, p.z, (b.angle * Math.PI) / 180);
    if (b.style === "arch")
      M.archWarehouse(f, b.length, b.width, b.wall, b.roof);
    else if (b.style === "gable")
      M.gableWarehouse(f, b.length, b.width, b.height, b.wall, b.wall, b.roof);
    else {
      f.box(b.length, b.height, b.width, b.wall);
      f.box(b.length + 0.6, 0.6, b.width + 0.6, b.roof, 0, b.height, 0);
    }
  }
  for (const t of refTanks) {
    const f = g.sub(t.p.x, 0, t.p.z);
    if (t.kind === "water") {
      // Reservatório aberto: anel de concreto com lâmina escura.
      f.cyl(t.r, 3.5, C.concreteDark, 0, 0, 0, 20);
      f.cyl(t.r * 0.9, 0.1, "#2f4a3a", 0, 3.5, 0, 20);
    } else
      M.storageTank(
        f,
        t.r,
        Math.min(22, Math.max(6, t.r * 1.15)),
        TANK_COLOR[t.kind],
        undefined,
        TANK_COLOR[t.kind],
      );
  }
  // Correias transportadoras e pontes sobre estacas: pilares partem do nível da água.
  for (const c of REFERENCE.conveyors) {
    const line = c.path.map(project);
    for (let i = 1; i < line.length; i++)
      M.conveyor(
        root,
        [line[i - 1].x, line[i - 1].z],
        [line[i].x, line[i].z],
        GROUND + c.height,
      );
  }
  for (const j of REFERENCE.jetties) {
    const line = j.path.map(project);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        len = Math.hypot(b.x - a.x, b.z - a.z);
      const f = root.sub(a.x, 0, a.z, Math.atan2(-(b.z - a.z), b.x - a.x));
      // Tabuleiro 15 cm acima do terrapleno, onde a ponte passa sobre o píer do OSM.
      f.box(
        len + j.width,
        1.2,
        j.width,
        C.concreteLight,
        len / 2,
        GROUND - 1.05,
        0,
      );
      for (let x = 0; x <= len; x += 14)
        for (const z of [-j.width / 2 + 1, j.width / 2 - 1])
          f.cyl(0.6, GROUND + 3, C.quayWall, x, -3, z, 8);
      M.pipeRack(
        f.sub(0, GROUND, 0),
        [0, -j.width / 4],
        [len, -j.width / 4],
        1.6,
      );
      for (let x = 20; x < len; x += 60)
        M.lightPole(f.sub(0, GROUND, 0), x, j.width / 2 - 0.5, 14);
    }
  }

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
    stopTour();
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

  // ---------- Tour guiado ----------
  // Sobrevoo pelo mar ao longo do cais, pelos píeres de líquidos, TEGRAM e tancagem.
  let tour: {
    pos: THREE.CatmullRomCurve3;
    look: THREE.CatmullRomCurve3;
    start: number;
    duration: number;
  } | null = null;
  const seaView = (id: string, back: number, side: number, up: number) => {
    const b = berths.find((x) => x.id === id) ?? berths[0];
    const look = new THREE.Vector3(b.quay.x, GROUND + 8, b.quay.z);
    return [
      look
        .clone()
        .add(
          new THREE.Vector3(
            -b.normal.x * back - b.along.x * side,
            up,
            -b.normal.z * back - b.along.z * side,
          ),
        ),
      look,
    ] as const;
  };
  const placeView = (
    lonLat: [number, number],
    offset: [number, number, number],
  ) => {
    const q = project(lonLat);
    const look = new THREE.Vector3(q.x, GROUND + 10, q.z);
    return [look.clone().add(new THREE.Vector3(...offset)), look] as const;
  };
  function startTour() {
    const tegram = PLACES.find((x) => x.id === "tegram")!.coordinates;
    const frames = [
      [camera.position.clone(), controls.target.clone()] as const,
      seaView("99", 520, 260, 260),
      seaView("100", 260, 120, 120),
      seaView("102", 230, 40, 95),
      seaView("103", 220, -60, 100),
      seaView("105", 230, -40, 110),
      seaView("106", 210, 40, 95),
      seaView("108", 300, 160, 160),
      placeView(tegram, [-420, 330, 180]),
      placeView(tegram, [120, 260, 380]),
      placeView([-44.3615, -2.5745], [-260, 230, 300]),
      placeView([-44.3654, -2.5793], [-330, 260, 260]),
      [home.position.clone(), home.target.clone()] as const,
    ];
    tour = {
      pos: new THREE.CatmullRomCurve3(
        frames.map((f) => f[0]),
        false,
        "centripetal",
      ),
      look: new THREE.CatmullRomCurve3(
        frames.map((f) => f[1]),
        false,
        "centripetal",
      ),
      start: performance.now(),
      duration: 60000,
    };
    tween = null;
    controls.autoRotate = false;
  }
  function stopTour() {
    if (!tour) return;
    tour = null;
    events.onTourEnd?.();
  }
  controls.addEventListener("start", stopTour);

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
    if (tour) {
      const u = Math.min(1, (performance.now() - tour.start) / tour.duration);
      // Arranque e chegada suaves; no meio a velocidade é constante por trecho.
      const e =
        u < 0.04
          ? (u * u) / 0.08
          : u > 0.96
            ? 1 - ((1 - u) * (1 - u)) / 0.08
            : u;
      camera.position.copy(tour.pos.getPoint(e));
      controls.target.copy(tour.look.getPoint(e));
      if (u >= 1) stopTour();
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
    startTour,
    stopTour,
    setLabels(on) {
      labels.visible = on;
      labelRenderer.domElement.style.display = on ? "" : "none";
    },
    dispose() {
      renderer.setAnimationLoop(null);
      tour = null;
      controls.removeEventListener("start", stopTour);
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

const TANK_COLOR: Record<string, string> = {
  white: C.white,
  beige: "#e8d2c2",
  rust: "#a9644c",
  gray: "#a3a8ab",
};

/**
 * Berço em píer sobre estacas (106 e 108): plataforma de carregamento no centro e
 * dolfins de atracação ao longo da face, ligados por passarelas.
 */
function jettyBerth(root: Frame, b: BerthLayout, ry: number) {
  const pw = 26,
    pl = 46;
  const f = root.sub(
    b.quay.x + (b.normal.x * pw) / 2,
    0,
    b.quay.z + (b.normal.z * pw) / 2,
    ry,
  );
  // No 106 a plataforma é a cabeça do píer já desenhada pela costa do OSM.
  if (!b.onCoast) {
    f.box(pl, 1.6, pw, C.concreteLight, 0, GROUND - 1.45, 0);
    for (let x = -pl / 2 + 3; x <= pl / 2 - 3; x += 8)
      for (const z of [-pw / 2 + 2, 0, pw / 2 - 2])
        f.cyl(0.8, GROUND + 3, C.quayWall, x, -3, z, 8);
    const edge = f.sub(0, GROUND, -pw / 2);
    for (let x = -pl / 2 + 1; x < pl / 2 - 1; x += 2.4)
      edge.box(
        1.2,
        0.35,
        0.6,
        Math.round(x / 2.4) % 2 ? C.black : C.markingYellow,
        x,
        0,
        0.5,
      );
  }
  for (const t of [-0.45, -0.3, 0.3, 0.45]) {
    const along = t * b.length;
    const d = root.sub(
      b.quay.x + b.along.x * along + b.normal.x * 4,
      0,
      b.quay.z + b.along.z * along + b.normal.z * 4,
      ry,
    );
    d.box(8, GROUND + 6, 8, C.quayWall, 0, -6, 0);
    d.box(8.4, 0.5, 8.4, C.concreteLight, 0, GROUND - 0.3, 0);
    M.bollard(d, 0, 0, GROUND + 0.2);
    d.box(3, 2.6, 0.8, C.black, 0, GROUND - 3, -4.3);
    // Passarela até a plataforma.
    const span = Math.abs(along) - pl / 2 - 4;
    d.box(
      span,
      0.4,
      1.4,
      C.steel,
      (Math.sign(-along) * (span + 8)) / 2,
      GROUND + 1.2,
      2,
    );
  }
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
function groundTexture(
  harbour: XZ[],
  land: XZ[],
  size: number,
  landcover?: LandCover | null,
) {
  // Cobre todo o terreno quando há cobertura do solo; senão, só o porto com margem.
  const extent = landcover ? land : harbour;
  const margin = 80;
  const minX = Math.min(...extent.map((p) => p.x)) - margin,
    maxX = Math.max(...extent.map((p) => p.x)) + margin,
    minZ = Math.min(...extent.map((p) => p.z)) - margin,
    maxZ = Math.max(...extent.map((p) => p.z)) + margin;
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
  if (landcover) {
    // Classes do WorldCover em células de 5 m, suavizadas ao ampliar: vegetação real
    // dentro e fora do porto; o que não é vegetação dentro do porto vira pavimento.
    const cell = 5,
      cw = Math.ceil(width / cell),
      ch = Math.ceil(height / cell);
    const lcCanvas = document.createElement("canvas");
    lcCanvas.width = cw;
    lcCanvas.height = ch;
    const lctx = lcCanvas.getContext("2d")!;
    const img = lctx.createImageData(cw, ch);
    const rgb = new THREE.Color();
    for (let j = 0; j < ch; j++)
      for (let i = 0; i < cw; i++) {
        const p = { x: minX + (i + 0.5) * cell, z: minZ + (j + 0.5) * cell };
        const [lon, lat] = unproject(p);
        const c = classAt(landcover, lon, lat);
        const inPort = pointInPolygon(p, harbour);
        const hex =
          inPort && !isVegetation(c)
            ? C.concrete
            : c === LC.water
              ? C.land
              : (LC_COLOR[c] ?? C.land);
        rgb.set(hex).convertLinearToSRGB();
        const k = (j * cw + i) * 4;
        img.data[k] = Math.round(rgb.r * 255);
        img.data[k + 1] = Math.round(rgb.g * 255);
        img.data[k + 2] = Math.round(rgb.b * 255);
        img.data[k + 3] = 255;
      }
    lctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lcCanvas, 0, 0, canvas.width, canvas.height);
  }
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
  if (!landcover) {
    ctx.fillStyle = C.concrete;
    ctx.fill();
  }
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
