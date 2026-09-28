import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getMigratedVisits } from "@/lib/import/citas-historial/leer";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * GET /api/patients/[id]/migrated-visits — "Citas anteriores (migradas)",
 * de solo lectura, para la ficha del paciente (ws1-t12). Mismo permiso que
 * ver la agenda ("agenda.view"): es historia de citas, no dinero.
 *
 * Multi-tenant: assertPatientVisible valida clínica + visibilidad del
 * paciente antes de leer nada; getMigratedVisits filtra SIEMPRE por
 * clinicId de la sesión.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const deniedPerm = denyIfMissingPermission(user, "agenda.view");
  if (deniedPerm) return deniedPerm;

  const denied = await assertPatientVisible(params.id, {
    userId: user.id,
    role: user.role,
    clinicId: user.clinicId,
  });
  if (denied) return denied;

  const visits = await getMigratedVisits(user.clinicId, params.id);
  return NextResponse.json({ patientId: params.id, visits });
}
