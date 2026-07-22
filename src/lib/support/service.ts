// ═══════════════════════════════════════════════════════════════════════════
// Soporte Técnico — capa de servicio (SERVER ONLY).
// TODA la lógica de tickets pasa por aquí: los API routes solo resuelven la
// sesión, validan params y delegan. Implementación actual: Prisma.
//
// Zendesk-ready: los puntos marcados con "ZENDESK:" son los únicos lugares
// donde se conectaría el adapter externo (src/lib/support/zendesk-adapter.ts)
// guardando/usando `SupportTicket.externalId`. Ver docs/SOPORTE_ZENDESK.md.
//
// Reglas de la casa: multi-tenant estricto (todo query de clínica filtra por
// clinicId), texto plano sanitizado (nada de HTML crudo), Promise.all ≤ 7,
// sin transacciones interactivas (PgBouncer) — los writes compuestos usan
// nested writes de Prisma.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { signMaybeUrls } from "@/lib/storage";
import {
  notifyNewTicket,
  notifyClinicReply,
  notifySupportReply,
  notifyStatusChange,
} from "./notifications";
import {
  SupportError,
  formatFolio,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  SUPPORT_OPEN_STATUSES,
  SUPPORT_MAX_BODY_CHARS,
  SUPPORT_MAX_SUBJECT_CHARS,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_ALLOWED_MIME,
  type SupportAttachment,
  type SupportTicketSummary,
  type AdminTicketSummary,
  type SupportMessageDTO,
  type SupportTicketDetailDTO,
  type AdminTicketDetailDTO,
  type SupportAdminMetrics,
} from "./types";

/** TTL de las signed URLs de adjuntos al verlas en el hilo (1 hora). */
const ATTACHMENT_URL_TTL_SECONDS = 3600;

/** Prefijo de paths de adjuntos en el bucket privado patient-files. */
export function supportAttachmentPrefix(clinicId: string): string {
  return `support/${clinicId}/`;
}

// ── Sanitización (texto plano, sin HTML crudo) ──────────────────────────────

/** Texto plano: quita chars de control (excepto \n y \t), normaliza saltos. */
export function sanitizeSupportText(input: unknown, maxLen: number): string {
  const raw = typeof input === "string" ? input : "";
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

function assertCategory(value: string): void {
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(value)) {
    throw new SupportError("Categoría inválida");
  }
}
function assertPriority(value: string): void {
  if (!(SUPPORT_PRIORITIES as readonly string[]).includes(value)) {
    throw new SupportError("Prioridad inválida");
  }
}
function assertStatus(value: string): void {
  if (!(SUPPORT_STATUSES as readonly string[]).includes(value)) {
    throw new SupportError("Estado inválido");
  }
}

/**
 * Valida metadatos de adjuntos que manda el cliente tras subirlos vía
 * POST /api/support/attachments. Anti cross-tenant: el path DEBE vivir bajo
 * support/{clinicId}/ — así una clínica no puede referenciar archivos ajenos.
 */
export function validateAttachmentsMeta(input: unknown, clinicId: string): SupportAttachment[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new SupportError("Adjuntos inválidos");
  if (input.length > SUPPORT_MAX_FILES_PER_MESSAGE) {
    throw new SupportError(`Máximo ${SUPPORT_MAX_FILES_PER_MESSAGE} adjuntos por mensaje`);
  }
  const prefix = supportAttachmentPrefix(clinicId);
  return input.map((item) => {
    const a = item as Partial<SupportAttachment> | null;
    if (!a || typeof a.path !== "string" || !a.path.startsWith(prefix) || a.path.includes("..")) {
      throw new SupportError("Adjunto inválido");
    }
    if (typeof a.type !== "string" || !(SUPPORT_ALLOWED_MIME as readonly string[]).includes(a.type)) {
      throw new SupportError("Tipo de adjunto no permitido");
    }
    const size = typeof a.size === "number" ? a.size : 0;
    if (size <= 0 || size > SUPPORT_MAX_FILE_BYTES) {
      throw new SupportError("Adjunto demasiado grande (máx 5MB)");
    }
    const name = sanitizeSupportText(a.name ?? "archivo", 120) || "archivo";
    return { path: a.path, name, size, type: a.type };
  });
}

