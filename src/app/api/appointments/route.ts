import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";
import {
  appointmentToDTO,
  fetchActiveDoctors,
  fetchAppointmentsForDay,
  fetchPendingValidation,
  fetchResources,
  fetchWaitlistCount,
} from "@/lib/agenda/server";
import {
  agendaDayFetchRange,
  isValidDateISO,
  legacyTimesToUtc,
  todayInTz,
} from "@/lib/agenda/time-utils";
import { scheduleViolation } from "@/lib/agenda/clinic-hours";
import {
  bloqueaEsteHueco,
  avisoDeBloqueo,
  trazaDeBloqueo,
} from "@/lib/agenda-bloqueos/core";
// El GET solo LEE: se importa del lector y no de `service.ts` (que escribe
// y lleva `server-only`), para que esta ruta siga siendo montable desde
// `tsx --test` con mocks de módulo, como hace reglas-servidor.test.ts.
import { ctxDeSesion } from "@/lib/agenda-bloqueos/core-ctx";
import { listarBloqueos } from "@/lib/agenda-bloqueos/consulta.server";
import { leerBloqueosDelRango } from "@/lib/agenda-bloqueos/consulta.server";
import {
  bookingRuleBody,
  newAppointmentRuleViolation,
} from "@/lib/agenda/booking-rules";
import {
  canOverrideOverlap,
  isAppointmentOverlapError,
} from "@/lib/agenda/transitions";
import {
  ensureUserCanSeePatient,
  assertPatientVisible,
  canSeePatient,
  type VisibilityViewer,
} from "@/lib/patient-visibility";
import { validateResourceSchedule } from "@/lib/agenda/resource-schedule";
import { loadResourceSchedule } from "@/lib/agenda/resource-schedule.server";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { avisarCitaPorWhatsApp, type AvisoCitaResultado } from "@/lib/whatsapp/avisos-cita";
import { revalidateAfter, revalidatePatientProfile } from "@/lib/cache/revalidate";
import { syncCreateToGoogleCalendar } from "@/lib/agenda/google-sync";
import type {
  AgendaDayResponse,
  AppointmentConflictError,
  AppointmentStatus,
  CreateAppointmentInput,
} from "@/lib/agenda/types";

const APPT_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true } },
  doctor:  { select: { id: true, firstName: true, lastName: true } },
} as const;

