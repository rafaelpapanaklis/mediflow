import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { clearMustChangePassword } from "@/lib/auth/must-change-password";
import { aplicarContrasenaAlMiembro } from "@/lib/team/aplicar-contrasena";
import { validarContrasenaNueva } from "@/lib/team/contrasena-nueva";

// Service-role client. Mismo patrón que /api/team/[id]/reset-password —
// SUPABASE_SERVICE_ROLE_KEY NUNCA se expone al cliente.
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// POST /api/team/[id]/set-password   body: { password, confirmacion }
//
// «Establecer contraseña nueva» (ws1-t4): el dueño escribe la contraseña del
// miembro sin saber la anterior y desde ese momento el miembro entra con ella.
// Mismas reglas que Restablecer: solo SUPER_ADMIN, solo miembros de SU clínica,
// nunca sobre sí mismo ni sobre otro SUPER_ADMIN, nunca sobre un desactivado.
//
// A diferencia de Restablecer, NO se exige cambiarla al entrar: es la que el
// dueño decidió. Y se levanta la marca si quedaba una temporal pendiente.
//
// Las sesiones abiertas del miembro se cierran solas: Supabase Auth hace
// Logout de todas al cambiar la contraseña por la API de administración (ver
// src/lib/team/aplicar-contrasena.ts).
//
// ⛔ La contraseña no se devuelve, no se registra en la bitácora ni en consola.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Solo el dueño de la clínica puede establecer contraseñas" }, { status: 403 });
  }
  if (!ctx.clinicId) return NextResponse.json({ error: "Sin clínica activa" }, { status: 400 });

  if (params.id === ctx.userId) {
    return NextResponse.json({
      error: "No puedes cambiar tu propia contraseña desde Equipo. Hazlo en Configuración → Seguridad.",
    }, { status: 400 });
  }

  let body: { password?: unknown; confirmacion?: unknown } = {};
  try { body = await req.json(); } catch { /* cuerpo vacío o no-JSON → cae en la validación */ }
  const problema = validarContrasenaNueva(body.password, body.confirmacion ?? body.password);
  if (problema) return NextResponse.json({ error: problema, code: "CONTRASENA_INVALIDA" }, { status: 400 });
  const contrasena = body.password as string;

  // Multi-tenant: target en la clínica de la SESIÓN, nunca la del cliente.
  const target = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, supabaseId: true, role: true, firstName: true, lastName: true, email: true, isActive: true },
  });
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  if (target.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "No se puede cambiar la contraseña de otro dueño (SUPER_ADMIN)" }, { status: 400 });
  }
  if (!target.isActive) {
    return NextResponse.json({ error: "El miembro está desactivado — reactívalo antes de cambiarle la contraseña" }, { status: 400 });
  }

  const aplicada = await aplicarContrasenaAlMiembro({
    admin: getAdminClient(),
    miembro: { supabaseId: target.supabaseId, email: target.email },
    contrasena,
    nombreBoton: "Establecer contraseña nueva",
    origen: "/api/team/[id]/set-password",
  });
  if (aplicada.ok === false) {
    return NextResponse.json(
      { error: aplicada.error, ...(aplicada.code && { code: aplicada.code }) },
      { status: aplicada.status },
    );
  }

  // Si quedaba una temporal de un Restablecer anterior, ya no aplica: la de
  // ahora es definitiva. Todas las filas hermanas (la contraseña es global).
  await clearMustChangePassword(aplicada.supabaseId);

  const actor = await prisma.user.findFirst({
    where: { id: ctx.userId, clinicId: ctx.clinicId },
    select: { firstName: true, lastName: true },
  });
  const nombreActor = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "El dueño";
  const nombreMiembro = `${target.firstName} ${target.lastName}`.trim();

  // Rastro SIN la contraseña (ni hash, ni longitud): quién, a quién, cuándo.
  const meta = extractAuditMeta(req);
  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "user",
    entityId: target.id,
    action: "password_set",
    changes: {
      descripcion: { before: null, after: `${nombreActor} estableció una contraseña nueva para ${nombreMiembro}` },
      email: { before: target.email, after: target.email },
      target: { before: null, after: nombreMiembro },
      ...(aplicada.cuentaCreada && { cuentaDeAccesoCreada: { before: false, after: true } }),
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({
    success: true,
    cuentaCreada: aplicada.cuentaCreada,
    mensaje: "Contraseña actualizada: ya puede entrar con ella.",
    ...(aplicada.cuentaCreada && {
      aviso: `${target.firstName} no tenía cuenta de acceso: se le creó una con el correo ${target.email} y esta contraseña.`,
    }),
  });
}
