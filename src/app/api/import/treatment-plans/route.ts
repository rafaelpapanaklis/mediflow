import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { parseImportForm, runImport, importErrorResponse } from "@/lib/import/engine";
import { treatmentPlansHandler } from "@/lib/import/entities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/treatment-plans — importa TRATAMIENTOS ACTIVOS
 * (entity="treatmentPlans"): mismo archivo que un presupuesto (una fila por
 * línea/prestación, agrupadas por folio o paciente+día), pero a diferencia de
 * /api/import/quotes (que entra como historia MIGRATED) esto entra VIVO: un
 * Quote ACCEPTED + TreatmentPlan (ACTIVE/COMPLETED) + TreatmentSession de lo ya
 * hecho + Invoice + Payment de lo ya abonado — sin condiciones de pago, para que
 * el barrido de cobranza no le mande WhatsApp a historia migrada.
 *
 * Permiso: las DOS llaves de las dos acciones que esto hace de un solo golpe —
 * "billing.create" (nace una factura, como /api/import/quotes) y
 * "treatments.edit" (nace un plan de tratamiento, como
 * POST /api/quotes/[id]/treatment-plan) — además del mismo gate de rol que el
 * resto del importador (ADMIN/RECEPCIONISTA, SUPER_ADMIN incluido).
 *
 * Multi-tenant: clinicId SIEMPRE de la sesión (getAuthContext), nunca del body.
 */
export async function POST(req: NextRequest) {
  // Mismo tope que las demás entidades del importador (vista previa + ajuste + importar).
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  const deniedBilling = denyIfMissingPermission(ctx, "billing.create");
  if (deniedBilling) return deniedBilling;
  const deniedTreatments = denyIfMissingPermission(ctx, "treatments.edit");
  if (deniedTreatments) return deniedTreatments;

  try {
    const form = await parseImportForm(req);
    const result = await runImport(treatmentPlansHandler, {
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
