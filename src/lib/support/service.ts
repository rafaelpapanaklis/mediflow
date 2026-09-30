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
import { sanitizeSupportText } from "./texto";
import {
  estadosDeEdicion,
  planearEdicion,
  planearRetiro,
  retractedText,
  type EstadoEdicion,
} from "./mensaje-edicion";
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

// sanitizeSupportText vive en ./texto (módulo puro); se reexporta por compatibilidad.
export { sanitizeSupportText };

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

/**
 * Regla ÚNICA de "espera respuesta de soporte", solo sobre las 2 fechas:
 * nadie respondió aún, o la clínica habló al último. El estado del ticket lo
 * filtra quien llama (where de Prisma o `clinicIsWaiting`).
 */
function awaitingSupportReply(t: {
  lastClinicMessageAt: Date | null;
  lastSupportMessageAt: Date | null;
}): boolean {
  if (!t.lastSupportMessageAt) return true;
  if (!t.lastClinicMessageAt) return false;
  return t.lastClinicMessageAt.getTime() > t.lastSupportMessageAt.getTime();
}

/** La pelota está del lado de soporte (nadie respondió aún o la clínica habló al último). */
function clinicIsWaiting(t: TicketRow): boolean {
  if (!(SUPPORT_OPEN_STATUSES as readonly string[]).includes(t.status)) return false;
  return awaitingSupportReply(t);
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
    // Para /admin/soporte: sin respuesta nuestra no hay nada que la clínica
    // pueda leer, así que clinicUnread no se puede leer como "no lo ha visto".
    hasSupportReply: t.lastSupportMessageAt != null,
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

/**
 * ¿La tabla de revisiones (sql/soporte-mensajes-edicion.sql) aún no existe, o el
 * cliente de Prisma que corre no la conoce? Mientras no exista, el hilo se lee y
 * se escribe como siempre; solo editar/retirar avisa que falta aplicar el SQL.
 */
function revisionesNoDisponibles(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "P2021") return true; // la tabla no existe
  const msg = String(e?.message ?? "");
  return (
    (/support_message_revisions/i.test(msg) && /does not exist|no existe/i.test(msg)) ||
    // Un cliente de Prisma generado antes de este cambio (servidor de desarrollo sin reiniciar).
    /supportMessageRevision/.test(msg) ||
    /Unknown arg(ument)? `revisions`/.test(msg)
  );
}

/**
 * Mientras el SQL no se aplica, la tabla no existe y CADA lectura del hilo
 * chocaría con ella (y Prisma deja una línea de error en el log por cada una).
 * Se recuerda un minuto que no está y las lecturas del hilo ni la consultan;
 * las escrituras siempre la consultan (y en cuanto existe, todo se recupera).
 */
const RECORDAR_AUSENCIA_MS = 60_000;
let revisionesAusentesHasta = 0;
/** Solo para pruebas: olvida que la tabla faltaba. */
export function __olvidarAusenciaDeRevisiones(): void {
  revisionesAusentesHasta = 0;
}

const AVISO_FALTA_SQL =
  "Editar o retirar respuestas todavía no está disponible: falta aplicar sql/soporte-mensajes-edicion.sql en la base.";

/**
 * Qué mensajes del ticket soporte editó o retiró. Lectura del hilo (`estricto`
 * false): si la tabla no está, se lee todo como «sin cambios» — nunca tumba el
 * hilo. Escritura (`estricto` true): sin tabla no se cambia nada (no habría dónde
 * guardar el original) y se responde 503 con el motivo.
 */
