import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Paleta de cores planas, inspirada em cenas portuárias low-poly:
 * concreto claro, água saturada, contêineres vivos e guindastes em amarelo e azul.
 */
export const C = {
  water: "#1f78c8",
  waterDeep: "#175fa6",
  concrete: "#c4c8cb",
  concreteLight: "#d3d6d8",
  concreteDark: "#8e949a",
  quayWall: "#7b8187",
  asphalt: "#4b5157",
  asphaltLight: "#5a6067",
  marking: "#f1f1ec",
  markingYellow: "#f2c230",
  land: "#9db36b",
  landDark: "#7f9a52",
  sand: "#d8c89a",
  tree: "#4f8a3c",
  treeDark: "#3d7231",
  trunk: "#6b4f35",
  ballast: "#8a7f72",
  rail: "#5e6368",
  sleeper: "#6e5a48",
  white: "#f3f4f2",
  offWhite: "#e4e6e3",
  roof: "#d9dcdc",
  wallBlue: "#2f6fc4",
  wallBlueDark: "#24579c",
  glass: "#2c4b63",
  yellow: "#f3be1c",
  yellowDark: "#d39e10",
  blue: "#2d6fd2",
  red: "#d6392e",
  redDark: "#a92a23",
  orange: "#ef7d22",
  green: "#3aa655",
  greenHull: "#2fb24a",
  teal: "#1f9aa3",
  navy: "#1c3b66",
  black: "#2a2d31",
  steel: "#9aa2aa",
  steelDark: "#6c747c",
  rust: "#8d4b2c",
  coal: "#3b3d40",
  fertilizer: "#d9cfb8",
  ironOre: "#7a3b28",
  grain: "#d8b25c",
  antifouling: "#c8372d",
  deck: "#9b8f84",
  lamp: "#fff4c2",
} as const;

export const CONTAINER_COLORS = [
  C.red,
  C.blue,
  C.orange,
  C.green,
  C.teal,
  C.yellow,
  "#c23a58",
  "#e8e8e3",
  "#7a4fb0",
  "#8c6b4f",
];

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

/** Geometrias base compartilhadas; cada peça é uma cópia transformada e colorida. */
const BASE: Record<string, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1),
  cyl20: new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1),
  cone6: new THREE.ConeGeometry(0.5, 1, 6, 1),
  cone12: new THREE.ConeGeometry(0.5, 1, 12, 1),
  cone20: new THREE.ConeGeometry(0.5, 1, 20, 1),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  // Meio cilindro deitado ao longo de X: telhado em arco dos armazéns.
  arch: new THREE.CylinderGeometry(
    0.5,
    0.5,
    1,
    10,
    1,
    false,
    0,
    Math.PI,
  ).rotateZ(Math.PI / 2),
  // Prisma triangular deitado ao longo de X: telhado de duas águas.
  gable: (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.lineTo(0.5, 0);
    s.lineTo(0, 1);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false })
      .translate(0, 0, -0.5)
      .rotateY(Math.PI / 2);
  })(),
};
// Peças não indexadas: cada face mantém sua própria normal (visual facetado) e o merge é direto.
for (const [key, g] of Object.entries(BASE))
  if (g.index) BASE[key] = g.toNonIndexed();
for (const g of Object.values(BASE)) {
  g.deleteAttribute("uv");
  g.computeVertexNormals();
}

type Kind = "solid" | "glass" | "glow";

/**
 * Acumula peças coloridas por vértice e as funde em poucas malhas no final.
 * Mantém a cena estática em algumas chamadas de desenho, mesmo com milhares de peças.
 */
export class Batch {
  private parts: Record<Kind, THREE.BufferGeometry[]> = {
    solid: [],
    glass: [],
    glow: [],
  };

  add(
    base: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    matrix: THREE.Matrix4,
    kind: Kind = "solid",
  ) {
    const g = base.clone().applyMatrix4(matrix);
    paint(g, color);
    this.parts[kind].push(g);
    return g;
  }

  /** Adiciona uma geometria já pronta (com ou sem cores próprias). */
  addGeometry(
    geometry: THREE.BufferGeometry,
    color?: THREE.ColorRepresentation,
    kind: Kind = "solid",
  ) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes))
      if (!["position", "normal", "color"].includes(name))
        g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (color !== undefined) paint(g, color);
    else if (!g.getAttribute("color")) paint(g, "#fff");
    this.parts[kind].push(g);
  }

  frame(x = 0, y = 0, z = 0, ry = 0) {
    return new Frame(
      this,
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
        new THREE.Vector3(1, 1, 1),
      ),
    );
  }

  build(materials: Materials, name = "batch") {
    const group = new THREE.Group();
    group.name = name;
    (Object.keys(this.parts) as Kind[]).forEach((kind) => {
      const list = this.parts[kind];
      if (!list.length) return;
      // Fundir em blocos limita o tamanho de cada buffer.
      for (let i = 0; i < list.length; i += 4000) {
        const merged = mergeGeometries(list.slice(i, i + 4000), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, materials[kind]);
        mesh.castShadow = kind !== "glow";
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      list.forEach((g) => g.dispose());
    });
    this.parts = { solid: [], glass: [], glow: [] };
    return group;
  }
}

