import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logMutation } from "@/lib/audit";
import { aiHistoryErrorResponse, resolveAiScope } from "@/lib/ai-assistant/api";
import { AI_CONVERSATION_GROUPS, AI_TITLE_MAX } from "@/lib/ai-assistant/conversation-core";
import { deleteConversation, getConversation, updateConversation } from "@/lib/ai-assistant/conversations";

export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    title: z.string().min(1).max(AI_TITLE_MAX * 4).optional(),
    group: z.enum(AI_CONVERSATION_GROUPS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "sin campos que actualizar");

interface Params {
  params: { id: string };
}

/**
 * GET /api/ai-assistant/conversations/[id]
 * La conversación con sus turnos.
 *
 * ⚠️ Tenant: el where de getConversation lleva clinicId + userId de la SESIÓN
 * además del id. Pedir por id una conversación de otra clínica —o de otro
 * compañero de la misma clínica— devuelve el MISMO 404 que un id inventado: ni
 * el título ni la existencia de la fila se filtran.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  try {
    const found = await getConversation(auth.scope, params.id);
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(found);
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}

/** PATCH /api/ai-assistant/conversations/[id] — renombrar / recategorizar. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }
  // Un título de solo espacios pasa el `min(1)` de zod pero no deja nada tras
  // normalizar; se rechaza aquí para no confundirlo con el 404 de "no es tuya".
  if (parsed.data.title !== undefined && !parsed.data.title.trim()) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    const updated = await updateConversation(auth.scope, params.id, parsed.data);
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ conversation: updated });
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}

/** DELETE /api/ai-assistant/conversations/[id] — borra la conversación y sus turnos. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await resolveAiScope();
  if (auth.response) return auth.response;

  try {
    const removed = await deleteConversation(auth.scope, params.id);
    if (!removed) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Bitácora: el borrado es irreversible y lo que se va son notas de apoyo
    // clínico, así que queda constancia de QUE pasó.
    //
    // ⛔ El TÍTULO no entra. Por defecto son los primeros 60 caracteres del
    // primer mensaje del doctor —"Paciente Juan P., 42 años, dolor a la
    // percusión en…"—, o sea el prompt tal cual. Copiarlo a AuditLog dejaría
    // ese texto legible en /dashboard/auditoria para quien pueda ver la
    // bitácora de la clínica, cuando la conversación era privada de esa
    // persona. La bitácora no es un segundo expediente: se guarda la FORMA
    // (grupo, cuántos turnos, cuánto medía el título), no el contenido.
    // `ai-consult` es el entityType que ya existe para el asistente.
    await logMutation({
      req,
      clinicId: auth.scope.clinicId,
      userId: auth.scope.userId,
      entityType: "ai-consult",
      entityId: removed.id,
      action: "delete",
      before: {
        group: removed.group,
        messageCount: removed.messageCount,
        titleLength: removed.title.length,
        createdAt: new Date(removed.createdAt).toISOString(),
      },
    });

    return NextResponse.json({ ok: true, id: removed.id });
  } catch (e) {
    return aiHistoryErrorResponse(e);
  }
}
