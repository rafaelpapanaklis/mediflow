import { isAdminAuthed } from "@/lib/admin-auth";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params { params: { id: string } }


/**
 * GET /api/admin/bug-audit/runs/[id] — devuelve el detalle (incluye items).
 * Solo platform admin (cookie `admin_token`).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.bugAuditRun.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    runAt: row.runAt.toISOString(),
    triggeredBy: row.triggeredBy,
    durationMs: row.durationMs,
    status: row.status,
    summary: row.summary,
    items: row.items,
  });
}
