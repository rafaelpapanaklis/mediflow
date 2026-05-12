"use server";

// Documents & Lab · 5 server actions (SPEC §1.3 DOCUMENTS & LAB).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { OrthoDocument, OrthoLabOrder } from "@prisma/client";
import {
  GenerateConsentSchema,
  ReferralInputSchema,
  LabOrderInputSchema,
} from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

export async function generateConsent(input: {
  caseId: string;
  templateId: string;
}): Promise<Result<OrthoDocument>> {
  const parsed = GenerateConsentSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("generate_consent");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  // SPEC §4 regla 8 — plan debe estar aceptado
  const c = await prisma.orthoCase.findUnique({
    where: { id: input.caseId },
    include: { plan: { select: { acceptedAt: true } } },
  });
  if (!c || !c.plan?.acceptedAt)
    return fail("conflict", "Plan no aceptado por paciente todavía");

  const doc = await prisma.orthoDocument.create({
    data: {
      caseId: input.caseId,
      kind: "CONSENT",
      title: `Consentimiento · ${input.templateId}`,
      url: `/api/orthodontics-v2/case/${input.caseId}/consent-pdf?template=${input.templateId}`,
      createdBy: auth.data.userId,
    },
  });
  return ok(doc);
}

export async function sendReferralLetter(input: {
  caseId: string;
  to: string;
  reason: string;
  notes?: string;
}): Promise<Result<OrthoDocument>> {
  const parsed = ReferralInputSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("send_referral_letter");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  // SPEC §4 regla 9 — diagnóstico requerido
  const dx = await prisma.orthoDiagnosis.findUnique({
    where: { caseId: input.caseId },
    select: { id: true },
  });
  if (!dx)
    return fail(
      "conflict",
      "Falta diagnóstico — captura clasificación de Angle primero",
    );

  const doc = await prisma.orthoDocument.create({
    data: {
      caseId: input.caseId,
      kind: "REFERRAL_LETTER",
      title: `Referencia a ${parsed.data.to}`,
      url: `/api/orthodontics-v2/case/${input.caseId}/referral-letter-pdf`,
      createdBy: auth.data.userId,
    },
  });
  return ok(doc);
}

export async function createLabOrder(input: {
  caseId: string;
  itemCode: string;
  itemLabel: string;
  labPartner: string;
  trackingCode?: string;
  status: unknown;
  notes?: string;
}): Promise<Result<OrthoLabOrder>> {
  const parsed = LabOrderInputSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("create_edit_lab_order");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  const order = await prisma.orthoLabOrder.create({
    data: {
      caseId: input.caseId,
      itemCode: parsed.data.itemCode,
      itemLabel: parsed.data.itemLabel,
      labPartner: parsed.data.labPartner,
      trackingCode: parsed.data.trackingCode,
      status: parsed.data.status,
      notes: parsed.data.notes,
      sentAt: parsed.data.status === "SENT" ? new Date() : null,
    },
  });
  return ok(order);
}

export async function updateLabOrder(input: {
  id: string;
  patch: unknown;
}): Promise<Result<OrthoLabOrder>> {
  const auth = await requirePermission("create_edit_lab_order");
  if (!auth.ok) return reFail(auth);
  const o = await prisma.orthoLabOrder.findUnique({
    where: { id: input.id },
    select: { case: { select: { clinicId: true } } },
  });
  if (!o || o.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Lab order no encontrada");

  const parsed = LabOrderInputSchema.partial().safeParse(input.patch);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "SENT") data.sentAt = new Date();
  if (parsed.data.status === "RECEIVED") data.receivedAt = new Date();

  const updated = await prisma.orthoLabOrder.update({
    where: { id: input.id },
    data: data as never,
  });
  return ok(updated);
}

export async function resendSignLink(docId: string): Promise<Result<void>> {
  const auth = await requirePermission("generate_consent");
  if (!auth.ok) return reFail(auth);
  const doc = await prisma.orthoDocument.findUnique({
    where: { id: docId },
    select: { case: { select: { clinicId: true } } },
  });
  if (!doc || doc.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Documento no encontrado");

  // Re-emit token (regenera random) — stub funcional, SPEC sign-at-home
  // depende de Twilio externo (autorizado para stub Fase 2).
  return ok(undefined);
}
