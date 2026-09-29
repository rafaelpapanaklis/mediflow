"use server";
// Ortodoncia — «Editar plan» del Plan de tratamiento completo (ws1-t12). Permiso clínico
// (`medicalRecord.edit`); `clinicId` de la sesión, el caso y el paciente se comprueban contra la clínica y su
// visibilidad ANTES de escribir. Todo se valida en el servidor: rangos, FDI, fechas y —para lo que se AGREGA—
// que la clínica todavía ofrezca esa opción (lo que el caso ya tenía se conserva aunque la quitaran).
//
// Sin sql/ortodoncia-plan-de-tratamiento.sql pegado no escribe nada y lo dice.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { aplicarPlanDetalle } from "@/lib/orthodontics/plan-detalle-guardar";
import { cargarPlanDetalle, leerOpcionesDelPlan } from "@/lib/orthodontics/plan-detalle-db";
import { esFdiValido, validarContraOpciones, validarPlanDetalle } from "@/lib/orthodontics/plan-detalle";
import { getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function guardarPlanDeTratamiento(input: unknown): Promise<ActionResult<{ cambios: number }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const treatmentPlanId = typeof o.treatmentPlanId === "string" ? o.treatmentPlanId : "";
  if (!treatmentPlanId) return fail("Falta el caso");

  const validado = validarPlanDetalle(o.plan);
  if (!validado.ok) return fail(validado.error);

  let indicadas: number[] | undefined;
  if (o.extraccionesIndicadas !== undefined && o.extraccionesIndicadas !== null) {
    if (!Array.isArray(o.extraccionesIndicadas) || o.extraccionesIndicadas.some((x) => !esFdiValido(x))) {
      return fail("Extracciones indicadas: usa piezas válidas en notación FDI (por ejemplo 14, 24).");
    }
    indicadas = o.extraccionesIndicadas as number[];
  }
  let duracionMeses: number | undefined;
  if (o.duracionMeses !== undefined && o.duracionMeses !== null && o.duracionMeses !== "") {
    const n = Number(o.duracionMeses);
    if (!Number.isInteger(n) || n < 3 || n > 60) return fail("Tiempo de tratamiento: de 3 a 60 meses.");
    duracionMeses = n;
  }

  // El caso es de ESTA clínica y el paciente lo puede ver quien pregunta (mismo criterio que Cobro).
  const caso = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, patient: { select: { visibleUserIds: true } } },
  });
  if (!caso) return fail("Caso no encontrado");
  if (!canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, caso.patient?.visibleUserIds)) {
    return fail("Caso no encontrado");
  }

  // Lo que se AGREGA tiene que seguir ofreciéndose; lo que el caso ya tenía se conserva.
  const [anterior, opciones] = await Promise.all([cargarPlanDetalle(ctx.clinicId, caso.id), leerOpcionesDelPlan(ctx.clinicId)]);
  const fuera = validarContraOpciones(validado.plan, anterior, opciones.opciones);
  if (fuera) return fail(fuera);

  const r = await aplicarPlanDetalle({
    ctx: { clinicId: ctx.clinicId, userId: ctx.userId },
    treatmentPlanId: caso.id,
    patientId: caso.patientId,
    plan: validado.plan,
    extraccionesIndicadas: indicadas,
    duracionMeses,
  });
  if (!r.ok) return fail(r.error);

  try {
    revalidatePath(`/dashboard/patients/${caso.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics/${caso.patientId}`);
    revalidatePath("/dashboard/orthodontics/alertas");
  } catch (e) {
    console.error("[ortho] guardarPlanDeTratamiento · revalidate:", e);
  }
  return ok({ cambios: r.cambios.campos.length });
}
