// Geolocalización + IP del visitante (servidor).
//
// FUENTE PRIMARIA: lookup server-side por IP contra ipwho.is (HTTPS, sin API key).
// La geo-IP nativa de Vercel (x-vercel-ip-*) ubica mal muchas IPs de ISPs MX
// (p. ej. Totalplay: Mérida → Cd. Juárez), así que la usamos sólo de FALLBACK.
//
// PRIVACIDAD (app médica): al servicio externo se le envía ÚNICAMENTE la IP del
// visitante (ningún otro dato/PII), y sólo la primera vez que se ve esa IP: el
// resultado se cachea en memoria (por IP) para minimizar llamadas externas. El
// lookup sólo corre al CREAR una sesión nueva (ver /api/track), nunca por evento.
// Para desactivarlo por completo: GEOIP_ENABLED = false (queda sólo Vercel).

import type { NextRequest } from "next/server";

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  ip: string | null;
}

// ── Config del lookup por IP (fácil de cambiar/desactivar) ───────────────────
/** Endpoint del servicio; {ip} se sustituye por la IP. ipwho.is = HTTPS, sin key. */
const GEOIP_ENDPOINT = "https://ipwho.is/{ip}";
const GEOIP_ENABLED = true; // false → sólo headers de Vercel
const GEOIP_TIMEOUT_MS = 1500; // corto: jamás bloquear la ingesta
const GEOIP_TTL_MS = 12 * 60 * 60 * 1000; // cache positiva 12h
const GEOIP_NEG_TTL_MS = 5 * 60 * 1000; // cache negativa 5min (no martillar si falla)
const GEOIP_CACHE_MAX = 5000; // tope del Map (poda FIFO)

interface CacheEntry {
  geo: Partial<GeoInfo> | null; // null = fallo cacheado (usar headers)
  exp: number;
}
const geoCache = new Map<string, CacheEntry>();

function cacheGet(ip: string): CacheEntry | null {
  const e = geoCache.get(ip);
  if (!e) return null;
  if (e.exp < Date.now()) {
    geoCache.delete(ip);
    return null;
  }
  return e;
}

function cacheSet(ip: string, geo: Partial<GeoInfo> | null, ttl: number): void {
  if (geoCache.size >= GEOIP_CACHE_MAX) {
    const first = geoCache.keys().next().value; // poda la más antigua insertada
    if (first !== undefined) geoCache.delete(first);
  }
  geoCache.set(ip, { geo, exp: Date.now() + ttl });
}

/** ¿IP pública enrutable? Evita llamadas inútiles para localhost / redes privadas. */
function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "::1" || ip === "0.0.0.0" || ip.startsWith("127.")) return false;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return false;
  const m = ip.match(/^172\.(\d+)\./); // 172.16.0.0 – 172.31.255.255
  if (m) {
    const o = parseInt(m[1], 10);
    if (o >= 16 && o <= 31) return false;
  }
  if (/^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip)) return false; // IPv6 link/unique-local
  return true;
}

function dec(v: string | null): string | null {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function num(v: string | null): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Geo SÓLO desde headers (fallback + extracción de IP). Síncrono, sin red. */
export function readGeo(req: NextRequest): GeoInfo {
  const h = req.headers;
  // Preferir x-real-ip (lo fija la plataforma) sobre el primer x-forwarded-for,
  // que el cliente puede prefijar/spoofear.
  const xff = h.get("x-forwarded-for");
  const ip =
    h.get("x-real-ip") ||
    (xff ? xff.split(",")[0]?.trim() : null) ||
    h.get("cf-connecting-ip") ||
    null;

  return {
    country: h.get("x-vercel-ip-country") || null,
    region: dec(h.get("x-vercel-ip-country-region")),
    city: dec(h.get("x-vercel-ip-city")),
    latitude: num(h.get("x-vercel-ip-latitude")),
    longitude: num(h.get("x-vercel-ip-longitude")),
    ip: ip || null,
  };
}

/** Consulta el servicio de geo por IP. Devuelve null si falla/timeout/inservible. */
async function lookupIp(ip: string): Promise<Partial<GeoInfo> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEOIP_TIMEOUT_MS);
  try {
    const res = await fetch(GEOIP_ENDPOINT.replace("{ip}", encodeURIComponent(ip)), {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cache: "no-store", // no dejar que Next cachee la respuesta externa
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    if (!d || d.success === false) return null; // ipwho.is responde 200 con success:false en error
    const lat = typeof d.latitude === "number" ? d.latitude : num(d.latitude ?? null);
    const lng = typeof d.longitude === "number" ? d.longitude : num(d.longitude ?? null);
    const country = d.country_code || null; // 2 letras, consistente con x-vercel-ip-country
    const city = d.city || null;
    const region = d.region || d.region_code || null;
    if (!country && !city && lat == null) return null; // respuesta sin datos útiles → fallo
    return { country, region, city, latitude: lat, longitude: lng };
  } catch {
    return null; // timeout / red / JSON inválido → fallback a headers
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Geo definitiva: lookup por IP (primario, cacheado) con headers de Vercel como
 * fallback. Async. Úsalo SÓLO al crear una sesión (una vez por visitante/IP).
 */
export async function resolveGeo(req: NextRequest): Promise<GeoInfo> {
  const header = readGeo(req);
  const ip = header.ip;
  if (!GEOIP_ENABLED || !ip || !isPublicIp(ip)) return header;

  const cached = cacheGet(ip);
  if (cached) return cached.geo ? { ...header, ...cached.geo, ip } : header;

  const looked = await lookupIp(ip);
  if (looked) {
    cacheSet(ip, looked, GEOIP_TTL_MS);
    return { ...header, ...looked, ip };
  }
  cacheSet(ip, null, GEOIP_NEG_TTL_MS); // falló → cache negativa corta, usa headers
  return header;
}
