"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026).
// H15: el paciente ya subió el binario a storage (vía la API route de
// upload) y esto solo crea el registro de metadatos + lo pone PENDING para
// que la clínica lo revise. Auth de paciente — ver _patient-context.ts.

import { prisma } from "@/lib/prisma";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoPatientPortalContext, isMissingRelation } from "./_patient-context";

const ANGLES = ["FRONTAL", "LATERAL", "SMILE", "INTRAORAL", "OTHER"] as const;

export interface SubmitMonitoringPhotoInput {
  treatmentPlanId: string;
  storageKey: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  angle: (typeof ANGLES)[number];
  patientNote?: string | null;
}

export async function submitMonitoringPhoto(
  input: SubmitMonitoringPhotoInput,
): Promise<ActionResult<{ id: string }>> {
  if (!input.storageKey) return fail("Falta la foto");
  if (!ANGLES.includes(input.angle)) return fail("Ángulo inválido");

  const auth = await getOrthoPatientPortalContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { patientId, clinicId } = auth.data;

  try {
    const created = await prisma.orthodonticMonitoringPhoto.create({
      data: {
        treatmentPlanId: input.treatmentPlanId,
        patientId,
        clinicId,
        storageKey: input.storageKey,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        angle: input.angle,
        patientNote: input.patientNote ?? null,
        reviewStatus: "PENDING",
      },
      select: { id: true },
    });
    return ok({ id: created.id });
  } catch (e) {
    if (isMissingRelation(e)) {
      return fail("El monitoreo con fotos todavía no está disponible. Avisa a tu clínica.");
    }
    console.error("[ortho portal] submitMonitoringPhoto failed:", e);
    return fail("No se pudo enviar la foto. Intenta de nuevo.");
  }
}
