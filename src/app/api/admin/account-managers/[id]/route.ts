// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/account-managers/[id] — editar, pausar/activar y eliminar.
// ADMIN-ONLY. Ver el header de ../route.ts para el contexto completo.
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

// ── PATCH: editar campos sueltos (incluye pausar/activar con { status }) ───
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const parsed = parseAccountManagerInput(body, true);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No hay nada que actualizar." }, { status: 400 });
  }

  try {
    const updated = await prisma.accountManager.update({
      where: { id: params.id },
      data: parsed.data,
      select: SELECT,
    });
    return NextResponse.json({ manager: toAdminRow(updated) });
  } catch (e) {
    // P2025 = fila inexistente; cualquier otro fallo con esta tabla suele ser
    // "el SQL todavía no está aplicado".
    if ((e as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Manager no encontrado." }, { status: 404 });
    }
    console.error("[admin/account-managers/:id] PATCH:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}

// ── DELETE: elimina el manager ─────────────────────────────────────────────
// Las clínicas asignadas NO se borran: el FK es ON DELETE SET NULL, así que
// quedan sin manager y su tarjeta vuelve al estado vacío. Devolvemos cuántas
// fueron para que la UI lo confirme (y lo reporte después).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const existing = await prisma.accountManager.findUnique({
      where: { id: params.id },
      select: { id: true, _count: { select: { clinics: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Manager no encontrado." }, { status: 404 });

    const unassignedClinics = existing._count.clinics;
    await prisma.accountManager.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true, unassignedClinics });
  } catch (e) {
    console.error("[admin/account-managers/:id] DELETE:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
}
