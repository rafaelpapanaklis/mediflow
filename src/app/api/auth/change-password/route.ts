import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth-context";
import { logMutation } from "@/lib/audit";
import { clearMustChangePassword } from "@/lib/auth/must-change-password";
import { scorePassword } from "@/components/public/auth/password-strength";

// Service-role client. Mismo patrón que /api/team/[id]/reset-password —
// SUPABASE_SERVICE_ROLE_KEY NUNCA se expone al cliente.
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// POST /api/auth/change-password
//
// El propio usuario cambia SU contraseña. Es el único modo de levantar la marca
// mustChangePassword que puso quien generó la temporal (alta de miembro o
// reset), así que corre bajo /api/auth — allowlisted en el gate de plan (ver
// plan-status) para que una clínica suspendida también pueda salir del bloqueo.
//
// Multi-tenant: NADA sale del body salvo la contraseña. El usuario objetivo es
// SIEMPRE el de la sesión (getAuthContext), nunca un id recibido — este endpoint
// no puede usarse para cambiarle la contraseña a nadie más.
//
// La contraseña NO se registra en ningún sitio: ni la vieja, ni la nueva, ni en
// el AuditLog ni en consola.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service role no está configurado en el servidor" },
      { status: 500 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const password = typeof body?.password === "string" ? body.password : "";

  // Fuerza: mismo criterio que el registro público y la recuperación por correo
  // (mínimo 8 + scorePassword >= "Regular"). Se importa scorePassword en vez de
  // reescribir la regla para que las tres superficies no se desincronicen.
  if (password.length < 8 || scorePassword(password) < 2) {
    return NextResponse.json(
      { error: "La contraseña es muy débil. Usa al menos 8 caracteres combinando mayúsculas, minúsculas y números." },
      { status: 400 },
    );
  }
  // Supabase Auth (bcrypt) trunca/rechaza > 72 chars — cortamos con error claro.
  if (password.length > 72) {
    return NextResponse.json(
      { error: "La contraseña no puede exceder 72 caracteres" },
      { status: 400 },
    );
  }

  const supabaseId = ctx.user.supabaseId as string;
  const email      = (ctx.user.email as string | null | undefined) ?? "";

  // ── Rechazar quedarse con la temporal ────────────────────────────────────
  // La temporal no se guarda en ningún lado (a propósito), así que no hay nada
  // con qué comparar: la única prueba fiable de "es la misma" es que AUTENTIQUE.
  // Se intenta iniciar sesión con la candidata en un client desechable
  // (persistSession:false → no toca las cookies de la sesión abierta); si entra,
  // es la que ya tenía y no ha cambiado nada.
  //
  // Sin credenciales anon o ante un fallo de red no se bloquea el cambio: abajo
  // queda la red de seguridad del propio GoTrue, que rechaza la contraseña
  // repetida con "should be different from the old password".
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (email && anonKey) {
    try {
      const probe = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: probeData } = await probe.auth.signInWithPassword({ email, password });
      if (probeData?.user) {
        // Cierra el refresh token que acaba de nacer; la sesión del navegador
        // no se toca (este client es aparte y no persiste nada).
        try { await probe.auth.signOut(); } catch { /* ignore */ }
        return NextResponse.json(
          { error: "La contraseña nueva debe ser distinta de la temporal." },
          { status: 400 },
        );
      }
    } catch {
      /* la comprobación es best-effort; sigue el camino normal */
    }
  }

  // ── Supabase PRIMERO ─────────────────────────────────────────────────────
  // Auth es la fuente de verdad del login; Prisma sólo guarda la marca. Si Auth
  // falla no se toca Prisma: dejar mustChangePassword en false con la contraseña
  // vieja todavía viva sería exactamente el agujero que esto viene a cerrar.
  const { error: updateError } = await getAdminClient().auth.admin.updateUserById(
    supabaseId,
    { password },
  );

  if (updateError) {
    const msg = updateError.message ?? "";
    if (/different from the old password/i.test(msg)) {
      return NextResponse.json(
        { error: "La contraseña nueva debe ser distinta de la temporal." },
        { status: 400 },
      );
    }
    // Se registra el error de Supabase, JAMÁS la contraseña.
    console.error("[/api/auth/change-password] supabase update failed:", msg);
    return NextResponse.json(
      { error: "No se pudo actualizar la contraseña. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  // Auth dijo OK → se levanta la exigencia en TODAS las filas del mismo
  // supabaseId (una por clínica; la contraseña es global). Ver
  // clearMustChangePassword.
  await clearMustChangePassword(supabaseId);

  // Auditoría: un cambio de credenciales debe quedar rastreado. Se registra el
  // HECHO, nunca la contraseña — ni la vieja ni la nueva.
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "user",
    entityId:   ctx.userId,
    action:     "update",
    before:     { mustChangePassword: true,  passwordSetBy: "system" },
    after:      { mustChangePassword: false, passwordSetBy: "user"   },
  });

  return NextResponse.json({ success: true });
}
