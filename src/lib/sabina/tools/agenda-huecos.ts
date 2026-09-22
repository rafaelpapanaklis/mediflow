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
 *  · pasado                → no se ofrece nada que ya empezó;
 *  · BLOQUEADO (WS1-T2)    → `bloqueaEsteHueco`, la única función que decide
 *    si un bloqueo de agenda tapa un hueco, compartida con los otros nueve
 *    consumidores de disponibilidad del repo;
 *  · HORARIO DEL DOCTOR (WS1-T2 · horario) → `doctorNoAtiende`, igual: la
 *    única función que decide si el doctor atiende ese hueco. Sin horario
 *    propio no cambia nada; con él, se ofrece la intersección con la clínica.
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
import { bloqueaEsteHueco, type BloqueoLike } from "@/lib/agenda-bloqueos/core";
import { leerBloqueosDelRango } from "@/lib/agenda-bloqueos/consulta.server";
import { doctorNoAtiende, horarioPropio, ventanaDelDoctor } from "@/lib/horario-doctor/core";
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
  /**
   * DE QUIÉN es esta ocupación (WS1-T2). Va aquí y no en la firma de
   * `evaluarHora` porque este objeto YA está acotado a un doctor —`doctor` son
   * SUS citas—, y porque así no hay dos sitios desde donde pueda llegar un id
   * distinto. `null` = sin doctor concreto: entonces solo tapan los bloqueos
   * de toda la clínica.
   */
  doctorId: string | null;
  /** Todos los sillones activos de la clínica, con su horario y su ocupación. Vacío = la clínica no usa sillones. */
  sillones: Sillon[];
  /**
   * Los bloqueos de agenda que tapan el rango (WS1-T2).
   *
   * 🔴 OBLIGATORIO, no opcional, Y ESE ES EL PUNTO. `evaluarHora` es el cuello
   * de botella por el que pasan Sabina Y «Buscar espacio» del panel
   * (src/lib/agenda-nueva/huecos.server.ts, que arma este objeto a mano).
   * Con el campo opcional, quien olvidara rellenarlo seguiría compilando y
   * ofrecería huecos bloqueados sin que nadie se enterara; obligatorio, el
   * compilador para la build. Una lista vacía es una respuesta válida —«no hay
   * bloqueos»—, pero tiene que escribirse a propósito.
   */
  bloqueos: BloqueoLike[];
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
  | {
      ok: false;
      causa:
        | "pasado"
        | "dia_cerrado"
        | "fuera_de_horario"
        | "ocupado"
        | "sillon_no_disponible"
        | "sin_sillon_libre"
        /** WS1-T2 — hay un bloqueo de agenda encima. */
        | "bloqueado"
        /** WS1-T2 · horario — la clínica abre, pero el doctor no atiende a esa hora. */
        | "doctor_no_atiende";
      /** El motivo escrito del bloqueo, solo cuando `causa` es "bloqueado". */
      motivoBloqueo?: string;
    };

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

  // WS1-T2 · horario — después de la clínica: si la clínica cierra, eso es lo
  // que hay que decir, no el horario de un doctor. Sin horario propio esto da
  // `null` siempre y Sabina ofrece lo mismo que antes.
  if (doctorNoAtiende(clinica.horariosDoctores, inicio, fin, ocupacion.doctorId, clinica.timezone)) {
    return { ok: false, causa: "doctor_no_atiende" };
  }

  // WS1-T2 — ANTES que el solape con citas y que el sillón: si el día está
  // cerrado, da igual que el sillón esté libre, y el motivo del bloqueo es una
  // respuesta mejor que «ese sillón no está disponible». El alcance lo aplica
  // `bloqueaEsteHueco`: un bloqueo de otro doctor no estorba a éste.
  const bloqueo = bloqueaEsteHueco(ocupacion.bloqueos, inicio, fin, ocupacion.doctorId);
  if (bloqueo) {
    return { ok: false, causa: "bloqueado", motivoBloqueo: bloqueo.reason };
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
 *
 * `franja`: acota la búsqueda a una parte del día («por la tarde» → `{ desde:
 * 840, hasta: null }`). Es un recorte ADICIONAL al horario de la clínica, no
 * un horario nuevo: si la franja cae fuera de la ventana de atención, no hay
 * huecos y ya, el día sigue sin estar "cerrado" (`ventana` no cambia).
 */
/**
 * La ventana del DOCTOR ese día: la de la clínica recortada a su horario
 * propio. `null` = la clínica abre pero él no atiende (o sus horas no se
 * cruzan). Sin horario propio, la de la clínica tal cual.
 */
export function ventanaDelDoctorEnFecha(
  fecha: string,
  clinica: ConfigClinica,
  doctorId: string | null,
): { abre: number; cierra: number } | null {
  return ventanaDelDoctor(
    ventanaDeAtencion(fecha, clinica),
    horarioPropio(clinica.horariosDoctores, doctorId),
    scheduleDayOfISO(fecha, clinica.timezone),
  );
}

export function buscarHuecos(args: {
  fecha: string;
  duracion: number;
  clinica: ConfigClinica;
  ocupacion: Ocupacion;
  sillonId: string | null;
  ahora: Date;
  horaPreferida?: string | null;
  franja?: { desde: number | null; hasta: number | null } | null;
  tope?: number;
}): { huecos: Hueco[]; total: number; ventana: { abre: string; cierra: string } | null } {
  const deLaClinica = ventanaDeAtencion(args.fecha, args.clinica);
  // `ventana: null` sigue significando «la clínica cierra ese día», y nada más:
  // `proponer-horarios` lo lee así y lo dice así.
  if (!deLaClinica) return { huecos: [], total: 0, ventana: null };

  // WS1-T2 · horario — se barre la ventana DEL DOCTOR (clínica ∩ su horario),
  // no la de la clínica: así el primer hueco cae en su hora de entrada y no en
  // la de apertura. Si ese día no atiende, no hay huecos, pero la ventana que
  // se devuelve es la de la clínica: el día NO está cerrado, solo él no viene.
  const delDoctor = ventanaDelDoctorEnFecha(args.fecha, args.clinica, args.ocupacion.doctorId);
  if (!delDoctor) {
    return { huecos: [], total: 0, ventana: { abre: hhmm(deLaClinica.abre), cierra: hhmm(deLaClinica.cierra) } };
  }
  const ventana = delDoctor;

  const abre = args.franja?.desde != null ? Math.max(ventana.abre, args.franja.desde) : ventana.abre;
  const cierra = args.franja?.hasta != null ? Math.min(ventana.cierra, args.franja.hasta) : ventana.cierra;

  const paso = args.clinica.defaultSlotMinutes > 0 ? args.clinica.defaultSlotMinutes : 30;
  const todos: Hueco[] = [];
  for (let t = abre; t + args.duracion <= cierra; t += paso) {
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
  /** El motivo del bloqueo, cuando `causa` es "bloqueado". */
  motivoBloqueo?: string;
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
  const { huecos } = buscarHuecos({
    fecha,
    duracion,
    clinica,
    ocupacion: args.ocupacion,
    sillonId: sillon?.id ?? null,
    ahora: args.ahora,
    horaPreferida: hora,
  });
  const dia = fechaLarga(tzLocalToUtc(fecha, 12, 0, clinica.timezone), clinica.timezone);
  // La de la CLÍNICA para «fuera del horario de la clínica», y la del DOCTOR
  // para «el doctor no atiende»: cada frase dice el horario de quien la causa.
  const ventana = ventanaDeAtencion(fecha, clinica);
  const delDoctor = ventanaDelDoctorEnFecha(fecha, clinica, args.ocupacion.doctorId);
  const frases: Record<typeof causa, string> = {
    ocupado: `A las ${hora} del ${dia}, ${doctor} ya tiene otra cita.`,
    // WS1-T2 — el motivo lo escribió la clínica y se repite tal cual: es la
    // diferencia entre «no se puede» y «está cerrado por el congreso».
    bloqueado: `La agenda está cerrada a las ${hora} del ${dia}${args.motivoBloqueo ? `: ${args.motivoBloqueo}` : ""}.`,
    fuera_de_horario: `Las ${hora} (${duracion} min) queda fuera del horario de la clínica el ${dia}${ventana ? ` (${hhmm(ventana.abre)}–${hhmm(ventana.cierra)})` : ""}.`,
    // WS1-T2 · horario — el horario del doctor se dice YA RECORTADO a la
    // clínica: es lo que de verdad se le puede agendar.
    doctor_no_atiende: delDoctor
      ? `${doctor} atiende el ${dia} de ${hhmm(delDoctor.abre)} a ${hhmm(delDoctor.cierra)}; las ${hora} (${duracion} min) quedan fuera.`
      : `${doctor} no atiende el ${dia}.`,
    dia_cerrado: `La clínica está cerrada el ${dia}.`,
    pasado: `El ${dia} a las ${hora} ya pasó.`,
    sillon_no_disponible: `${sillon?.nombre ?? "Ese sillón"} no está disponible a las ${hora} del ${dia} (fuera de su horario u ocupado).`,
    sin_sillon_libre: `A las ${hora} del ${dia} no queda ningún sillón libre.`,
  };
  // Un día en que el doctor no viene no «se quedó sin huecos»: nunca los tuvo.
  // Vale para cualquier causa (p. ej. «fuera de horario» a las 20:00 de su día
  // libre): se dice que ese día no atiende, no que la agenda está llena.
  const diaSinDoctor = ventana !== null && !delDoctor;
  const sinHuecos =
    huecos.length === 0 && causa !== "dia_cerrado"
      ? diaSinDoctor
        ? causa === "doctor_no_atiende" ? "" : ` Además, ${doctor} no atiende ese día.`
        : ` Ese día ya no quedan huecos de ${duracion} min con ${doctor}${sillon ? ` en ${sillon.nombre}` : ""}.`
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

  const [recursos, citas, bloqueos] = await Promise.all([
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
    // WS1-T2 — los bloqueos del día. Se piden los de ESTE doctor y los de toda
    // la clínica; el alcance lo aplica `bloqueaEsteHueco` en `evaluarHora`.
    // Con el `db` de la sesión, igual que las dos de arriba: en pruebas es el
    // cliente de mentira y en producción el `prisma` del repo.
    leerBloqueosDelRango(ctx.clinicId, desde, hasta, {
      doctorIds: [args.doctorId],
      db: db as any,
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
    doctorId: args.doctorId,
    bloqueos,
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
