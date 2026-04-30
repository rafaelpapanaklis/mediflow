import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/bug-audit/dismiss
 *
 * Body: { fingerprint: string, reason?: string }
 *
 * Marca un item como falso positivo. En runs futuros, el endpoint /run
 * filtra items con fingerprint dismissed antes de devolver y persistir.
 *
 * Solo SUPER_ADMIN.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    fingerprint?: string;
    reason?: string;
  };
  if (!body.fingerprint || typeof body.fingerprint !== "string") {
    return NextResponse.json({ error: "missing_fingerprint" }, { status: 400 });
  }

  const dismissedBy =
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
    user.email ||
    user.id;

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
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const fingerprint = req.nextUrl.searchParams.get("fingerprint");
  if (!fingerprint) {
    return NextResponse.json({ error: "missing_fingerprint" }, { status: 400 });
  }

  await prisma.bugAuditDismissed.deleteMany({ where: { fingerprint } });
  return NextResponse.json({ success: true });
}
