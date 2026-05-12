"use server";
// Orthodontics — addWireStep. Creación atómica de un paso de arco
// dentro de un plan, dispara desde DrawerWireStep G3.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const wireMaterialEnum = z.enum(["NITI", "SS", "TMA", "BETA_TITANIUM"]);
const wireShapeEnum = z.enum(["ROUND", "RECT"]);
const phaseEnum = z.enum([
  "ALIGNMENT",
  "LEVELING",
  "SPACE_CLOSURE",
  "DETAILS",
  "FINISHING",
  "RETENTION",
]);

/** Map materiales del DrawerWireStep (UI granular) a OrthoWireMaterial (DB). */
const MATERIAL_MAP: Record<string, z.infer<typeof wireMaterialEnum>> = {
  NITI_SUPER: "NITI",
  NITI_THERMO: "NITI",
  NITI_CONV: "NITI",
  SS: "SS",
  TMA: "TMA",
  MULTI: "SS",
  CRCO: "SS",
};

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  phase: phaseEnum,
  /** Material UI key (NITI_SUPER, etc.) o material DB key. */
  material: z.string().min(1),
  shape: wireShapeEnum,
  gauge: z.string().min(1),
  archUpper: z.boolean(),
  archLower: z.boolean(),
  durationWeeks: z.number().int().positive().max(26),
  auxiliaries: z.array(z.string()).default([]),
  purpose: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function addWireStep(
  input: unknown,
): Promise<ActionResult<{ wireStepId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;
  if (!data.archUpper && !data.archLower) return fail("Selecciona al menos un arco");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  const material = MATERIAL_MAP[data.material] ?? wireMaterialEnum.safeParse(data.material).data;
  if (!material) return fail(`Material no soportado: ${data.material}`);

  try {
    const last = await prisma.orthoWireStep.findFirst({
      where: { treatmentPlanId: plan.id },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    const orderIndex = (last?.orderIndex ?? 0) + 1;

    const created = await prisma.orthoWireStep.create({
      data: {
        treatmentPlanId: plan.id,
        clinicId: plan.clinicId,
        patientId: plan.patientId,
        orderIndex,
        phaseKey: data.phase,
        material,
        shape: data.shape,
        gauge: data.gauge,
        archUpper: data.archUpper,
        archLower: data.archLower,
        durationWeeks: data.durationWeeks,
        auxiliaries: data.auxiliaries,
        purpose: data.purpose ?? null,
        notes: data.notes ?? null,
      },
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.WIRE_STEP_ADDED,
      entityType: "OrthoWireStep",
      entityId: created.id,
      after: {
        phase: data.phase,
        material: data.material,
        shape: data.shape,
        gauge: data.gauge,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({ wireStepId: created.id });
  } catch (e) {
    console.error("[ortho] addWireStep failed:", e);
    return fail("No se pudo crear el wire step");
  }
}
