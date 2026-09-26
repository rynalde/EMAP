import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";
import { BERTHS } from "@/lib/port-data";
import type { Vessel } from "@/lib/types";
import {
  headingToRotationY,
  headingVector,
  project,
  rayHit,
  type XZ,
} from "./geo";

/** Cota do terrapleno do cais acima da água, em metros (valor ilustrativo). */
export const GROUND = 3;

/**
 * A linha de costa do OpenStreetMap termina nas bordas do recorte do porto.
 * Estes pontos fecham o continente a leste, fora da área detalhada, para formar
 * o terreno; não representam uma costa levantada.
 */
const LAND_CLOSURE: [number, number][] = [
  [-44.3652, -2.5823],
  [-44.3622, -2.5852],
  [-44.3545, -2.5885],
  [-44.345, -2.5875],
  [-44.344, -2.556],
  [-44.3655, -2.5555],
  [-44.3702, -2.5625],
  [-44.371, -2.5685],
];

export type BerthLayout = {
  id: string;
  name: string;
  length: number;
  depth?: number;
  heading: number;
  /** Centro aproximado informado para o navio atracado. */
  center: XZ;
  /** Unitário ao longo do berço, no sentido do rumo de referência. */
  along: XZ;
  /** Unitário do navio para o cais (terra). */
  normal: XZ;
  /** Ponto médio da face do cais. */
  quay: XZ;
  /** true quando a face do cais foi encontrada na linha de costa do OSM. */
  onCoast: boolean;
};

export function coastlineChain(cartography: FeatureCollection<Geometry>) {
  const coast = cartography.features.find(
    (f) => f.properties?.kind === "coastline",
  );
  const g = coast?.geometry;
  const lines =
    g?.type === "MultiLineString"
      ? g.coordinates
      : g?.type === "LineString"
        ? [g.coordinates]
        : [];
  const chain: [number, number][] = [];
  for (const line of lines)
    for (const p of line) {
      const last = chain[chain.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1])
        chain.push([p[0], p[1]]);
    }
  return chain;
}

/** Contorno do terreno: linha de costa do OSM fechada pelo continente. */
export function landRing(cartography: FeatureCollection<Geometry>): XZ[] {
  const chain = coastlineChain(cartography);
  if (chain.length < 3) return [];
  return [...chain, ...LAND_CLOSURE].map(project);
}

export function boundaryRing(boundary: Feature<Geometry>): XZ[] {
  const g = boundary.geometry;
  const ring =
    g.type === "Polygon"
      ? (g as Polygon).coordinates[0]
      : g.type === "MultiPolygon"
        ? g.coordinates[0][0]
        : [];
  return ring.map(project);
}

export function ringSegments(ring: XZ[]): [XZ, XZ][] {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
}

/** Recuo padrão da face do cais quando não há costa mapeada (píeres novos). */
const DEFAULT_QUAY_OFFSET = 24;

export function berthLayouts(land: XZ[]): BerthLayout[] {
  const segments = ringSegments(land);
  return BERTHS.map((b) => {
    const heading = b.heading ?? 0;
    const along = headingVector(heading);
    const normal = headingVector(heading + 90);
    const center = project(b.coordinates);
    const hit = segments.length ? rayHit(center, normal, segments, 70) : null;
    const d = hit ?? DEFAULT_QUAY_OFFSET;
    return {
      id: b.id,
      name: b.name,
      length: b.length ?? 250,
      depth: b.depth,
      heading,
      center,
      along,
      normal,
      quay: { x: center.x + normal.x * d, z: center.z + normal.z * d },
      onCoast: hit !== null,
    };
  });
}

/** Posição do navio encostado na face do cais, com folga de defensas. */
export function shipPose(berth: BerthLayout, beam: number) {
  const off = beam / 2 + 2.5;
  return {
    x: berth.quay.x - berth.normal.x * off,
    z: berth.quay.z - berth.normal.z * off,
    rotationY: headingToRotationY(berth.heading),
  };
}

/**
 * Navios que a programação EMAP coloca em um berço com registro recente.
 * Segue a mesma regra do mapa 2D: sem berço conhecido ou dado antigo, sem posição.
 */
export function berthedVessels(vessels: Vessel[]) {
  const byBerth = new Map<string, Vessel>();
  for (const v of vessels)
    if (
      v.status === "atracado" &&
      v.positionSource === "berth" &&
      !v.stale &&
      v.berth &&
      BERTHS.some((b) => b.id === v.berth) &&
      !byBerth.has(v.berth)
    )
      byBerth.set(v.berth, v);
  return byBerth;
}
