"use server";
// Ortodoncia — «Editar plan» del Plan de tratamiento completo (ws1-t12). Permiso clínico
// (`medicalRecord.edit`); `clinicId` de la sesión, el caso y el paciente se comprueban contra la clínica y su
// visibilidad ANTES de escribir. Todo se valida en el servidor: rangos, FDI, fechas y —para lo que se AGREGA—
// que la clínica todavía ofrezca esa opción (lo que el caso ya tenía se conserva aunque la quitaran).
//
// Sin sql/ortodoncia-plan-de-tratamiento.sql pegado no escribe nada y lo dice.

import { revalidatePath } from "next/cache";
import { aplicarPlanDetalle, prepararGuardadoDelPlan } from "@/lib/orthodontics/plan-detalle-guardar";
import { getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function guardarPlanDeTratamiento(input: unknown): Promise<ActionResult<{ cambios: number }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  // Valida TODO sin escribir: forma, rangos, FDI, caso de esta clínica, paciente visible y opciones ofrecidas.
  const prep = await prepararGuardadoDelPlan(ctx, input);
  if (prep.ok === false) return fail(prep.error);
  const { caso, plan, extraccionesIndicadas, duracionMeses } = prep.preparado;

  const r = await aplicarPlanDetalle({
    ctx: { clinicId: ctx.clinicId, userId: ctx.userId },
    treatmentPlanId: caso.id,
    patientId: caso.patientId,
    plan,
    extraccionesIndicadas,
    duracionMeses,
  });
  if (r.ok === false) return fail(r.error);

  try {
    revalidatePath(`/dashboard/patients/${caso.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics/${caso.patientId}`);
    revalidatePath("/dashboard/orthodontics/alertas");
  } catch (e) {
    console.error("[ortho] guardarPlanDeTratamiento · revalidate:", e);
  }
  return ok({ cambios: r.cambios.campos.length });
}
