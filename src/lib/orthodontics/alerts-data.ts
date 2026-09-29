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
import { diaEnZona, historialDeControles, vinoHoy } from "./controles-modulo";
import { cargarUltimasHojasPorPaciente } from "./hojas-por-paciente-db";
import { listaDePospuestas, quitarPospuestas, vigentes, type PospuestaVisible } from "./alertas-pospuestas";
import { cargarPosposiciones } from "./alertas-pospuestas-db";
import { cargarFotosPorRevisar } from "./fotos-paciente-db";
import { cargarPlanesDetalle } from "./plan-detalle-db";
import { cargarRadiografiasTipificadas } from "./plan-radiografias-db";
import { cargarCasosIncompletos, type CasoIncompleto } from "./casos-incompletos-db";
import { reevaluacionesPendientes, textoDeReevaluacion, type ReevaluacionPendiente } from "./plan-detalle";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";

export interface NoShowEntry {
  patientId: string;
  patientName: string;
  scheduledAt: Date;
}

/** ws1-t12 — un caso al que le toca reevaluación radiográfica (por la fecha del plan o por su periodicidad). */
export interface ReevaluacionRadiograficaEntry {
  patientId: string;
  patientName: string;
  treatmentPlanId: string;
  /** Lo que toca, lo más vencido primero. */
  pendientes: ReevaluacionPendiente[];
  /** Lo mismo en palabras: «Panorámica (tocaba el 12/03/2026, contada desde el inicio del caso)». */
  textos: string[];
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
   * ws1-t12 — «Reevaluación radiográfica»: la fecha de reevaluación del plan de tratamiento llegó, o pasó la
   * periodicidad desde la última radiografía de ese tipo (o desde el inicio del caso). Se puede posponer 7 días.
   * Opcional: una vista armada a mano sin este dato se pinta como «sin reevaluaciones».
   */
  reevaluacionRadiografica?: ReevaluacionRadiograficaEntry[];
  /**
   * ws1-t12 — casos activos con el diagnóstico o el plan de tratamiento incompletos (sobre todo los migrados de
   * Dentalink), cada uno con el paso al que lleva su acceso directo. No se pospone: se resuelve completándolo.
   */
  incompletos?: CasoIncompleto[];
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

  // H44: una falta deja de contar en cuanto el paciente ya vino después
  // (Controles ya lo daba por al día; Alertas lo seguía marcando 30 días).
  // Una hoja de control registrada también es un control hecho (aunque no tenga cita):
  // la misma lectura que Controles, para que «Vino hoy» diga lo mismo en las dos.
  const hojas = await cargarUltimasHojasPorPaciente(clinicId, Array.from(new Set(cases.map((c) => c.patientId))), ahora);
  const historial = historialDeControles(appointments, ahora, hojas, zonaHoraria);
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
  const vinoHoyElPaciente = (patientId: string) => vinoHoy(historial, patientId, hoy, zonaHoraria);
  const sinControlCrudo = listMissingNextControl(cases, historial.conControlFuturo).filter((c) => !vinoHoyElPaciente(c.patientId));

  const sinControl = quitarPospuestas(sinControlCrudo, "sin-proximo-control", activas);
  const faltas = quitarPospuestas(noShows, "no-asistio", activas);
  const porTerminar = quitarPospuestas(listFinishingSoon(cases, ahora), "proximo-a-terminar", activas);
  const pasados = quitarPospuestas(listPastDue(cases, ahora), "pasado-de-fecha", activas);

  // ws1-t12: reevaluación radiográfica del plan de tratamiento. Dos lecturas más para todos los casos (el plan y
  // las radiografías tipificadas); nunca lanzan. Solo los casos cuyo plan pide fecha o periodicidad cuentan.
  const reevaluaciones = await reevaluacionesDeLosCasos(clinicId, zonaHoraria, cases, ahora);
  const reevaluacion = quitarPospuestas(reevaluaciones, "reevaluacion-radiografica", activas);

  // ws1-t12: casos con diagnóstico o plan incompleto (una lectura más para todos los casos; nunca lanza).
  const incompletos = await cargarCasosIncompletos(clinicId, cases);

  return {
    incompletos,
    patientPhotos: agruparFotosPorRevisar(fotos),
    overduePayments: listOverduePatients(cases),
    missingNextControl: sinControl.quedan,
    noShows: faltas.quedan,
    finishingSoon: porTerminar.quedan,
    pastDue: pasados.quedan,
    reevaluacionRadiografica: reevaluacion.quedan,
    pospuestas: sinControl.pospuestas + faltas.pospuestas + porTerminar.pospuestas + pasados.pospuestas + reevaluacion.pospuestas,
    pospuestasLista: listaDePospuestas(posposiciones, ahora, nombres),
  };
}

/** Los casos a los que hoy les toca reevaluación radiográfica, con el plan de tratamiento de cada uno. */
async function reevaluacionesDeLosCasos(
  clinicId: string,
  zonaHoraria: string,
  cases: ReadonlyArray<{ planId: string; patientId: string; patientName: string; status: string; installedAt: Date | null }>,
  ahora: Date,
): Promise<ReevaluacionRadiograficaEntry[]> {
  if (cases.length === 0) return [];
  const planes = await cargarPlanesDetalle(clinicId, cases.map((c) => c.planId));
  const conPlan = cases.filter((c) => {
    const p = planes.get(c.planId);
    return p && (p.reevaluacion || (p.periodicidadMeses && p.controlRadiografico.length > 0));
  });
  if (conPlan.length === 0) return [];
  const radiografias = await cargarRadiografiasTipificadas(clinicId, conPlan.map((c) => c.patientId), zonaHoraria);
  const hoy = hoyEnZona(ahora, zonaHoraria);
  const salida: ReevaluacionRadiograficaEntry[] = [];
  for (const c of conPlan) {
    const pendientes = reevaluacionesPendientes({
      plan: planes.get(c.planId)!,
      status: c.status,
      inicio: c.installedAt ? hoyEnZona(c.installedAt, zonaHoraria) : null,
      radiografias: radiografias.get(c.patientId) ?? [],
      hoy,
    });
    if (pendientes.length === 0) continue;
    salida.push({ patientId: c.patientId, patientName: c.patientName, treatmentPlanId: c.planId, pendientes, textos: pendientes.map(textoDeReevaluacion) });
  }
  // La más vencida arriba.
  return salida.sort((a, b) => b.pendientes[0]!.diasVencida - a.pendientes[0]!.diasVencida || a.patientName.localeCompare(b.patientName, "es"));
}
