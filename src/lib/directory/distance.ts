// ─────────────────────────────────────────────────────────────────────────────
// Distancia geográfica para el directorio (/descubre): Haversine + formato es-MX
// + bounding box para "cerca de mí". PURO: sin "use client", sin dependencias —
// se importa tanto desde el route handler (server) como desde componentes client
// (ClinicCard, MapView). No tocar window/document aquí.
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distancia en km entre dos puntos (grados decimales) por la fórmula de Haversine. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Coordenadas válidas y dentro de rango (lat ∈ [-90,90], lng ∈ [-180,180]). */
export function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

/** Parsea un valor de query (?lat=) a número finito o null. */
export function parseCoord(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Distancia legible en español: "a 850 m" (<1 km), "a 2.3 km" (<10 km, 1 decimal)
 * o "a 24 km" (entero). Valor nulo/negativo/no finito → cadena vacía.
 */
export function formatDistanceEs(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km) || km < 0) return "";
  if (km < 1) return `a ${Math.round(km * 1000)} m`;
  if (km < 10) return `a ${km.toFixed(1)} km`;
  return `a ${Math.round(km)} km`;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Caja envolvente aproximada para un radio (km) alrededor de un punto. Sirve de
 * prefiltro barato en SQL (latitude/longitude BETWEEN) antes del cálculo exacto
 * de Haversine. 1° de latitud ≈ 111.32 km; la longitud se corrige por cos(lat).
 */
export function boundingBox(lat: number, lng: number, radiusKm: number): BoundingBox {
  const dLat = radiusKm / 111.32;
  const cos = Math.cos(toRad(lat));
  const dLng = radiusKm / (111.32 * (Math.abs(cos) < 1e-6 ? 1e-6 : Math.abs(cos)));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
}
