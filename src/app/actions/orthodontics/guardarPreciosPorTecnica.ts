"use server";
// Ortodoncia — precio por técnica (ws1-t10, decisión 2). Ajuste de la clínica: mismo
// permiso que el resto de Configuración (`settings.edit`). `clinicId` de la sesión.

import { revalidatePath } from "next/cache";
import { getOrthoConfigActionContext, auditOrtho } from "./_helpers";
import { normalizarPrecios, type PreciosPorTecnica } from "@/lib/orthodontics/precios-por-tecnica";
import { guardarPreciosPorTecnica as guardarEnBase } from "@/lib/orthodontics/precios-por-tecnica-db";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function guardarPreciosPorTecnicaDeLaClinica(input: unknown): Promise<ActionResult<{ precios: PreciosPorTecnica }>> {
  const auth = await getOrthoConfigActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const precios = normalizarPrecios((input as { precios?: unknown } | null)?.precios ?? input);
  const r = await guardarEnBase(ctx.clinicId, ctx.userId, precios);
  if (!r.ok) {
    return fail(
      r.motivo === "sin-columna"
        ? "Falta aplicar sql/ortodoncia-precios-por-tecnica.sql: los precios no se guardaron"
        : "No se pudieron guardar los precios",
    );
  }
  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.CLINIC_SETTINGS_UPDATED,
    entityType: "OrthodonticsClinicSettings",
    entityId: ctx.clinicId,
    meta: { accion: "precios-por-tecnica", precios },
  });
  revalidatePath("/dashboard/orthodontics/configuracion");
  return ok({ precios });
}
