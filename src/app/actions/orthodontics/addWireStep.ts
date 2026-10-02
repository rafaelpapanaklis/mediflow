"use server";
// Orthodontics — addWireStep. Creación atómica de un paso de arco
// dentro de un plan, dispara desde DrawerWireStep G3.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { MATERIALES_DE_ARCO, MATERIALES_NUEVOS, materialParaGuardar } from "@/lib/orthodontics/material-de-arco";
import { materialesNuevosEnLaBase } from "@/lib/orthodontics/material-de-arco-db";

const wireMaterialEnum = z.enum(MATERIALES_DE_ARCO);
const wireShapeEnum = z.enum(["ROUND", "RECT"]);
const phaseEnum = z.enum([
  "ALIGNMENT",
  "LEVELING",
  "SPACE_CLOSURE",
  "DETAILS",
  "FINISHING",
  "RETENTION",
]);

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  phase: phaseEnum,
  /** Clave del selector (NITI_SUPER…) o valor guardado (SS, CR_CO…): `materialParaGuardar`. */
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

/**
 * La fila recién creada, con la misma forma que la ficha pinta en «Secuencia de
 * arcos» (`WireStepDTO`): con ella la pantalla la muestra al instante, sin
 * esperar a que `router.refresh()` vuelva a leer el caso entero. Es un tipo
 * local (no se importa de `redesign/types`) para que esta acción no arrastre
 * componentes de cliente.
 */
export interface PasoDeArcoCreado {
  id: string;
  orderIndex: number;
  phaseKey: z.infer<typeof phaseEnum>;
  material: z.infer<typeof wireMaterialEnum>;
  shape: z.infer<typeof wireShapeEnum>;
  gauge: string;
  purpose: string | null;
  archUpper: boolean;
  archLower: boolean;
  durationWeeks: number;
  auxiliaries: string[];
  notes: string | null;
  status: "PLANNED" | "ACTIVE" | "COMPLETED" | "SKIPPED";
  plannedDate: string | null;
  appliedDate: string | null;
  completedDate: string | null;
}

export async function addWireStep(
  input: unknown,
): Promise<ActionResult<{ wireStepId: string; paso: PasoDeArcoCreado; aviso: string | null }>> {
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

  // ws1-t12 (punto 4d): se guarda el material que eligió el doctor, no su «familia» (antes Cr-Co y Multi-stranded
  // quedaban como acero). Solo se pregunta a la base si eligió uno de los valores nuevos.
  const sinComprobar = materialParaGuardar(data.material, true);
  if (!sinComprobar.ok) return fail(sinComprobar.error);
  const elegido = materialParaGuardar(
    data.material,
    MATERIALES_NUEVOS.has(sinComprobar.material) ? await materialesNuevosEnLaBase() : true,
  );
  if (!elegido.ok) return fail(elegido.error);
  const material = elegido.material;
  // Revisión en panel.108 (fallo 5): sin el SQL un NiTi superelástico/termoactivado se guarda «NiTi» y la pantalla lo dice.
  const aviso = elegido.aviso ?? null;

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
      select: {
        id: true,
        orderIndex: true,
        phaseKey: true,
        material: true,
        shape: true,
        gauge: true,
        purpose: true,
        archUpper: true,
        archLower: true,
        durationWeeks: true,
        auxiliaries: true,
        notes: true,
        status: true,
        plannedDate: true,
        appliedDate: true,
        completedDate: true,
      },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.WIRE_STEP_ADDED,
      entityType: "OrthoWireStep",
      entityId: created.id,
      patientId: plan.patientId,
      after: {
        phase: data.phase,
        material: data.material,
        materialGuardado: material,
        shape: data.shape,
        gauge: data.gauge,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({
      wireStepId: created.id,
      aviso,
      paso: {
        ...created,
        plannedDate: created.plannedDate?.toISOString() ?? null,
        appliedDate: created.appliedDate?.toISOString() ?? null,
        completedDate: created.completedDate?.toISOString() ?? null,
      },
    });
  } catch (e) {
    console.error("[ortho] addWireStep failed:", e);
    return fail("No se pudo crear el wire step");
  }
}
