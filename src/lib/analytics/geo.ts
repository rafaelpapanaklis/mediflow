// Lectura de geolocalización + IP desde headers (servidor).
// En Vercel llegan x-vercel-ip-* sin dependencias ni API key. En local no existen.

import type { NextRequest } from "next/server";

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  ip: string | null;
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
