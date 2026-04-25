import { google } from "googleapis";
import crypto from "crypto";
import { rfc3339InTz } from "@/lib/agenda/legacy-helpers";

// FIX: openid + email required so Google returns id_token with user email
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",        // create/manage calendars
  "https://www.googleapis.com/auth/calendar.events", // create/update events
];

const STATE_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "mediflow-gcal-state";

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/google/callback`
  );
}

/** Sign the userId so the callback can verify it without needing a session cookie */
export function signState(userId: string): string {
  const hmac = crypto.createHmac("sha256", STATE_SECRET).update(userId).digest("hex").slice(0, 16);
  return `${userId}.${hmac}`;
}

/** Verify and extract userId from signed state */
export function verifyState(state: string): string | null {
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const userId = state.substring(0, dotIdx);
  const hmac = state.substring(dotIdx + 1);
  if (!userId || !hmac) return null;
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(userId).digest("hex").slice(0, 16);
  if (hmac !== expected) return null;
  return userId;
}

export function getAuthUrl(userId: string) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt:      "consent",
    scope:       SCOPES,
    state:       signState(userId),
  });
}

/**
 * Creates or finds an existing calendar with the clinic name.
 * Returns the calendarId of the clinic calendar.
 */
export async function getOrCreateClinicCalendar(
  accessToken: string,
  refreshToken: string,
  clinicName: string
): Promise<string | null> {
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Check if clinic calendar already exists
    const listRes = await calendar.calendarList.list();
    const existing = listRes.data.items?.find(
      c => c.summary === clinicName || c.description?.includes("MediFlow-clinic")
    );
    if (existing?.id) return existing.id;

    // Create new calendar for the clinic
    const newCal = await calendar.calendars.insert({
      requestBody: {
        summary:     clinicName,
        description: `Agenda de ${clinicName} — MediFlow-clinic`,
        timeZone:    "America/Mexico_City",
      },
    });

    const calendarId = newCal.data.id ?? null;

    // Set a distinct color (blue) for the clinic calendar
    if (calendarId) {
      await calendar.calendarList.patch({
        calendarId,
        requestBody: { colorId: "9" }, // blue
      });
    }

    return calendarId;
  } catch (err) {
    console.error("Error creating clinic calendar:", err);
    return null;
  }
}

/**
 * Creates an event in the specified calendar (defaults to primary).
 * For clinic calendar: pass the clinic calendarId.
 * For doctor personal: pass "primary".
 */
export async function createCalendarEvent(
  accessToken: string,
  refreshToken: string,
  appt: {
    id: string;
    type: string;
    startsAt: Date;
    endsAt: Date;
    clinicTimezone: string;
    patientName: string;
    clinicName: string;
    clinicAddress?: string | null;
    notes?: string | null;
    doctorName?: string | null;
    doctorEmail?: string | null;
    patientEmail?: string | null;
    calendarId?: string; // target calendar — defaults to "primary"
  }
): Promise<string | null> {
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const tz      = appt.clinicTimezone;
    const startDT = rfc3339InTz(appt.startsAt, tz);
    const endDT   = rfc3339InTz(appt.endsAt, tz);

    const attendees: { email: string }[] = [];
    if (appt.doctorEmail)  attendees.push({ email: appt.doctorEmail  });
    if (appt.patientEmail) attendees.push({ email: appt.patientEmail });

    const descLines = [
      `Paciente: ${appt.patientName}`,
      `Tipo: ${appt.type}`,
      appt.doctorName ? `Doctor/a: ${appt.doctorName}` : "",
      appt.notes ? `Notas: ${appt.notes}` : "",
      `\nAgendado desde MediFlow`,
    ].filter(Boolean).join("\n");

    const event = await calendar.events.insert({
      calendarId:  appt.calendarId ?? "primary",
      sendUpdates: attendees.length > 0 ? "all" : "none",
      requestBody: {
        summary:     `🏥 ${appt.type} — ${appt.patientName}`,
        description: descLines,
        location:    appt.clinicAddress ?? appt.clinicName,
        start:       { dateTime: startDT, timeZone: tz },
        end:         { dateTime: endDT,   timeZone: tz },
        attendees,
        reminders: {
          useDefault: false,
          overrides: [
            { method: "email", minutes: 24 * 60 },
            { method: "popup", minutes: 30 },
          ],
        },
        colorId: "2", // sage green
      },
    });

    return event.data.id ?? null;
  } catch (err) {
    console.error("Google Calendar createEvent error:", err);
    return null;
  }
}

export async function updateCalendarEvent(
  accessToken: string,
  refreshToken: string,
  googleEventId: string,
  appt: {
    type: string;
    startsAt: Date;
    endsAt: Date;
    clinicTimezone: string;
    patientName: string;
    clinicName: string;
    clinicAddress?: string | null;
    notes?: string | null;
    doctorName?: string | null;
    calendarId?: string;
  }
): Promise<boolean> {
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const tz      = appt.clinicTimezone;
    const startDT = rfc3339InTz(appt.startsAt, tz);
    const endDT   = rfc3339InTz(appt.endsAt, tz);

    const descLines = [
      `Paciente: ${appt.patientName}`,
      `Tipo: ${appt.type}`,
      appt.doctorName ? `Doctor/a: ${appt.doctorName}` : "",
      appt.notes ? `Notas: ${appt.notes}` : "",
      `\nAgendado desde MediFlow`,
    ].filter(Boolean).join("\n");

    await calendar.events.update({
      calendarId: appt.calendarId ?? "primary",
      eventId:    googleEventId,
      requestBody: {
        summary:     `🏥 ${appt.type} — ${appt.patientName}`,
        description: descLines,
        location:    appt.clinicAddress ?? appt.clinicName,
        start:       { dateTime: startDT, timeZone: tz },
        end:         { dateTime: endDT,   timeZone: tz },
        colorId: "2",
      },
    });
    return true;
  } catch (err) {
    console.error("Google Calendar updateEvent error:", err);
    return false;
  }
}

export async function deleteCalendarEvent(
  accessToken: string,
  refreshToken: string,
  googleEventId: string,
  calendarId = "primary"
): Promise<void> {
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    await calendar.events.delete({
      calendarId,
      eventId:     googleEventId,
      sendUpdates: "all",
    });
  } catch (err) {
    console.error("Error deleting Google Calendar event:", err);
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    return credentials.access_token ?? null;
  } catch {
    return null;
  }
}
