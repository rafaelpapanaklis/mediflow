// ═══════════════════════════════════════════════════════════════════════════
// Soporte de AFILIADOS — capa de servicio (SERVER ONLY).
//
// Espejo de src/lib/support/service.ts (soporte de clínicas), pero sobre las
// tablas propias affiliate_support_tickets / affiliate_support_messages. Es un
// módulo APARTE a propósito: el de clínicas está en producción y acoplado a
// clinicId de punta a punta; tocarlo para meter afiliados arriesgaría soporte.
//
// Reglas de la casa (idénticas a las del de clínicas):
//  · AISLAMIENTO ESTRICTO: toda lectura/escritura del lado afiliado filtra por
//    affiliateId. El affiliateId lo pone SIEMPRE la sesión, nunca el request.
//  · Las NOTAS INTERNAS se filtran en el `where` de Prisma, no en el .map():
//    así jamás salen del servidor aunque alguien cambie el mapper.
//  · Texto plano sanitizado (nada de HTML crudo) y acotado por los topes de
//    types.ts.
//  · Sin transacciones interactivas (PgBouncer): los writes compuestos usan
//    nested writes de Prisma.
//  · Las LECTURAS degradan si la tabla aún no existe (SQL sin aplicar) →
//    [] / null / 0. Las ESCRITURAS sí lanzan AffiliateSupportError.
//
// ⚠️ ADJUNTOS FUERA DE ESTA OLA: el bucket `affiliate-support` todavía no
// existe en Supabase (se crea a mano). El campo `attachments` viaja en los DTO
// pero SIEMPRE vacío: aquí no se sube nada ni se firman URLs. Cuando exista el
// bucket, este es el único archivo que necesita el validador anti cross-tenant
// (ver affiliateAttachmentPrefix en types.ts) y el firmado por lote.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import {
  AffiliateSupportError,
  formatAffiliateFolio,
  AFFILIATE_SUPPORT_CATEGORIES,
  AFFILIATE_SUPPORT_PRIORITIES,
  AFFILIATE_SUPPORT_STATUSES,
  AFFILIATE_SUPPORT_OPEN_STATUSES,
  AFFILIATE_SUPPORT_STATUS_LABELS_ADMIN,
  AFFILIATE_SUPPORT_MAX_BODY_CHARS,
  AFFILIATE_SUPPORT_MAX_SUBJECT_CHARS,
  type AffiliateTicketSummary,
  type AdminAffiliateTicketSummary,
  type AffiliateSupportMessageDTO,
  type AffiliateTicketDetailDTO,
  type AdminAffiliateTicketDetailDTO,
  type AffiliateSupportAdminMetrics,
} from "./types";

/** Tope de mensajes que viajan en un hilo (afiliado / admin). */
const THREAD_TAKE_AFFILIATE = 500;
const THREAD_TAKE_ADMIN = 1000;
/** Tope de filas del listado admin (el filtro `q` acota lo demás). */
const ADMIN_LIST_TAKE = 300;
/** Tope de filas del listado del afiliado. */
const AFFILIATE_LIST_TAKE = 200;
/** Nombre visible por defecto de quien responde desde soporte. */
const DEFAULT_SUPPORT_AUTHOR = "Soporte DaleControl";

// ── Sanitización (texto plano, sin HTML crudo) ──────────────────────────────

/**
 * Quita los caracteres de control C0 y DEL conservando tabulador y salto de
 * línea. Va por código y no por una regex con escapes: un literal de control
 * dentro del fuente se corrompe con demasiada facilidad al reeditar el archivo.
 */
function stripControlChars(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 9 || code === 10) { out += input[i]; continue; } // tabulador y salto sí
    if (code < 32 || code === 127) continue;                      // el resto de controles no
    out += input[i];
  }
  return out;
}

