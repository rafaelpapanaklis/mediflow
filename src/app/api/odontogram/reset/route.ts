import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractAuditMeta } from "@/lib/audit";
import { getDbUser, isMissingTableError } from "@/lib/odontogram/api-auth";

export const dynamic = "force-dynamic";

/** Roles que pueden borrar el odontograma vivo. Recepción/readonly NO. */
const DESTRUCTIVE_ROLES = new Set<string>(["SUPER_ADMIN", "ADMIN", "DOCTOR"]);

/** POST /api/odontogram/reset?patientId=ID — borra todas las entries del paciente. */
export async function POST(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!DESTRUCTIVE_ROLES.has(dbUser.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const patientId = req.nextUrl.searchParams.get("patientId");
    if (!patientId) {
      return NextResponse.json({ error: "missing_patientId" }, { status: 400 });
    }
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, clinicId: dbUser.clinicId },
      select: { id: true },
    });
    if (!patient) {
      return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
    }

    const { ipAddress, userAgent } = extractAuditMeta(req);
    // Borrado + snapshot defensivo + audit en UNA transacción: las filas
    // borradas quedan serializadas en audit_logs.changes (Json) si y solo si
    // el borrado se aplicó — restaurables a mano ante un reset accidental.
    // (No hay tabla de versiones y el schema no se toca: audit es el lugar.)
    const deleted = await prisma.$transaction(async (tx) => {
      const prevRows = await tx.odontogramEntry.findMany({
        where: { patientId },
        select: { toothNumber: true, surface: true, conditionId: true, notes: true },
        orderBy: { toothNumber: "asc" },
      });
      const del = await tx.odontogramEntry.deleteMany({ where: { patientId } });
      await tx.auditLog.create({
        data: {
          clinicId: dbUser.clinicId,
          userId: dbUser.id,
          entityType: "patient",
          entityId: patientId,
          action: "odontogram_reset",
          changes: {
            _odontogram: { before: { count: del.count, rows: prevRows }, after: { count: 0 } },
          },
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });
      return del.count;
    });

    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "La tabla odontogram_entries no existe. Aplica la migración en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[/api/odontogram/reset] unexpected error", err);
    return NextResponse.json(
      { error: "internal_error", reason: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