// ── Mapeos a DTO ────────────────────────────────────────────────────────────

type TicketRow = {
  id: string;
  folio: number;
  clinicId: string;
  createdById: string;
  createdByName: string | null;
  subject: string;
  category: string;
  priority: string;
  status: string;
  rating: number | null;
  firstResponseAt: Date | null;
  lastClinicMessageAt: Date | null;
  lastSupportMessageAt: Date | null;
  clinicUnread: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function lastActivityAt(t: TicketRow): Date {
  const times = [t.createdAt, t.lastClinicMessageAt, t.lastSupportMessageAt]
    .filter(Boolean)
    .map((d) => (d as Date).getTime());
  return new Date(Math.max(...times));
}

/** La pelota está del lado de soporte (nadie respondió aún o la clínica habló al último). */
function clinicIsWaiting(t: TicketRow): boolean {
  if (!(SUPPORT_OPEN_STATUSES as readonly string[]).includes(t.status)) return false;
  if (!t.lastSupportMessageAt) return true;
  if (!t.lastClinicMessageAt) return false;
  return t.lastClinicMessageAt.getTime() > t.lastSupportMessageAt.getTime();
}

function toSummary(t: TicketRow): SupportTicketSummary {
  return {
    id: t.id,
    folio: t.folio,
    folioLabel: formatFolio(t.folio),
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    rating: t.rating,
    clinicUnread: t.clinicUnread,
    lastActivityAt: lastActivityAt(t).toISOString(),
    createdAt: t.createdAt.toISOString(),
  };
}

function toAdminSummary(t: TicketRow, clinicName: string): AdminTicketSummary {
  const needsReply = clinicIsWaiting(t);
  const since = t.lastClinicMessageAt ?? t.createdAt;
  return {
    ...toSummary(t),
    clinicId: t.clinicId,
    clinicName,
    createdByName: t.createdByName,
    needsReply,
    waitingHours: needsReply
      ? Math.round(((Date.now() - since.getTime()) / 36e5) * 10) / 10
      : null,
  };
}

function parseAttachments(raw: unknown): SupportAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: any) => a && typeof a.path === "string")
    .map((a: any) => ({
      path: String(a.path),
      name: typeof a.name === "string" ? a.name : "archivo",
      size: typeof a.size === "number" ? a.size : 0,
      type: typeof a.type === "string" ? a.type : "application/octet-stream",
    }));
}

type MessageRow = {
  id: string;
  ticketId: string;
  authorType: string;
  authorName: string | null;
  body: string;
  attachments: unknown;
  internalNote: boolean;
  createdAt: Date;
};

/** Convierte mensajes a DTO firmando TODOS los adjuntos en un solo batch. */
async function toMessageDTOs(messages: MessageRow[]): Promise<SupportMessageDTO[]> {
  const parsed = messages.map((m) => ({ m, atts: parseAttachments(m.attachments) }));
  const allPaths: string[] = [];
  parsed.forEach((p) => p.atts.forEach((a) => allPaths.push(a.path)));

  let urls: string[] = [];
  if (allPaths.length > 0) {
    // Un solo round-trip a Supabase (createSignedUrls interno) — no N×.
    urls = await signMaybeUrls(allPaths, ATTACHMENT_URL_TTL_SECONDS);
  }
  let cursor = 0;
  return parsed.map(({ m, atts }) => ({
    id: m.id,
    ticketId: m.ticketId,
    authorType: (m.authorType as SupportMessageDTO["authorType"]) ?? "system",
    authorName: m.authorName,
    body: m.body,
    attachments: atts.map((a) => ({ ...a, signedUrl: urls[cursor++] || undefined })),
    internalNote: m.internalNote,
    createdAt: m.createdAt.toISOString(),
  }));
}

