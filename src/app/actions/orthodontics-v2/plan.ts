"use server";

// Treatment Plan · 8 server actions (SPEC §1.3 TREATMENT PLAN).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { OrthoTreatmentPlan, ArchPlanned } from "@prisma/client";
import {
  PlanInputSchema,
  ArchInputSchema,
  ArchInputBase,
} from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

export async function updateTreatmentPlan(input: {
  caseId: string;
  patch: Partial<unknown>;
}): Promise<Result<OrthoTreatmentPlan>> {
  const auth = await requirePermission("edit_plan");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  const existing = await prisma.orthoTreatmentPlan.findUnique({
    where: { caseId: input.caseId },
  });
  const merged = { ...(existing ?? {}), ...(input.patch as object) };
  const parsed = PlanInputSchema.partial().safeParse(merged);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthoTreatmentPlan.upsert({
    where: { caseId: input.caseId },
    create: {
      caseId: input.caseId,
      appliances: parsed.data.appliances ?? [],
      extractions: parsed.data.extractions ?? [],
      elastics: (parsed.data.elastics ?? {}) as never,
      expanders: (parsed.data.expanders ?? {}) as never,
      tads: (parsed.data.tads ?? {}) as never,
      objectives: parsed.data.objectives ?? [],
      notes: parsed.data.notes ?? "",
      iprPlan: (parsed.data.iprPlan ?? {}) as never,
    },
    update: {
      appliances: parsed.data.appliances,
      extractions: parsed.data.extractions,
      elastics: parsed.data.elastics as never,
      expanders: parsed.data.expanders as never,
      tads: parsed.data.tads as never,
      objectives: parsed.data.objectives,
      notes: parsed.data.notes,
      iprPlan: parsed.data.iprPlan as never,
    },
  });
  return ok(plan);
}

