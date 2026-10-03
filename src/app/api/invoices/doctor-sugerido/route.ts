// GET /api/invoices/doctor-sugerido?patientId=x — el doctor con el que «Nueva factura»
// preselecciona su selector (ws1-t2, F10). Es la MISMA regla con la que POST /api/invoices
// hereda el doctor cuando no se elige ninguno (lib/invoices/doctor-de-factura.ts): citas de
// hoy del paciente y, si no hay, sus planes activos. Así lo que el popup enseña es lo que se
// guardaría.
//
// Solo lectura. `clinicId` de la sesión; el paciente se valida por clínica Y visibilidad
// antes de leer nada (un paciente ajeno o restringido no dice ni qué doctor lo atiende).

import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { DEFAULT_INVOICE_TZ } from "@/lib/invoices/due-date";
import { doctorDeFacturaNueva } from "@/lib/invoices/doctor-de-factura.server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.create");
  if (denied) return denied;
  // Regla de la casa: `clinicId: undefined` no filtra nada. Se corta antes.
  if (!ctx.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patientId = (new URL(req.url).searchParams.get("patientId") ?? "").trim();
  if (!patientId) return NextResponse.json({ error: "Falta el paciente" }, { status: 400 });
  const deniedPatient = await assertPatientVisible(patientId, {
    userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
  });
  if (deniedPatient) return deniedPatient;

  const sugerido = await doctorDeFacturaNueva({
    clinicId: ctx.clinicId,
    patientId,
    timezone: (ctx.clinic?.timezone as string | null | undefined) || DEFAULT_INVOICE_TZ,
  });
  return NextResponse.json(sugerido);
}
