import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runAllScanners } from "@/lib/bug-audit/registry";
import { summarize } from "@/lib/bug-audit/helpers";
import type { BugItem, ScannerSection } from "@/lib/bug-audit/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180; // 3 min hard cap.

const VALID_SECTIONS: ScannerSection[] = ["backend", "security", "performance", "quality", "frontend"];

/**
 * POST /api/admin/bug-audit/run
 *
 * Body opcional: { sections?: ("backend"|"security"|"performance"|"quality"|"frontend")[] }
 *
 * Solo SUPER_ADMIN. Ejecuta todos los scanners (o solo los filtrados),
 * dedupe contra bug_audit_dismissed, persiste en bug_audit_runs,
 * devuelve summary + items.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    sections?: string[];
  };
  const sections = body.sections?.filter((s): s is ScannerSection =>
    (VALID_SECTIONS as string[]).includes(s),
  );

  const t0 = Date.now();
  const results = await runAllScanners(sections && sections.length > 0 ? sections : undefined);
  const allItems: BugItem[] = results.flatMap((r) => r.items);

  // Filtrar items dismissed por fingerprint.
  const dismissedRows = await prisma.bugAuditDismissed.findMany({
    select: { fingerprint: true },
  });
  const dismissedSet = new Set(dismissedRows.map((d) => d.fingerprint));
  const filteredItems = allItems.filter((it) => !dismissedSet.has(it.fingerprint));

  const summary = summarize(filteredItems);
  const durationMs = Date.now() - t0;
  const id = `run_${Date.now()}_${randomUUID().slice(0, 8)}`;

  const triggeredBy =
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() ||
    user.email ||
    user.id;

  // Persist. Si la tabla no existe (Supabase no aplicó SQL), devolvemos
  // resultado pero loggeamos.
  try {
    await prisma.bugAuditRun.create({
      data: {
        id,
        triggeredBy,
        duration_ms: durationMs,
        status: "completed",
        summary: summary as object,
        items: filteredItems as unknown as object,
      },
    });
  } catch (e) {
    console.error("[bug-audit] persist failed:", (e as Error).message);
  }

  return NextResponse.json({
    id,
    runAt: new Date().toISOString(),
    triggeredBy,
    durationMs,
    status: "completed",
    summary,
    items: filteredItems,
    perSection: results.map((r) => ({
      section: r.section,
      count: r.items.length,
      durationMs: r.durationMs,
    })),
  });
}
