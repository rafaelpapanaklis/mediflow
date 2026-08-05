// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/affiliate-support/tickets/[id]/messages — respuesta de soporte.
//   POST { body, internalNote? } → addAffiliateSupportMessage(...) → 201
//
// authorType va SIEMPRE fijo en "support": este endpoint es admin-only y jamás
// puede escribir en nombre del afiliado (eso lo hace /api/afiliados/soporte/*).
// internalNote=true no notifica ni cambia estado (lo maneja el service) y el
// afiliado NUNCA la ve: el filtrado vive en el service, del lado del afiliado.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  AFFILIATE_SUPPORT_MAX_BODY_CHARS,
  AffiliateSupportError,
} from "@/lib/affiliate-support/types";
import { addAffiliateSupportMessage } from "@/lib/affiliate-support/service";

export const dynamic = "force-dynamic";

/** Ver el comentario de isSchemaDrift en ../../route.ts. */
function isSchemaDrift(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022" || code === "42P01" || code === "42703";
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  // Aquí no hay adjuntos (el admin sólo escribe texto), así que un mensaje vacío
  // no tiene sentido: se corta antes de llegar al service.
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) return NextResponse.json({ error: "Escribe un mensaje." }, { status: 400 });
  if (body.length > AFFILIATE_SUPPORT_MAX_BODY_CHARS) {
    return NextResponse.json(
      { error: `El mensaje no puede pasar de ${AFFILIATE_SUPPORT_MAX_BODY_CHARS} caracteres.` },
      { status: 400 },
    );
  }

  try {
    const message = await addAffiliateSupportMessage(params.id, {
      body,
      authorType: "support",
      internalNote: Boolean(payload.internalNote),
      authorName: "Soporte DaleControl",
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    if (err instanceof AffiliateSupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isSchemaDrift(err)) {
      console.warn("[admin/affiliate-support/messages] SQL pendiente:", err);
      return NextResponse.json(
        { error: "Falta aplicar el SQL de soporte de afiliados en Supabase.", sqlPending: true },
        { status: 503 },
      );
    }
    console.error("POST /api/admin/affiliate-support/tickets/[id]/messages error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
