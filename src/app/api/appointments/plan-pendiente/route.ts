import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, requireRole } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { CITA_CERRADA, CITA_LIBERA, estadoDeAgenda, minutosDeLaCita } from "@/lib/treatments/citas-del-plan";
import { citasDelPlanDisponible, filasAgendadasEnCita, filasDelPlanParaAgendar } from "@/lib/treatments/citas-del-plan-db";

export const dynamic = "force-dynamic";

// ═════════════════════════════════════════════════════════════════
// GET /api/appointments/plan-pendiente?planId=
// ws1-t1 (plan fase 2 · P8) — lo que pinta «Agendar lo pendiente»: las filas vivas del plan, cuáles
// están por agendar y cuáles ya tienen cita, los minutos del tarifario y los datos con los que se
// abre la Nueva cita (paciente y doctor del plan). SOLO LEE.
//
// Sin el SQL (sql/plan-tratamiento-citas.sql) contesta `disponible: false` y el botón no aparece.
//
// Con `?appointmentId=` (en vez de `planId`): lo pendiente que estaba agendado en ESA cita, para
// «Reagendar» una cita cancelada o no asistida del plan sin perder la liga (`reagendar`).
// ═════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  const forbidden = requireRole(session, ["RECEPTIONIST", "DOCTOR", "ADMIN", "SUPER_ADMIN"]);
  if (forbidden) return forbidden;
  const sinPermiso = denyIfMissingPermission(session.user, "treatments.view");
  if (sinPermiso) return sinPermiso;

  const appointmentId = req.nextUrl.searchParams.get("appointmentId")?.trim() ?? "";
  if (appointmentId) return reagendar(session, appointmentId);

  const planId = req.nextUrl.searchParams.get("planId")?.trim() ?? "";
  if (!planId || planId.length > 100) return NextResponse.json({ error: "missing_planId" }, { status: 400 });

  if (!(await citasDelPlanDisponible())) return NextResponse.json({ disponible: false });

  const clinicId = session.clinic.id;
  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: planId, clinicId },
    select: {
      id: true,
      name: true,
      status: true,
      patientId: true,
      doctorId: true,
      patient: { select: { firstName: true, lastName: true } },
    },
  });
  if (!plan) return NextResponse.json({ error: "plan_not_found" }, { status: 404 });
  const oculto = await assertPatientVisible(plan.patientId, { userId: session.user.id, role: session.user.role, clinicId });
  if (oculto) return oculto;
  // El doctor solo ve y toca sus planes (como /api/treatments).
  if (session.user.role === "DOCTOR" && plan.doctorId !== session.user.id) {
    return NextResponse.json({ error: "plan_de_otro_doctor" }, { status: 403 });
  }

  const ahora = new Date();
  const filas = await filasDelPlanParaAgendar(clinicId, plan.id);
  const usuario = { role: session.user.role, permissionsOverride: session.user.permissionsOverride ?? [] };
  const porAgendar = filas.filter((f) => estadoDeAgenda(f, f.cita, ahora) === "por_agendar");

  return NextResponse.json({
    disponible: true,
    // Agendar = crear la cita (agenda.create) y tocar el plan (treatments.edit), lo mismo que pide el POST.
    puedeAgendar: hasPermission(usuario, "agenda.create") && hasPermission(usuario, "treatments.edit"),
    minutosDelHueco: session.clinic.defaultSlotMinutes,
    minutosSugeridos: porAgendar.length > 0 ? minutosDeLaCita(porAgendar, session.clinic.defaultSlotMinutes) : 0,
    plan: {
      id: plan.id,
      nombre: plan.name,
      status: plan.status,
      doctorId: plan.doctorId,
      paciente: {
        id: plan.patientId,
        nombre: [plan.patient?.firstName, plan.patient?.lastName].filter(Boolean).join(" ").trim(),
      },
    },
    filas: filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      dientes: f.dientes,
      caras: f.caras,
      estado: f.estado,
      cantidad: f.cantidad,
      minutos: f.minutos,
      agenda: estadoDeAgenda(f, f.cita, ahora),
      cita: f.cita ? { id: f.cita.id, startsAt: f.cita.startsAt.toISOString(), status: f.cita.status } : null,
    })),
  });
}

type Sesion = Exclude<Awaited<ReturnType<typeof loadClinicSession>>, NextResponse>;

/**
 * «Reagendar» una cita del plan que se canceló o no se asistió: sus filas siguen pendientes y ya
 * quedaron libres (la cita no las aparta). Devuelve las que la NUEVA cita puede volver a llevarse:
 * pendientes o en curso, de un plan activo, y —si quien pide es doctor— de SUS planes. Solo de una
 * cita terminal: de una viva no se reagenda (se edita).
 */
async function reagendar(session: Sesion, appointmentId: string) {
  if (appointmentId.length > 100) return NextResponse.json({ error: "missing_appointmentId" }, { status: 400 });
  if (!(await citasDelPlanDisponible())) return NextResponse.json({ disponible: false });
  const clinicId = session.clinic.id;
  const cita = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    select: { id: true, patientId: true, status: true },
  });
  if (!cita) return NextResponse.json({ error: "appointment_not_found" }, { status: 404 });
  const oculto = await assertPatientVisible(cita.patientId, { userId: session.user.id, role: session.user.role, clinicId });
  if (oculto) return oculto;
  const usuario = { role: session.user.role, permissionsOverride: session.user.permissionsOverride ?? [] };
  const puedeAgendar = hasPermission(usuario, "agenda.create") && hasPermission(usuario, "treatments.edit");
  const terminal = CITA_LIBERA.indexOf(String(cita.status)) !== -1 || CITA_CERRADA.indexOf(String(cita.status)) !== -1;
  if (!terminal) return NextResponse.json({ disponible: true, puedeAgendar, filas: [] });

  const filas = (await filasAgendadasEnCita(clinicId, cita.id)).filter((f) => f.estado === "pendiente" || f.estado === "en_curso");
  const planIds = Array.from(new Set(filas.map((f) => f.planId)));
  const planes = planIds.length
    ? await prisma.treatmentPlan.findMany({ where: { id: { in: planIds }, clinicId }, select: { id: true, status: true, doctorId: true, patientId: true } })
    : [];
  const validos = new Set(
    planes
      .filter((p) => String(p.status) === "ACTIVE" && p.patientId === cita.patientId)
      .filter((p) => session.user.role !== "DOCTOR" || p.doctorId === session.user.id)
      .map((p) => p.id),
  );
  const libres = filas.filter((f) => validos.has(f.planId));
  return NextResponse.json({
    disponible: true,
    puedeAgendar,
    minutosSugeridos: libres.length ? minutosDeLaCita(libres, session.clinic.defaultSlotMinutes) : 0,
    planId: libres[0]?.planId ?? null,
    filas: libres.map((f) => ({ id: f.id, nombre: f.nombre, dientes: f.dientes })),
  });
}
