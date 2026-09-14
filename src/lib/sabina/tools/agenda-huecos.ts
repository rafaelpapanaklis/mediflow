/**
 * Huecos de agenda para Sabina — qué horas caben, con las MISMAS piezas con que
 * decide el servidor.
 *
 * El MAPA (§5) encontró cuatro calculadoras de huecos en el repo y ninguna
 * coincide con otra. Esta no es una quinta con criterio propio: cada hora pasa
 * por las funciones que usa `POST /api/appointments` para decidir, así que
 * Sabina nunca ofrece algo que el servidor llamaría «fuera de horario» o que la
 * constraint rechazaría:
 *
 *  · horario de la clínica → `scheduleViolation(...) === null` (el POST solo
 *    AVISA; decisión de Rafael: Sabina ni lo ofrece);
 *  · horario del sillón    → `validateResourceSchedule` (el 422 del POST);
 *  · ocupado               → `slotOverlapsBusy`, intervalos `[inicio, fin)`;
 *  · pasado                → no se ofrece nada que ya empezó.
 *
 * Una diferencia a propósito con la constraint: aquí ocupa TODA cita no
 * cancelada ni «no asistió», también las que tienen `overrideReason`. La
 * constraint deja encimar sobre ésas (un admin forzó el doble turno); Sabina no
 * propone encimar a nadie. Nunca ofrece algo que el POST rechace, solo es más
 * prudente.
 *
 * La mitad pura (`evaluarHora`, `buscarHuecos`) no toca la base; `leerOcupacion`
 * es la única que lee, y lee la ocupación de TODA la clínica aunque pregunte un
 * DOCTOR (N10): sin eso le propondría horas con el sillón tomado por otro
 * doctor. A cambio, de aquí solo salen HORAS, nunca de quién es el hueco.
 */

import { scheduleDayOfISO, scheduleViolation } from "@/lib/agenda/clinic-hours";
import { validateResourceSchedule } from "@/lib/agenda/resource-schedule";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import type { WeekScheduleDTO } from "@/lib/agenda/types";
import { slotOverlapsBusy, type BusyInterval } from "@/lib/public-booking/slots";
import { ventanaDelDia } from "./fechas";
import {
  fechaLarga,
  hhmm,
  minutosDe,
  type AgendaDb,
  type ConfigClinica,
  type DatosAccionAgenda,
} from "./agenda-comun";
import type { SabinaCtx } from "../tipos";

/** Cuántas horas se ofrecen como mucho: las más cercanas, no la rejilla entera. */
export const TOPE_HUECOS = 5;

export interface Sillon {
  id: string;
  nombre: string;
  /** `null` = sin horario propio = siempre abierto (mismo criterio que `loadResourceSchedule`). */
  horario: WeekScheduleDTO | null;
  ocupado: BusyInterval[];
}

export interface Ocupacion {
  /** Citas vivas del doctor ese día. */
  doctor: BusyInterval[];
  /** Todos los sillones activos de la clínica, con su horario y su ocupación. Vacío = la clínica no usa sillones. */
  sillones: Sillon[];
}

/** La ventana de atención de un día, o `null` si la clínica cierra. Minutos locales. */
export function ventanaDeAtencion(fecha: string, clinica: ConfigClinica): { abre: number; cierra: number } | null {
  const validas = clinica.schedules.filter(
    (d) => /^\d{1,2}:\d{2}$/.test(d.openTime ?? "") && /^\d{1,2}:\d{2}$/.test(d.closeTime ?? ""),
  );
  // Mismo criterio que `scheduleViolation`: con horario de Ajustes manda el del
  // día; sin él, la ventana histórica agendaDayStart/End.
  if (validas.length === 0) {
    return { abre: clinica.agendaDayStart * 60, cierra: clinica.agendaDayEnd * 60 };
  }
  const dia = validas.find((d) => d.dayOfWeek === scheduleDayOfISO(fecha, clinica.timezone));
  if (!dia || !dia.enabled) return null;
  return { abre: minutosDe(dia.openTime), cierra: minutosDe(dia.closeTime) };
}

export type Veredicto =
  | { ok: true; sillonesLibres: Sillon[] }
  | { ok: false; causa: "pasado" | "dia_cerrado" | "fuera_de_horario" | "ocupado" | "sillon_no_disponible" | "sin_sillon_libre" };

/**
 * ¿Cabe una cita de `duracion` minutos a las `hora` del `fecha`?
 *
 * `sillonId`: el sillón pedido. Si la clínica tiene sillones y no se pidió
 * ninguno, `sillonesLibres` trae los que servirían (para preguntar cuál).
 */
