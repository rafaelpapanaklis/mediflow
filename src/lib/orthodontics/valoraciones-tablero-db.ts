// Ortodoncia — cargador de «Valoraciones» del Tablero (ws1-t4 ronda 6, fila
// 16 de la revisión de lógica de uso). El I/O de `valoraciones-tablero.ts`,
// que es puro y tiene los tests.
//
// `clinicId` SIEMPRE de la sesión. Tres consultas en fila (configuración,
// citas y casos), todas por clínica y por visibilidad de paciente: quien solo
// ve a sus pacientes solo cuenta las valoraciones de sus pacientes.

import { prisma } from "@/lib/prisma";
import { relatedPatientVisibilityAnd, type VisibilityViewer } from "@/lib/patient-visibility";
import { loadOrthoClinicSettings } from "./clinic-settings-db";
import {
  DIAS_VENTANA_VALORACIONES,
  resumirValoraciones,
  textoDelTipoValoracion,
  type ResumenDeValoraciones,
} from "./valoraciones-tablero";
import { SIN_FILTRO_DE_PRUEBA, type FiltroSinPrueba } from "@/lib/patients/paciente-de-prueba";

/** Hasta dónde se mira hacia adelante para contar las valoraciones agendadas. */
const DIAS_DE_FUTURO = 180;

export async function cargarValoracionesDelTablero(
  clinicId: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
  // ws1-t11 (11d): sin los «Pacientes de prueba / no contactar».
  sinPrueba: FiltroSinPrueba = SIN_FILTRO_DE_PRUEBA,
): Promise<ResumenDeValoraciones> {
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId) return resumirValoraciones([], [], ahora);

  const settings = await loadOrthoClinicSettings(clinicId);
  const tipo = textoDelTipoValoracion(settings.appointmentTypes);

  const citas = await prisma.appointment.findMany({
    where: {
      clinicId,
      ...sinPrueba.porPatientId,
      type: tipo,
      startsAt: {
        gte: new Date(ahora.getTime() - DIAS_VENTANA_VALORACIONES * 86_400_000),
        lte: new Date(ahora.getTime() + DIAS_DE_FUTURO * 86_400_000),
      },
      AND: relatedPatientVisibilityAnd(viewer),
    },
    select: { patientId: true, startsAt: true, status: true },
    take: 2000,
  });
  if (citas.length === 0) return resumirValoraciones([], [], ahora);

  const pacientes = Array.from(new Set(citas.map((c) => c.patientId)));
  const casos = await prisma.orthodonticTreatmentPlan.findMany({
    where: { clinicId, deletedAt: null, patientId: { in: pacientes } },
    select: { patientId: true, createdAt: true },
  });

  return resumirValoraciones(citas, casos, ahora);
}
