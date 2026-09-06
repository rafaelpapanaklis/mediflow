import { prisma } from "@/lib/prisma";
import {
  AI_APPEND_MAX,
  AI_LIST_MAX,
  AI_MESSAGES_MAX,
  AI_MIGRATION_MAX_CONVERSATIONS,
  AI_MIGRATION_MAX_MESSAGES,
  chunk,
  normalizeContent,
  normalizeGroup,
  normalizeTitle,
  titleFromMessage,
  type AiConversationGroup,
  type AiMessageRole,
} from "./conversation-core";

/**
 * Asistente IA Clínico — acceso al historial, SIEMPRE con dueño.
 *
 * Toda función de este archivo exige un `AiConversationScope` y lo mete en el
 * `where` de Prisma. Es el único sitio del vertical dental que toca
 * ai_conversations / ai_conversation_messages: si el filtro de tenant vive en
 * un solo archivo, no hay una ruta que se lo olvide.
 *
 * ⛔ `clinicId: undefined` NO FILTRA NADA — Prisma descarta la clave y devuelve
 * las filas de TODAS las clínicas. Por eso `assertScope()` corta ANTES de
 * consultar en vez de confiar en los tipos: `ctx.clinicId`/`ctx.userId` vienen
 * de un `AuthContext` tipado, pero un caller nuevo puede pasar un objeto medio
 * armado y TypeScript con `strict: false` no lo estrecharía.
 */
export interface AiConversationScope {
  clinicId: string;
  userId: string;
}

/** Lo que ve la barra lateral. Sin mensajes: se piden al abrir. */
export interface AiConversationSummary {
  id: string;
  title: string;
  group: AiConversationGroup;
  updatedAt: number;
  createdAt: number;
  messageCount: number;
}

export interface AiConversationMessageDto {
  id: string;
  role: AiMessageRole;
  content: string;
  timestamp: number;
}

/** Conversación entrante de la migración de localStorage. */
export interface LegacyConversationInput {
  id?: unknown;
  title?: unknown;
  group?: unknown;
  updatedAt?: unknown;
  messages?: unknown;
}

export class AiScopeError extends Error {}

/**
 * Corta si falta clínica o usuario. Se llama al principio de CADA función.
 * Lanza en vez de devolver vacío para que el fallo sea ruidoso: un scope roto
 * es un bug de programación, no un caso de negocio.
 */
function assertScope(scope: AiConversationScope): AiConversationScope {
  const clinicId = typeof scope?.clinicId === "string" ? scope.clinicId.trim() : "";
  const userId = typeof scope?.userId === "string" ? scope.userId.trim() : "";
  if (!clinicId || !userId) {
    throw new AiScopeError("Scope del asistente IA incompleto (clinicId/userId)");
  }
  return { clinicId, userId };
}

/**
 * Drift de esquema: la tabla no existe todavía porque el .sql se aplica A MANO
 * en Supabase después del deploy. Mismo criterio que clinic-layout y
 * affiliate-support. Las rutas lo traducen a 503 storage_unavailable y el chat
 * sigue funcionando sin guardar.
 */
export function isAiHistoryStorageMissing(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022" || code === "42P01" || code === "42703";
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  groupKey: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { messages: true } },
} as const;

interface SummaryRow {
  id: string;
  title: string;
  groupKey: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { messages: number };
}

function toSummary(row: SummaryRow): AiConversationSummary {
  return {
    id: row.id,
    title: row.title,
    group: normalizeGroup(row.groupKey),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    messageCount: row._count.messages,
  };
}

/**
 * Historial de la barra lateral: las conversaciones de ESTA persona en ESTA
 * clínica, por actividad reciente.
 *
 * `search` (ya saneado con sanitizeSearchTerm) busca en el título Y en el
 * contenido de los turnos — es lo que hacía el filtro en memoria de la página
 * cuando el historial entero cabía en el navegador.
 */
