"use server";

// Case lifecycle · 5 server actions (SPEC §1.3).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { OrthoCase, CaseStatus } from "@prisma/client";
import {
  CreateCaseInputSchema,
  UpdateCaseStatusSchema,
  MarkDebondingSchema,
} from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

const CASE_CODE_PREFIX = "ORT";

function generateCaseCode(): string {
  const y = new Date().getFullYear();
  const n = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${CASE_CODE_PREFIX}-${y}-${n}`;
}

export async function createOrthoCase(input: {
  patientId: string;
  caseCode?: string;
}): Promise<Result<OrthoCase>> {
  const parsed = CreateCaseInputSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const auth = await requirePermission("edit_diagnosis"); // crear caso = doctor only
  if (!auth.ok) return reFail(auth);
  const ctx = auth.data;

  const patient = await prisma.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true, clinicId: true },
  });
  if (!patient || patient.clinicId !== ctx.clinicId)
    return fail("not_found", "Paciente no encontrado");

  const existing = await prisma.orthoCase.findUnique({
    where: { patientId: input.patientId },
    select: { id: true },
  });
  if (existing) return fail("conflict", "El paciente ya tiene un caso ortodóntico");

  const c = await prisma.orthoCase.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: input.patientId,
      caseCode: input.caseCode ?? generateCaseCode(),
      primaryDoctorId: ctx.userId,
      status: "DRAFT",
    },
  });
  return ok(c);
}

export async function updateCaseStatus(input: {
  caseId: string;
  status: CaseStatus;
}): Promise<Result<OrthoCase>> {
  const parsed = UpdateCaseStatusSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("complete_archive_case");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  const c = await prisma.orthoCase.update({
    where: { id: input.caseId },
    data: { status: input.status },
  });
  return ok(c);
}

export async function markDebonding(input: {
  caseId: string;
  date: Date;
}): Promise<Result<OrthoCase>> {
  const parsed = MarkDebondingSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("mark_debonding");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  const c = await prisma.orthoCase.update({
    where: { id: input.caseId },
    data: {
      debondedAt: input.date,
      status: "RETENTION",
      currentPhase: "RETENTION",
    },
  });
  return ok(c);
}

export async function completeCase(caseId: string): Promise<Result<OrthoCase>> {
  const auth = await requirePermission("complete_archive_case");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, caseId);
  if (!g.ok) return reFail(g);

  const c = await prisma.orthoCase.update({
    where: { id: caseId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return ok(c);
}

export async function archiveCase(caseId: string): Promise<Result<OrthoCase>> {
  const auth = await requirePermission("complete_archive_case");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, caseId);
  if (!g.ok) return reFail(g);

  // Archivado = mismo modelo, sin soft-delete (per SPEC §1.1)
  const c = await prisma.orthoCase.update({
    where: { id: caseId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return ok(c);
}
