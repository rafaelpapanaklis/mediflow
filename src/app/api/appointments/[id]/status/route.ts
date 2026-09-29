import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { appointmentToDTO } from "@/lib/agenda/server";
import {
  canTransition,
  sideEffectsOf,
  timelineFieldFor,
} from "@/lib/agenda/transitions";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { cancelPendingRemindersForAppointment } from "@/lib/reminders/reschedule.server";
import type { StatusChangeInput } from "@/lib/agenda/types";
import { avisarCitaPorWhatsApp } from "@/lib/whatsapp/avisos-cita";
import { decidirDineroDeCitaCancelada, dineroDeLaCita } from "@/lib/anticipos/cita-cancelada.server";
import { decisionEfectiva } from "@/lib/anticipos/cita-cancelada-core";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { textoCita } from "@/lib/movimientos-paciente/textos";
import { zonaDeClinica } from "@/lib/movimientos-paciente/zona";

const APPT_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  doctor:  { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  let body: StatusChangeInput;
  try {
    body = (await req.json()) as StatusChangeInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.status) {
    return NextResponse.json({ error: "missing_status" }, { status: 400 });
  }

  const existing = await prisma.appointment.findFirst({
    where: { id: params.id, clinicId: session.clinic.id },
    select: { id: true, status: true, startsAt: true, doctorId: true, patientId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Visibilidad por paciente: la respuesta devuelve el paciente (nombre) vía
  // appointmentToDTO. Un paciente restringido no debe ser transicionable ni
  // revelado a quien no puede verlo (404 = ocultar existencia, igual que agenda).
  if (existing.patientId) {
    const denied = await assertPatientVisible(existing.patientId, { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id });
    if (denied) return denied;
  }

  if (
    session.user.role === "DOCTOR" &&
    existing.doctorId !== session.user.id
  ) {
    return NextResponse.json({ error: "not_your_appointment" }, { status: 403 });
  }

  // Permiso granular ADEMÁS de la matriz de canTransition (P1-3): cancelar
  // pide "agenda.delete" (mismo permiso que el DELETE soft-cancel, para que
  // /status no lo puentee); cualquier otra transición pide "agenda.edit".
  // Va DESPUÉS del assert de visibilidad para conservar el 404 sobre el 403.
  const deniedPerm = denyIfMissingPermission(
    session.user,
    body.status === "CANCELLED" ? "agenda.delete" : "agenda.edit",
  );
  if (deniedPerm) return deniedPerm;

  const now = new Date();
  if (existing.status === "PENDING") {
    return NextResponse.json(
      { error: "legacy_status", reason: "Status PENDING ya no soportado. Migrá a SCHEDULED." },
      { status: 409 },
    );
  }
  // Máquina de estados REAL (P1-1): matriz + rol + predicate. Antes canTransition
  // era un no-op y cualquier sesión de la clínica (READONLY incluido) cancelaba
  // o completaba citas por aquí, puenteando el requireRole del DELETE.
  const check = canTransition(
    existing.status as Exclude<typeof existing.status, "PENDING">,
    body.status,
    session.user.role,
    now,
    existing.startsAt,
  );
  if (!check.ok) {
    // Rol sin permiso = 403 (problema de QUIÉN); estado inválido = 409 (de QUÉ).
    if (check.code === "forbidden_role") {
      return NextResponse.json(
        { error: "forbidden", reason: check.error },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "invalid_transition", reason: check.error },
      { status: 409 },
    );
  }

  const sideEffects = sideEffectsOf(body.status, now);

  // Estados que CIERRAN la cita: sus recordatorios pendientes ya no tienen a
  // quién avisar. El worker se negaba a enviarlos (re-check al salir), pero la
  // fila seguía en "En cola" en el panel hasta que le tocaba turno. Va en la
  // misma transacción que el cambio de estado.
  const closesAppointment = body.status === "CANCELLED" || body.status === "NO_SHOW";

  // Motivo de la cancelación. `StatusChangeInput.reason` ya existía en el tipo
  // pero nadie lo escribía: el schema tiene `cancelReason`/`cancelledAt` y el
  // panel de la agenda YA los muestra, así que el bloque salía siempre vacío en
  // toda cancelación hecha por el staff (hallazgo 42). El portal del paciente,
  // WhatsApp y el enlace público sí los guardaban; esto los iguala.
  const cancelFields =
    body.status === "CANCELLED"
      ? {
          cancelledAt: now,
          cancelReason:
            typeof body.reason === "string" && body.reason.trim()
              ? body.reason.trim().slice(0, 300)
              : null,
        }
      : {};

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.update({
      where: { id: params.id },
      data: {
        status: body.status,
        ...sideEffects,
        ...cancelFields,
      },
      include: APPT_INCLUDE,
    });
    if (closesAppointment) {
      await cancelPendingRemindersForAppointment(tx, {
        appointmentId: params.id,
        clinicId: session.clinic.id,
        reason:
          body.status === "NO_SHOW"
            ? "Cancelado: la cita se marcó como no asistida"
            : "Cancelado: la cita se canceló",
      });
    }
    return row;
  });

  // ws1-t12 — cada cambio de estado de la cita (confirmó, llegó, canceló, no
  // asistió…) queda en los movimientos del paciente. Antes esta ruta no
  // dejaba ninguna fila en la bitácora.
  {
    const zona = await zonaDeClinica(session.clinic.id);
    await registrarMovimientoDelPaciente({
      clinicId: session.clinic.id,
      userId: session.user.id,
      patientId: existing.patientId,
      entityType: "appointment",
      entityId: params.id,
      action: "update",
      texto:
        body.status === "CANCELLED"
          ? textoCita.cancelada(existing.startsAt, zona)
          : textoCita.estado(existing.startsAt, existing.status, body.status, zona),
      campos: ["status"],
      cambios: { status: { before: existing.status, after: body.status } },
      req,
    });
  }

  // Instrumentación de tiempos para analytics. Cada transición de status
  // upsert el campo correspondiente del AppointmentTimeline. Si la cita
  // recién entra al ciclo (no había timeline aún), creamos el row con
  // appointmentId + el primer campo. En transiciones siguientes, update.
  // Calculamos totalWaitMin/totalConsultMin cuando ambos extremos existen.
  const timelineField = timelineFieldFor(body.status);
  if (timelineField) {
    const existing = await prisma.appointmentTimeline.findUnique({
      where: { appointmentId: params.id },
    });
    const next = { ...(existing ?? {}), [timelineField]: now };
    const totalWaitMin =
      next.arrivedAt && next.inChairAt
        ? Math.max(0, Math.round((next.inChairAt.getTime() - next.arrivedAt.getTime()) / 60_000))
        : next.arrivedAt && next.consultStartAt
          ? Math.max(0, Math.round((next.consultStartAt.getTime() - next.arrivedAt.getTime()) / 60_000))
          : null;
    const totalConsultMin =
      next.consultStartAt && next.consultEndAt
        ? Math.max(0, Math.round((next.consultEndAt.getTime() - next.consultStartAt.getTime()) / 60_000))
        : null;
    await prisma.appointmentTimeline.upsert({
      where: { appointmentId: params.id },
      create: {
        appointmentId: params.id,
        [timelineField]: now,
        totalWaitMin,
        totalConsultMin,
      },
      update: {
        [timelineField]: now,
        ...(totalWaitMin !== null ? { totalWaitMin } : {}),
        ...(totalConsultMin !== null ? { totalConsultMin } : {}),
      },
    });
  }

  // H15 (decisión de Rafael, opción A — ws1-t4): la cita ya está cancelada;
  // si su factura tiene dinero pagado, se decide qué pasa con él en su propio
  // paso (con el candado de la factura). Solo quien tiene permiso de cobro
  // elige «a favor» o «reembolso»; si no, o si «a favor» no se puede ahora
  // (factura timbrada, efectivo del turno abierto), queda «pendiente de
  // decidir». No lanza: la cancelación ya está hecha.
  let dineroCita: { decision: string | null; monto: number; motivo: string | null } | null = null;
  if (body.status === "CANCELLED") {
    try {
      const d = await dineroDeLaCita(session.clinic.id, params.id);
      if (d) {
        const puedeCobrar = denyIfMissingPermission(session.user, "billing.charge") === null;
        const pedida = decisionEfectiva(body.dineroCita, puedeCobrar);
        const base = { clinicId: session.clinic.id, invoiceId: d.facturaId, userId: session.user.id, quien: session.user.displayName };
        let r = await decidirDineroDeCitaCancelada({ ...base, decision: pedida });
        let motivo = r.motivo;
        if (!r.ok && pedida !== "pendiente") {
          r = await decidirDineroDeCitaCancelada({ ...base, decision: "pendiente" });
        } else if (r.ok) {
          motivo = null;
        }
        dineroCita = { decision: r.aplicada, monto: d.pagado, motivo };
      }
    } catch (e) {
      console.error("[appointments/status] dinero de la cita cancelada:", e);
    }
  }

  // Aviso de cancelación al paciente: solo si la clínica lo encendió en
  // Dashboard → WhatsApp (nace apagado). NO_SHOW no avisa: el paciente ya sabe
  // que no fue. No lanza: el cambio de estado ya está hecho.
  const whatsapp =
    body.status === "CANCELLED"
      ? await avisarCitaPorWhatsApp({
          evento: "cancelada",
          appointmentId: params.id,
          clinicId: session.clinic.id,
          sentById: session.user.id,
        })
      : null;

  revalidateAfter("appointments");
  revalidatePatientProfile(updated.patientId);
  return NextResponse.json(
    { appointment: appointmentToDTO(updated, session.clinic.category), whatsapp, dineroCita },
  );
}
