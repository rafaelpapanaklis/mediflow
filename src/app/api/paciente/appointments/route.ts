// GET /api/paciente/appointments — Implementa A6. Respuesta: PacienteCitasResponse.
// · getPatientPortalContext() | 401. patientIds de ctx.links.
// · clinics: igual que summary (links → patient → clinic).
// · upcoming: startsAt >= now, status notIn [CANCELLED, NO_SHOW], asc.
// · past: startsAt < now O status in [CANCELLED, NO_SHOW], desc, take 100.
// · Select paciente-safe SOLO: id, clinicId, type, status, startsAt, endsAt,
//   doctor { firstName, lastName } → doctorName ("Dr/a. Nombre Apellido" NO —
//   solo "Nombre Apellido", el prefijo lo pone la UI si quiere).
// · NUNCA: notes, price, tokens de telemedicina, overrideReason, etc.
// · ws1-t5 (93): si la cuenta lleva a varios pacientes, cada cita trae
//   `patientName` — dos hijos con cita el mismo día se veían iguales.
// · WS1-T5: cada cita de `upcoming` trae `pendingChange` (solicitud PENDING de
//   esa cita o null, UNA query extra) y el response trae `policies` (por
//   clínica de los links: minHours + autoApprove). En `past` siempre null.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { rateLimit } from "@/lib/rate-limit";
import { tzLocalToUtc, todayInTz } from "@/lib/agenda/time-utils";
import { bloqueaEsteHueco } from "@/lib/agenda-bloqueos/core";
import { leerBloqueosDelRango } from "@/lib/agenda-bloqueos/consulta.server";
import { doctorNoAtiende, MENSAJE_PUBLICO_FUERA_DE_HORARIO } from "@/lib/horario-doctor/core";
import { leerHorariosDeDoctores } from "@/lib/horario-doctor/consulta.server";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { sincronizarCitaEnSegundoPlano } from "@/lib/agenda/google-sync";
import type {
  PacienteCambioPendiente,
  PacienteCita,
  PacienteCitasResponse,
  PacienteClinica,
  PacientePoliticaCambios,
} from "@/lib/patient-portal/types";
import { sinApartadoVencido } from "@/lib/agenda/apartado";
import { hayQueNombrarAlPaciente, pacienteDeLaCita } from "@/lib/patient-portal/ortodoncia-portal";
import { registrarMovimientoExterno } from "@/lib/movimientos-paciente/registrar";
import { textoCita } from "@/lib/movimientos-paciente/textos";

export const dynamic = "force-dynamic";

/** Select paciente-safe: NUNCA notes, price, tokens tele, overrideReason, etc. */
const citaSelect = {
  id: true,
  clinicId: true,
  type: true,
  status: true,
  startsAt: true,
  endsAt: true,
  holdExpiresAt: true,
  doctor: { select: { firstName: true, lastName: true } },
  // El nombre del propio paciente de la cuenta (ws1-t5, 93). Nada más de su ficha.
  patient: { select: { firstName: true, lastName: true } },
};

type CitaRow = {
  id: string;
  clinicId: string;
  type: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  holdExpiresAt: Date | null;
  doctor: { firstName: string; lastName: string };
  patient: { firstName: string; lastName: string };
};

