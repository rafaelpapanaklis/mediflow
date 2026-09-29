"use server";
// Ortodoncia — las listas de la clínica para el plan de tratamiento (ws1-t12). Ajuste de la clínica: mismo permiso
// que el resto de Configuración (`settings.edit`). `clinicId` de la sesión, nunca del cliente. «Quitar» una opción
// solo deja de ofrecerla en planes nuevos: los casos que ya la usan conservan su texto.

import { revalidatePath } from "next/cache";
import { getOrthoConfigActionContext, auditOrtho } from "./_helpers";
import { LISTAS_DEL_PLAN, normalizarFrecuenciaDeControl, normalizarOpciones, validarOpciones, type OpcionesDelPlan } from "@/lib/orthodontics/plan-detalle";
import { guardarOpcionesDelPlan as guardarEnBase } from "@/lib/orthodontics/plan-detalle-db";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function guardarOpcionesDelPlanAction(input: unknown): Promise<ActionResult<{ opciones: OpcionesDelPlan; frecuenciaControlDias: number }>> {
  const auth = await getOrthoConfigActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const cruda = (input as { opciones?: unknown } | null)?.opciones;
  if (!cruda || typeof cruda !== "object" || Array.isArray(cruda)) return fail("Datos inválidos");
  const o = cruda as Record<string, unknown>;
  for (const l of LISTAS_DEL_PLAN) {
    if (!Array.isArray(o[l])) return fail("Datos inválidos");
  }
  const problema = validarOpciones(
    Object.fromEntries(
      LISTAS_DEL_PLAN.map((l) => [
        l,
        (o[l] as unknown[]).map((x) => ({ nombre: x && typeof x === "object" && typeof (x as { nombre?: unknown }).nombre === "string" ? (x as { nombre: string }).nombre : "" })),
      ]),
    ),
  );
  if (problema) return fail(problema);

  const frecuencia = normalizarFrecuenciaDeControl((input as { frecuenciaControlDias?: unknown } | null)?.frecuenciaControlDias);
  const r = await guardarEnBase(ctx.clinicId, ctx.userId, normalizarOpciones(o), frecuencia);
  if (r.ok === false) {
    return fail(
      r.motivo === "sin-columna"
        ? "Falta aplicar sql/ortodoncia-plan-de-tratamiento.sql: las listas no se guardaron"
        : "No se pudieron guardar las listas",
    );
  }
  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.CLINIC_SETTINGS_UPDATED,
    entityType: "OrthodonticsClinicSettings",
    entityId: ctx.clinicId,
    meta: {
      accion: "opciones-del-plan-de-tratamiento",
      frecuenciaControlDias: r.frecuenciaControlDias,
      listas: Object.fromEntries(LISTAS_DEL_PLAN.map((l) => [l, r.opciones[l].map((x) => ({ nombre: x.nombre, activa: x.activa }))])),
    },
  });
  revalidatePath("/dashboard/orthodontics/configuracion");
  return ok({ opciones: r.opciones, frecuenciaControlDias: r.frecuenciaControlDias });
}
