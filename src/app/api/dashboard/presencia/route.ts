// «Clínicas en línea» — la señal de vida del panel de la clínica.
//
// Ligero a propósito: con la sesión ya validada por Supabase, TODO lo demás va a
// Redis (@/lib/presencia/presencia-store). Prisma solo se toca la primera vez
// de cada sesión (identidad en caché 10 min), nunca en cada señal.
// Sin Redis configurado contesta {guardado:false} y no hace nada más.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/auth-context";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { sessionIdDelToken } from "@/lib/admin/suplantacion-core";
import { obtenerRedis, procesarLatido, type IdentidadLatido } from "@/lib/presencia/presencia-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const redis = obtenerRedis();
  // Sin Redis no hay nada que guardar: ni se pregunta quién es.
  if (!redis) return NextResponse.json({ ok: true, guardado: false, motivo: "sin-redis" }, { headers: SIN_CACHE });

  // CSRF ligero, como /api/track: si viene Origin, debe ser esta misma web.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get("host")) {
        return NextResponse.json({ error: "Origen no permitido" }, { status: 403, headers: SIN_CACHE });
      }
    } catch {
      return NextResponse.json({ error: "Origen no permitido" }, { status: 403, headers: SIN_CACHE });
    }
  }

  let ruta: unknown = null;
  try {
    const crudo = await req.text();
    if (crudo.length <= 2_000) ruta = (JSON.parse(crudo) as { ruta?: unknown })?.ruta ?? null;
  } catch {
    // cuerpo ilegible: la pantalla saldrá como «Otra pantalla»
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: SIN_CACHE });
  const { data: sesionData } = await supabase.auth.getSession();
  // El session_id separa la sesión REAL del dueño de la de «Ver como clínica»
  // (mismo usuario de Supabase, otra sesión): llevan identidades distintas.
  const sesion = sessionIdDelToken(sesionData.session?.access_token) ?? user.id;

  const resultado = await procesarLatido(
    {
      redis,
      resolverIdentidad: async (): Promise<IdentidadLatido | null> => {
        const ctx = await getAuthContext();
        if (!ctx) return null;
        const u = ctx.user as { firstName?: string | null; lastName?: string | null } | null;
        const nombre = `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 80);
        return {
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          nombre,
          // No cuenta: «Ver como clínica» del admin de plataforma ni el dueño de la plataforma.
          cuenta: !ctx.suplantacion && !ctx.isSuperAdmin,
        };
      },
    },
    { supabaseId: user.id, sesion, clinicaCookie: readActiveClinicCookie(), ruta, ahora: Date.now() },
  );

  if (resultado.estado === 401) return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: SIN_CACHE });
  if (resultado.estado === 429) {
    return NextResponse.json(
      { error: "Demasiadas señales" },
      { status: 429, headers: { ...SIN_CACHE, "Retry-After": String(resultado.reintentarEnS) } },
    );
  }
  return NextResponse.json(
    "motivo" in resultado ? { ok: true, guardado: false, motivo: resultado.motivo } : { ok: true, guardado: true },
    { headers: SIN_CACHE },
  );
}