function toCita(
  a: CitaRow,
  pendingChange: PacienteCambioPendiente | null,
  nombrarPaciente: boolean,
): PacienteCita {
  return {
    id: a.id,
    clinicId: a.clinicId,
    type: a.type,
    status: a.status,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    doctorName: `${a.doctor.firstName} ${a.doctor.lastName}`,
    pendingChange,
    // WS1-T5 — apartada esperando el anticipo: se confirma sola al pagarse.
    esperaAnticipo: a.status === "SCHEDULED" && a.holdExpiresAt != null,
    ...(nombrarPaciente ? { patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim() } : {}),
  };
}

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  // Multi-tenant: SOLO los pacientes vinculados a la cuenta de la sesión.
  const patientIds = ctx.links.map((l) => l.patientId);
  const now = new Date();

  const [links, upcomingRows, pastRows] = await Promise.all([
    prisma.patientAccountLink.findMany({
      where: { accountId: ctx.account.id, patient: { deletedAt: null } },
      select: {
        clinicId: true,
        patient: {
          select: {
            id: true,
            patientNumber: true,
            clinic: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                city: true,
                phone: true,
                patientChangesMinHours: true,
                patientChangesAutoApprove: true,
              },
            },
          },
        },
      },
    }),
    // Próximas: futuras y no canceladas/no-show, ascendente.
    prisma.appointment.findMany({
      where: {
        patientId: { in: patientIds },
        patient: { deletedAt: null },
        startsAt: { gte: now },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        // WS1-T5 — la cita apartada cuyo anticipo venció ya no es una cita próxima.
        AND: [sinApartadoVencido()],
      },
      orderBy: { startsAt: "asc" },
      select: citaSelect,
    }),
    // Anteriores: ya pasaron O fueron canceladas/no-show (incluye futuras
    // canceladas, que upcoming ya excluye — sin duplicados), descendente.
    prisma.appointment.findMany({
      where: {
        patientId: { in: patientIds },
        patient: { deletedAt: null },
        OR: [{ startsAt: { lt: now } }, { status: { in: ["CANCELLED", "NO_SHOW"] } }],
      },
      orderBy: { startsAt: "desc" },
      take: 100,
      select: citaSelect,
    }),
  ]);

  // WS1-T5: solicitudes PENDING de las citas próximas en UNA sola query extra.
  // Scope multi-tenant doble: ids de citas ya filtradas por la sesión + patientIds.
  const pendingByAppt = new Map<string, PacienteCambioPendiente>();
  const upcomingIds = upcomingRows.map((a) => a.id);
  if (upcomingIds.length > 0) {
    const pendingRows = await prisma.appointmentChangeRequest.findMany({
      where: {
        appointmentId: { in: upcomingIds },
        patientId: { in: patientIds },
        status: "PENDING",
      },
      select: {
        id: true,
        appointmentId: true,
        type: true,
        proposedStartsAt: true,
        createdAt: true,
      },
    });
    for (const r of pendingRows) {
      pendingByAppt.set(r.appointmentId, {
        id: r.id,
        type: r.type as PacienteCambioPendiente["type"],
        proposedStartsAt: r.proposedStartsAt ? r.proposedStartsAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      });
    }
  }

  const clinics: PacienteClinica[] = links.map((l) => ({
    clinicId: l.clinicId,
    clinicName: l.patient.clinic.name,
    clinicSlug: l.patient.clinic.slug,
    logoUrl: l.patient.clinic.logoUrl,
    city: l.patient.clinic.city,
    phone: l.patient.clinic.phone,
    patientId: l.patient.id,
    patientNumber: l.patient.patientNumber,
  }));

  // WS1-T5: política de cambios por clínica (deduplicada por clinicId).
  const policiesMap = new Map<string, PacientePoliticaCambios>();
  for (const l of links) {
    if (!policiesMap.has(l.clinicId)) {
      policiesMap.set(l.clinicId, {
        clinicId: l.clinicId,
        minHours: l.patient.clinic.patientChangesMinHours ?? 24,
        autoApprove: l.patient.clinic.patientChangesAutoApprove ?? false,
      });
    }
  }

  // ws1-t5 (93): con más de un paciente en la cuenta, cada cita dice de quién es.
  const nombrar = hayQueNombrarAlPaciente(links.map((l) => ({ patientId: l.patient.id })));

  const body: PacienteCitasResponse = {
    clinics,
    upcoming: upcomingRows.map((a) => toCita(a, pendingByAppt.get(a.id) ?? null, nombrar)),
    past: pastRows.map((a) => toCita(a, null, nombrar)),
    policies: Array.from(policiesMap.values()),
  };
  return NextResponse.json(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/paciente/appointments — WS2-T1. Agendar una cita NUEVA desde el
// portal del paciente.
//
// Body: { clinicId, doctorId, date: "YYYY-MM-DD", startTime: "HH:mm",
//         type?, reason?, patientId? }
//
// Multi-tenant ESTRICTO: clinicId DEBE estar en un link de la sesión y el
// patientId sale de los links de la sesión en ESA clínica. ws1-t5 (93): el
// body puede decir PARA QUIÉN es (`patientId`), pero solo vale si es uno de
// esos links; si la cuenta tiene a varios pacientes en la clínica y no lo
// dice, se responde 400 `falta-paciente` en vez de adivinar (antes la cita
// del segundo hijo quedaba a nombre del primero). Valida que el doctor sea
// de esa clínica y esté activo; valida fecha/hora contra el horario de la
// clínica; transacción anti-doble-cita; crea con status PENDING y source
// PATIENT_PORTAL (valor de enum existente — sin tocar el schema). Side-effects
// (WhatsApp + Google Calendar) best-effort: nunca rompen la respuesta.
//
// Códigos: 200 ok | 400 datos inválidos | 401 sin sesión |
//          404 clínica/doctor inexistente o sin link | 409 slot ocupado.
export async function POST(req: NextRequest) {
  const DURATION_MIN = 30;
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const rl = rateLimit(req, 10); // 10/min por IP
    if (rl) return rl;

    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }
    const { clinicId, doctorId, date, startTime, type, reason, patientId: patientIdPedido } = raw as {
      clinicId?: string;
      doctorId?: string;
      date?: string;
      startTime?: string;
      type?: string;
      reason?: string;
      patientId?: unknown;
    };

    if (!clinicId || !doctorId || !date || !startTime) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Formato de fecha inválido" }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(startTime)) {
      return NextResponse.json({ error: "Formato de hora inválido" }, { status: 400 });
    }

    // Multi-tenant: la clínica DEBE estar en un link de la sesión, y el
    // paciente tiene que ser uno de los links de la sesión EN esa clínica.
    const elegido = pacienteDeLaCita(
      ctx.links,
      clinicId,
      typeof patientIdPedido === "string" ? patientIdPedido : null,
    );
    if (elegido.ok === false) {
      if (elegido.motivo === "falta-elegir") {
        return NextResponse.json(
          { error: "Elige para quién es la cita.", code: "falta-paciente" },
          { status: 400 },
        );
      }
      // Sin vínculo en la clínica, o un paciente que no es de esta cuenta: la
      // misma respuesta, sin decir cuál de las dos.
      return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
    }
    const patientId = elegido.patientId;

    // El vínculo sobrevive a un expediente dado de baja: a ese no se le agenda.
    const expediente = await prisma.patient.findFirst({
      where: { id: patientId, clinicId, deletedAt: null },
      select: { id: true },
    });
    if (!expediente) {
      return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
    }

    // Clínica: timezone + horarios + config de los side-effects.
    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        timezone: true,
        waConnected: true,
        waPhoneNumberId: true,
        waAccessToken: true,
        // Fuera de la ventana de 24 h el aviso solo sale por plantilla (M-09).
        waTemplates: true,
        schedules: {
          select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
        },
      },
    });
    if (!clinic) {
      return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
    }

    // El doctor debe pertenecer a ESA clínica y estar activo.
    const doctor = await prisma.user.findFirst({
      where: {
        id: doctorId,
        clinicId,
        isActive: true,
        role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!doctor) {
      return NextResponse.json({ error: "Doctor no disponible" }, { status: 404 });
    }

    // ── Validación de fecha/hora vs horario de la clínica ────────────────────
    const timezone = clinic.timezone;
    const todayISO = todayInTz(timezone);
    if (date < todayISO) {
      return NextResponse.json({ error: "La fecha debe ser hoy o futura" }, { status: 400 });
    }

    // Día de la semana (independiente de timezone): 0=Lun..6=Dom.
    const [y, mo, d] = date.split("-").map(Number);
    const jsDayOfWeek = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const scheduleDay = jsDayOfWeek === 0 ? 6 : jsDayOfWeek - 1;
    const daySchedule = clinic.schedules.find((s) => s.dayOfWeek === scheduleDay);
    if (!daySchedule || !daySchedule.enabled) {
      return NextResponse.json({ error: "La clínica no atiende ese día" }, { status: 400 });
    }

    const [slotH, slotM] = startTime.split(":").map(Number);
    const slotMins = slotH * 60 + slotM;
    const [openH, openM] = daySchedule.openTime.split(":").map(Number);
    const [closeH, closeM] = daySchedule.closeTime.split(":").map(Number);
    if (slotMins < openH * 60 + openM || slotMins + DURATION_MIN > closeH * 60 + closeM) {
      return NextResponse.json(
        { error: "El horario está fuera del horario de atención" },
        { status: 400 }
      );
    }

    const startsAt = tzLocalToUtc(date, slotH, slotM, timezone);
    // Si es hoy (en tz de la clínica), la hora no puede haber pasado.
    if (date === todayISO && startsAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Ese horario ya pasó. Elige otro." }, { status: 400 });
    }
    const endsAt = new Date(startsAt.getTime() + DURATION_MIN * 60_000);

    // ═════════════════════════════════════════════════════════════════════
    // WS1-T2 · horario — EL CANDADO DEL ALTA DEL PORTAL.
    //
    // Esta ruta ESCRIBE una cita y no estaba entre los diez sitios que tapó
    // el bloqueo: `GET /api/paciente/booking/slots` esconde las horas
    // bloqueadas y las que el doctor no atiende, pero una pestaña vieja —o
    // una petición a mano— seguía creando la cita. Se comprueban las dos
    // cosas con las funciones de siempre: el bloqueo (`bloqueaEsteHueco`) y
    // el horario propio del doctor (`doctorNoAtiende`). 409, como el hueco
    // ocupado: es un conflicto con el estado de la agenda, y el motivo no se
    // le cuenta al paciente.
    // ═════════════════════════════════════════════════════════════════════
    const [bloqueosDelHueco, horarios] = await Promise.all([
      leerBloqueosDelRango(clinicId, startsAt, endsAt, { doctorIds: [doctorId] }),
      leerHorariosDeDoctores(clinicId, { doctorIds: [doctorId] }),
    ]);
    if (bloqueaEsteHueco(bloqueosDelHueco, startsAt, endsAt, doctorId)) {
      return NextResponse.json(
        { error: "La clínica cerró la agenda en ese horario. Elige otro horario, por favor." },
        { status: 409 }
      );
    }
    if (doctorNoAtiende(horarios, startsAt, endsAt, doctorId, timezone)) {
      return NextResponse.json({ error: MENSAJE_PUBLICO_FUERA_DE_HORARIO }, { status: 409 });
    }

    const cleanType = (type ?? "").trim() || "Consulta general";
    const cleanNotes = (reason ?? "").trim().slice(0, 500) || null;

    // ── Transacción anti-doble-cita (mismo doctor, misma hora exacta) ────────
    const appt = await prisma
      .$transaction(async (tx) => {
        const conflict = await tx.appointment.findFirst({
          where: {
            clinicId,
            doctorId,
            startsAt,
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
            // WS1-T5 — una cita apartada cuyo anticipo venció ya no ocupa el hueco.
            AND: [sinApartadoVencido()],
          },
          select: { id: true },
        });
        if (conflict) throw new Error("SLOT_TAKEN");

        return tx.appointment.create({
          data: {
            clinicId,
            patientId,
            doctorId,
            type: cleanType,
            startsAt,
            endsAt,
            status: "SCHEDULED",
            source: "PATIENT_PORTAL",
            notes: cleanNotes,
          },
          select: { id: true, startsAt: true, endsAt: true },
        });
      })
      .catch((err: any) => {
        if (err?.message === "SLOT_TAKEN") return null;
        throw err;
      });

    if (!appt) {
      return NextResponse.json(
        { error: "Este horario ya fue reservado. Elige otro." },
        { status: 409 }
      );
    }

    // ws1-t12 — el propio paciente agendó desde su portal (sin usuario del equipo).
    await registrarMovimientoExterno({
      actor: "patient",
      clinicId, // ya validado contra los links de la sesión, no es el del body sin comprobar
      patientId,
      entityType: "appointment",
      entityId: appt.id,
      action: "create",
      texto: textoCita.agendada(appt.startsAt, timezone),
      req,
    });

    // ── Side-effects best-effort (no rompen la respuesta) ────────────────────
    const patient = await prisma.patient
      .findUnique({
        where: { id: patientId },
        select: { firstName: true, lastName: true, phone: true, email: true },
      })
      .catch(() => null);

    const patientName = patient
      ? `${patient.firstName} ${patient.lastName}`.trim()
      : ctx.account.name;
    const patientPhone = patient?.phone ?? ctx.account.phone ?? null;

    // WhatsApp: aviso de solicitud recibida.
    if (clinic.waConnected && clinic.waPhoneNumberId && clinic.waAccessToken && patientPhone) {
      try {
        const cleanPhone = patientPhone.replace(/[\s\-()+]/g, "");
        const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        const contactNum = clinic.phone ?? clinic.waPhoneNumberId;
        const msg =
          `📅 *Solicitud de cita en ${clinic.name}*\n\n` +
          `Recibimos tu solicitud:\n` +
          `📅 *Fecha:* ${dateFormatted}\n` +
          `🕐 *Hora:* ${startTime}\n` +
          `👨‍⚕️ *Doctor/a:* Dr/a. ${doctor.firstName} ${doctor.lastName}\n` +
          `📋 *Motivo:* ${cleanType}\n\n` +
          `La clínica confirmará tu cita pronto. Para cambios: ${contactNum}`;
        await sendWhatsAppLogged({
          clinic,
          to: cleanPhone,
          body: msg,
          kind: "booking",
          patientId: patientId,
          // {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora, {{5}} doctor.
          templateParams: [
            patient?.firstName || patientName || "paciente",
            clinic.name,
            dateFormatted,
            startTime,
            `Dr/a. ${doctor.firstName} ${doctor.lastName}`.trim(),
          ],
        });
      } catch (e) {
        console.error("[paciente/appointments POST] WhatsApp confirm failed:", e);
      }
    }

    // Google Calendar: no lanza y no alarga la respuesta (la cita ya está guardada).
    await sincronizarCitaEnSegundoPlano(clinicId, appt.id);

    return NextResponse.json({
      ok: true,
      appointmentId: appt.id,
      startsAt: appt.startsAt.toISOString(),
      status: "SCHEDULED",
    });
  } catch (err: any) {
    console.error("[paciente/appointments POST] error:", err);
    return NextResponse.json({ error: "Error interno al agendar" }, { status: 500 });
  }
}
