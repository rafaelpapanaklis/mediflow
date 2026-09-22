// Los avisos del anticipo al paciente (WS1-T5): «quedó confirmada», «recibimos
// tu pago pero el horario ya se había liberado» y «se liberó tu horario».
//
// Salen por `sendWhatsAppLogged`, el mismo camino que todos los avisos
// automáticos, que decide TEXTO LIBRE o PLANTILLA según la ventana de 24 h de
// Meta (send-mode.ts). No hay atajo que se la salte:
//
//   · Dentro de la ventana (lo normal: el paciente estaba hablando con el bot
//     hace minutos) sale el texto libre, gratis.
//   · Fuera de ella, la confirmación sale con la plantilla aprobada
//     `dc_confirmacion_cita` («tu cita … quedó registrada para el …»), la que
//     ya usa la página pública — Meta se la cobra a la clínica. Los otros dos
//     avisos NO tienen plantilla: se BLOQUEAN, no se llama a Meta, y el motivo
//     queda en `appointment_deposits.noticeError` para que el equipo lo vea.
//
// Quedar fuera de la ventana solo pasa si el aviso sale más de 24 h después del
// último mensaje del paciente: con un plazo de 30 min, eso es que el cron
// estuvo parado un día entero. El hueco se libera igual (por dato); lo único
// que se pierde es el mensaje.

import { prisma } from "@/lib/prisma";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { formatDateHuman, formatTimeHuman, toISODate } from "@/lib/whatsapp/bot/booking-parse";
import { textoCitaConfirmada, textoHorarioLiberado, textoPagoSinCita } from "./core";
import type { AvisoAnticipo } from "./servicio.server";

export async function avisarAlPaciente(aviso: AvisoAnticipo): Promise<void> {
  const dep = await prisma.appointmentDeposit.findUnique({
    where: { id: aviso.depositId },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      waPhone: true,
      appointment: {
        select: {
          startsAt: true,
          doctor: { select: { firstName: true, lastName: true } },
        },
      },
      patient: { select: { firstName: true, phone: true } },
      clinic: {
        select: {
          id: true,
          name: true,
          timezone: true,
          waConnected: true,
          waPhoneNumberId: true,
          waAccessToken: true,
          waTemplates: true,
        },
      },
    },
  });
  if (!dep) return;

  const to = dep.waPhone || dep.patient?.phone || null;
  const clinic = dep.clinic;
  if (!to || !clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    await anotar(dep.id, null, "La clínica no tiene WhatsApp conectado o no hay teléfono: no se avisó.");
    return;
  }

  const tz = clinic.timezone || "America/Mexico_City";
  const cita = dep.appointment;
  const fechaHumana = cita ? formatDateHuman(toISODate(cita.startsAt, tz), tz) : "";
  const hora = cita ? formatTimeHuman(cita.startsAt, tz) : "";
  const doctor = cita?.doctor ? `${cita.doctor.firstName} ${cita.doctor.lastName}`.trim() : "";

  let body: string;
  let templateParams: string[] | null = null;
  if (aviso.tipo === "confirmada") {
    body = textoCitaConfirmada({ monto: aviso.monto, fechaHumana, hora, clinica: clinic.name });
    // {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora, {{5}} doctor — el
    // orden de dc_confirmacion_cita en templates-catalog.ts. Meta sustituye por
    // posición: cambiar este orden entrega el mensaje con los datos revueltos.
    templateParams = [dep.patient?.firstName?.trim() || "", clinic.name, fechaHumana, hora, doctor];
  } else if (aviso.tipo === "pagada_sin_cita") {
    body = textoPagoSinCita({ monto: aviso.monto, clinica: clinic.name });
  } else {
    if (!cita) return;
    body = textoHorarioLiberado({ fechaHumana, hora });
  }

  try {
    await sendWhatsAppLogged({
      clinic,
      to,
      body,
      kind: "booking",
      patientId: dep.patientId,
      templateParams,
    });
    await anotar(dep.id, new Date(), null);
  } catch (e) {
    // WhatsAppBlockedError = fuera de ventana y sin plantilla posible. Es el
    // camino esperado, no un fallo: se deja escrito por qué no salió.
    const motivo = (e as Error)?.message?.slice(0, 500) || "El envío por WhatsApp falló.";
    console.error(`[anticipos] aviso ${aviso.tipo} del anticipo ${dep.id} no salió: ${motivo}`);
    await anotar(dep.id, null, motivo);
  }
}

async function anotar(depositId: string, enviado: Date | null, error: string | null): Promise<void> {
  try {
    await prisma.appointmentDeposit.update({
      where: { id: depositId },
      data: { noticeSentAt: enviado, noticeError: error },
    });
  } catch (e) {
    console.error(`[anticipos] no se pudo anotar el aviso del anticipo ${depositId}:`, (e as Error).message);
  }
}
