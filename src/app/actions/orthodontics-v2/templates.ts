"use server";

// Templates · 5 server actions (SPEC §1.3 TEMPLATES).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type {
  OrthoTreatmentPlan,
  OrthoTemplate,
  ApplianceType,
} from "@prisma/client";
import {
  SaveTemplateInputSchema,
  ApplianceTypeInputSchema,
} from "@/lib/orthodontics-v2/schemas";
import { requirePermission } from "./_auth";

export async function listOrthoTemplates(): Promise<Result<OrthoTemplate[]>> {
  const auth = await requirePermission("load_save_template");
  if (!auth.ok) return reFail(auth);
  const list = await prisma.orthoTemplate.findMany({
    where: { clinicId: auth.data.clinicId },
    orderBy: [{ usageCount: "desc" }, { name: "asc" }],
  });
  return ok(list);
}

export async function loadTemplate(input: {
  caseId: string;
  templateId: string;
}): Promise<Result<OrthoTreatmentPlan>> {
  const auth = await requirePermission("load_save_template");
  if (!auth.ok) return reFail(auth);

  const tpl = await prisma.orthoTemplate.findUnique({
    where: { id: input.templateId },
  });
  if (!tpl || tpl.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plantilla no encontrada");

  const payload = tpl.payload as {
    appliances?: string[];
    extractions?: number[];
    elastics?: Record<string, unknown>;
    expanders?: Record<string, unknown>;
    tads?: Record<string, unknown>;
    objectives?: string[];
    notes?: string;
    iprPlan?: Record<string, number>;
    arches?: Array<{
      order: number;
      phase: string;
      material: string;
      gauge: string;
      durationW: number;
    }>;
  };

  const plan = await prisma.orthoTreatmentPlan.upsert({
    where: { caseId: input.caseId },
    create: {
      caseId: input.caseId,
      appliances: payload.appliances ?? [],
      extractions: payload.extractions ?? [],
      elastics: (payload.elastics ?? {}) as never,
      expanders: (payload.expanders ?? {}) as never,
      tads: (payload.tads ?? {}) as never,
      objectives: payload.objectives ?? [],
      notes: payload.notes ?? "",
      iprPlan: (payload.iprPlan ?? {}) as never,
      templateId: tpl.id,
    },
    update: {
      appliances: payload.appliances ?? [],
      extractions: payload.extractions ?? [],
      elastics: (payload.elastics ?? {}) as never,
      expanders: (payload.expanders ?? {}) as never,
      tads: (payload.tads ?? {}) as never,
      objectives: payload.objectives ?? [],
      notes: payload.notes ?? "",
      iprPlan: (payload.iprPlan ?? {}) as never,
      templateId: tpl.id,
    },
  });

  if (payload.arches?.length) {
    await prisma.archPlanned.deleteMany({ where: { planId: plan.id } });
    await prisma.archPlanned.createMany({
      data: payload.arches.map((a) => ({
        planId: plan.id,
        order: a.order,
        phase: a.phase as never,
        material: a.material as never,
        gauge: a.gauge,
        durationW: a.durationW,
      })),
    });
  }

  await prisma.orthoTemplate.update({
    where: { id: tpl.id },
    data: { usageCount: { increment: 1 } },
  });

  return ok(plan);
}

export async function saveAsTemplate(input: {
  caseId: string;
  name: string;
  description?: string;
}): Promise<Result<OrthoTemplate>> {
  const parsed = SaveTemplateInputSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const auth = await requirePermission("load_save_template");
  if (!auth.ok) return reFail(auth);

  const plan = await prisma.orthoTreatmentPlan.findUnique({
    where: { caseId: input.caseId },
    include: { archesPlanned: { orderBy: { order: "asc" } } },
  });
  if (!plan)
    return fail("not_found", "Plan no encontrado");
  if (plan.archesPlanned.length === 0)
    return fail("conflict", "Plan vacío — agrega arcos antes de guardar");

  const payload = {
    appliances: plan.appliances,
    extractions: plan.extractions,
    elastics: plan.elastics,
    expanders: plan.expanders,
    tads: plan.tads,
    objectives: plan.objectives,
    notes: plan.notes,
    iprPlan: plan.iprPlan,
    arches: plan.archesPlanned.map((a) => ({
      order: a.order,
      phase: a.phase,
      material: a.material,
      gauge: a.gauge,
      durationW: a.durationW,
    })),
  };

  const tpl = await prisma.orthoTemplate.create({
    data: {
      clinicId: auth.data.clinicId,
      name: input.name,
      description: input.description,
      ownerUserId: auth.data.userId,
      payload: payload as never,
    },
  });
  return ok(tpl);
}

export async function deleteTemplate(templateId: string): Promise<Result<void>> {
  const auth = await requirePermission("load_save_template");
  if (!auth.ok) return reFail(auth);
  const tpl = await prisma.orthoTemplate.findUnique({
    where: { id: templateId },
    select: { clinicId: true },
  });
  if (!tpl || tpl.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plantilla no encontrada");
  await prisma.orthoTemplate.delete({ where: { id: templateId } });
  return ok(undefined);
}

export async function upsertApplianceType(input: {
  code: string;
  label: string;
  category: string;
}): Promise<Result<ApplianceType>> {
  const parsed = ApplianceTypeInputSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const auth = await requirePermission("new_appliance_type");
  if (!auth.ok) return reFail(auth);

  const a = await prisma.applianceType.upsert({
    where: {
      clinicId_code: { clinicId: auth.data.clinicId, code: parsed.data.code },
    },
    create: {
      clinicId: auth.data.clinicId,
      code: parsed.data.code,
      label: parsed.data.label,
      category: parsed.data.category,
      builtin: false,
      createdBy: auth.data.userId,
    },
    update: {
      label: parsed.data.label,
      category: parsed.data.category,
    },
  });
  return ok(a);
}
