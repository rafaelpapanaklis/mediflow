"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F9 (catálogo de reglas de descuento) y
// F10 (recargo por atraso, apagado por default) — política DE LA CLÍNICA,
// no de un caso. `billing.edit` es necesario pero no basta: una política que
// afecta a TODOS los casos abiertos es más grande que editar una factura, así
// que además se exige un rol de dirección (mismo criterio que el resto de
// configuración de módulo: dueño/administrador). Recepción cobra con estas
// reglas; no las cambia.

import { getOrthoBillingActionContext } from "../_helpers";
import { auditarCobro } from "./_ctx";
import { guardarConfigDeCobro as guardarEnDb, leerConfigDeCobro } from "@/lib/orthodontics/cobro/config-db";
import type { ReglaDescuento, TipoValorRecargo } from "@/lib/orthodontics/cobro/reglas";
import { fail, isFailure, ok, type ActionResult } from "../result";

const ROLES_DE_DIRECCION = new Set(["SUPER_ADMIN", "ADMIN"]);
const MAX_REGLAS = 10;

export interface GuardarConfigDeCobroInput {
  discountRules: ReglaDescuento[];
  lateFeeEnabled: boolean;
  lateFeeType: TipoValorRecargo;
  lateFeeValue: number;
  lateFeeGraceDays: number;
}

export async function guardarConfigDeCobro(input: GuardarConfigDeCobroInput): Promise<ActionResult<{ guardado: true }>> {
  const ctxResult = await getOrthoBillingActionContext("billing.edit");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;
  if (!ROLES_DE_DIRECCION.has(ctx.role)) {
    return fail("Solo dueño/administrador puede cambiar la política de cobro de la clínica");
  }

  const reglas = (input.discountRules ?? []).slice(0, MAX_REGLAS).map((r) => ({
    id: r.id || `regla-${Math.random().toString(36).slice(2, 8)}`,
    etiqueta: String(r.etiqueta ?? "").trim().slice(0, 60) || "Descuento",
    porcentaje: Math.min(100, Math.max(0, Number(r.porcentaje) || 0)),
  }));

  const antes = await leerConfigDeCobro(ctx.clinicId);
  const resultado = await guardarEnDb(ctx.clinicId, {
    discountRules: reglas,
    lateFeeEnabled: Boolean(input.lateFeeEnabled),
    lateFeeType: input.lateFeeType === "FIJO" ? "FIJO" : "PCT",
    lateFeeValue: Math.max(0, Number(input.lateFeeValue) || 0),
    lateFeeGraceDays: Math.max(0, Math.floor(Number(input.lateFeeGraceDays) || 0)),
  });
  if (!resultado.ok) {
    return fail(resultado.sinTabla ? "Falta aplicar sql/ortodoncia-cobro.sql: la política de cobro no se guardó" : "No se pudo guardar la política de cobro");
  }

  await auditarCobro({
    ctx,
    action: "guardar-config-de-cobro",
    entityId: ctx.clinicId,
    meta: { antes, despues: resultado.config },
  });

  return ok({ guardado: true });
}