function bodyPreview(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 300);
}

async function getClinicNameMap(clinicIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(clinicIds));
  if (unique.length === 0) return new Map();
  const clinics = await prisma.clinic.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(clinics.map((c) => [c.id, c.name]));
}

async function getCreatorEmail(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// LADO CLÍNICA
// ════════════════════════════════════════════════════════════════════════════

export interface CreateTicketInput {
  clinicId: string;
  userId: string;
  userName?: string | null;
  subject: string;
  category: string;
  priority?: string;
  body: string;
  /** Metadatos devueltos por POST /api/support/attachments (sin signedUrl). */
  attachments?: unknown;
}

/** Crea ticket + primer mensaje (nested write, sin transacción interactiva). */
export async function createTicket(input: CreateTicketInput): Promise<SupportTicketSummary> {
  const subject = sanitizeSupportText(input.subject, SUPPORT_MAX_SUBJECT_CHARS);
  const body = sanitizeSupportText(input.body, SUPPORT_MAX_BODY_CHARS);
  if (!subject) throw new SupportError("El asunto es obligatorio");
  if (!body) throw new SupportError("La descripción es obligatoria");
  assertCategory(input.category);
  const priority = input.priority ?? "NORMAL";
  assertPriority(priority);
  const atts = validateAttachmentsMeta(input.attachments, input.clinicId);
  const userName = sanitizeSupportText(input.userName ?? "", 120) || null;

  const now = new Date();
  const ticket = await prisma.supportTicket.create({
    data: {
      clinicId: input.clinicId,
      createdById: input.userId,
      createdByName: userName,
      subject,
      category: input.category,
      priority,
      status: "ABIERTO",
      lastClinicMessageAt: now,
      messages: {
        create: {
          authorType: "clinic",
          authorId: input.userId,
          authorName: userName,
          body,
          attachments: atts.length ? (atts as any) : undefined,
        },
      },
    },
  });

  // ZENDESK: aquí el adapter crearía el ticket vía Requests API y se
  // persistiría `externalId`:
  //   const ext = await zendeskAdapter.createTicket({...});
  //   await prisma.supportTicket.update({ where: { id: ticket.id }, data: { externalId: ext.id } });

  const clinic = await prisma.clinic.findUnique({
    where: { id: input.clinicId },
    select: { name: true },
  });
  await notifyNewTicket({
    ticketId: ticket.id,
    folio: ticket.folio,
    subject,
    clinicName: clinic?.name ?? "Clínica",
    category: input.category,
    priority,
    bodyPreview: bodyPreview(body),
    authorName: userName,
  });

  return toSummary(ticket as TicketRow);
}

/** Lista de tickets de la clínica (multi-tenant estricto). */
export async function listClinicTickets(clinicId: string): Promise<SupportTicketSummary[]> {
  const tickets = await prisma.supportTicket.findMany({
    where: { clinicId },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return (tickets as TicketRow[])
    .map(toSummary)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/**
 * Detalle para la clínica: SIN notas internas, adjuntos firmados.
 * Side-effect: marca clinicUnread=false (la clínica ya vio las novedades).
 */
export async function getTicketForClinic(
  ticketId: string,
  clinicId: string,
): Promise<SupportTicketDetailDTO | null> {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, clinicId },
    include: {
      messages: {
        where: { internalNote: false }, // las notas internas JAMÁS llegan aquí
        orderBy: { createdAt: "asc" },
        take: 500,
      },
    },
  });
  if (!ticket) return null;

  if (ticket.clinicUnread) {
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { clinicUnread: false },
    });
    ticket.clinicUnread = false;
  }

  const messages = await toMessageDTOs(ticket.messages as MessageRow[]);
  return { ticket: toSummary(ticket as TicketRow), messages };
}

export interface AddClinicMessageInput {
  userId: string;
  userName?: string | null;
  body: string;
  attachments?: unknown;
}

