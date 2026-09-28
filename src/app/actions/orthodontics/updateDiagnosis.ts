"use server";
// Orthodontics — action 2/15: updateDiagnosis. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { updateDiagnosisSchema } from "@/lib/validation/orthodontics";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

// Ola 1 (ws1-t6) — campos de sql/ortodoncia-alta-caso.sql: si el update los
// toca y la columna aún no existe (P2021/P2022), se reintenta sin ellos en
// vez de romper el resto de la edición.
const ALTA_CASO_DIAGNOSIS_FIELDS = [
  "referredByDoctorId",
  "inObservation",
  "nextObservationDate",
] as const;

export async function updateDiagnosis(
  input: unknown,
): Promise<ActionResult<{ id: string; altaCasoFieldsSaved: boolean }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = updateDiagnosisSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const before = await prisma.orthodonticDiagnosis.findFirst({
    where: { id: parsed.data.diagnosisId, clinicId: ctx.clinicId, deletedAt: null },
  });
  if (!before) return fail("Diagnóstico no encontrado");

  const { diagnosisId, patientId, ...rest } = parsed.data;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) data[key] = value;
  }
  if (typeof data.nextObservationDate === "string") {
    data.nextObservationDate = new Date(data.nextObservationDate);
  }

  try {
    let altaCasoFieldsSaved = true;
    const updated = await prisma.orthodonticDiagnosis
      .update({ where: { id: diagnosisId }, data })
      .catch(async (e) => {
        const touchesAltaCaso = ALTA_CASO_DIAGNOSIS_FIELDS.some((k) => k in data);
        if (!touchesAltaCaso || !isMissingColumnError(e)) throw e;
        altaCasoFieldsSaved = false;
        const reduced = { ...data };
        for (const k of ALTA_CASO_DIAGNOSIS_FIELDS) delete reduced[k];
        console.error(
          "[ortho] updateDiagnosis: columnas de alta-caso.sql aún no existen, se guarda sin ellas:",
          e,
        );
        return prisma.orthodonticDiagnosis.update({ where: { id: diagnosisId }, data: reduced });
      });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.DIAGNOSIS_UPDATED,
      entityType: "OrthodonticDiagnosis",
      entityId: updated.id,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    revalidatePath(`/dashboard/patients/${updated.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${updated.patientId}`);
    void patientId; // patientId del input solo es informativo
    return ok({ id: updated.id, altaCasoFieldsSaved });
  } catch (e) {
    console.error("[ortho] updateDiagnosis failed:", e);
    return fail("No se pudo actualizar el diagnóstico");
  }
}
