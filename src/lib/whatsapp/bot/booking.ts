import type { HandleBookingTurn } from "./types";

/**
 * IMPLEMENTA: T4 — flujo de agendar / reagendar multi-turno.
 *
 * El motor la llama cuando config.canBookAppointments y el texto parece de
 * agenda. Usa input.botState para el estado en progreso (paso, servicio, fecha,
 * doctor…) y devuelve newBotState para persistirlo en InboxThread.botState.
 *
 * APIs / funciones EXISTENTES (NO reescribir — solo consumir):
 *   - Disponibilidad (sin auth):  GET /api/public/availability?slug=&date=YYYY-MM-DD&doctorId=
 *       → { clinic, doctors, slots, allSlots, bookedSlots }
 *   - Crear cita:                 POST /api/appointments
 *       body: { patientId, doctorId, resourceId?, startsAt, endsAt, reason?, … }  (requiere sesión)
 *   - Reagendar:                  PATCH  /api/appointments/[id]   body: { startsAt?, endsAt?, doctorId?, … }
 *   - Cancelar:                   DELETE /api/appointments/[id]
 *   - Lecturas server-only:       src/lib/agenda/server.ts
 *       fetchAppointmentsForDay, fetchAppointmentsForRange, fetchActiveDoctors, fetchResources
 *   - Timezone:                   tzLocalToUtc("YYYY-MM-DD", hora, min, tz)  en src/lib/agenda/time-utils.ts
 *   - Servicios / precios:        model ProcedureCatalog   (GET /api/procedures)
 *
 * NOTA: las mutaciones HTTP requieren sesión de staff. Para crear/reagendar
 * desde el bot, T4 deberá envolver Prisma directamente (server-side, scopeado
 * por clinicId, replicando las validaciones de /api/appointments) o exponer una
 * función de servicio reutilizable. Detalle en ORQUESTA.md.
 *
 * NO cambies la firma (HandleBookingTurn): runBotTurn la invoca tal cual.
 *
 * En la fundación (T1) devuelve null.
 */
export const handleBookingTurn: HandleBookingTurn = async (_input, _config) => {
  // IMPLEMENTA: T4 (agenda). Devuelve { reply, intent, newBotState } o null.
  return null;
};
