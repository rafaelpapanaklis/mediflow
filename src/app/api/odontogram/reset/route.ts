import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractAuditMeta } from "@/lib/audit";
import { anotarAccionDeSuplantacion, suplantacionDeEstaPeticion } from "@/lib/admin/suplantacion";
import { getDbUser, isMissingTableError, puedeEscribirOdontograma } from "@/lib/odontogram/api-auth";
import { assertPatientVisible } from "@/lib/patient-visibility";

export const dynamic = "force-dynamic";

/** Quién puede borrar el odontograma vivo: lo decide puedeEscribirOdontograma
 *  (@/lib/odontogram/api-auth → guardia clínica, `medicalRecord.edit` con el
 *  override por persona). Recepción/readonly NO. */

/** POST /api/odontogram/reset?patientId=ID — borra todas las entries del paciente. */
export async function POST(req: NextRequest) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!puedeEscribirOdontograma(dbUser)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const patientId = req.nextUrl.searchParams.get("patientId");
    if (!patientId) {
      return NextResponse.json({ error: "missing_patientId" }, { status: 400 });
    }
    // Visibilidad + existencia + tenant en un solo query: un paciente restringido
    // que este usuario no puede ver da 404 (igual que su GET hermano en
    // /api/odontogram) — no revelar existencia ni permitir el borrado destructivo.
    const denied = await assertPatientVisible(patientId, {
      userId: dbUser.id,
      role: dbUser.role,
      clinicId: dbUser.clinicId,
    });
    if (denied) return denied;

    const { ipAddress, userAgent } = extractAuditMeta(req);
    // Borrado + snapshot defensivo + audit en UNA transacción: las filas
    // borradas quedan serializadas en audit_logs.changes (Json) si y solo si
    // el borrado se aplicó — restaurables a mano ante un reset accidental.
    // (No hay tabla de versiones y el schema no se toca: audit es el lugar.)
    // «Ver como clínica» (decisión A): la foto de antes va a la bitácora de admin, no a la de la clínica.
    const suplantacion = await suplantacionDeEstaPeticion();
    let cambiosParaAdmin: unknown = null;
    const deleted = await prisma.$transaction(async (tx) => {
      const prevRows = await tx.odontogramEntry.findMany({
        where: { patientId },
        select: { toothNumber: true, surface: true, conditionId: true, notes: true },
        orderBy: { toothNumber: "asc" },
      });
      const del = await tx.odontogramEntry.deleteMany({ where: { patientId } });
      if (suplantacion) {
        cambiosParaAdmin = {
          _odontogram: { before: { count: del.count, rows: prevRows }, after: { count: 0 } },
        };
      } else {
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
      }
      return del.count;
    });
    if (suplantacion) {
      await anotarAccionDeSuplantacion(suplantacion, {
        clinicId: dbUser.clinicId, entityType: "patient", entityId: patientId, action: "odontogram_reset",
        changes: cambiosParaAdmin, patientId, ipAddress, userAgent,
      });
    }

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
