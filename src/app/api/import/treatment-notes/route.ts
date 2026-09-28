import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { treatmentNotesHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/treatment-notes — importa NOTAS DE EVOLUCIÓN de un
 * tratamiento (entity="treatmentNotes"). Con folio que liga con un tratamiento
 * activo migrado (treatmentPlansHandler) y una sesión de esa fecha exacta, el
 * texto se AGREGA a las notas de esa sesión (treatment_sessions); si no liga
 * con nada, entra al expediente como nota MIGRATED (patient_documents), igual
 * que /api/import/clinical-notes.
 *
 * Mismo contrato que /api/patients/import (FormData + dry-run/commit), más
 * `origin` y `valueMapping` opcionales.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 * Acceso: puede escribir en CUALQUIERA de los dos destinos, así que exige los
 * DOS permisos — "medicalRecord.edit" (notas clínicas) Y "treatments.edit"
 * (registrar sesiones de un plan de tratamiento) — el mismo criterio que
 * /api/import/treatment-plans exige "billing.create" Y "treatments.edit"
 * porque una sola fila puede tocar cualquiera de sus destinos.
 */
export async function POST(req: NextRequest) {
  // 6/min por IP y ruta: el asistente hace vista previa + (si el usuario
  // corrige el mapeo) otra vista previa + importar, por entidad.
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  const deniedNotes = denyIfMissingPermission(ctx, "medicalRecord.edit");
  if (deniedNotes) return deniedNotes;
  const deniedTreatments = denyIfMissingPermission(ctx, "treatments.edit");
  if (deniedTreatments) return deniedTreatments;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(treatmentNotesHandler, {
      file: form.file,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      role: ctx.role,
      dryRun: form.dryRun,
      skipDuplicates: form.skipDuplicates,
      columnMapping: form.columnMapping,
      origin: form.origin,
      valueMapping: form.valueMapping,
      sheet: form.sheet,
    });
    return NextResponse.json(result);
  } catch (e) {
    return importErrorResponse(e);
  }
}
