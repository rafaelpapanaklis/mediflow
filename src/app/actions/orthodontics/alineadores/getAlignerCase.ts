"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H12.

import { prisma } from "@/lib/prisma";
import { computeExpectedTray } from "@/lib/orthodontics/alineadores/expected-tray";
import { isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "../imagen/_context";

export interface AlignerEventRow {
  id: string;
  eventType: string;
  trayNumber: number | null;
  quantity: number | null;
  notes: string | null;
  createdAt: string;
}

export interface AlignerCaseRow {
  id: string;
  systemName: string | null;
  totalTrays: number;
  currentTray: number;
  changeIntervalDays: number;
  startedAt: string;
  attachmentsPlaced: number | null;
  attachmentsLost: number;
  refinementCount: number;
  status: "ACTIVE" | "PAUSED" | "FINISHED";
  notes: string | null;
  expectedTray: number;
  daysSinceStart: number;
  isPastLastTray: boolean;
  events: AlignerEventRow[];
}

/** Self-fetch para la ranura de alineadores. null si el caso no tiene alineadores configurados. */
export async function getAlignerCase(treatmentPlanId: string): Promise<ActionResult<AlignerCaseRow | null>> {
  const auth = await getOrthoImagingContext(treatmentPlanId, { write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  try {
    const aligner = await prisma.orthodonticAligner.findFirst({
      where: { treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      include: { events: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
    if (!aligner) return ok(null);

    const expected = computeExpectedTray({
      startedAt: aligner.startedAt,
      totalTrays: aligner.totalTrays,
      changeIntervalDays: aligner.changeIntervalDays,
    });

    return ok({
      id: aligner.id,
      systemName: aligner.systemName,
      totalTrays: aligner.totalTrays,
      currentTray: aligner.currentTray,
      changeIntervalDays: aligner.changeIntervalDays,
      startedAt: aligner.startedAt.toISOString(),
      attachmentsPlaced: aligner.attachmentsPlaced,
      attachmentsLost: aligner.attachmentsLost,
      refinementCount: aligner.refinementCount,
      // status es String en la base (CHECK constraint, no enum nativo — ver
      // nota en schema.prisma) validado al escribir; se afirma al leer.
      status: aligner.status as AlignerCaseRow["status"],
      notes: aligner.notes,
      expectedTray: expected.expectedTray,
      daysSinceStart: expected.daysSinceStart,
      isPastLastTray: expected.isPastLastTray,
      events: aligner.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        trayNumber: e.trayNumber,
        quantity: e.quantity,
        notes: e.notes,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (isMissingRelation(e)) return ok(null);
    console.error("[ortho alineadores] getAlignerCase failed:", e);
    return ok(null);
  }
}
