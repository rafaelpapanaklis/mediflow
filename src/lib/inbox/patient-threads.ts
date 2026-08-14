// "Las conversaciones de ESTE paciente" — sin depender de que el hilo esté
// enlazado.
//
// EL FALLO QUE ARREGLA: el enlace hilo↔paciente (`InboxThread.patientId`) solo
// se intentaba UNA VEZ, al crear el hilo desde el webhook. Si el paciente se dio
// de alta DESPUÉS de que empezara la conversación, o si su teléfono se capturó o
// se corrigió más tarde, el hilo se quedaba huérfano PARA SIEMPRE: nada lo
// revisaba de nuevo. Y todo lo que filtraba por `patientId` —el Inbox al llegar
// con `?patientId=`, la tarjeta "WhatsApp recientes" de la ficha— salía vacío
// aunque la conversación estuviera ahí, con el hilo mostrándose bajo el nombre
// de perfil de WhatsApp ("ra rara") en vez del nombre del paciente.
//
// LAS TRES CAPAS, en este orden:
//   1. BUSCAR por teléfono además de por el enlace (nunca depende del enlace);
//   2. REPARAR el enlace que falte, cuando el match sea inequívoco;
//   3. (fuera de aquí) ENLAZAR al dar de alta o corregir el teléfono del
//      paciente — el origen del problema, en /api/patients.
//
// El criterio de emparejamiento es el ÚNICO del repo: últimos 10 dígitos
// normalizados en ambos lados (lib/whatsapp/inbox-log). Aquí no se re-escribe.

import { prisma } from "@/lib/prisma";
import {
  findWhatsAppThreadsForPhone,
  linkOrphanThreadsToPatient,
} from "@/lib/whatsapp/inbox-log";

export interface PatientThreadScope {
  /** Datos mínimos del paciente, o null si no existe en esta clínica. */
  patient: { id: string; firstName: string; lastName: string; phone: string | null } | null;
  /**
   * Ids de los hilos que corresponden al paciente POR TELÉFONO y que el filtro
   * por `patientId` no encontraría solo (huérfanos). Vacío si no hay ninguno.
   */
  extraThreadIds: string[];
  /** Cuántos enlaces huérfanos se repararon en esta llamada (0 casi siempre). */
  repaired: number;
  /**
   * El número lo comparten varios pacientes de la clínica: los hilos se
   * ENCUENTRAN igual, pero no se escribe el enlace (haría falta desambiguar).
   */
  ambiguous: boolean;
}

const EMPTY: PatientThreadScope = {
  patient: null,
  extraThreadIds: [],
  repaired: 0,
  ambiguous: false,
};

/**
 * Resuelve el alcance "hilos de este paciente" dentro de UNA clínica.
 *
 * `clinicId` viene SIEMPRE del contexto de servidor del caller, nunca del body.
 * Este helper NO comprueba la visibilidad por paciente: eso lo hace el caller
 * con `assertPatientVisible` antes de llamar (aquí solo se resuelven ids).
 *
 * `repair: false` lo usa el polling (/api/inbox/since), que corre cada 5 s y no
 * tiene por qué escribir: para entonces el GET de la lista ya reparó.
 */
export async function resolvePatientThreadScope(
  clinicId: string,
  patientId: string,
  opts?: { repair?: boolean },
): Promise<PatientThreadScope> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  if (!patient) return EMPTY;
  if (!patient.phone || patient.phone.trim() === "") {
    // Sin teléfono no hay nada que emparejar: solo valen los hilos ya ligados.
    return { patient, extraThreadIds: [], repaired: 0, ambiguous: false };
  }

  const repair = opts?.repair ?? true;
  if (!repair) {
    // Solo lectura: los huérfanos se localizan igual, no se escribe el enlace.
    const threads = await findWhatsAppThreadsForPhone(clinicId, patient.phone);
    return {
      patient,
      extraThreadIds: threads.filter((t) => t.patientId === null).map((t) => t.id),
      repaired: 0,
      ambiguous: false,
    };
  }

  const link = await linkOrphanThreadsToPatient({
    clinicId,
    patientId: patient.id,
    phone: patient.phone,
  });
  return {
    patient,
    extraThreadIds: link.threadIds,
    repaired: link.linked,
    ambiguous: link.ambiguous,
  };
}

/**
 * Cláusula de Prisma para "los hilos de este paciente": el enlace directo O los
 * que le corresponden por teléfono. Va en el `AND` del where, no en su `OR`:
 * ese `OR` ya lo ocupa la búsqueda por texto y meterlo ahí volvería el filtro
 * PERMISIVO (traería la clínica entera) en vez de restrictivo.
 */
export function patientThreadWhere(patientId: string, extraThreadIds: string[]) {
  if (extraThreadIds.length === 0) return { patientId };
  return { OR: [{ patientId }, { id: { in: extraThreadIds } }] };
}
