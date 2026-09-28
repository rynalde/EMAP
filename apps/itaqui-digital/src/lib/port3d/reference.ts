import data from "./reference-data.json";

/*
 * Estruturas do porto posicionadas a partir de imagem de satélite (ver `source` em
 * reference-data.json). Posições e dimensões são aproximadas (±5–10 m) e servem para a
 * representação 3D; não são levantamento topográfico nem cadastro oficial.
 */

export type LonLat = [number, number];

export type RefBuilding = {
  id: string;
  name?: string;
  lon: number;
  lat: number;
  /** Comprimento e largura em metros. */
  length: number;
  width: number;
  /** Direção do lado mais longo, em graus anti-horários a partir do leste. */
  angle: number;
  /** Altura das paredes em metros. */
  height: number;
  roof: string;
  wall: string;
  style: "gable" | "arch" | "flat";
};

export type RefTank = {
  lon: number;
  lat: number;
  /** Raio em metros. */
  r: number;
  kind: "white" | "beige" | "rust" | "gray" | "water";
};

export type RefConveyor = { path: LonLat[]; height: number };

export type RefJetty = {
  /** Berços atendidos por plataformas sobre estacas, e não por cais contínuo. */
  berths: string[];
  /** Eixo da ponte de acesso, do continente para o mar. */
  path: LonLat[];
  width: number;
};

export type Reference = {
  source: {
    imagery: string;
    captured: string;
    method: string;
  };
  buildings: RefBuilding[];
  tanks: RefTank[];
  conveyors: RefConveyor[];
  jetties: RefJetty[];
};

export const REFERENCE = data as Reference;
