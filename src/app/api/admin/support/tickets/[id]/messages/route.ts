import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { SupportError } from "@/lib/support/types";
import { addSupportMessage } from "@/lib/support/service";

// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/support/tickets/[id]/messages — respuesta de soporte ADMIN.
//   POST → { body, internalNote?, attachments? } → addSupportMessage(...) → 201
// attachments = metadatos de POST /api/admin/support/tickets/[id]/attachments;
// el service los re-valida contra el clinicId del ticket (aquí NO se validan).
// internalNote=true NUNCA notifica ni cambia estado (lo maneja el service).
// El service hace toda la lógica; aquí solo: guard admin, parsear, delegar.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  try {
    const message = await addSupportMessage(params.id, {
      body: payload.body,
      internalNote: Boolean(payload.internalNote),
      authorName: "Soporte DaleControl",
      attachments: payload.attachments,
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    if (err instanceof SupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/admin/support/tickets/[id]/messages error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
