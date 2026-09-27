import * as THREE from "three";
import { C, CONTAINER_COLORS, type Frame } from "./kit";

/*
 * Modelos low-poly procedurais. Convenções: metros, +Y para cima, base em y = 0,
 * eixo +X como comprimento (frente do veículo/navio, lado do mar nos guindastes).
 */

type Rand = () => number;
const pick = <T>(list: readonly T[], r: Rand) =>
  list[Math.floor(r() * list.length) % list.length];

// ---------- Cais e pátio ----------

export function container(
  f: Frame,
  x: number,
  y: number,
  z: number,
  color: string,
  length = 12.2,
) {
  f.box(length, 2.6, 2.44, color, x, y, z);
  // Nervuras e portas escuras dão leitura de contêiner mesmo de longe.
  const dark = new THREE.Color(color).multiplyScalar(0.72).getStyle();
  f.box(0.12, 2.62, 2.46, dark, x - length / 2 + 0.06, y, z);
  f.box(0.12, 2.62, 2.46, dark, x + length / 2 - 0.06, y, z);
  f.box(length * 0.98, 0.1, 2.47, dark, x, y + 2.52, z);
}

/** Bloco de contêineres empilhados; alturas variadas como num pátio real. */
export function containerBlock(
  f: Frame,
  rows: number,
  bays: number,
  maxTiers: number,
  r: Rand,
  palette: readonly string[] = CONTAINER_COLORS,
) {
  const w = 2.44 + 0.3,
    l = 12.2 + 0.6;
  for (let b = 0; b < bays; b++)
    for (let row = 0; row < rows; row++) {
      const tiers = Math.max(0, Math.round(maxTiers * (0.35 + r() * 0.75)));
      for (let t = 0; t < Math.min(tiers, maxTiers); t++)
        container(
          f,
          (b - (bays - 1) / 2) * l,
          t * 2.6,
          (row - (rows - 1) / 2) * w,
          pick(palette, r),
        );
    }
}

export function bollard(f: Frame, x: number, z: number, y = 0) {
  f.cyl(0.35, 0.7, C.black, x, y, z, 8);
  f.cyl(0.5, 0.15, C.black, x, y + 0.7, z, 8);
}

export function lightPole(f: Frame, x: number, z: number, h = 22, y = 0) {
  f.cyl(0.35, h, C.steel, x, y, z, 6);
  f.box(3.2, 0.5, 1.2, C.steelDark, x, y + h, z);
  f.glow(2.6, 0.2, 0.9, x, y + h - 0.2, z);
}

export function tree(f: Frame, x: number, z: number, s: number, r: Rand) {
  const h = 4 + s * 5;
  f.cyl(0.35 * s + 0.2, h * 0.45, C.trunk, x, 0, z, 6);
  const shade = r() > 0.5 ? C.tree : C.treeDark;
  if (r() > 0.45) f.ico(1.6 + s * 2.2, shade, x, h * 0.62, z, 1.15);
  else f.cone(1.5 + s * 1.8, h * 0.9, shade, x, h * 0.3, z, 6);
}

export function fenceRun(f: Frame, length: number, h = 2.4) {
  for (let x = -length / 2; x <= length / 2; x += 3)
    f.box(0.12, h, 0.12, C.steelDark, x, 0, 0);
  f.box(length, 0.1, 0.08, C.steel, 0, h - 0.1, 0);
  f.box(length, h * 0.9, 0.03, "#b4bbc1", 0, 0.1, 0);
}

// ---------- Guindastes ----------

