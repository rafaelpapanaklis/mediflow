// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/account-managers — catálogo de managers de cuenta.
//
// ADMIN-ONLY (cookie de sesión admin, igual que el resto de /api/admin/*). Esta
// tabla lleva teléfonos personales: nunca se expone al panel de la clínica. La
// clínica sólo recibe SU manager, resuelto en server (get-for-clinic.ts).
//
// Mientras sql/account-managers.sql no esté aplicado, Prisma lanza aquí.
// Devolvemos 503 con un mensaje accionable en vez de un 500 mudo.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { parseAccountManagerInput, toAdminRow, SQL_PENDING_MESSAGE } from "@/lib/account-manager/admin";

export const dynamic = "force-dynamic";

const SELECT = {
  id: true,
  name: true,
  photoUrl: true,
  whatsappE164: true,
  whatsappDisplay: true,
  days: true,
  startMinutes: true,
  endMinutes: true,
  timezone: true,
  status: true,
  createdAt: true,
  _count: { select: { clinics: true } },
} as const;

// ── GET: lista completa con el conteo de clínicas atendidas ────────────────
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await prisma.accountManager.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: SELECT,
    });
    return NextResponse.json({ managers: rows.map(toAdminRow) });
  } catch (e) {
    console.error("[admin/account-managers] GET:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}

// ── POST: alta de un manager ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const parsed = parseAccountManagerInput(body, false);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const created = await prisma.accountManager.create({
      // parseAccountManagerInput con partial=false garantiza los obligatorios.
      data: parsed.data as Parameters<typeof prisma.accountManager.create>[0]["data"],
      select: SELECT,
    });
    return NextResponse.json({ manager: toAdminRow(created) }, { status: 201 });
  } catch (e) {
    console.error("[admin/account-managers] POST:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}
