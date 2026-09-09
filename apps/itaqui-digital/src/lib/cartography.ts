import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
export type CartographyCategory =
  "building" | "road" | "railway" | "area" | "pier" | "water";
export type CartographyProperties = {
  id: string;
  name: string;
  category: CartographyCategory;
  kind: string;
  sourceUrl: string;
  areaM2?: number;
  lengthM?: number;
  [key: string]: string | number | boolean | undefined;
};
export type CartographyFeature = Feature<Geometry, CartographyProperties>;
export type CartographyData = FeatureCollection<
  Geometry,
  CartographyProperties
>;
export type CartographyMeta = {
  fetchedAt: string;
  osmTimestamp?: string;
  attribution: string;
  counts: Record<CartographyCategory, number>;
};
export const CATEGORY_LABELS: Record<CartographyCategory, string> = {
  building: "Edifícios e tanques",
  road: "Vias e acessos",
  railway: "Ferrovias",
  area: "Áreas e pátios",
  pier: "Cais e píeres",
  water: "Água e costa",
};
export function featureBounds(
  feature: CartographyFeature,
): [[number, number], [number, number]] {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  const visit = (geometry: Geometry) => {
    if (geometry.type === "GeometryCollection")
      return geometry.geometries.forEach(visit);
    const walk = (coordinates: unknown) => {
      if (!Array.isArray(coordinates)) return;
      if (typeof coordinates[0] === "number") {
        const [lon, lat] = coordinates as Position;
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      } else coordinates.forEach(walk);
    };
    walk(geometry.coordinates);
  };
  visit(feature.geometry);
  return [
    [west, south],
    [east, north],
  ];
}
export function featureCenter(feature: CartographyFeature): [number, number] {
  const [[west, south], [east, north]] = featureBounds(feature);
  return [(west + east) / 2, (south + north) / 2];
}
const ATTRIBUTE_LABELS: Record<string, string> = {
  operator: "Operador",
  ref: "Referência",
  building: "Edificação",
  landuse: "Uso do solo",
  highway: "Classe da via",
  railway: "Classe ferroviária",
  surface: "Pavimento",
  lanes: "Faixas",
  maxspeed: "Velocidade sinalizada",
  access: "Acesso",
  service: "Serviço",
  usage: "Uso",
  height: "Altura cadastrada",
  levels: "Pavimentos",
  "building:levels": "Pavimentos",
  name: "Nome cadastrado",
  man_made: "Estrutura",
  industrial: "Atividade",
  substance: "Substância",
  content: "Conteúdo",
  bridge: "Ponte",
  tunnel: "Túnel",
  gauge: "Bitola",
  electrified: "Eletrificação",
  oneway: "Sentido único",
  amenity: "Equipamento",
  natural: "Elemento natural",
  water: "Corpo d’água",
  boundary: "Limite",
};
const VALUES: Record<string, string> = {
  school: "Escola",
  church: "Igreja",
  house: "Casa",
  shed: "Galpão",
  steps: "Escadaria",
  tertiary_link: "Ligação viária",
  trunk: "Via expressa",
  trunk_link: "Alça de acesso",
  track: "Caminho de acesso",
  path: "Trilha",
  yes: "Sim",
  no: "Não",
  private: "Privado",
  permissive: "Permitido",
  destination: "Acesso ao destino",
  asphalt: "Asfalto",
  paved: "Pavimentado",
  concrete: "Concreto",
  unpaved: "Não pavimentado",
  gravel: "Cascalho",
  ground: "Terra",
  warehouse: "Armazém",
  industrial: "Industrial",
  commercial: "Comercial",
  storage_tank: "Tanque de armazenamento",
  service: "Via de serviço",
  primary: "Principal",
  secondary: "Secundária",
  tertiary: "Terciária",
  residential: "Residencial",
  unclassified: "Via local",
  footway: "Caminho de pedestres",
  railway: "Ferrovia",
  rail: "Linha férrea",
  siding: "Desvio",
  spur: "Ramal",
  yard: "Pátio ferroviário",
  parking: "Estacionamento",
  port: "Portuário",
  harbour: "Portuário",
  pier: "Píer",
  quay: "Cais",
  forest: "Floresta",
  scrub: "Vegetação arbustiva",
  wood: "Bosque",
  wetland: "Área úmida",
  grass: "Gramado",
};
export function featureAttributes(feature: CartographyFeature) {
  const p = feature.properties;
  const entries: { label: string; value: string }[] = [];
  if (p.areaM2)
    entries.push({
      label: "Área do contorno",
      value: `${Math.round(p.areaM2).toLocaleString("pt-BR")} m²`,
    });
  if (p.lengthM)
    entries.push({
      label: "Extensão mapeada",
      value: `${Math.round(p.lengthM).toLocaleString("pt-BR")} m`,
    });
  for (const [key, label] of Object.entries(ATTRIBUTE_LABELS)) {
    const value = p[key];
    if (key === "name" || value == null || value === "") continue;
    entries.push({ label, value: VALUES[String(value)] ?? String(value) });
  }
  return entries;
}
export function searchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function featureSummary(feature: CartographyFeature) {
  const p = feature.properties;
  return String(
    p.operator ||
      p.ref ||
      (p.areaM2
        ? `${Math.round(p.areaM2).toLocaleString("pt-BR")} m² de contorno`
        : p.lengthM
          ? `${Math.round(p.lengthM).toLocaleString("pt-BR")} m de extensão`
          : CATEGORY_LABELS[p.category]),
  );
}
export function distanceFromPort(feature: CartographyFeature) {
  const [lon, lat] = featureCenter(feature);
  return (lon + 44.367) ** 2 + (lat + 2.576) ** 2;
}