/** Guindaste móvel de porto (MHC) com torre, cabine e lança. Lado do mar em +X. */
export function mobileHarborCrane(
  f: Frame,
  color: string,
  slew = 0,
  luff = 0.62,
) {
  // Portal de apoio com sapatas.
  f.box(10, 2.2, 10, C.steelDark, 0, 0.3, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      f.strut([0, 1.5, 0], [sx * 7, 0.3, sz * 7], 0.9, color);
      f.box(2.2, 0.35, 2.2, C.black, sx * 7, 0, sz * 7);
    }
  f.box(5, 4, 5, C.steelDark, 0, 2.5, 0);
  f.cyl(2.2, 16, color, 0, 6, 0, 8);
  f.cyl(3, 1.2, C.steelDark, 0, 22, 0, 12);
  const top = f.sub(0, 23.2, 0, slew);
  // Casa de máquinas e contrapeso.
  top.box(11, 4.5, 6.5, C.white, -2.5, 0, 0);
  top.box(3.5, 3.2, 6.5, C.steelDark, -9, 0.4, 0);
  top.box(2.8, 3.4, 2.6, C.white, 3.2, 3.6, 2.2);
  top.glass(0.2, 1.4, 2.2, 4.62, 5, 2.2);
  top.box(0.6, 12, 0.6, color, -1, 4.5, 0);
  // Lança treliçada em ângulo.
  const boomLen = 48;
  const boom = top.sub(2, 3.5, 0, 0, 0, luff);
  boom.beam(boomLen, 1.6, 2.2, color, boomLen / 2, 0, 0);
  boom.beam(boomLen * 0.75, 0.5, 0.5, color, boomLen * 0.42, 1.8, 0);
  for (let i = 4; i < boomLen - 2; i += 6)
    boom.strut([i, 0.4, 0], [i + 3, 1.8, 0], 0.35, color);
  boom.box(1.8, 1.8, 2.6, C.steelDark, boomLen, -0.9, 0);
  // Tirante do topo da torre à ponta.
  const tipX = 2 + Math.cos(luff) * boomLen,
    tipY = 3.5 + Math.sin(luff) * boomLen;
  top.strut([-1, 16.5, 0], [tipX, tipY + 0.5, 0], 0.25, C.steelDark);
  // Cabo e gancho/garra.
  top.box(0.12, tipY - 8, 0.12, C.black, tipX, 8, 0);
  top.box(2.4, 2.2, 2.4, C.yellowDark, tipX, 6, 0);
}

/** Guindaste de pórtico sobre trilhos (estilo portal clássico), lado do mar em +X. */
export function portalCrane(f: Frame, color: string, slew = 0) {
  for (const sz of [-4.5, 4.5]) {
    f.box(12, 1.4, 1.6, C.steelDark, 0, 0, sz);
    for (const sx of [-5, 5])
      f.strut([sx, 1.2, sz], [0, 11, sz * 0.4], 1.1, color);
  }
  f.box(4.5, 2, 4.5, color, 0, 10.5, 0);
  f.cyl(1.4, 9, color, 0, 12.5, 0, 8);
  const top = f.sub(0, 21.5, 0, slew);
  top.box(8, 4, 5, C.white, -1.5, 0, 0);
  top.box(3, 2.5, 5, C.steelDark, -6.5, 0.6, 0);
  top.box(2.6, 2.6, 2.4, color, 3, 0.6, 2.2);
  top.glass(0.2, 1.2, 2, 4.32, 1.6, 2.2);
  const boom = top.sub(1, 3.5, 0, 0, 0, 0.5);
  boom.beam(30, 1.2, 1.6, color, 15, 0, 0);
  boom.strut([4, 0, 0], [16, 5, 0], 0.7, color);
  boom.strut([16, 5, 0], [30, 0.6, 0], 0.7, color);
  const tipX = 1 + Math.cos(0.5) * 30,
    tipY = 3.5 + Math.sin(0.5) * 30;
  top.box(0.12, tipY - 4, 0.12, C.black, tipX, 4, 0);
  top.box(2, 2, 2, C.yellowDark, tipX, 2.5, 0);
}

