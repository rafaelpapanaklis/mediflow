"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H12.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "../imagen/_context";

export interface UpsertAlignerCaseInput {
  treatmentPlanId: string;
  systemName?: string | null;
  totalTrays: number;
  currentTray: number;
  changeIntervalDays: number;
  startedAt: string; // ISO date
  attachmentsPlaced?: number | null;
  notes?: string | null;
}

function validate(input: UpsertAlignerCaseInput): string | null {
  if (!input.treatmentPlanId) return "Falta el caso de ortodoncia";
  if (!Number.isFinite(input.totalTrays) || input.totalTrays < 1) return "Total de alineadores inválido";
  if (!Number.isFinite(input.currentTray) || input.currentTray < 1) return "Alineador actual inválido";
  if (!Number.isFinite(input.changeIntervalDays) || input.changeIntervalDays < 1) {
    return "Intervalo de cambio inválido";
  }
  if (Number.isNaN(Date.parse(input.startedAt))) return "Fecha de inicio inválida";
  return null;
}

/** Crea o edita el caso de alineadores. Un caso por tratamiento (unique). */
export async function upsertAlignerCase(input: UpsertAlignerCaseInput): Promise<ActionResult<{ id: string }>> {
  const err = validate(input);
  if (err) return fail(err);

  const auth = await getOrthoImagingContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { ctx, patientId } = auth.data;

  try {
    const data = {
      systemName: input.systemName ?? null,
      totalTrays: input.totalTrays,
      currentTray: input.currentTray,
      changeIntervalDays: input.changeIntervalDays,
      startedAt: new Date(input.startedAt),
      attachmentsPlaced: input.attachmentsPlaced ?? null,
      notes: input.notes ?? null,
    };

    const saved = await prisma.orthodonticAligner.upsert({
      where: { treatmentPlanId: input.treatmentPlanId },
      create: { treatmentPlanId: input.treatmentPlanId, patientId, clinicId: ctx.clinicId, ...data },
      update: data,
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: "aligner_case_upserted",
      entityType: "OrthodonticAligner",
      entityId: saved.id,
      patientId: patientId,
      after: { treatmentPlanId: input.treatmentPlanId, ...data },
    });

    revalidatePath(`/dashboard/patients/${patientId}/orthodontics`);

    return ok({ id: saved.id });
  } catch (e) {
    if (isMissingRelation(e)) {
      return fail("El seguimiento de alineadores todavía no está configurado en esta clínica (falta pegar el SQL)");
    }
    console.error("[ortho alineadores] upsertAlignerCase failed:", e);
    return fail("No se pudo guardar el caso de alineadores");
  }
}
