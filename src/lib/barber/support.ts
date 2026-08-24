import "server-only";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import {
  assertBarberPermission,
  getAccessibleBranchIds,
  type BarberContext,
} from "@/lib/barber-auth";
import { BarberAdminError, cleanMultiline, cleanText } from "@/lib/barber/branches";
import {
  BARBER_FILES_BUCKET,
  BARBER_TICKET_CATEGORIES,
  type BarberSupportAttachment,
  type BarberTicketPriority,
  type BarberTicketStatus,
} from "@/lib/barber/types";

// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — SOPORTE (lado BARBERÍA).
//
// La barbería abre el ticket, conversa y lo cierra. El lado de DaleControl
// (responder desde /admin) es de la Ola 2: este módulo deja los estados y el
// formato de mensaje listos para que ese lado solo escriba filas con
// authorType ADMIN. El contrato del endpoint que debe consumir está al final
// del archivo.
//
// Soporte NO se gatea por plan: una barbería que no puede pedir ayuda no es
// una barbería con soporte. Sí se gatea por permiso (support.view / .manage).
//
// Multi-tenant: los tickets se filtran SIEMPRE por
// `barbershopId: { in: await getAccessibleBranchIds(ctx) }`. Los adjuntos
// viven bajo support/{barbershopId}/ y esa ruta se re-valida al adjuntar:
// una barbería no puede referenciar el archivo de otra ni aunque adivine el
// path.
// ═══════════════════════════════════════════════════════════════════════

export const BARBER_SUPPORT_SUBJECT_MAX = 160;
export const BARBER_SUPPORT_BODY_MAX = 5000;
export const BARBER_SUPPORT_MAX_FILES = 5;
export const BARBER_SUPPORT_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const BARBER_SUPPORT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
/** Segundos de vida de la liga firmada de un adjunto. */
export const BARBER_SUPPORT_URL_TTL = 300;

/** Límites que la pantalla necesita conocer para avisar ANTES de subir. */
export const BARBER_SUPPORT_LIMITS = {
  maxFiles: BARBER_SUPPORT_MAX_FILES,
  maxFileBytes: BARBER_SUPPORT_MAX_FILE_BYTES,
  allowedMime: BARBER_SUPPORT_ALLOWED_MIME as readonly string[],
  subjectMax: BARBER_SUPPORT_SUBJECT_MAX,
  bodyMax: BARBER_SUPPORT_BODY_MAX,
};

function adminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Prefijo OBLIGATORIO de todo adjunto de esta barbería. */
export function supportPathPrefix(barbershopId: string): string {
  return `support/${barbershopId}/`;
}

// ── DTOs de pantalla ───────────────────────────────────────────────────

export interface BarberTicketRow {
  id: string;
  barbershopId: string;
  branchLabel: string;
  subject: string;
  category: string;
  status: BarberTicketStatus;
  priority: BarberTicketPriority;
  lastMessageAt: string;
  closedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  messagesCount: number;
  /** true = la última palabra la tiene DaleControl (hay respuesta nueva). */
  hasNewReply: boolean;
}

export interface BarberTicketMessageRow {
  id: string;
  authorType: "SHOP" | "ADMIN";
  authorName: string | null;
  body: string;
  attachments: Array<BarberSupportAttachment & { signedUrl?: string }>;
  createdAt: string;
}

export interface BarberTicketDetail {
  ticket: BarberTicketRow;
  messages: BarberTicketMessageRow[];
}

function isCategory(v: unknown): boolean {
  return typeof v === "string" && (BARBER_TICKET_CATEGORIES as readonly string[]).includes(v);
}
function isPriority(v: unknown): v is BarberTicketPriority {
  return v === "LOW" || v === "NORMAL" || v === "HIGH";
}

/** Adjuntos guardados en Json -> arreglo tipado (tolerante a basura vieja). */
function parseAttachments(raw: unknown): BarberSupportAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: BarberSupportAttachment[] = [];
  for (const item of raw) {
    const a = item as Partial<BarberSupportAttachment> | null;
    if (!a || typeof a.path !== "string") continue;
    out.push({
      path: a.path,
      name: typeof a.name === "string" ? a.name : "archivo",
      size: typeof a.size === "number" ? a.size : 0,
      type: typeof a.type === "string" ? a.type : "application/octet-stream",
    });
  }
  return out;
}

/**
 * Valida los metadatos que manda el cliente después de subir el archivo.
 * El path DEBE vivir bajo support/{barbershopId}/ — este es el candado que
 * impide que una barbería adjunte (y luego lea firmado) el archivo de otra.
 */
