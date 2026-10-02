// ═══════════════════════════════════════════════════════════════════════════
// Reseñas verificadas del directorio — tipos y constantes compartidos (CONTRATO).
// Cliente-seguro: NO importar prisma ni nada server-only aquí. Lo consumen
// páginas "use client", API routes y el service (src/lib/reviews/service.ts).
// Estados/valores se guardan como String en DB (modelo ClinicReview, al final
// de prisma/schema.prisma; tabla clinic_reviews vía sql/resenas.sql).
// ═══════════════════════════════════════════════════════════════════════════

export const REVIEW_STATUS = {
  PENDING: "pending", // invitada, sin enviar
  PUBLISHED: "published", // enviada y visible
  HIDDEN: "hidden", // ocultada por moderación admin
} as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];

/**
 * `invitedChannels` es `String[]` ("whatsapp", "email"). Junto a "whatsapp" se
 * guarda `wamid:<id>`, el id del mensaje de Meta, SIN columna nueva: es lo que
 * deja cruzar la invitación con su entrega real (inbox_messages.deliveryStatus).
 * Nadie más lee este arreglo; los canales siguen siendo los de siempre.
 */
const PREFIJO_WAMID = "wamid:";
export function marcaDeWamid(wamid: string): string {
  return `${PREFIJO_WAMID}${wamid}`;
}
export function wamidDeCanales(canales: readonly string[] | null | undefined): string | null {
  const m = (canales ?? []).find((c) => c.startsWith(PREFIJO_WAMID));
  return m ? m.slice(PREFIJO_WAMID.length) || null : null;
}

/** Reseñas por página en el perfil público y en los paneles. */
export const REVIEW_PAGE_SIZE = 8;

/** Vigencia del link de invitación (un solo uso). */
export const REVIEW_TOKEN_TTL_DAYS = 30;

/** Endpoints públicos consumidos desde el cliente. */
export const DIRECTORY_REVIEWS_API = "/api/directory/reviews";
export const REVIEW_REPORT_API = "/api/directory/reviews/report";

/** Topes de texto (validados server-side). */
export const REVIEW_MAX_COMMENT_CHARS = 600;
export const REVIEW_MAX_RESPONSE_CHARS = 600;
export const REVIEW_MAX_REPORT_REASON_CHARS = 300;

export const REVIEW_MIN_RATING = 1;
export const REVIEW_MAX_RATING = 5;

// ── DTOs (fechas como ISO string) ──────────────────────────────────────────

/** Reseña pública (perfil de la clínica). Sin datos sensibles. */
export interface PublicReviewDTO {
  id: string;
  authorName: string; // "María G."
  rating: number; // 1-5
  comment: string | null;
  createdAt: string; // ISO — fecha en que el paciente la dejó
  response: string | null; // respuesta de la clínica
  respondedAt: string | null;
}

