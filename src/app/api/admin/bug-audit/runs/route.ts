import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isAdminAuthed(): boolean {
  const token = cookies().get("admin_token")?.value;
  const secret = process.env.ADMIN_SECRET_TOKEN;
  return !!token && !!secret && token === secret;
}

/**
 * GET /api/admin/bug-audit/runs
 *
 * Devuelve los últimos 10 runs (sin items completos — solo summary +
 * metadata, para no devolver megabytes). El detalle se carga al click
 * en un run específico via GET /runs/[id] (separado).
 *
 * Solo platform admin (cookie `admin_token`).
 */
export async function GET() {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
