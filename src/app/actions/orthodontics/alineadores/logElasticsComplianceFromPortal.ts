"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H14.
// El paciente marca desde el portal si usó sus elásticos/alineador hoy y
// cuántas horas. Auth de paciente — ver _patient-context.ts.
//
// ws1-t5 (ronda 6, hallazgo 95): «hoy» lo decide el SERVIDOR con la zona
// horaria de la clínica. Antes lo mandaba el navegador en UTC y, en México,
// lo que se marcaba después de las 18:00 quedaba guardado en el día
// siguiente. `logDate` se sigue aceptando para no romper una pestaña vieja,
// pero ya no se usa.

import { prisma } from "@/lib/prisma";
import { diaDeLaClinica, fechaDeRegistro } from "@/lib/patient-portal/ortodoncia-portal";
import { registrarMovimientoExterno } from "@/lib/movimientos-paciente/registrar";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoPatientPortalContext, isMissingRelation } from "./_patient-context";

export interface LogElasticsComplianceFromPortalInput {
  treatmentPlanId: string;
  /** @deprecated El día lo calcula el servidor en la zona de la clínica. */
  logDate?: string;
  wornHours?: number | null;
  usedElastics: boolean;
}

export async function logElasticsComplianceFromPortal(
  input: LogElasticsComplianceFromPortalInput,
): Promise<ActionResult<{ id: string }>> {
  if (input.wornHours != null && (!Number.isFinite(input.wornHours) || input.wornHours < 0 || input.wornHours > 24)) {
    return fail("Horas inválidas");
  }

  // Escritura: caso abierto y módulo activo (fila 16 del mapa).
  const auth = await getOrthoPatientPortalContext(input.treatmentPlanId, { escritura: true });
  if (isFailure(auth)) return auth;
  const { patientId, clinicId, zonaHoraria } = auth.data;
  const date = fechaDeRegistro(diaDeLaClinica(new Date(), zonaHoraria));

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
    await registrarMovimientoExterno({
      actor: "patient",
      clinicId,
      patientId,
      entityType: "orthodontic-control",
      entityId: saved.id,
      action: "update",
      texto: input.usedElastics ? "Registró que usó sus elásticos hoy (portal)" : "Registró que hoy no usó sus elásticos (portal)",
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
