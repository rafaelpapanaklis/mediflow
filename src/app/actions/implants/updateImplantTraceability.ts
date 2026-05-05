"use server";
// Implants — updateImplantTraceability. EL acción más sensible
// legalmente del módulo (COFEPRIS clase III — §1.9, §10.2).
//
// Modifica brand / lotNumber / placedAt de un implante. Estos 3 campos
// son INMUTABLES por defecto:
//   - El trigger SQL `protect_implant_traceability` rechaza cualquier
//     UPDATE en estos campos a menos que la sesión tenga el flag
//     `app.implant_mutation_justified = 'true'`.
//   - La justificación debe ser ≥20 chars (validación zod).
//   - Audit log con acción COFEPRIS_TRACEABILITY_UPDATE incluyendo
//     before/after/justification + cédula del doctor.
//
// PRECAUCIÓN: si el pooler de Supabase ignora SET LOCAL (escenario
// conocido con prepared statements en transaction mode de pgbouncer),
// el trigger romperá la mutación. Ver comentario en
// `prisma/migrations/20260504200000_implants_module/migration.sql`
// sección 5 para validar y, si es necesario, deshabilitar el trigger
// dejando esta validación como única defensa.

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
    await prisma.$transaction(async (tx) => {
      // Activa flag de sesión ANTES del UPDATE para satisfacer al
      // trigger `protect_implant_traceability`. SET LOCAL dura solo
      // hasta el COMMIT/ROLLBACK de esta transacción.
      await tx.$executeRawUnsafe(
        `SET LOCAL app.implant_mutation_justified = 'true'`,
      );

      await tx.implant.update({
        where: { id: before.id },
        data,
      });
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
    const msg = e instanceof Error ? e.message : "Error desconocido";
    if (msg.includes("COFEPRIS")) {
      return fail(
        "Trigger SQL rechazó la modificación. Verifica que el SET LOCAL esté funcionando con tu pooler — ver migración SQL §5.",
      );
    }
    return fail("Error al actualizar trazabilidad");
  }
}
