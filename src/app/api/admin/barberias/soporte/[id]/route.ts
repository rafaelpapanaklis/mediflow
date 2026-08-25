import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  BarberAdminError,
  changeBarberTicketState,
  getBarberTicketForAdmin,
} from "@/lib/barber/admin";

// ═══════════════════════════════════════════════════════════════════════
// /api/admin/barberias/soporte/[id] — un ticket del vertical.
//   GET   → hilo completo con adjuntos firmados (bucket barber-files)
//   PATCH → { status?, priority? }
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const detail = await getBarberTicketForAdmin(params.id);
    if (!detail) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof BarberAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("GET /api/admin/barberias/soporte/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  try {
    const ticket = await changeBarberTicketState(params.id, {
      status: payload.status,
      priority: payload.priority,
    });
    return NextResponse.json({ ticket });
  } catch (err) {
    if (err instanceof BarberAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PATCH /api/admin/barberias/soporte/[id] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
