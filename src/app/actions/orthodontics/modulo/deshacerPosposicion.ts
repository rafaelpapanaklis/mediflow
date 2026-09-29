"use server";
// Ortodoncia — «Deshacer» una alerta pospuesta (H14 de la revisión final). Del
// cliente solo llegan el paciente y el tipo; `clinicId` sale de la sesión y el
// paciente se comprueba contra la clínica y su visibilidad antes de escribir.

import { revalidatePath } from "next/cache";
import { esTipoPosponible } from "@/lib/orthodontics/alertas-pospuestas";
import { faltaLaTabla, terminarPosposicion } from "@/lib/orthodontics/alertas-pospuestas-db";
import { getOrthoActionContext, loadPatientForOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function deshacerPosposicion(input: {
  patientId: string;
  tipo: string;
}): Promise<ActionResult<{ deshecha: true }>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  if (!ctx.clinicId) return fail("No autenticado");
  if (typeof input?.patientId !== "string" || !input.patientId) return fail("Falta el paciente");
  if (!esTipoPosponible(input.tipo)) return fail("Esta alerta no se puede posponer");

  const paciente = await loadPatientForOrtho({ ctx, patientId: input.patientId });
  if (isFailure(paciente)) return paciente;

  try {
    await terminarPosposicion({ clinicId: ctx.clinicId, patientId: paciente.data.id, tipo: input.tipo });
  } catch (e) {
    if (faltaLaTabla(e)) return fail("Posponer alertas todavía no está disponible en esta clínica.");
    console.error("[ortodoncia] deshacerPosposicion:", e);
    return fail("No se pudo deshacer. Inténtalo de nuevo.");
  }

  revalidatePath("/dashboard/orthodontics/alertas");
  return ok({ deshecha: true });
}