export function validateAttachments(
  input: unknown,
  barbershopId: string,
): BarberSupportAttachment[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new BarberAdminError("Adjuntos inválidos.");
  if (input.length > BARBER_SUPPORT_MAX_FILES) {
    throw new BarberAdminError(`Máximo ${BARBER_SUPPORT_MAX_FILES} archivos por mensaje.`);
  }
  const prefix = supportPathPrefix(barbershopId);
  return input.map((item) => {
    const a = item as Partial<BarberSupportAttachment> | null;
    if (!a || typeof a.path !== "string" || !a.path.startsWith(prefix) || a.path.includes("..")) {
      throw new BarberAdminError("Adjunto inválido.");
    }
    if (
      typeof a.type !== "string" ||
      !(BARBER_SUPPORT_ALLOWED_MIME as readonly string[]).includes(a.type)
    ) {
      throw new BarberAdminError("Tipo de archivo no permitido.");
    }
    const size = typeof a.size === "number" ? a.size : 0;
    if (size <= 0 || size > BARBER_SUPPORT_MAX_FILE_BYTES) {
      throw new BarberAdminError("El archivo pesa más de lo permitido.");
    }
    return {
      path: a.path,
      name: cleanText(a.name ?? "archivo", 120) || "archivo",
      size,
      type: a.type,
    };
  });
}

/** Firma en UN solo round-trip todos los adjuntos de un hilo. */
async function signAll(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  try {
    const { data, error } = await adminSupabase()
      .storage.from(BARBER_FILES_BUCKET)
      .createSignedUrls(paths, BARBER_SUPPORT_URL_TTL);
    if (error || !data) {
      console.warn("[barber/support] createSignedUrls falló:", error?.message ?? "sin data");
      return paths.map(() => "");
    }
    return data.map((row) => (row.error || !row.signedUrl ? "" : row.signedUrl));
  } catch (e) {
    console.warn("[barber/support] excepción al firmar:", (e as Error).message);
    return paths.map(() => "");
  }
}

// ── Lectura ────────────────────────────────────────────────────────────

type TicketRaw = {
  id: string;
  barbershopId: string;
  subject: string;
  category: string;
  status: BarberTicketStatus;
  priority: BarberTicketPriority;
  lastMessageAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  createdBy: { firstName: string; lastName: string } | null;
  barbershop: { name: string; branchName: string | null };
  _count: { messages: number };
  messages: Array<{ authorType: "SHOP" | "ADMIN" }>;
};

