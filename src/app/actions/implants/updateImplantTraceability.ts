"use server";
// Implants — updateImplantTraceability. La acción más sensible
// legalmente del módulo (COFEPRIS clase III — §1.9, §10.2).
//
// Modifica brand / lotNumber / placedAt de un implante. Estos 3
// campos son inmutables por convención COFEPRIS.
//
// NOTA: el trigger SQL `protect_implant_traceability` fue eliminado
// (migración `20260504210000_drop_implant_traceability_trigger`)
// porque el pooler de Supabase (pgbouncer transaction mode) ignora
// `SET LOCAL`. La validación COFEPRIS depende ahora de:
//   1. Validación zod (`updateImplantTraceabilitySchema` exige
//      `justification.length >= 20`) — bloquea cualquier llamada
//      vía la app antes de tocar la DB.
//   2. Audit log con `meta.cofeprisTraceability = true` — registra
//      before/after/justification/doctorId/timestamp para defensa
//      legal (query: `SELECT * FROM "audit_logs" WHERE
//      entity_type='implant' AND changes->'_meta'->>'cofeprisTraceability'='true'`).
// Estas 2 capas son suficientes porque ningún cliente tiene acceso
// SQL directo a producción — solo super-admins con MFA.
//
// El trigger gemelo `block_implant_delete` se mantiene activo
// (no requiere SET LOCAL — bloquea cualquier DELETE incondicionalmente).

import { prisma } from "@/lib/prisma";
import {
  updateImplantTraceabilitySchema,
  type UpdateImplantTraceabilityInput,
} from "@/lib/validation/implants";
import type { ImplantBrand } from "@prisma/client";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const VALID_BRANDS = new Set([
  "STRAUMANN",
  "NOBEL_BIOCARE",
  "NEODENT",
  "MIS",
  "BIOHORIZONS",
  "ZIMMER_BIOMET",
  "IMPLANT_DIRECT",
  "ODONTIT",
  "OTRO",
]);

export async function updateImplantTraceability(
  input: UpdateImplantTraceabilityInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateImplantTraceabilitySchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const implantRes = await loadImplantForCtx({
    ctx,
    implantId: parsed.data.implantId,
  });
  if (isFailure(implantRes)) return implantRes;
  const before = implantRes.data;

  // Construye payload del UPDATE según campo + valida tipo del newValue
  const data: Record<string, unknown> = {};
  let beforeValue: unknown;
  let afterValue: unknown;

  if (parsed.data.field === "brand") {
    const newBrand = String(parsed.data.newValue);
    if (!VALID_BRANDS.has(newBrand)) {
      return fail("Marca inválida");
    }
    if (newBrand === "OTRO" && !parsed.data.newBrandCustomName) {
      return fail("brand=OTRO requiere brandCustomName");
    }
    data.brand = newBrand as ImplantBrand;
    if (parsed.data.newBrandCustomName) {
      data.brandCustomName = parsed.data.newBrandCustomName;
    }
    beforeValue = before.brand;
    afterValue = newBrand;
  } else if (parsed.data.field === "lotNumber") {
    const newLot = String(parsed.data.newValue).trim();
    if (newLot.length < 1) return fail("Lote no puede estar vacío");
    data.lotNumber = newLot;
    beforeValue = before.lotNumber;
    afterValue = newLot;
  } else if (parsed.data.field === "placedAt") {
    const newDate =
      parsed.data.newValue instanceof Date
        ? parsed.data.newValue
        : new Date(String(parsed.data.newValue));
    if (Number.isNaN(newDate.getTime())) return fail("Fecha inválida");
    data.placedAt = newDate;
    beforeValue = before.placedAt.toISOString();
    afterValue = newDate.toISOString();
  } else {
    return fail("Campo no permitido");
  }

  // Si el valor no cambió, no hay nada que hacer.
  if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) {
    return fail("El nuevo valor es idéntico al actual");
  }

  try {
    await prisma.implant.update({
      where: { id: before.id },
      data,
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.COFEPRIS_TRACEABILITY_UPDATE,
      entityType: "implant",
      entityId: before.id,
      meta: {
        cofeprisTraceability: true,
        field: parsed.data.field,
        previousValue: beforeValue,
        newValue: afterValue,
        justification: parsed.data.justification,
        doctorId: ctx.userId,
        timestamp: new Date().toISOString(),
      },
    });

    revalidateImplantPaths({ patientId: before.patientId });
    return ok({ id: before.id });
  } catch (e) {
    console.error("[updateImplantTraceability]", e);
    return fail("Error al actualizar trazabilidad");
  }
}
