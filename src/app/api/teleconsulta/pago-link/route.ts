import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { rutaDePago } from "@/lib/teleconsulta/pago-token";

export const dynamic = "force-dynamic";

/**
 * GET /api/teleconsulta/pago-link?appointmentId=… — la liga de pago (con su
 * token) de una teleconsulta de MI clínica, para copiarla desde la agenda y
 * mandársela al paciente (M7, auditoría 30-sep-2026). Sin sesión de la misma
 * clínica no hay liga: el id solo ya no basta para abrir /pago.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("appointmentId") ?? "";
  if (!id) return NextResponse.json({ error: "appointmentId requerido" }, { status: 400 });

  const appt = await prisma.appointment.findFirst({
    where: { id, clinicId: ctx.clinicId, mode: "TELECONSULTATION" },
    select: { id: true, patientId: true, paymentStatus: true },
  });
  if (!appt) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });

  if (appt.patientId) {
    const denied = await assertPatientVisible(appt.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (denied) return denied;
  }
  if (appt.paymentStatus === "paid") {
    return NextResponse.json({ error: "Esta cita ya fue pagada" }, { status: 409 });
  }

  return NextResponse.json({ path: rutaDePago(appt.id) });
}
