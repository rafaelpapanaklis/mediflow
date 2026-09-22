import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { medicalHistoryHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/medical-history — importa EXPEDIENTES (entity="medicalHistory"):
 * los antecedentes de pacientes que ya existen (alergias, padecimientos,
 * medicamentos, heredofamiliares, no patológicos). Se escriben en la ficha
 * (Patient), que es donde los lee el expediente en PDF. Suma, nunca pisa.
 *
 * Mismo contrato que /api/patients/import (FormData + dry-run/commit), más
 * `origin` (perfil del sistema de origen) y `valueMapping` opcionales.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 * Acceso: el mismo gate de rol que las demás importaciones (ADMIN/RECEPCIONISTA,
 * SUPER_ADMIN incluido) y, además, el permiso con el que se editan hoy esos campos
 * en la ficha: "patients.edit".
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
  const deniedPerm = denyIfMissingPermission(ctx, "patients.edit");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(medicalHistoryHandler, {
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
