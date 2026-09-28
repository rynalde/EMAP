import * as THREE from "three";
import type { XZ } from "./geo";

/*
 * Vias e ferrovias como faixas contínuas: a linha central do OSM é suavizada
 * (Chaikin) sem mover os nós compartilhados com outras linhas, e a faixa é
 * montada com juntas em meia-esquadria, sem sobreposição de segmentos.
 */

const key = (p: XZ) => `${Math.round(p.x * 2)}:${Math.round(p.z * 2)}`;

/** Remove pontos repetidos ou quase coincidentes (< 0,5 m). */
export function clean(line: XZ[]) {
  const out: XZ[] = [];
  for (const p of line) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.5) out.push(p);
  }
  return out;
}

/** Nós usados por mais de uma linha (cruzamentos e emendas): ficam fixos na suavização. */
export function junctionNodes(lines: XZ[][]) {
  const count = new Map<string, number>();
  for (const line of lines)
    for (const p of line) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
}

function chaikinPiece(line: XZ[], iterations: number) {
  let pts = line;
  for (let it = 0; it < iterations && pts.length > 2; it++) {
    const next: XZ[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const q = { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 },
        r = { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 };
      if (i > 0) next.push(q);
      if (i < pts.length - 2) next.push(r);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/** Suaviza curvas mantendo extremidades e nós de junção nos lugares originais. */
export function smooth(line: XZ[], fixed: Set<string>, iterations = 3) {
  const pts = clean(line);
  if (pts.length < 3) return pts;
  const out: XZ[] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (i === pts.length - 1 || fixed.has(key(pts[i]))) {
      const piece = chaikinPiece(pts.slice(start, i + 1), iterations);
      out.push(...(out.length ? piece.slice(1) : piece));
      start = i;
    }
  }
  return out;
}

/** Acumula triângulos voltados para cima em arrays de posição. */
export class FlatMesh {
  positions: number[] = [];

  tri(a: XZ, b: XZ, c: XZ, y: number) {
    // Garante a face voltada para +Y (produto vetorial com componente y positiva).
    const cross = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const [p, q] = cross >= 0 ? [b, c] : [c, b];
    this.positions.push(a.x, y, a.z, p.x, y, p.z, q.x, y, q.z);
  }

  /** Faixa de largura constante ao longo da linha, com juntas em meia-esquadria. */
  strip(line: XZ[], width: number, y: number) {
    if (line.length < 2) return;
    const hw = width / 2;
    const left: XZ[] = [],
      right: XZ[] = [];
    for (let i = 0; i < line.length; i++) {
      const prev = line[Math.max(0, i - 1)],
        next = line[Math.min(line.length - 1, i + 1)];
      const a = i > 0 ? unit(prev, line[i]) : unit(line[i], next),
        b = i < line.length - 1 ? unit(line[i], next) : a;
      let tx = a.x + b.x,
        tz = a.z + b.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // Normal da tangente média; o comprimento compensa o ângulo da junta.
      const nx = -tz,
        nz = tx;
      const cos = Math.max(0.35, nx * -a.z + nz * a.x);
      const m = hw / cos;
      left.push({ x: line[i].x + nx * m, z: line[i].z + nz * m });
      right.push({ x: line[i].x - nx * m, z: line[i].z - nz * m });
    }
    for (let i = 0; i < line.length - 1; i++) {
      this.tri(left[i], right[i], left[i + 1], y);
      this.tri(right[i], right[i + 1], left[i + 1], y);
    }
  }

  disc(c: XZ, r: number, y: number, segments = 18) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2,
        a1 = ((i + 1) / segments) * Math.PI * 2;
      this.tri(
        c,
        { x: c.x + Math.cos(a0) * r, z: c.z + Math.sin(a0) * r },
        { x: c.x + Math.cos(a1) * r, z: c.z + Math.sin(a1) * r },
        y,
      );
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(this.positions), 3),
    );
    g.computeVertexNormals();
    return g;
  }
}

function unit(a: XZ, b: XZ) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

/** Pontos a cada `step` metros ao longo da linha, com a direção local. */
export function* stations(line: XZ[], step: number, offset = 0) {
  let carry = offset;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      len = Math.hypot(b.x - a.x, b.z - a.z);
    const angle = Math.atan2(-(b.z - a.z), b.x - a.x);
    for (let d = carry; d < len; d += step) {
      const t = d / len;
      yield { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, angle };
    }
    carry = (((carry - len) % step) + step) % step;
  }
}

export { key as nodeKey };