/** Resumen agregado de calificaciones de una clínica. */
export interface ReviewSummary {
  /** Promedio 1-5 con 1 decimal (0 si no hay reseñas). */
  avg: number;
  /** Total de reseñas publicadas. */
  count: number;
  /** Conteo por estrella: distribution[5] = nº de reseñas de 5★. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface PublicReviewsResponse {
  items: PublicReviewDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: ReviewSummary;
}

/** Reseña vista por la clínica (su propio panel). Incluye estado y reporte. */
export interface ClinicReviewDTO {
  id: string;
  authorName: string;
  rating: number | null;
  comment: string | null;
  status: ReviewStatus;
  response: string | null;
  respondedAt: string | null;
  reported: boolean;
  createdAt: string;
  submittedAt: string | null;
}

/** Reseña vista por el admin de DaleControl (incluye la clínica dueña). */
export interface AdminReviewDTO extends ClinicReviewDTO {
  clinicId: string;
  clinicName: string;
  clinicSlug: string;
  reportedReason: string | null;
  reportedAt: string | null;
}

/** Cómo va una invitación de reseña, según la entrega REAL (no según «la API la aceptó»). */
export type EstadoInvitacion =
  | "enviada" // la API la aceptó, Meta aún no reporta entrega (o fue por correo)
  | "entregada"
  | "vista"
  | "fallo" // Meta la rechazó (p. ej. 131026: el número no tiene WhatsApp)
  | "sin_enviar"; // ningún canal la aceptó (sin plantilla, sin conexión…)

export interface InvitacionResenaDTO {
  id: string;
  authorName: string;
  createdAt: string;
  estado: EstadoInvitacion;
  /** Clave del motivo del fallo (ver reminder-error.ts), o null. */
  motivo: string | null;
  /** También salió por correo: el fallo de WhatsApp no deja al paciente sin invitación. */
  porCorreo: boolean;
}

export interface ClinicReviewsResponse {
  items: ClinicReviewDTO[];
  /** Invitaciones pendientes recientes (solo en la página 1). */
  invitaciones?: InvitacionResenaDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: ReviewSummary;
}

export interface AdminReviewsResponse {
  items: AdminReviewDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Lo que /resena/[token] necesita pintar el formulario (datos públicos). */
export interface ReviewInviteView {
  clinicName: string;
  clinicSlug: string;
  logoUrl: string | null;
  themeColor: string | null;
  /** "ok" → mostrar formulario. El resto → mensaje correspondiente. */
  state: "ok" | "submitted" | "expired" | "invalid";
  doctorName: string | null;
  serviceName: string | null;
}

// ── Portal del paciente: calificar visitas (post-cita) ─────────────────────

/**
 * Una cita COMPLETADA del paciente y, si existe, el estado de su reseña.
 * `status` null = aún no hay fila de reseña; `rating`/`comment` solo si ya la
 * calificó. La UI antepone "Dr(a)." a `doctorName`.
 */
export interface PatientReviewItemDTO {
  appointmentId: string;
  clinicId: string;
  clinicName: string;
  clinicSlug: string;
  doctorName: string;
  type: string;
  date: string; // ISO (startsAt)
  rating: number | null;
  comment: string | null;
  status: ReviewStatus | null;
}

/**
 * GET /api/paciente/resenas → visitas por calificar (`pending`) y ya calificadas
 * (`done`). El portal solo necesita `pending` para la tarjeta; `done` cubre el
 * "saber qué citas ya tienen reseña".
 */
export interface PatientReviewablesResponse {
  pending: PatientReviewItemDTO[];
  done: PatientReviewItemDTO[];
}

// ── Helpers cliente-seguros ────────────────────────────────────────────────

/** "María" + "López Hernández" → "María L." (privacidad estilo Doctoralia). */
export function buildAuthorName(firstName: string, lastName: string): string {
  const first = (firstName ?? "").trim().split(/\s+/)[0] || "";
  const lastInitial = (lastName ?? "").trim().charAt(0).toUpperCase();
  if (!first) return "Paciente";
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

/** Clampa a entero 1-5; null si no es válido. */
export function clampRating(n: unknown): number | null {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < REVIEW_MIN_RATING || v > REVIEW_MAX_RATING) return null;
  return v;
}

/** Promedio a 1 decimal. */
export function roundAvg(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 10) / 10;
}

/** "2026-06-10T…" → "junio 2026" (es-MX) para mostrar fecha de reseña. */
/** «Octubre de 2026»: solo la primera letra en mayúscula (el `capitalize` de CSS ponía «Octubre De 2026»). */
export function formatReviewDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const t = d.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  } catch {
    return "";
  }
}

/**
 * «2 de octubre de 2026» (o «October 2, 2026»): la lista de «Invitaciones enviadas» (últimos 30
 * días) necesita el día. `idioma` es el de la interfaz (`useLocale()`: «es», «en», «es-MX»…);
 * sin él, español de México como siempre.
 */
export function formatInvitationDate(iso: string, idioma?: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const intl = idioma?.toLowerCase().startsWith("en") ? "en-US" : "es-MX";
    return d.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

/** Error de validación/permiso que los routes mapean a HTTP (400/403/404/409/410). */
export class ReviewError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReviewError";
    this.status = status;
  }
}
