"use server";
// Orthodontics — action 1/15: createDiagnosis. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createDiagnosisSchema } from "@/lib/validation/orthodontics";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import { validarArchivosInicialesDelDiagnostico, validarPersonasDelCaso } from "@/lib/orthodontics/validar-personas-del-caso-db";
import {
  auditOrtho,
  getOrthoActionContext,
  loadPatientForOrtho,
} from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createDiagnosis(
  input: unknown,
): Promise<ActionResult<{ id: string; altaCasoFieldsSaved: boolean }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createDiagnosisSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForOrtho({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  // X1: el doctor que refirió llega del navegador — tiene que ser del
  // directorio de ESTA clínica.
  const personaAjena = await validarPersonasDelCaso({
    clinicId: ctx.clinicId,
    patientId: parsed.data.patientId,
    pedidas: { referredByDoctorId: parsed.data.referredByDoctorId },
  });
  if (personaAjena) return fail(personaAjena);
  const archivoAjeno = await validarArchivosInicialesDelDiagnostico({
    clinicId: ctx.clinicId,
    patientId: parsed.data.patientId,
    initialPhotoSetId: parsed.data.initialPhotoSetId,
    initialCephFileId: parsed.data.initialCephFileId,
    initialScanFileId: parsed.data.initialScanFileId,
  });
  if (archivoAjeno) return fail(archivoAjeno);

  // Ola 1 (ws1-t6) — A12/A13: campos nuevos (sql/ortodoncia-alta-caso.sql,
  // aún sin pegar en Supabase al escribir esto). Si la columna no existe
  // todavía (P2021/P2022), reintenta sin ellos: abrir el caso no puede
  // depender de que Rafael ya haya pegado el SQL.
  const baseData = {
    patientId: parsed.data.patientId,
    clinicId: ctx.clinicId,
    diagnosedById: ctx.userId,
    angleClassRight: parsed.data.angleClassRight,
    angleClassLeft: parsed.data.angleClassLeft,
    overbiteMm: parsed.data.overbiteMm,
    overbitePercentage: parsed.data.overbitePercentage,
    overjetMm: parsed.data.overjetMm,
    midlineDeviationMm: parsed.data.midlineDeviationMm ?? null,
    crossbite: parsed.data.crossbite,
    crossbiteDetails: parsed.data.crossbiteDetails ?? null,
    openBite: parsed.data.openBite,
    openBiteDetails: parsed.data.openBiteDetails ?? null,
    crowdingUpperMm: parsed.data.crowdingUpperMm ?? null,
    crowdingLowerMm: parsed.data.crowdingLowerMm ?? null,
    etiologySkeletal: parsed.data.etiologySkeletal,
    etiologyDental: parsed.data.etiologyDental,
    etiologyFunctional: parsed.data.etiologyFunctional,
    etiologyNotes: parsed.data.etiologyNotes ?? null,
    habits: parsed.data.habits,
    habitsDescription: parsed.data.habitsDescription ?? null,
    dentalPhase: parsed.data.dentalPhase,
    tmjPainPresent: parsed.data.tmjPainPresent,
    tmjClickingPresent: parsed.data.tmjClickingPresent,
    tmjNotes: parsed.data.tmjNotes ?? null,
    initialPhotoSetId: parsed.data.initialPhotoSetId ?? null,
    initialCephFileId: parsed.data.initialCephFileId ?? null,
    initialScanFileId: parsed.data.initialScanFileId ?? null,
    clinicalSummary: parsed.data.clinicalSummary,
  };
  const altaCasoFields = {
    referredByDoctorId: parsed.data.referredByDoctorId ?? null,
    inObservation: parsed.data.inObservation,
    nextObservationDate: parsed.data.nextObservationDate
      ? new Date(parsed.data.nextObservationDate)
      : null,
  };
  const wantsAltaCasoFields =
    altaCasoFields.referredByDoctorId != null ||
    altaCasoFields.inObservation ||
    altaCasoFields.nextObservationDate != null;

  try {
    let altaCasoFieldsSaved = wantsAltaCasoFields;
    const created = await prisma.orthodonticDiagnosis
      .create({
        data: { ...baseData, ...altaCasoFields },
        select: { id: true, angleClassRight: true, angleClassLeft: true },
      })
      .catch(async (e) => {
        if (!wantsAltaCasoFields || !isMissingColumnError(e)) throw e;
        altaCasoFieldsSaved = false;
        console.error(
          "[ortho] createDiagnosis: columnas de alta-caso.sql aún no existen, se crea sin ellas:",
          e,
        );
        return prisma.orthodonticDiagnosis.create({
          data: baseData,
          select: { id: true, angleClassRight: true, angleClassLeft: true },
        });
      });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.DIAGNOSIS_CREATED,
      entityType: "OrthodonticDiagnosis",
      entityId: created.id,
      after: {
        patientId: parsed.data.patientId,
        angleR: created.angleClassRight,
        angleL: created.angleClassLeft,
      },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id, altaCasoFieldsSaved });
  } catch (e) {
    console.error("[ortho] createDiagnosis failed:", e);
    return fail("No se pudo crear el diagnóstico");
  }
}
