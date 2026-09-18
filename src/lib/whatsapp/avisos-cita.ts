// Avisos de WhatsApp que salen cuando EL EQUIPO agenda, mueve o cancela una
// cita desde el panel (ws1-t2 — H-1 y H-2 de la auditoría de WhatsApp).
//
// EL FALLO QUE CIERRA: el diálogo de nueva cita pinta «Enviar WhatsApp» solo a
// las clínicas conectadas, manda `notifyPatient` en el POST… y el servidor lo
// tiraba en un `TODO(M3.b)` que el 25-abr-2026 (7527420d) sustituyó al código
// que sí enviaba. Cinco meses con un interruptor que decía «avisado» sin avisar.
//
// TRES REGLAS:
//   1. TODO sale por `sendWhatsAppLogged`: es el embudo que decide texto libre
//      o plantilla (ventana de 24 h) y el que deja copia en el Inbox. Aquí no se
//      importa la capa cruda (`@/lib/whatsapp`) — hay un test que lo impide.
//   2. La CLÍNICA manda: `reminderSettings.eventos` (Dashboard → WhatsApp)
//      decide si cada aviso existe. Sin nada guardado valen los defaults de
//      `DEFAULT_APPOINTMENT_EVENT_SETTINGS` — los TRES apagados (ws1-t2):
//      cada aviso fuera de la ventana de 24 h es una plantilla de pago, y
//      encenderla es una decisión de la clínica, no un accidente.
//   3. NUNCA rompe la operación ni miente: no lanza, y devuelve por qué no
//      salió para que la pantalla se lo diga a quien pulsó el botón.

