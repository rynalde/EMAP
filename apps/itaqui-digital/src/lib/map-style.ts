import type { StyleSpecification } from "maplibre-gl";
export function mapStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Imagens © Esri, Maxar, Earthstar Geographics",
      },
      street: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#344b4c" },
      },
      {
        id: "satellite",
        type: "raster",
        source: "satellite",
        paint: {
          "raster-saturation": -0.3,
          "raster-brightness-max": 0.85,
          "raster-fade-duration": 200,
        },
      },
      {
        id: "street",
        type: "raster",
        source: "street",
        layout: { visibility: "none" },
        paint: { "raster-saturation": -0.65 },
      },
    ],
  };
}