/** Pórtico de pátio sobre pneus (RTG), vão ao longo de Z. */
export function rtgCrane(f: Frame, color: string = C.white) {
  const span = 23,
    h = 20,
    wb = 12;
  for (const sz of [-span / 2, span / 2]) {
    for (const sx of [-wb / 2, wb / 2]) {
      f.box(1.4, h, 1.4, color, sx, 0, sz);
      f.cyl(0.8, 1.2, C.black, sx - 1.2, 0.8, sz, 8, Math.PI / 2);
      f.cyl(0.8, 1.2, C.black, sx + 1.2, 0.8, sz, 8, Math.PI / 2);
    }
    f.box(wb + 4, 1.2, 1.8, color, 0, 1.2, sz);
    f.strut([-wb / 2, 3, sz], [wb / 2, h - 2, sz], 0.6, color);
  }
  for (const sx of [-wb / 2, wb / 2]) f.box(1.8, 2, span + 2, color, sx, h, 0);
  f.box(wb + 1.8, 1.4, 2, color, 0, h + 0.6, -span / 2);
  f.box(wb + 1.8, 1.4, 2, color, 0, h + 0.6, span / 2);
  f.box(6, 2.4, 3, C.offWhite, 0, h + 2, 3);
  f.box(3.6, 2.4, 2.4, C.red, -4, 2, -span / 2 + 2.5);
  f.box(0.1, 7, 0.1, C.black, -1, h - 7, 3);
  f.box(0.1, 7, 0.1, C.black, 1, h - 7, 3);
  f.box(12, 0.8, 2.6, C.yellowDark, 0, h - 8, 3);
}

/** Carregador de navios para granéis, com correia até a ponta da lança. Lado do mar em +X. */
export function shipLoader(f: Frame, color: string = C.yellow) {
  for (const sz of [-5, 5]) {
    f.box(14, 1.4, 1.6, C.steelDark, 0, 0, sz);
    f.strut([-5, 1.3, sz], [0, 16, sz * 0.3], 1.3, color);
    f.strut([5, 1.3, sz], [0, 16, sz * 0.3], 1.3, color);
  }
  f.box(7, 3, 6, color, 0, 15, 0);
  f.box(5, 6, 5, C.white, -4, 18, 0);
  f.glass(0.2, 1.4, 3.5, -1.4, 21.5, 0);
  const boom = f.sub(0, 22, 0, 0, 0, -0.05);
  boom.beam(40, 2.2, 3.4, color, 18, 0, 0);
  boom.beam(40, 0.6, 2.2, C.steelDark, 18, 1.4, 0);
  for (let i = 0; i < 38; i += 5)
    boom.strut([i, -1, 1.7], [i + 2.5, 1, 1.7], 0.35, color);
  f.box(2.4, 12, 2.4, color, 38, 10, 0);
  f.strut([-4, 26, 0], [36, 23, 0], 0.35, C.steelDark);
  f.strut([-6, 21, 0], [-4, 30, 0], 0.9, color);
}

// ---------- Edificações ----------

/** Armazém com telhado em arco (galpão lonado/metálico), comprimento em X. */
export function archWarehouse(
  f: Frame,
  length: number,
  width: number,
  wall: string = C.wallBlue,
  roof: string = C.roof,
) {
  const h = Math.min(10, width * 0.22 + 4);
  f.box(length, h, width, wall, 0, 0, 0);
  f.box(length + 0.4, 0.8, width + 0.4, C.white, 0, h - 0.8, 0);
  f.arch(length, width + 0.6, width * 0.26, roof, 0, h, 0);
  for (let x = -length / 2 + 8; x < length / 2 - 4; x += 16)
    f.box(5, 5.5, 0.3, C.steelDark, x, 0, width / 2 + 0.1);
}

