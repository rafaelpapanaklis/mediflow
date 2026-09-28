// Ortodoncia — cargador de «Pacientes en tratamiento» (ws1-t4 ronda 6). El
// I/O de `pacientes-modulo.ts`, que es puro y tiene los tests.
//
// Los casos salen de `loadOrthoCases`, la misma base que el Tablero, Alertas,
// Cobranza y Controles (ya filtrada por clínica y por visibilidad de
// paciente). Aquí se añade lo clínico: la técnica y las fases de cada caso, y
// cuándo fue y cuándo es su control.
//
// `clinicId` y `zonaHoraria` SIEMPRE de la sesión. Tres consultas en un
// `Promise.all` (menos de 7, regla del pooler), todas por clínica y acotadas
// a los casos y pacientes que esta persona puede ver.

import { prisma } from "@/lib/prisma";
import type { VisibilityViewer } from "@/lib/patient-visibility";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { loadOrthoCases } from "./tablero-data";
import {
  controlesPorPaciente,
  filaDeCaso,
  type FilaDeCaso,
  type LoClinicoDelCaso,
} from "./pacientes-modulo";

/** Hasta dónde se mira hacia atrás y hacia adelante: igual que la pantalla Controles. */
const DIAS_DE_HISTORIAL = 365;
const DIAS_DE_FUTURO = 180;

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function cargarFilasDeCasos(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
): Promise<FilaDeCaso[]> {
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId) return [];

  const { cases } = await loadOrthoCases(clinicId, zonaHoraria, viewer, ahora);
  if (cases.length === 0) return [];

  const planIds = cases.map((c) => c.planId);
  const pacientes = Array.from(new Set(cases.map((c) => c.patientId)));

  const [planes, citas, hojas] = await Promise.all([
    prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, id: { in: planIds } },
      select: { id: true, technique: true, phases: { select: { status: true, phaseKey: true } } },
    }),
    prisma.appointment.findMany({
      where: {
        clinicId,
        type: TIPO_CITA_CONTROL_ORTO,
        patientId: { in: pacientes },
        startsAt: {
          gte: new Date(ahora.getTime() - DIAS_DE_HISTORIAL * 86_400_000),
          lte: new Date(ahora.getTime() + DIAS_DE_FUTURO * 86_400_000),
        },
      },
      select: { patientId: true, startsAt: true, status: true },
      take: 5000,
    }),
    // Si la tabla de hojas todavía no existe en esta base, la pantalla sale
    // igual: el último control se lee solo de las citas atendidas.
    prisma.orthoTreatmentCard
      .groupBy({
        by: ["patientId"],
        where: { clinicId, patientId: { in: pacientes }, visitDate: { lte: ahora } },
        _max: { visitDate: true },
      })
      .catch((e: unknown) => {
        if (!esRelacionAusente(e)) throw e;
        return [];
      }),
  ]);

  const clinico = new Map<string, LoClinicoDelCaso>(
    planes.map((p) => [p.id, { technique: p.technique, phases: p.phases }]),
  );
  const controles = controlesPorPaciente(
    citas,
    hojas.flatMap((h) => (h._max.visitDate ? [{ patientId: h.patientId, visitDate: h._max.visitDate }] : [])),
    ahora,
  );

  return cases
    .map((c) => filaDeCaso(c, clinico.get(c.planId), controles.get(c.patientId), ahora))
    .filter((f): f is FilaDeCaso => f !== null)
    .sort((a, b) => a.patientName.localeCompare(b.patientName, "es"));
}
