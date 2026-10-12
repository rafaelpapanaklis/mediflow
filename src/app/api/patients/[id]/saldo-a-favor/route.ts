// GET /api/patients/[id]/saldo-a-favor — el saldo a favor del paciente, para que
// «Nueva factura» avise ANTES de crearla que se le va a descontar (auditoría de uso
// C-13, 4-oct-2026: «el saldo a favor se aplica solo a la nueva factura, sin ningún
// aviso en el editor»). Solo lectura.
//
// `clinicId` de la sesión; el paciente se valida por clínica Y visibilidad antes de
// leer nada. Permiso: el de crear facturas (quien abre el editor).

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getPatientCreditBalance } from "@/lib/patient-credit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await getAuthContext();
  if (!ctx?.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.create");
  if (denied) return denied;
  const patientId = String(params?.id ?? "").trim();
  if (!patientId) return NextResponse.json({ error: "Falta el paciente" }, { status: 400 });
  const deniedPatient = await assertPatientVisible(patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (deniedPatient) return deniedPatient;
  const saldo = await getPatientCreditBalance(ctx.clinicId, patientId);
  return NextResponse.json({ saldo: Math.max(0, Math.round((Number(saldo) || 0) * 100) / 100) });
}
