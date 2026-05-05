"use server";
// Pediatrics — server action para alta unificada (paciente + tutor + record). Spec: §7 (sprint 2)

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { isPediatric } from "@/lib/pediatrics/age";
import { DEFAULT_PEDIATRICS_CUTOFF_YEARS } from "@/lib/pediatrics/permissions";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, fail, isFailure, ok, type ActionResult } from "./_helpers";

const PARENTESCO = [
  "madre", "padre", "tutor_legal", "abuelo", "abuela",
  "tio", "tia", "hermano", "hermana", "otro",
] as const;

const VACCINATION = ["completo", "incompleto", "desconocido"] as const;
const FEEDING = ["materna", "mixta", "formula", "na"] as const;

const inputSchema = z.object({
  patient: z.object({
    firstName: z.string().min(1, "Nombre requerido").max(60),
    lastName: z.string().min(1, "Apellido requerido").max(60),
    dob: z.string().datetime("Fecha de nacimiento inválida"),
    gender: z.enum(["M", "F", "OTHER"]).optional(),
    phone: z.string().max(40).optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    address: z.string().max(300).optional().nullable(),
    allergies: z.array(z.string()).optional(),
    chronicConditions: z.array(z.string()).optional(),
    insuranceProvider: z.string().max(120).optional().nullable(),
    insurancePolicy: z.string().max(60).optional().nullable(),
  }),
  guardian: z.object({
    fullName: z.string().min(2, "Nombre del tutor requerido").max(120),
    parentesco: z.enum(PARENTESCO),
    phone: z.string().min(7, "Teléfono del tutor requerido"),
    email: z.string().email().optional().nullable().or(z.literal("")),
    address: z.string().max(300).optional().nullable(),
    esResponsableLegal: z.boolean().optional(),
  }),
  record: z
    .object({
      birthWeightKg: z.number().min(0).max(20).optional().nullable(),
      gestationWeeks: z.number().int().min(20).max(45).optional().nullable(),
      prematuro: z.boolean().optional(),
      vaccinationStatus: z.enum(VACCINATION).optional(),
      feedingType: z.enum(FEEDING).optional(),
      specialConditions: z.array(z.string()).optional(),
    })
    .optional(),
});

export type CreatePediatricPatientInput = z.infer<typeof inputSchema>;

export type CreatePediatricPatientResult = ActionResult<{
  patientId: string;
  guardianId: string;
  pediatricRecordId: string | null;
}>;

/**
 * Alta unificada de paciente pediátrico:
 *   1. Crea Patient con patientNumber autogenerado.
 *   2. Crea Guardian principal (siempre).
 *   3. Si `record` viene, crea PediatricRecord con primaryGuardianId.
 *
 * Todo en una transacción: si algo falla, se rollback completo. Auditado
 * con 2-3 entradas (1 por entidad creada). Multi-tenant: clinicId del ctx.
 */
export async function createPediatricPatient(
  input: CreatePediatricPatientInput,
): Promise<CreatePediatricPatientResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  if (ctx.clinicCategory !== "DENTAL" && ctx.clinicCategory !== "MEDICINE") {
    return fail("La clínica no soporta el módulo de Pediatría");
  }

  const dob = new Date(parsed.data.patient.dob);
  if (Number.isNaN(dob.getTime())) return fail("Fecha de nacimiento inválida");
  if (!isPediatric(dob, DEFAULT_PEDIATRICS_CUTOFF_YEARS)) {
    return fail(`El paciente debe ser menor de ${DEFAULT_PEDIATRICS_CUTOFF_YEARS} años`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const count = await tx.patient.count({ where: { clinicId: ctx.clinicId } });
      const patientNumber = `P${String(count + 1).padStart(4, "0")}`;

      const patient = await tx.patient.create({
        data: {
          clinicId: ctx.clinicId,
          patientNumber,
          firstName: parsed.data.patient.firstName.trim(),
          lastName: parsed.data.patient.lastName.trim(),
          dob,
          gender: parsed.data.patient.gender ?? "OTHER",
          phone: parsed.data.patient.phone?.trim() || null,
          email: parsed.data.patient.email?.trim() || null,
          address: parsed.data.patient.address?.trim() || null,
          allergies: parsed.data.patient.allergies ?? [],
          chronicConditions: parsed.data.patient.chronicConditions ?? [],
          insuranceProvider: parsed.data.patient.insuranceProvider?.trim() || null,
          insurancePolicy: parsed.data.patient.insurancePolicy?.trim() || null,
          isChild: true,
          primaryDoctorId: ctx.isDoctor ? ctx.userId : null,
        },
        select: { id: true, patientNumber: true },
      });

      const guardian = await tx.guardian.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: patient.id,
          fullName: parsed.data.guardian.fullName.trim(),
          parentesco: parsed.data.guardian.parentesco,
          phone: parsed.data.guardian.phone.trim(),
          email: parsed.data.guardian.email?.trim() || null,
          address: parsed.data.guardian.address?.trim() || null,
          esResponsableLegal: parsed.data.guardian.esResponsableLegal ?? true,
          principal: true,
          createdBy: ctx.userId,
        },
        select: { id: true },
      });

      let pediatricRecordId: string | null = null;
      if (parsed.data.record) {
        const r = parsed.data.record;
        const created = await tx.pediatricRecord.create({
          data: {
            clinicId: ctx.clinicId,
            patientId: patient.id,
            createdBy: ctx.userId,
            primaryGuardianId: guardian.id,
            birthWeightKg: r.birthWeightKg ?? null,
            gestationWeeks: r.gestationWeeks ?? null,
            prematuro: r.prematuro ?? false,
            vaccinationStatus: r.vaccinationStatus ?? "desconocido",
            feedingType: r.feedingType ?? "na",
            specialConditions: r.specialConditions ?? [],
          },
          select: { id: true },
        });
        pediatricRecordId = created.id;
        // Vincula guardian al pediatricRecord (relación AllGuardians).
        await tx.guardian.update({
          where: { id: guardian.id },
          data: { pediatricRecordId },
        });
      }

      return { patientId: patient.id, guardianId: guardian.id, pediatricRecordId };
    });

    // Audit logs fuera de la transacción (no son críticos al rollback).
    await Promise.all([
      auditPediatric({
        ctx,
        action: PEDIATRIC_AUDIT_ACTIONS.GUARDIAN_ADDED,
        entityType: "ped-guardian",
        entityId: result.guardianId,
        changes: { source: "onboarding-wizard" },
      }),
      result.pediatricRecordId
        ? auditPediatric({
            ctx,
            action: PEDIATRIC_AUDIT_ACTIONS.RECORD_CREATED,
            entityType: "pediatric-record",
            entityId: result.pediatricRecordId,
            changes: { source: "onboarding-wizard" },
          })
        : Promise.resolve(),
    ]);

    revalidatePath("/dashboard/specialties/pediatrics");
    revalidatePath("/dashboard/patients");
    return ok(result);
  } catch (e) {
    console.error("[createPediatricPatient]", e);
    return fail("No se pudo crear el paciente. Intenta de nuevo.");
  }
}

// Re-export del helper para uso conveniente desde el wizard.
export { isFailure };
