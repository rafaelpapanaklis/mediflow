import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getMigratedLabExpenses } from "@/lib/import/laboratorio-historial/leer";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * GET /api/patients/[id]/migrated-lab-expenses — "Gastos de laboratorio
 * (migrados)", de solo lectura, para la ficha del paciente (ws1-t2). Mismo
 * permiso que la pestaña Facturación ("billing.view", ver page.tsx
 * `canViewBilling`).
 *
 * Multi-tenant: assertPatientVisible valida clínica + visibilidad del
 * paciente antes de leer nada; getMigratedLabExpenses filtra SIEMPRE por
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

  const expenses = await getMigratedLabExpenses(user.clinicId, params.id);
  return NextResponse.json({ patientId: params.id, expenses });
}
