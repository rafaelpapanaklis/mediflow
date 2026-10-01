import { prisma } from "@/lib/prisma";
import {
  getAvailableSlots,
  getClinicName,
  getClinicTimezone,
  getUpcomingAppointmentsForPatient,
  listBookableDoctors,
  listBookableServices,
  rescheduleBotAppointment,
} from "@/lib/agenda/bot-booking-service";
import { findOrCreateWhatsAppPatient } from "./booking-helpers";
import { findPatientsByWhatsAppPhone } from "@/lib/whatsapp/inbox-log";
import { anticipoParaAnunciar, crearCitaDesdeBot } from "@/lib/anticipos/servicio.server";
import { getOrthoBookingContext } from "@/lib/orthodontics/whatsapp-bot-booking";
import { anotarCitaCreadaPorBot, anotarCitaMovidaPorBot, citaAntesDeMover } from "./movimientos-bot";
import { runBookingTurn, type BookingDeps } from "./booking-core";
import type { BotConfigDTO, BotTurnInput, BotTurnResult } from "./types";

/**
 * T4 — shell server-side del flujo de agenda del bot. La máquina de estados pura
 * y testeable vive en ./booking-core; aquí solo cableamos las dependencias
 * reales (servicio de agenda + lecturas Prisma scopeadas por clinicId) y las
 * inyectamos. engine.ts importa handleBookingTurn e isBookingInProgress desde
 * aquí, sin cambios.
 */

export { isBookingInProgress } from "./booking-core";

const realDeps: BookingDeps = {
  getClinicTimezone,
  getClinicName,
  listBookableServices,
  listBookableDoctors,
  getAvailableSlots,
  // WS1-T5 — el alta pasa por el servicio de anticipos: si la clínica no pide
  // anticipo es exactamente createBotAppointment; si lo pide, aparta el hueco y
  // devuelve el link de Mercado Pago.
  createBotAppointment: async (params) => {
    const r = await crearCitaDesdeBot(params);
    // ws1-t12 — la cita que agenda el bot queda en los movimientos del paciente.
    if (r.ok) await anotarCitaCreadaPorBot({ clinicId: params.clinicId, appointmentId: r.appointmentId });
    return r;
  },
  anticipoParaAnunciar: (clinicId, serviceId) => anticipoParaAnunciar(clinicId, serviceId),
  rescheduleBotAppointment: async (params) => {
    const antes = await citaAntesDeMover(params.clinicId, params.appointmentId);
    const r = await rescheduleBotAppointment(params);
    if (r.ok) await anotarCitaMovidaPorBot({ clinicId: params.clinicId, appointmentId: r.appointmentId ?? params.appointmentId, antes });
    return r;
  },
  getUpcomingAppointmentsForPatient,
  findOrCreateWhatsAppPatient,
  // ws1-t1 (#12) — la misma búsqueda normalizada que el webhook y el saldo; solo
  // cuentan los pacientes activos y no borrados (a un dado de baja no se le agenda).
  listPhoneOwners: async (clinicId, phone) => {
    if (!clinicId || !phone) return [];
    const encontrados = await findPatientsByWhatsAppPhone(clinicId, phone);
    if (encontrados.length < 2) return [];
    return prisma.patient.findMany({
      where: { clinicId, id: { in: encontrados.map((p) => p.id) }, deletedAt: null, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, firstName: true, lastName: true },
    });
  },
  findServiceById: (clinicId, id) =>
    prisma.procedureCatalog.findFirst({
      where: { id, clinicId, isActive: true },
      select: { name: true, duration: true },
    }),
  findThreadExternalId: async (threadId, clinicId) => {
    const thread = await prisma.inboxThread.findFirst({
      where: { id: threadId, clinicId },
      select: { externalId: true },
    });
    return thread?.externalId ?? null;
  },
  findAppointmentById: (id, clinicId) =>
    prisma.appointment.findFirst({
      where: { id, clinicId },
      select: {
        id: true,
        doctorId: true,
        startsAt: true,
        endsAt: true,
        type: true,
        doctor: { select: { firstName: true, lastName: true } },
      },
    }),
  getOrthoBookingContext,
};

/** Entrypoint que consume el motor (engine.ts). deps inyectable para tests. */
export function handleBookingTurn(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps = realDeps,
): Promise<BotTurnResult | null> {
  return runBookingTurn(input, config, deps);
}
