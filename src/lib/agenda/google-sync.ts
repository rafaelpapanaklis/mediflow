import { prisma } from "@/lib/prisma";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  refreshAccessToken,
  getOrCreateClinicCalendar,
} from "@/lib/google-calendar";

interface ClinicGcalState {
  name: string;
  address: string | null;
  timezone: string;
  googleCalendarEnabled: boolean;
  googleCalendarToken: string | null;
  googleRefreshToken: string | null;
  googleClinicCalendarId: string | null;
}

async function loadClinicGcal(clinicId: string): Promise<ClinicGcalState | null> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      name: true, address: true, timezone: true,
      googleCalendarEnabled: true, googleCalendarToken: true,
      googleRefreshToken: true, googleClinicCalendarId: true,
    },
  });
  return clinic as ClinicGcalState | null;
}

async function ensureAccessToken(clinicId: string, gcal: ClinicGcalState): Promise<string | null> {
  if (gcal.googleCalendarToken) return gcal.googleCalendarToken;
  if (!gcal.googleRefreshToken) return null;
  const token = await refreshAccessToken(gcal.googleRefreshToken);
  if (token) {
    await prisma.clinic.update({
      where: { id: clinicId },
      data: { googleCalendarToken: token },
    });
  }
  return token;
}

async function ensureCalendarId(clinicId: string, gcal: ClinicGcalState, token: string): Promise<string> {
  if (gcal.googleClinicCalendarId) return gcal.googleClinicCalendarId;
  try {
    const calId = await getOrCreateClinicCalendar(token, gcal.googleRefreshToken!, gcal.name);
    if (calId) {
      await prisma.clinic.update({
        where: { id: clinicId },
        data: { googleClinicCalendarId: calId },
      });
      return calId;
    }
  } catch (err) {
    console.error("Error creating clinic calendar:", err);
  }
  return "primary";
}

export interface AppointmentSyncData {
  id: string;
  type: string;
  startsAt: Date;
  endsAt: Date;
  patientName: string;
  doctorName: string | null;
  doctorEmail: string | null;
  patientEmail: string | null;
  notes: string | null;
}

/** Crea evento en Google Calendar y persiste googleCalendarEventId. Best-effort. */
export async function syncCreateToGoogleCalendar(clinicId: string, data: AppointmentSyncData): Promise<void> {
  try {
    const gcal = await loadClinicGcal(clinicId);
    if (!gcal?.googleCalendarEnabled || !gcal.googleRefreshToken) return;
    const token = await ensureAccessToken(clinicId, gcal);
    if (!token) return;
    const calendarId = await ensureCalendarId(clinicId, gcal, token);
    const eventId = await createCalendarEvent(token, gcal.googleRefreshToken, {
      id: data.id, type: data.type,
      startsAt: data.startsAt, endsAt: data.endsAt,
      clinicTimezone: gcal.timezone,
      patientName: data.patientName,
      clinicName: gcal.name, clinicAddress: gcal.address,
      notes: data.notes,
      doctorName: data.doctorName,
      doctorEmail: data.doctorEmail,
      patientEmail: data.patientEmail,
      calendarId,
    });
    if (eventId) {
      await prisma.appointment.update({
        where: { id: data.id },
        data: { googleCalendarEventId: eventId },
      });
    }
  } catch (err) {
    console.error("Google Calendar create sync failed:", err);
  }
}

/** Actualiza evento existente. Best-effort. */
export async function syncUpdateToGoogleCalendar(clinicId: string, eventId: string, data: Omit<AppointmentSyncData, "patientEmail">): Promise<void> {
  try {
    const gcal = await loadClinicGcal(clinicId);
    if (!gcal?.googleCalendarEnabled || !gcal.googleRefreshToken) return;
    const token = await ensureAccessToken(clinicId, gcal);
    if (!token) return;
    await updateCalendarEvent(token, gcal.googleRefreshToken, eventId, {
      type: data.type,
      startsAt: data.startsAt, endsAt: data.endsAt,
      clinicTimezone: gcal.timezone,
      patientName: data.patientName,
      clinicName: gcal.name, clinicAddress: gcal.address,
      notes: data.notes,
      doctorName: data.doctorName,
      calendarId: gcal.googleClinicCalendarId ?? "primary",
    });
  } catch (err) {
    console.error("Google Calendar update sync failed:", err);
  }
}

/** Elimina evento. Best-effort. */
export async function syncDeleteFromGoogleCalendar(clinicId: string, eventId: string): Promise<void> {
  try {
    const gcal = await loadClinicGcal(clinicId);
    if (!gcal?.googleCalendarEnabled || !gcal.googleRefreshToken) return;
    const token = await ensureAccessToken(clinicId, gcal);
    if (!token) return;
    await deleteCalendarEvent(token, gcal.googleRefreshToken, eventId, gcal.googleClinicCalendarId ?? "primary");
  } catch (err) {
    console.error("Google Calendar delete sync failed:", err);
  }
}