/** Texto plano: normaliza saltos, quita controles y acota al tope. */
export function sanitizeAffiliateSupportText(input: unknown, maxLen: number): string {
  const raw = typeof input === "string" ? input : "";
  return stripControlChars(raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
    .trim()
    .slice(0, maxLen);
}

function assertCategory(value: string): void {
  if (!(AFFILIATE_SUPPORT_CATEGORIES as readonly string[]).includes(value)) {
    throw new AffiliateSupportError("Categoría inválida", 400);
  }
}
function assertPriority(value: string): void {
  if (!(AFFILIATE_SUPPORT_PRIORITIES as readonly string[]).includes(value)) {
    throw new AffiliateSupportError("Prioridad inválida", 400);
  }
}
function assertStatus(value: string): void {
  if (!(AFFILIATE_SUPPORT_STATUSES as readonly string[]).includes(value)) {
    throw new AffiliateSupportError("Estado inválido", 400);
  }
}

/**
 * Una LECTURA que truena (tabla aún sin crear, BD caída…) no puede tumbar el
 * panel: se loguea y se devuelve el vacío. Mismo criterio que
 * getAccountManagerForClinic — "sin tickets" es un estado válido de pantalla.
 */
function degrade<T>(scope: string, err: unknown, fallback: T): T {
  console.warn(`[affiliate-support] ${scope} degradado:`, err);
  return fallback;
}

/**
 * Las ESCRITURAS sí fallan de cara a quien las pide, pero un esquema sin
 * migrar (P2021 tabla ausente / P2022 columna ausente) no es un "error
 * interno": es el módulo todavía sin activar. Se traduce a 503 para que la UI
 * diga algo útil en vez de un 500 mudo.
 */
function rethrowWriteError(err: unknown): never {
  if (err instanceof AffiliateSupportError) throw err;
  const code = (err as any)?.code;
  if (code === "P2021" || code === "P2022") {
    throw new AffiliateSupportError(
      "El soporte a afiliados aún no está activado. Inténtalo más tarde.",
      503,
    );
  }
  throw err;
}

// ── Mapeos a DTO ────────────────────────────────────────────────────────────

type TicketRow = {
  id: string;
  folio: number;
  affiliateId: string;
  createdById: string | null;
  createdByName: string | null;
  subject: string;
  category: string;
  priority: string;
  status: string;
  rating: number | null;
  firstResponseAt: Date | null;
  lastAffiliateMessageAt: Date | null;
  lastSupportMessageAt: Date | null;
  affiliateUnread: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: string;
  ticketId: string;
  authorType: string;
  authorName: string | null;
  body: string;
  internalNote: boolean;
  createdAt: Date;
};

function lastActivityAt(t: TicketRow): Date {
  const times = [t.createdAt, t.lastAffiliateMessageAt, t.lastSupportMessageAt]
    .filter(Boolean)
    .map((d) => (d as Date).getTime());
  return new Date(Math.max.apply(null, times));
}

/**
 * Regla ÚNICA de "espera respuesta de soporte", solo sobre las 2 fechas: nadie
 * respondió aún, o el afiliado habló al último. El estado lo filtra quien
 * llama (where de Prisma o `affiliateIsWaiting`).
 */
function awaitingSupportReply(t: {
  lastAffiliateMessageAt: Date | null;
  lastSupportMessageAt: Date | null;
}): boolean {
  if (!t.lastSupportMessageAt) return true;
  if (!t.lastAffiliateMessageAt) return false;
  return t.lastAffiliateMessageAt.getTime() > t.lastSupportMessageAt.getTime();
}

/** La pelota está del lado de soporte y el ticket sigue abierto. */
function affiliateIsWaiting(t: TicketRow): boolean {
  if (!(AFFILIATE_SUPPORT_OPEN_STATUSES as readonly string[]).includes(t.status)) return false;
  return awaitingSupportReply(t);
}

function toSummary(t: TicketRow): AffiliateTicketSummary {
  return {
    id: t.id,
    folio: t.folio,
    folioLabel: formatAffiliateFolio(t.folio),
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    rating: t.rating,
    affiliateUnread: t.affiliateUnread,
    lastActivityAt: lastActivityAt(t).toISOString(),
    createdAt: t.createdAt.toISOString(),
  };
}

function toAdminSummary(t: TicketRow, affiliateName: string): AdminAffiliateTicketSummary {
  const needsReply = affiliateIsWaiting(t);
  const since = t.lastAffiliateMessageAt ?? t.createdAt;
  return {
    ...toSummary(t),
    affiliateId: t.affiliateId,
    affiliateName,
    createdByName: t.createdByName,
    needsReply,
    waitingHours: needsReply
      ? Math.round(((Date.now() - since.getTime()) / 36e5) * 10) / 10
      : null,
  };
}

/**
 * Mensajes → DTO. `attachments` va SIEMPRE vacío en esta ola (ver la nota de
 * adjuntos arriba): no hay bucket, así que no hay nada que firmar.
 */
function toMessageDTOs(messages: MessageRow[]): AffiliateSupportMessageDTO[] {
  return messages.map((m) => ({
    id: m.id,
    ticketId: m.ticketId,
    authorType: (m.authorType as AffiliateSupportMessageDTO["authorType"]) ?? "system",
    authorName: m.authorName,
    body: m.body,
    attachments: [],
    internalNote: m.internalNote,
    createdAt: m.createdAt.toISOString(),
  }));
}

/** Nombres de afiliados por id, en un solo query (para la bandeja admin). */
async function getAffiliateNameMap(affiliateIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(affiliateIds));
  if (unique.length === 0) return new Map();
  const rows = await prisma.affiliate.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((a) => [a.id, a.name]));
}

