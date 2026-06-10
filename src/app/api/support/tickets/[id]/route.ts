import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { closeAndRateTicket, getTicketForClinic } from "@/lib/support/service";
import { SupportError } from "@/lib/support/types";

// ═══════════════════════════════════════════════════════════════════════════
// /api/support/tickets/[id] — lado CLÍNICA.
// Los routes SOLO resuelven sesión, parsean input y delegan en
// src/lib/support/service.ts (multi-tenant: el service filtra por clinicId).
//   GET   → getTicketForClinic(params.id, ctx.clinicId) → { ticket, messages }
//   PATCH → { action: "close", rating? } → closeAndRateTicket(...) → { ticket }
// Multi-tenant: clinicId SOLO de ctx (sesión), nunca del body.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function errorToResponse(err: unknown): NextResponse {
  if (err instanceof SupportError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[support/tickets/[id]] error:", err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const detail = await getTicketForClinic(params.id, ctx.clinicId);
    if (!detail) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

    return NextResponse.json(detail); // { ticket, messages }
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    if (body.action !== "close") {
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }

    const ticket = await closeAndRateTicket(params.id, ctx.clinicId, body.rating);
    return NextResponse.json({ ticket });
  } catch (err) {
    return errorToResponse(err);
  }
}
