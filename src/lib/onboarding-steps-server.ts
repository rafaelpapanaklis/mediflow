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
// Paso 'doctor' («Agrega un doctor», la etiqueta no cambia): hecho cuando la
// clínica tiene EQUIPO_MINIMO o más usuarios ACTIVOS en Equipo, del rol que
// sea (decisión de Rafael, 1-nov-2026: «2+ personas en Equipo»). Antes contaba
// solo role='DOCTOR' y una clínica con 4 ADMIN/SUPER_ADMIN seguía en «falta».
// El dueño cuenta como 1: con él solo, falta; un inactivo no cuenta.
//
// onboardingCountsDoneUntil: epoch ms (por clinicId) hasta el que los 6 counts
// con datos se dan por completados sin re-correr los COUNT(*). Solo se cachea el
// estado terminal — completar onboarding es monotónico — así una clínica a
// medias consulta SIEMPRE fresco y su checklist avanza en vivo. Memoria por
// instancia, TTL 10 min. (Monotónico «casi»: desactivar a alguien de Equipo,
// como antes borrar a un doctor o a un paciente, puede devolver un paso a
// «falta»; con el terminal cacheado eso se ve como mucho 10 min tarde, que es
// el mismo margen que ya aceptaba la caché.)
const ONBOARDING_DONE_TTL_MS = 10 * 60_000;
const onboardingCountsDoneUntil = new Map<string, number>();

/** Personas ACTIVAS en Equipo (cualquier rol) para dar por hecho el paso 'doctor'. */
export const EQUIPO_MINIMO = 2;

export interface OnboardingCounts {
  /** usuarios ACTIVOS de la clínica, de cualquier rol */
  equipo: bigint | number;
  patients: bigint | number;
  appts: bigint | number;
  records: bigint | number;
  invoices: bigint | number;
  schedules: bigint | number;
}

/**
 * Puro: los counts → ids de pasos hechos (orden de STEPS) y si es el estado
 * terminal (los 6 en verde, incluido 'record', que no es paso) que se cachea.
 */
export function pasosHechosDeConteos(c: OnboardingCounts): { completed: string[]; terminal: boolean } {
  const completed: string[] = [];
  let dbDone = 0;
  if (Number(c.equipo)    >= EQUIPO_MINIMO) { completed.push("doctor"); dbDone++; }
  if (Number(c.schedules) > 0) { completed.push("schedule");    dbDone++; }
  if (Number(c.patients)  > 0) { completed.push("patient");     dbDone++; }
  if (Number(c.appts)     > 0) { completed.push("appointment"); dbDone++; }
  if (Number(c.records)   > 0) { dbDone++; }
  if (Number(c.invoices)  > 0) { completed.push("invoice");     dbDone++; }
  return { completed, terminal: dbDone === 6 };
}

export const getOnboardingCompleted = cache(
  async (clinicId: string, waConnected: boolean): Promise<string[]> => {
    const countsKnownDone =
      (onboardingCountsDoneUntil.get(clinicId) ?? 0) > Date.now();

    const counts = countsKnownDone
      ? null
      : await prisma.$queryRaw<[OnboardingCounts]>`
      SELECT
        (SELECT COUNT(*) FROM users WHERE "clinicId" = ${clinicId} AND "isActive" = true) AS equipo,
        (SELECT COUNT(*) FROM patients WHERE "clinicId" = ${clinicId}) AS patients,
        (SELECT COUNT(*) FROM appointments WHERE "clinicId" = ${clinicId}) AS appts,
        (SELECT COUNT(*) FROM medical_records WHERE "clinicId" = ${clinicId}) AS records,
        (SELECT COUNT(*) FROM invoices WHERE "clinicId" = ${clinicId}) AS invoices,
        (SELECT COUNT(*) FROM clinic_schedules WHERE "clinicId" = ${clinicId}) AS schedules
    `;

    const completed: string[] = [];
    if (counts) {
      // 'completed' solo lleva ids que son pasos de STEPS; 'terminal' cuenta
      // además 'record' para decidir si se cachea.
      const r = pasosHechosDeConteos(counts[0]);
      completed.push(...r.completed);
      if (r.terminal) {
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