// ════════════════════════════════════════════════════════════════════════════
// LADO AFILIADO — el affiliateId viene SIEMPRE de getAffiliateContext()
// ════════════════════════════════════════════════════════════════════════════

/** Tickets del afiliado. Aislamiento: `where: { affiliateId }`, sin excepción. */
export async function listAffiliateTickets(affiliateId: string): Promise<AffiliateTicketSummary[]> {
  if (!affiliateId) return [];
  try {
    const tickets = await prisma.affiliateSupportTicket.findMany({
      where: { affiliateId },
      orderBy: { updatedAt: "desc" },
      take: AFFILIATE_LIST_TAKE,
    });
    return (tickets as TicketRow[])
      .map(toSummary)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  } catch (err) {
    return degrade("listAffiliateTickets", err, [] as AffiliateTicketSummary[]);
  }
}

/**
 * Detalle para el afiliado. Dos candados:
 *  1. `where: { id: ticketId, affiliateId }` → un ticket de OTRO afiliado
 *     devuelve null, y el route lo traduce a 404 (nunca 403: un 403
 *     confirmaría que el ticket existe).
 *  2. `messages.where.internalNote = false` → las notas internas de soporte se
 *     descartan EN LA CONSULTA; no viajan al servidor de render siquiera.
 *
 * Lectura PURA: marcar como leído es explícito (markTicketReadByAffiliate),
 * porque el badge "respuesta nueva" lo consume la lista y el PATCH del route.
 */
export async function getTicketForAffiliate(
  affiliateId: string,
  ticketId: string,
): Promise<AffiliateTicketDetailDTO | null> {
  if (!affiliateId || !ticketId) return null;
  try {
    const ticket = await prisma.affiliateSupportTicket.findFirst({
      where: { id: ticketId, affiliateId },
      include: {
        messages: {
          where: { internalNote: false }, // las notas internas JAMÁS llegan aquí
          orderBy: { createdAt: "asc" },
          take: THREAD_TAKE_AFFILIATE,
        },
      },
    });
    if (!ticket) return null;
    return {
      ticket: toSummary(ticket as unknown as TicketRow),
      messages: toMessageDTOs(ticket.messages as unknown as MessageRow[]),
    };
  } catch (err) {
    return degrade("getTicketForAffiliate", err, null);
  }
}

export interface CreateAffiliateTicketInput {
  subject: string;
  category: string;
  priority: string;
  body: string;
  /** AffiliateUser.id de quien lo abrió (sin FK: el ticket le sobrevive). */
  createdById?: string | null;
  createdByName?: string | null;
}

/** Crea ticket + primer mensaje (nested write, sin transacción interactiva). */
export async function createAffiliateTicket(
  affiliateId: string,
  input: CreateAffiliateTicketInput,
): Promise<AffiliateTicketSummary> {
  if (!affiliateId) throw new AffiliateSupportError("Afiliado no válido", 400);

  const subject = sanitizeAffiliateSupportText(input.subject, AFFILIATE_SUPPORT_MAX_SUBJECT_CHARS);
  const body = sanitizeAffiliateSupportText(input.body, AFFILIATE_SUPPORT_MAX_BODY_CHARS);
  if (!subject) throw new AffiliateSupportError("El asunto es obligatorio", 400);
  if (!body) throw new AffiliateSupportError("La descripción es obligatoria", 400);

  const category = typeof input.category === "string" && input.category ? input.category : "DUDA";
  const priority = typeof input.priority === "string" && input.priority ? input.priority : "NORMAL";
  assertCategory(category);
  assertPriority(priority);

  const authorName = sanitizeAffiliateSupportText(input.createdByName ?? "", 120) || null;
  const now = new Date();

  try {
    const ticket = await prisma.affiliateSupportTicket.create({
      data: {
        affiliateId,
        createdById: input.createdById ?? null,
        createdByName: authorName,
        subject,
        category,
        priority,
        status: "ABIERTO",
        lastAffiliateMessageAt: now,
        messages: {
          create: {
            authorType: "affiliate",
            authorId: input.createdById ?? null,
            authorName,
            body,
          },
        },
      },
    });
    return toSummary(ticket as unknown as TicketRow);
  } catch (err) {
    return rethrowWriteError(err);
  }
}