export function evaluarHora(args: {
  fecha: string;
  hora: string;
  duracion: number;
  clinica: ConfigClinica;
  ocupacion: Ocupacion;
  sillonId: string | null;
  ahora: Date;
}): Veredicto {
  const { fecha, hora, duracion, clinica, ocupacion, sillonId, ahora } = args;
  const inicio = tzLocalToUtc(fecha, Math.floor(minutosDe(hora) / 60), minutosDe(hora) % 60, clinica.timezone);
  const fin = new Date(inicio.getTime() + duracion * 60_000);

  if (inicio.getTime() < ahora.getTime()) return { ok: false, causa: "pasado" };

  const ventana = ventanaDeAtencion(fecha, clinica);
  if (!ventana) return { ok: false, causa: "dia_cerrado" };
  // La cuenta en minutos del día va ADEMÁS de `scheduleViolation`: esa función
  // compara horas de pared y una cita que cruza la medianoche (23:30 + 60) le
  // parece dentro de horario. Aquí la cita tiene que acabar el mismo día.
  const desde = minutosDe(hora);
  if (desde < ventana.abre || desde + duracion > ventana.cierra) return { ok: false, causa: "fuera_de_horario" };
  if (scheduleViolation(inicio, fin, clinica.timezone, clinica, clinica.schedules) !== null) {
    return { ok: false, causa: "fuera_de_horario" };
  }

  if (slotOverlapsBusy(inicio, duracion, ocupacion.doctor)) return { ok: false, causa: "ocupado" };

  if (ocupacion.sillones.length === 0) return { ok: true, sillonesLibres: [] };

  const sirve = (s: Sillon) =>
    validateResourceSchedule(inicio, fin, s.horario, clinica.timezone).ok && !slotOverlapsBusy(inicio, duracion, s.ocupado);

  if (sillonId) {
    const pedido = ocupacion.sillones.find((s) => s.id === sillonId);
    if (!pedido || !sirve(pedido)) return { ok: false, causa: "sillon_no_disponible" };
    return { ok: true, sillonesLibres: [pedido] };
  }
  const libres = ocupacion.sillones.filter(sirve);
  if (libres.length === 0) return { ok: false, causa: "sin_sillon_libre" };
  return { ok: true, sillonesLibres: libres };
}

export interface Hueco {
  hora: string;
  /** Sillones libres a esa hora; `null` si la clínica no usa sillones. */
  sillones: Array<{ id: string; nombre: string }> | null;
}

/**
 * Las horas que caben ese día, en pasos del hueco de la clínica. Con
 * `horaPreferida`, las más cercanas a ella primero (a igual distancia, la más
 * temprana); sin ella, en orden. Como mucho `tope`.
 */
export function buscarHuecos(args: {
  fecha: string;
  duracion: number;
  clinica: ConfigClinica;
  ocupacion: Ocupacion;
  sillonId: string | null;
  ahora: Date;
  horaPreferida?: string | null;
  tope?: number;
}): { huecos: Hueco[]; total: number; ventana: { abre: string; cierra: string } | null } {
  const ventana = ventanaDeAtencion(args.fecha, args.clinica);
  if (!ventana) return { huecos: [], total: 0, ventana: null };

  const paso = args.clinica.defaultSlotMinutes > 0 ? args.clinica.defaultSlotMinutes : 30;
  const todos: Hueco[] = [];
  for (let t = ventana.abre; t + args.duracion <= ventana.cierra; t += paso) {
    const v = evaluarHora({ ...args, hora: hhmm(t) });
    if (!v.ok) continue;
    todos.push({
      hora: hhmm(t),
      sillones: args.ocupacion.sillones.length ? v.sillonesLibres.map((s) => ({ id: s.id, nombre: s.nombre })) : null,
    });
  }

  if (args.horaPreferida) {
    const pref = minutosDe(args.horaPreferida);
    todos.sort((a, b) => {
      const da = Math.abs(minutosDe(a.hora) - pref);
      const dbb = Math.abs(minutosDe(b.hora) - pref);
      return da !== dbb ? da - dbb : minutosDe(a.hora) - minutosDe(b.hora);
    });
  }
  return {
    huecos: todos.slice(0, args.tope ?? TOPE_HUECOS),
    total: todos.length,
    ventana: { abre: hhmm(ventana.abre), cierra: hhmm(ventana.cierra) },
  };
}

/**
 * «Esa hora no se puede» + las más cercanas que sí, del mismo día y con el
 * mismo doctor (y el mismo sillón, si se pidió uno). Nunca dice con quién está
 * ocupado el hueco: basta con que lo está.
 */
