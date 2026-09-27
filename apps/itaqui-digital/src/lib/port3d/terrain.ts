import * as THREE from "three";
import { project, type XZ } from "./geo";

/**
 * Cobertura do solo ESA WorldCover (10 m, 2021, CC BY 4.0), recortada para o entorno do
 * porto em `public/data/port-landcover.png` (um byte de classe por pixel).
 */
export type LandCover = {
  classes: Uint8Array;
  width: number;
  height: number;
  /** [oeste, sul, leste, norte] em graus. */
  bounds: [number, number, number, number];
};

export const LC = {
  tree: 10,
  shrub: 20,
  grass: 30,
  crop: 40,
  built: 50,
  bare: 60,
  water: 80,
  wetland: 90,
  mangrove: 95,
  moss: 100,
} as const;

/** Classes cobertas por vegetação alta (dossel). */
export const isCanopy = (c: number) => c === LC.tree || c === LC.mangrove;
export const isVegetation = (c: number) =>
  c === LC.tree ||
  c === LC.mangrove ||
  c === LC.shrub ||
  c === LC.grass ||
  c === LC.crop ||
  c === LC.wetland;

/** Decodifica o PNG de classes sem conversão de cor, preservando os códigos. */
export async function loadLandCover(
  pngUrl: string,
  metaUrl: string,
): Promise<LandCover> {
  const [blob, meta] = await Promise.all([
    fetch(pngUrl).then((r) => {
      if (!r.ok) throw Error("Cobertura do solo indisponível");
      return r.blob();
    }),
    fetch(metaUrl).then((r) => {
      if (!r.ok) throw Error("Cobertura do solo indisponível");
      return r.json() as Promise<{
        bounds: [number, number, number, number];
      }>;
    }),
  ]);
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const classes = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < classes.length; i++) classes[i] = rgba[i * 4];
  bitmap.close();
  return {
    classes,
    width: canvas.width,
    height: canvas.height,
    bounds: meta.bounds,
  };
}

export function classAt(lc: LandCover, lon: number, lat: number) {
  const [w, s, e, n] = lc.bounds;
  const i = Math.floor(((lon - w) / (e - w)) * lc.width),
    j = Math.floor(((n - lat) / (n - s)) * lc.height);
  if (i < 0 || j < 0 || i >= lc.width || j >= lc.height) return LC.water;
  return lc.classes[j * lc.width + i];
}

/** Cores do terreno por classe (tons do estilo low-poly da cena). */
export const LC_COLOR: Record<number, string> = {
  [LC.tree]: "#3f7a36",
  [LC.shrub]: "#6f9444",
  [LC.grass]: "#9db36b",
  [LC.crop]: "#b3c277",
  [LC.built]: "#b7bbbf",
  [LC.bare]: "#b99a78",
  [LC.water]: "#5f8a7c",
  [LC.wetland]: "#7fa35f",
  [LC.mangrove]: "#4c7338",
  [LC.moss]: "#a7b08a",
};

/** Altura do topo (m) por classe: dossel para mata e mangue, chão baixo para o resto. */
const HEIGHT: Record<number, number> = {
  [LC.tree]: 10,
  [LC.shrub]: 4,
  [LC.grass]: 2.2,
  [LC.crop]: 2.2,
  [LC.built]: 2.6,
  [LC.bare]: 2.4,
  [LC.water]: -2.5,
  [LC.wetland]: 1.2,
  [LC.mangrove]: 6.5,
  [LC.moss]: 2,
};

const hash = (i: number, j: number) => {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Malha facetada do terreno a partir da cobertura do solo, amostrada a cada `step`
 * células. `keepWater(p)` força água onde a cena precisa de lâmina livre (berços, píeres).
 */
export function terrainGeometry(
  lc: LandCover,
  step: number,
  keepWater: (p: XZ) => boolean,
) {
  const [w, s, e, n] = lc.bounds;
  const cols = Math.floor(lc.width / step),
    rows = Math.floor(lc.height / step);
  const cls = new Uint8Array(cols * rows),
    pts: XZ[] = new Array(cols * rows),
    hgt = new Float32Array(cols * rows);
  const votes = new Map<number, number>();
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      // Classe majoritária do bloco `step`×`step`.
      votes.clear();
      for (let dj = 0; dj < step; dj++)
        for (let di = 0; di < step; di++) {
          const c = lc.classes[(j * step + dj) * lc.width + i * step + di];
          votes.set(c, (votes.get(c) ?? 0) + 1);
        }
      let best = LC.water as number,
        bestN = -1;
      votes.forEach((v, k) => {
        if (v > bestN) {
          best = k;
          bestN = v;
        }
      });
      const lon = w + ((i + 0.5) * step * (e - w)) / lc.width,
        lat = n - ((j + 0.5) * step * (n - s)) / lc.height;
      const p = project([lon, lat]);
      if (best !== LC.water && keepWater(p)) best = LC.water;
      const k = j * cols + i;
      cls[k] = best;
      pts[k] = p;
      const base = HEIGHT[best] ?? 2;
      hgt[k] = isCanopy(best) ? base + hash(i, j) * 2.5 : base;
    }
  // Dossel desce nas bordas: cada amostra de mata é ponderada pela fração de vizinhos
  // também cobertos, evitando o serrilhado de picos isolados.
  const smooth = new Float32Array(hgt);
  for (let j = 1; j < rows - 1; j++)
    for (let i = 1; i < cols - 1; i++) {
      const k = j * cols + i;
      if (!isCanopy(cls[k])) continue;
      let covered = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++)
          if (isCanopy(cls[k + dj * cols + di])) covered++;
      const ground = HEIGHT[LC.grass];
      smooth[k] = ground + (hgt[k] - ground) * Math.pow(covered / 9, 1.5);
    }
  hgt.set(smooth);

  const positions: number[] = [],
    colors: number[] = [];
  const color = new THREE.Color();
  const tri = (a: number, b: number, c: number) => {
    // Cor da face pela classe dominante dos três vértices (bordas nítidas).
    const ca = cls[a],
      cb = cls[b],
      cc = cls[c];
    const face = ca === cb || ca === cc ? ca : cb === cc ? cb : ca;
    color.set(LC_COLOR[face] ?? LC_COLOR[LC.grass]);
    const shade = 0.94 + hash(a, c) * 0.12;
    for (const v of [a, b, c]) {
      positions.push(pts[v].x, hgt[v], pts[v].z);
      colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
  };
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i,
        b = a + 1,
        c = a + cols,
        d = c + 1;
      if (
        cls[a] === LC.water &&
        cls[b] === LC.water &&
        cls[c] === LC.water &&
        cls[d] === LC.water
      )
        continue;
      // Diagonal alternada evita o serrilhado em uma só direção.
      if ((i + j) % 2) {
        tri(a, c, b);
        tri(b, c, d);
      } else {
        tri(a, c, d);
        tri(a, d, b);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  g.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(colors), 3),
  );
  g.computeVertexNormals();
  return g;
}
