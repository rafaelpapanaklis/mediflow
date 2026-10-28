// GET /api/appointments/[id]/detalles-al-pasar — lo PESADO de la tarjeta que sale al pasar el mouse sobre una
// cita de la Agenda nueva (decisión de Rafael, 28-oct-2026): edad, primera vez o recurrente, teléfono,
// alergias, confirmada por WhatsApp, «En esta cita: resina $700» y «Debe hoy». Lo ligero (hora, doctor,
// sillón, estado, avisos) ya lo tiene la pantalla y no pasa por aquí.
//
// Lo ve TODO el que ve la cita (decisión: los importes también): `agenda.view`, no `billing.view`. Clínica de
// la sesión y visibilidad del paciente (un paciente restringido no se le enseña a quien no lo puede ver).
// Y la regla de la agenda: un DOCTOR solo ve SUS citas (`doctorIdScope` de page.tsx y /api/agenda/range); la
// de otro doctor le contesta 404, como si no existiera (v2, revisión t11 M1). Solo lectura.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { esIdDeLaBase, MENSAJE_ID_INVALIDO } from "@/lib/validation/id";
import { detallesDeCitaAlPasar } from "@/lib/agenda-nueva/detalles-al-pasar.server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;
  const id = String(params?.id ?? "").trim();
  if (!id || !esIdDeLaBase(id)) return NextResponse.json({ error: MENSAJE_ID_INVALIDO }, { status: 400 });

  const clinicId = session.clinic.id;
  const cita = await prisma.appointment.findFirst({
    where: { id, clinicId },
    select: { id: true, patientId: true, doctorId: true },
  });
  if (!cita) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  if (session.user.role === "DOCTOR" && cita.doctorId !== session.user.id) {
    return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  }
  if (cita.patientId) {
    const oculto = await assertPatientVisible(cita.patientId, { userId: session.user.id, role: session.user.role, clinicId });
    if (oculto) return oculto;
  }
  const detalles = await detallesDeCitaAlPasar(clinicId, cita.id, { timezone: session.clinic.timezone });
  if (!detalles) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  return NextResponse.json(detalles, { headers: { "Cache-Control": "private, no-store" } });
}
