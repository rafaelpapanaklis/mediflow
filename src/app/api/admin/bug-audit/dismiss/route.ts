import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isAdminAuthed(): boolean {
  const token = cookies().get("admin_token")?.value;
  const secret = process.env.ADMIN_SECRET_TOKEN;
  return !!token && !!secret && token === secret;
}

/**
 * POST /api/admin/bug-audit/dismiss
 *
 * Body: { fingerprint: string, reason?: string }
 *
 * Marca un item como falso positivo. En runs futuros, el endpoint /run
 * filtra items con fingerprint dismissed antes de devolver y persistir.
 *
 * Solo platform admin (cookie `admin_token`).
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    fingerprint?: string;
    reason?: string;
  };
  if (!body.fingerprint || typeof body.fingerprint !== "string") {
    return NextResponse.json({ error: "missing_fingerprint" }, { status: 400 });
  }

  // El platform admin no tiene perfil de usuario en la app — usamos una
  // etiqueta fija para auditoría. Si en el futuro se agrega multi-account
  // de platform admins, podemos leer un header `x-admin-name`.
  const dismissedBy = "Platform Admin";

  await prisma.bugAuditDismissed.upsert({
    where: { fingerprint: body.fingerprint },
    update: {
      reason: body.reason ?? null,
      dismissedBy,
      dismissedAt: new Date(),
    },
    create: {
      id: `dismiss_${randomUUID().slice(0, 12)}`,
      fingerprint: body.fingerprint,
      reason: body.reason ?? null,
      dismissedBy,
    },
  });

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/admin/bug-audit/dismiss?fingerprint=...
 * Re-activa un item dismissed (lo saca de la lista).
 */
export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fingerprint = req.nextUrl.searchParams.get("fingerprint");
  if (!fingerprint) {
    return NextResponse.json({ error: "missing_fingerprint" }, { status: 400 });
  }

  await prisma.bugAuditDismissed.deleteMany({ where: { fingerprint } });
  return NextResponse.json({ success: true });
}
