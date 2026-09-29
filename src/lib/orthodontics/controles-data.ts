// Ortodoncia — cargador de la pantalla «Controles / agenda» del módulo
// (ws1-t3, H16 de la QA en vivo del 28-sep-2026). El I/O de
// `controles-modulo.ts`, que es puro y tiene los tests.
//
// Los controles salen de la Agenda (`Appointment.type ===
// TIPO_CITA_CONTROL_ORTO`, decisión 2 de la arquitectura), nunca de
// `OrthodonticControlAppointment` (modelo viejo). Los casos, de
// `loadOrthoCases`: la misma base que el Tablero, Alertas y Pacientes.
//
// `clinicId` y `zonaHoraria` SIEMPRE de la sesión, nunca del cliente. Todas
// las consultas filtran por clínica Y por visibilidad de paciente
// (`relatedPatientVisibilityAnd`): un doctor con pacientes restringidos no ve
// aquí los controles de los demás. Cuatro consultas en total, en fila.

import { prisma } from "@/lib/prisma";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { relatedPatientVisibilityAnd, type VisibilityViewer } from "@/lib/patient-visibility";
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";
import { cargarUltimasHojasPorPaciente } from "./hojas-por-paciente-db";
import { loadOrthoCases } from "./tablero-data";
import { computeActiveCasesCount } from "./specialty-kpis";
import {
  DIAS_DE_LA_SEMANA,
  casosSinControl,
  controlesDeLaSemana,
  historialDeControles,
  sumarDias,
  type CasoSinControl,
  type CitaDeControl,
  type ControlesDeLaSemana,
} from "./controles-modulo";

/** Hasta dónde se mira hacia atrás para saber cuándo fue el último control. */
const DIAS_DE_HISTORIAL = 365;
/** Hasta dónde se mira hacia adelante para saber si ya tiene su próximo control (igual que Alertas). */
const DIAS_DE_FUTURO = 180;

export interface OrthoControlesData {
  /** "YYYY-MM-DD" de hoy, en la zona de la clínica. */
  hoy: string;
  semana: ControlesDeLaSemana;
  sinControl: CasoSinControl[];
  /** Casos activos: el total contra el que se lee «N sin control». */
  casosActivos: number;
}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function loadOrthoControles(
  clinicId: string,
  zonaHoraria: string,
  viewer: VisibilityViewer,
  ahora: Date = new Date(),
): Promise<OrthoControlesData> {
  // `clinicId: undefined` en Prisma NO filtra: sin clínica no se consulta nada.
  if (!clinicId) {
    const hoy = hoyEnZona(ahora, zonaHoraria);
    return { hoy, semana: controlesDeLaSemana([], hoy, zonaHoraria), sinControl: [], casosActivos: 0 };
  }

  const hoy = hoyEnZona(ahora, zonaHoraria);
  const { cases } = await loadOrthoCases(clinicId, zonaHoraria, viewer, ahora);

  const desde = new Date(ahora.getTime() - DIAS_DE_HISTORIAL * 86_400_000);
  const hasta = new Date(ahora.getTime() + DIAS_DE_FUTURO * 86_400_000);
  const citas = await prisma.appointment.findMany({
    where: {
      clinicId,
      type: TIPO_CITA_CONTROL_ORTO,
      startsAt: { gte: desde, lte: hasta },
      AND: relatedPatientVisibilityAnd(viewer),
    },
    select: {
      id: true,
      patientId: true,
      startsAt: true,
      status: true,
      patient: { select: { firstName: true, lastName: true } },
      doctor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 5000,
  });

  // Lo que se pinta: de hoy a siete días, en la zona de la clínica.
  const inicio = calendarDayRangeUtc(hoy, zonaHoraria).startUtc;
  const fin = calendarDayRangeUtc(sumarDias(hoy, DIAS_DE_LA_SEMANA), zonaHoraria).endUtc;
  const enVentana = citas.filter((c) => c.startsAt >= inicio && c.startsAt < fin);

  // ¿Ya tiene su hoja cada control de la ventana? Solo las columnas propias
  // de la hoja (sin sus tablas hijas): si algo de eso falta en la base, la
  // pantalla sale igual, sin el dato.
  const hojas = new Map<string, "DRAFT" | "SIGNED">();
  if (enVentana.length > 0) {
    try {
      const filas = await prisma.orthoTreatmentCard.findMany({
        where: { clinicId, appointmentId: { in: enVentana.map((c) => c.id) } },
        select: { appointmentId: true, status: true },
      });
      for (const f of filas) if (f.appointmentId) hojas.set(f.appointmentId, f.status);
    } catch (e) {
      if (!esRelacionAusente(e)) throw e;
    }
  }

  // M3 (Ronda 6): un paciente puede tener más de un plan histórico (caso
  // previo cerrado) — `cases` ya viene ordenado/filtrado por `loadOrthoCases`
  // así que basta el primero que aparezca por paciente, sin consulta extra.
  const planIdPorPaciente = new Map<string, string>();
  for (const caso of cases) {
    if (!planIdPorPaciente.has(caso.patientId)) planIdPorPaciente.set(caso.patientId, caso.planId);
  }

  const deLaVentana: CitaDeControl[] = enVentana.map((c) => ({
    appointmentId: c.id,
    patientId: c.patientId,
    patientName: `${c.patient.firstName} ${c.patient.lastName}`.trim(),
    doctorName: c.doctor ? `${c.doctor.firstName} ${c.doctor.lastName}`.trim() : null,
    startsAt: c.startsAt,
    status: c.status,
    hoja: hojas.get(c.id) ?? null,
    treatmentPlanId: planIdPorPaciente.get(c.patientId) ?? null,
  }));

  // Una hoja de control registrada también es un control hecho, aunque nadie
  // marcara la cita como atendida (o se registrara sin cita). Solo de los
  // pacientes que esta persona puede ver: los de `cases`.
  const pacientes = Array.from(new Set(cases.map((c) => c.patientId)));
  const hojasPorPaciente = await cargarUltimasHojasPorPaciente(clinicId, pacientes, ahora);

  const historial = historialDeControles(citas, ahora, hojasPorPaciente);

  return {
    hoy,
    semana: controlesDeLaSemana(deLaVentana, hoy, zonaHoraria),
    sinControl: casosSinControl(cases, historial, hoy, zonaHoraria),
    casosActivos: computeActiveCasesCount(cases),
  };
}
