// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/affiliates/[id]/account-manager — asigna / quita el manager.
//
// ADMIN-ONLY. Es el único punto que escribe affiliates.accountManagerId. El
// afiliado jamás puede cambiarse su propio manager desde su panel.
//
// A DIFERENCIA del espejo de clínicas, aquí SÍ se audita: quién le movió el
// manager a un afiliado es información de dinero (el manager es su canal
// directo para reclamar comisiones), así que cada cambio deja rastro con
// logAdminGlobalEvent. Por eso se usa getAdminSession() y no isAdminAuthed():
// hace falta la IDENTIDAD del admin, no sólo saber que está autenticado.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { logAdminGlobalEvent } from "@/lib/admin-audit";
import { prisma } from "@/lib/prisma";
import { SQL_PENDING_MESSAGE } from "@/lib/account-manager/admin";

export const dynamic = "force-dynamic";

// ── PUT { accountManagerId: string | null } ────────────────────────────────
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    // Se lee ANTES de escribir por dos motivos: el 404 legible si el afiliado no
    // existe, y el `before` de la auditoría (sin él el log no dice de quién se
    // le quitó el manager).
    const before = await prisma.affiliate.findUnique({
      where: { id: params.id },
      select: { accountManagerId: true },
    });
    if (!before) return NextResponse.json({ error: "Afiliado no encontrado." }, { status: 404 });

    // El manager tiene que existir: sin esto un id forjado deja al afiliado
    // apuntando a nada (o revienta con un error de FK poco legible).
    if (accountManagerId !== null) {
      const manager = await prisma.accountManager.findUnique({
        where: { id: accountManagerId },
        select: { id: true },
      });
      if (!manager) return NextResponse.json({ error: "Manager no encontrado." }, { status: 404 });
    }

    await prisma.affiliate.update({
      where: { id: params.id },
      data: { accountManagerId },
    });

    // Síncrono y best-effort: nunca lanza, nunca bloquea la respuesta.
    logAdminGlobalEvent({
      req,
      admin: admin.user,
      entity: "affiliate",
      entityId: params.id,
      action: "update",
      before: { accountManagerId: before.accountManagerId },
      after: { accountManagerId },
    });

    return NextResponse.json({ success: true, accountManagerId });
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Afiliado no encontrado." }, { status: 404 });
    }
    // Falta la columna affiliates."accountManagerId" (sql/afiliados-atribucion-
    // soporte.sql sin aplicar): 503 accionable en vez de un 500 mudo.
    console.error("[admin/affiliates/:id/account-manager] PUT:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}

// ── DELETE: atajo de "Quitar" ──────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const before = await prisma.affiliate.findUnique({
      where: { id: params.id },
      select: { accountManagerId: true },
    });
    if (!before) return NextResponse.json({ error: "Afiliado no encontrado." }, { status: 404 });

    await prisma.affiliate.update({
      where: { id: params.id },
      data: { accountManagerId: null },
    });

    logAdminGlobalEvent({
      req,
      admin: admin.user,
      entity: "affiliate",
      entityId: params.id,
      action: "update",
      before: { accountManagerId: before.accountManagerId },
      after: { accountManagerId: null },
    });

    return NextResponse.json({ success: true, accountManagerId: null });
  } catch (e) {
    if ((e as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Afiliado no encontrado." }, { status: 404 });
    }
    console.error("[admin/affiliates/:id/account-manager] DELETE:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}