/** Respuesta de la clínica en el hilo. Reabre si estaba RESUELTO/ESPERANDO. */
export async function addClinicMessage(
  ticketId: string,
  clinicId: string,
  input: AddClinicMessageInput,
): Promise<SupportMessageDTO> {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, clinicId },
  });
  if (!ticket) throw new SupportError("Ticket no encontrado", 404);
  if (ticket.status === "CERRADO") {
    throw new SupportError("El ticket está cerrado. Crea un ticket nuevo si necesitas más ayuda.", 409);
  }
  const body = sanitizeSupportText(input.body, SUPPORT_MAX_BODY_CHARS);
  if (!body) throw new SupportError("El mensaje no puede estar vacío");
  const atts = validateAttachmentsMeta(input.attachments, clinicId);
  const userName = sanitizeSupportText(input.userName ?? "", 120) || null;

  const now = new Date();
  const reopened = ticket.status === "ESPERANDO_RESPUESTA" || ticket.status === "RESUELTO";
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      lastClinicMessageAt: now,
      ...(reopened ? { status: "ABIERTO" } : {}),
      messages: {
        create: {
          authorType: "clinic",
          authorId: input.userId,
          authorName: userName,
          body,
          attachments: atts.length ? (atts as any) : undefined,
        },
      },
    },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  // ZENDESK: aquí el adapter agregaría el comentario al ticket externo
  // usando ticket.externalId (zendeskAdapter.addMessage(...)).

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { name: true },
  });
  await notifyClinicReply({
    ticketId: ticket.id,
    folio: ticket.folio,
    subject: ticket.subject,
    clinicName: clinic?.name ?? "Clínica",
    category: ticket.category,
    priority: ticket.priority,
    bodyPreview: bodyPreview(body),
    authorName: userName,
  });

  const [message] = await toMessageDTOs(updated.messages as MessageRow[]);
  return message;
}

/** La clínica cierra el ticket y (opcional) lo califica 1-5. */
export async function closeAndRateTicket(
  ticketId: string,
  clinicId: string,
  rating?: number | null,
): Promise<SupportTicketSummary> {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, clinicId },
  });
  if (!ticket) throw new SupportError("Ticket no encontrado", 404);
  if (ticket.status === "CERRADO") throw new SupportError("El ticket ya está cerrado", 409);

  let normalizedRating: number | null = null;
  if (rating != null) {
    const r = Math.round(Number(rating));
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      throw new SupportError("La calificación debe ser de 1 a 5");
    }
    normalizedRating = r;
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status: "CERRADO",
      rating: normalizedRating,
      closedAt: new Date(),
      clinicUnread: false,
      messages: {
        create: {
          authorType: "system",
          body: normalizedRating
            ? `La clínica cerró el ticket · Calificación: ${normalizedRating}/5`
            : "La clínica cerró el ticket",
        },
      },
    },
  });

  return toSummary(updated as TicketRow);
}

// ════════════════════════════════════════════════════════════════════════════
// LADO ADMIN (DaleControl) — los routes ya validaron isAdminAuthed()
// ════════════════════════════════════════════════════════════════════════════

export interface AdminTicketFilters {
  /** Estado exacto, o "OPEN" como pseudo-valor = cualquiera de los abiertos. */
  status?: string | null;
  category?: string | null;
  priority?: string | null;
  clinicId?: string | null;
  /** Búsqueda: "#DC-0012"/"12" → folio; si no, contains en asunto. */
  q?: string | null;
}

