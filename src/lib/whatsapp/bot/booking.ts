import { prisma } from "@/lib/prisma";
import {
  createBotAppointment,
  getAvailableSlots,
  getClinicName,
  getClinicTimezone,
  getUpcomingAppointmentsForPatient,
  listBookableDoctors,
  listBookableServices,
  rescheduleBotAppointment,
} from "@/lib/agenda/bot-booking-service";
import { findOrCreateWhatsAppPatient } from "./booking-helpers";
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
  createBotAppointment,
  rescheduleBotAppointment,
  getUpcomingAppointmentsForPatient,
  findOrCreateWhatsAppPatient,
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
};

/** Entrypoint que consume el motor (engine.ts). deps inyectable para tests. */
export function handleBookingTurn(
  input: BotTurnInput,
  config: BotConfigDTO,
  deps: BookingDeps = realDeps,
): Promise<BotTurnResult | null> {
  return runBookingTurn(input, config, deps);
}
