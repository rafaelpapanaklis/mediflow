"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H14.

import { prisma } from "@/lib/prisma";
import { summarizeElasticsCompliance, type ElasticsLogEntry } from "@/lib/orthodontics/elastics/compliance";
import { isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "../imagen/_context";

export interface ElasticsComplianceView {
  windowDays: number;
  loggedDays: number;
  compliancePct: number | null;
  avgHours: number | null;
  isLow: boolean;
  logs: { date: string; wornHours: number | null; usedElastics: boolean; source: string }[];
}

const EMPTY: ElasticsComplianceView = {
  windowDays: 0,
  loggedDays: 0,
  compliancePct: null,
  avgHours: null,
  isLow: false,
  logs: [],
};

/** Self-fetch para la ranura de cumplimiento — se calla si no hay nada. */
export async function getElasticsCompliance(
  treatmentPlanId: string,
  opts?: { windowDays?: number; targetHoursPerDay?: number },
): Promise<ActionResult<ElasticsComplianceView>> {
  const auth = await getOrthoImagingContext(treatmentPlanId, { write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const windowDays = opts?.windowDays ?? 14;
  const targetHoursPerDay = opts?.targetHoursPerDay ?? 20;

  try {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - windowDays);

    const rows = await prisma.orthodonticElasticsLog.findMany({
      where: { treatmentPlanId, clinicId: ctx.clinicId, logDate: { gte: since } },
      orderBy: { logDate: "desc" },
    });

    const entries: ElasticsLogEntry[] = rows.map((r) => ({
      date: r.logDate.toISOString().slice(0, 10),
      wornHours: r.wornHours,
      usedElastics: r.usedElastics,
    }));

    const summary = summarizeElasticsCompliance(entries, { windowDays, targetHoursPerDay });

    return ok({
      ...summary,
      logs: rows.map((r) => ({
        date: r.logDate.toISOString().slice(0, 10),
        wornHours: r.wornHours,
        usedElastics: r.usedElastics,
        source: r.source,
      })),
    });
  } catch (e) {
    if (isMissingRelation(e)) return ok(EMPTY);
    console.error("[ortho alineadores] getElasticsCompliance failed:", e);
    return ok(EMPTY);
  }
}
