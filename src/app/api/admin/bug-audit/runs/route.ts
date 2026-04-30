import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/bug-audit/runs
 *
 * Devuelve los últimos 10 runs (sin items completos — solo summary +
 * metadata, para no devolver megabytes). El detalle se carga al click
 * en un run específico via GET /runs/[id] (separado).
 *
 * Solo SUPER_ADMIN.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const rows = await prisma.bugAuditRun.findMany({
    orderBy: { runAt: "desc" },
    take: 10,
    select: {
      id: true,
      runAt: true,
      triggeredBy: true,
      durationMs: true,
      status: true,
      summary: true,
    },
  });

  return NextResponse.json({
    runs: rows.map((r) => ({
      id: r.id,
      runAt: r.runAt.toISOString(),
      triggeredBy: r.triggeredBy,
      durationMs: r.durationMs,
      status: r.status,
      summary: r.summary,
    })),
  });
}