import { prisma } from "@/lib/prisma";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { formatApptDateParts, getAppointmentEventSettings } from "@/lib/reminders/config";
import { describeReminderFailure, type ReminderErrorKey } from "@/lib/whatsapp/reminder-error";
import { WhatsAppApiError, WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { pastToleranceMs } from "@/lib/agenda/booking-rules";

export type AvisoCitaEvento = "agendada" | "reprogramada" | "cancelada";

/** Por qué NO salió un aviso. Las de `ReminderErrorKey` vienen del envío. */
export type AvisoCitaMotivo =
  /** La clínica tiene ese aviso apagado en Dashboard → WhatsApp. */
  | "apagadoPorClinica"
  /** La cita ya empezó o ya pasó: avisar de ella no tiene sentido. */
  | "citaPasada"
  /** Falló por algo que no sabemos nombrar (queda en el log del servidor). */
  | "desconocido"
  | ReminderErrorKey;

export type AvisoCitaResultado =
  | { enviado: true }
  | { enviado: false; motivo: AvisoCitaMotivo };

export interface AvisarCitaArgs {
  evento: AvisoCitaEvento;
  appointmentId: string;
  /** SIEMPRE el de la sesión. Filtra la consulta: una cita de otra clínica no existe. */
  clinicId: string;
  /** Quién pulsó el botón: el mensaje queda en el Inbox a su nombre. */
  sentById?: string | null;
}

const AJUSTE_POR_EVENTO = {
  agendada: "alAgendar",
  reprogramada: "alReprogramar",
  cancelada: "alCancelar",
} as const;

/**
 * Texto libre (el que sale con la ventana de 24 h abierta). Con la ventana
 * cerrada `sendWhatsAppLogged` lo cambia por la plantilla aprobada del tipo.
 */
export function textoAvisoCita(
  evento: AvisoCitaEvento,
  v: { paciente: string; clinica: string; fecha: string; hora: string; doctor: string; contacto: string | null },
): string {
  const contacto = v.contacto ? ` ${v.contacto}` : "";
  if (evento === "agendada") {
    return (
      `✅ *Cita agendada en ${v.clinica}*\n\n` +
      `Hola ${v.paciente}, tu cita quedó registrada:\n` +
      `📅 *Fecha:* ${v.fecha}\n` +
      `🕐 *Hora:* ${v.hora}\n` +
      `👨‍⚕️ *Te atiende:* ${v.doctor}\n\n` +
      `Para cambios o cancelaciones contáctanos${contacto}.`
    );
  }
  if (evento === "reprogramada") {
    return (
      `Hola ${v.paciente} 👋. Tu cita en *${v.clinica}* cambió: ahora es el *${v.fecha}* a las *${v.hora}*. ` +
      `Te atiende: ${v.doctor}. Si no te queda bien, escríbenos por aquí.`
    );
  }
  return (
    `Hola ${v.paciente}. Tu cita en *${v.clinica}* del *${v.fecha}* a las *${v.hora}* fue cancelada. ` +
    `Cuando quieras otra fecha, escríbenos por aquí${v.contacto ? ` o al ${v.contacto}` : ""}.`
  );
}

/**
 * Manda el aviso del evento, si la clínica lo tiene encendido y se puede.
 * No lanza nunca: agendar, mover o cancelar NO pueden fallar por un WhatsApp.
 */
export async function avisarCitaPorWhatsApp(args: AvisarCitaArgs): Promise<AvisoCitaResultado> {
  try {
    // (c) de la casa: sin clinicId no se consulta — `clinicId: undefined` no filtra.
    if (!args.clinicId || !args.appointmentId) return { enviado: false, motivo: "desconocido" };

    const appt = await prisma.appointment.findFirst({
      where: { id: args.appointmentId, clinicId: args.clinicId },
      select: {
        startsAt: true,
        patient: { select: { id: true, firstName: true, phone: true } },
        doctor: { select: { firstName: true, lastName: true } },
        clinic: {
          select: {
            id: true,
            name: true,
            phone: true,
            timezone: true,
            defaultSlotMinutes: true,
            reminderSettings: true,
            waConnected: true,
            waPhoneNumberId: true,
            waAccessToken: true,
            // Quien acaba de agendar casi nunca ha escrito en las últimas 24 h:
            // lo normal es que esto salga por plantilla (M-09).
            waTemplates: true,
          },
        },
      },
    });
    if (!appt) return { enviado: false, motivo: "desconocido" };

    const { clinic, patient, doctor } = appt;
    if (!getAppointmentEventSettings(clinic)[AJUSTE_POR_EVENTO[args.evento]]) {
      return { enviado: false, motivo: "apagadoPorClinica" };
    }
    if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
      return { enviado: false, motivo: "notConnected" };
    }
    if (!patient?.phone || patient.phone.replace(/\D/g, "").length < 10) {
      return { enviado: false, motivo: "noPhone" };
    }
    // Una cita que ya pasó (se agenda hacia atrás con `overrideReason`, o se
    // cancela una de ayer para limpiar la agenda) no se le anuncia a nadie. La
    // tolerancia es la MISMA con la que el POST deja agendar «ahora» (el
    // paciente que llega 10:10 y se le da la de las 10:00): si no, esa cita se
    // crea bien y el diálogo soltaría un error de WhatsApp que no es tal.
    if (appt.startsAt.getTime() < Date.now() - pastToleranceMs(clinic.defaultSlotMinutes)) {
      return { enviado: false, motivo: "citaPasada" };
    }

    const { fecha, hora } = formatApptDateParts(appt.startsAt, clinic.timezone);
    const doctorName = `Dr/a. ${doctor.firstName} ${doctor.lastName}`.trim();
    const paciente = patient.firstName || "paciente";

    await sendWhatsAppLogged({
      clinic,
      to: patient.phone,
      body: textoAvisoCita(args.evento, {
        paciente,
        clinica: clinic.name,
        fecha,
        hora,
        doctor: doctorName,
        contacto: clinic.phone ?? null,
      }),
      kind: args.evento === "agendada" ? "booking" : "appointment_change",
      // El equipo eligió a ESTE paciente: el hilo nace ligado a él, no al
      // primero que comparta teléfono.
      patientId: patient.id,
      sentById: args.sentById ?? null,
      // {{1}} paciente, {{2}} clínica, {{3}} fecha, {{4}} hora, {{5}} doctor.
      //
      // OJO con la cancelación: la plantilla `appointment_change` dice que la
      // cita «cambió al…». Mandarla para cancelar sería un mensaje que miente,
      // así que NO lleva parámetros: fuera de la ventana de 24 h el aviso se
      // bloquea con su motivo (mismo criterio que appointment-change/notify.ts).
      templateParams:
        args.evento === "cancelada" ? null : [paciente, clinic.name, fecha, hora, doctorName],
    });
    return { enviado: true };
  } catch (e) {
    console.error(`[whatsapp/avisos-cita] ${args.evento} ${args.appointmentId}:`, e);
    const motivo = describeReminderFailure({
      code: e instanceof WhatsAppApiError ? e.code : null,
      errorMsg: e instanceof Error ? e.message : null,
    });
    // Todo bloqueo previo al envío es «ventana de 24 h cerrada y sin plantilla
    // que valga» (send-mode.ts). El de la cancelación —que a propósito no lleva
    // parámetros— no tiene patrón propio: se cuenta como lo que es.
    if (!motivo && e instanceof WhatsAppBlockedError) return { enviado: false, motivo: "outside24h" };
    return { enviado: false, motivo: motivo ?? "desconocido" };
  }
}
