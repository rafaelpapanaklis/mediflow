"use server";
// Ortodoncia — técnicas propias de la clínica (ws1-t10). Ajuste de la clínica: mismo permiso que el
// resto de Configuración (`settings.edit`). `clinicId` de la sesión, nunca del cliente.

import { revalidatePath } from "next/cache";
import { getOrthoConfigActionContext, auditOrtho } from "./_helpers";
import { normalizarTecnicas, validarTecnicas, type TecnicaClinica } from "@/lib/orthodontics/tecnicas-de-la-clinica";
import { guardarTecnicasDeLaClinica as guardarEnBase } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function guardarTecnicasDeLaClinicaAction(input: unknown): Promise<ActionResult<{ tecnicas: TecnicaClinica[] }>> {
  const auth = await getOrthoConfigActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const cruda = (input as { tecnicas?: unknown } | null)?.tecnicas;
  if (!Array.isArray(cruda)) return fail("Datos inválidos");
  const problema = validarTecnicas(
    cruda.map((x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        nombre: typeof o.nombre === "string" ? o.nombre : "",
        precio: typeof o.precio === "string" || typeof o.precio === "number" ? o.precio : null,
      };
    }),
  );
  if (problema) return fail(problema);
  const tecnicas = normalizarTecnicas(cruda) ?? [];
  if (tecnicas.length !== cruda.length) return fail("Alguna técnica no es válida: revisa su nombre y su tipo base.");

  const r = await guardarEnBase(ctx.clinicId, ctx.userId, tecnicas);
  if (r.ok === false) {
    return fail(
      r.motivo === "sin-columna"
        ? "Falta aplicar sql/ortodoncia-tecnicas-propias.sql: las técnicas no se guardaron"
        : "No se pudieron guardar las técnicas",
    );
  }
  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.CLINIC_SETTINGS_UPDATED,
    entityType: "OrthodonticsClinicSettings",
    entityId: ctx.clinicId,
    meta: { accion: "tecnicas-de-la-clinica", tecnicas: r.tecnicas.map((t) => ({ id: t.id, nombre: t.nombre, base: t.base, precio: t.precio, activa: t.activa })) },
  });
  revalidatePath("/dashboard/orthodontics/configuracion");
  return ok({ tecnicas: r.tecnicas });
}