export function respuestaNoDisponible(args: {
  causa: Exclude<Veredicto, { ok: true }>["causa"];
  fecha: string;
  hora: string;
  duracion: number;
  clinica: ConfigClinica;
  ocupacion: Ocupacion;
  sillon: { id: string; nombre: string } | null;
  doctor: string;
  ahora: Date;
}): DatosAccionAgenda {
  const { causa, fecha, hora, duracion, clinica, doctor, sillon } = args;
  const { huecos, ventana } = buscarHuecos({
    fecha,
    duracion,
    clinica,
    ocupacion: args.ocupacion,
    sillonId: sillon?.id ?? null,
    ahora: args.ahora,
    horaPreferida: hora,
  });
  const dia = fechaLarga(tzLocalToUtc(fecha, 12, 0, clinica.timezone), clinica.timezone);
  const frases: Record<typeof causa, string> = {
    ocupado: `A las ${hora} del ${dia}, ${doctor} ya tiene otra cita.`,
    fuera_de_horario: `Las ${hora} (${duracion} min) queda fuera del horario de la clínica el ${dia}${ventana ? ` (${ventana.abre}–${ventana.cierra})` : ""}.`,
    dia_cerrado: `La clínica está cerrada el ${dia}.`,
    pasado: `El ${dia} a las ${hora} ya pasó.`,
    sillon_no_disponible: `${sillon?.nombre ?? "Ese sillón"} no está disponible a las ${hora} del ${dia} (fuera de su horario u ocupado).`,
    sin_sillon_libre: `A las ${hora} del ${dia} no queda ningún sillón libre.`,
  };
  const sinHuecos =
    huecos.length === 0 && causa !== "dia_cerrado"
      ? ` Ese día ya no quedan huecos de ${duracion} min con ${doctor}${sillon ? ` en ${sillon.nombre}` : ""}.`
      : "";
  return {
    estado: "no_disponible",
    causa,
    fecha,
    frase: frases[causa] + sinHuecos,
    alternativas: huecos.map((h) => h.hora),
  };
}

/**
 * La ocupación de un día: citas vivas del doctor y de cada sillón activo, más
 * el horario de cada sillón. Tres lecturas, en paralelo.
 *
 * `excluirCitaId`: la cita que se está moviendo no se estorba a sí misma (igual
 * que `id: { not }` en el PATCH).
 */
export async function leerOcupacion(
  ctx: SabinaCtx,
  db: AgendaDb,
  args: {
    fecha: string;
    doctorId: string;
    timezone: string;
    excluirCitaId?: string | null;
    /** El sillón de la cita que se mueve: entra aunque esté dado de baja (el PATCH lo sigue validando). */
    incluirSillonId?: string | null;
  },
): Promise<Ocupacion> {
  const { desde, hasta } = ventanaDelDia(args.fecha, args.timezone);

  const [recursos, citas] = await Promise.all([
    db.resource.findMany({
      // clinicId de la SESIÓN. Mismo filtro que `fetchResources` (lo que el
      // modal «Nueva cita» cuenta para exigir sillón).
      where: args.incluirSillonId
        ? { clinicId: ctx.clinicId, OR: [{ isActive: true }, { id: args.incluirSillonId }] }
        : { clinicId: ctx.clinicId, isActive: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    // 🔴 Por clinicId y NO por `buildAppointmentWhere`: a un DOCTOR ese builder
    // le deja solo sus citas, y aquí hace falta ver el sillón que ocupa otro
    // doctor. Solo se seleccionan horas y a quién bloquean; ni un dato del
    // paciente.
    db.appointment.findMany({
      where: {
        clinicId: ctx.clinicId,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startsAt: { lt: hasta },
        endsAt: { gt: desde },
        ...(args.excluirCitaId ? { id: { not: args.excluirCitaId } } : {}),
      },
      select: { doctorId: true, resourceId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const ids = recursos.map((r: any) => r.id as string);
  const filasHorario = ids.length
    ? await db.resourceSchedule.findMany({
        where: { resourceId: { in: ids } },
        select: { resourceId: true, dayOfWeek: true, startTime: true, endTime: true },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      })
    : [];

  const intervalo = (c: any): BusyInterval => ({ startsAt: new Date(c.startsAt), endsAt: new Date(c.endsAt) });

  return {
    doctor: citas.filter((c: any) => c.doctorId === args.doctorId).map(intervalo),
    sillones: recursos.map((r: any) => ({
      id: r.id,
      nombre: r.name,
      horario: horarioDeSillon(filasHorario.filter((f: any) => f.resourceId === r.id)),
      ocupado: citas.filter((c: any) => c.resourceId === r.id).map(intervalo),
    })),
  };
}

/**
 * Filas de `resource_schedules` → `WeekScheduleDTO`. Es la conversión de
 * `loadResourceSchedule` (resource-schedule.server.ts), que no se puede
 * importar aquí: lee con el `prisma` global y no con el cliente de la sesión.
 * Sin filas = `null` = siempre abierto, igual que allí.
 */
function horarioDeSillon(filas: any[]): WeekScheduleDTO | null {
  if (filas.length === 0) return null;
  const days: WeekScheduleDTO["days"] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const f of filas) {
    if (f.dayOfWeek < 0 || f.dayOfWeek > 6) continue;
    days[f.dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6].push({ startTime: f.startTime, endTime: f.endTime });
  }
  return { days };
}
