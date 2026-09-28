// Orthodontics — cargador de datos para la pantalla de Alertas (L1-L5, ws1-t2,
// Ola 1, alcance-ortodoncia.html). Comparte la base de `loadOrthoCases`
// (tablero-data.ts): un caso por plan de tratamiento con su cobranza real ya
// resuelta contra la factura del tratamiento (decisión 1 de la arquitectura).
//
// L2/L3 (falta de control / no-show) salen de la Agenda —
// `TIPO_CITA_CONTROL_ORTO` (decisión 2) —, nunca de
// `OrthodonticControlAppointment` (modelo viejo, S2, sin ocultar todavía).
//
// `clinicId`/`zonaHoraria` SIEMPRE de la sesión, nunca del cliente.
//
// Revisión cruzada (REPORTE-ws1-t1.md, «## Revisión cruzada», bloquea): la
// consulta de citas no filtraba por visibilidad de paciente — mismo arreglo
// que tablero-data.ts.

import { prisma } from "@/lib/prisma";
import { relatedPatientVisibilityAnd, type VisibilityViewer } from "@/lib/patient-visibility";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { loadOrthoCases } from "./tablero-data";
import {
  listFinishingSoon,
  listMissingNextControl,
  listOverduePatients,
  listPastDue,
  type DurationAlertEntry,
  type MissingNextControlEntry,
  type OverduePatientEntry,
} from "./specialty-kpis";
import { agruparFotosPorRevisar, type FotosPorRevisarEntry } from "./fotos-paciente";
import { cargarFotosPorRevisar } from "./fotos-paciente-db";

export interface NoShowEntry {
  patientId: string;
  patientName: string;
  scheduledAt: Date;
}

export interface OrthoAlertsData {
  /** L1 */
  overduePayments: OverduePatientEntry[];
  /** L2 */
  missingNextControl: MissingNextControlEntry[];
  /** L3 — faltas de los últimos 30 días a un control, más recientes primero. */
  noShows: NoShowEntry[];
  /** L4 */
  finishingSoon: DurationAlertEntry[];
  /** L5 */
  pastDue: DurationAlertEntry[];
  /**
   * ws1-t5 (ronda 6, hallazgo 96) — casos con fotos que mandó el paciente
   * desde su portal y nadie ha revisado. Primero el que lleva más esperando.
   * Opcional: una vista armada a mano sin este dato se pinta como «sin fotos».
   */
  patientPhotos?: FotosPorRevisarEntry[];
}

const NO_SHOW_WINDOW_DAYS = 30;
const FUTURE_CONTROL_WINDOW_DAYS = 180;

export async function loadOrthoAlerts(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
): Promise<OrthoAlertsData> {
  const { cases } = await loadOrthoCases(clinicId, zonaHoraria, viewer, ahora);

  const windowStart = new Date(ahora.getTime() - NO_SHOW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(ahora.getTime() + FUTURE_CONTROL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const appointments = await prisma.appointment.findMany({
    where: {
      clinicId,
      type: TIPO_CITA_CONTROL_ORTO,
      startsAt: { gte: windowStart, lte: windowEnd },
      AND: relatedPatientVisibilityAnd(viewer),
    },
    select: {
      patientId: true,
      startsAt: true,
      status: true,
      patient: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startsAt: "desc" },
    take: 2000,
  });

  const futureControlPatientIds = new Set(
    appointments.filter((a) => a.startsAt >= ahora && a.status !== "CANCELLED").map((a) => a.patientId),
  );

  const noShows: NoShowEntry[] = appointments
    .filter((a) => a.status === "NO_SHOW" && a.startsAt < ahora)
    .map((a) => ({
      patientId: a.patientId,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      scheduledAt: a.startsAt,
    }));

  // ws1-t5 (96): nunca lanza; sin tabla o con la base caída, no hay avisos.
  const fotos = await cargarFotosPorRevisar(clinicId, viewer);

  return {
    patientPhotos: agruparFotosPorRevisar(fotos),
    overduePayments: listOverduePatients(cases),
    missingNextControl: listMissingNextControl(cases, futureControlPatientIds),
    noShows,
    finishingSoon: listFinishingSoon(cases, ahora),
    pastDue: listPastDue(cases, ahora),
  };
}
