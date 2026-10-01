import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfNotClinical } from "@/lib/auth/guardia-clinica";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { odontogramHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/odontogram — importa el estado del ODONTOGRAMA (entity=
 * "odontogram") a odontogram_entries: el mismo modelo que pinta la pestaña
 * Odontograma del paciente, nunca un catálogo aparte.
 *
 * Mismo contrato que /api/patients/import (FormData + dry-run/commit), más
 * `origin` (perfil del sistema de origen) y `valueMapping` (para emparejar un
 * hallazgo del archivo que no case con el catálogo del panel).
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 * Acceso: SOLO quien puede escribir el odontograma en el panel — SUPER_ADMIN /
 * ADMIN / DOCTOR (ver ROLES_QUE_ESCRIBEN_ODONTOGRAMA en
 * @/lib/odontogram/api-auth). Recepción no lo tiene ahí y tampoco aquí: el
 * odontograma es expediente clínico, y una migración en bloque no es una
 * puerta trasera para escribirlo sin ese permiso.
 */
export async function POST(req: NextRequest) {
  // 6/min por IP y ruta: el asistente hace vista previa + (si el usuario
  // corrige el mapeo) otra vista previa + importar, por entidad.
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "DOCTOR");
  if (roleGate) return roleGate;
  // M6: además del rol, el permiso clínico (un doctor sin «Editar notas SOAP»
  // tampoco escribe el odontograma en bloque).
  const sinPermiso = denyIfNotClinical(ctx, "editar");
  if (sinPermiso) return sinPermiso;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(odontogramHandler, {
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
