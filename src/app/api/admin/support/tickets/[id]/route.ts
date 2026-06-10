import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { SupportError } from "@/lib/support/types";
import {
  getTicketForAdmin,
  changeTicketStatus,
  changeTicketPriority,
} from "@/lib/support/service";

// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/support/tickets/[id] — detalle ADMIN.
//   GET   → getTicketForAdmin(params.id) → 404 si null (incluye notas internas)
//   PATCH → { status?, priority? } changeTicketStatus / changeTicketPriority
//           (ambos: primero status, luego priority) → { ticket }
// El service hace toda la lógica; aquí solo: guard admin, parsear, delegar.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const detail = await getTicketForAdmin(params.id);
    if (!detail) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof SupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/admin/support/tickets/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const status = payload.status;
  const priority = payload.priority;
  if (!status && !priority) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  try {
    let ticket;
    if (status) ticket = await changeTicketStatus(params.id, status);
    if (priority) ticket = await changeTicketPriority(params.id, priority);
    return NextResponse.json({ ticket });
  } catch (err) {
    if (err instanceof SupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PATCH /api/admin/support/tickets/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