export interface AddAffiliateSupportMessageInput {
  body: string;
  /** Quién habla. El route del afiliado FUERZA "affiliate". */
  authorType: "affiliate" | "support" | "system";
  /** Solo tiene efecto con authorType="support" (nota interna del admin). */
  internalNote?: boolean;
  authorId?: string | null;
  authorName?: string | null;
}

/**
 * Agrega un mensaje al hilo y mueve los campos de estado/métricas.
 *
 * NO recibe affiliateId a propósito (el admin también la usa): quien llama del
 * lado AFILIADO debe haber comprobado antes la propiedad del ticket con
 * getTicketForAffiliate — así el aislamiento vive en un solo lugar.
 *
 *  · afiliado → lastAffiliateMessageAt; si estaba ESPERANDO_RESPUESTA o
 *    RESUELTO, reabre a ABIERTO. Con el ticket CERRADO responde 409.
 *  · soporte (público) → firstResponseAt (si estaba vacío),
 *    lastSupportMessageAt, affiliateUnread=true y ABIERTO/EN_PROGRESO pasa a
 *    ESPERANDO_RESPUESTA.
 *  · soporte (NOTA INTERNA) → NO toca nada de lo anterior: solo agrega el
 *    mensaje. No es una respuesta, así que no reinicia relojes ni avisa.
 *  · system → solo agrega el mensaje.
 */
