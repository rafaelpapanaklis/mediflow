import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { paymentHistoryHandler } from "@/lib/import/pagos-historial/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/payment-history — importa el HISTORIAL DE PAGOS migrado
 * (Dentalink "Pagos pacientes" y equivalentes). Cada fila entra como un
 * MigratedPayment de solo lectura: NUNCA cambia el saldo del paciente (ese
 * viene del archivo de saldos, /api/import/balances) ni toca invoices/payments
 * (Caja, cortes de caja, CFDI y WhatsApp lo ignoran sin código nuevo).
 *
 * Ruta NUEVA y aparte de src/app/api/import/balances/route.ts: usa el mismo
 * `runImport` del motor (engine.ts, sin tocarlo) pero con un handler propio
 * (src/lib/import/pagos-historial/handler.ts) — entities.ts NO se tocó
 * (ws1-t12 lo está cambiando en paralelo). Aún no está en la detección
 * automática de "varios archivos" del asistente: eso es el registro final,
 * pendiente de que esa tarea termine.
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión. Acceso: ADMIN/RECEPCIONISTA +
 * "billing.create" (mismo candado que /api/import/balances: crea historial
 * financiero del paciente).
 */
export async function POST(req: NextRequest) {
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
    const result = await runImport(paymentHistoryHandler, {
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