const TICKET_SELECT = {
  id: true,
  barbershopId: true,
  subject: true,
  category: true,
  status: true,
  priority: true,
  lastMessageAt: true,
  closedAt: true,
  createdAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
  barbershop: { select: { name: true, branchName: true } },
  _count: { select: { messages: true } },
  // Solo el último mensaje: decide si hay respuesta nueva de DaleControl sin
  // necesitar una columna de "no leído" en la tabla.
  messages: {
    select: { authorType: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} as const;

function toTicketRow(t: TicketRaw): BarberTicketRow {
  const author = t.createdBy;
  return {
    id: t.id,
    barbershopId: t.barbershopId,
    branchLabel: t.barbershop.branchName?.trim() || t.barbershop.name,
    subject: t.subject,
    category: t.category,
    status: t.status,
    priority: t.priority,
    lastMessageAt: t.lastMessageAt.toISOString(),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    createdByName: author ? `${author.firstName} ${author.lastName}`.trim() : null,
    messagesCount: t._count.messages,
    hasNewReply: t.messages[0]?.authorType === "ADMIN" && t.status !== "CLOSED",
  };
}

export async function listTickets(ctx: BarberContext): Promise<BarberTicketRow[]> {
  assertBarberPermission(ctx, "support.view");
  const ids = await getAccessibleBranchIds(ctx);
  if (ids.length === 0) return [];
  const rows = await prisma.barberSupportTicket.findMany({
    where: { barbershopId: { in: ids } },
    select: TICKET_SELECT,
    orderBy: { lastMessageAt: "desc" },
    take: 200,
  });
  return rows.map((r) => toTicketRow(r as unknown as TicketRaw));
}

/** Carga el ticket comprobando tenant. Devuelve 404 (no 403) si es ajeno. */
async function loadTicketInScope(ctx: BarberContext, ticketId: string): Promise<TicketRaw> {
  const ids = await getAccessibleBranchIds(ctx);
  if (ids.length === 0) throw new BarberAdminError("Ticket no encontrado.", 404);
  const ticket = await prisma.barberSupportTicket.findFirst({
    where: { id: ticketId, barbershopId: { in: ids } },
    select: TICKET_SELECT,
  });
  if (!ticket) throw new BarberAdminError("Ticket no encontrado.", 404);
  return ticket as unknown as TicketRaw;
}

export async function getTicketDetail(
  ctx: BarberContext,
  ticketId: string,
): Promise<BarberTicketDetail> {
  assertBarberPermission(ctx, "support.view");
  const ticket = await loadTicketInScope(ctx, ticketId);

  const messages = await prisma.barberSupportMessage.findMany({
    where: { ticketId, barbershopId: ticket.barbershopId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      authorType: true,
      authorUserId: true,
      body: true,
      attachments: true,
      createdAt: true,
    },
  });

  // Nombre de quien escribió, solo para los mensajes de la barbería (los del
  // lado DaleControl se firman "Soporte DaleControl").
  const shopAuthorIds = Array.from(
    new Set(
      messages
        .filter((m) => m.authorType === "SHOP" && m.authorUserId)
        .map((m) => m.authorUserId as string),
    ),
  );
  const authors = shopAuthorIds.length
    ? await prisma.barberUser.findMany({
        where: { id: { in: shopAuthorIds }, barbershopId: ticket.barbershopId },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(
    authors.map((a) => [a.id, `${a.firstName} ${a.lastName}`.trim()]),
  );

  const parsed = messages.map((m) => ({ m, atts: parseAttachments(m.attachments) }));
  const allPaths: string[] = [];
  parsed.forEach((p) => p.atts.forEach((a) => allPaths.push(a.path)));
  const urls = await signAll(allPaths);

  let cursor = 0;
  const rows: BarberTicketMessageRow[] = parsed.map(({ m, atts }) => ({
    id: m.id,
    authorType: m.authorType as "SHOP" | "ADMIN",
    authorName:
      m.authorType === "SHOP"
        ? nameById.get(m.authorUserId ?? "") ?? null
        : "Soporte DaleControl",
    body: m.body,
    attachments: atts.map((a) => ({ ...a, signedUrl: urls[cursor++] || undefined })),
    createdAt: m.createdAt.toISOString(),
  }));

  return { ticket: toTicketRow(ticket), messages: rows };
}

// ── Escritura ──────────────────────────────────────────────────────────

export interface CreateTicketInput {
  subject?: unknown;
  category?: unknown;
  priority?: unknown;
  body?: unknown;
  attachments?: unknown;
  barbershopId?: unknown;
}

/**
 * Abre un ticket con su primer mensaje. Nace OPEN: la pelota es de
 * DaleControl.
 */
export async function createTicket(
  ctx: BarberContext,
  input: CreateTicketInput,
): Promise<BarberTicketRow> {
  assertBarberPermission(ctx, "support.manage");

  const subject = cleanText(input.subject, BARBER_SUPPORT_SUBJECT_MAX);
  if (!subject) throw new BarberAdminError("Ponle un asunto al ticket.");
  const body = cleanMultiline(input.body, BARBER_SUPPORT_BODY_MAX);
  if (!body) throw new BarberAdminError("Cuéntanos qué pasó.");
  if (!isCategory(input.category)) throw new BarberAdminError("Categoría inválida.");
  const priority: BarberTicketPriority = isPriority(input.priority) ? input.priority : "NORMAL";

  // La sede del ticket sale de la sesión (o de una sede que ya alcanza).
  let barbershopId = ctx.barbershopId;
  if (typeof input.barbershopId === "string" && input.barbershopId) {
    const ids = await getAccessibleBranchIds(ctx);
    if (!ids.includes(input.barbershopId)) {
      throw new BarberAdminError("Esa sede no es de tu barbería.", 404);
    }
    barbershopId = input.barbershopId;
  }

  const attachments = validateAttachments(input.attachments, barbershopId);

  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.barberSupportTicket.create({
      data: {
        barbershopId,
        createdByUserId: ctx.barberUserId,
        subject,
        category: input.category as string,
        priority,
        status: "OPEN",
      },
      select: { id: true },
    });
    await tx.barberSupportMessage.create({
      data: {
        ticketId: t.id,
        barbershopId,
        authorType: "SHOP",
        authorUserId: ctx.barberUserId,
        body,
        attachments: attachments as unknown as object,
      },
    });
    return t;
  });

  const full = await prisma.barberSupportTicket.findUniqueOrThrow({
    where: { id: ticket.id },
    select: TICKET_SELECT,
  });
  return toTicketRow(full as unknown as TicketRaw);
}

export interface AddMessageInput {
  body?: unknown;
  attachments?: unknown;
}

/**
 * Responde en el hilo. Si DaleControl estaba esperando (WAITING_REPLY) o el
 * ticket estaba cerrado, contestar lo devuelve a OPEN: la pelota vuelve a
 * DaleControl y nadie tiene que acordarse de reabrirlo a mano.
 */
export async function addMessage(
  ctx: BarberContext,
  ticketId: string,
  input: AddMessageInput,
): Promise<BarberTicketDetail> {
  assertBarberPermission(ctx, "support.manage");
  const ticket = await loadTicketInScope(ctx, ticketId);

  const body = cleanMultiline(input.body, BARBER_SUPPORT_BODY_MAX);
  const attachments = validateAttachments(input.attachments, ticket.barbershopId);
  if (!body && attachments.length === 0) {
    throw new BarberAdminError("Escribe un mensaje o adjunta un archivo.");
  }

  const now = new Date();
  const reopen = ticket.status === "CLOSED" || ticket.status === "WAITING_REPLY";

  await prisma.$transaction([
    prisma.barberSupportMessage.create({
      data: {
        ticketId,
        barbershopId: ticket.barbershopId,
        authorType: "SHOP",
        authorUserId: ctx.barberUserId,
        body: body || "(archivo adjunto)",
        attachments: attachments as unknown as object,
      },
    }),
    prisma.barberSupportTicket.update({
      where: { id: ticketId },
      data: {
        lastMessageAt: now,
        ...(reopen ? { status: "OPEN" as BarberTicketStatus, closedAt: null } : {}),
      },
    }),
  ]);

  return getTicketDetail(ctx, ticketId);
}

/**
 * La barbería cierra o reabre su propio ticket. Los estados intermedios
 * (IN_PROGRESS, WAITING_REPLY) los mueve DaleControl desde su panel: la
 * barbería no se los puede poner sola.
 */
export async function setTicketClosed(
  ctx: BarberContext,
  ticketId: string,
  closed: boolean,
): Promise<BarberTicketDetail> {
  assertBarberPermission(ctx, "support.manage");
  const ticket = await loadTicketInScope(ctx, ticketId);

  if (closed && ticket.status === "CLOSED") return getTicketDetail(ctx, ticketId);
  if (!closed && ticket.status !== "CLOSED") return getTicketDetail(ctx, ticketId);

  await prisma.barberSupportTicket.update({
    where: { id: ticketId },
    data: closed
      ? { status: "CLOSED", closedAt: new Date() }
      : { status: "OPEN", closedAt: null, lastMessageAt: new Date() },
  });
  return getTicketDetail(ctx, ticketId);
}

// ═══════════════════════════════════════════════════════════════════════
// CONTRATO PARA LA OLA 2 (lado DaleControl, /admin — fuera de esta ola)
//
// El admin de DaleControl es COMPARTIDO con el dental y no se toca aquí. Lo
// que tiene que existir de su lado, y lo que este módulo ya deja listo:
//
//   GET    /api/admin/barber-support/tickets
//          -> lista global (sin filtro de barbershopId; el admin ve todas
//             las barberías). Filtros útiles: status, barbershopId, q.
//   GET    /api/admin/barber-support/tickets/[id]
//          -> ticket + mensajes. Los adjuntos se firman igual que aquí
//             (bucket BARBER_FILES_BUCKET, TTL corto).
//   POST   /api/admin/barber-support/tickets/[id]/messages
//          -> body { body, attachments }. Escribe BarberSupportMessage con
//             authorType "ADMIN" y authorUserId = id del admin (SIN FK, así
//             lo definió el schema). Debe además:
//               · ticket.lastMessageAt = now
//               · ticket.status -> "WAITING_REPLY" (la pelota pasa a la
//                 barbería; esta pantalla lo pinta como respuesta nueva)
//   PATCH  /api/admin/barber-support/tickets/[id]
//          -> status (OPEN | IN_PROGRESS | WAITING_REPLY | CLOSED) y
//             priority. Al cerrar, closedAt = now.
//
// Lo que esta pantalla YA entiende sin cambios: authorType ADMIN se pinta
// como "Soporte DaleControl", hasNewReply se calcula con el último mensaje,
// y responder desde la barbería regresa el ticket a OPEN.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cuántos tickets esperan respuesta de la barbería. Es el contador del menú:
 * WAITING_REPLY significa exactamente "DaleControl ya contestó y la pelota es
 * tuya". Falla suave con 0 — un badge nunca puede tumbar una pantalla.
 */
export async function countTicketsWaitingShop(ctx: BarberContext): Promise<number> {
  try {
    const ids = await getAccessibleBranchIds(ctx);
    if (ids.length === 0) return 0;
    return await prisma.barberSupportTicket.count({
      where: { barbershopId: { in: ids }, status: "WAITING_REPLY" },
    });
  } catch {
    return 0;
  }
}
