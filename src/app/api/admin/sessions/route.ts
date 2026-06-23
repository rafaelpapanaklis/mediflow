import { NextRequest, NextResponse } from "next/server";
import {
  getAdminSession,
  listAdminSessions,
  revokeAdminSession,
  revokeAllAdminSessions,
} from "@/lib/admin-auth";

/**
 * WS2-T3 · Gestión de sesiones del admin actual.
 *  GET  → lista sus sesiones VIVAS (marca la actual).
 *  POST → { action: "revoke", id } | { action: "revokeAll" }.
 *
 * Auth + atribución: getAdminSession() (sesión real en BD). El CSRF de las
 * mutaciones lo cubre el middleware (origin-check para POST /api/admin/*).
 */
export async function GET() {
  const ctx = await getAdminSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await listAdminSessions(ctx.user.id, ctx.sessionId);
  return NextResponse.json({ currentSessionId: ctx.sessionId, sessions });
}

export async function POST(req: NextRequest) {
  const ctx = await getAdminSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const action = body?.action;

  if (action === "revoke") {
    const id = String(body?.id ?? "");
    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
    // Acotado al admin dueño dentro del helper: no puede revocar sesiones ajenas.
    await revokeAdminSession(id, ctx.user.id);
    return NextResponse.json({ ok: true });
  }

  if (action === "revokeAll") {
    // Revoca todas MENOS la actual, para no auto-desconectarse en el acto.
    await revokeAllAdminSessions(ctx.user.id, ctx.sessionId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
