import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { labExpenseHandler } from "@/lib/import/laboratorio-historial/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/lab-expenses — importa el HISTORIAL DE GASTOS DE
 * LABORATORIO migrado (Dentalink "Laboratorio → Acciones/Costos" y
 * equivalentes). Cada fila entra como un MigratedLabExpense de solo lectura:
 * NUNCA cambia el saldo del paciente ni toca invoices/payments (Caja, cortes
 * de caja, CFDI y WhatsApp lo ignoran sin código nuevo). El panel no tiene un
 * módulo de costos de laboratorio (LabOrder/LabPartner son flujo clínico de
 * órdenes, sin campo de costo) — ver la nota en schema.prisma.
 *
 * Ruta NUEVA y aparte de src/app/api/import/payment-history/route.ts: usa el
 * mismo `runImport` del motor (engine.ts, sin tocarlo) pero con un handler
 * propio (src/lib/import/laboratorio-historial/handler.ts) — entities.ts NO
 * se tocó (varias pantallas de esta ola lo están cambiando en paralelo). Aún
 * no está en la detección automática de "varios archivos" del asistente: eso
 * es el registro final, pendiente de ws1-t12 (dueño del motor).
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión. Acceso: ADMIN/RECEPCIONISTA +
 * "billing.create" (mismo candado que /api/import/payment-history: crea
 * historial financiero del paciente).
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
    const result = await runImport(labExpenseHandler, {
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
