import { PORT_CENTER } from "@/lib/port-data";

/** Metros por grau na latitude do porto (projeção local equiretangular). */
const LAT0 = (PORT_CENTER[1] * Math.PI) / 180;
export const M_PER_DEG_LAT =
  111132.92 - 559.82 * Math.cos(2 * LAT0) + 1.175 * Math.cos(4 * LAT0);
export const M_PER_DEG_LON =
  111412.84 * Math.cos(LAT0) - 93.5 * Math.cos(3 * LAT0);

export type XZ = { x: number; z: number };

/**
 * Converte lon/lat para o plano da cena: 1 unidade = 1 metro,
 * x para leste e z para o sul (o norte fica em -z, convenção do three.js).
 */
export function project([lon, lat]: [number, number] | number[]): XZ {
  return {
    x: (lon - PORT_CENTER[0]) * M_PER_DEG_LON,
    z: -(lat - PORT_CENTER[1]) * M_PER_DEG_LAT,
  };
}

export function unproject({ x, z }: XZ): [number, number] {
  return [
    PORT_CENTER[0] + x / M_PER_DEG_LON,
    PORT_CENTER[1] - z / M_PER_DEG_LAT,
  ];
}

/** Direção unitária de um rumo náutico (0° = norte, sentido horário) no plano da cena. */
export function headingVector(deg: number): XZ {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/** Rotação em torno de Y que alinha o eixo +X local ao rumo informado. */
export function headingToRotationY(deg: number) {
  const v = headingVector(deg);
  return Math.atan2(-v.z, v.x);
}

export function pointInPolygon(p: XZ, ring: XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.z > p.z !== b.z > p.z &&
      p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function distanceToSegment(p: XZ, a: XZ, b: XZ) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    len2 = dx * dx + dz * dz;
  const t = len2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
    : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

export function distanceToPolyline(p: XZ, line: XZ[]) {
  let d = Infinity;
  for (let i = 1; i < line.length; i++)
    d = Math.min(d, distanceToSegment(p, line[i - 1], line[i]));
  return d;
}

/**
 * Distância ao longo de um raio até o primeiro cruzamento com um conjunto de segmentos.
 * Usada para encostar o casco de cada navio na face do cais descrita pela linha de costa.
 */
export function rayHit(
  origin: XZ,
  dir: XZ,
  segments: [XZ, XZ][],
  maxDistance: number,
) {
  let best = Infinity;
  for (const [a, b] of segments) {
    const ex = b.x - a.x,
      ez = b.z - a.z,
      den = dir.x * ez - dir.z * ex;
    if (Math.abs(den) < 1e-9) continue;
    const ox = a.x - origin.x,
      oz = a.z - origin.z;
    const t = (ox * ez - oz * ex) / den,
      u = (ox * dir.z - oz * dir.x) / den;
    if (t >= 0 && t <= maxDistance && u >= 0 && u <= 1)
      best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : null;
}

export function polylineLength(line: XZ[]) {
  let total = 0;
  for (let i = 1; i < line.length; i++)
    total += Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z);
  return total;
}

/** Ponto e direção a uma distância ao longo da polilinha. */
export function sampleAlong(line: XZ[], distance: number) {
  let left = distance;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === line.length - 1) {
      const t = len ? Math.min(1, Math.max(0, left / len)) : 0;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        angle: Math.atan2(-(b.z - a.z), b.x - a.x),
      };
    }
    left -= len;
  }
  const p = line[line.length - 1];
  return { x: p.x, z: p.z, angle: 0 };
}

/** Retângulo orientado de menor área, testando as direções das arestas do polígono. */
export function orientedBox(ring: XZ[]) {
  let best: {
    cx: number;
    cz: number;
    length: number;
    width: number;
    angle: number;
    area: number;
  } | null = null;
  for (let i = 1; i < ring.length; i++) {
    const angle = Math.atan2(
      ring[i].z - ring[i - 1].z,
      ring[i].x - ring[i - 1].x,
    );
    const c = Math.cos(angle),
      s = Math.sin(angle);
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const p of ring) {
      const u = p.x * c + p.z * s,
        v = -p.x * s + p.z * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const u = (minU + maxU) / 2,
        v = (minV + maxV) / 2;
      const length = maxU - minU,
        width = maxV - minV;
      best = {
        cx: u * c - v * s,
        cz: u * s + v * c,
        length: Math.max(length, width),
        width: Math.min(length, width),
        // Rotação em Y do three.js para alinhar +X local ao lado mais longo.
        angle: length >= width ? -angle : -angle - Math.PI / 2,
        area,
      };
    }
  }
  return best!;
}

export function polygonArea(ring: XZ[]) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j].x + ring[i].x) * (ring[j].z - ring[i].z);
  return Math.abs(a / 2);
}
