import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { avisoDeCitaGoogle, descartarAvisoDeCitaGoogle } from "@/lib/google/convertir.server";
import { sincronizarCitaEnSegundoPlano } from "@/lib/agenda/google-sync";
import { logAudit } from "@/lib/audit";
import { assertPatientVisible } from "@/lib/patient-visibility";
import type { ClinicSession } from "@/lib/agenda/api-helpers";

/**
 * La cita, si quien pide puede tocarla: de su clínica, con el paciente visible
 * y —si es DOCTOR— suya. Mismas reglas que PATCH /api/appointments/[id].
 */
async function citaAccesible(session: ClinicSession, id: string): Promise<{ id: string; patientId: string } | Response> {
  const cita = await prisma.appointment.findFirst({
    where: { id, clinicId: session.clinic.id },
    select: { id: true, patientId: true, doctorId: true },
  });
  if (!cita) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const vis = await assertPatientVisible(cita.patientId, {
    userId: session.user.id,
    role: session.user.role,
    clinicId: session.clinic.id,
  });
  if (vis) return vis;
  if (session.user.role === "DOCTOR" && cita.doctorId !== session.user.id) {
    return NextResponse.json({ error: "not_your_appointment" }, { status: 403 });
  }
  return { id: cita.id, patientId: cita.patientId };
}

export const dynamic = "force-dynamic";

// GET  → el aviso de una cita convertida desde Google («el evento cambió de
//        hora» / «se eliminó»), o { aviso: null }.
// POST → { accion: "mantener" }: descarta el aviso y vuelve a copiar la cita
//        a Google con SU hora (DaleControl manda). «Mover» y «Cancelar» NO
//        viven aquí: la pantalla usa las rutas normales de la cita. WS1-T9.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.view");
  if (denied) return denied;
  const { id } = await params;
  const cita = await citaAccesible(session, id);
  // Sin acceso, simplemente no hay aviso que enseñar.
  if (cita instanceof Response) return NextResponse.json({ aviso: null }, { headers: { "Cache-Control": "no-store" } });
  const aviso = await avisoDeCitaGoogle(session.clinic.id, cita.id);
  return NextResponse.json({ aviso }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const denied = denyIfMissingPermission(session.user, "agenda.edit");
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { accion?: unknown } | null;
  if (body?.accion !== "mantener") return NextResponse.json({ error: "accion_invalida" }, { status: 400 });

  // De la clínica de la sesión (regla c), paciente visible y, si es DOCTOR, suya.
  const cita = await citaAccesible(session, id);
  if (cita instanceof Response) return cita;

  const habia = await descartarAvisoDeCitaGoogle(session.clinic.id, id);
  if (habia) {
    await logAudit({
      clinicId: session.clinic.id,
      userId: session.user.id,
      entityType: "appointment",
      entityId: id,
      action: "update",
      patientId: cita.patientId,
      texto: "Mantuvo la hora de la cita aunque su evento cambió en Google Calendar",
      changes: { avisoGoogle: { before: "pendiente", after: "mantener la cita" } },
    });
    await sincronizarCitaEnSegundoPlano(session.clinic.id, id);
  }
  return NextResponse.json({ ok: true, descartado: habia });
}
