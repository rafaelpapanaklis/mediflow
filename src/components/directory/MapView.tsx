"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import "leaflet/dist/leaflet.css";
import {
  categoryLabel,
  MAP_DEFAULT_CENTER,
  type DirectoryClinic,
  type GeoPoint,
} from "@/lib/directory/types";
import { formatDistanceEs } from "@/lib/directory/distance";
import { openBookingPopup } from "@/lib/directory/booking-state";

// ─────────────────────────────────────────────────────────────────────────────
// Mapa del directorio (/descubre) con Leaflet + OpenStreetMap (sin API key).
// Se monta SIEMPRE vía next/dynamic({ ssr:false }) desde DirectoryExplorer, así
// que Leaflet jamás entra al bundle inicial ni corre en SSR. Markers violeta con
// divIcon (evita el bug de iconos rotos de Leaflet con bundlers). El popup
// reutiliza el MISMO bus de reserva que las cards: openBookingPopup(clinic).
// Paleta blanco + violeta consistente con el resto de /descubre.
// ─────────────────────────────────────────────────────────────────────────────

export interface MapViewProps {
  /** Clínicas ya filtradas (categoría/búsqueda/cerca de mí). Solo se grafican las que tienen lat/lng. */
  clinics: DirectoryClinic[];
  /** Punto del usuario para "Estás aquí" + centrado; null si no compartió ubicación. */
  userLocation?: GeoPoint | null;
  /** Cargando datos del mapa (atenúa ligeramente). */
  loading?: boolean;
}

const VIOLET = "#7c3aed";

/** Pin violeta (teardrop) como divIcon: punta abajo, sin depender de imágenes. */
function clinicIcon(): L.DivIcon {
  return L.divIcon({
    className: "dc-map-pin",
    html: `<svg width="30" height="38" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.716 23.284 0 15 0z" fill="${VIOLET}"/>
      <circle cx="15" cy="15" r="6" fill="#ffffff"/>
    </svg>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  });
}

/** Punto azul "Estás aquí" para la ubicación del usuario. */
function userIcon(): L.DivIcon {
  return L.divIcon({
    className: "dc-map-userpin",
    html: `<span style="display:block;width:18px;height:18px;border-radius:999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35)"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}

/** Ajusta el encuadre a todos los puntos cada vez que cambian clínicas/ubicación. */
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  // Clave estable: solo re-encuadra cuando cambian de verdad los puntos.
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) {
      map.setView([MAP_DEFAULT_CENTER.lat, MAP_DEFAULT_CENTER.lng], 11);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export function MapView({ clinics, userLocation, loading }: MapViewProps) {
  const located = useMemo(
    () =>
      clinics.filter(
        (c) => typeof c.latitude === "number" && typeof c.longitude === "number",
      ),
    [clinics],
  );

  const points = useMemo<Array<[number, number]>>(() => {
    const pts: Array<[number, number]> = located.map((c) => [c.latitude as number, c.longitude as number]);
    if (userLocation) pts.push([userLocation.lat, userLocation.lng]);
    return pts;
  }, [located, userLocation]);

  const pinIcon = useMemo(() => clinicIcon(), []);
  const meIcon = useMemo(() => userIcon(), []);

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        minHeight: 320,
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid var(--line, #e9e7f3)",
        opacity: loading ? 0.7 : 1,
        transition: "opacity .2s",
      }}
    >
      <MapContainer
        center={[MAP_DEFAULT_CENTER.lat, MAP_DEFAULT_CENTER.lng]}
        zoom={11}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitBounds points={points} />

        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={meIcon}>
            <Popup>Estás aquí</Popup>
          </Marker>
        )}

        {located.map((clinic) => {
          const dist = formatDistanceEs(clinic.distanceKm);
          return (
            <Marker
              key={clinic.id}
              position={[clinic.latitude as number, clinic.longitude as number]}
              icon={pinIcon}
            >
              <Popup>
                <div style={{ minWidth: 180, maxWidth: 240 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", lineHeight: 1.25 }}>
                    {clinic.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#6d28d9", marginTop: 2 }}>
                    {categoryLabel(clinic.category)}
                    {dist && <span style={{ color: "#64748b" }}> · {dist}</span>}
                  </div>
                  {(clinic.city || clinic.state) && (
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      {[clinic.city, clinic.state].filter(Boolean).join(", ")}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => openBookingPopup(clinic)}
                      style={{
                        flex: "1 1 auto",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "7px 10px",
                        borderRadius: 10,
                        border: "none",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#fff",
                        background: "linear-gradient(180deg, #7c3aed, #6d28d9)",
                      }}
                    >
                      <CalendarCheck size={14} aria-hidden="true" />
                      Reservar
                    </button>
                    {clinic.landingActive && (
                      <Link
                        href={`/${clinic.slug}`}
                        style={{
                          flex: "0 0 auto",
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "7px 10px",
                          borderRadius: 10,
                          border: "1px solid #e9e7f3",
                          fontSize: 13,
                          fontWeight: 500,
                          color: "#0f172a",
                          textDecoration: "none",
                        }}
                      >
                        Ver clínica
                      </Link>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {located.length === 0 && !loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            padding: 16,
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              background: "rgba(255,255,255,.94)",
              border: "1px solid var(--line, #e9e7f3)",
              borderRadius: 14,
              padding: "14px 18px",
              maxWidth: 320,
              textAlign: "center",
              boxShadow: "0 6px 24px -10px rgba(15,23,42,.18)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
              Sin clínicas en el mapa
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
              Las clínicas que aún no fijaron su ubicación aparecen en la lista. Prueba ver la lista o
              cambiar de categoría.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapView;