async function cargarEstadosDeEdicion(
  ticketId: string,
  estricto = false,
): Promise<Map<string, EstadoEdicion>> {
  if (!estricto && Date.now() < revisionesAusentesHasta) return new Map();
  try {
    if (!prisma.supportMessageRevision) throw new Error("supportMessageRevision");
    const filas = await prisma.supportMessageRevision.findMany({
      where: { ticketId },
      select: { messageId: true, kind: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
    revisionesAusentesHasta = 0;
    return estadosDeEdicion(filas);
  } catch (err) {
    if (revisionesNoDisponibles(err)) {
      revisionesAusentesHasta = Date.now() + RECORDAR_AUSENCIA_MS;
      if (estricto) throw new SupportError(AVISO_FALTA_SQL, 503);
      return new Map();
    }
    if (estricto) throw err;
    console.error("[support] no se pudo leer el historial de ediciones:", err);
    return new Map();
  }
}

/** Convierte mensajes a DTO firmando TODOS los adjuntos en un solo batch. */
async function toMessageDTOs(
  messages: MessageRow[],
  estados: Map<string, EstadoEdicion> = new Map(),
): Promise<SupportMessageDTO[]> {
  // Un mensaje retirado no muestra (ni firma) ningún archivo.
  const parsed = messages.map((m) => ({
    m,
    atts: estados.get(m.id)?.retractedAt ? [] : parseAttachments(m.attachments),
  }));
  const allPaths: string[] = [];
  parsed.forEach((p) => p.atts.forEach((a) => allPaths.push(a.path)));

  let urls: string[] = [];
  if (allPaths.length > 0) {
    // Un solo round-trip a Supabase (createSignedUrls interno) — no N×.
    urls = await signMaybeUrls(allPaths, ATTACHMENT_URL_TTL_SECONDS);
  }
  let cursor = 0;
  return parsed.map(({ m, atts }) => {
    const estado = estados.get(m.id);
    const retirado = estado?.retractedAt != null;
    return {
      id: m.id,
      ticketId: m.ticketId,
      authorType: (m.authorType as SupportMessageDTO["authorType"]) ?? "system",
      authorName: m.authorName,
      // Retirado: en su lugar queda el aviso y ni un archivo (el original vive en
      // support_message_revisions). Se fuerza aquí además de guardarlo así en la fila.
      body: retirado ? retractedText(m.internalNote) : m.body,
      attachments: atts.map((a) => ({ ...a, signedUrl: urls[cursor++] || undefined })),
      internalNote: m.internalNote,
      createdAt: m.createdAt.toISOString(),
      editedAt: estado?.editedAt?.toISOString() ?? null,
      retractedAt: estado?.retractedAt?.toISOString() ?? null,
    };
  });
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

  const estados = await cargarEstadosDeEdicion(ticket.id);
  const messages = await toMessageDTOs(ticket.messages as MessageRow[], estados);
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

  const [clinic, creatorEmail, estados] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: ticket.clinicId },
      select: { name: true, email: true },
    }),
    getCreatorEmail(ticket.createdById),
    cargarEstadosDeEdicion(ticket.id),
  ]);
  const messages = await toMessageDTOs(ticket.messages as MessageRow[], estados);

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

// ── Editar / retirar / adjuntar a una respuesta ya enviada ──────────────────

/** Quién hace el cambio (queda en el historial). Sale de la sesión admin, jamás del body. */
export interface SupportMessageActor {
  id?: string | null;
  name?: string | null;
}

async function cargarMensajeDeSoporte(ticketId: string, messageId: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new SupportError("Ticket no encontrado", 404);
  // El mensaje se busca DENTRO del ticket de la URL: no hay forma de tocar el de otro hilo.
  const message = await prisma.supportMessage.findFirst({
    where: { id: messageId, ticketId: ticket.id },
  });
  if (!message) throw new SupportError("Mensaje no encontrado", 404);
  return { ticket, message };
}

/**
 * Un solo write atómico (nested write, sin transacción interactiva): actualiza el
 * mensaje Y guarda en support_message_revisions lo que decía antes. Si la tabla no
 * existe, TODO falla y no cambia nada. Un cambio a una respuesta pública levanta
 * `clinicUnread` (la clínica ve la novedad en su lista); NO manda email — el aviso
 * ya salió con la respuesta y un correo por cada corrección sería ruido.
 */
async function escribirCambioDeMensaje(args: {
  ticketId: string;
  message: MessageRow;
  kind: "edit" | "attach" | "retract";
  body: string;
  attachments: SupportAttachment[];
  actor: SupportMessageActor;
}): Promise<void> {
  const { message } = args;
  const previoAdjuntos = parseAttachments(message.attachments);
  try {
    await prisma.supportTicket.update({
      where: { id: args.ticketId },
      data: {
        ...(message.internalNote ? {} : { clinicUnread: true }),
        messages: {
          update: {
            where: { id: message.id },
            data: {
              body: args.body,
              attachments: args.attachments as any,
              revisions: {
                create: {
                  ticketId: args.ticketId,
                  kind: args.kind,
                  previousBody: message.body,
                  previousAttachments: previoAdjuntos.length ? (previoAdjuntos as any) : undefined,
                  editedById: args.actor.id ?? null,
                  editedByName: sanitizeSupportText(args.actor.name ?? "", 120) || null,
                },
              },
            },
          },
        },
      },
    });
  } catch (err) {
    if (revisionesNoDisponibles(err)) throw new SupportError(AVISO_FALTA_SQL, 503);
    throw err;
  }
}

