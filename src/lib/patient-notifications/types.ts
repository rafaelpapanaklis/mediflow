// Tipos y validación PUROS del centro de notificaciones del paciente.
// Sin imports de servidor (Prisma) → se puede importar desde el cliente (la
// página /paciente/notificaciones) sin arrastrar el cliente de Prisma al bundle.

// ── Preferencias de recordatorio del paciente ────────────────────────────────
export type NotifChannel = "whatsapp" | "email" | "both";
/** Anticipación en minutos. Coincide con offsets del cron de recordatorios. */
export type NotifLeadMinutes = 1440 | 120; // 24h | 2h

export interface NotifPrefs {
  channel: NotifChannel;
  leadMinutes: NotifLeadMinutes;
}

/** Valor mostrado en la UI cuando aún no hay override guardado. */
export const DEFAULT_NOTIF_PREFS: NotifPrefs = { channel: "both", leadMinutes: 1440 };

export const NOTIF_CHANNELS: NotifChannel[] = ["whatsapp", "email", "both"];
export const NOTIF_LEADS: NotifLeadMinutes[] = [1440, 120];

/**
 * Valida un valor crudo (de la BD o de un request) a NotifPrefs, o null si no
 * es un override válido. null = "usar la configuración de la clínica".
 */
export function parseNotifPrefs(raw: unknown): NotifPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const channel = r.channel;
  const leadRaw = r.leadMinutes;
  const lead = typeof leadRaw === "number" ? leadRaw : Number(leadRaw);
  if (typeof channel !== "string" || !NOTIF_CHANNELS.includes(channel as NotifChannel)) {
    return null;
  }
  if (!NOTIF_LEADS.includes(lead as NotifLeadMinutes)) return null;
  return { channel: channel as NotifChannel, leadMinutes: lead as NotifLeadMinutes };
}

// ── DTOs del portal (respuestas de /api/paciente/notificaciones) ──────────────
export interface PacienteNotificacion {
  id: string;
  /** "APPOINTMENT_REMINDER" | "APPOINTMENT_CHANGE" | "MESSAGE" */
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string; // ISO
}

export interface PacienteNotificacionesResponse {
  notifications: PacienteNotificacion[];
  unreadCount: number;
}
