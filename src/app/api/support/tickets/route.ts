import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { createTicket, listClinicTickets } from "@/lib/support/service";
import { SupportError } from "@/lib/support/types";

// ═══════════════════════════════════════════════════════════════════════════
// /api/support/tickets — lado CLÍNICA.
// Los routes SOLO resuelven sesión, parsean input y delegan en
// src/lib/support/service.ts (sanitiza, valida, notifica, multi-tenant).
//   GET  → listClinicTickets(ctx.clinicId)            → { tickets }
//   POST → createTicket({...body, clinicId, userId})  → { ticket } (201)
// Multi-tenant: clinicId SOLO de ctx (sesión), nunca del body.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

/** Nombre visible del usuario de sesión; el service convierte "" → null. */
function fullName(ctx: AuthContext): string {
  return `${ctx.user?.firstName ?? ""} ${ctx.user?.lastName ?? ""}`.trim();
}

function errorToResponse(err: unknown): NextResponse {
  if (err instanceof SupportError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[support/tickets] error:", err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const tickets = await listClinicTickets(ctx.clinicId);
    return NextResponse.json({ tickets });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    const ticket = await createTicket({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      userName: fullName(ctx),
      subject: body.subject,
      category: body.category,
      priority: body.priority,
      body: body.body,
      attachments: body.attachments,
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
