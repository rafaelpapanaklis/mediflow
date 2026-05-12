"use server";

// Treatment Cards · 6 server actions (SPEC §1.3 TREATMENT CARDS).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { TreatmentCard } from "@prisma/client";
import { TreatmentCardInputSchema } from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

export async function createTreatmentCard(input: {
  caseId: string;
  draft: unknown;
}): Promise<Result<TreatmentCard>> {
  const parsed = TreatmentCardInputSchema.safeParse(input.draft);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const auth = await requirePermission("create_treatment_card");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  // SPEC §4 regla 6 — caso debe estar ACCEPTED+ (no DRAFT)
  const c = await prisma.orthoCase.findUnique({
    where: { id: input.caseId },
    select: { status: true },
  });
  if (!c || c.status === "DRAFT")
    return fail("conflict", "Acepta el plan antes de registrar citas");

  const card = await prisma.treatmentCard.create({
    data: {
      caseId: input.caseId,
      appointmentId: parsed.data.appointmentId,
      visitDate: parsed.data.visitDate,
      visitType: parsed.data.visitType,
      templateUsed: parsed.data.templateUsed,
      archPlacedId: parsed.data.archPlacedId,
      ligColor: parsed.data.ligColor,
      ligKind: parsed.data.ligKind,
      activations: parsed.data.activations,
      elasticUse: parsed.data.elasticUse ?? {},
      bracketsLost: parsed.data.bracketsLost,
      iprDoneDelta: parsed.data.iprDoneDelta ?? {},
      soap: parsed.data.soap,
      homeInstr: parsed.data.homeInstr,
      nextSuggestedAt: parsed.data.nextSuggestedAt,
      linkedPhotoSet: parsed.data.linkedPhotoSet,
      createdBy: auth.data.userId,
    },
  });
  return ok(card);
}

export async function updateTreatmentCard(input: {
  cardId: string;
  patch: unknown;
}): Promise<Result<TreatmentCard>> {
  const auth = await requirePermission("edit_soap");
  if (!auth.ok) return reFail(auth);
  const card = await prisma.treatmentCard.findUnique({
    where: { id: input.cardId },
    select: { signedOffAt: true, case: { select: { clinicId: true } } },
  });
  if (!card || card.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Treatment Card no encontrada");
  if (card.signedOffAt)
    return fail("conflict", "La card ya está firmada — no se puede editar");

  const parsed = TreatmentCardInputSchema.partial().safeParse(input.patch);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const updated = await prisma.treatmentCard.update({
    where: { id: input.cardId },
    data: parsed.data,
  });
  return ok(updated);
}

export async function signOffTreatmentCard(
  cardId: string,
): Promise<Result<TreatmentCard>> {
  const auth = await requirePermission("sign_treatment_card");
  if (!auth.ok) return reFail(auth);
  const card = await prisma.treatmentCard.findUnique({
    where: { id: cardId },
    select: {
      signedOffAt: true,
      case: { select: { clinicId: true } },
      elasticUse: true,
    },
  });
  if (!card || card.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Treatment Card no encontrada");
  if (card.signedOffAt)
    return fail("conflict", "Ya estaba firmada");

  const updated = await prisma.treatmentCard.update({
    where: { id: cardId },
    data: { signedOffAt: new Date() },
  });
  return ok(updated);
}

export async function applyTreatmentCardTemplate(input: {
  cardId: string;
  templateId: string;
}): Promise<Result<TreatmentCard>> {
  const auth = await requirePermission("create_treatment_card");
  if (!auth.ok) return reFail(auth);
  const tpl = await prisma.noteTemplate.findUnique({
    where: { id: input.templateId },
  });
  if (!tpl || tpl.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plantilla no encontrada");

  // Aplica el body como pre-llenado del SOAP.plan
  const card = await prisma.treatmentCard.findUnique({
    where: { id: input.cardId },
    select: { soap: true, case: { select: { clinicId: true } } },
  });
  if (!card || card.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Treatment Card no encontrada");

  const soap = (card.soap as { s?: string; o?: string; a?: string; p?: string }) ?? {};
  const updated = await prisma.treatmentCard.update({
    where: { id: input.cardId },
    data: {
      templateUsed: tpl.name,
      soap: { ...soap, p: tpl.body } as never,
    },
  });
  return ok(updated);
}

export async function printIndications(
  cardId: string,
): Promise<Result<{ url: string }>> {
  const auth = await requirePermission("print_indications");
  if (!auth.ok) return reFail(auth);
  const card = await prisma.treatmentCard.findUnique({
    where: { id: cardId },
    select: { signedOffAt: true, case: { select: { clinicId: true } } },
  });
  if (!card || card.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Treatment Card no encontrada");
  if (!card.signedOffAt)
    return fail("conflict", "Firma la Treatment Card primero");

  // PDF generation se hace via /api/orthodontics-v2/cards/[id]/indications-pdf
  // (route handler a implementar en Fase 8 si surge la necesidad).
  return ok({ url: `/api/orthodontics-v2/cards/${cardId}/indications-pdf` });
}

export async function computeCompliance(
  caseId: string,
): Promise<Result<{ value: number; delta: number }>> {
  const auth = await requirePermission("view_record");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, caseId);
  if (!g.ok) return reFail(g);

  const cards = await prisma.treatmentCard.findMany({
    where: { caseId },
    orderBy: { visitDate: "desc" },
    take: 6,
  });
  if (cards.length === 0) return ok({ value: 0, delta: 0 });

  const scores = cards
    .map((c) => {
      const e = c.elasticUse as { reportedCompliance?: number };
      return typeof e?.reportedCompliance === "number" ? e.reportedCompliance : null;
    })
    .filter((v): v is number => v !== null);

  if (scores.length === 0) return ok({ value: 0, delta: 0 });

  const recent = scores.slice(0, 3);
  const older = scores.slice(3);
  const avg = (arr: number[]): number =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  return ok({ value: avg(recent), delta: avg(recent) - avg(older) });
}