export interface EditSupportMessageInput {
  /** Texto nuevo. Omitido = no tocar el texto (p. ej. solo se agregan archivos). */
  body?: unknown;
  /** Metadatos de POST /api/admin/support/tickets/[id]/attachments para AGREGAR a la respuesta. */
  attachments?: unknown;
}

/**
 * Soporte edita su respuesta (o le agrega archivos) DESPUÉS de enviarla. Deja
 * «(editado)» con fecha y guarda lo anterior. No cambia el estado del ticket.
 */
export async function editSupportMessage(
  ticketId: string,
  messageId: string,
  input: EditSupportMessageInput,
  actor: SupportMessageActor,
): Promise<SupportMessageDTO> {
  const { ticket, message } = await cargarMensajeDeSoporte(ticketId, messageId);
  const estados = await cargarEstadosDeEdicion(ticket.id, true);
  // Mismo validador anti cross-tenant que al enviar; el clinicId sale del ticket.
  const archivosNuevos = validateAttachmentsMeta(input.attachments, ticket.clinicId);
  const plan = planearEdicion(
    {
      authorType: message.authorType,
      internalNote: message.internalNote,
      body: message.body,
      attachments: parseAttachments(message.attachments),
    },
    estados.get(message.id),
    { body: input.body, archivosNuevos },
  );

  await escribirCambioDeMensaje({
    ticketId: ticket.id,
    message: message as MessageRow,
    kind: plan.kind,
    body: plan.body,
    attachments: plan.attachments,
    actor,
  });

  const [dto] = await toMessageDTOs(
    [{ ...(message as MessageRow), body: plan.body, attachments: plan.attachments }],
    new Map([[message.id, { editedAt: new Date(), retractedAt: null }]]),
  );
  return dto;
}

/**
 * Soporte retira su respuesta. NO se borra: en su lugar queda «Respuesta retirada
 * por soporte» y el texto y los archivos originales se conservan en
 * support_message_revisions para auditoría.
 */
export async function retractSupportMessage(
  ticketId: string,
  messageId: string,
  actor: SupportMessageActor,
): Promise<SupportMessageDTO> {
  const { ticket, message } = await cargarMensajeDeSoporte(ticketId, messageId);
  const estados = await cargarEstadosDeEdicion(ticket.id, true);
  const plan = planearRetiro(
    {
      authorType: message.authorType,
      internalNote: message.internalNote,
      body: message.body,
      attachments: parseAttachments(message.attachments),
    },
    estados.get(message.id),
  );

  await escribirCambioDeMensaje({
    ticketId: ticket.id,
    message: message as MessageRow,
    kind: "retract",
    body: plan.body,
    attachments: plan.attachments,
    actor,
  });

  const [dto] = await toMessageDTOs(
    [{ ...(message as MessageRow), body: plan.body, attachments: [] }],
    new Map([[message.id, { editedAt: null, retractedAt: new Date() }]]),
  );
  return dto;
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

  // Misma pasada para las 2 métricas de espera: `pendingReply` = todos los que
  // esperan respuesta; `unanswered24h` = los que además ya pasaron las 24 h.
  const cutoff = Date.now() - 24 * 36e5;
  const waitingTickets = openTickets.filter(awaitingSupportReply);
  const pendingReply = waitingTickets.length;
  const unanswered24h = waitingTickets.filter((t) => {
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
    pendingReply,
    unanswered24h,
    avgFirstResponseHours,
    avgRating,
    ratedCount: ratingAgg._count.rating ?? 0,
  };
}

/**
 * Tickets abiertos que esperan respuesta de soporte — badge del sidebar admin.
 * MISMA regla que `unanswered24h` pero SIN el corte de 24 h: cuentan todos.
 * Nunca lanza: un fallo de DB devuelve 0 en vez de tumbar el panel entero.
 */
export async function countAdminPendingReply(): Promise<number> {
  try {
    const openTickets = await prisma.supportTicket.findMany({
      where: { status: { in: [...SUPPORT_OPEN_STATUSES] } },
      select: { lastClinicMessageAt: true, lastSupportMessageAt: true },
    });
    return openTickets.filter(awaitingSupportReply).length;
  } catch {
    return 0;
  }
}
