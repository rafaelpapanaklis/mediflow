import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiHistoryErrorResponse, aiHistoryWriteLimit, resolveAiScope } from "@/lib/ai-assistant/api";
import {
  AI_CONVERSATION_GROUPS,
  AI_MESSAGE_MAX_CHARS,
  AI_MESSAGE_ROLES,
  AI_MIGRATION_MAX_CONVERSATIONS,
  AI_MIGRATION_MAX_MESSAGES,
  AI_TITLE_MAX,
} from "@/lib/ai-assistant/conversation-core";
import { importLegacyConversations } from "@/lib/ai-assistant/conversations";

export const dynamic = "force-dynamic";

const LegacySchema = z.object({
  conversations: z
    .array(
      z.object({
        // El id que la conversación tenía en el navegador. Es la LLAVE de
        // idempotencia: sin él la conversación se salta, para no duplicar el
        // historial en cada recarga.
        id: z.string().min(1).max(80),
        title: z.string().max(AI_TITLE_MAX * 4).optional(),
        group: z.enum(AI_CONVERSATION_GROUPS).optional(),
        updatedAt: z.number().optional(),
        messages: z
          .array(
            z.object({
              role: z.enum(AI_MESSAGE_ROLES),
              content: z.string().max(AI_MESSAGE_MAX_CHARS),
              timestamp: z.number().optional(),
            }),
          )
          .max(AI_MIGRATION_MAX_MESSAGES),
      }),
    )
    .max(AI_MIGRATION_MAX_CONVERSATIONS),
});

/**
 * POST /api/ai-assistant/migrate
 *
 * Sube de una sola vez el historial que quedó en localStorage
 * ("mf:ai-conversations:v1", clave global sin usuario ni clínica) a la cuenta
 * de quien está usando el panel AHORA MISMO.
 *
 * Es idempotente por (clinicId, userId, legacyId) con índice único detrás: dos
 * pestañas subiendo lo mismo, o un reintento tras un fallo a medias, no
 * duplican nada. La página borra la clave vieja solo cuando esto responde 200.
 *
 * ⚠️ Consecuencia deliberada del bug que arregla: esas conversaciones no traían
 * dueño, así que se atribuyen a la sesión que las sube. En un equipo compartido
 * eso significa que quien migre primero se queda con el historial mezclado del
 * navegador — no hay forma de repartirlas, porque el dato de quién las escribió
 * nunca existió.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  // Freno de escritura por persona (ver aiHistoryWriteLimit): los topes de
  // tamaño acotan CADA petición, no cuántas peticiones caben.
  const rl = await aiHistoryWriteLimit(req, auth.scope);
  if (rl) return rl;

  const body = await req.json().catch(() => null);
  const parsed = LegacySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  if (!parsed.data.conversations.length) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  try {
    const result = await importLegacyConversations(auth.scope, parsed.data.conversations);
    return NextResponse.json(result);
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}
