import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { quotesHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/quotes — importa PRESUPUESTOS (entity="quotes"): cada fila
 * es una línea; se agrupan por paciente + folio original (o día). Entran con
 * status "MIGRATED": historia, no una venta — sin factura, sin CFDI, sin caja.
 * Los procedimientos que no casan con el tarifario entran sin ligar, o ligados
 * al equivalente que el usuario eligió (valueMapping.procedure).
 *
 * Mismo contrato que /api/patients/import (FormData + dry-run/commit), más
 * `origin` (perfil del sistema de origen) y `valueMapping` opcionales.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 * Acceso: el mismo gate de rol que las demás importaciones (ADMIN/RECEPCIONISTA,
 * SUPER_ADMIN incluido) y, además, la misma llave que crear un presupuesto a mano
 * (POST /api/quotes): "billing.create".
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
  const deniedPerm = denyIfMissingPermission(ctx, "billing.create");
  if (deniedPerm) return deniedPerm;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(quotesHandler, {
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
