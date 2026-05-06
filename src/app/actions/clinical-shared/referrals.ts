"use server";
// Clinical-shared — server actions para ReferralLetter + DoctorContact.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { renderToStream } from "@react-pdf/renderer";
import { ClinicalModule, ReferralLetterChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared, guardPatient } from "@/lib/clinical-shared/auth/guard";
import { fail, isFailure, ok, type ActionResult } from "@/lib/clinical-shared/result";
import { buildPediatricSummary } from "@/lib/clinical-shared/referral/summary";
import { buildOrthoSummary } from "@/lib/clinical-shared/referral/summary-orthodontics";
import { ReferralLetterDocument } from "@/lib/pdf/referral-letter-document";

const moduleEnum = z.nativeEnum(ClinicalModule);
const channelEnum = z.nativeEnum(ReferralLetterChannel);

// ── DoctorContact ──────────────────────────────────────────────────────

const contactSchema = z.object({
  fullName: z.string().min(1).max(120),
  specialty: z.string().max(120).nullable().optional(),
  cedula: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(120).nullable().optional(),
  clinicName: z.string().max(120).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function createDoctorContact(
  input: z.infer<typeof contactSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const created = await prisma.doctorContact.create({
    data: {
      clinicId: ctx.clinicId,
      fullName: parsed.data.fullName,
      specialty: parsed.data.specialty ?? null,
      cedula: parsed.data.cedula ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      clinicName: parsed.data.clinicName ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
    },
    select: { id: true },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.doctor-contact.created",
    entityType: "doctor-contact",
    entityId: created.id,
    changes: { fullName: parsed.data.fullName },
  });
  revalidatePath("/dashboard");
  return ok(created);
}

const updateContactSchema = contactSchema.extend({ id: z.string().min(1) });

export async function updateDoctorContact(
  input: z.infer<typeof updateContactSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const existing = await prisma.doctorContact.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) return fail("Contacto no encontrado");
  if (existing.clinicId !== ctx.clinicId) return fail("Sin acceso");

  const { id: _id, ...rest } = parsed.data;
  await prisma.doctorContact.update({
    where: { id: parsed.data.id },
    data: rest,
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.doctor-contact.updated",
    entityType: "doctor-contact",
    entityId: parsed.data.id,
  });
  revalidatePath("/dashboard");
  return ok({ id: parsed.data.id });
}

export async function listDoctorContacts(): Promise<
  ActionResult<
    Array<{
      id: string;
      fullName: string;
      specialty: string | null;
      cedula: string | null;
      phone: string | null;
      email: string | null;
      clinicName: string | null;
    }>
  >
> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const rows = await prisma.doctorContact.findMany({
    where: { clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      specialty: true,
      cedula: true,
      phone: true,
      email: true,
      clinicName: true,
    },
  });
  return ok(rows);
}

const deleteContactSchema = z.object({ id: z.string().min(1) });

export async function deleteDoctorContact(
  input: z.infer<typeof deleteContactSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteContactSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const c = await prisma.doctorContact.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!c || c.deletedAt) return fail("Contacto no encontrado");
  if (c.clinicId !== ctx.clinicId) return fail("Sin acceso");

  await prisma.doctorContact.update({
    where: { id: c.id },
    data: { deletedAt: new Date() },
  });
  return ok({ id: c.id });
}

// ── ReferralLetter ─────────────────────────────────────────────────────

const buildSummarySchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
});

/**
 * Devuelve el summary pre-llenado del módulo origen. Se usa al abrir el
 * modal para que el médico solo edite, no escriba desde cero.
 */
export async function buildReferralSummary(
  input: z.infer<typeof buildSummarySchema>,
): Promise<ActionResult<{ summary: string }>> {
  const parsed = buildSummarySchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  let summary = "";
  if (parsed.data.module === "pediatrics") {
    summary = await buildPediatricSummary({
      patientId: parsed.data.patientId,
      clinicId: ctx.clinicId,
    });
  } else if (parsed.data.module === "orthodontics") {
    summary = await buildOrthoSummary({
      patientId: parsed.data.patientId,
      clinicId: ctx.clinicId,
    });
  }
  // Otros módulos registran sus builders en sus branches.
  return ok({ summary });
}

const createSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
  contactId: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).max(300),
  summary: z.string().min(1).max(8000),
});

export async function createReferralLetter(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string; pdfUrl: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  // Validar que el contactId pertenezca al clinicId
  if (parsed.data.contactId) {
    const c = await prisma.doctorContact.findUnique({
      where: { id: parsed.data.contactId },
      select: { id: true, clinicId: true, deletedAt: true },
    });
    if (!c || c.deletedAt || c.clinicId !== ctx.clinicId) {
      return fail("Contacto inválido");
    }
  }

  const created = await prisma.referralLetter.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module,
      contactId: parsed.data.contactId ?? null,
      authorId: ctx.userId,
      reason: parsed.data.reason,
      summary: parsed.data.summary,
      status: "draft",
    },
    select: { id: true },
  });

  const pdfUrl = await renderReferralPdfBase64({
    referralId: created.id,
    clinicId: ctx.clinicId,
  });

  await prisma.referralLetter.update({
    where: { id: created.id },
    data: { pdfUrl },
  });

  await auditClinicalShared({
    ctx,
    action: "clinical-shared.referral.created",
    entityType: "referral-letter",
    entityId: created.id,
    changes: { module: parsed.data.module, contactId: parsed.data.contactId },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok({ id: created.id, pdfUrl });
}

const markSentSchema = z.object({
  id: z.string().min(1),
  channel: channelEnum,
});

export async function markReferralSent(
  input: z.infer<typeof markSentSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = markSentSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const r = await prisma.referralLetter.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!r || r.deletedAt) return fail("Hoja no encontrada");
  if (r.clinicId !== ctx.clinicId) return fail("Sin acceso");

  await prisma.referralLetter.update({
    where: { id: r.id },
    data: {
      status: "sent",
      sentAt: new Date(),
      sentChannel: parsed.data.channel,
    },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.referral.sent",
    entityType: "referral-letter",
    entityId: r.id,
    changes: { channel: parsed.data.channel },
  });
  return ok({ id: r.id });
}

// ── Internals ──────────────────────────────────────────────────────────

async function renderReferralPdfBase64(args: {
  referralId: string;
  clinicId: string;
}): Promise<string> {
  const r = await prisma.referralLetter.findUnique({
    where: { id: args.referralId },
    include: {
      patient: { select: { firstName: true, lastName: true, dob: true, gender: true } },
      author: {
        select: { firstName: true, lastName: true, cedulaProfesional: true },
      },
      contact: {
        select: {
          fullName: true,
          specialty: true,
          clinicName: true,
          phone: true,
          email: true,
        },
      },
      clinic: { select: { name: true } },
    },
  });
  if (!r) throw new Error("Referral no encontrada");

  const stream = await renderToStream(
    ReferralLetterDocument({
      clinicName: r.clinic.name,
      doctorAuthorName: `${r.author.firstName} ${r.author.lastName}`,
      doctorAuthorCedula: r.author.cedulaProfesional ?? null,
      module: r.module,
      generatedAt: new Date().toISOString(),
      patientName: `${r.patient.firstName} ${r.patient.lastName}`,
      patientDob: r.patient.dob ? r.patient.dob.toISOString() : null,
      patientGender: r.patient.gender ?? null,
      contactName: r.contact?.fullName ?? null,
      contactSpecialty: r.contact?.specialty ?? null,
      contactClinicName: r.contact?.clinicName ?? null,
      contactPhone: r.contact?.phone ?? null,
      contactEmail: r.contact?.email ?? null,
      reason: r.reason,
      summary: r.summary,
    }),
  );
  const chunks: Buffer[] = [];
  for await (const c of stream as unknown as AsyncIterable<Buffer>) chunks.push(c);
  const buf = Buffer.concat(chunks);
  // Devolvemos data: URL para que el cliente pueda imprimir/descargar sin
  // necesidad de subir a storage en este MVP.
  return `data:application/pdf;base64,${buf.toString("base64")}`;
}
