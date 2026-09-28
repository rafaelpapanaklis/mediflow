"use server";
// Ortodoncia — Catálogo (ws1-t1, Ola 2). Botón explícito de Configuración:
// «cargar procedimientos sugeridos». Mismo patrón que el auto-siembra de
// DENTAL_SEED (src/app/api/procedures/route.ts), pero AQUÍ NUNCA es
// automático — nada se crea sin que alguien de la clínica lo pida, y lo
// creado es editable de inmediato desde el modal de siempre
// (PATCH /api/procedures/[id]).

import { revalidatePath } from "next/cache";
import { getOrthoConfigActionContext, auditOrtho } from "../_helpers";
import { ORTHO_AUDIT_ACTIONS } from "../audit-actions";
import { sembrarProcedimientosDeOrtodoncia, listarProcedimientosDeOrtodoncia, type OrthoProcedureRow } from "@/lib/orthodontics/catalog-procedures";
import { fail, isFailure, ok, type ActionResult } from "../result";

export async function sembrarProcedimientosSugeridosOrtodoncia(): Promise<ActionResult<{ creados: number; procedimientos: OrthoProcedureRow[] }>> {
  const auth = await getOrthoConfigActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  let creados: number;
  try {
    ({ creados } = await sembrarProcedimientosDeOrtodoncia(ctx.clinicId));
  } catch (e) {
    console.error("[ortho] sembrarProcedimientosSugeridosOrtodoncia:", e);
    return fail("No se pudo cargar el catálogo sugerido");
  }

  if (creados > 0) {
    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CLINIC_SETTINGS_UPDATED,
      entityType: "ProcedureCatalog",
      entityId: ctx.clinicId,
      after: { procedimientosSembrados: creados },
    });
  }

  const procedimientos = await listarProcedimientosDeOrtodoncia(ctx.clinicId);

  try {
    revalidatePath("/dashboard/orthodontics/configuracion");
  } catch (e) {
    console.error("[ortho] sembrarProcedimientosSugeridosOrtodoncia · revalidate:", e);
  }

  return ok({ creados, procedimientos });
}