export async function listAdminTickets(filters: AdminTicketFilters): Promise<AdminTicketSummary[]> {
  const where: any = {};
  if (filters.status === "OPEN") where.status = { in: [...SUPPORT_OPEN_STATUSES] };
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
  if (filters.clinicId) where.clinicId = filters.clinicId;
  if (filters.q) {
    const q = filters.q.trim();
    const folioMatch = q.match(/^#?\s*(?:DC-?)?(\d{1,9})$/i);
    if (folioMatch) where.folio = parseInt(folioMatch[1], 10);
    else where.subject = { contains: q, mode: "insensitive" };
  }

  const tickets = await prisma.supportTicket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const nameMap = await getClinicNameMap(tickets.map((t) => t.clinicId));
  return (tickets as TicketRow[])
    .map((t) => toAdminSummary(t, nameMap.get(t.clinicId) ?? "Clínica eliminada"))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Detalle admin: hilo COMPLETO (incluye notas internas) + contexto de clínica. */
export async function getTicketForAdmin(ticketId: string): Promise<AdminTicketDetailDTO | null> {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 1000 } },
  });
  if (!ticket) return null;

  const [clinic, creatorEmail, messages] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ticket.clinicId },
      select: { name: true, email: true },
    }),
    getCreatorEmail(ticket.createdById),
    toMessageDTOs(ticket.messages as MessageRow[]),
  ]);

  return {
    ticket: {
      ...toAdminSummary(ticket as TicketRow, clinic?.name ?? "Clínica eliminada"),
      clinicEmail: clinic?.email ?? null,
      createdByEmail: creatorEmail,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
    },
    messages,
  };
}

export interface AddSupportMessageInput {
  body: string;
  internalNote?: boolean;
  /** Nombre visible del agente (default "Soporte DaleControl"). */
  authorName?: string | null;
  /** Metadatos devueltos por POST /api/admin/support/tickets/[id]/attachments
   *  (sin signedUrl). Se re-validan contra el clinicId del ticket. */
  attachments?: unknown;
}

/**
 * Respuesta de soporte (o nota interna). Respuesta pública: marca
 * firstResponseAt, clinicUnread, pasa a ESPERANDO_RESPUESTA y avisa por email
 * al creador. Nota interna: solo agrega el mensaje (la clínica nunca la ve).
 */
export async function addSupportMessage(
  ticketId: string,
  input: AddSupportMessageInput,
): Promise<SupportMessageDTO> {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new SupportError("Ticket no encontrado", 404);

  // Adjuntos: mismo validador anti cross-tenant que la clínica; el clinicId
  // sale del ticket cargado aquí, jamás del request.
  const atts = validateAttachmentsMeta(input.attachments, ticket.clinicId);
  // body puede venir vacío ("" — sanitizeSupportText ya normaliza) si el
  // mensaje lleva SOLO archivos.
  const body = sanitizeSupportText(input.body, SUPPORT_MAX_BODY_CHARS);
  if (!body && atts.length === 0) throw new SupportError("El mensaje no puede estar vacío");
  const internalNote = Boolean(input.internalNote);
  const authorName = sanitizeSupportText(input.authorName ?? "", 120) || "Soporte DaleControl";

  const now = new Date();
  const publicReplyData = internalNote
    ? {}
    : {
        firstResponseAt: ticket.firstResponseAt ?? now,
        lastSupportMessageAt: now,
        clinicUnread: true,
        ...(ticket.status === "ABIERTO" || ticket.status === "EN_PROGRESO"
          ? { status: "ESPERANDO_RESPUESTA" }
          : {}),
      };

  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      ...publicReplyData,
      messages: {
        create: {
          authorType: "support",
          authorName,
          body,
          attachments: atts.length ? (atts as any) : undefined,
          internalNote,
        },
      },
    },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  // ZENDESK: en modo integrado, la respuesta del agente normalmente ENTRA por
  // el webhook /api/webhooks/zendesk (no por aquí), o bien aquí se haría
  // zendeskAdapter.addMessage(ticket.externalId, ...) si se responde desde
  // el panel propio con Zendesk como espejo.

  if (!internalNote) {
    const [clinic, toEmail] = await Promise.all([
      prisma.clinic.findUnique({ where: { id: ticket.clinicId }, select: { name: true } }),
      getCreatorEmail(ticket.createdById),
    ]);
    await notifySupportReply({
      ticketId: ticket.id,
      folio: ticket.folio,
      subject: ticket.subject,
      clinicName: clinic?.name ?? "Clínica",
      category: ticket.category,
      priority: ticket.priority,
      bodyPreview: bodyPreview(body),
      authorName,
      toEmail,
      attachmentCount: atts.length,
    });
  }

  const [message] = await toMessageDTOs(updated.messages as MessageRow[]);
  return message;
}

