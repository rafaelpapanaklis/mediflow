// Ortodoncia — X1: consulta de `validar-personas-del-caso.ts`. `clinicId` y
// `patientId` SIEMPRE los pone el servidor (sesión / caso ya cargado con su
// clínica), nunca el navegador.

import { prisma } from "@/lib/prisma";
import { esDoctorTratanteDeLaClinica } from "./doctores-tratantes-db";
import {
  MENSAJE_SIN_CLINICA,
  idsPorComprobar,
  motivoPersonaAjena,
  type PersonaDelCaso,
  type PersonasDelCaso,
} from "./validar-personas-del-caso";

/**
 * `null` si todas las personas pedidas son de esta clínica (y el responsable,
 * de este paciente); si no, el mensaje para el usuario. Falla CERRADO: si la
 * comprobación no se puede hacer, no se guarda.
 */
export async function validarPersonasDelCaso(args: {
  clinicId: string;
  patientId: string;
  pedidas: PersonasDelCaso;
  /** Lo que el caso ya tiene guardado (en una edición): repetirlo no se re-valida. */
  actuales?: PersonasDelCaso;
}): Promise<string | null> {
  const { clinicId, patientId } = args;
  // `clinicId: undefined` no filtra nada en Prisma: se corta antes.
  if (!clinicId || !patientId) return MENSAJE_SIN_CLINICA;

  const porComprobar = idsPorComprobar(args.pedidas, args.actuales);
  if (Object.keys(porComprobar).length === 0) return null;

  try {
    const [guardian, doctor, referidor] = await Promise.all([
      porComprobar.responsibleGuardianId
        ? prisma.guardian.findFirst({
            // De la CLÍNICA, no del paciente: decisión 5 — el responsable de
            // pago se comparte entre hermanos, y el Guardian de un hermano
            // lleva el patientId del hermano (ver buscarTutoresDeLaClinica).
            where: { id: porComprobar.responsibleGuardianId, clinicId, deletedAt: null },
            select: { id: true },
          })
        : null,
      porComprobar.treatingDoctorId
        ? esDoctorTratanteDeLaClinica(clinicId, porComprobar.treatingDoctorId)
        : false,
      porComprobar.referredByDoctorId
        ? prisma.doctorContact.findFirst({
            where: { id: porComprobar.referredByDoctorId, clinicId, deletedAt: null },
            select: { id: true },
          })
        : null,
    ]);
    const encontradas: Partial<Record<PersonaDelCaso, boolean>> = {
      responsibleGuardianId: guardian != null,
      treatingDoctorId: doctor === true,
      referredByDoctorId: referidor != null,
    };
    return motivoPersonaAjena(porComprobar, encontradas);
  } catch (e) {
    console.error("[ortho] validarPersonasDelCaso: no se pudo comprobar:", e);
    return "No se pudo comprobar el doctor o el responsable del caso. Inténtalo de nuevo.";
  }
}

/**
 * Los archivos iniciales del diagnóstico (juego de fotos, cefalometría,
 * escaneo) llegan del navegador: tienen que ser de ESTE paciente en ESTA
 * clínica (mismo hueco que X6 en uploadPhotoToSet). `null` si todo cuadra;
 * si no, el mensaje. Falla CERRADO si no se pudo comprobar.
 */
export async function validarArchivosInicialesDelDiagnostico(args: {
  clinicId: string;
  patientId: string;
  initialPhotoSetId?: string | null;
  initialCephFileId?: string | null;
  initialScanFileId?: string | null;
}): Promise<string | null> {
  const { clinicId, patientId } = args;
  if (!clinicId || !patientId) return MENSAJE_SIN_CLINICA;
  const archivos = [args.initialCephFileId, args.initialScanFileId].filter((x): x is string => !!x);
  if (!args.initialPhotoSetId && archivos.length === 0) return null;
  try {
    const [juego, deEstePaciente] = await Promise.all([
      args.initialPhotoSetId
        ? prisma.orthoPhotoSet.findFirst({
            where: { id: args.initialPhotoSetId, clinicId, patientId },
            select: { id: true },
          })
        : null,
      archivos.length
        ? prisma.patientFile.count({ where: { id: { in: archivos }, clinicId, patientId, deletedAt: null } })
        : 0,
    ]);
    if (args.initialPhotoSetId && !juego) return "El juego de fotos inicial no es de este paciente.";
    if (deEstePaciente !== new Set(archivos).size) return "La cefalometría o el escaneo inicial no es de este paciente.";
    return null;
  } catch (e) {
    console.error("[ortho] validarArchivosInicialesDelDiagnostico: no se pudo comprobar:", e);
    return "No se pudieron comprobar los archivos iniciales del diagnóstico. Inténtalo de nuevo.";
  }
}
