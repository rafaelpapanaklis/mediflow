"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H14.
// El paciente marca desde el portal si usó sus elásticos/alineador hoy y
// cuántas horas. Auth de paciente — ver _patient-context.ts.

import { prisma } from "@/lib/prisma";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoPatientPortalContext, isMissingRelation } from "./_patient-context";

export interface LogElasticsComplianceFromPortalInput {
  treatmentPlanId: string;
  logDate: string; // YYYY-MM-DD, normalmente "hoy" en la zona del paciente
  wornHours?: number | null;
  usedElastics: boolean;
}

function toDateOnly(logDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) return null;
  const d = new Date(`${logDate}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function logElasticsComplianceFromPortal(
  input: LogElasticsComplianceFromPortalInput,
): Promise<ActionResult<{ id: string }>> {
  const date = toDateOnly(input.logDate);
  if (!date) return fail("Fecha inválida");
  if (input.wornHours != null && (input.wornHours < 0 || input.wornHours > 24)) {
    return fail("Horas inválidas");
  }

  const auth = await getOrthoPatientPortalContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { patientId, clinicId } = auth.data;

  try {
    const saved = await prisma.orthodonticElasticsLog.upsert({
      where: { treatmentPlanId_logDate: { treatmentPlanId: input.treatmentPlanId, logDate: date } },
      create: {
        treatmentPlanId: input.treatmentPlanId,
        patientId,
        clinicId,
        logDate: date,
        wornHours: input.wornHours ?? null,
        usedElastics: input.usedElastics,
        source: "PATIENT_PORTAL",
      },
      update: {
        wornHours: input.wornHours ?? null,
        usedElastics: input.usedElastics,
        // El registro sigue siendo del paciente aunque ya existiera (p. ej.
        // recepción lo había capturado antes por teléfono).
      },
      select: { id: true },
    });
    return ok({ id: saved.id });
  } catch (e) {
    if (isMissingRelation(e)) {
      return fail("Todavía no está disponible el registro de elásticos. Avisa a tu clínica.");
    }
    console.error("[ortho portal] logElasticsComplianceFromPortal failed:", e);
    return fail("No se pudo guardar tu registro. Intenta de nuevo.");
  }
}
