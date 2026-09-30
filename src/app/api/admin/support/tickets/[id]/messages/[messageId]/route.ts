import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { SupportError } from "@/lib/support/types";
import {
  editSupportMessage,
  retractSupportMessage,
  type SupportMessageActor,
} from "@/lib/support/service";

// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/support/tickets/[id]/messages/[messageId] — corregir una respuesta
// de soporte YA enviada (el aviso a la clínica ya salió: nada se borra en silencio).
//   PATCH  → { body?, attachments? } → editSupportMessage(...) → 200 { message }
//            body = texto nuevo; attachments = metadatos de POST …/attachments
//            para AGREGAR archivos a la respuesta. Deja «(editado)» con fecha.
//   DELETE → retractSupportMessage(...) → 200 { message }. NO borra: deja
//            «Respuesta retirada por soporte»; el original queda en
//            support_message_revisions.
// Solo mensajes de soporte (authorType "support"); el service lo valida y busca
// el mensaje DENTRO del ticket de la URL. Quién lo hizo sale de la sesión admin.
// Sin sql/soporte-mensajes-edicion.sql aplicado responde 503 con el motivo.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

type Params = { params: { id: string; messageId: string } };

async function actorDeLaSesion(): Promise<SupportMessageActor | null> {
  const admin = await getAdminSession();
  if (!admin) return null;
  return { id: admin.user.id, name: admin.user.email };
}

function responderError(err: unknown, ruta: string) {
  if (err instanceof SupportError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(`${ruta} error:`, err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const actor = await actorDeLaSesion();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    const message = await editSupportMessage(
      params.id,
      params.messageId,
      { body: payload.body, attachments: payload.attachments },
      actor,
    );
    return NextResponse.json({ message });
  } catch (err) {
    return responderError(err, "PATCH /api/admin/support/tickets/[id]/messages/[messageId]");
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const actor = await actorDeLaSesion();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const message = await retractSupportMessage(params.id, params.messageId, actor);
    return NextResponse.json({ message });
  } catch (err) {
    return responderError(err, "DELETE /api/admin/support/tickets/[id]/messages/[messageId]");
  }
}