/** Cambio de estado por soporte: mensaje system en el hilo + email a la clínica. */
export async function changeTicketStatus(
  ticketId: string,
  status: string,
): Promise<AdminTicketSummary> {
  assertStatus(status);
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new SupportError("Ticket no encontrado", 404);
  if (ticket.status === status) {
    const nameMap = await getClinicNameMap([ticket.clinicId]);
    return toAdminSummary(ticket as TicketRow, nameMap.get(ticket.clinicId) ?? "Clínica");
  }

  const labels: Record<string, string> = {
    ABIERTO: "Abierto",
    EN_PROGRESO: "En progreso",
    ESPERANDO_RESPUESTA: "Esperando respuesta de la clínica",
    RESUELTO: "Resuelto",
    CERRADO: "Cerrado",
  };

  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: {
      status,
      clinicUnread: true,
      closedAt: status === "CERRADO" ? new Date() : ticket.closedAt,
      messages: {
        create: {
          authorType: "system",
          body: `Soporte cambió el estado a "${labels[status] ?? status}"`,
        },
      },
    },
  });

  // ZENDESK: espejo del estado → zendeskAdapter.changeStatus(externalId, status)

  const [clinic, toEmail] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: ticket.clinicId }, select: { name: true } }),
    getCreatorEmail(ticket.createdById),
  ]);
  await notifyStatusChange({
    ticketId: ticket.id,
    folio: ticket.folio,
    subject: ticket.subject,
    clinicName: clinic?.name ?? "Clínica",
    category: ticket.category,
    priority: ticket.priority,
    status,
    toEmail,
  });

  const nameMap = await getClinicNameMap([updated.clinicId]);
  return toAdminSummary(updated as TicketRow, nameMap.get(updated.clinicId) ?? "Clínica");
}

/** Cambio de prioridad (silencioso: sin email ni mensaje en el hilo). */
export async function changeTicketPriority(
  ticketId: string,
  priority: string,
): Promise<AdminTicketSummary> {
  assertPriority(priority);
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new SupportError("Ticket no encontrado", 404);
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { priority },
  });
  const nameMap = await getClinicNameMap([updated.clinicId]);
  return toAdminSummary(updated as TicketRow, nameMap.get(updated.clinicId) ?? "Clínica");
}

/** Mini-métricas de la bandeja admin. */
export async function getAdminMetrics(): Promise<SupportAdminMetrics> {
  const [openTickets, ratingAgg, firstResponses] = await Promise.all([
    prisma.supportTicket.findMany({
      where: { status: { in: [...SUPPORT_OPEN_STATUSES] } },
      select: {
        status: true,
        createdAt: true,
        lastClinicMessageAt: true,
        lastSupportMessageAt: true,
      },
      take: 2000,
    }),
    prisma.supportTicket.aggregate({
      _avg: { rating: true },
      _count: { rating: true },
      where: { rating: { not: null } },
    }),
    prisma.supportTicket.findMany({
      where: { firstResponseAt: { not: null } },
      select: { createdAt: true, firstResponseAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const cutoff = Date.now() - 24 * 36e5;
  const unanswered24h = openTickets.filter((t) => {
    const waiting =
      !t.lastSupportMessageAt ||
      (t.lastClinicMessageAt &&
        t.lastClinicMessageAt.getTime() > t.lastSupportMessageAt.getTime());
    if (!waiting) return false;
    const since = t.lastClinicMessageAt ?? t.createdAt;
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
    unanswered24h,
    avgFirstResponseHours,
    avgRating,
    ratedCount: ratingAgg._count.rating ?? 0,
  };
}
