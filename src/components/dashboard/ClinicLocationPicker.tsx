"use client";

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import { MapPin, Search, Loader2, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { MAP_DEFAULT_CENTER } from "@/lib/directory/types";

// ─────────────────────────────────────────────────────────────────────────────
// Selector de ubicación de la clínica (settings → pestaña Clínica). Mini-mapa
// Leaflet/OSM para fijar el pin que se mostrará en el directorio (/descubre).
// Se monta vía next/dynamic({ ssr:false }) desde settings-client (Leaflet no es
// SSR-safe). Flujo: "Ubicar dirección" geocodifica con /api/clinic/geocode →
// coloca el pin; luego el usuario puede ARRASTRARLO o hacer click en el mapa
// para ajustarlo a mano (lo manual manda). El guardado lo hace el botón
// "Guardar cambios" de la tarjeta: este componente solo emite onChange.
// ─────────────────────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ClinicLocationPickerProps {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  initialLat?: number | null;
  initialLng?: number | null;
  /** Emite el pin elegido, o null al quitarlo. El padre persiste en saveClinic. */
  onChange: (coords: LatLng | null) => void;
}

const VIOLET = "#7c3aed";

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: "dc-picker-pin",
    html: `<svg width="30" height="38" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.716 23.284 0 15 0z" fill="${VIOLET}"/>
      <circle cx="15" cy="15" r="6" fill="#ffffff"/>
    </svg>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
    popupAnchor: [0, -34],
  });
}

/** Recoloca la vista cuando cambia `center` (tras geocodificar). */
function Recenter({ center, zoom }: { center: LatLng | null; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView([center.lat, center.lng], zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);
  return null;
}

/** Click en el mapa = fijar el pin manualmente (lo manual manda). */
function ClickToSet({ onSet }: { onSet: (c: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onSet({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export function ClinicLocationPicker({
  address,
  city,
  state,
  initialLat,
  initialLng,
  onChange,
}: ClinicLocationPickerProps) {
  const initial: LatLng | null =
    typeof initialLat === "number" && typeof initialLng === "number"
      ? { lat: initialLat, lng: initialLng }
      : null;

  const [pos, setPos] = useState<LatLng | null>(initial);
  const [recenter, setRecenter] = useState<LatLng | null>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const icon = useMemo(() => pinIcon(), []);
  const center = initial ?? { lat: MAP_DEFAULT_CENTER.lat, lng: MAP_DEFAULT_CENTER.lng };

  function setManual(c: LatLng) {
    setPos(c);
    setMsg(null);
    onChange(c);
  }

  async function geocode() {
    const q = [address, city, state].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
    if (q.length < 3) {
      setMsg("Agrega calle y ciudad arriba para ubicar la clínica.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/clinic/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(data?.error ?? "No pudimos ubicar la dirección.");
        return;
      }
      const first = data?.results?.[0];
      if (!first) {
        setMsg("No encontramos esa dirección. Ajusta el pin a mano en el mapa.");
        return;
      }
      const c: LatLng = { lat: first.lat, lng: first.lng };
      setPos(c);
      setRecenter(c);
      onChange(c);
      setMsg("Ubicación encontrada. Arrastra el pin si necesitas ajustarlo.");
    } catch {
      setMsg("No pudimos ubicar la dirección.");
    } finally {
      setBusy(false);
    }
  }

  function clearPin() {
    setPos(null);
    setMsg(null);
    onChange(null);
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label />
        <button
          type="button"
          onClick={geocode}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Ubicar dirección
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border" style={{ height: 260 }}>
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={initial ? 15 : 11}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <Recenter center={recenter} zoom={15} />
          <ClickToSet onSet={setManual} />
          {pos && (
            <Marker
              position={[pos.lat, pos.lng]}
              icon={icon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  setManual({ lat: ll.lat, lng: ll.lng });
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 text-violet-500" />
          {pos
            ? `Pin: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`
            : "Sin ubicación — la clínica saldrá en la lista pero no en el mapa."}
        </span>
        {pos && (
          <button
            type="button"
            onClick={clearPin}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <X className="h-3 w-3" /> Quitar pin
          </button>
        )}
      </div>

      {msg && <div className="text-[11px] text-muted-foreground">{msg}</div>}
    </div>
  );
}

/** Etiqueta del bloque (texto fijo para no depender de llaves i18n nuevas). */
function Label() {
  return (
    <div>
      <div className="text-sm font-medium text-foreground">Ubicación en el mapa</div>
      <div className="text-[11px] text-muted-foreground">
        Fija tu pin para aparecer en el mapa del directorio y en “cerca de mí”.
      </div>
    </div>
  );
}

export default ClinicLocationPicker;
