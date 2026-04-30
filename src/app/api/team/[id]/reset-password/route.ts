import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { logAudit, extractAuditMeta } from "@/lib/audit";

// Service-role client. Mismo patrón que /api/team/[id]/route.ts:8-13 —
// usa SUPABASE_SERVICE_ROLE_KEY (NUNCA exponer al cliente). Disable de
// session/refresh porque el client es solo para llamar admin endpoints.
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// Genera un password temporal alfanumérico de 12 chars (mayúsculas,
// minúsculas, dígitos). ~71 bits de entropía. Lo bastante fuerte para un
// uso único hasta que el user lo cambie por uno propio.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generateTempPassword(len = 12): string {
  // crypto global está disponible en runtime Node 20+ y Edge — getRandomValues
  // es criptográficamente seguro, no Math.random().
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// POST /api/team/[id]/reset-password
//
// Sólo SUPER_ADMIN. Reemplaza el password del target via Supabase Admin API.
// Devuelve el password temporal una sola vez — el SUPER_ADMIN lo entrega al
// usuario por canal seguro (Slack/WhatsApp/etc). Si lo pierde, hay que
// volver a resetear.
//
// Multi-tenant: aunque SUPER_ADMIN tiene acceso global a su clínica, exigimos
// que el target pertenezca a la misma clinicId — defensa adicional contra
// scenarios de un super-admin tocando users de otra clínica.
//
// Lock-out defense: rechaza target.role === "SUPER_ADMIN" para que un super
// no pueda forzar cambio de password de otro super.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Solo SUPER_ADMIN puede resetear contraseñas" }, { status: 403 });
  }

  // Multi-tenant: target user en la misma clinic del actor.
  const target = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, supabaseId: true, role: true, firstName: true, lastName: true, email: true, isActive: true },
  });
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  if (target.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "No se puede resetear contraseña de otro SUPER_ADMIN" }, { status: 400 });
  }

  if (!target.isActive) {
    return NextResponse.json({ error: "El usuario está desactivado — reactívalo antes de resetear contraseña" }, { status: 400 });
  }

  const tempPassword = generateTempPassword(12);

  const supabaseAdmin = getAdminClient();
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    target.supabaseId,
    { password: tempPassword },
  );

  if (updateError) {
    console.error("[/api/team/[id]/reset-password] supabase update failed:", updateError);
    return NextResponse.json({ error: "No se pudo actualizar la contraseña en Supabase" }, { status: 500 });
  }

  // Audit log — guardamos quién reseteó a quién y cuándo. NO guardamos el
  // password (ni hash) en el log: solo la acción y el target. Usamos
  // logAudit directo porque logMutation está limitado a create/update/delete
  // y nuestro AuditAction "password_reset" es una acción dedicada con
  // semántica de seguridad propia (requiere SUPER_ADMIN, ya gateado arriba).
  const meta = extractAuditMeta(req);
  await logAudit({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "user",
    entityId: target.id,
    action: "password_reset",
    changes: {
      email:  { before: target.email, after: target.email },
      target: { before: null, after: `${target.firstName} ${target.lastName}` },
    },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ success: true, tempPassword });
}
