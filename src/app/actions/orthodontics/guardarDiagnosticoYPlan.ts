"use server";
// Ortodoncia — el «Guardar» ÚNICO de la ventana del caso al editar (ws1-t12 + ws1-t8): el diagnóstico completo y el
// plan de tratamiento completo se guardan JUNTOS, en UNA transacción, con un solo clic sea cual sea el paso donde
// esté quien edita. Antes cada paso guardaba lo suyo y lo cambiado en el otro se perdía en silencio.
//
// Tres tiempos (los del diagnóstico son de ws1-t8, `diagnostico-guardar.ts`):
//   1. Se prepara y valida TODO sin escribir: el diagnóstico (`prepararGuardadoDelDiagnostico`) y el plan
//      (`prepararGuardadoDelPlan`). Cualquier error se dice y no se escribe nada.
//   2. Se escribe el plan y, dentro de LA MISMA transacción, el diagnóstico: si uno falla, ninguno queda a medias.
//   3. Ya confirmada la transacción, cada uno deja su movimiento en el paciente.
//
// Permiso clínico (`medicalRecord.edit`); `clinicId`/`userId` de la sesión; el diagnóstico tiene que ser el del caso.
// Sin sql/ortodoncia-plan-de-tratamiento.sql el plan no se puede guardar: el diagnóstico sí (solo) y se dice.

import { revalidatePath } from "next/cache";
import { columnaDePlanDetalleExiste } from "@/lib/orthodontics/plan-detalle-db";
import { aplicarPlanDetalle, MENSAJE_SIN_SQL, prepararGuardadoDelPlan } from "@/lib/orthodontics/plan-detalle-guardar";
import {
  ejecutarGuardadoDelDiagnostico,
  movimientoDelGuardado,
  prepararGuardadoDelDiagnostico,
  type ResultadoDelGuardado,
} from "@/lib/orthodontics/diagnostico-guardar";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface ResultadoDelGuardadoUnico {
  cambiosDelPlan: number;
  /** false = el plan no se pudo guardar (falta su SQL); el diagnóstico sí. */
  planGuardado: boolean;
  /** Lo nuevo del diagnóstico no se guardó (falta su SQL) o el plan no se guardó: se dice. */
  aviso: string | null;
}

/**
 * `input` = lo de `guardarPlanDeTratamiento` (`treatmentPlanId`, `plan`, `extraccionesIndicadas`, `duracionMeses`) más
 * `diagnosisId` y `diagnostico` (lo que recibe `updateDiagnosis`, sin el id). Sin `diagnostico` solo se guarda el plan.
 */
export async function guardarDiagnosticoYPlan(input: unknown): Promise<ActionResult<ResultadoDelGuardadoUnico>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  // 1) Preparar y validar TODO, sin escribir.
  const planPrep = await prepararGuardadoDelPlan(ctx, o);
  if (planPrep.ok === false) return fail(planPrep.error);
  const { caso, plan, extraccionesIndicadas, duracionMeses } = planPrep.preparado;

  let dxPrep: Awaited<ReturnType<typeof prepararGuardadoDelDiagnostico>> | null = null;
  if (o.diagnostico && typeof o.diagnostico === "object") {
    const diagnosisId = typeof o.diagnosisId === "string" ? o.diagnosisId : "";
    // El diagnóstico tiene que ser el de ESTE caso (el id llega del navegador).
    if (!diagnosisId || diagnosisId !== caso.diagnosisId) return fail("Diagnóstico no encontrado");
    dxPrep = await prepararGuardadoDelDiagnostico(ctx, { ...(o.diagnostico as Record<string, unknown>), diagnosisId });
    if (dxPrep.ok === false) return fail(dxPrep.error);
    if (dxPrep.preparado.patientId !== caso.patientId) return fail("Diagnóstico no encontrado");
  }
  const dx = dxPrep && dxPrep.ok ? dxPrep.preparado : null;

  const movimientoDelDiagnostico = async (r: ResultadoDelGuardado) => {
    if (!dx) return;
    const mov = movimientoDelGuardado(dx, r);
    if (!mov) return; // nada cambió: sin fila en Movimientos
    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.DIAGNOSIS_UPDATED,
      entityType: "OrthodonticDiagnosis",
      entityId: r.updated.id,
      patientId: dx.patientId,
      before: mov.before,
      after: mov.after,
    });
  };
  const refrescar = () => {
    try {
      revalidatePath(`/dashboard/patients/${caso.patientId}`);
      revalidatePath(`/dashboard/patients/${caso.patientId}/orthodontics`);
      revalidatePath(`/dashboard/specialties/orthodontics/${caso.patientId}`);
      revalidatePath("/dashboard/orthodontics/alertas");
    } catch (e) {
      console.error("[ortho] guardarDiagnosticoYPlan · revalidate:", e);
    }
  };

  try {
    // Sin la columna del plan no hay plan que guardar: el diagnóstico se guarda solo y se dice.
    if (!(await columnaDePlanDetalleExiste())) {
      if (!dx) return fail(MENSAJE_SIN_SQL);
      const r = await ejecutarGuardadoDelDiagnostico(dx);
      await movimientoDelDiagnostico(r);
      refrescar();
      return ok({ cambiosDelPlan: 0, planGuardado: false, aviso: `El diagnóstico se guardó. ${MENSAJE_SIN_SQL}` });
    }

    // 2) El plan y, en su misma transacción, el diagnóstico.
    let resultadoDx: ResultadoDelGuardado | null = null;
    const r = await aplicarPlanDetalle({
      ctx: { clinicId: ctx.clinicId, userId: ctx.userId },
      treatmentPlanId: caso.id,
      patientId: caso.patientId,
      plan,
      extraccionesIndicadas,
      duracionMeses,
      enLaTransaccion: dx
        ? async (tx) => {
            resultadoDx = await ejecutarGuardadoDelDiagnostico(dx, tx);
          }
        : undefined,
    });
    if (r.ok === false) return fail(r.error);

    // 3) Ya confirmada: el movimiento del diagnóstico (el del plan lo dejó `aplicarPlanDetalle`).
    const guardadoDx = resultadoDx as ResultadoDelGuardado | null;
    if (guardadoDx) await movimientoDelDiagnostico(guardadoDx);
    refrescar();
    return ok({ cambiosDelPlan: r.cambios.campos.length, planGuardado: true, aviso: guardadoDx?.avisoDetalle ?? null });
  } catch (e) {
    console.error("[ortho] guardarDiagnosticoYPlan failed:", e);
    return fail("No se pudo guardar. No se guardó nada: inténtalo de nuevo.");
  }
}
