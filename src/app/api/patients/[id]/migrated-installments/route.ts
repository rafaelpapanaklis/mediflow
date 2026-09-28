import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getMigratedInstallments } from "@/lib/import/cuotas-plan/leer";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * GET /api/patients/[id]/migrated-installments — "Plan de pagos a plazos
 * (migrado)", de solo lectura, para la ficha del paciente (ws1-t6). Mismo
 * permiso que la pestaña Facturación ("billing.view", ver page.tsx
 * `canViewBilling`).
 *
 * Multi-tenant: assertPatientVisible valida clínica + visibilidad del
 * paciente antes de leer nada; getMigratedInstallments filtra SIEMPRE por
 * clinicId de la sesión.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const deniedPerm = denyIfMissingPermission(user, "billing.view");
  if (deniedPerm) return deniedPerm;

  const denied = await assertPatientVisible(params.id, {
    userId: user.id,
    role: user.role,
    clinicId: user.clinicId,
  });
  if (denied) return denied;

  const installments = await getMigratedInstallments(user.clinicId, params.id);
  return NextResponse.json({ patientId: params.id, installments });
}
