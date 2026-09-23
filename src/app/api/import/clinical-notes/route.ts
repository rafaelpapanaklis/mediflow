import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { clinicalNotesHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/clinical-notes — importa NOTAS DE EVOLUCIÓN (entity=
 * "clinicalNotes") a patient_documents (NOTA_EVOLUCION), marcadas "MIGRATED":
 * con su fecha original, su autor original y el sistema de origen. No quedan
 * firmadas en esta clínica ni se pueden editar, firmar ni enviar.
 *
 * Mismo contrato que /api/patients/import (FormData + dry-run/commit), más
 * `origin` (perfil del sistema de origen) y `valueMapping` opcionales.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 * Acceso: el mismo gate de rol que las demás importaciones (ADMIN/RECEPCIONISTA,
 * SUPER_ADMIN incluido) y, además, el permiso de escribir notas clínicas,
 * "medicalRecord.edit" (recepción no lo tiene por defecto: una nota clínica no
 * la migra quien no puede escribirla).
 */
export async function POST(req: NextRequest) {
  // 6/min por IP y ruta: el asistente hace vista previa + (si el usuario
  // corrige el mapeo) otra vista previa + importar, por entidad. Con 3 un solo
  // ajuste de columnas dejaba el «Importar» en 429.
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  const deniedPerm = denyIfMissingPermission(ctx, "medicalRecord.edit");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(clinicalNotesHandler, {
      file: form.file,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      role: ctx.role,
      dryRun: form.dryRun,
      skipDuplicates: form.skipDuplicates,
      columnMapping: form.columnMapping,
      origin: form.origin,
      valueMapping: form.valueMapping,
    });
    return NextResponse.json(result);
  } catch (e) {
    return importErrorResponse(e);
  }
}
