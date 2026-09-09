import type {
  Map,
  GeoJSONSource,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";
import type { CartographyData } from "./cartography";
import type { Layers } from "./types";
const SOURCE = "port-cartography";
export const CARTOGRAPHY_HIT_LAYERS = [
  "detail-buildings",
  "detail-roads",
  "detail-railways",
  "detail-piers",
  "detail-areas",
  "detail-water",
  "detail-water-lines",
];
const visibilityGroups: Record<string, keyof Layers> = {
  "detail-buildings": "buildings",
  "detail-building-outlines": "buildings",
  "detail-roads": "roads",
  "detail-road-casing": "roads",
  "detail-road-labels": "roads",
  "detail-railways": "railways",
  "detail-railway-casing": "railways",
  "detail-piers": "areas",
  "detail-areas": "areas",
  "detail-area-outlines": "areas",
  "detail-water": "areas",
  "detail-water-lines": "areas",
};
export function addCartography(map: Map) {
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--accent").trim();
  const foreground = style.getPropertyValue("--foreground").trim();
  const background = style.getPropertyValue("--background").trim();
  const muted = style.getPropertyValue("--muted").trim();
  map.addSource(SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
  });
  const category = (name: string): FilterSpecification => [
    "==",
    ["get", "category"],
    name,
  ];
  const layers: LayerSpecification[] = [
    {
      id: "detail-water-lines",
      source: SOURCE,
      type: "line",
      filter: category("water"),
      paint: { "line-color": muted, "line-width": 1, "line-opacity": 0.6 },
    },
    {
      id: "detail-water",
      source: SOURCE,
      type: "fill",
      filter: category("water"),
      paint: { "fill-color": muted, "fill-opacity": 0.06 },
    },
    {
      id: "detail-areas",
      source: SOURCE,
      type: "fill",
      filter: category("area"),
      paint: { "fill-color": accent, "fill-opacity": 0.055 },
    },
    {
      id: "detail-area-outlines",
      source: SOURCE,
      type: "line",
      filter: category("area"),
      paint: {
        "line-color": accent,
        "line-width": 1,
        "line-opacity": 0.55,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "detail-piers",
      source: SOURCE,
      type: "line",
      filter: category("pier"),
      paint: {
        "line-color": foreground,
        "line-opacity": 0.6,
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2, 18, 8],
      },
    },
    {
      id: "detail-road-casing",
      source: SOURCE,
      type: "line",
      filter: category("road"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": background,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          1.5,
          16,
          5,
          19,
          12,
        ],
        "line-opacity": 0.75,
      },
    },
    {
      id: "detail-roads",
      source: SOURCE,
      type: "line",
      filter: category("road"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": foreground,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          0.5,
          16,
          2,
          19,
          6,
        ],
        "line-opacity": 0.65,
      },
    },
    {
      id: "detail-railway-casing",
      source: SOURCE,
      type: "line",
      filter: category("railway"),
      paint: {
        "line-color": background,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          0.6,
          16,
          2,
          19,
          4,
        ],
        "line-opacity": 0.7,
      },
    },
    {
      id: "detail-railways",
      source: SOURCE,
      type: "line",
      filter: category("railway"),
      paint: {
        "line-color": accent,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          0.4,
          16,
          1,
          19,
          2,
        ],
        "line-dasharray": [3, 2],
        "line-opacity": 0.7,
      },
    },
    {
      id: "detail-buildings",
      source: SOURCE,
      type: "fill",
      filter: category("building"),
      paint: {
        "fill-color": foreground,
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          0.12,
          18,
          0.25,
        ],
      },
    },
    {
      id: "detail-building-outlines",
      source: SOURCE,
      type: "line",
      filter: category("building"),
      paint: {
        "line-color": foreground,
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 18, 1.5],
        "line-opacity": 0.8,
      },
    },
    {
      id: "detail-road-labels",
      source: SOURCE,
      type: "symbol",
      minzoom: 15,
      filter: [
        "all",
        ["==", ["get", "category"], "road"],
        ["any", ["has", "ref"], ["==", ["get", "named"], true]],
      ],
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "ref"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-max-angle": 35,
        "symbol-spacing": 350,
      },
      paint: {
        "text-color": foreground,
        "text-halo-color": background,
        "text-halo-width": 1.5,
      },
    },
    {
      id: "detail-selected",
      source: SOURCE,
      type: "line",
      filter: ["==", ["get", "id"], ""],
      paint: { "line-color": accent, "line-width": 3.5 },
    },
  ];
  for (const layer of layers) map.addLayer(layer);
}
export function updateCartography(map: Map, data: CartographyData) {
  (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data);
}
export function setCartographyVisibility(map: Map, layers: Layers) {
  for (const [id, key] of Object.entries(visibilityGroups)) {
    if (map.getLayer(id))
      map.setLayoutProperty(
        id,
        "visibility",
        layers[key] && (!id.endsWith("labels") || layers.labels)
          ? "visible"
          : "none",
      );
  }
}
export function highlightCartography(map: Map, id: string | undefined) {
  if (map.getLayer("detail-selected"))
    map.setFilter("detail-selected", ["==", ["get", "id"], id ?? ""]);
}
