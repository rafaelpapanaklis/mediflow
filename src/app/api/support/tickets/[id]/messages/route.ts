import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { addClinicMessage } from "@/lib/support/service";
import { SupportError } from "@/lib/support/types";

// ═══════════════════════════════════════════════════════════════════════════
// /api/support/tickets/[id]/messages — lado CLÍNICA.
// Los routes SOLO resuelven sesión, parsean input y delegan en
// src/lib/support/service.ts (sanitiza, valida adjuntos, reabre, notifica).
//   POST → { body, attachments? } → addClinicMessage(...) → { message } (201)
// Mapear SupportError → status del error (409 si el ticket está cerrado).
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
  console.error("[support/tickets/[id]/messages] error:", err);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

    const message = await addClinicMessage(params.id, ctx.clinicId, {
      userId: ctx.userId,
      userName: fullName(ctx),
      body: body.body,
      attachments: body.attachments,
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
