import "server-only";
// ─────────────────────────────────────────────────────────────────────────────
// Carga lo que lleva el membrete común de los PDF de ortodoncia (ws1-t4).
//
// Una sola lectura para los siete PDF del módulo: la clínica con TODO lo del
// membrete (logo descargado y validado por `clinicLetterheadProps`, dirección,
// ciudad, teléfono, correo, RFC y zona horaria), el paciente y el doctor.
//
// Tenant: `clinicId` sale SIEMPRE de la sesión (lo pasa quien llama) y, si
// faltara, se corta ANTES de consultar — `clinicId: undefined` no filtra nada.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { CLINIC_LETTERHEAD_SELECT, clinicLetterheadProps } from "@/lib/pdf/clinic-letterhead";
import { consentTimeZone } from "@/lib/consent/dates";
import type { DatosDelMembreteOrto } from "./membrete-orto";
import { especialidadDelDoctor } from "./formato";

export async function cargarMembreteOrto(args: {
  clinicId: string;
  patientId: string;
  /** Doctor tratante del caso (`treatingDoctorId ?? diagnosis.diagnosedById`). */
  doctorId: string | null;
  ahora?: Date;
}): Promise<DatosDelMembreteOrto> {
  if (!args.clinicId) throw new Error("cargarMembreteOrto: sin clínica en la sesión");

  const [clinic, patient, doctor] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: args.clinicId },
      select: { ...CLINIC_LETTERHEAD_SELECT, rfcEmisor: true, taxId: true, timezone: true },
    }),
    prisma.patient.findFirst({
      where: { id: args.patientId, clinicId: args.clinicId },
      select: { firstName: true, lastName: true, dob: true, patientNumber: true },
    }),
    args.doctorId
      ? prisma.user.findUnique({
          where: { id: args.doctorId },
          select: {
            firstName: true,
            lastName: true,
            cedulaProfesional: true,
            cedulaEspecialidad: true,
            especialidad: true,
            specialty: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const membrete = await clinicLetterheadProps(clinic);
  const rfc = (clinic?.rfcEmisor || clinic?.taxId || "").trim();

  return {
    ...membrete,
    clinicTaxId: rfc || null,
    zonaHoraria: consentTimeZone(clinic?.timezone),
    emitidoEl: (args.ahora ?? new Date()).toISOString(),
    lugar: [clinic?.city, clinic?.state].filter(Boolean).join(", ") || null,
    paciente: {
      nombre: patient ? `${patient.firstName} ${patient.lastName}`.trim() : "Paciente",
      fechaNacimiento: patient?.dob ? patient.dob.toISOString() : null,
      folio: patient?.patientNumber ?? null,
    },
    doctor: doctor
      ? {
          nombre: `${doctor.firstName} ${doctor.lastName}`.trim(),
          cedula: doctor.cedulaProfesional ?? null,
          cedulaEspecialidad: doctor.cedulaEspecialidad ?? null,
          especialidad: especialidadDelDoctor(doctor.especialidad, doctor.specialty),
        }
      : null,
  };
}
