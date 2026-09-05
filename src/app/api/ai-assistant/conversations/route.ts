import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiHistoryErrorResponse, aiHistoryWriteLimit, resolveAiScope } from "@/lib/ai-assistant/api";
import {
  AI_CONVERSATION_GROUPS,
  AI_LIST_MAX,
  AI_MESSAGE_MAX_CHARS,
  AI_MESSAGE_ROLES,
  AI_TITLE_MAX,
  clampLimit,
  sanitizeSearchTerm,
  type AiMessageRole,
} from "@/lib/ai-assistant/conversation-core";
import { createConversation, listConversations } from "@/lib/ai-assistant/conversations";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().max(AI_TITLE_MAX * 4).optional(),
  group: z.enum(AI_CONVERSATION_GROUPS).optional(),
  // Turnos con los que nace la conversación. La página manda exactamente uno
  // (el primer mensaje del doctor): la conversación NACE con contenido, así que
  // el historial nunca guarda conversaciones vacías.
  messages: z
    .array(
      z.object({
        role: z.enum(AI_MESSAGE_ROLES),
        content: z.string().min(1).max(AI_MESSAGE_MAX_CHARS),
      }),
    )
    .max(10)
    .optional(),
});

/**
 * GET /api/ai-assistant/conversations
 *
 * Historial de la barra lateral: SOLO las conversaciones de quien pregunta,
 * en la clínica de su sesión. Devuelve metadatos (sin turnos): abrir una
 * conversación pide sus mensajes aparte, para que entrar al asistente no baje
 * el historial entero.
 *
 * `?q=` busca en el título y en el contenido de los turnos — lo mismo que hacía
 * el filtro en memoria cuando el historial vivía en localStorage.
 */
export async function GET(req: NextRequest) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  const url = new URL(req.url);
  const search = sanitizeSearchTerm(url.searchParams.get("q"));
  const limit = clampLimit(url.searchParams.get("limit"), AI_LIST_MAX, AI_LIST_MAX);

  try {
    const conversations = await listConversations(auth.scope, { search, limit });
    return NextResponse.json({ conversations });
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}

/**
 * POST /api/ai-assistant/conversations
 * Crea una conversación (opcionalmente con su primer turno) para la persona y
 * la clínica de la sesión. El cuerpo NUNCA decide el dueño.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  // Freno de escritura por persona (ver aiHistoryWriteLimit): los topes de
  // tamaño acotan CADA petición, no cuántas peticiones caben.
  const rl = await aiHistoryWriteLimit(req, auth.scope);
  if (rl) return rl;

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  // Se re-normaliza a mano en vez de usar el tipo inferido por zod: con
  // `strict: false` en tsconfig, z.infer marca TODAS las propiedades como
  // opcionales y el array de turnos no encaja con la firma del helper. Zod ya
  // validó los valores; aquí solo se les da forma.
  const raw = parsed.data as {
    title?: string;
    group?: string;
    messages?: Array<{ role?: string; content?: string }>;
  };
  const messages = (Array.isArray(raw.messages) ? raw.messages : []).map((m) => ({
    role: (m?.role === "assistant" ? "assistant" : "user") as AiMessageRole,
    content: String(m?.content ?? ""),
  }));

  try {
    const created = await createConversation(auth.scope, {
      title: raw.title,
      group: raw.group,
      messages,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}