/** Galpão industrial de duas águas com faixa azul, como nos terminais low-poly. */
export function gableWarehouse(
  f: Frame,
  length: number,
  width: number,
  height = 12,
  wall: string = C.white,
  band: string = C.wallBlue,
) {
  f.box(length, height, width, wall, 0, 0, 0);
  f.box(length + 0.2, height * 0.35, width + 0.2, band, 0, 0, 0);
  f.gable(
    length + 1,
    width + 1.2,
    Math.min(width * 0.18, 9),
    C.roof,
    0,
    height,
    0,
  );
  for (let x = -length / 2 + 10; x < length / 2 - 6; x += 20) {
    f.box(6, 6, 0.3, C.steelDark, x, 0, width / 2 + 0.1);
    f.box(6, 6, 0.3, C.steelDark, x, 0, -width / 2 - 0.1);
  }
  // Clarabóias ao longo da cumeeira.
  for (let x = -length / 2 + 12; x < length / 2 - 8; x += 24)
    f.box(
      8,
      0.3,
      2,
      "#a9d3e6",
      x,
      height + Math.min(width * 0.18, 9) * 0.55,
      width * 0.2,
    );
}

/** Prédio administrativo de poucos pavimentos. */
export function office(
  f: Frame,
  w: number,
  d: number,
  floors: number,
  accent: string = C.wallBlue,
) {
  const fh = 3.6;
  f.box(w, floors * fh, d, C.offWhite, 0, 0, 0);
  for (let i = 0; i < floors; i++) {
    f.glass(w + 0.1, 1.4, d + 0.1, 0, i * fh + 1.2, 0);
  }
  f.box(w + 0.4, 0.8, d + 0.4, accent, 0, floors * fh, 0);
  f.box(w * 0.3, 2, d * 0.3, C.steel, w * 0.15, floors * fh + 0.8, 0);
}

export function checkpoint(f: Frame, width: number) {
  f.box(width, 0.8, 12, C.white, 0, 6, 0);
  f.box(width + 0.2, 0.4, 12.2, C.red, 0, 6.8, 0);
  for (const sx of [-width / 2 + 1, width / 2 - 1])
    f.box(0.8, 6, 0.8, C.steel, sx, 0, 0);
  f.box(3, 3, 3, C.offWhite, 0, 0, 0);
  f.glass(3.1, 1.2, 3.1, 0, 1.4, 0);
  f.box(0.3, 1, 5, C.red, 0, 0, 5);
}

export function storageTank(
  f: Frame,
  r: number,
  h: number,
  color: string = C.white,
  band?: string,
) {
  f.cyl(r, h, color, 0, 0, 0, 20);
  if (band) f.cyl(r * 1.01, h * 0.12, band, 0, h * 0.78, 0, 20);
  f.cone(r * 1.01, r * 0.18, C.offWhite, 0, h, 0, 20);
  f.cyl(r * 1.02, 0.6, C.steel, 0, h * 0.5, 0, 20);
  // Escada helicoidal simplificada e bacia de contenção.
  f.strut([r, 0.5, 0], [r * 0.2, h, r * 0.98], 0.6, C.steelDark);
}

export function bundWall(f: Frame, w: number, d: number) {
  f.box(w, 1.4, 0.8, C.concreteDark, 0, 0, -d / 2);
  f.box(w, 1.4, 0.8, C.concreteDark, 0, 0, d / 2);
  f.box(0.8, 1.4, d, C.concreteDark, -w / 2, 0, 0);
  f.box(0.8, 1.4, d, C.concreteDark, w / 2, 0, 0);
}

export function silo(f: Frame, r: number, h: number) {
  f.cyl(r, h, C.offWhite, 0, 0, 0, 12);
  f.cone(r, r * 0.7, C.steel, 0, h, 0, 12);
  f.cyl(r * 1.02, 0.6, C.steelDark, 0, h * 0.3, 0, 12);
}

/** Pilha de granel sólido em tronco de pirâmide. */
export function stockpile(
  f: Frame,
  length: number,
  width: number,
  h: number,
  color: string,
) {
  f.box(length, h * 0.5, width, color, 0, 0, 0);
  f.box(length * 0.8, h * 0.35, width * 0.62, color, 0, h * 0.5, 0);
  f.box(length * 0.55, h * 0.2, width * 0.3, color, 0, h * 0.85, 0);
}

