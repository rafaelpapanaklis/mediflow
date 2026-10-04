// ═══════════════════════════════════════════════════════════════════════════
// OCUPACIÓN DE UN PERIODO, por HORARIO (ws1-t2, auditoría de uso C-26;
// decisión 9 de Rafael: «ocupación por horario»). Puro, sin Prisma: el
// cargador vive en `ocupacion-del-periodo.server.ts`.
//
// Lo que había: Inicio decía «Ocupación 27 %» y era completadas ÷ citas (una
// tasa de asistencia, no una ocupación), mientras Analítica decía «Eficiencia
// 0 de 100» con otra cuenta y Costos «Sin sillones activos». Tres números para
// «qué tan llena está la agenda», ninguno explicado.
//
// Ahora es UNA cuenta, la de la barra de la Agenda (`ocupacionDelDia`,
// lib/agenda-nueva/ocupacion.ts), sumada día por día:
//
//   ocupación = minutos agendados (citas vivas: sin canceladas ni «No asistió»)
//               ÷ minutos de atención según el horario de Ajustes, por cada
//                 profesional que recibe citas (RECIBE_CITAS_WHERE).
//
// Sin horario en Ajustes no se inventa: `porcentaje` sale `null` y la pantalla
// enseña «—». No se recorta a 100 (una agenda sobrevendida lo dice).
// ═══════════════════════════════════════════════════════════════════════════

import type { ScheduleDay } from "@/lib/agenda/clinic-hours";
import type { AppointmentStatus } from "@/lib/agenda/types";
import { getTzParts } from "@/lib/agenda/time-utils";
import { ocupacionDelDia, type CitaOcupacion } from "@/lib/agenda-nueva/ocupacion";

export interface CitaParaOcupacion {
  startsAt: Date;
  endsAt: Date | null;
  status: AppointmentStatus | string;
  doctorId: string | null;
}

export interface OcupacionDelPeriodo {
  minutosOcupados: number;
  minutosDisponibles: number;
  /** `null` = no hay horario en Ajustes (o nadie recibe citas): no se calcula. */
  porcentaje: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" del instante en la zona de la clínica. */
export function diaISOEnZona(d: Date, zona: string): string {
  const p = getTzParts(d, zona);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Los días de calendario (en la zona de la clínica) que toca `[desde, hasta)`. */
export function diasDelPeriodo(desde: Date, hasta: Date, zona: string): string[] {
  const primero = diaISOEnZona(desde, zona);
  const ultimo = diaISOEnZona(new Date(hasta.getTime() - 1), zona);
  const out: string[] = [];
  const [a, m, d] = primero.split("-").map(Number);
  for (let i = 0; i < 400; i++) {
    const x = new Date(Date.UTC(a, m - 1, d + i, 12));
    const iso = `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
    out.push(iso);
    if (iso >= ultimo) break;
  }
  return out;
}

export function ocupacionDelPeriodo(entrada: {
  desde: Date;
  hasta: Date;
  zona: string;
  schedules: ScheduleDay[] | null | undefined;
  /** Ids de quienes reciben citas: cada uno es un carril con el horario de la clínica. */
  profesionales: string[];
  citas: CitaParaOcupacion[];
}): OcupacionDelPeriodo {
  const { desde, hasta, zona, schedules } = entrada;
  const carriles = entrada.profesionales.map((id) => ({ id, nombre: "", color: "" }));
  const porDia = new Map<string, CitaOcupacion[]>();
  for (const c of entrada.citas) {
    if (c.startsAt < desde || c.startsAt >= hasta) continue;
    const k = diaISOEnZona(c.startsAt, zona);
    const lista = porDia.get(k) ?? [];
    lista.push({
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt ? c.endsAt.toISOString() : null,
      status: c.status as AppointmentStatus,
      doctorId: c.doctorId,
    });
    porDia.set(k, lista);
  }
  let ocupados = 0;
  let disponibles = 0;
  for (const dayISO of diasDelPeriodo(desde, hasta, zona)) {
    const o = ocupacionDelDia({ dayISO, citas: porDia.get(dayISO) ?? [], schedules, timezone: zona, carriles, modo: "doctor" });
    ocupados += o.minutosOcupados;
    disponibles += o.minutosDisponibles;
  }
  return {
    minutosOcupados: Math.round(ocupados),
    minutosDisponibles: Math.round(disponibles),
    porcentaje: disponibles > 0 ? Math.round((ocupados / disponibles) * 100) : null,
  };
}
