"use server";

// Diagnóstico · 2 server actions (SPEC §1.3 DIAGNOSIS).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { OrthoDiagnosis } from "@prisma/client";
import { DiagnosisInputSchema } from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

export async function updateDiagnosis(input: {
  caseId: string;
  patch: Partial<unknown>;
}): Promise<Result<OrthoDiagnosis>> {
  const auth = await requirePermission("edit_diagnosis");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  // El cliente puede mandar el dx completo o parcial. Para upsert, validamos
  // el resultado completo después de hacer merge con lo existente.
  const existing = await prisma.orthoDiagnosis.findUnique({
    where: { caseId: input.caseId },
  });

  const merged = { ...(existing ?? {}), ...(input.patch as object) };
  const parsed = DiagnosisInputSchema.safeParse(merged);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const { diastemas, tmjFindings, ...rest } = parsed.data;
  const create = {
    caseId: input.caseId,
    ...rest,
    diastemas: diastemas as never,
    tmjFindings: tmjFindings as never,
    updatedBy: auth.data.userId,
  };
  const update = {
    ...rest,
    diastemas: diastemas as never,
    tmjFindings: tmjFindings as never,
    updatedBy: auth.data.userId,
  };
  const dx = await prisma.orthoDiagnosis.upsert({
    where: { caseId: input.caseId },
    create: create as never,
    update: update as never,
  });
  return ok(dx);
}

export async function upsertHabitCatalog(
  label: string,
): Promise<Result<string[]>> {
  const auth = await requirePermission("edit_diagnosis");
  if (!auth.ok) return reFail(auth);
  if (label.trim().length < 3)
    return fail("invalid_input", "El hábito debe tener al menos 3 caracteres", "label");

  // Catalog se mantiene en NoteTemplate con scope = "habit".
  // Persistir aunque el label exista (idempotente upsert).
  await prisma.noteTemplate.upsert({
    where: {
      clinicId_scope_name: {
        clinicId: auth.data.clinicId,
        scope: "habit",
        name: label.trim(),
      },
    },
    create: {
      clinicId: auth.data.clinicId,
      scope: "habit",
      name: label.trim(),
      body: label.trim(),
      builtin: false,
    },
    update: {},
  });

  const all = await prisma.noteTemplate.findMany({
    where: { clinicId: auth.data.clinicId, scope: "habit" },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return ok(all.map((t) => t.name));
}