export async function addAffiliateSupportMessage(
  ticketId: string,
  input: AddAffiliateSupportMessageInput,
): Promise<AffiliateSupportMessageDTO> {
  const authorType = input.authorType;
  if (authorType !== "affiliate" && authorType !== "support" && authorType !== "system") {
    throw new AffiliateSupportError("Autor inválido", 400);
  }

  const ticket = await prisma.affiliateSupportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AffiliateSupportError("Ticket no encontrado", 404);

  const body = sanitizeAffiliateSupportText(input.body, AFFILIATE_SUPPORT_MAX_BODY_CHARS);
  if (!body) throw new AffiliateSupportError("El mensaje no puede estar vacío", 400);

  // Una nota interna solo existe del lado de soporte: si llegara marcada desde
  // cualquier otro autor se ignora (el afiliado NUNCA puede crear notas).
  const internalNote = authorType === "support" && Boolean(input.internalNote);

  const now = new Date();
  let ticketPatch: Record<string, unknown> = {};

  if (authorType === "affiliate") {
    if (ticket.status === "CERRADO") {
      throw new AffiliateSupportError(
        "El ticket está cerrado. Crea un ticket nuevo si necesitas más ayuda.",
        409,
      );
    }
    const reopened = ticket.status === "ESPERANDO_RESPUESTA" || ticket.status === "RESUELTO";
    ticketPatch = {
      lastAffiliateMessageAt: now,
      ...(reopened ? { status: "ABIERTO" } : {}),
    };
  } else if (authorType === "support" && !internalNote) {
    ticketPatch = {
      firstResponseAt: ticket.firstResponseAt ?? now,
      lastSupportMessageAt: now,
      affiliateUnread: true,
      ...(ticket.status === "ABIERTO" || ticket.status === "EN_PROGRESO"
        ? { status: "ESPERANDO_RESPUESTA" }
        : {}),
    };
  }

  const defaultName = authorType === "support" ? DEFAULT_SUPPORT_AUTHOR : null;
  const authorName = sanitizeAffiliateSupportText(input.authorName ?? "", 120) || defaultName;

  try {
    const updated = await prisma.affiliateSupportTicket.update({
      where: { id: ticket.id },
      data: {
        ...ticketPatch,
        messages: {
          create: {
            authorType,
            authorId: input.authorId ?? null,
            authorName,
            body,
            internalNote,
          },
        },
      },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    const [message] = toMessageDTOs(updated.messages as unknown as MessageRow[]);
    return message;
  } catch (err) {
    return rethrowWriteError(err);
  }
}

/**
 * Apaga el badge "respuesta nueva". `updateMany` con where compuesto
 * { id, affiliateId }: si el ticket es de otro afiliado actualiza 0 filas y no
 * revela nada. Es un efecto de UI: si falla, se loguea y ya.
 */
export async function markTicketReadByAffiliate(
  affiliateId: string,
  ticketId: string,
): Promise<void> {
  if (!affiliateId || !ticketId) return;
  try {
    await prisma.affiliateSupportTicket.updateMany({
      where: { id: ticketId, affiliateId, affiliateUnread: true },
      data: { affiliateUnread: false },
    });
  } catch (err) {
    degrade("markTicketReadByAffiliate", err, undefined);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LADO ADMIN (DaleControl) — los routes del admin ya validaron la sesión
// ════════════════════════════════════════════════════════════════════════════

export interface AdminAffiliateTicketFilters {
  /** Estado exacto, o "OPEN" como pseudo-valor = cualquiera de los abiertos. */
  status?: string | null;
  category?: string | null;
  priority?: string | null;
  affiliateId?: string | null;
  /** "#AF-0012" / "AF12" / "12" → folio; si no, contains en el asunto. */
  q?: string | null;
}

export async function listAdminAffiliateTickets(
  filters: AdminAffiliateTicketFilters,
): Promise<AdminAffiliateTicketSummary[]> {
  try {
    const where: any = {};
    if (filters.status === "OPEN") where.status = { in: [...AFFILIATE_SUPPORT_OPEN_STATUSES] };
    else if (filters.status) {
      assertStatus(filters.status);
      where.status = filters.status;
    }
    if (filters.category) {
      assertCategory(filters.category);
      where.category = filters.category;
    }
    if (filters.priority) {
      assertPriority(filters.priority);
      where.priority = filters.priority;
    }
    if (filters.affiliateId) where.affiliateId = filters.affiliateId;
    if (filters.q) {
      const q = String(filters.q).trim();
      const folioMatch = q.match(/^#?\s*(?:AF-?)?(\d{1,9})$/i);
      if (folioMatch) where.folio = parseInt(folioMatch[1], 10);
      else where.subject = { contains: q, mode: "insensitive" };
    }

    const tickets = await prisma.affiliateSupportTicket.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: ADMIN_LIST_TAKE,
    });
    const nameMap = await getAffiliateNameMap(tickets.map((t) => t.affiliateId));
    return (tickets as TicketRow[])
      .map((t) => toAdminSummary(t, nameMap.get(t.affiliateId) ?? "Afiliado eliminado"))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  } catch (err) {
    // Un filtro inválido SÍ debe verse como 400 en el admin; el resto degrada.
    if (err instanceof AffiliateSupportError) throw err;
    return degrade("listAdminAffiliateTickets", err, [] as AdminAffiliateTicketSummary[]);
  }
}

/** Detalle admin: hilo COMPLETO (incluye notas internas) + datos del afiliado. */
export async function getAffiliateTicketForAdmin(
  ticketId: string,
): Promise<AdminAffiliateTicketDetailDTO | null> {
  if (!ticketId) return null;
  try {
    const ticket = await prisma.affiliateSupportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: "asc" }, take: THREAD_TAKE_ADMIN } },
    });
    if (!ticket) return null;

    const affiliate = await prisma.affiliate.findUnique({
      where: { id: ticket.affiliateId },
      select: { name: true, email: true },
    });

    return {
      ticket: {
        ...toAdminSummary(ticket as unknown as TicketRow, affiliate?.name ?? "Afiliado eliminado"),
        affiliateEmail: affiliate?.email ?? null,
        firstResponseAt: ticket.firstResponseAt ? ticket.firstResponseAt.toISOString() : null,
        closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
      },
      messages: toMessageDTOs(ticket.messages as unknown as MessageRow[]),
    };
  } catch (err) {
    return degrade("getAffiliateTicketForAdmin", err, null);
  }
}

/**
 * Cambio de estado por soporte. IDEMPOTENTE: si ya está en ese estado no
 * escribe ni ensucia el hilo con un mensaje repetido. Al cambiar deja un
 * mensaje `system` y enciende el badge del afiliado.
 */
