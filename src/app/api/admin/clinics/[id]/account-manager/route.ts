// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/clinics/[id]/account-manager — asigna / quita el manager.
//
// ADMIN-ONLY. Es el único punto que escribe clinics.accountManagerId. La
// clínica jamás puede cambiarse su propio manager desde su panel.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { SQL_PENDING_MESSAGE } from "@/lib/account-manager/admin";

export const dynamic = "force-dynamic";

// ── PUT { accountManagerId: string | null } ────────────────────────────────
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { accountManagerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const raw = body?.accountManagerId;
  // null / "" = quitar el manager.
  const accountManagerId = raw === null || raw === "" ? null : typeof raw === "string" ? raw : undefined;
  if (accountManagerId === undefined) {
    return NextResponse.json({ error: "accountManagerId inválido." }, { status: 400 });
  }

  try {
    // El manager tiene que existir: sin esto un id forjado deja la clínica
    // apuntando a nada (o revienta con un error de FK poco legible).
    if (accountManagerId !== null) {
      const manager = await prisma.accountManager.findUnique({
        where: { id: accountManagerId },
        select: { id: true },
      });
      if (!manager) return NextResponse.json({ error: "Manager no encontrado." }, { status: 404 });
    }

    await prisma.clinic.update({
      where: { id: params.id },
      data: { accountManagerId },
    });

    return NextResponse.json({ success: true, accountManagerId });
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Clínica no encontrada." }, { status: 404 });
    }
    console.error("[admin/clinics/:id/account-manager] PUT:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}

// ── DELETE: atajo de "Quitar" ──────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await prisma.clinic.update({
      where: { id: params.id },
      data: { accountManagerId: null },
    });
    return NextResponse.json({ success: true, accountManagerId: null });
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Clínica no encontrada." }, { status: 404 });
    }
    console.error("[admin/clinics/:id/account-manager] DELETE:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}
