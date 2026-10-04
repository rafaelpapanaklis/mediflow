// ═══════════════════════════════════════════════════════════════════════════
// «EFICIENCIA OPERATIVA» de Analítica › Resumen (ws1-t2, auditoría de uso
// C-26). Pura, sin Prisma: la ruta /api/analytics/efficiency-score la carga.
//
//   puntaje del día = ocupación por horario (tope 100) × 0.6
//                   + espacios usados ÷ espacios del horario (tope 100) × 0.4
//
// Las dos partes salen del MISMO tiempo disponible que la Ocupación de Inicio
// (`ocupacionDelPeriodo`: horario de Ajustes × quien recibe citas), así que
// las dos pantallas ya no se contradicen. «Espacios usados» = citas vivas (sin
// canceladas ni «No asistió»). El promedio del mes es el de los días que la
// clínica abrió, del día 1 a hoy. Sin horario en Ajustes no hay tiempo
// disponible: el puntaje es 0 y `sinHorario` lo dice.
// ═══════════════════════════════════════════════════════════════════════════

import type { ScheduleDay } from "@/lib/agenda/clinic-hours";
import { citaViva } from "@/lib/agenda-nueva/estados";
import {
  diaISOEnZona,
  diasDelPeriodo,
  ocupacionDelPeriodo,
  type CitaParaOcupacion,
} from "@/lib/agenda/ocupacion-del-periodo";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";

export interface EntradaEficiencia {
  hoy: { desde: Date; hasta: Date };
  mes: { desde: Date; hasta: Date };
  ahora: Date;
  zona: string;
  schedules: ScheduleDay[] | null | undefined;
  profesionales: string[];
  /** Las citas del MES (todas: aquí se filtran las vivas). */
  citas: CitaParaOcupacion[];
  minutosPorEspacio: number;
}

export interface Eficiencia {
  hoy: number;
  promedioDelMes: number;
  /** Ocupación por horario de hoy y del mes entero (la misma cifra que Inicio con «mes»). `null` = sin horario. */
  ocupacionHoy: number | null;
  ocupacionMes: number | null;
  sinHorario: boolean;
}

function puntajeDelDia(
  dia: { desde: Date; hasta: Date },
  e: EntradaEficiencia,
  vivas: CitaParaOcupacion[],
): { puntaje: number; abierto: boolean; ocupacion: number | null } {
  const o = ocupacionDelPeriodo({ desde: dia.desde, hasta: dia.hasta, zona: e.zona, schedules: e.schedules, profesionales: e.profesionales, citas: vivas });
  if (o.minutosDisponibles <= 0) return { puntaje: 0, abierto: false, ocupacion: o.porcentaje };
  const horas = Math.min(100, (o.minutosOcupados / o.minutosDisponibles) * 100);
  const espacios = o.minutosDisponibles / Math.max(1, e.minutosPorEspacio);
  const usadas = vivas.filter((c) => c.startsAt >= dia.desde && c.startsAt < dia.hasta).length;
  const pctEspacios = espacios > 0 ? Math.min(100, (usadas / espacios) * 100) : 0;
  return { puntaje: Math.round(horas * 0.6 + pctEspacios * 0.4), abierto: true, ocupacion: o.porcentaje };
}

export function puntajeDeEficiencia(e: EntradaEficiencia): Eficiencia {
  const vivas = e.citas.filter((c) => citaViva(String(c.status)));
  const hoy = puntajeDelDia(e.hoy, e, vivas);
  const mesEntero = ocupacionDelPeriodo({ desde: e.mes.desde, hasta: e.mes.hasta, zona: e.zona, schedules: e.schedules, profesionales: e.profesionales, citas: vivas });

  const hoyISO = diaISOEnZona(e.ahora, e.zona);
  let suma = 0;
  let abiertos = 0;
  for (const dayISO of diasDelPeriodo(e.mes.desde, e.mes.hasta, e.zona)) {
    if (dayISO > hoyISO) break;
    const r = calendarDayRangeUtc(dayISO, e.zona);
    const d = puntajeDelDia({ desde: r.startUtc, hasta: r.endUtc }, e, vivas);
    if (!d.abierto) continue;
    suma += d.puntaje;
    abiertos += 1;
  }
  return {
    hoy: hoy.puntaje,
    promedioDelMes: abiertos > 0 ? Math.round(suma / abiertos) : 0,
    ocupacionHoy: hoy.ocupacion,
    ocupacionMes: mesEntero.porcentaje,
    sinHorario: mesEntero.minutosDisponibles <= 0,
  };
}