export async function changeAffiliateTicketStatus(
  ticketId: string,
  status: string,
): Promise<AdminAffiliateTicketSummary> {
  assertStatus(status);
  const ticket = await prisma.affiliateSupportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AffiliateSupportError("Ticket no encontrado", 404);

  if (ticket.status === status) {
    const nameMap = await getAffiliateNameMap([ticket.affiliateId]);
    return toAdminSummary(
      ticket as unknown as TicketRow,
      nameMap.get(ticket.affiliateId) ?? "Afiliado",
    );
  }

  const label = AFFILIATE_SUPPORT_STATUS_LABELS_ADMIN[status] ?? status;
  const updated = await prisma.affiliateSupportTicket.update({
    where: { id: ticket.id },
    data: {
      status,
      affiliateUnread: true,
      closedAt: status === "CERRADO" ? new Date() : ticket.closedAt,
      messages: {
        create: {
          authorType: "system",
          body: `Soporte cambió el estado a "${label}"`,
        },
      },
    },
  });

  const nameMap = await getAffiliateNameMap([updated.affiliateId]);
  return toAdminSummary(
    updated as unknown as TicketRow,
    nameMap.get(updated.affiliateId) ?? "Afiliado",
  );
}

/** Cambio de prioridad (silencioso: sin mensaje en el hilo ni badge). */
export async function changeAffiliateTicketPriority(
  ticketId: string,
  priority: string,
): Promise<AdminAffiliateTicketSummary> {
  assertPriority(priority);
  const ticket = await prisma.affiliateSupportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AffiliateSupportError("Ticket no encontrado", 404);

  const updated = await prisma.affiliateSupportTicket.update({
    where: { id: ticket.id },
    data: { priority },
  });
  const nameMap = await getAffiliateNameMap([updated.affiliateId]);
  return toAdminSummary(
    updated as unknown as TicketRow,
    nameMap.get(updated.affiliateId) ?? "Afiliado",
  );
}

/** Mini-métricas de la bandeja admin de afiliados. */
export async function getAffiliateSupportAdminMetrics(): Promise<AffiliateSupportAdminMetrics> {
  const empty: AffiliateSupportAdminMetrics = {
    open: 0,
    pendingReply: 0,
    unanswered24h: 0,
    avgFirstResponseHours: null,
    avgRating: null,
    ratedCount: 0,
  };

  try {
    const [openTickets, ratingAgg, firstResponses] = await Promise.all([
      prisma.affiliateSupportTicket.findMany({
        where: { status: { in: [...AFFILIATE_SUPPORT_OPEN_STATUSES] } },
        select: {
          status: true,
          createdAt: true,
          lastAffiliateMessageAt: true,
          lastSupportMessageAt: true,
        },
        take: 2000,
      }),
      prisma.affiliateSupportTicket.aggregate({
        _avg: { rating: true },
        _count: { rating: true },
        where: { rating: { not: null } },
      }),
      prisma.affiliateSupportTicket.findMany({
        where: { firstResponseAt: { not: null } },
        select: { createdAt: true, firstResponseAt: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);

    // Una sola pasada para las 2 métricas de espera: `pendingReply` = todos los
    // que esperan; `unanswered24h` = los que además ya pasaron las 24 h.
    const cutoff = Date.now() - 24 * 36e5;
    const waiting = openTickets.filter(awaitingSupportReply);
    const unanswered24h = waiting.filter((t) => {
      const since = t.lastAffiliateMessageAt ?? t.createdAt;
      return since.getTime() < cutoff;
    }).length;

    let avgFirstResponseHours: number | null = null;
    if (firstResponses.length > 0) {
      const totalH = firstResponses.reduce(
        (acc, t) => acc + (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 36e5,
        0,
      );
      avgFirstResponseHours = Math.round((totalH / firstResponses.length) * 10) / 10;
    }

    const avgRating =
      ratingAgg._avg.rating != null ? Math.round(ratingAgg._avg.rating * 10) / 10 : null;

    return {
      open: openTickets.length,
      pendingReply: waiting.length,
      unanswered24h,
      avgFirstResponseHours,
      avgRating,
      ratedCount: ratingAgg._count.rating ?? 0,
    };
  } catch (err) {
    return degrade("getAffiliateSupportAdminMetrics", err, empty);
  }
}

/**
 * Tickets abiertos que esperan respuesta de soporte — badge del sidebar admin.
 * MISMA regla que `unanswered24h` pero SIN el corte de 24 h. Nunca lanza: un
 * fallo de BD devuelve 0 en vez de tumbar el panel entero.
 */
export async function countAffiliateSupportPendingReply(): Promise<number> {
  try {
    const openTickets = await prisma.affiliateSupportTicket.findMany({
      where: { status: { in: [...AFFILIATE_SUPPORT_OPEN_STATUSES] } },
      select: { lastAffiliateMessageAt: true, lastSupportMessageAt: true },
    });
    return openTickets.filter(awaitingSupportReply).length;
  } catch {
    return 0;
  }
}