export async function addArchStep(input: {
  planId: string;
  draft: unknown;
}): Promise<Result<ArchPlanned>> {
  const auth = await requirePermission("manage_arch");
  if (!auth.ok) return reFail(auth);

  const parsed = ArchInputSchema.safeParse(input.draft);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthoTreatmentPlan.findUnique({
    where: { id: input.planId },
    select: { caseId: true, case: { select: { clinicId: true } } },
  });
  if (!plan || plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plan no encontrado");

  const max = await prisma.archPlanned.aggregate({
    where: { planId: input.planId },
    _max: { order: true },
  });
  const order = (max._max.order ?? 0) + 1;

  const arch = await prisma.archPlanned.create({
    data: {
      planId: input.planId,
      order,
      phase: parsed.data.phase,
      material: parsed.data.material,
      gauge: parsed.data.gauge,
      durationW: parsed.data.durationW,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      notes: parsed.data.notes,
    },
  });
  return ok(arch);
}

export async function updateArchStep(input: {
  archId: string;
  patch: unknown;
}): Promise<Result<ArchPlanned>> {
  const auth = await requirePermission("manage_arch");
  if (!auth.ok) return reFail(auth);

  const a = await prisma.archPlanned.findUnique({
    where: { id: input.archId },
    select: { id: true, plan: { select: { case: { select: { clinicId: true } } } } },
  });
  if (!a || a.plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Arco no encontrado");

  const parsed = ArchInputBase.partial().safeParse(input.patch);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const arch = await prisma.archPlanned.update({
    where: { id: input.archId },
    data: parsed.data,
  });
  return ok(arch);
}

export async function reorderArches(input: {
  planId: string;
  order: string[];
}): Promise<Result<ArchPlanned[]>> {
  const auth = await requirePermission("manage_arch");
  if (!auth.ok) return reFail(auth);

  // Validar pertenencia
  const plan = await prisma.orthoTreatmentPlan.findUnique({
    where: { id: input.planId },
    include: {
      archesPlanned: { select: { id: true, status: true } },
      case: { select: { clinicId: true } },
    },
  });
  if (!plan || plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plan no encontrado");

  // SPEC §4 regla 20: no se pueden reordenar si hay arcos PAST
  if (plan.archesPlanned.some((a) => a.status === "PAST"))
    return fail("conflict", "No se pueden reordenar arcos ya ejecutados");

  await prisma.$transaction(
    input.order.map((archId, i) =>
      prisma.archPlanned.update({
        where: { id: archId },
        data: { order: i + 1 },
      }),
    ),
  );

  const updated = await prisma.archPlanned.findMany({
    where: { planId: input.planId },
    orderBy: { order: "asc" },
  });
  return ok(updated);
}

export async function deleteArchStep(archId: string): Promise<Result<void>> {
  const auth = await requirePermission("manage_arch");
  if (!auth.ok) return reFail(auth);

  const a = await prisma.archPlanned.findUnique({
    where: { id: archId },
    select: { plan: { select: { case: { select: { clinicId: true } } } }, status: true },
  });
  if (!a || a.plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Arco no encontrado");
  if (a.status === "PAST" || a.status === "CURRENT")
    return fail("conflict", "No se puede borrar un arco activo o pasado");

  await prisma.archPlanned.delete({ where: { id: archId } });
  return ok(undefined);
}

export async function advanceCurrentArch(
  caseId: string,
): Promise<Result<ArchPlanned>> {
  const auth = await requirePermission("advance_arch");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, caseId);
  if (!g.ok) return reFail(g);

  const plan = await prisma.orthoTreatmentPlan.findUnique({
    where: { caseId },
    include: { archesPlanned: { orderBy: { order: "asc" } } },
  });
  if (!plan) return fail("not_found", "Plan no encontrado");

  const current = plan.archesPlanned.find((a) => a.status === "CURRENT");
  const nextFuture = plan.archesPlanned.find((a) => a.status === "FUTURE");
  if (!nextFuture)
    return fail("conflict", "No hay arcos futuros");

  if (current) {
    await prisma.archPlanned.update({
      where: { id: current.id },
      data: { status: "PAST", endDate: new Date() },
    });
  }
  const advanced = await prisma.archPlanned.update({
    where: { id: nextFuture.id },
    data: { status: "CURRENT", startDate: new Date() },
  });

  // Auto-promueve la fase del caso
  await prisma.orthoCase.update({
    where: { id: caseId },
    data: { currentPhase: nextFuture.phase },
  });
  return ok(advanced);
}

export async function updateIprPlan(input: {
  planId: string;
  key: string;
  mm: number;
}): Promise<Result<OrthoTreatmentPlan>> {
  const auth = await requirePermission("edit_ipr");
  if (!auth.ok) return reFail(auth);
  if (input.mm < 0 || input.mm > 1)
    return fail("invalid_input", "IPR debe estar entre 0 y 1 mm", "mm");

  const plan = await prisma.orthoTreatmentPlan.findUnique({
    where: { id: input.planId },
    select: { iprPlan: true, case: { select: { clinicId: true } } },
  });
  if (!plan || plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plan no encontrado");

  const iprPlan = { ...(plan.iprPlan as Record<string, number>), [input.key]: input.mm };
  const updated = await prisma.orthoTreatmentPlan.update({
    where: { id: input.planId },
    data: { iprPlan },
  });
  return ok(updated);
}

export async function acceptTreatmentPlan(input: {
  planId: string;
  signatureToken: string;
}): Promise<Result<OrthoTreatmentPlan>> {
  const auth = await requirePermission("edit_plan");
  if (!auth.ok) return reFail(auth);

  const plan = await prisma.orthoTreatmentPlan.findUnique({
    where: { id: input.planId },
    include: { case: { select: { clinicId: true, id: true } }, archesPlanned: true },
  });
  if (!plan || plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plan no encontrado");
  if (plan.archesPlanned.length === 0)
    return fail("conflict", "Plan vacío — agrega arcos");

  const accepted = await prisma.orthoTreatmentPlan.update({
    where: { id: input.planId },
    data: { acceptedAt: new Date(), acceptedBy: auth.data.userId },
  });

  // Avanza el caso de DRAFT → ACCEPTED
  await prisma.orthoCase.update({
    where: { id: plan.case.id },
    data: { status: "ACCEPTED" },
  });

  return ok(accepted);
}
