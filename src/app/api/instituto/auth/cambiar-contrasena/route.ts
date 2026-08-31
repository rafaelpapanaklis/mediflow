import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEduContext } from "@/lib/edu-auth";
import { prisma } from "@/lib/prisma";
import { rateLimitKey } from "@/lib/rate-limit";
import { scorePassword } from "@/components/public/auth/password-strength";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/instituto/auth/cambiar-contrasena — la persona cambia SU
 * contraseña (P2-9). Es el único modo de levantar `mustChangePassword`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ EXISTE Y NO SE LLAMA AL DEL DENTAL. /api/auth/change-password
 * se autentica con getAuthContext(), que exige una fila `User` de CLÍNICA:
 * un EduUser recibe 401. Lo que sí se copia de ahí es lo que costó
 * aprender: el criterio de fuerza (scorePassword, importado y no reescrito
 * para que las superficies no se desincronicen), el tope de 72 (bcrypt), la
 * comprobación best-effort de "es la misma temporal" y el orden Auth
 * PRIMERO / Prisma después.
 *
 * 🔴 MULTI-TENANT: NADA sale del body salvo la contraseña. La cuenta que
 * se cambia es SIEMPRE la de la sesión (getEduContext) — este endpoint no
 * puede cambiarle la contraseña a nadie más.
 *
 * 🔴 La marca se levanta en TODAS las filas edu_users de ese supabaseId
 * (una por instituto): la contraseña es de la CUENTA, no del instituto. La
 * fila del dental no se toca — este vertical no escribe tablas del dental,
 * y si allá había un cambio forzado pendiente, allá se resuelve.
 *
 * La contraseña NO se registra en ningún sitio: ni la vieja, ni la nueva,
 * ni en consola.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function POST(req: NextRequest) {
  const ctx = await getEduContext();
  if (!ctx) {
    return NextResponse.json({ error: "Tu sesión caducó. Vuelve a entrar." }, { status: 401 });
  }

  // Freno suave contra el bucle: cambiar una contraseña es un acto que una
  // persona hace una vez, no cinco por minuto.
  if (!rateLimitKey(`edu-cambiar-pass:${ctx.eduUserId}`, 5)) {
    return NextResponse.json(
      { error: "Demasiados intentos seguidos. Espera un minuto." },
      { status: 429 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        error:
          "Este servidor no está configurado para cambiar contraseñas. Avísale a quien administra DaleControl.",
      },
      { status: 500 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    /* body vacío: cae en la validación de abajo */
  }

  const password = typeof body.password === "string" ? body.password : "";

  // El MISMO criterio que el registro público del producto y que el cambio
  // del dental: mínimo 8 y scorePassword >= 2.
  if (password.length < 8 || scorePassword(password) < 2) {
    return NextResponse.json(
      {
        error:
          "La contraseña es muy débil. Usa al menos 8 caracteres combinando mayúsculas, minúsculas y números.",
      },
      { status: 400 },
    );
  }
  // Supabase Auth (bcrypt) trunca o rechaza más de 72.
  if (password.length > 72) {
    return NextResponse.json(
      { error: "La contraseña no puede pasar de 72 caracteres." },
      { status: 400 },
    );
  }

  // ── ¿Es la misma temporal? ────────────────────────────────────────────
  // La temporal no se guarda en ningún lado (a propósito), así que la única
  // prueba fiable de "es la misma" es que AUTENTIQUE. Cliente desechable
  // (persistSession: false → no toca las cookies de la sesión abierta).
  // Best-effort: sin llave anon o con la red caída no se bloquea el cambio
  // — abajo queda la red del propio GoTrue, que rechaza la repetida.
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (ctx.user.email && anonKey) {
    try {
      const probe = createAdminClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: probeData } = await probe.auth.signInWithPassword({
        email: ctx.user.email,
        password,
      });
      if (probeData?.user) {
        try {
          await probe.auth.signOut();
        } catch {
          /* ignore */
        }
        return NextResponse.json(
          { error: "La contraseña nueva tiene que ser distinta de la que ya tienes." },
          { status: 400 },
        );
      }
    } catch {
      /* best-effort; sigue el camino normal */
    }
  }

  // ── Supabase PRIMERO ──────────────────────────────────────────────────
  // Auth es la fuente de verdad del login; Prisma solo guarda la marca. Si
  // Auth falla NO se toca Prisma: dejar mustChangePassword en false con la
  // contraseña vieja todavía viva sería exactamente el agujero que esto
  // viene a cerrar.
  const admin = createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: updateError } = await admin.auth.admin.updateUserById(ctx.user.supabaseId, {
    password,
  });

  if (updateError) {
    const msg = updateError.message ?? "";
    if (/different from the old password/i.test(msg)) {
      return NextResponse.json(
        { error: "La contraseña nueva tiene que ser distinta de la que ya tienes." },
        { status: 400 },
      );
    }
    console.error("[instituto/auth] cambio de contraseña falló en Supabase:", msg);
    return NextResponse.json(
      { error: "No se pudo cambiar la contraseña. Intenta de nuevo." },
      { status: 500 },
    );
  }

  // Auth dijo OK → se levanta la exigencia en TODAS las filas edu de esta
  // cuenta (la contraseña es global a la cuenta, no del instituto).
  await prisma.eduUser.updateMany({
    where: { supabaseId: ctx.user.supabaseId },
    data: { mustChangePassword: false },
  });

  return NextResponse.json({ ok: true });
}
