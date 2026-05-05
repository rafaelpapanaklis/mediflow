"use server";
// Pediatrics — server actions para PediatricConsent. Spec: §4.A.9, §1.15

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const PROCEDURE_TYPES = [
  "anestesia_local", "sedacion_consciente", "oxido_nitroso",
  "extraccion", "pulpotomia", "pulpectomia", "fluorizacion",
  "toma_impresiones", "rx_intraoral", "otro",
] as const;

const generateSchema = z.object({
  patientId: z.string().min(1),
  procedureType: z.enum(PROCEDURE_TYPES),
  guardianId: z.string().min(1),
  minorAssentRequired: z.boolean().optional(),
  expiresInMonths: z.number().int().min(1).max(36).optional(),
});

const signGuardianSchema = z.object({
  consentId: z.string().min(1),
  signatureUrl: z.string().min(10),
});

const signMinorSchema = z.object({
  consentId: z.string().min(1),
  signatureUrl: z.string().min(10),
});

const voidSchema = z.object({
  consentId: z.string().min(1),
  reason: z.string().min(2).max(300),
});

export async function generateConsent(input: z.infer<typeof generateSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const guardian = await prisma.guardian.findUnique({
    where: { id: parsed.data.guardianId },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!guardian || guardian.clinicId !== ctx.clinicId || guardian.patientId !== parsed.data.patientId) {
    return fail("Tutor inválido");
  }

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + (parsed.data.expiresInMonths ?? 12));

  const created = await prisma.pediatricConsent.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      procedureType: parsed.data.procedureType,
      guardianId: guardian.id,
      minorAssentRequired: parsed.data.minorAssentRequired ?? false,
      expiresAt,
      generatedBy: ctx.userId,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.CONSENT_GENERATED,
    entityType: "ped-consent",
    entityId: created.id,
    changes: { procedureType: parsed.data.procedureType },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function signConsentByGuardian(input: z.infer<typeof signGuardianSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = signGuardianSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const consent = await prisma.pediatricConsent.findUnique({
    where: { id: parsed.data.consentId },
    select: { id: true, clinicId: true, patientId: true, revokedAt: true },
  });
  if (!consent || consent.clinicId !== ctx.clinicId) return fail("Consentimiento no encontrado");
  if (consent.revokedAt) return fail("Consentimiento revocado, no se puede firmar");

  await prisma.pediatricConsent.update({
    where: { id: consent.id },
    data: {
      guardianSignedAt: new Date(),
      guardianSignatureUrl: parsed.data.signatureUrl,
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.CONSENT_SIGNED,
    entityType: "ped-consent",
    entityId: consent.id,
    changes: { signedBy: "guardian" },
  });
  revalidatePath(`/dashboard/patients/${consent.patientId}`);
  return ok({ id: consent.id });
}

export async function signConsentByMinor(input: z.infer<typeof signMinorSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = signMinorSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const consent = await prisma.pediatricConsent.findUnique({
    where: { id: parsed.data.consentId },
    select: { id: true, clinicId: true, patientId: true, revokedAt: true, minorAssentRequired: true },
  });
  if (!consent || consent.clinicId !== ctx.clinicId) return fail("Consentimiento no encontrado");
  if (consent.revokedAt) return fail("Consentimiento revocado");
  if (!consent.minorAssentRequired) return fail("Este procedimiento no requiere asentimiento del menor");

  await prisma.pediatricConsent.update({
    where: { id: consent.id },
    data: {
      minorAssentSignedAt: new Date(),
      minorAssentSignatureUrl: parsed.data.signatureUrl,
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.CONSENT_SIGNED,
    entityType: "ped-consent",
    entityId: consent.id,
    changes: { signedBy: "minor" },
  });
  revalidatePath(`/dashboard/patients/${consent.patientId}`);
  return ok({ id: consent.id });
}

export async function voidConsent(input: z.infer<typeof voidSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const consent = await prisma.pediatricConsent.findUnique({
    where: { id: parsed.data.consentId },
    select: { id: true, clinicId: true, patientId: true, revokedAt: true },
  });
  if (!consent || consent.clinicId !== ctx.clinicId) return fail("Consentimiento no encontrado");
  if (consent.revokedAt) return fail("Ya estaba revocado");

  await prisma.pediatricConsent.update({
    where: { id: consent.id },
    data: {
      revokedAt: new Date(),
      revokedBy: ctx.userId,
      revokedReason: parsed.data.reason,
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.CONSENT_VOIDED,
    entityType: "ped-consent",
    entityId: consent.id,
    changes: { reason: parsed.data.reason },
  });
  revalidatePath(`/dashboard/patients/${consent.patientId}`);
  return ok({ id: consent.id });
}
