import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }

/**
 * GET /api/admin/bug-audit/runs/[id] — devuelve el detalle (incluye items).
 * Solo SUPER_ADMIN.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const row = await prisma.bugAuditRun.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    runAt: row.runAt.toISOString(),
    triggeredBy: row.triggeredBy,
    durationMs: row.duration_ms,
    status: row.status,
    summary: row.summary,
    items: row.items,
  });
}
