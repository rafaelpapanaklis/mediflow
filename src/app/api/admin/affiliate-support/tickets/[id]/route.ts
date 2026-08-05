// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/affiliate-support/tickets/[id] — detalle ADMIN de un ticket de
// afiliado.
//   GET   → getAffiliateTicketForAdmin(id) → 404 si null (INCLUYE notas internas)
//   PATCH → { status?, priority? } → { ticket }
//
// Espejo de /api/admin/support/tickets/[id]. El service hace toda la lógica
// (mensaje system, campos de métricas, avisos); aquí sólo: guard admin,
// validar, delegar.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  AFFILIATE_SUPPORT_PRIORITIES,
  AFFILIATE_SUPPORT_STATUSES,
  AffiliateSupportError,
} from "@/lib/affiliate-support/types";
import {
  getAffiliateTicketForAdmin,
  changeAffiliateTicketStatus,
  changeAffiliateTicketPriority,
} from "@/lib/affiliate-support/service";

export const dynamic = "force-dynamic";

/** Ver el comentario de isSchemaDrift en ../route.ts: tabla/columna inexistente
 *  por SQL sin aplicar NO puede salir como 500. */
function isSchemaDrift(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022" || code === "42P01" || code === "42703";
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const detail = await getAffiliateTicketForAdmin(params.id);
    if (!detail) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof AffiliateSupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isSchemaDrift(err)) {
      console.warn("[admin/affiliate-support/tickets/[id]] SQL pendiente:", err);
      // Sin tablas no hay ticket que mostrar: 404 con mensaje accionable, nunca 500.
      return NextResponse.json(
        { error: "Falta aplicar el SQL de soporte de afiliados en Supabase.", sqlPending: true },
        { status: 404 },
      );
    }
    console.error("GET /api/admin/affiliate-support/tickets/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const status = typeof payload.status === "string" ? payload.status : undefined;
  const priority = typeof payload.priority === "string" ? payload.priority : undefined;
  if (!status && !priority) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }
  // Se valida ANTES de llamar al service: un valor forjado no debe llegar a la
  // columna (es texto libre en BD, no un enum de Postgres).
  if (status && !(AFFILIATE_SUPPORT_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  }
  if (priority && !(AFFILIATE_SUPPORT_PRIORITIES as readonly string[]).includes(priority)) {
    return NextResponse.json({ error: "Prioridad inválida." }, { status: 400 });
  }

  try {
    let ticket;
    if (status) ticket = await changeAffiliateTicketStatus(params.id, status);
    if (priority) ticket = await changeAffiliateTicketPriority(params.id, priority);
    return NextResponse.json({ ticket });
  } catch (err) {
    if (err instanceof AffiliateSupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isSchemaDrift(err)) {
      console.warn("[admin/affiliate-support/tickets/[id]] PATCH con SQL pendiente:", err);
      return NextResponse.json(
        { error: "Falta aplicar el SQL de soporte de afiliados en Supabase.", sqlPending: true },
        { status: 503 },
      );
    }
    console.error("PATCH /api/admin/affiliate-support/tickets/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
