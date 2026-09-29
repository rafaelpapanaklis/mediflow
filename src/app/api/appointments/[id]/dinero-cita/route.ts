// GET /api/appointments/[id]/dinero-cita — lo que necesita el diálogo de
// «Cancelar cita» (H15, opción A — ws1-t4): si la factura viva de la cita
// tiene dinero pagado, cuánto, si quien mira puede decidir qué pasa con él y,
// si «dejar a favor» no se puede ahora, por qué.
//
// Lo ve quien puede cancelar la cita (el mismo permiso que el PATCH de
// estado): el aviso «Esta cita tiene $X pagados» es para todos ellos; elegir,
// solo con permiso de cobro. clinicId de la sesión; visibilidad por paciente.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { dineroDeLaCita } from "@/lib/anticipos/cita-cancelada.server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.delete");
  if (denied) return denied;
  const cita = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { patientId: true },
  });
  if (!cita) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (cita.patientId) {
    const oculto = await assertPatientVisible(cita.patientId, { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id });
    if (oculto) return oculto;
  }
  const d = await dineroDeLaCita(session.clinic.id, params.id).catch(() => null);
  if (!d) return NextResponse.json({ pagado: 0 });
  return NextResponse.json({
    pagado: d.pagado,
    factura: d.numero,
    marca: d.marca,
    puedeDecidir: denyIfMissingPermission(session.user, "billing.charge") === null,
    motivoNoAFavor: d.motivoNoAFavor,
  });
}
