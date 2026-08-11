import "server-only";
import { prisma } from "@/lib/prisma";
import { getTzParts, tzLocalToUtc } from "@/lib/agenda/time-utils";
import { partitionSlotsByOverlap } from "@/lib/public-booking/slots";

/**
 * Solicitudes de cita SIN cuenta — lado panel.
 *
 * La tabla la escribe POST /api/public/booking-request (público, sin sesión).
 * Aquí vive lo que el panel necesita para leerlas y resolverlas. TODO filtra
 * por clinicId: en Prisma un `clinicId: undefined` BORRA el filtro y dejaría
 * ver las solicitudes de otras clínicas.
 */

export type BookingRequestStatus = "PENDIENTE" | "ACEPTADA" | "RECHAZADA" | "EXPIRADA";

export interface BookingRequestDTO {
  id: string;
  status: BookingRequestStatus;
  /** Día pedido, YYYY-MM-DD en la zona de la clínica. */
  date: string;
  /** Hora pedida, HH:MM en la zona de la clínica. */
  time: string;
  requestedAt: string;
  doctorId: string | null;
  doctorName: string | null;
  serviceName: string | null;
  serviceDurationMin: number | null;
  patientName: string;
  patientDob: string | null;
  patientWhatsapp: string;
  notes: string | null;
  rejectedReason: string | null;
  createdPatientId: string | null;
  createdAppointmentId: string | null;
  createdAt: string;
}

/** Error que la tabla no exista todavía (SQL sin aplicar) no tumba la agenda. */
export function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "P2021" || code === "42P01";
}

/**
 * Marca EXPIRADA toda solicitud PENDIENTE cuyo horario ya pasó. NUNCA borra:
 * la clínica tiene que poder ver a quién dejó esperando.
 * Devuelve cuántas expiró (0 si la tabla no existe).
 */
export async function expirePastRequests(clinicId: string): Promise<number> {
  try {
    const res = await prisma.bookingRequest.updateMany({
      where: { clinicId, status: "PENDIENTE", requestedAt: { lt: new Date() } },
      data: { status: "EXPIRADA" },
    });
    return res.count;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

const DOCTOR_ROLES = ["DOCTOR", "ADMIN", "SUPER_ADMIN"] as const;

/** Los doctores que pueden recibir una cita en esta clínica. */
export function activeDoctors(clinicId: string) {
  return prisma.user.findMany({
    where: { clinicId, isActive: true, role: { in: [...DOCTOR_ROLES] } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
}

export function toDTO(
  r: {
    id: string; status: string; requestedAt: Date; doctorId: string | null;
    serviceName: string | null; serviceDurationMin: number | null;
    patientName: string; patientDob: Date | null; patientWhatsapp: string;
    notes: string | null; rejectedReason: string | null;
    createdPatientId: string | null; createdAppointmentId: string | null; createdAt: Date;
  },
  timezone: string,
  doctorName: string | null,
): BookingRequestDTO {
  const p = getTzParts(r.requestedAt, timezone);
  const dosDig = (n: number) => String(n).padStart(2, "0");
  return {
    id: r.id,
    status: r.status as BookingRequestStatus,
    date: `${p.year}-${dosDig(p.month)}-${dosDig(p.day)}`,
    time: `${dosDig(p.hour)}:${dosDig(p.minute)}`,
    requestedAt: r.requestedAt.toISOString(),
    doctorId: r.doctorId,
    doctorName,
    serviceName: r.serviceName,
    serviceDurationMin: r.serviceDurationMin,
    patientName: r.patientName,
    // patientDob se guarda como DATE: se formatea en UTC a propósito para que
    // no se corra un día según la zona del servidor.
    patientDob: r.patientDob ? r.patientDob.toISOString().slice(0, 10) : null,
    patientWhatsapp: r.patientWhatsapp,
    notes: r.notes,
    rejectedReason: r.rejectedReason,
    createdPatientId: r.createdPatientId,
    createdAppointmentId: r.createdAppointmentId,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Horarios libres del día de la solicitud, para ofrecer alternativa cuando el
 * hueco pedido ya se ocupó. Con doctor concreto mira su agenda; sin doctor,
 * el horario sirve si al menos UNO está libre (mismo criterio que la reserva
 * pública).
 */
export async function freeSlotsForDay(args: {
  clinicId: string;
  dateISO: string;
  timezone: string;
  durationMin: number;
  doctorIds: string[];
  schedules: { dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }[];
}): Promise<string[]> {
  const { clinicId, dateISO, timezone, durationMin, doctorIds, schedules } = args;
  if (doctorIds.length === 0) return [];

  const [y, m, d] = dateISO.split("-").map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  const sched = schedules.find(s => s.dayOfWeek === (jsDay === 0 ? 6 : jsDay - 1));
  if (!sched?.enabled) return [];

  const [openH, openM] = sched.openTime.split(":").map(Number);
  const [closeH, closeM] = sched.closeTime.split(":").map(Number);
  const cierre = closeH * 60 + closeM;
  const slots: string[] = [];
  for (let min = openH * 60 + openM; min + durationMin <= cierre; min += 30) {
    slots.push(`${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
  }

  const inicioDia = tzLocalToUtc(dateISO, 0, 0, timezone);
  const finDia = new Date(inicioDia.getTime() + 86_400_000);
  const ocupadas = await prisma.appointment.findMany({
    where: {
      clinicId,
      doctorId: { in: doctorIds },
      startsAt: { lt: finDia },
      endsAt: { gt: inicioDia },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      overrideReason: null,
    },
    select: { startsAt: true, endsAt: true, doctorId: true },
  });

  // Un horario sirve si al menos UN doctor lo tiene libre.
  const disponibles = new Set<string>();
  for (const id of doctorIds) {
    const suyas = ocupadas.filter(o => o.doctorId === id);
    for (const s of partitionSlotsByOverlap(slots, dateISO, timezone, durationMin, suyas).available) {
      disponibles.add(s);
    }
  }

  // En el día en curso no se ofrecen horas que ya pasaron.
  const ahora = getTzParts(new Date(), timezone);
  const hoy = `${ahora.year}-${String(ahora.month).padStart(2, "0")}-${String(ahora.day).padStart(2, "0")}`;
  const minutosAhora = ahora.hour * 60 + ahora.minute;

  return slots.filter(s => {
    if (!disponibles.has(s)) return false;
    if (dateISO !== hoy) return true;
    const [h, mn] = s.split(":").map(Number);
    return h * 60 + mn > minutosAhora;
  });
}
