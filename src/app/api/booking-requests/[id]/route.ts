import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadClinicSession, isOverlapError } from "@/lib/agenda/api-helpers";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { nextPatientNumber, withPatientNumberRetry } from "@/lib/patients/next-patient-number";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import {
  activeDoctors,
  freeSlotsForDay,
  isMissingTable,
} from "@/lib/booking-requests/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/booking-requests/[id]
 *   { action: "accept", startTime?: "HH:MM", doctorId?: string }
 *   { action: "reject", reason?: string }
 *
 * ACEPTAR es lo que convierte una solicitud en algo real: crea el Patient de
 * ESTA clínica y la Appointment en el horario pedido. Hasta aquí el paciente no
 * existía en la base — la vía sin cuenta no crea expedientes fantasma.
 *
 * El hueco NO estaba apartado mientras la solicitud esperaba, así que puede
 * habérselo ganado otra persona. En ese caso se responde 409 CON los horarios
 * que sí quedan libres ese día, para que la recepción reagende de una vez en
 * vez de toparse con un error.
 */

/** "Ana María Gómez López" → nombre "Ana María", apellidos "Gómez López". */
function partirNombre(completo: string): { firstName: string; lastName: string } {
  const t = (completo ?? "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { firstName: "Paciente", lastName: "" };
  if (t.length === 1) return { firstName: t[0], lastName: "" };
  if (t.length === 2) return { firstName: t[0], lastName: t[1] };
  // Convención mexicana: los dos últimos tokens son los apellidos.
  return { firstName: t.slice(0, -2).join(" "), lastName: t.slice(-2).join(" ") };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const clinicId = session.clinic.id;
  const tz = session.clinic.timezone;

  let body: { action?: string; reason?: string; startTime?: string; doctorId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let solicitud;
  try {
    // El id NUNCA basta: se busca junto al clinicId de la sesión o una clínica
    // podría resolver las solicitudes de otra.
    solicitud = await prisma.bookingRequest.findFirst({
      where: { id: params.id, clinicId },
    });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json({ error: "Falta aplicar sql/landing-v2.sql" }, { status: 503 });
    }
    throw err;
  }

  if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  if (solicitud.status !== "PENDIENTE") {
    return NextResponse.json({ error: `Esta solicitud ya está ${solicitud.status.toLowerCase()}` }, { status: 409 });
  }

  /* ─────────────────────────── RECHAZAR ─────────────────────────── */
  if (body.action === "reject") {
    const denied = denyIfMissingPermission(session.user, "agenda.edit");
    if (denied) return denied;

    const motivo = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;

    await prisma.bookingRequest.update({
      where: { id: solicitud.id },
      data: { status: "RECHAZADA", rejectedReason: motivo },
    });

    return NextResponse.json({ ok: true, status: "RECHAZADA" });
  }

  /* ─────────────────────────── ACEPTAR ──────────────────────────── */
  if (body.action !== "accept") {
    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  }

  // Aceptar CREA un paciente y una cita: los dos permisos, no uno.
  for (const permiso of ["agenda.create", "patients.create"] as const) {
    const denied = denyIfMissingPermission(session.user, permiso);
    if (denied) return denied;
  }

  // ── Cuándo ──────────────────────────────────────────────────────
  const pedido = getTzParts(solicitud.requestedAt, tz);
  const dosDig = (n: number) => String(n).padStart(2, "0");
  const dateISO = `${pedido.year}-${dosDig(pedido.month)}-${dosDig(pedido.day)}`;

  let hora = `${dosDig(pedido.hour)}:${dosDig(pedido.minute)}`;
  if (typeof body.startTime === "string" && body.startTime) {
    if (!/^\d{2}:\d{2}$/.test(body.startTime)) {
      return NextResponse.json({ error: "Formato de hora inválido" }, { status: 400 });
    }
    hora = body.startTime;
  }
  const [h, mn] = hora.split(":").map(Number);

  const duracion = solicitud.serviceDurationMin && solicitud.serviceDurationMin > 0
    ? solicitud.serviceDurationMin
    : (session.clinic.defaultSlotMinutes || 30);

  const startsAt = tzLocalToUtc(dateISO, h, mn, tz);
  const endsAt = new Date(startsAt.getTime() + duracion * 60_000);

  // ── Quién ───────────────────────────────────────────────────────
  // El doctor que pidió manda; si pidió "cualquiera" (o quien pidió ya no
  // está activo), se resuelve DENTRO de la transacción con quien esté libre.
  const todos = await activeDoctors(clinicId);
  if (todos.length === 0) {
    return NextResponse.json({ error: "La clínica no tiene doctores activos" }, { status: 409 });
  }
  const forzado = body.doctorId ?? solicitud.doctorId ?? null;
  const candidatos = forzado && todos.some(d => d.id === forzado)
    ? todos.filter(d => d.id === forzado)
    : todos;

  const { firstName, lastName } = partirNombre(solicitud.patientName);
  // El procedimiento y lo que escribió el paciente se arrastran a la cita: si
  // se quedan en la solicitud, quien atiende nunca los ve.
  const notasCita = [
    solicitud.serviceName ? `Procedimiento solicitado: ${solicitud.serviceName}` : null,
    solicitud.notes,
    `Solicitud web sin cuenta · WhatsApp ${solicitud.patientWhatsapp}`,
  ].filter(Boolean).join("\n");

  try {
    // El retry envuelve al $transaction (no al revés): una tx abortada por
    // P2002 ya no admite queries, así que cada intento abre transacción nueva.
    const creado = await withPatientNumberRetry(() => prisma.$transaction(async (tx) => {
      const ocupados = await tx.appointment.findMany({
        where: {
          clinicId,
          doctorId: { in: candidatos.map(c => c.id) },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
          overrideReason: null,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { doctorId: true },
      });
      const tomados = new Set(ocupados.map(o => o.doctorId));
      const doctor = candidatos.find(c => !tomados.has(c.id));
      if (!doctor) throw new Error("SLOT_TAKEN");

      // 1) El expediente. El folio SIEMPRE con el helper: `count + 1` deja
      //    huecos y choca contra @@unique([clinicId, patientNumber]).
      await tx.$executeRaw`SELECT 1 FROM clinics WHERE id = ${clinicId} FOR UPDATE`;
      const patientNumber = await nextPatientNumber(clinicId, tx);
      const paciente = await tx.patient.create({
        data: {
          clinicId,
          patientNumber,
          firstName,
          lastName,
          phone: solicitud.patientWhatsapp,
          dob: solicitud.patientDob,
          primaryDoctorId: doctor.id,
        },
        select: { id: true, firstName: true, lastName: true },
      });

      // 2) La cita.
      const cita = await tx.appointment.create({
        data: {
          clinicId,
          patientId: paciente.id,
          doctorId: doctor.id,
          type: solicitud.serviceName || "Consulta general",
          startsAt,
          endsAt,
          status: "SCHEDULED",
          notes: notasCita,
          // Nació en la web, aunque la confirme el mostrador: el origen real
          // importa para las métricas de la mini-web.
          source: "WEBSITE",
          requiresValidation: false,
        },
        select: { id: true },
      });

      // 3) La solicitud queda cerrada y trazable hacia lo que creó.
      await tx.bookingRequest.update({
        where: { id: solicitud!.id },
        data: {
          status: "ACEPTADA",
          createdPatientId: paciente.id,
          createdAppointmentId: cita.id,
          doctorId: doctor.id,
        },
      });

      return { paciente, cita, doctor };
    }));

    await logMutation({
      req,
      clinicId,
      userId: session.user.id,
      entityType: "appointment",
      entityId: creado.cita.id,
      action: "create",
      after: {
        origen: "booking_request",
        bookingRequestId: solicitud.id,
        patientId: creado.paciente.id,
        doctorId: creado.doctor.id,
        startsAt,
      },
    });

    revalidateAfter("appointments");

    return NextResponse.json({
      ok: true,
      status: "ACEPTADA",
      patientId: creado.paciente.id,
      appointmentId: creado.cita.id,
      doctorName: `${creado.doctor.firstName} ${creado.doctor.lastName}`,
    });
  } catch (err: any) {
    // El hueco se lo ganaron mientras la solicitud esperaba. No es un error
    // del sistema: se responde con los horarios que SÍ quedan libres ese día.
    if (err?.message === "SLOT_TAKEN" || isOverlapError(err)) {
      const libres = await freeSlotsForDay({
        clinicId,
        dateISO,
        timezone: tz,
        durationMin: duracion,
        doctorIds: candidatos.map(c => c.id),
        schedules: session.clinic.schedules,
      }).catch(() => [] as string[]);

      return NextResponse.json({
        error: `Las ${hora} ya se ocuparon.`,
        code: "SLOT_TAKEN",
        date: dateISO,
        freeSlots: libres,
      }, { status: 409 });
    }
    console.error("[booking-requests] accept:", err);
    return NextResponse.json({ error: "No pudimos confirmar la cita. Intenta de nuevo." }, { status: 500 });
  }
}
