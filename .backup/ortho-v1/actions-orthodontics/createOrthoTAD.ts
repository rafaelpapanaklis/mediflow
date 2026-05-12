"use server";
// Orthodontics — createOrthoTAD. Sección C onAddTad: crea un TAD nuevo
// con validación de FDI tooth (location string) + brand + size + torqueNcm.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { locationHasValidFdi } from "./_predicates";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const brandEnum = z.enum(["DENTOS", "SPIDER", "IMTEC", "OTHER"]);

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  brand: brandEnum,
  size: z.string().min(1).max(40),
  location: z
    .string()
    .min(1)
    .max(200)
    .refine(locationHasValidFdi, {
      message: "La ubicación contiene un FDI fuera de rango (11-48)",
    }),
  torqueNcm: z.number().int().min(0).max(50).nullable().optional(),
  placedDate: z.string().min(1).optional(),
});

export type CreateOrthoTadInput = z.input<typeof inputSchema>;

export async function createOrthoTAD(
  input: unknown,
): Promise<ActionResult<{ tadId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  const placedDate = data.placedDate ? new Date(data.placedDate) : new Date();

  try {
    const created = await prisma.orthoTAD.create({
      data: {
        treatmentPlanId: plan.id,
        patientId: plan.patientId,
        clinicId: plan.clinicId,
        brand: data.brand,
        size: data.size,
        location: data.location,
        torqueNcm: data.torqueNcm ?? null,
        placedDate,
        placedById: ctx.userId,
      },
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.TAD_CREATED,
      entityType: "OrthoTAD",
      entityId: created.id,
      after: {
        brand: data.brand,
        size: data.size,
        location: data.location,
        torqueNcm: data.torqueNcm ?? null,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
    return ok({ tadId: created.id });
  } catch (e) {
    console.error("[ortho] createOrthoTAD failed:", e);
    return fail("No se pudo crear el TAD");
  }
}