/** Galeria de correia transportadora elevada entre dois pontos (coordenadas do referencial). */
export function conveyor(
  f: Frame,
  a: [number, number],
  b: [number, number],
  height = 14,
) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    len = Math.hypot(dx, dz),
    ry = Math.atan2(-dz, dx);
  const g = f.sub(a[0], 0, a[1], ry);
  g.box(len, 2.6, 3.2, C.offWhite, len / 2, height, 0);
  g.box(len, 0.4, 3.4, C.steel, len / 2, height + 2.6, 0);
  for (let x = 12; x < len - 4; x += 30) {
    g.box(1, height, 1, C.steelDark, x, 0, -1.2);
    g.box(1, height, 1, C.steelDark, x, 0, 1.2);
    g.strut([x, 0, -1.2], [x, height, 1.2], 0.35, C.steelDark);
  }
  g.box(6, height + 5, 6, C.offWhite, 0, 0, 0);
  g.box(6.4, 1, 6.4, C.wallBlue, 0, height + 5, 0);
}

export function pipeRack(
  f: Frame,
  a: [number, number],
  b: [number, number],
  height = 4,
) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    len = Math.hypot(dx, dz),
    ry = Math.atan2(-dz, dx);
  const g = f.sub(a[0], 0, a[1], ry);
  for (let x = 4; x < len; x += 12) {
    g.box(0.5, height, 0.5, C.steelDark, x, 0, -2);
    g.box(0.5, height, 0.5, C.steelDark, x, 0, 2);
    g.box(0.5, 0.5, 4.5, C.steelDark, x, height, 0);
  }
  const colors = [C.offWhite, C.yellow, C.offWhite, C.red];
  colors.forEach((color, i) =>
    g.cyl(0.35, len, color, len / 2, height + 0.9, -1.5 + i, 8, 0, Math.PI / 2),
  );
}

/** Braços de carregamento marítimo para granéis líquidos. Lado do mar em +X. */
export function loadingArms(f: Frame, count = 3) {
  for (let i = 0; i < count; i++) {
    const z = (i - (count - 1) / 2) * 5;
    f.box(1.4, 9, 1.4, C.steelDark, 0, 0, z);
    f.strut([0, 9, z], [5, 13, z], 0.6, C.orange);
    f.strut([5, 13, z], [8, 4, z], 0.5, C.orange);
    f.cyl(0.6, 1.2, C.black, 0, 9, z, 8);
  }
  f.box(6, 3, 18, C.offWhite, -6, 0, 0);
  f.glass(0.2, 1, 12, -2.9, 1.5, 0);
}

// ---------- Veículos ----------

export function truck(f: Frame, cab: string, cargo: string | null) {
  f.box(3, 3, 2.5, cab, 5.5, 0.9, 0);
  f.glass(0.2, 1.2, 2.2, 7.02, 2.4, 0);
  f.box(3.4, 0.5, 2.5, C.black, 5.3, 0.4, 0);
  f.box(11, 0.5, 2.5, C.black, -1.5, 1, 0);
  for (const x of [6, 1, -5, -6.4])
    for (const z of [-1.2, 1.2])
      f.cyl(0.55, 0.5, C.black, x, 0.55, z, 8, Math.PI / 2);
  if (cargo) container(f, -1.4, 1.5, 0, cargo);
}

export function reachStacker(f: Frame, color: string) {
  f.box(9, 2.4, 4, color, 0, 0.8, 0);
  f.box(2.4, 2.6, 2.4, color, -1, 3.2, 1);
  f.glass(2.5, 1.2, 2.5, -1, 4, 1);
  f.box(4, 1.6, 4.2, C.steelDark, -4, 2.2, 0);
  for (const x of [3, -3])
    for (const z of [-2, 2])
      f.cyl(0.9, 0.8, C.black, x, 0.9, z, 8, Math.PI / 2);
  f.beam(14, 1.3, 1.3, color, 4, 7.5, -0.2, 0, 0, 0.55);
  f.box(1.2, 1.2, 6.5, C.yellowDark, 10, 10, -0.2);
}

