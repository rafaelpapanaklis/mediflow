"use client";

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import s from "./properties.module.css";

/**
 * Pin arrastrable de la ubicación del inmueble.
 *
 * Leaflet NO es SSR-safe (toca `window` al importarse), así que este
 * archivo se carga SIEMPRE con next/dynamic({ ssr: false }) desde la ficha.
 *
 * El pin manda sobre todo lo demás: si el asesor lo arrastra, esa es la
 * ubicación, aunque la calle escrita diga otra cosa. En México los números
 * oficiales y los reales no siempre coinciden y quien está parado enfrente
 * sabe más que un geocodificador.
 *
 * Aquí NO se guarda nada: se emite onChange y la sección de Ubicación
 * persiste junto con el resto de sus campos.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Centro por defecto: Guadalajara. Solo se usa si no hay pin todavía. */
const DEFAULT_CENTER: LatLng = { lat: 20.6736, lng: -103.344 };
const PINE = "#2F6B4D";

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: "realty-map-pin",
    html: `<svg width="28" height="36" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.716 23.284 0 15 0z" fill="${PINE}"/>
      <circle cx="15" cy="15" r="5.5" fill="#ffffff"/>
    </svg>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });
}

/** Clic en el mapa = poner el pin ahí. */
function ClickToPlace({ onPick }: { onPick: (c: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/**
 * Reencuadra cuando el pin llega desde fuera (por ejemplo al cargar la
 * ficha). No sigue cada arrastre: mover el mapa mientras el usuario
 * arrastra el marcador se siente como que se le escapa de la mano.
 */
function Recenter({ center }: { center: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView([center.lat, center.lng], map.getZoom() < 13 ? 15 : map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);

  // Leaflet mide el contenedor al montarse. Dentro de una sección que
  // acaba de abrirse, ese ancho todavía es 0 y el mapa sale en gris: hay
  // que pedirle que se vuelva a medir en el siguiente cuadro.
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 60);
    return () => window.clearTimeout(id);
  }, [map]);

  return null;
}

export interface PropertyMapProps {
  lat: number | null;
  lng: number | null;
  onChange: (coords: LatLng | null) => void;
  dragHint: string;
  emptyHint: string;
  clearLabel: string;
}

export default function PropertyMap({
  lat,
  lng,
  onChange,
  dragHint,
  emptyHint,
  clearLabel,
}: PropertyMapProps) {
  const [pin, setPin] = useState<LatLng | null>(
    lat !== null && lng !== null ? { lat, lng } : null,
  );
  const icon = useMemo(() => pinIcon(), []);

  // El padre puede reemplazar las coordenadas (al descartar cambios, por
  // ejemplo): el pin local se sincroniza con lo que venga de fuera.
  useEffect(() => {
    setPin(lat !== null && lng !== null ? { lat, lng } : null);
  }, [lat, lng]);

  function place(c: LatLng | null) {
    setPin(c);
    onChange(c);
  }

  const center = pin ?? DEFAULT_CENTER;

  return (
    <div>
      <div className={s.mapBox}>
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={pin ? 15 : 12}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPick={place} />
          <Recenter center={pin} />
          {pin ? (
            <Marker
              position={[pin.lat, pin.lng]}
              icon={icon}
              draggable
              eventHandlers={{
                dragend(e) {
                  const m = e.target as L.Marker;
                  const p = m.getLatLng();
                  place({ lat: p.lat, lng: p.lng });
                },
              }}
            />
          ) : null}
        </MapContainer>
      </div>
      <div className={s.mapFoot}>
        <span>{pin ? dragHint : emptyHint}</span>
        {pin ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span>
              {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
            </span>
            <button
              type="button"
              className={`${s.btn} ${s.btnSm} ${s.btnGhost}`}
              onClick={() => place(null)}
            >
              {clearLabel}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
