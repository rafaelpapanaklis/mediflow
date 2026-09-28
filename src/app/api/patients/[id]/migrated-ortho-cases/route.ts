import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getMigratedOrthoCases } from "@/lib/import/ortho-casos/leer";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * GET /api/patients/[id]/migrated-ortho-cases — "Casos de ortodoncia
 * (migrados)", de solo lectura, para la ficha del paciente (ws1-t1). Mismo
 * permiso con el que se ve el módulo de Ortodoncia ("medicalRecord.view",
 * ver src/app/actions/orthodontics/_helpers.ts).
 *
 * Multi-tenant: assertPatientVisible valida clínica + visibilidad del
 * paciente antes de leer nada; getMigratedOrthoCases filtra SIEMPRE por
 * clinicId de la sesión.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const deniedPerm = denyIfMissingPermission(user, "medicalRecord.view");
  if (deniedPerm) return deniedPerm;

  const denied = await assertPatientVisible(params.id, {
    userId: user.id,
    role: user.role,
    clinicId: user.clinicId,
  });
  if (denied) return denied;

  const cases = await getMigratedOrthoCases(user.clinicId, params.id);
  return NextResponse.json({ patientId: params.id, cases });
}
