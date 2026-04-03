import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/google/callback`
  );
}

export function getAuthUrl(userId: string) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: userId,
  });
}

export async function createCalendarEvent(
  accessToken: string,
  refreshToken: string,
  appt: {
    id: string;
    type: string;
    date: string;
    startTime: string;
    endTime: string;
    patientName: string;
    clinicName: string;
    clinicAddress?: string | null;
    notes?: string | null;
    doctorEmail?: string | null;
    patientEmail?: string | null;
  }
): Promise<string | null> {
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Build datetime strings (Mexico City timezone)
    const tz = "America/Mexico_City";
    const dateStr = appt.date.split("T")[0];
    const startDT = `${dateStr}T${appt.startTime}:00`;
    const endDT   = `${dateStr}T${appt.endTime}:00`;

    const attendees: { email: string }[] = [];
    if (appt.doctorEmail) attendees.push({ email: appt.doctorEmail });
    if (appt.patientEmail) attendees.push({ email: appt.patientEmail });

    const event = await calendar.events.insert({
      calendarId: "primary",
      sendUpdates: "all",
      requestBody: {
        summary:     `🏥 ${appt.type} — ${appt.patientName}`,
        description: [
          `Clínica: ${appt.clinicName}`,
          `Paciente: ${appt.patientName}`,
          `Tipo: ${appt.type}`,
          appt.notes ? `Notas: ${appt.notes}` : "",
          `\nAgendado desde MediFlow`,
        ].filter(Boolean).join("\n"),
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
        colorId: "2", // Sage green
      },
    });

    return event.data.id ?? null;
  } catch (err) {
    console.error("Google Calendar error:", err);
    return null;
  }
}

export async function deleteCalendarEvent(
  accessToken: string,
  refreshToken: string,
  googleEventId: string
): Promise<void> {
  try {
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    await calendar.events.delete({ calendarId: "primary", eventId: googleEventId, sendUpdates: "all" });
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