export function forklift(f: Frame, color: string) {
  f.box(3, 1.4, 1.8, color, 0, 0.4, 0);
  f.box(0.1, 2.4, 0.1, C.black, -0.6, 1.8, -0.8);
  f.box(0.1, 2.4, 0.1, C.black, -0.6, 1.8, 0.8);
  f.box(1.6, 0.1, 1.8, C.black, -0.6, 4.2, 0);
  f.box(0.3, 3.2, 1, C.steelDark, 1.7, 0.4, 0);
  f.box(1.2, 0.1, 1, C.steelDark, 2.3, 0.4, 0);
}

export function car(f: Frame, color: string) {
  f.box(4.4, 0.9, 1.8, color, 0, 0.35, 0);
  f.box(2.4, 0.7, 1.6, color, -0.2, 1.25, 0);
  f.glass(2.5, 0.5, 1.65, -0.2, 1.3, 0);
  for (const x of [-1.4, 1.4])
    for (const z of [-0.85, 0.85])
      f.cyl(0.36, 0.3, C.black, x, 0.36, z, 6, Math.PI / 2);
}

export function pallets(f: Frame, r: Rand, w: number, d: number) {
  for (let x = -w / 2 + 1.5; x < w / 2 - 1; x += 2.6)
    for (let z = -d / 2 + 1.5; z < d / 2 - 1; z += 2.6) {
      if (r() < 0.25) continue;
      const h = 1 + Math.floor(r() * 3) * 0.9;
      f.box(
        1.9,
        h,
        1.9,
        pick([C.sand, "#c9a46b", C.offWhite, C.wallBlue], r),
        x,
        0,
        z,
      );
    }
}

export function locomotive(f: Frame, color: string = C.yellow) {
  f.box(20, 1.2, 3, C.black, 0, 0.8, 0);
  f.box(14, 3.4, 2.8, color, -1.5, 2, 0);
  f.box(4, 4, 3, color, 7.5, 2, 0);
  f.glass(0.2, 1.2, 2.6, 9.55, 4.2, 0);
  f.box(20.2, 0.4, 3.1, C.red, 0, 2.2, 0);
}

export function hopperWagon(f: Frame, color: string = C.rust) {
  f.box(15, 0.8, 2.8, C.black, 0, 0.8, 0);
  f.box(14, 3, 3, color, 0, 1.6, 0);
  f.box(3, 1.4, 2.4, color, -4, 0.3, 0);
  f.box(3, 1.4, 2.4, color, 4, 0.3, 0);
}

export function tankWagon(f: Frame, color: string = C.white) {
  f.box(15, 0.8, 2.6, C.black, 0, 0.8, 0);
  f.cyl(1.5, 13.5, color, 0, 3.2, 0, 12, 0, Math.PI / 2);
  f.box(1.2, 0.8, 1.2, C.steelDark, 0, 4.6, 0);
}

export function flatWagon(f: Frame, r: Rand) {
  f.box(15, 1.2, 2.8, C.steelDark, 0, 0.8, 0);
  container(f, 0, 2, 0, pick(CONTAINER_COLORS, r));
}

// ---------- Embarcações ----------

export type ShipKind = "bulk" | "tanker" | "cargo" | "tug" | "generic";

function hullShape(L: number, B: number) {
  const s = new THREE.Shape(),
    h = L / 2,
    b = B / 2;
  s.moveTo(-h, -b * 0.92);
  s.lineTo(-h + L * 0.03, -b);
  s.lineTo(h - L * 0.2, -b);
  s.lineTo(h - L * 0.08, -b * 0.72);
  s.lineTo(h, 0);
  s.lineTo(h - L * 0.08, b * 0.72);
  s.lineTo(h - L * 0.2, b);
  s.lineTo(-h + L * 0.03, b);
  s.lineTo(-h, b * 0.92);
  s.closePath();
  return s;
}

