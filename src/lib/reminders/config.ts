// Recordatorios automáticos de citas — config por clínica + render de plantilla.
//
// La config vive en Clinic.reminderSettings (Json). Si es null se deriva de los
// campos legacy (waReminderActive / waReminder24h / waReminder1h / waReminderMsg)
// para que las clínicas que ya configuraron sus toggles en /dashboard/whatsapp
// conserven exactamente ese comportamiento cuando el cron se active.
//
// Los recordatorios usan el canal WhatsApp de la clínica (Meta Cloud API) y/o
// email (Resend). NUNCA pasan por el bot IA: no gastan tokens ni cuentan para
// el tope diario del bot.

export type ReminderChannel = "whatsapp" | "email" | "both";

export interface ReminderSettings {
  enabled: boolean;
  /** Minutos antes de la cita en que se manda cada recordatorio (orden desc). */
  offsets: number[];
  channel: ReminderChannel;
  /** Plantilla con variables {paciente} {clinica} {fecha} {hora} {doctor} {link}. */
  template: string;
}

/** Momentos seleccionables en la UI (minutos antes de la cita). */
export const ALLOWED_REMINDER_OFFSETS = [2880, 1440, 240, 120, 60] as const;

/** Default del feature: 24h y 2h antes. */
export const DEFAULT_REMINDER_OFFSETS = [1440, 120];

export const DEFAULT_REMINDER_TEMPLATE =
  "Hola {paciente} 👋, te recordamos tu cita en *{clinica}* el *{fecha}* a las *{hora}*.\n\n" +
  "Te atiende: {doctor}\n\n" +
  "Confirma tu asistencia aquí: {link}\n" +
  "También puedes responder *CONFIRMAR* o *CANCELAR* a este mensaje.";

const MAX_TEMPLATE_LEN = 1500;

/** Tipo de WhatsAppReminder que usa el encolador automático (dedup + routing). */
export const APPT_AUTO_TYPE = "APPT_AUTO";

/** Payload Json que viaja en WhatsAppReminder para filas APPT_AUTO. */
export interface ApptAutoPayload {
  kind: "APPT_AUTO";
  offsetMin: number;
  channel: "whatsapp" | "email";
  confirmUrl: string;
  /** Solo canal email. */
  subject?: string;
}

/** Llave de idempotencia: jamás dos recordatorios para la misma cita+momento+canal. */
export function dedupeKey(appointmentId: string, offsetMin: number, channel: string): string {
  return `${appointmentId}|${offsetMin}|${channel}`;
}

interface ClinicReminderFields {
  reminderSettings?: unknown;
  waReminderActive?: boolean | null;
  waReminder24h?: boolean | null;
  waReminder1h?: boolean | null;
  waReminderMsg?: string | null;
}

/**
 * Config efectiva de la clínica. Prioridad: reminderSettings (Json) válido;
 * si no existe, fallback a los toggles legacy de /dashboard/whatsapp.
 */
export function getEffectiveReminderSettings(clinic: ClinicReminderFields): ReminderSettings {
  const parsed = sanitizeReminderSettings(clinic.reminderSettings);
  if (parsed) return parsed;

  const offsets: number[] = [];
  if (clinic.waReminder24h ?? true) offsets.push(1440);
  if (clinic.waReminder1h) offsets.push(60);
  return {
    enabled: (clinic.waReminderActive ?? true) && offsets.length > 0,
    offsets,
    channel: "whatsapp",
    template: (clinic.waReminderMsg || "").trim() || DEFAULT_REMINDER_TEMPLATE,
  };
}

/**
 * Valida/normaliza un reminderSettings crudo (Json de DB o body de PATCH).
 * Devuelve null si la forma no es válida (el caller decide fallback o 400).
 */
export function sanitizeReminderSettings(raw: unknown): ReminderSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.offsets)) return null;
  const allowed = ALLOWED_REMINDER_OFFSETS as readonly number[];
  const offsets = Array.from(
    new Set(
      o.offsets
        .map((n) => (typeof n === "number" ? Math.round(n) : NaN))
        .filter((n) => Number.isFinite(n) && allowed.includes(n)),
    ),
  )
    .sort((a, b) => b - a)
    .slice(0, 4);

  const channel: ReminderChannel =
    o.channel === "email" || o.channel === "both" ? o.channel : "whatsapp";

  const template =
    typeof o.template === "string" && o.template.trim()
      ? o.template.trim().slice(0, MAX_TEMPLATE_LEN)
      : DEFAULT_REMINDER_TEMPLATE;

  return { enabled: o.enabled === true, offsets, channel, template };
}

export interface ReminderTemplateVars {
  paciente: string;
  clinica: string;
  fecha: string;
  hora: string;
  doctor: string;
  link: string;
}

/**
 * Sustituye variables de la plantilla. Soporta alias legacy ({nombre},
 * {clinicName}, {doctorName}). Si la plantilla no incluye {link}, lo agrega
 * al final para que el paciente siempre pueda confirmar sin login.
 */
export function renderReminderTemplate(template: string, vars: ReminderTemplateVars): string {
  let body = template
    .replaceAll("{paciente}", vars.paciente)
    .replaceAll("{nombre}", vars.paciente)
    .replaceAll("{clinica}", vars.clinica)
    .replaceAll("{clinicName}", vars.clinica)
    .replaceAll("{fecha}", vars.fecha)
    .replaceAll("{hora}", vars.hora)
    .replaceAll("{doctor}", vars.doctor)
    .replaceAll("{doctorName}", vars.doctor)
    .replaceAll("{link}", vars.link);
  if (vars.link && !body.includes(vars.link)) {
    body += `\n\nConfirma tu asistencia aquí: ${vars.link}`;
  }
  return body.trim();
}

/** Fecha y hora locales de la clínica (es-MX), mismo patrón que el queue-worker. */
export function formatApptDateParts(
  startsAt: Date,
  timezone: string,
): { fecha: string; hora: string } {
  const fecha = new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(startsAt);
  const hora = new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startsAt);
  return { fecha, hora };
}

/** URL pública de confirmación para un confirmToken. */
export function getConfirmUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com").replace(
    /\/+$/,
    "",
  );
  return `${base}/cita/${token}/confirmar`;
}
