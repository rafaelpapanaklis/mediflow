import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { logMutation } from "@/lib/audit";
import { sanitizePermissionKeys } from "@/lib/auth/permissions";

// PATCH /api/team/[id]/permissions
//
// Body: { permissionsOverride: string[] | null }
//   - array → reemplaza el override actual con las keys validas (las
//     desconocidas se descartan).
//   - null  → vuelve al default del role (limpia el array).
//
// Solo SUPER_ADMIN. Multi-tenant: el target user.id debe pertenecer al
// mismo clinicId del SUPER_ADMIN. Audit log obligatorio.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Solo SUPER_ADMIN puede gestionar permisos" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = body?.permissionsOverride;

  // Acepta null (reset) o array.
  if (raw !== null && !Array.isArray(raw)) {
    return NextResponse.json({ error: "permissionsOverride debe ser null o array" }, { status: 400 });
  }

  // Multi-tenant: el user objetivo tiene que estar en la clinica del actor.
  const target = await prisma.user.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true, role: true, permissionsOverride: true, firstName: true, lastName: true },
  });
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  // No permitir editar permisos de otro SUPER_ADMIN — defensa contra
  // takeover / lock-out cruzado.
  if (target.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "No se pueden modificar permisos de SUPER_ADMIN" }, { status: 400 });
  }

  const newOverride = raw === null ? [] : sanitizePermissionKeys(raw);

  await prisma.user.update({
    where: { id: params.id },
    data: { permissionsOverride: newOverride },
  });

  await logMutation({
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "user",
    entityId: params.id,
    action: "update",
    before: { permissionsOverride: target.permissionsOverride },
    after:  { permissionsOverride: newOverride, usingDefault: newOverride.length === 0 },
  });

  return NextResponse.json({ success: true, permissionsOverride: newOverride });
}
