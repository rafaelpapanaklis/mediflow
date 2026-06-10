import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { rateLimit } from "@/lib/rate-limit";
import { isValidLatLng } from "@/lib/directory/distance";

// POST /api/clinic/geocode — geocoder de la dirección de la clínica para fijar su
// pin en el mapa del directorio (/descubre). NO es un proxy abierto de geocoding:
//   · exige sesión de clínica con rol ADMIN/SUPER_ADMIN (igual que PATCH /api/clinic),
//   · rate-limit por IP,
//   · respeta la política de uso de Nominatim (User-Agent obligatorio).
// El ajuste manual del pin manda — esto solo es una ayuda para ubicar la dirección.
//
// body  { q: string }            → dirección libre (calle, ciudad, estado…)
// 200   { results: { lat, lng, label }[] }   (hasta 5, mejor primero)
// 400   { error }  q vacío/!string · 401/403 sin sesión/rol · 429 rate-limit · 502 upstream

export const dynamic = "force-dynamic";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Nominatim exige identificar la app vía User-Agent (su política de uso).
const USER_AGENT = "DaleControl-Directory/1.0 (+https://dalecontrol.com; geocoding de clínicas)";

async function getAdminClinicUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  let dbUser = null;
  if (activeClinicId) {
    dbUser = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
  }
  if (!dbUser) {
    dbUser = await prisma.user.findFirst({
      where: { supabaseId: user.id, isActive: true },
      orderBy: { createdAt: "asc" },
    });
  }
  return dbUser;
}

export async function POST(req: NextRequest) {
  // 1) Rate-limit por IP: este endpoint pega a un servicio externo gratuito.
  const limited = rateLimit(req, 10, 60_000);
  if (limited) return limited;

  // 2) Auth: solo un admin de clínica logueado puede geocodificar.
  const dbUser = await getAdminClinicUser();
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (dbUser.role !== "ADMIN" && dbUser.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Solo administradores pueden fijar la ubicación de la clínica" },
      { status: 403 },
    );
  }

  // 3) Validar query.
  const body = await req.json().catch(() => null);
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 200) : "";
  if (q.length < 3) {
    return NextResponse.json({ error: "Escribe una dirección más completa" }, { status: 400 });
  }

  // 4) Nominatim — sesgado a México, hasta 5 resultados, con timeout duro.
  const params = new URLSearchParams({
    q,
    format: "json",
    addressdetails: "0",
    limit: "5",
    countrycodes: "mx",
  });

  try {
    const res = await fetch(`${NOMINATIM}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "es" },
      // Nominatim cachea poco; evitamos que Next intente cachear la respuesta.
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "No pudimos buscar la dirección" }, { status: 502 });
    }
    const raw = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const results = (Array.isArray(raw) ? raw : [])
      .map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lon),
        label: typeof r.display_name === "string" ? r.display_name : "",
      }))
      .filter((r) => isValidLatLng(r.lat, r.lng));

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "No pudimos buscar la dirección" }, { status: 502 });
  }
}
