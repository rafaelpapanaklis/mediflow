import { cache } from "react";
import { prisma } from "@/lib/prisma";

// Checklist de onboarding — cálculo server-side compartido por el layout del
// dashboard (baja el estado a la sidebar) y el home del panel (monta el
// <OnboardingChecklist/> para admins). Envuelto en React.cache: si ambos lo
// llaman en el mismo request con los mismos args, los COUNT(*) corren UNA vez.
//
// Los ids devueltos se alinean con STEPS (onboarding-steps.ts):
//   doctor · schedule · patient · appointment · invoice · whatsapp
// 'record' (medical_records) NO es un paso del checklist; solo cuenta para el
// estado terminal (los 6 counts en verde) que habilita la caché de abajo.
//
// onboardingCountsDoneUntil: epoch ms (por clinicId) hasta el que los 6 counts
// con datos se dan por completados sin re-correr los COUNT(*). Solo se cachea el
// estado terminal — completar onboarding es monotónico — así una clínica a
// medias consulta SIEMPRE fresco y su checklist avanza en vivo. Memoria por
// instancia, TTL 10 min.
const ONBOARDING_DONE_TTL_MS = 10 * 60_000;
const onboardingCountsDoneUntil = new Map<string, number>();

export const getOnboardingCompleted = cache(
  async (clinicId: string, waConnected: boolean): Promise<string[]> => {
    const countsKnownDone =
      (onboardingCountsDoneUntil.get(clinicId) ?? 0) > Date.now();

    const counts = countsKnownDone
      ? null
      : await prisma.$queryRaw<
          [{ doctors: bigint; patients: bigint; appts: bigint; records: bigint; invoices: bigint; schedules: bigint }]
        >`
      SELECT
        (SELECT COUNT(*) FROM users WHERE "clinicId" = ${clinicId} AND role = 'DOCTOR') AS doctors,
        (SELECT COUNT(*) FROM patients WHERE "clinicId" = ${clinicId}) AS patients,
        (SELECT COUNT(*) FROM appointments WHERE "clinicId" = ${clinicId}) AS appts,
        (SELECT COUNT(*) FROM medical_records WHERE "clinicId" = ${clinicId}) AS records,
        (SELECT COUNT(*) FROM invoices WHERE "clinicId" = ${clinicId}) AS invoices,
        (SELECT COUNT(*) FROM clinic_schedules WHERE "clinicId" = ${clinicId}) AS schedules
    `;

    const completed: string[] = [];
    if (counts) {
      const c = counts[0];
      // dbDone cuenta los 6 counts DB (incluye 'record') para decidir el
      // terminal; el array 'completed' solo lleva ids que son pasos de STEPS.
      let dbDone = 0;
      if (Number(c.doctors)   > 0) { completed.push("doctor");      dbDone++; }
      if (Number(c.schedules) > 0) { completed.push("schedule");    dbDone++; }
      if (Number(c.patients)  > 0) { completed.push("patient");     dbDone++; }
      if (Number(c.appts)     > 0) { completed.push("appointment"); dbDone++; }
      if (Number(c.records)   > 0) { dbDone++; }
      if (Number(c.invoices)  > 0) { completed.push("invoice");     dbDone++; }
      if (dbDone === 6) {
        onboardingCountsDoneUntil.set(clinicId, Date.now() + ONBOARDING_DONE_TTL_MS);
      }
    } else {
      // Terminal cacheado: los 6 counts DB ya estaban completos.
      completed.push("doctor", "schedule", "patient", "appointment", "invoice");
    }
    if (waConnected) completed.push("whatsapp");
    return completed;
  },
);
