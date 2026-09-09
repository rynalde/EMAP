import type { Place } from "./types";
export const PORT_CENTER: [number, number] = [-44.3668, -2.5757];
export const SOURCE_URL =
  "https://website.portodoitaqui.com.br/porto-itaqui/infraestrutura";
// Centros aproximados, interpretados da imagem de satélite e da sequência oficial de berços.
// Profundidades/comprimentos: tabela EMAP "bercos-planta-2023.jpg"; não são limites vigentes de navegação.
export const BERTHS: Place[] = [
  {
    id: "99",
    coordinates: [-44.3681, -2.58725],
    length: 264,
    depth: 15,
    heading: 350,
  },
  {
    id: "100",
    coordinates: [-44.36882, -2.58458],
    length: 320,
    depth: 15,
    heading: 350,
  },
  {
    id: "101",
    coordinates: [-44.36937, -2.58215],
    length: 223,
    depth: 12,
    heading: 350,
  },
  {
    id: "102",
    coordinates: [-44.36973, -2.58015],
    length: 223,
    depth: 12,
    heading: 350,
  },
  {
    id: "103",
    coordinates: [-44.3701, -2.5779],
    length: 270,
    depth: 15,
    heading: 350,
  },
  {
    id: "104",
    coordinates: [-44.37104, -2.57591],
    length: 200,
    depth: 13,
    heading: 326,
  },
  {
    id: "105",
    coordinates: [-44.3721, -2.57423],
    length: 280,
    depth: 18,
    heading: 326,
  },
  {
    id: "106",
    coordinates: [-44.37475, -2.57249],
    length: 340,
    depth: 19,
    heading: 305,
  },
  {
    id: "108",
    coordinates: [-44.37729, -2.5709],
    length: 300,
    depth: 15,
    heading: 305,
  },
].map((b) => ({
  ...b,
  coordinates: b.coordinates as [number, number],
  category: "berth",
  name: `Berço ${b.id.padStart(3, "0")}`,
  description:
    "Estrutura de atracação do Porto do Itaqui. Centro aproximado; características de referência da EMAP (2023).",
}));
export const PLACES: Place[] = [
  ...BERTHS,
  {
    id: "tegram",
    name: "TEGRAM",
    category: "terminal",
    coordinates: [-44.3644, -2.56825],
    description:
      "Terminal de Grãos do Maranhão. Conjunto de armazéns e correias para movimentação de granéis agrícolas.",
  },
  {
    id: "liquidos",
    name: "Parque de tancagem",
    category: "terminal",
    coordinates: [-44.3622, -2.5743],
    description:
      "Área de armazenamento de granéis líquidos, com tanques e conexões ao cais.",
  },
  {
    id: "armazens",
    name: "Armazéns do cais",
    category: "building",
    coordinates: [-44.36765, -2.57835],
    description: "Área de armazenagem junto ao cais.",
  },
  {
    id: "acesso",
    name: "Acesso terrestre",
    category: "building",
    coordinates: [-44.3657, -2.5754],
    description:
      "Conexões logísticas à área portuária. O porto possui acesso pelas rodovias BR-135 e BR-222 e pelas ferrovias EFC e FTL.",
  },
];
export const OFFICIAL_LINKS = [
  {
    label: "Porto Agora",
    url: "https://website.portodoitaqui.com.br/home#porto-agora",
  },
  {
    label: "Programação de navios",
    url: "https://www.portodoitaqui.com.br/porto-agora/navios/atracados",
  },
  { label: "Infraestrutura e berços", url: SOURCE_URL },
  {
    label: "Movimentação de cargas",
    url: "https://website.portodoitaqui.com.br/porto-itaqui/indicadores-operacionais/movimentacao-carga",
  },
  {
    label: "Tarifas portuárias",
    url: "https://website.portodoitaqui.com.br/porto-itaqui/tarifas-portuarias",
  },
  {
    label: "Localização e acessos",
    url: "https://website.portodoitaqui.com.br/porto-itaqui/localizacao",
  },
];
export function localTime(value: string | number | undefined) {
  if (!value) return "—";
  const d =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime())
    ? value.toString()
    : d.toLocaleTimeString("pt-BR", {
        timeZone: "America/Fortaleza",
        hour: "2-digit",
        minute: "2-digit",
      });
}
export function weatherLabel(code: number) {
  if (code === 0) return "Céu aberto";
  if (code <= 2) return "Parcialmente nublado";
  if (code === 3) return "Nublado";
  if (code <= 48) return "Neblina";
  if (code <= 67) return "Chuva";
  if (code <= 77) return "Precipitação";
  if (code <= 82) return "Pancadas de chuva";
  return "Trovoadas";
}
