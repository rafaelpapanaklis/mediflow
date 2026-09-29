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
import { diaEnZona, historialDeControles } from "./controles-modulo";
import { listaDePospuestas, quitarPospuestas, vigentes, type PospuestaVisible } from "./alertas-pospuestas";
import { citaAtendida } from "./controles-modulo";
import { cargarPosposiciones } from "./alertas-pospuestas-db";
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
  /**
   * ws1-t4 ronda 6 (fila 22) — cuántas filas no salen porque alguien las
   * pospuso 7 días. Ya vienen quitadas de las listas de arriba.
   */
  pospuestas?: number;
  /** H14: las pospuestas vigentes, para verlas y deshacerlas. */
  pospuestasLista?: PospuestaVisible[];
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

  // ws1-t4 ronda 6 (fila 23): una cita de más tarde que ya se atendió (al
  // firmar la hoja se cierra) no es «su próximo control»; ni una falta.
  // Mismo criterio que Controles (`historialDeControles`).
  const futureControlPatientIds = new Set(
    appointments
      .filter(
        (a) =>
          a.startsAt >= ahora &&
          a.status !== "CANCELLED" &&
          a.status !== "NO_SHOW" &&
          !citaAtendida(a.status),
      )
      .map((a) => a.patientId),
  );

  // H44: una falta deja de contar en cuanto el paciente ya vino después
  // (Controles ya lo daba por al día; Alertas lo seguía marcando 30 días).
  const historial = historialDeControles(appointments, ahora);
  const noShows: NoShowEntry[] = appointments
    .filter((a) => a.status === "NO_SHOW" && a.startsAt < ahora)
    .filter((a) => {
      const vino = historial.ultimoAtendido.get(a.patientId);
      return !vino || vino < a.startsAt;
    })
    .map((a) => ({
      patientId: a.patientId,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      scheduledAt: a.startsAt,
    }));

  // ws1-t5 (96): nunca lanza; sin tabla o con la base caída, no hay avisos.
  const fotos = await cargarFotosPorRevisar(clinicId, viewer);
  // ws1-t4 ronda 6 (fila 22): nunca lanza; sin tabla, nada pospuesto.
  const posposiciones = await cargarPosposiciones(clinicId, ahora);
  const activas = vigentes(posposiciones, ahora);
  const nombres = new Map<string, string>(cases.map((c) => [c.patientId, c.patientName]));
  for (const a of appointments) nombres.set(a.patientId, `${a.patient.firstName} ${a.patient.lastName}`.trim());

  // H14: quien vino HOY no alerta «sin próximo control» el mismo día (Controles ya dice
  // «Vino hoy · falta agendar el siguiente»): la recepción lo agenda al despedirlo.
  const hoy = diaEnZona(ahora, zonaHoraria);
  const vinoHoy = (patientId: string) => {
    const ultimo = historial.ultimoAtendido.get(patientId);
    return Boolean(ultimo) && diaEnZona(ultimo!, zonaHoraria) === hoy;
  };
  const sinControlCrudo = listMissingNextControl(cases, futureControlPatientIds).filter((c) => !vinoHoy(c.patientId));

  const sinControl = quitarPospuestas(sinControlCrudo, "sin-proximo-control", activas);
  const faltas = quitarPospuestas(noShows, "no-asistio", activas);
  const porTerminar = quitarPospuestas(listFinishingSoon(cases, ahora), "proximo-a-terminar", activas);
  const pasados = quitarPospuestas(listPastDue(cases, ahora), "pasado-de-fecha", activas);

  return {
    patientPhotos: agruparFotosPorRevisar(fotos),
    overduePayments: listOverduePatients(cases),
    missingNextControl: sinControl.quedan,
    noShows: faltas.quedan,
    finishingSoon: porTerminar.quedan,
    pastDue: pasados.quedan,
    pospuestas: sinControl.pospuestas + faltas.pospuestas + porTerminar.pospuestas + pasados.pospuestas,
    pospuestasLista: listaDePospuestas(posposiciones, ahora, nombres),
  };
}
