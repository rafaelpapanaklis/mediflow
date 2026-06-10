// ═══════════════════════════════════════════════════════════════════════════
// Soporte Técnico — tipos y constantes compartidos (CONTRATO).
// Cliente-seguro: NO importar prisma ni nada server-only aquí; lo consumen
// páginas "use client", API routes y el service por igual.
// Los valores de categoría/prioridad/estado se guardan como String en DB
// (modelos SupportTicket/SupportMessage al final de prisma/schema.prisma).
// ═══════════════════════════════════════════════════════════════════════════

export const SUPPORT_CATEGORIES = ["BUG", "DUDA", "FACTURACION", "SUGERENCIA"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = ["BAJA", "NORMAL", "ALTA", "URGENTE"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_STATUSES = [
  "ABIERTO",
  "EN_PROGRESO",
  "ESPERANDO_RESPUESTA", // soporte respondió; espera a la clínica
  "RESUELTO",
  "CERRADO",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Estados que cuentan como "abiertos" para métricas y contadores. */
export const SUPPORT_OPEN_STATUSES = ["ABIERTO", "EN_PROGRESO", "ESPERANDO_RESPUESTA"] as const;

export const SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  BUG: "Error / Bug",
  DUDA: "Duda",
  FACTURACION: "Facturación",
  SUGERENCIA: "Sugerencia",
};

export const SUPPORT_PRIORITY_LABELS: Record<string, string> = {
  BAJA: "Baja",
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente",
};

/** Labels para la clínica ("Esperando tu respuesta" = la pelota es de ella). */
export const SUPPORT_STATUS_LABELS_CLINIC: Record<string, string> = {
  ABIERTO: "Abierto",
  EN_PROGRESO: "En progreso",
  ESPERANDO_RESPUESTA: "Esperando tu respuesta",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};

/** Labels para el panel admin de DaleControl. */
export const SUPPORT_STATUS_LABELS_ADMIN: Record<string, string> = {
  ABIERTO: "Abierto",
  EN_PROGRESO: "En progreso",
  ESPERANDO_RESPUESTA: "Esperando a la clínica",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};

// Topes de adjuntos y texto (validados server-side en service/routes).
export const SUPPORT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB por archivo
export const SUPPORT_MAX_FILES_PER_MESSAGE = 5;
export const SUPPORT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
export const SUPPORT_MAX_BODY_CHARS = 5000;
export const SUPPORT_MAX_SUBJECT_CHARS = 200;

/** Folio corto visible: 1 → "#DC-0001". */
export function formatFolio(folio: number): string {
  return `#DC-${String(folio).padStart(4, "0")}`;
}

/** Adjunto de un mensaje. En DB se guarda { path, name, size, type } (Json);
 *  `signedUrl` se agrega al vuelo en los GET (TTL corto, bucket privado). */
export interface SupportAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
  signedUrl?: string;
}

export type SupportAuthorType = "clinic" | "support" | "system";

// ── DTOs que devuelven los endpoints (fechas como ISO string) ──────────────

export interface SupportTicketSummary {
  id: string;
  folio: number;
  folioLabel: string; // "#DC-0001"
  subject: string;
  category: string;
  priority: string;
  status: string;
  rating: number | null;
  clinicUnread: boolean; // true → badge "respuesta nueva" en la lista de la clínica
  lastActivityAt: string; // max(lastClinicMessageAt, lastSupportMessageAt, createdAt)
  createdAt: string;
}

export interface AdminTicketSummary extends SupportTicketSummary {
  clinicId: string;
  clinicName: string;
  createdByName: string | null;
  needsReply: boolean; // la última palabra la tiene la clínica (o nadie respondió aún)
  waitingHours: number | null; // horas esperando respuesta de soporte (null si no aplica)
}

export interface SupportMessageDTO {
  id: string;
  ticketId: string;
  authorType: SupportAuthorType;
  authorName: string | null;
  body: string;
  attachments: SupportAttachment[];
  internalNote: boolean; // SIEMPRE false en respuestas para la clínica
  createdAt: string;
}

export interface SupportTicketDetailDTO {
  ticket: SupportTicketSummary;
  messages: SupportMessageDTO[];
}

export interface AdminTicketDetailDTO {
  ticket: AdminTicketSummary & {
    clinicEmail: string | null;
    createdByEmail: string | null;
    firstResponseAt: string | null;
    closedAt: string | null;
  };
  messages: SupportMessageDTO[]; // incluye internalNote=true (solo admin)
}

export interface SupportAdminMetrics {
  open: number; // tickets en SUPPORT_OPEN_STATUSES
  unanswered24h: number; // abiertos con la clínica esperando >24h
  avgFirstResponseHours: number | null; // promedio de primera respuesta (últimos 200)
  avgRating: number | null; // promedio de rating 1-5
  ratedCount: number;
}

/** Error de validación/permiso que los routes mapean a HTTP (400/403/404/409). */
export class SupportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupportError";
    this.status = status;
  }
}
