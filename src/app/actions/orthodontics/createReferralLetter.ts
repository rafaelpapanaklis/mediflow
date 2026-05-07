"use server";
// Orthodontics — createReferralLetter. Sección I: genera carta de referencia
// a especialista externo (periodoncista, endodoncista, cirujano maxilofacial).
// Persiste en `referrals` table. PDF se genera bajo demanda con
// /api/referrals/[id]/pdf (puppeteer-based, ya existe).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  patientId: z.string().min(1),
  toClinicName: z.string().min(2).max(200),
  toClinicClues: z.string().max(11).optional().nullable(),
  toDoctorName: z.string().max(200).optional().nullable(),
  toSpecialty: z.string().max(100).optional().nullable(),
  reason: z.string().min(5).max(2000),
  clinicalSummary: z.string().min(10).max(5000),
  type: z.enum(["OUTGOING", "INCOMING"]).default("OUTGOING"),
});

export async function createReferralLetter(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  const patient = await prisma.patient.findFirst({
    where: { id: data.patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) return fail("Paciente no encontrado");

  try {
    const created = await prisma.referral.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: patient.id,
        fromDoctorId: ctx.userId,
        toClinicName: data.toClinicName,
        toClinicClues: data.toClinicClues ?? null,
        toDoctorName: data.toDoctorName ?? null,
        toSpecialty: data.toSpecialty ?? null,
        reason: data.reason,
        clinicalSummary: data.clinicalSummary,
        type: data.type,
        status: "SENT",
      },
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: "ortho.referralLetter.created",
      entityType: "Referral",
      entityId: created.id,
      after: {
        toClinicName: data.toClinicName,
        toSpecialty: data.toSpecialty,
        type: data.type,
      },
    });

    try {
      revalidatePath(`/dashboard/patients/${patient.id}`);
      revalidatePath(`/dashboard/specialties/orthodontics/${patient.id}`);
    } catch (e) {
      console.error("[ortho] createReferralLetter · revalidatePath:", e);
    }

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] createReferralLetter failed:", e);
    return fail(
      e instanceof Error
        ? `No se pudo crear la carta: ${e.message}`
        : "No se pudo crear la carta",
    );
  }
}