function extrudeUp(shape: THREE.Shape, y0: number, y1: number) {
  // A extrusão ocorre em +Z; girar -90° em X leva o plano XY ao plano XZ com Z em Y.
  return new THREE.ExtrudeGeometry(shape, {
    depth: y1 - y0,
    bevelEnabled: false,
  })
    .rotateX(-Math.PI / 2)
    .translate(0, y0, 0);
}

/** Casco em duas cores (fundo antiincrustante e costado) mais convés. */
function hull(
  f: Frame,
  L: number,
  B: number,
  draft: number,
  freeboard: number,
  color: string,
) {
  const shape = hullShape(L, B);
  const lower = extrudeUp(shape, -draft, 0.8);
  const upper = extrudeUp(shape, 0.8, freeboard);
  const deck = extrudeUp(
    hullShape(L * 0.985, B * 0.94),
    freeboard - 0.2,
    freeboard + 0.05,
  );
  f.batch.addGeometry(lower.applyMatrix4(f.matrix), C.antifouling);
  f.batch.addGeometry(upper.applyMatrix4(f.matrix), color);
  f.batch.addGeometry(deck.applyMatrix4(f.matrix), C.deck);
  // Castelo de proa elevado.
  f.box(L * 0.1, 1.4, B * 0.7, color, L / 2 - L * 0.15, freeboard, 0);
}

function bridge(
  f: Frame,
  x: number,
  B: number,
  deckY: number,
  levels: number,
  funnel: string,
) {
  const w = Math.min(14, B * 0.5);
  f.box(w, levels * 2.8, B * 0.9, C.white, x, deckY, 0);
  f.box(w * 0.7, 2.8, B * 1.12, C.white, x + w * 0.1, deckY + levels * 2.8, 0);
  f.glass(0.3, 1.2, B * 1.1, x + w * 0.46, deckY + levels * 2.8 + 1.1, 0);
  for (let i = 0; i < levels; i++)
    f.glass(w + 0.1, 0.8, B * 0.62, x, deckY + i * 2.8 + 1.4, 0);
  f.box(3.5, 6, 4, funnel, x - w * 0.55, deckY + levels * 2.8, 0);
  f.box(3.6, 1.2, 4.1, C.black, x - w * 0.55, deckY + levels * 2.8 + 6, 0);
  f.box(0.4, 5, 0.4, C.steelDark, x + w * 0.1, deckY + (levels + 1) * 2.8, 0);
}

function deckCrane(
  f: Frame,
  x: number,
  deckY: number,
  color: string,
  side: number,
) {
  f.cyl(1.2, 10, color, x, deckY, 0, 8);
  f.box(3.2, 2.6, 3.2, color, x, deckY + 10, 0);
  f.strut([x, deckY + 11.5, 0], [x + 8, deckY + 18, side * 6], 0.8, color);
}

/**
 * Navio ilustrativo com base no tipo de carga. Comprimento em X (proa em +X),
 * linha d'água em y = 0.
 */
