/**
 * POST /api/admin/bug-audit/run-extras
 *
 * Orquesta los 10 scanners "extras" (webhooks, crons, storage, AI, env,
 * ARCO, backups, tests, a11y, migrations) y guarda un run en
 * `bug_audit_runs` con summary.source = 'extras'. La UI principal de
 * /dashboard/admin/bug-audit (Git 1) lista runs por createdAt sin
 * distinguir source — así que aparecerá automáticamente cuando se
 * mergeen ambos branches.
 *
 * Auth: solo SUPER_ADMIN. clinicId del run = clinic del actor (los
 * scanners filesystem son globales pero registramos quién corrió).
 *
 * Timeout efectivo: ~3 min (Vercel Pro). Cada scanner se mide; si uno
 * tarda >60s, el reporte lo registra para investigar.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import {
  runWebhookScan, runCronScan, runStorageScan, runAIScan, runEnvScan,
  runArcoScan, runBackupScan, runTestCoverageScan, runA11yScan,
  runMigrationScan,
} from "@/lib/audit/scanners";
import { summarize, type AuditItem, type ScanResult } from "@/lib/audit/types";

// Vercel: por default 10s, subimos a 180s. Solo aplica en Vercel Pro+.
export const maxDuration = 180;
// El endpoint NO se puede cachear — siempre escanea fresh.
export const dynamic = "force-dynamic";

interface ScannerEntry {
  id: string;
  fn: () => Promise<ScanResult>;
}

const SCANNERS: ScannerEntry[] = [
  { id: "webhooks",   fn: runWebhookScan },
  { id: "crons",      fn: runCronScan },
  { id: "storage",    fn: runStorageScan },
  { id: "ai",         fn: runAIScan },
  { id: "env",        fn: runEnvScan },
  { id: "arco",       fn: runArcoScan },
  { id: "backups",    fn: runBackupScan },
  { id: "tests",      fn: runTestCoverageScan },
  { id: "a11y",       fn: runA11yScan },
  { id: "migrations", fn: runMigrationScan },
];

export async function POST(_req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: "Solo SUPER_ADMIN" }, { status: 403 });
  }

  const t0 = Date.now();
  const allItems: AuditItem[] = [];
  // Tracking por scanner — útil para detectar cuál se ralentiza.
  const perScanner: Record<string, { count: number; duration_ms: number; error?: string }> = {};

  // Corremos todos en paralelo. Si uno falla, capturamos el error y los
  // demás siguen. Es un audit, no queremos que un bug en un scanner tumbe
  // todo el reporte.
  const results = await Promise.allSettled(
    SCANNERS.map(async (s) => {
      const t = Date.now();
      try {
        const r = await s.fn();
        return { id: s.id, ...r };
      } catch (e: any) {
        return { id: s.id, items: [], duration_ms: Date.now() - t, error: e?.message ?? "scan_failed" };
      }
    }),
  );

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const v = r.value;
    perScanner[v.id] = {
      count: v.items.length,
      duration_ms: v.duration_ms,
      error: (v as any).error,
    };
    allItems.push(...v.items);
  }

  const totalDuration = Date.now() - t0;
  const summary = summarize(allItems, "extras");
  // Adjuntamos info adicional al summary para debug (la UI puede ignorarlo).
  const fullSummary = {
    ...summary,
    duration_ms: totalDuration,
    per_scanner: perScanner,
  };

  // Guardamos vía SQL raw para no depender de un modelo Prisma —
  // bug_audit_runs es compartida con Git 1 y queremos zero coupling con su
  // schema.prisma. La tabla existe via sql/bug-audit-runs.sql idempotente.
  const runIdRow = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "bug_audit_runs" ("clinicId", "userId", summary, items, "durationMs")
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     RETURNING id`,
    ctx.clinicId,
    ctx.userId,
    JSON.stringify(fullSummary),
    JSON.stringify(allItems),
    totalDuration,
  );

  const runId = runIdRow[0]?.id ?? null;
  // El run en sí mismo queda registrado en bug_audit_runs con userId+clinicId
  // del actor; no agregamos un audit_log adicional para no duplicar fuentes.

  return NextResponse.json({
    success: true,
    run_id: runId,
    summary: fullSummary,
    items_count: allItems.length,
  });
}
