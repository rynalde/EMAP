"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  type LocatedDevice,
  type RangedDevice,
  LINK_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  relativeAge,
  statusOf,
} from "../lib/types";

const GATEWAY_ZOOM = 16;

// A divIcon avoids Leaflet's default marker, whose image URLs break under
// bundlers, and lets the pin carry the device's status colour directly.
function pin(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="
      display:block;width:18px;height:18px;border-radius:50%;
      background:${color};border:3px solid #fff;
      box-shadow:0 0 0 1px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.4);
    "></span>`,
  });
}

// A ringed marker so the gateway is not mistaken for a tag.
function gatewayPin(): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span style="
      display:block;width:22px;height:22px;border-radius:4px;
      background:#3b82f6;border:3px solid #fff;transform:rotate(45deg);
      box-shadow:0 0 0 1px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.45);
    "></span>`,
  });
}

/**
 * Anchors the view on the gateway. The gateway is the fixed reference point of
 * the deployment, and unlike the tags it usually has a position — tags without
 * a fix contribute no coordinates at all, so anchoring to them would leave the
 * map with nothing to show.
 *
 * Falls back to framing the tags only when the gateway has no fix of its own.
 */
function Anchor({
  gateway,
  tags,
}: {
  gateway: LocatedDevice | null;
  tags: LocatedDevice[];
}) {
  const map = useMap();
  const gwKey = gateway ? `${gateway.lat},${gateway.lng}` : "";
  const tagKey = tags.map((t) => `${t.device_id}:${t.lat},${t.lng}`).join("|");

  useEffect(() => {
    if (gateway) {
      map.setView([gateway.lat, gateway.lng], Math.max(map.getZoom(), GATEWAY_ZOOM));
      return;
    }
    if (tags.length === 0) return;
    if (tags.length === 1) {
      map.setView([tags[0].lat, tags[0].lng], Math.max(map.getZoom(), 15));
      return;
    }
    map.fitBounds(
      L.latLngBounds(tags.map((t) => [t.lat, t.lng] as [number, number])),
      { padding: [48, 48], maxZoom: 17 },
    );
    // Re-anchoring only when coordinates actually change leaves manual panning
    // and zooming alone in between refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gwKey, tagKey, map]);

  return null;
}

export default function TagMap({
  tags,
  ranged,
  gateway,
}: {
  tags: LocatedDevice[];
  ranged: RangedDevice[];
  gateway: LocatedDevice | null;
}) {
  // Initial center; Anchor keeps it on the gateway as data refreshes.
  const center = useMemo<[number, number]>(() => {
    if (gateway) return [gateway.lat, gateway.lng];
    if (tags.length > 0) return [tags[0].lat, tags[0].lng];
    return [0, 0];
  }, [gateway, tags]);

  const initialZoom = gateway ? GATEWAY_ZOOM : tags.length > 0 ? 15 : 2;

  return (
    <MapContainer
      center={center}
      zoom={initialZoom}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Anchor gateway={gateway} tags={tags} />

      {gateway && (
        <Marker
          position={[gateway.lat, gateway.lng]}
          icon={gatewayPin()}
          zIndexOffset={1000}
        >
          <Popup>
            <strong>{gateway.label ?? gateway.device_id}</strong>
            <br />
            Gateway &middot; {gateway.status}
            <br />
            {gateway.lat.toFixed(6)}, {gateway.lng.toFixed(6)}
            <br />
            {gateway.sats ?? 0} sats
            <br />
            Seen {relativeAge(gateway.recorded_at)}
          </Popup>
        </Marker>
      )}

      {/* A ranged tag is drawn as the circle it actually is: somewhere at
          radius_m from its gateway. A pin would claim a point that nothing
          measured. */}
      {ranged.map((t) => (
        <Circle
          key={t.device_id}
          center={[t.origin_lat, t.origin_lng]}
          radius={t.radius_m}
          pathOptions={{
            color: STATUS_COLOR[statusOf(t)],
            weight: 2,
            dashArray: "6 6",
            fillOpacity: 0.08,
          }}
        >
          <Popup>
            <strong>{t.label ?? t.device_id}</strong>
            <br />
            {STATUS_LABEL[statusOf(t)]} &middot; {relativeAge(t.recorded_at)}
            <br />
            {t.radius_m.toFixed(2)} m from {t.reported_by_label ?? "gateway"}
            <br />
            Somewhere on this circle — no position of its own.
          </Popup>
        </Circle>
      ))}

      {tags.map((t) => {
        const status = statusOf(t);
        return (
          <Marker
            key={t.device_id}
            position={[t.lat, t.lng]}
            icon={pin(STATUS_COLOR[status])}
          >
            <Popup>
              <strong>{t.label ?? t.device_id}</strong>
              <br />
              {STATUS_LABEL[status]} &middot; {relativeAge(t.recorded_at)}
              <br />
              {t.lat.toFixed(6)}, {t.lng.toFixed(6)}
              <br />
              {LINK_LABEL[t.link] ?? t.link} &middot; {t.sats ?? 0} sats
              {t.hdop != null && <> &middot; HDOP {t.hdop}</>}
              <br />
              {t.rssi != null && <>RSSI {t.rssi} dBm </>}
              {t.snr != null && <>&middot; SNR {t.snr} dB</>}
              {t.battery_mv ? (
                <>
                  <br />
                  Battery {t.battery_mv} mV
                </>
              ) : null}
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
