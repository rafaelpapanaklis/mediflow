import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { sedesAjenasPara, taparFilaDeBitacora } from "@/lib/admin/audit-sedes-ajenas";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  const entityId   = searchParams.get("entityId");

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType and entityId required" }, { status: 400 });
  }

  // Visibilidad por paciente: si se consulta la bitácora de un paciente, no
  // exponerla a quien no puede ver a ese paciente. Es la tarjeta «Bitácora» del
  // historial del paciente, que ve cualquier rol que vea al paciente.
  if (entityType === "patient") {
    const denied = await assertPatientVisible(entityId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  } else if (!ctx.isAdmin) {
    // ws1-t4 v8: la bitácora de todo lo demás (miembros, la clínica, sedes…) es Auditoría,
    // y Auditoría es solo de dueño y admin (/dashboard/auditoria, /api/auditoria).
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      clinicId:   ctx.clinicId,
      entityType,
      entityId,
    },
    include: {
      user: { select: { firstName: true, lastName: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // ws1-t4 v8: nada de otra sede a la que quien mira no tiene acceso (sale «otra sede»).
  const ajenas = await sedesAjenasPara(ctx.clinicId, ctx.user?.supabaseId);
  return NextResponse.json(logs.map((l) => taparFilaDeBitacora(l, ajenas)));
}
