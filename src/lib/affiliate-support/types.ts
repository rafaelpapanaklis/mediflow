// Soporte de AFILIADOS — tipos y constantes compartidos (CONTRATO).
// Cliente-seguro: NO importar prisma ni nada server-only aquí.
//
// Espejo de src/lib/support/types.ts (soporte de clínicas). Es un módulo
// APARTE, no un import de aquel, porque el de clínicas está acoplado a
// clinicId de punta a punta —incluidos los adjuntos, con prefijo
// support/{clinicId}/— y tocarlo para meter afiliados arriesgaría soporte en
// producción. Las tablas también son propias: affiliate_support_tickets y
// affiliate_support_messages.

/// Categorías del afiliado. NO son las de la clínica (BUG/DUDA/FACTURACION/
/// SUGERENCIA): un afiliado no reporta bugs del expediente, pregunta por su
/// dinero y por su material de venta.
export const AFFILIATE_SUPPORT_CATEGORIES = [
  "COMISIONES",
  "PAGOS",
  "MATERIAL",
  "CUENTA",
  "DUDA",
] as const;
export type AffiliateSupportCategory = (typeof AFFILIATE_SUPPORT_CATEGORIES)[number];

export const AFFILIATE_SUPPORT_PRIORITIES = ["BAJA", "NORMAL", "ALTA", "URGENTE"] as const;
export type AffiliateSupportPriority = (typeof AFFILIATE_SUPPORT_PRIORITIES)[number];

export const AFFILIATE_SUPPORT_STATUSES = [
  "ABIERTO",
  "EN_PROGRESO",
  "ESPERANDO_RESPUESTA", // soporte respondió; espera al afiliado
  "RESUELTO",
  "CERRADO",
] as const;
export type AffiliateSupportStatus = (typeof AFFILIATE_SUPPORT_STATUSES)[number];

/** Estados que cuentan como "abiertos" para métricas y contadores. */
export const AFFILIATE_SUPPORT_OPEN_STATUSES = [
  "ABIERTO",
  "EN_PROGRESO",
  "ESPERANDO_RESPUESTA",
] as const;

export const AFFILIATE_SUPPORT_CATEGORY_LABELS: Record<string, string> = {
  COMISIONES: "Comisiones",
  PAGOS: "Pagos",
  MATERIAL: "Material de venta",
  CUENTA: "Mi cuenta",
  DUDA: "Duda",
};

export const AFFILIATE_SUPPORT_PRIORITY_LABELS: Record<string, string> = {
  BAJA: "Baja",
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente",
};

/// Mismo estado, dos redacciones: al afiliado se le dice "esperando tu
/// respuesta"; al admin, "esperando al afiliado".
export const AFFILIATE_SUPPORT_STATUS_LABELS_AFFILIATE: Record<string, string> = {
  ABIERTO: "Abierto",
  EN_PROGRESO: "En progreso",
  ESPERANDO_RESPUESTA: "Esperando tu respuesta",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};

export const AFFILIATE_SUPPORT_STATUS_LABELS_ADMIN: Record<string, string> = {
  ABIERTO: "Abierto",
  EN_PROGRESO: "En progreso",
  ESPERANDO_RESPUESTA: "Esperando al afiliado",
  RESUELTO: "Resuelto",
  CERRADO: "Cerrado",
};

export const AFFILIATE_SUPPORT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB por archivo
export const AFFILIATE_SUPPORT_MAX_FILES_PER_MESSAGE = 5;
export const AFFILIATE_SUPPORT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
export const AFFILIATE_SUPPORT_MAX_BODY_CHARS = 5000;
export const AFFILIATE_SUPPORT_MAX_SUBJECT_CHARS = 200;

/** Bucket de adjuntos. Prefijo por afiliado: se valida en el SERVIDOR que el
 *  archivo pertenezca a ESE afiliado, igual que validateAttachmentsMeta hace
 *  con clinicId en el soporte de clínicas. */
export const AFFILIATE_SUPPORT_BUCKET = "affiliate-support";
export function affiliateAttachmentPrefix(affiliateId: string): string {
  return `${AFFILIATE_SUPPORT_BUCKET}/${affiliateId}/`;
}

/** Folio corto visible: 1 → "#AF-0001". Serie propia, independiente de los
 *  #DC-XXXX de las clínicas. */
export function formatAffiliateFolio(folio: number): string {
  return `#AF-${String(folio).padStart(4, "0")}`;
}

export interface AffiliateSupportAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
  signedUrl?: string;
}

export type AffiliateSupportAuthorType = "affiliate" | "support" | "system";

export interface AffiliateTicketSummary {
  id: string;
  folio: number;
  folioLabel: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  rating: number | null;
  /** Hay respuesta que el afiliado no ha visto. */
  affiliateUnread: boolean;
  lastActivityAt: string;
  createdAt: string;
}

export interface AdminAffiliateTicketSummary extends AffiliateTicketSummary {
  affiliateId: string;
  affiliateName: string;
  createdByName: string | null;
  needsReply: boolean;
  waitingHours: number | null;
}

export interface AffiliateSupportMessageDTO {
  id: string;
  ticketId: string;
  authorType: AffiliateSupportAuthorType;
  authorName: string | null;
  body: string;
  attachments: AffiliateSupportAttachment[];
  /** SIEMPRE false en las respuestas que ve el afiliado: el service filtra las
   *  notas internas ANTES de serializar. */
  internalNote: boolean;
  createdAt: string;
}

export interface AffiliateTicketDetailDTO {
  ticket: AffiliateTicketSummary;
  messages: AffiliateSupportMessageDTO[]; // SIN notas internas
}

export interface AdminAffiliateTicketDetailDTO {
  ticket: AdminAffiliateTicketSummary & {
    affiliateEmail: string | null;
    firstResponseAt: string | null;
    closedAt: string | null;
  };
  messages: AffiliateSupportMessageDTO[]; // incluye internalNote=true (solo admin)
}

export interface AffiliateSupportAdminMetrics {
  open: number;
  pendingReply: number;
  unanswered24h: number;
  avgFirstResponseHours: number | null;
  avgRating: number | null;
  ratedCount: number;
}

/** Error de validación/permiso que los routes mapean a HTTP (400/403/404/409). */
export class AffiliateSupportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AffiliateSupportError";
    this.status = status;
  }
}