export async function listConversations(
  scope: AiConversationScope,
  opts: { search?: string | null; limit?: number } = {},
): Promise<AiConversationSummary[]> {
  const { clinicId, userId } = assertScope(scope);
  const take = Math.min(opts.limit ?? AI_LIST_MAX, AI_LIST_MAX);
  const search = opts.search?.trim() || null;

  const rows = await prisma.aiConversation.findMany({
    where: {
      clinicId,
      userId,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { messages: { some: { content: { contains: search, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    },
    select: SUMMARY_SELECT,
    orderBy: { updatedAt: "desc" },
    take,
  });

  return rows.map(toSummary);
}

/**
 * Una conversación con sus turnos, o `null` si no es de esta persona en esta
 * clínica.
 *
 * ⚠️ Prueba de tenant: alguien de la clínica A pide por id una conversación de
 * la clínica B. El `where` lleva clinicId + userId además del id, así que
 * `findFirst` devuelve null y la ruta responde 404 not_found — el MISMO 404 que
 * un id inventado. No se filtra ni la existencia de la fila.
 */
export async function getConversation(
  scope: AiConversationScope,
  id: string,
): Promise<{ conversation: AiConversationSummary; messages: AiConversationMessageDto[] } | null> {
  const { clinicId, userId } = assertScope(scope);
  if (!id) return null;

  const row = await prisma.aiConversation.findFirst({
    where: { id, clinicId, userId },
    select: SUMMARY_SELECT,
  });
  if (!row) return null;

  // El filtro de tenant se repite en los mensajes (clinicId/userId están
  // denormalizados justo para esto) aunque conversationId ya venga validado
  // arriba: defensa en profundidad barata, el índice sigue siendo
  // (conversationId, createdAt).
  //
  // Se leen los ÚLTIMOS AI_MESSAGES_MAX, no los primeros: en una conversación
  // que pase del tope, quedarse con los más viejos la congelaría —el doctor no
  // vería sus últimos mensajes, y /api/ai recibiría como contexto un historial
  // caducado— mientras los turnos nuevos se siguen guardando invisibles.
  //
  // El desempate por `id` importa: la página vieja creaba la pregunta y el
  // hueco de la respuesta en el MISMO bloque síncrono, así que casi todos los
  // pares migrados comparten milisegundo en una columna timestamp(3). Sin
  // desempate, el orden entre ellos no está garantizado y el hilo podría pintar
  // la respuesta encima de la pregunta que la provocó.
  const rows = await prisma.aiConversationMessage.findMany({
    where: { conversationId: row.id, clinicId, userId },
    select: { id: true, role: true, content: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AI_MESSAGES_MAX,
  });

  return {
    conversation: toSummary(row),
    messages: rows.reverse().map((m) => ({
      id: m.id,
      role: (m.role === "assistant" ? "assistant" : "user") as AiMessageRole,
      content: m.content,
      timestamp: m.createdAt.getTime(),
    })),
  };
}

/**
 * Crea una conversación, opcionalmente con su primer turno. La página solo la
 * crea al mandar el primer mensaje, así que el historial nunca guarda
 * conversaciones vacías (mismo contrato que tenía en localStorage).
 */
export async function createConversation(
  scope: AiConversationScope,
  input: {
    title?: unknown;
    group?: unknown;
    messages?: Array<{ role: AiMessageRole; content: string }>;
  },
): Promise<{ conversation: AiConversationSummary; messages: AiConversationMessageDto[] }> {
  const { clinicId, userId } = assertScope(scope);

  const seed = (input.messages ?? [])
    .slice(0, AI_APPEND_MAX)
    .map((m) => ({ role: m.role, content: normalizeContent(m.content) }))
    .filter((m): m is { role: AiMessageRole; content: string } => m.content !== null);

  const title =
    normalizeTitle(input.title) ??
    (seed.length ? titleFromMessage(seed[0].content) : "Conversación");

  // `+ i` en la marca de tiempo: los turnos sembrados se insertan de golpe y
  // caerían todos en el mismo milisegundo de una columna timestamp(3), sin
  // orden garantizado entre pregunta y respuesta al releerlos.
  const now = Date.now();
  const created = await prisma.aiConversation.create({
    data: {
      clinicId,
      userId,
      title,
      groupKey: normalizeGroup(input.group),
      ...(seed.length
        ? {
            messages: {
              create: seed.map((m, i) => ({
                clinicId,
                userId,
                role: m.role,
                content: m.content,
                createdAt: new Date(now + i),
              })),
            },
          }
        : {}),
    },
    select: SUMMARY_SELECT,
  });

  const full = await getConversation({ clinicId, userId }, created.id);
  return full ?? { conversation: toSummary(created), messages: [] };
}

/**
 * Renombra / recategoriza. Devuelve `null` si la fila no es de esta persona en
 * esta clínica (mismo 404 que un id inventado).
 */
export async function updateConversation(
  scope: AiConversationScope,
  id: string,
  patch: { title?: unknown; group?: unknown },
): Promise<AiConversationSummary | null> {
  const { clinicId, userId } = assertScope(scope);
  if (!id) return null;

  const data: { title?: string; groupKey?: string } = {};
  if (patch.title !== undefined) {
    const title = normalizeTitle(patch.title);
    if (!title) return null; // título vacío: la ruta ya lo rechaza con 400
    data.title = title;
  }
  if (patch.group !== undefined) data.groupKey = normalizeGroup(patch.group);
  if (!Object.keys(data).length) return null;

  // updateMany con el tenant en el where: un `update` por id pelado tocaría la
  // fila de otra clínica. count 0 es el "no es tuya" y la ruta lo saca como 404.
  const res = await prisma.aiConversation.updateMany({
    where: { id, clinicId, userId },
    data,
  });
  if (res.count === 0) return null;

  const row = await prisma.aiConversation.findFirst({
    where: { id, clinicId, userId },
    select: SUMMARY_SELECT,
  });
  return row ? toSummary(row) : null;
}

/**
 * Borra la conversación y sus turnos. Devuelve lo borrado (para la bitácora) o
 * `null` si no es de esta persona en esta clínica.
 */
export async function deleteConversation(
  scope: AiConversationScope,
  id: string,
): Promise<AiConversationSummary | null> {
  const { clinicId, userId } = assertScope(scope);
  if (!id) return null;

  const row = await prisma.aiConversation.findFirst({
    where: { id, clinicId, userId },
    select: SUMMARY_SELECT,
  });
  if (!row) return null;

  // Los turnos se borran a mano ANTES de la conversación. La FK con ON DELETE
  // CASCADE la pone sql/ai-assistant-conversations.sql; si ese SQL no se aplicó
  // tal cual, un delete a secas dejaría turnos huérfanos o reventaría por la
  // FK. Con el where de tenant puesto, borrar de más es imposible.
  await prisma.aiConversationMessage.deleteMany({
    where: { conversationId: row.id, clinicId, userId },
  });
  await prisma.aiConversation.deleteMany({ where: { id: row.id, clinicId, userId } });

  return toSummary(row);
}

/**
 * Anexa turnos y empuja `updatedAt` (la barra lateral ordena por eso).
 * Devuelve `null` si la conversación no es de esta persona en esta clínica.
 */
export async function appendMessages(
  scope: AiConversationScope,
  conversationId: string,
  incoming: Array<{ role: AiMessageRole; content: string }>,
): Promise<AiConversationSummary | null> {
  const { clinicId, userId } = assertScope(scope);
  if (!conversationId) return null;

  const clean = incoming
    .slice(0, AI_APPEND_MAX)
    .map((m) => ({ role: m.role, content: normalizeContent(m.content) }))
    .filter((m): m is { role: AiMessageRole; content: string } => m.content !== null);
  if (!clean.length) return null;

  const owned = await prisma.aiConversation.findFirst({
    where: { id: conversationId, clinicId, userId },
    select: { id: true },
  });
  if (!owned) return null;

  const now = new Date();

  // createMany en vez de N creates: el turno del usuario y la respuesta del
  // asistente caben en una sola ida al pooler. El `+ i` en la marca de tiempo
  // desempata dentro de la misma tanda: la columna es timestamp(3) y dos turnos
  // creados en el mismo bloque caerían en el mismo milisegundo.
  await prisma.aiConversationMessage.createMany({
    data: clean.map((m, i) => ({
      conversationId: owned.id,
      clinicId,
      userId,
      role: m.role,
      content: m.content,
      createdAt: new Date(now.getTime() + i),
    })),
  });

  // `updatedAt` se escribe EXPLÍCITAMENTE. Es @updatedAt, pero Prisma solo lo
  // mueve cuando la fila se actualiza de verdad, y un `data: {}` no actualiza
  // nada (Prisma descarta la llamada y devuelve count 0). Anexar un turno tiene
  // que subir la conversación en la barra lateral, que ordena por esta columna.
  //
  // Se toca SOLO `updatedAt` y no se reescribe el título: hacerlo pisaría un
  // renombrado que hubiera entrado entre la lectura de arriba y esta escritura.
  await prisma.aiConversation.updateMany({
    where: { id: owned.id, clinicId, userId },
    data: { updatedAt: now },
  });

  // Solo el resumen. Devolver la conversación entera arrastraría hasta 500
  // turnos por la red en CADA mensaje, dos veces por intercambio, para que el
  // cliente los tire: ya tiene el hilo pintado en pantalla.
  const row = await prisma.aiConversation.findFirst({
    where: { id: owned.id, clinicId, userId },
    select: SUMMARY_SELECT,
  });
  return row ? toSummary(row) : null;
}

/** Turno ya saneado de la migración. */
interface LegacyMessage {
  role: AiMessageRole;
  content: string;
  createdAt?: Date;
}

/** Fecha de cliente creíble: > 0 y no más de un día en el futuro. */
function plausibleDate(raw: unknown): Date | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (raw <= 0 || raw > Date.now() + 86_400_000) return undefined;
  return new Date(raw);
}

/**
 * Migración de una sola vez desde localStorage.
 *
 * Idempotente por `legacyId` (el id que la conversación tenía en el navegador)
 * más el índice único (clinicId, userId, legacyId): dos pestañas subiendo lo
 * mismo, o un reintento tras un fallo a medias, no duplican nada. Una
 * conversación sin id de origen se salta — sin llave no hay idempotencia, y
 * preferimos perder una fila basura a duplicar el historial en cada recarga.
 */
export async function importLegacyConversations(
  scope: AiConversationScope,
  incoming: LegacyConversationInput[],
): Promise<{ imported: number; skipped: number }> {
  const { clinicId, userId } = assertScope(scope);

  const candidates = incoming
    .slice(0, AI_MIGRATION_MAX_CONVERSATIONS)
    .map((c) => {
      const legacyId = typeof c?.id === "string" ? c.id.trim().slice(0, 80) : "";
      if (!legacyId) return null;

      const rawMessages = Array.isArray(c?.messages) ? c.messages : [];
      // Bucle y no map+filter con predicado de tipo: con `strict: false` en
      // tsconfig, `createdAt?: Date` se colapsa a `Date` y el predicado deja de
      // ser asignable al elemento. Empujar a un array ya tipado es directo.
      const messages: LegacyMessage[] = [];
      // Los ÚLTIMOS N, no los primeros: si una conversación pasa del tope, lo
      // que importa conservar es el final del hilo, no su arranque.
      for (const raw of rawMessages.slice(-AI_MIGRATION_MAX_MESSAGES)) {
        const msg = raw as { role?: unknown; content?: unknown; timestamp?: unknown };
        const content = normalizeContent(msg?.content);
        if (!content) continue;
        // Se respeta la marca de tiempo del navegador para no aplastar el
        // historial entero contra "ahora"; una fecha imposible cae al default
        // de la columna.
        //
        // El `+ messages.length` DESEMPATA: la página vieja creaba la pregunta
        // y el hueco de la respuesta en el mismo bloque síncrono, con dos
        // `Date.now()` que en la práctica caen en el mismo milisegundo. La
        // columna es timestamp(3), así que sin este desplazamiento el orden
        // entre pregunta y respuesta no está garantizado al releerlas.
        const ts = plausibleDate(msg?.timestamp);
        messages.push({
          role: msg?.role === "assistant" ? "assistant" : "user",
          content,
          createdAt: ts ? new Date(ts.getTime() + messages.length) : undefined,
        });
      }

      // Conversación sin turnos: es la basura que dejó el comportamiento viejo
      // (creaba una al entrar, escribiera el usuario o no). No se sube.
      if (!messages.length) return null;

      return {
        legacyId,
        title: normalizeTitle(c?.title) ?? titleFromMessage(messages[0].content),
        groupKey: normalizeGroup(c?.group),
        updatedAt: plausibleDate(c?.updatedAt),
        messages,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (!candidates.length) return { imported: 0, skipped: incoming.length };

  const already = await prisma.aiConversation.findMany({
    where: { clinicId, userId, legacyId: { in: candidates.map((c) => c.legacyId) } },
    select: { legacyId: true },
  });
  const seen = new Set(already.map((r) => r.legacyId).filter((v): v is string => !!v));
  const pending = candidates.filter((c) => !seen.has(c.legacyId));

  let imported = 0;
  // De 5 en 5: más de ~7 consultas en el mismo Promise.all satura el pooler.
  for (const batch of chunk(pending, 5)) {
    const results = await Promise.all(
      batch.map((c) =>
        prisma.aiConversation
          .create({
            data: {
              clinicId,
              userId,
              legacyId: c.legacyId,
              title: c.title,
              groupKey: c.groupKey,
              ...(c.updatedAt ? { updatedAt: c.updatedAt } : {}),
              messages: {
                create: c.messages.map((m) => ({
                  clinicId,
                  userId,
                  role: m.role,
                  content: m.content,
                  ...(m.createdAt ? { createdAt: m.createdAt } : {}),
                })),
              },
            },
            select: { id: true },
          })
          .then(() => true)
          .catch((e: unknown) => {
            // Carrera entre dos pestañas: el índice único (clinicId, userId,
            // legacyId) tira P2002 y esa fila simplemente ya estaba subida.
            if ((e as { code?: string })?.code === "P2002") return false;
            throw e;
          }),
      ),
    );
    imported += results.filter(Boolean).length;
  }

  return { imported, skipped: incoming.length - imported };
}
