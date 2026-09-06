import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiHistoryErrorResponse, aiHistoryWriteLimit, resolveAiScope } from "@/lib/ai-assistant/api";
import {
  AI_APPEND_MAX,
  AI_MESSAGE_MAX_CHARS,
  AI_MESSAGE_ROLES,
  type AiMessageRole,
} from "@/lib/ai-assistant/conversation-core";
import { appendMessages } from "@/lib/ai-assistant/conversations";

export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  role: z.enum(AI_MESSAGE_ROLES),
  content: z.string().min(1).max(AI_MESSAGE_MAX_CHARS),
});

// Se admiten las dos formas: un turno suelto o una tanda. La página manda uno
// (el del doctor al enviar, el del asistente al terminar de responder).
const AppendSchema = z.union([
  MessageSchema,
  z.object({ messages: z.array(MessageSchema).min(1).max(AI_APPEND_MAX) }),
]);

/**
 * POST /api/ai-assistant/conversations/[id]/messages
 * Anexa turnos a una conversación de la persona y la clínica de la sesión, y
 * empuja su `updatedAt` para que suba en la barra lateral.
 *
 * ⚠️ Tenant: `appendMessages` resuelve primero la conversación con
 * clinicId + userId en el where. Escribir en la conversación de otra clínica
 * (o de otro compañero) devuelve 404, no un 200 silencioso.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  // Freno de escritura por persona (ver aiHistoryWriteLimit): los topes de
  // tamaño acotan CADA petición, no cuántas peticiones caben.
  const rl = await aiHistoryWriteLimit(req, auth.scope);
  if (rl) return rl;

  const body = await req.json().catch(() => null);
  const parsed = AppendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  // Se re-normaliza a mano en vez de usar el tipo inferido por zod: con
  // `strict: false` en tsconfig, z.infer marca TODAS las propiedades como
  // opcionales y el array no encaja con la firma de appendMessages. Zod ya
  // validó los valores; aquí solo se les da forma.
  const raw = parsed.data as {
    role?: string;
    content?: string;
    messages?: Array<{ role?: string; content?: string }>;
  };
  const incoming = (Array.isArray(raw.messages) ? raw.messages : [raw]).map((m) => ({
    role: (m?.role === "assistant" ? "assistant" : "user") as AiMessageRole,
    content: String(m?.content ?? ""),
  }));

  try {
    // Devuelve SOLO el resumen: el cliente ya tiene el hilo pintado, y mandarle
    // de vuelta hasta 500 turnos en cada mensaje —dos veces por intercambio—
    // sería arrastrar la conversación entera por la red para que la tire.
    const conversation = await appendMessages(auth.scope, params.id, incoming);
    if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}