export function ship(f: Frame, kind: ShipKind, L: number, r: Rand) {
  if (kind === "tug") return tug(f);
  const B = Math.max(10, L * (kind === "tanker" ? 0.18 : 0.16));
  const freeboard = kind === "tanker" ? 6 : 8;
  const draft = Math.max(4, L * 0.045);
  const palette: Record<Exclude<ShipKind, "tug">, string[]> = {
    tanker: [C.greenHull, C.navy, C.red, "#2c6e8f"],
    bulk: [C.navy, C.redDark, "#3e4a55", C.teal],
    cargo: [C.navy, C.blue, C.redDark, C.greenHull],
    generic: ["#2c6e8f", C.navy, C.red],
  };
  const color = pick(palette[kind], r);
  hull(f, L, B, draft, freeboard, color);
  const deckY = freeboard;
  const aft = -L / 2 + L * 0.09;
  bridge(f, aft, B, deckY, kind === "cargo" ? 5 : 4, r() > 0.5 ? C.red : color);

  const start = aft + L * 0.08,
    end = L / 2 - L * 0.14;
  if (kind === "tanker") {
    for (let i = 0; i < 5; i++)
      f.cyl(
        0.55,
        end - start,
        C.offWhite,
        (start + end) / 2,
        deckY + 1.2,
        -B * 0.28 + i * B * 0.14,
        8,
        0,
        Math.PI / 2,
      );
    f.box(end - start, 0.6, 1.2, C.offWhite, (start + end) / 2, deckY, 0);
    for (let x = start + 6; x < end; x += 12)
      f.box(1, 1.8, B * 0.7, C.steelDark, x, deckY, 0);
    f.box(3, 3, B * 0.9, C.offWhite, (start + end) / 2, deckY, 0);
    f.strut(
      [(start + end) / 2, deckY + 3, 0],
      [(start + end) / 2 + 3, deckY + 7, 0],
      0.4,
      C.red,
    );
  } else if (kind === "bulk" || kind === "generic") {
    const holds = Math.max(4, Math.round((end - start) / 26));
    const step = (end - start) / holds;
    for (let i = 0; i < holds; i++) {
      const x = start + step * (i + 0.5);
      f.box(
        step * 0.72,
        1.8,
        B * 0.62,
        kind === "bulk" ? C.redDark : C.steelDark,
        x,
        deckY,
        0,
      );
      f.box(step * 0.72, 0.3, B * 0.64, C.black, x, deckY + 1.8, 0);
      if (i < holds - 1 && i % 2 === 0)
        deckCrane(f, x + step / 2, deckY, C.yellow, i % 4 === 0 ? 1 : -1);
    }
  } else {
    // Porta-contêineres: baias empilhadas com alturas variadas.
    const rows = Math.max(4, Math.floor((B - 2) / 2.5));
    for (let x = start + 7; x < end - 6; x += 13.2) {
      const tiers = 2 + Math.floor(r() * 4);
      for (let t = 0; t < tiers; t++)
        for (let row = 0; row < rows; row++)
          if (r() > 0.08)
            container(
              f,
              x,
              deckY + t * 2.6,
              (row - (rows - 1) / 2) * 2.5,
              pick(CONTAINER_COLORS, r),
            );
      f.box(0.6, tiers * 2.6 + 1, B * 0.9, C.steelDark, x + 6.8, deckY, 0);
    }
  }
  // Mastro de proa e âncoras.
  f.box(0.4, 7, 0.4, C.steelDark, L / 2 - L * 0.07, deckY + 1.2, 0);
  f.box(1.2, 1.2, 0.4, C.black, L / 2 - L * 0.1, freeboard - 2.2, B / 2 - 0.3);
  f.box(1.2, 1.2, 0.4, C.black, L / 2 - L * 0.1, freeboard - 2.2, -B / 2 + 0.3);
  return { beam: B, draft };
}

export function tug(f: Frame) {
  const L = 30,
    B = 11;
  hull(f, L, B, 3, 3.2, C.red);
  f.box(9, 3, 7.5, C.white, 2, 3.2, 0);
  f.box(6, 2.6, 8.4, C.white, 3, 6.2, 0);
  f.glass(0.3, 1.2, 8.2, 6.02, 7.2, 0);
  f.box(1.4, 4, 1.4, C.black, -1.5, 6.2, 0);
  f.box(3, 1.4, 3, C.red, -8, 3.2, 0);
  f.cyl(0.45, L * 0.95, C.black, 0, 2.8, B / 2, 8, 0, Math.PI / 2);
  f.cyl(0.45, L * 0.95, C.black, 0, 2.8, -B / 2, 8, 0, Math.PI / 2);
  return { beam: B, draft: 3 };
}
