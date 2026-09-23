import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { balancesHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/balances — importa SALDOS (entity="balances"). Crea una
 * "factura de apertura" (Invoice) por paciente con su saldo (concepto
 * "Saldo inicial migrado", balance=monto, SIN CFDI). Resuelve al paciente por
 * teléfono(last10)/correo/nombre dentro de la clínica.
 *
 * Mismo contrato que /api/patients/import (FormData + dry-run/commit). Idempotente:
 * si el paciente ya tiene saldo inicial migrado, la fila se marca como duplicado.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 * Acceso: solo ADMIN/RECEPCIONISTA (SUPER_ADMIN incluido). Importar saldos crea
 * registros financieros (Invoice), así que el DOCTOR no puede hacerlo en masa.
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

  try {
    const form = await parseImportForm(req);
    const result = await runImport(balancesHandler, {
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
