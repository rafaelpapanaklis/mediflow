import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getAuthContextParaClaveDeSede } from "@/lib/auth-context";
import { sedeCerradaPara } from "@/lib/sede-clave/gate.server";
import { logMutation } from "@/lib/audit";
import { clearMustChangePassword } from "@/lib/auth/must-change-password";
import { scorePassword } from "@/components/public/auth/password-strength";
import { leerErrorContrasena } from "@/lib/auth/errores-contrasena";

// Service-role client. Mismo patrón que /api/team/[id]/reset-password —
// SUPABASE_SERVICE_ROLE_KEY NUNCA se expone al cliente.
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Lo que ve la persona: la pantalla «Crea tu contraseña» enseña `error` tal cual,
// así que todo va en español y sin jerga. `code` le dice al cliente qué salida
// ofrecer (sin sesión → volver a entrar).
const SIN_SESION = { error: "Tu sesión se cerró. Vuelve a entrar para cambiar tu contraseña.", code: "sin_sesion" } as const;
const SEDE_CERRADA = { error: "Escribe la clave de la sede antes de cambiar tu contraseña.", code: "sede_con_clave" } as const;
const NO_SE_PUDO = "No pudimos actualizar la contraseña. Inténtalo de nuevo.";

// POST /api/auth/change-password
//
// El propio usuario cambia SU contraseña. Es el único modo de levantar la marca
// mustChangePassword que puso quien generó la temporal (alta de miembro o
// reset), así que corre bajo /api/auth — allowlisted en el gate de plan (ver
// plan-status) para que una clínica suspendida también pueda salir del bloqueo.
//
// Multi-tenant: NADA sale del body salvo la contraseña. El usuario objetivo es
// SIEMPRE el de la sesión (getAuthContextParaClaveDeSede), nunca un id recibido — este endpoint
// no puede usarse para cambiarle la contraseña a nadie más.
//
// La contraseña NO se registra en ningún sitio: ni la vieja, ni la nueva, ni en
// el AuditLog ni en consola.
export async function POST(req: NextRequest) {
  // Sin el gate de la clave de la sede SOLO para el cambio forzado (ws1-t1,
  // 29-oct): la contraseña temporal es una barrera ANTERIOR a la clave (orden
  // del layout de /dashboard), así que quien la tiene pendiente en una sede con
  // clave tiene que poder salir de ella; con getAuthContext recibía 401 y se
  // quedaba sin salida. El 2FA sí se exige. Un cambio voluntario sigue
  // pidiendo la sede abierta, como antes.
  const ctx = await getAuthContextParaClaveDeSede();
  if (!ctx) return NextResponse.json(SIN_SESION, { status: 401 });
  if (
    ctx.user.mustChangePassword !== true &&
    (await sedeCerradaPara({ supabaseId: ctx.user.supabaseId, clinicId: ctx.clinicId }))
  ) {
    return NextResponse.json(SEDE_CERRADA, { status: 401 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[/api/auth/change-password] falta SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL");
    return NextResponse.json({ error: NO_SE_PUDO }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "No pudimos leer la contraseña. Inténtalo de nuevo." }, { status: 400 });
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
  // Estado ANTES de tocar nada, para que el AuditLog diga lo que de verdad pasó.
  // Este endpoint también sirve al usuario que cambia su contraseña sin estar
  // obligado: ahí la marca ya estaba en false y el log no debe inventar una
  // transición true→false que nunca ocurrió (el AuditLog se lee como fuente de
  // datos, no sólo como bitácora).
  const wasForced = ctx.user.mustChangePassword === true;

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
        // Cierra SOLO la sesión que acaba de nacer. scope "local" a propósito:
        // signOut() sin scope es "global" en supabase-js y revoca TODAS las
        // sesiones de la persona, la del navegador incluida — quien tecleaba
        // la temporal como nueva veía «debe ser distinta», escribía otra y le
        // salía 401 (repaso iPad ws1-t1, 29-oct).
        try { await probe.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
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
    const deContrasena = leerErrorContrasena(updateError);
    if (deContrasena?.motivo === "igual") {
      return NextResponse.json(
        { error: "La contraseña nueva debe ser distinta de la temporal." },
        { status: 400 },
      );
    }
    // Supabase la rechazó por SU regla (filtrada, corta, sin algún tipo de
    // carácter): es algo que el usuario arregla eligiendo otra, así que va como
    // 400 y con el motivo en español, no como el 500 genérico de abajo.
    if (deContrasena) {
      return NextResponse.json(
        { error: deContrasena.mensaje, code: "weak_password", reason: deContrasena.motivo },
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
  //
  // passwordChangedByOwner va en los dos lados con valores distintos para que
  // diffObjects SIEMPRE produzca al menos un campo: logMutation descarta el
  // update cuyo diff sale vacío, y un cambio de credenciales no puede perderse
  // por no haber movido ninguna columna.
  await logMutation({
    req,
    clinicId:   ctx.clinicId,
    userId:     ctx.userId,
    entityType: "user",
    entityId:   ctx.userId,
    action:     "update",
    before:     { passwordChangedByOwner: false, mustChangePassword: wasForced },
    after:      { passwordChangedByOwner: true,  mustChangePassword: false     },
  });

  return NextResponse.json({ success: true });
}
