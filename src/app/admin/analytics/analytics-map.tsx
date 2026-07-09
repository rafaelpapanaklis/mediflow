"use client";

// Mapa de visitantes (geo + en vivo) con Leaflet + tiles oscuros CartoDB.
// Se importa SIEMPRE vía next/dynamic({ssr:false}) desde las tabs (Leaflet no
// corre en SSR). Sin API key; los tiles pasan la CSP (img-src https:).

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  sub?: string;
  value?: number;
  live?: boolean;
}

const MX_CENTER: [number, number] = [23.6, -102.5];

function FitBounds({ points, fitOnce }: { points: Array<[number, number]>; fitOnce?: boolean }) {
  const map = useMap();
  const didFit = useRef(false);
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    // En modo en vivo (polling) sólo encuadramos una vez: así el zoom/pan que
    // el owner hace para inspeccionar no se resetea cada 5 s.
    if (fitOnce && didFit.current) return;
    if (points.length === 0) {
      if (!fitOnce) map.setView(MX_CENTER, 4);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 8);
    } else {
      try {
        map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 11 });
      } catch {
        map.setView(MX_CENTER, 4);
      }
    }
    didFit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function liveIcon(): L.DivIcon {
  return L.divIcon({
    className: "da-live-pin",
    html: `<span class="da-live-dot"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
  });
}

export function AnalyticsMap({ markers, height = 440, live = false }: { markers: MapMarker[]; height?: number; live?: boolean }) {
  const valid = useMemo(
    () => markers.filter((m) => typeof m.lat === "number" && typeof m.lng === "number" && !isNaN(m.lat) && !isNaN(m.lng)),
    [markers],
  );
  const points = useMemo<Array<[number, number]>>(() => valid.map((m) => [m.lat, m.lng]), [valid]);
  const maxVal = useMemo(() => Math.max(...valid.map((m) => m.value || 1), 1), [valid]);
  const icon = useMemo(() => liveIcon(), []);

  return (
    <div
      style={{
        position: "relative",
        height,
        width: "100%",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--border-soft)",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .da-live-dot{display:block;width:12px;height:12px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 rgba(34,197,94,.6);animation:daPulse 1.8s infinite;}
        @keyframes daPulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 12px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
        .leaflet-container{background:#0b1020;font-family:inherit}
        .leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#151a2e;color:#e8e8f0;border:1px solid rgba(255,255,255,.08)}
        .leaflet-popup-content{margin:8px 10px;font-size:12px}
      `,
        }}
      />
      <MapContainer center={MX_CENTER} zoom={4} scrollWheelZoom style={{ height: "100%", width: "100%" }} worldCopyJump>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
          subdomains="abcd"
          maxZoom={19}
        />
        <FitBounds points={points} fitOnce={live} />
        {valid.map((m, i) =>
          live ? (
            <Marker key={i} position={[m.lat, m.lng]} icon={icon}>
              <Popup>
                <strong>{m.label}</strong>
                {m.sub && <div style={{ opacity: 0.75 }}>{m.sub}</div>}
              </Popup>
            </Marker>
          ) : (
            <CircleMarker
              key={i}
              center={[m.lat, m.lng]}
              radius={6 + Math.sqrt((m.value || 1) / maxVal) * 20}
              pathOptions={{ color: "#7c3aed", fillColor: "#7c3aed", fillOpacity: 0.35, weight: 1.5 }}
            >
              <Tooltip direction="top" opacity={1}>
                <strong>{m.label}</strong>
                {m.sub ? ` · ${m.sub}` : ""}
              </Tooltip>
            </CircleMarker>
          ),
        )}
      </MapContainer>
    </div>
  );
}

export default AnalyticsMap;