// ═════════════════════════════════════════════════════════════════
// GET /api/appointments?date=&doctorId=&resourceId=&status=
// Returns AgendaDayResponse (M3 shape — diferente al GET legacy de M2.b).
// ═════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const sp = req.nextUrl.searchParams;
  const dateParam = sp.get("date");
  const dateISO = dateParam && isValidDateISO(dateParam)
    ? dateParam
    : todayInTz(session.clinic.timezone);

  const doctorId = sp.get("doctorId") || undefined;
  const resourceId = sp.get("resourceId") || undefined;
  const statusCsv = sp.get("status");
  const statuses: AppointmentStatus[] | undefined = statusCsv
    ? (statusCsv.split(",").filter(Boolean) as AppointmentStatus[])
    : undefined;

  // scope=clinic: cliente declara que necesita TODAS las citas de la
  // clinica (no solo las del usuario logueado). Usado por el SlotGridPicker
  // del modal Nueva Cita para detectar conflictos de doctor/resource con
  // citas de otros doctores.
  const scope = sp.get("scope");
  if (scope && scope !== "clinic") {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  // SECURITY: scope=clinic permite ver todas las citas (necesario para
  // SlotGridPicker que detecta conflictos cross-doctor). Solo permitido
  // a roles administrativos. DOCTOR sigue scopeado a sus propias citas.
  const canUseClinicScope =
    session.user.role === "ADMIN" ||
    session.user.role === "SUPER_ADMIN" ||
    session.user.role === "RECEPTIONIST";
  const effectiveScope = scope === "clinic" && canUseClinicScope ? "clinic" : null;
  const doctorIdScope =
    effectiveScope === "clinic"
      ? undefined
      : session.user.role === "DOCTOR"
      ? session.user.id
      : undefined;

  // El rango REPORTADO tiene que ser el mismo que se consultó (día natural),
  // si no el cliente cree que le llegó 08–20 y hay citas fuera de esa ventana.
  const range = agendaDayFetchRange(dateISO, session.timeConfig);

  // Visibilidad por paciente: la cita SIEMPRE se ve (el hueco del día es real),
  // pero a quien no puede ver a un paciente restringido le llega enmascarado.
  const viewer = {
    userId: session.user.id,
    role: session.user.role,
    clinicId: session.clinic.id,
  };

  // SEIS consultas en el `Promise.all` — el tope de la casa son 7 antes de que
  // el pooler empiece a dar timeouts.
  const [appointments, doctors, resources, pendingValidation, waitlistCount, bloqueos] =
    await Promise.all([
      fetchAppointmentsForDay(dateISO, session.timeConfig, {
        clinicId: session.clinic.id,
        clinicCategory: session.clinic.category,
        doctorIdScope,
        doctorId,
        resourceId,
        statuses,
        viewer,
      }),
      fetchActiveDoctors(session.clinic.id, session.clinic.category),
      fetchResources(session.clinic.id),
      fetchPendingValidation(
        dateISO,
        session.timeConfig,
        session.clinic.id,
        session.clinic.category,
        viewer,
      ),
      fetchWaitlistCount(session.clinic.id),
      // WS1-T2 — los bloqueos del MISMO rango que las citas, para que ws1-t3
      // pinte la franja sin pedir nada aparte y sin que las dos cosas se
      // desincronicen al navegar entre días. `listarBloqueos` aplica ya el
      // alcance por rol: un DOCTOR recibe los suyos y los de la clínica.
      listarBloqueos(ctxDeSesion(session), {
        desde: range.startUtc.toISOString(),
        hasta: range.endUtc.toISOString(),
      }),
    ]);

  const response: AgendaDayResponse = {
    range: {
      from: range.startUtc.toISOString(),
      to: range.endUtc.toISOString(),
    },
    timezone: session.clinic.timezone,
    slotMinutes: session.clinic.defaultSlotMinutes,
    // Ventana EFECTIVA (∪ ClinicSchedule) — P1-13: el eje pinta las horas
    // que la clínica configuró en Ajustes, no el 8–20 clavado.
    dayStart: session.timeConfig.dayStart,
    dayEnd: session.timeConfig.dayEnd,
    appointments,
    doctors,
    resources,
    pendingValidation,
    waitlistCount,
    bloqueos,
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

// ═════════════════════════════════════════════════════════════════
// POST /api/appointments
// ═════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "DOCTOR",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  // Permiso granular ADEMÁS del rol: el default de cada rol lo incluye, así
  // que solo bloquea a quien el SUPER_ADMIN se lo destildó en /dashboard/team.
  const deniedPerm = denyIfMissingPermission(session.user, "agenda.create");
  if (deniedPerm) return deniedPerm;

  let body: CreateApptBody;
  try {
    body = (await req.json()) as CreateApptBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // La forma canónica del cuerpo es `startsAt`/`endsAt` ISO. /dashboard/appointments
  // manda la hora de pared de la clínica (`date` + `startTime` + `durationMins`)
  // y por eso recibía 400 `missing_startsAt` SIEMPRE (hallazgo 24). Se resuelve
  // aquí, con la tz de la SESIÓN: el navegador no tiene la tz de la clínica y
  // adivinarla con la del dispositivo agendaría a la hora equivocada.
  normalizeLegacyTimes(body, session.clinic.timezone);

  const validation = validateCreate(body);
  if (validation) {
    return NextResponse.json({ error: validation }, { status: 400 });
  }

  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  if (endsAt <= startsAt) {
    return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
  }

  // P1-13: fuera-de-horario/día cerrado ya NO bloquea con un 422 mudo — se
  // guarda la cita y se AVISA (scheduleWarning en la respuesta → toast). El
  // horario que manda es el configurado en Ajustes (ClinicSchedule), con
  // fallback a agendaDayStart/End si la clínica nunca guardó horario.
  const hoursWarning = scheduleViolation(
    startsAt,
    endsAt,
    session.clinic.timezone,
    session.clinic,
    session.clinic.schedules,
  );


  // ═══════════════════════════════════════════════════════════════════════
  // WS1-T2 — AL STAFF SE LE AVISA, NO SE LE PROHÍBE.
  //
  // Mismo criterio que el aviso de fuera-de-horario de arriba, y por la misma
  // razón: quien está en el mostrador con el paciente delante sabe algo que el
  // sistema no. Un 422 aquí obligaría a RETIRAR el bloqueo entero —abriéndoselo
  // de paso al bot, a la web, al portal y a Sabina— para meter una sola cita.
  //
  // Viaja por `scheduleWarning` y no por un campo nuevo: las pantallas del
  // staff ya leen ese campo y sacan el toast, y esas pantallas son de ws1-t3.
  // Si hay bloqueo Y fuera-de-horario, manda el bloqueo: lleva escrito el
  // motivo, y el otro solo dice una hora.
  const bloqueosDelHueco = await leerBloqueosDelRango(
    session.clinic.id,
    startsAt,
    endsAt,
    { doctorIds: [body.doctorId] },
  );
  const bloqueoEncima = bloqueaEsteHueco(bloqueosDelHueco, startsAt, endsAt, body.doctorId);
  const avisoHorario = bloqueoEncima ? avisoDeBloqueo(bloqueoEncima) : hoursWarning;

  // 🔴 ESTE GATE, Y ESTA COLUMNA, SE QUEDAN EXACTAMENTE COMO ESTABAN.
  //
  // `overrideReason` no es un campo de notas: es la bandera que saca la cita
  // del índice de exclusión `appt_doctor_no_overlap` y apaga el «dos citas no
  // se pisan». Por eso pide `canOverrideOverlap` (ADMIN y SUPER_ADMIN).
  //
  // WS1-T3 NO escribe aquí. Agendar sobre un BLOQUEO entra por
  // `bloqueoConfirmado`, no lleva gate de rol —quien puede crear citas hoy las
  // sigue creando— y no toca ninguna regla de solape; su rastro va a
  // `AuditLog`. El porqué completo, en `agenda-bloqueos/core.ts` §7.
  if (body.overrideReason && !canOverrideOverlap(session.user.role)) {
    return NextResponse.json(
      { error: "override_not_allowed_for_role" },
      { status: 403 },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EL RASTRO DE HABER AGENDADO ENCIMA DE UN BLOQUEO (WS1-T3)
  //
  // 🔴 EL TEXTO LO ESCRIBE EL SERVIDOR, NO EL NAVEGADOR. La pantalla manda
  // `bloqueoConfirmado: true` y nada más; lo que se registra sale de
  // `bloqueoEncima`, que es el bloqueo que el servidor acaba de leer de la
  // base. Si se copiara un texto del cuerpo, una fila de auditoría guardaría
  // lo que quisiera escribir quien llama a la API.
  //
  // Y si NO hay bloqueo encima, no se registra nada aunque el cuerpo lo pida:
  // entre que la pantalla preguntó y llegó el POST, alguien pudo retirarlo.
  // Un rastro de un bloqueo que ya no existe es peor que ninguno.
  // 🔴 EL RASTRO NO DEPENDE DE QUE LA PANTALLA HAYA AVISADO.
  //
  // Se registra siempre que la cita caiga encima de un bloqueo, y aparte se
  // anota SI la persona llegó a ver el aviso. Existe un caso real en que no lo
  // ve: un doctor agendando para OTRA doctora que tiene un bloqueo personal.
  // El navegador no recibe ese bloqueo —`listarBloqueos` acota por rol para no
  // enseñarle a nadie el motivo de la ausencia de un compañero («operación de
  // rodilla»)—, así que el diálogo no sale; pero el servidor sí lo ve aquí.
  //
  // Si el rastro colgara de `bloqueoConfirmado`, ese caso —justo el que nadie
  // vigila— sería el único que no dejaría huella. Quien audite el hueco vacío
  // meses después necesita saber que la cita se metió ahí, y también si se
  // avisó o no: lo segundo es lo que dice si hay que arreglar la pantalla o
  // hablar con una persona.
  const trazaBloqueo = bloqueoEncima ? trazaDeBloqueo(bloqueoEncima) : null;
  const avisadaDelBloqueo = body.bloqueoConfirmado === true;

  const [patient, doctor, resource] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: body.patientId, clinicId: session.clinic.id },
      select: { id: true, status: true },
    }),
    prisma.user.findFirst({
      where: {
        id: body.doctorId,
        clinicId: session.clinic.id,
        role: "DOCTOR",
        isActive: true,
      },
      select: { id: true },
    }),
    body.resourceId
      ? prisma.resource.findFirst({
          where: {
            id: body.resourceId,
            clinicId: session.clinic.id,
            isActive: true,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (!patient) {
    return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  }
  // Visibilidad: el ACTOR debe poder ver al paciente ANTES de crear la cita. Sin
  // este assert, un DOCTOR excluido agenda {patientId: restringido, doctorId: él}
  // y el ensureUserCanSeePatient de abajo lo mete a visibleUserIds = acceso
  // permanente (escalada de privilegios). 404 idéntico a patient_not_found — no
  // revelar existencia.
  const visDenied = await assertPatientVisible(body.patientId, {
    userId: session.user.id,
    role: session.user.role,
    clinicId: session.clinic.id,
  });
  if (visDenied) return visDenied;
  if (!doctor) {
    return NextResponse.json({ error: "doctor_not_found" }, { status: 404 });
  }

  // Motivo, pasado y paciente archivado (WS1-T3, N13): antes solo los frenaba el
  // formulario. Va DESPUÉS del assert de visibilidad para no revelar si un
  // paciente que no puedes ver está archivado.
  const ruleViolation = newAppointmentRuleViolation({
    startsAt,
    reason: body.reason,
    patientStatus: patient.status,
    slotMinutes: session.clinic.defaultSlotMinutes,
    now: new Date(),
  });
  if (ruleViolation) {
    return NextResponse.json(bookingRuleBody(ruleViolation), {
      status: ruleViolation.httpStatus,
    });
  }
  if (body.resourceId && !resource) {
    return NextResponse.json({ error: "resource_not_found" }, { status: 404 });
  }

  // Resource working-hours validation. A Resource without any schedule rows
  // is treated as "always open" (backward-compat for resources created before
  // this feature). overrideReason bypasses the check (admin escape hatch).
  if (body.resourceId && !body.overrideReason) {
    const schedule = await loadResourceSchedule(body.resourceId);
    const valid = validateResourceSchedule(
      startsAt,
      endsAt,
      schedule,
      session.clinic.timezone,
    );
    if (!valid.ok) {
      return NextResponse.json(
        {
          error: "resource_unavailable",
          reason: valid.reason,
        },
        { status: 422 },
      );
    }
  }

  try {
    // Auto-inclusión de visibilidad en la MISMA transacción que la cita: si el
    // paciente está restringido y el doctor no está en la lista, se agrega. Sin
    // esto quedaría "el doctor atiende a un paciente que no puede ver".
    const created = await prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          clinicId: session.clinic.id,
          patientId: body.patientId,
          doctorId: body.doctorId,
          resourceId: body.resourceId ?? null,
          startsAt,
          endsAt,
          status: "SCHEDULED",
          type: body.reason ?? "Consulta general",
          // El formulario de /dashboard/appointments recoge notas y hasta ahora
          // se perdían: la ruta no las miraba (hallazgo 24).
          notes: body.notes ?? null,
          mode: body.isTeleconsult ? "TELECONSULTATION" : "IN_PERSON",
          source: "STAFF",
          requiresValidation: false,
          // ⛔ SIN TOCAR (WS1-T3). Esta columna apaga el no-solape; el rastro
          // del bloqueo va a `AuditLog`, más abajo.
          overrideReason: body.overrideReason ?? null,
          overriddenBy: body.overrideReason ? session.user.id : null,
          overriddenAt: body.overrideReason ? new Date() : null,
        },
        include: APPT_INCLUDE,
      });
      await ensureUserCanSeePatient(tx, body.patientId, body.doctorId, session.clinic.id);
      return appt;
    });

    // Confirmación al agendar (H-1). Aquí hubo cinco meses un TODO sin implementar que
    // tiraba `notifyPatient`: el diálogo enseñaba «Enviar WhatsApp», la
    // recepcionista lo encendía y no salía nada. Solo si quien agenda lo pidió
    // (`=== true`: Sabina y el formulario viejo no lo mandan), y la clínica
    // decide si el aviso existe (Dashboard → WhatsApp). No lanza: una cita ya
    // creada no se pierde por un WhatsApp. El resultado VIAJA en la respuesta
    // para que el diálogo diga la verdad, salga o no.
    const whatsapp: AvisoCitaResultado | null =
      body.notifyPatient === true
        ? await avisarCitaPorWhatsApp({
            evento: "agendada",
            appointmentId: created.id,
            clinicId: session.clinic.id,
            sentById: session.user.id,
          })
        : null;

    await logMutation({
      req,
      clinicId: session.clinic.id,
      userId: session.user.id,
      entityType: "appointment",
      entityId: created.id,
      action: "create",
      after: {
        patientId: created.patientId,
        doctorId: created.doctorId,
        startsAt: created.startsAt,
        type: created.type,
        status: created.status,
        // WS1-T3 — EL RASTRO. Va en la MISMA fila de auditoría que la
        // creación y no en una aparte: quien revise por qué hay una cita un
        // día que la clínica cerró lo lee de un vistazo, sin cruzar dos
        // tablas. Ausente en el 99 % de las citas, que no tocan ningún
        // bloqueo. `bloqueoAvisado: false` = se agendó encima sin que la
        // pantalla pudiera avisar; ver arriba.
        ...(trazaBloqueo
          ? { bloqueoSaltado: trazaBloqueo, bloqueoAvisado: avisadaDelBloqueo }
          : {}),
      },
    });

    // Google Calendar sync (best-effort, no falla la creacion si Google falla)
    try {
      const fullAppt = await prisma.appointment.findUnique({
        where: { id: created.id },
        select: {
          id: true, type: true, startsAt: true, endsAt: true, notes: true,
          patient: { select: { firstName: true, lastName: true, email: true } },
          doctor:  { select: { firstName: true, lastName: true, email: true } },
        },
      });
      if (fullAppt) {
        await syncCreateToGoogleCalendar(session.clinic.id, {
          id: fullAppt.id, type: fullAppt.type,
          startsAt: fullAppt.startsAt, endsAt: fullAppt.endsAt,
          notes: fullAppt.notes,
          patientName: `${fullAppt.patient.firstName} ${fullAppt.patient.lastName}`,
          doctorName: `${fullAppt.doctor.firstName} ${fullAppt.doctor.lastName}`,
          doctorEmail: fullAppt.doctor.email ?? null,
          patientEmail: fullAppt.patient.email ?? null,
        });
      }
    } catch (err) {
      console.error("GCal sync wrapper error:", err);
    }

    revalidateAfter("appointments");
    revalidatePatientProfile(created.patientId);
    return NextResponse.json(
      {
        appointment: appointmentToDTO(created, session.clinic.category),
        // P1-13: aviso de fuera-de-horario/día cerrado (null si todo bien).
        // WS1-T2: si además hay un bloqueo encima, manda el del bloqueo.
        scheduleWarning: avisoHorario,
        // null = nadie pidió avisar. Si se pidió: { enviado } o { enviado:false, motivo }.
        whatsapp,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isAppointmentOverlapError(err)) {
      const conflict = await findConflictingAppointment(
        session.clinic.id,
        body.doctorId,
        body.resourceId ?? null,
        startsAt,
        endsAt,
        { userId: session.user.id, role: session.user.role, clinicId: session.clinic.id },
      );
      const payload: AppointmentConflictError = {
        error: "appointment_overlap",
        conflictingAppointment: conflict ?? {
          id: "unknown",
          patientName: "—",
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          doctorId: body.doctorId,
          resourceId: body.resourceId ?? null,
          status: "SCHEDULED",
        },
      };
      return NextResponse.json(payload, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json({ error: "validation" }, { status: 400 });
    }
    console.error("[POST /api/appointments] unexpected error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * Cuerpo aceptado por POST: la forma canónica (`CreateAppointmentInput`) más
 * `notes` y el trío de hora local que manda /dashboard/appointments. Es un tipo
 * LOCAL a propósito: `CreateAppointmentInput` vive en @/lib/agenda/types y no se
 * toca desde esta tarea.
 */
type CreateApptBody = CreateAppointmentInput & {
  notes?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMins?: number | null;
};

/**
 * Si el cuerpo no trae `startsAt`/`endsAt` pero sí la hora de pared de la
 * clínica, la resuelve a instantes y la escribe en el propio cuerpo, para que
 * de aquí en adelante TODO el handler vea una sola forma. Si el trío está
 * incompleto no inventa nada: `validateCreate` devuelve el 400 de siempre.
 */
function normalizeLegacyTimes(body: CreateApptBody, timezone: string): void {
  if (body.startsAt && body.endsAt) return;
  const resolved = legacyTimesToUtc(
    {
      date: body.date,
      startTime: body.startTime,
      endTime: body.endTime,
      durationMins: body.durationMins,
    },
    timezone,
  );
  if (!resolved) return;
  body.startsAt = resolved.startsAt.toISOString();
  body.endsAt = resolved.endsAt.toISOString();
}

function validateCreate(body: Partial<CreateAppointmentInput>): string | null {
  if (!body.patientId || typeof body.patientId !== "string") return "missing_patientId";
  if (!body.doctorId || typeof body.doctorId !== "string") return "missing_doctorId";
  if (!body.startsAt || typeof body.startsAt !== "string") return "missing_startsAt";
  if (!body.endsAt || typeof body.endsAt !== "string") return "missing_endsAt";
  if (Number.isNaN(new Date(body.startsAt).getTime())) return "invalid_startsAt";
  if (Number.isNaN(new Date(body.endsAt).getTime())) return "invalid_endsAt";
  return null;
}

async function findConflictingAppointment(
  clinicId: string,
  doctorId: string,
  resourceId: string | null,
  startsAt: Date,
  endsAt: Date,
  viewer?: VisibilityViewer | null,
) {
  const candidates = await prisma.appointment.findMany({
    where: {
      clinicId,
      OR: [{ doctorId }, ...(resourceId ? [{ resourceId }] : [])],
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      overrideReason: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    include: { patient: { select: { firstName: true, lastName: true, visibleUserIds: true } } },
    take: 1,
  });

  if (candidates.length === 0) return null;
  const a = candidates[0];
  // El paciente en conflicto puede ser uno RESTRINGIDO distinto al que se agenda
  // (mismo doctor/recurso, otro paciente). Si el viewer no puede verlo, no
  // revelamos su nombre en el 409 de solape.
  const visible = !viewer || canSeePatient(viewer, (a.patient as { visibleUserIds?: string[] }).visibleUserIds);
  const name = visible
    ? [a.patient.firstName, a.patient.lastName].filter(Boolean).join(" ").trim()
    : "Paciente privado";
  return {
    id: a.id,
    patientName: name || "—",
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    doctorId: a.doctorId,
    resourceId: a.resourceId,
    status: a.status as AppointmentStatus,
  };
}
