import "server-only";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  AI_LIST_MAX,
  normalizeContent,
  titleFromMessage,
  type AiMessageRole,
} from "@/lib/ai-assistant/conversation-core";
import {
  appendMessages,
  getConversation,
  type AiConversationMessageDto,
  type AiConversationScope,
  type AiConversationSummary,
} from "@/lib/ai-assistant/conversations";

/**
 * El historial de Sabina — en la MISMA tabla que el del Asistente IA
 * (`ai_conversations`), pero sin mezclarse con él.
 *
 * El contrato manda guardar la pregunta y la respuesta «en la conversación
 * guardada, que ya está protegida por clínica y por usuario», y prohíbe cambiar
 * el esquema. Sin una marca, las dos cosas juntas daban esto: la barra de
 * historial de Sabina listaba también las conversaciones CLÍNICAS del Asistente
 * IA, y abrir una y seguir preguntando mandaba ese hilo —notas de pacientes
 * incluidas— como contexto a Sabina y le anexaba turnos.
 *
 * La marca es `legacyId = "sabina:<uuid>"`. Esa columna solo la escribe la
 * migración de una sola vez desde localStorage, con los ids que la
 * conversación tenía en el navegador; ninguno empieza por `sabina:`, y el
 * índice único (clinicId, userId, legacyId) no estorba con un uuid. Ninguna
 * ruta del Asistente IA la edita.
 *
 * Y al revés: la barra del Asistente IA no lista las de Sabina, por el filtro
 * `NOT_SABINA_WHERE` de `listConversations` (conversations.ts), que usa esta
 * misma marca.
 *
 * Toda función exige scope completo y lo mete en el `where`: `clinicId:
 * undefined` no filtra nada en Prisma.
 */

export const MARCA_SABINA = "sabina:";

type Turno = { role: AiMessageRole; content: string };

function exigirScope(scope: AiConversationScope): AiConversationScope {
  const clinicId = typeof scope?.clinicId === "string" ? scope.clinicId.trim() : "";
  const userId = typeof scope?.userId === "string" ? scope.userId.trim() : "";
  if (!clinicId || !userId) throw new Error("Scope de Sabina incompleto (clinicId/userId)");
  return { clinicId, userId };
}

/** ¿Es una conversación de Sabina de esta persona en esta clínica? */
async function esDeSabina(scope: AiConversationScope, id: string): Promise<boolean> {
  const { clinicId, userId } = exigirScope(scope);
  if (!id) return false;
  const fila = await prisma.aiConversation.findFirst({
    where: { id, clinicId, userId, legacyId: { startsWith: MARCA_SABINA } },
    select: { id: true },
  });
  return !!fila;
}

/** La barra de historial: SOLO las de Sabina, por actividad reciente. */
export async function listarConversacionesSabina(
  scope: AiConversationScope,
): Promise<Array<{ id: string; title: string; updatedAt: number }>> {
  const { clinicId, userId } = exigirScope(scope);
  const filas = await prisma.aiConversation.findMany({
    where: { clinicId, userId, legacyId: { startsWith: MARCA_SABINA } },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: AI_LIST_MAX,
  });
  return filas.map((f) => ({ id: f.id, title: f.title, updatedAt: f.updatedAt.getTime() }));
}

/** La conversación con sus turnos, o `null` si no existe, no es suya o no es de Sabina. */
export async function leerConversacionSabina(
  scope: AiConversationScope,
  id: string,
): Promise<{ conversation: AiConversationSummary; messages: AiConversationMessageDto[] } | null> {
  if (!(await esDeSabina(scope, id))) return null;
  return getConversation(exigirScope(scope), id);
}

/**
 * Crea la conversación con su primer intercambio y la marca. Una sola
 * escritura: marcar después dejaría una fila sin marca si la segunda fallara.
 * Mismos topes y mismo desempate de marcas de tiempo que `createConversation`.
 */
export async function crearConversacionSabina(scope: AiConversationScope, turnos: Turno[]): Promise<string> {
  const { clinicId, userId } = exigirScope(scope);
  const limpios = turnos
    .map((t) => ({ role: t.role, content: normalizeContent(t.content) }))
    .filter((t): t is Turno => t.content !== null);

  const ahora = Date.now();
  const creada = await prisma.aiConversation.create({
    data: {
      clinicId,
      userId,
      legacyId: `${MARCA_SABINA}${randomUUID()}`,
      title: limpios.length ? titleFromMessage(limpios[0].content) : "Consulta a Sabina",
      groupKey: "admin",
      messages: {
        create: limpios.map((t, i) => ({
          clinicId,
          userId,
          role: t.role,
          content: t.content,
          createdAt: new Date(ahora + i),
        })),
      },
    },
    select: { id: true },
  });
  return creada.id;
}

/** Anexa turnos a una conversación de Sabina. `false` si no es suya o no es de Sabina. */
export async function anexarTurnosSabina(scope: AiConversationScope, id: string, turnos: Turno[]): Promise<boolean> {
  if (!(await esDeSabina(scope, id))) return false;
  return (await appendMessages(exigirScope(scope), id, turnos)) !== null;
}
