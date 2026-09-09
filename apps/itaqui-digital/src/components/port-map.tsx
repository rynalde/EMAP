"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  addCartography,
  updateCartography,
  setCartographyVisibility,
  highlightCartography,
  CARTOGRAPHY_HIT_LAYERS,
} from "@/lib/cartography-layer";
import {
  createVesselModelLayer,
  type VesselModelLayer,
} from "@/lib/vessel-models";
import type { CartographyData, CartographyFeature } from "@/lib/cartography";
import { mapStyle } from "@/lib/map-style";
import { PLACES, PORT_CENTER } from "@/lib/port-data";
import type { Layers, MapCommand, Place, Vessel } from "@/lib/types";

export type MapSelection =
  | { type: "place"; place: Place }
  | { type: "vessel"; vessel: Vessel }
  | { type: "cartography"; feature: CartographyFeature };
type Props = {
  layers: Layers;
  cartography?: CartographyData;
  selectedFeatureId?: string;
  basemap: "satellite" | "street";
  vessels: Vessel[];
  command: MapCommand | null;
  onSelect: (s: MapSelection) => void;
  onReady: () => void;
};

export default function PortMap(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<maplibregl.Map | null>(null),
    vesselModels = useRef<VesselModelLayer | null>(null),
    latest = useRef(props),
    markers = useRef<maplibregl.Marker[]>([]),
    shipMarkers = useRef<maplibregl.Marker[]>([]);
  latest.current = props;
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: mapStyle(),
        center: PORT_CENTER,
        zoom: 14.9,
        minZoom: 9,
        maxZoom: 20,
        maxPitch: 0,
        dragRotate: false,
        touchPitch: false,
        attributionControl: false,
        maxBounds: [
          [-44.9, -3.0],
          [-43.85, -1.9],
        ],
      });
    } catch {
      setError(
        "Seu navegador não conseguiu iniciar o mapa. Ative a aceleração gráfica e recarregue.",
      );
      return;
    }
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container.current);
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }),
      "bottom-left",
    );
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.on("error", (e) => {
      if (e.error?.message?.includes("WebGL"))
        setError("O contexto gráfico foi interrompido. Recarregue o mapa.");
    });
    map.on("load", () => {
      addCartography(map);
      const models = createVesselModelLayer();
      map.addLayer(models);
      vesselModels.current = models;
      map.on("click", (event) => {
        // DOM markers have their own accessible click handlers.
        if (
          (event.originalEvent.target as HTMLElement)?.closest(
            ".maplibregl-marker",
          )
        )
          return;
        const picked = vesselModels.current?.pick(event.point);
        if (picked) {
          latest.current.onSelect({ type: "vessel", vessel: picked });
          return;
        }
        const hits = map.queryRenderedFeatures(
          [
            [event.point.x - 3, event.point.y - 3],
            [event.point.x + 3, event.point.y + 3],
          ],
          { layers: CARTOGRAPHY_HIT_LAYERS },
        );
        for (const layer of CARTOGRAPHY_HIT_LAYERS) {
          const hit = hits.find((f) => f.layer.id === layer);
          const feature = latest.current.cartography?.features.find(
            (f) => f.properties.id === hit?.properties.id,
          );
          if (feature) {
            latest.current.onSelect({ type: "cartography", feature });
            break;
          }
        }
      });
      map.on("mousemove", (event) => {
        map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, {
          layers: CARTOGRAPHY_HIT_LAYERS,
        }).length
          ? "pointer"
          : "";
      });
      for (const p of PLACES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          p.category === "berth" ? "berth-marker" : "place-marker";
        button.textContent =
          p.category === "berth" ? p.id.padStart(3, "0") : p.name;
        button.title = p.name;
        button.setAttribute("aria-label", `Explorar ${p.name}`);
        button.dataset.category = p.category;
        button.addEventListener("click", () =>
          latest.current.onSelect({ type: "place", place: p }),
        );
        markers.current.push(
          new maplibregl.Marker({
            element: button,
            anchor: p.category === "berth" ? "right" : "center",
            offset: p.category === "berth" ? [-22, 0] : [0, 0],
          })
            .setLngLat(p.coordinates)
            .addTo(map),
        );
      }
      setReady(true);
      latest.current.onReady();
    });
    return () => {
      resizeObserver.disconnect();
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      shipMarkers.current.forEach((m) => m.remove());
      shipMarkers.current = [];
      map.remove();
      vesselModels.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setCartographyVisibility(map, props.layers);
    vesselModels.current?.setVisible(props.layers.vessels);
    markers.current.forEach((m) => {
      const el = m.getElement();
      el.style.display = (
        el.dataset.category === "berth"
          ? props.layers.berths
          : props.layers.labels
      )
        ? ""
        : "none";
    });
    shipMarkers.current.forEach(
      (m) =>
        (m.getElement().style.display = props.layers.vessels ? "" : "none"),
    );
    map.setLayoutProperty(
      "satellite",
      "visibility",
      props.basemap === "satellite" ? "visible" : "none",
    );
    map.setLayoutProperty(
      "street",
      "visibility",
      props.basemap === "street" ? "visible" : "none",
    );
  }, [props.layers, props.basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    vesselModels.current?.update(props.vessels);
    shipMarkers.current.forEach((m) => m.remove());
    shipMarkers.current = [];
    for (const v of props.vessels) {
      if (!v.coordinates || v.stale) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "vessel-marker";
      el.textContent = v.name;
      el.setAttribute("aria-label", `Ver navio ${v.name}`);
      el.dataset.source = v.positionSource;
      el.style.display = latest.current.layers.vessels ? "" : "none";
      el.addEventListener("click", () =>
        latest.current.onSelect({ type: "vessel", vessel: v }),
      );
      shipMarkers.current.push(
        new maplibregl.Marker({
          element: el,
          anchor: "left",
          offset: [24, 0],
        })
          .setLngLat(v.coordinates)
          .addTo(map),
      );
    }
  }, [props.vessels, ready]);

  useEffect(() => {
    const map = mapRef.current,
      c = props.command;
    if (!map || !c || !ready) return;
    map.stop();
    if (c.type === "home")
      map.flyTo({ center: PORT_CENTER, zoom: 14.9, duration: 1200 });
    if (c.type === "region")
      map.fitBounds(
        [
          [-44.65, -2.85],
          [-44.1, -2.2],
        ],
        { padding: 55, duration: 1200 },
      );
    if (c.type === "fly" && c.bounds)
      map.fitBounds(c.bounds, { padding: 90, maxZoom: 18.2, duration: 1200 });
    else if (c.type === "fly" && c.coordinates)
      map.flyTo({
        center: c.coordinates,
        zoom: c.zoom ?? 17.3,
        duration: 1200,
      });
    if (c.type === "zoomIn") map.zoomIn();
    if (c.type === "zoomOut") map.zoomOut();
  }, [props.command, ready]);

  useEffect(() => {
    if (ready && mapRef.current && props.cartography)
      updateCartography(mapRef.current, props.cartography);
  }, [ready, props.cartography]);
  useEffect(() => {
    if (ready && mapRef.current)
      highlightCartography(mapRef.current, props.selectedFeatureId);
  }, [ready, props.selectedFeatureId]);
  return (
    <div className="map-host">
      <div
        ref={container}
        className="map-canvas"
        aria-label="Mapa interativo do Porto do Itaqui"
      />
      {!ready && !error && (
        <div className="map-loading">
          <span className="loading-spinner" />
          <span>
            Preparando sua vista do porto
            <span className="muted block">Carregando cartografia</span>
          </span>
        </div>
      )}
      {error && (
        <div className="map-loading">
          <p>{error}</p>
          <button className="primary-button" onClick={() => location.reload()}>
            Recarregar
          </button>
        </div>
      )}
    </div>
  );
}
