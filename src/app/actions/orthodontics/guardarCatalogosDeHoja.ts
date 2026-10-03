"use server";
// Ortodoncia — los catálogos de la hoja de control de la clínica (ws1-t9, auditoría BEVADENT, M4): materiales y
// calibres de arco, tipos y colores de liga, tipos de mecánica auxiliar. Ajuste de la clínica: mismo permiso que el
// resto de Configuración (`settings.edit`); `clinicId` de la sesión, nunca del cliente. «Quitar» una opción solo deja
// de ofrecerla en hojas nuevas: lo ya anotado conserva su texto.

import { revalidatePath } from "next/cache";
import { auditOrtho, getOrthoConfigActionContext } from "./_helpers";
import { LISTAS_DE_HOJA, normalizarCatalogos, validarCatalogos, type CatalogosDeHoja } from "@/lib/orthodontics/hoja-catalogos";
import { guardarCatalogosDeHoja as guardarEnBase } from "@/lib/orthodontics/hoja-extras-db";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function guardarCatalogosDeHojaAction(input: unknown): Promise<ActionResult<{ catalogos: CatalogosDeHoja }>> {
  const auth = await getOrthoConfigActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return fail("No se pudo identificar tu clínica");

  const cruda = (input as { catalogos?: unknown } | null)?.catalogos;
  if (!cruda || typeof cruda !== "object" || Array.isArray(cruda)) return fail("Datos inválidos");
  const o = cruda as Record<string, unknown>;
  for (const l of LISTAS_DE_HOJA) {
    if (!Array.isArray(o[l])) return fail("Datos inválidos");
  }
  const problema = validarCatalogos(
    Object.fromEntries(
      LISTAS_DE_HOJA.map((l) => [
        l,
        (o[l] as unknown[]).map((x) => ({
          nombre: x && typeof x === "object" && typeof (x as { nombre?: unknown }).nombre === "string" ? (x as { nombre: string }).nombre : "",
        })),
      ]),
    ),
  );
  if (problema) return fail(problema);

  const r = await guardarEnBase(ctx.clinicId, ctx.userId, normalizarCatalogos(o));
  if (r.ok === false) {
    return fail(
      r.motivo === "sin-columna"
        ? "Falta aplicar sql/ws1-t9-hoja-ligas-mecanicas-catalogos.sql: los catálogos no se guardaron"
        : "No se pudieron guardar los catálogos",
    );
  }
  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.CLINIC_SETTINGS_UPDATED,
    entityType: "OrthodonticsClinicSettings",
    entityId: ctx.clinicId,
    meta: {
      accion: "catalogos-de-la-hoja-de-control",
      listas: Object.fromEntries(LISTAS_DE_HOJA.map((l) => [l, r.catalogos[l].map((x) => ({ nombre: x.nombre, activa: x.activa }))])),
    },
  });
  revalidatePath("/dashboard/orthodontics/configuracion");
  return ok({ catalogos: r.catalogos });
}
