import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import {
  findUnknownReminderVars,
  getConfirmUrl,
  renderReminderTemplate,
} from "@/lib/reminders/config";

// Texto de respaldo cuando la clínica no guardó uno propio (waReminderMsg).
// Mismas palabras que antes; ahora pasa por el MISMO render que el texto de la
// clínica. Bidireccional: el paciente puede responder CONFIRMAR o CANCELAR.
const FALLBACK_TEMPLATE =
  "Hola {paciente} 👋, te recordamos que tienes una cita en *{clinica}* el *{fecha}* a las *{hora}h*.\n\n" +
  "{doctor}\n\n" +
  "✅ Responde *CONFIRMAR* para confirmar tu cita\n" +
  "❌ Responde *CANCELAR* si no podrás asistir";

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  const clinicId = ctx!.clinicId;

  const { appointmentId } = await req.json();

  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return NextResponse.json({ error: "WhatsApp no está conectado" }, { status: 400 });
  }

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
    include: { patient: true, doctor: true },
  });
  if (!appt) return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
  if (!appt.patient.phone) return NextResponse.json({ error: "El paciente no tiene teléfono registrado" }, { status: 400 });

  const date = new Intl.DateTimeFormat("es-MX", {
    timeZone: clinic.timezone, weekday: "long", day: "numeric", month: "long",
  }).format(appt.startsAt);

  const hora = timeHHMMInTz(appt.startsAt, clinic.timezone);

  // El texto de la clínica se guardaba con {nombre}/{fecha}/{hora}/{doctor} y
  // salía TAL CUAL: a un paciente le llegó «Hola {nombre}». Se renderiza con la
  // misma función que los recordatorios automáticos (enqueue / reschedule).
  const template = clinic.waReminderMsg?.trim() || FALLBACK_TEMPLATE;

  // Un marcador que el render no conoce ({precio}, { nombre }…) llegaría
  // literal al paciente. Aquí hay una persona pulsando el botón: mejor que vea
  // el motivo y lo corrija a que el paciente reciba llaves.
  const unknown = findUnknownReminderVars(template);
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: `El mensaje del recordatorio tiene variables que no existen: ${unknown.join(", ")}. Corrígelo en WhatsApp → Mensaje del recordatorio.`,
        unknownVars: unknown,
      },
      { status: 400 },
    );
  }

  // Link de confirmación: mismo patrón que enqueue.ts. El guard
  // `confirmToken: null` no pisa un token ya enviado en otro mensaje.
  let token = appt.confirmToken;
  if (!token) {
    const fresh = randomBytes(24).toString("base64url");
    const wrote = await prisma.appointment.updateMany({
      where: { id: appt.id, clinicId, confirmToken: null },
      data: { confirmToken: fresh },
    });
    if (wrote.count === 1) {
      token = fresh;
    } else {
      const current = await prisma.appointment.findFirst({
        where: { id: appt.id, clinicId },
        select: { confirmToken: true },
      });
      token = current?.confirmToken ?? fresh;
    }
  }

  const body = renderReminderTemplate(template, {
    paciente: appt.patient.firstName,
    clinica: clinic.name,
    fecha: date,
    hora,
    doctor: `Dr/a. ${appt.doctor.firstName} ${appt.doctor.lastName}`.trim(),
    link: getConfirmUrl(token),
  });

  try {
    await sendWhatsAppLogged({
      clinic,
      to: appt.patient.phone,
      body,
      kind: "manual_api",
      // {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora. El cuerpo libre
      // de arriba lo puede haber cambiado la clínica (waReminderMsg); la
      // plantilla NO, porque Meta la aprueba palabra por palabra. Estos van
      // como parámetros, NUNCA por renderReminderTemplate.
      templateParams: [
        appt.patient.firstName || "paciente",
        clinic.name,
        date,
        hora,
      ],
    });
    await prisma.appointment.update({ where: { id: appointmentId }, data: { reminderSent: true } });
    await prisma.whatsAppReminder.create({
      data: { clinicId, appointmentId, type: "MANUAL", status: WA_REMINDER_STATUS.SENT, sentAt: new Date(), scheduledFor: new Date() },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    await prisma.whatsAppReminder.create({
      data: { clinicId, appointmentId, type: "MANUAL", status: WA_REMINDER_STATUS.FAILED, errorMsg: err.message, scheduledFor: new Date() },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