function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  // Color.set já converte de sRGB para o espaço linear de trabalho.
  tmpColor.set(color);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmpColor.r;
    arr[i * 3 + 1] = tmpColor.g;
    arr[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
}

/** Referencial local para montar modelos em coordenadas próprias. */
export class Frame {
  constructor(
    readonly batch: Batch,
    readonly matrix: THREE.Matrix4,
  ) {}

  sub(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "YXZ")),
      new THREE.Vector3(1, 1, 1),
    );
    return new Frame(this.batch, this.matrix.clone().multiply(local));
  }

  private put(
    base: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    kind: Kind = "solid",
  ) {
    tmpPos.set(x, y, z);
    tmpQuat.setFromEuler(tmpEuler.set(rx, ry, rz, "YXZ"));
    tmpScale.set(sx, sy, sz);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    this.batch.add(base, color, this.matrix.clone().multiply(tmpMatrix), kind);
  }

  /** Caixa com a base em y (e não o centro), o que simplifica empilhar peças. */
  box(
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
    ry = 0,
    kind: Kind = "solid",
  ) {
    this.put(BASE.box, color, w, h, d, x, y + h / 2, z, 0, ry, 0, kind);
  }

  /** Caixa centrada e rotacionada livremente, para treliças e lanças. */
  beam(
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    this.put(BASE.box, color, w, h, d, x, y, z, rx, ry, rz);
  }

  /** Barra entre dois pontos locais. */
  strut(
    a: [number, number, number],
    b: [number, number, number],
    thickness: number,
    color: THREE.ColorRepresentation,
  ) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    if (len < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      d.normalize(),
    );
    tmpMatrix.compose(
      new THREE.Vector3(
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
      ),
      q,
      new THREE.Vector3(len, thickness, thickness),
    );
    this.batch.add(BASE.box, color, this.matrix.clone().multiply(tmpMatrix));
  }

  cyl(
    r: number,
    h: number,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
    segments: 6 | 8 | 12 | 20 = 12,
    rx = 0,
    rz = 0,
  ) {
    const base = { 6: BASE.cyl6, 8: BASE.cyl8, 12: BASE.cyl12, 20: BASE.cyl20 }[
      segments
    ];
    if (rx || rz) this.put(base, color, r * 2, h, r * 2, x, y, z, rx, 0, rz);
    else this.put(base, color, r * 2, h, r * 2, x, y + h / 2, z);
  }

  cone(
    r: number,
    h: number,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
    segments: 6 | 12 | 20 = 12,
  ) {
    const base = { 6: BASE.cone6, 12: BASE.cone12, 20: BASE.cone20 }[segments];
    this.put(base, color, r * 2, h, r * 2, x, y + h / 2, z);
  }

  ico(
    r: number,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
    sy = 1,
  ) {
    this.put(BASE.ico, color, r * 2, r * 2 * sy, r * 2, x, y, z);
  }

  /** Telhado em arco (meio cilindro) com comprimento em X e vão em Z. */
  arch(
    length: number,
    span: number,
    rise: number,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
  ) {
    this.put(BASE.arch, color, length, rise * 2, span, x, y, z);
  }

  gable(
    length: number,
    span: number,
    rise: number,
    color: THREE.ColorRepresentation,
    x = 0,
    y = 0,
    z = 0,
  ) {
    this.put(BASE.gable, color, length, rise, span, x, y, z);
  }

  glass(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
    this.box(w, h, d, C.glass, x, y, z, 0, "glass");
  }

  glow(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
    this.box(w, h, d, C.lamp, x, y, z, 0, "glow");
  }
}

export type Materials = Record<Kind, THREE.Material>;

export function createMaterials(): Materials {
  return {
    solid: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.02,
      flatShading: true,
    }),
    glass: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.35,
      flatShading: true,
    }),
    glow: new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: new THREE.Color(C.lamp),
      emissiveIntensity: 0.6,
      roughness: 0.6,
    }),
  };
}

/** Gerador pseudoaleatório determinístico: a cena é a mesma a cada carregamento. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
