/**
 * `agenda_ocupacion` — qué proporción del tiempo disponible está vendido, día de
 * la semana por día de la semana.
 *
 * ── QUÉ MIDE, EXACTAMENTE ──────────────────────────────────────────────
 *   ocupación(martes) = minutos agendados los martes
 *                     ────────────────────────────────────────────────
 *                       minutos abiertos el martes × nº de martes × sillones
 *
 * Los minutos abiertos salen del horario REAL de la clínica: la fila de
 * `ClinicSchedule` de ese día si Ajustes lo configuró, y si no el
 * `agendaDayStart/End` histórico. Es el mismo orden de preferencia —y por el
 * mismo motivo— que `scheduleViolation` en @/lib/agenda/clinic-hours: lo que
 * Ajustes edita manda, y sin Ajustes se conserva el criterio de siempre.
 *
 * Los sillones son los recursos de tratamiento activos (`SILLA_DENTAL` /
 * `CONSULTORIO_DENTAL`, la constante `TREATMENT_KINDS`), igual que el mapa de
 * calor de Analytics.
 *
 * ── DOS COSAS QUE HAY QUE SABER ANTES DE COMPARAR CON ANALYTICS ────────
 *
 *  1. **La zona horaria es la de la clínica.** El mapa de calor de
 *     /api/analytics/occupancy deriva el día de la semana y la hora con
 *     `d.getDay()` y `d.getHours()`, que son la zona del PROCESO — UTC en
 *     Vercel. Con eso, la cita de un lunes a las 19:00 de México cae en martes.
 *     Aquí se usa `getTzParts(date, tz)`, así que los dos números pueden no
 *     coincidir; el que está mal es el de allá, y arreglarlo no era de esta
 *     tarea (queda dicho en el reporte).
 *  2. **El denominador no es el mismo.** Allá es «citas por sillón y semana»,
 *     con las semanas contadas como las que TUVIERON alguna cita; aquí es
 *     minutos sobre minutos y los días se cuentan del calendario, no de los
 *     datos. Una cita de 15 min no vale una hora de sillón.
 *
 * Si no hay sillones activos configurados no se inventa un denominador: la
 * ocupación sale `null` y el resumen lo dice (regla 5 del contrato).
 *
 * ── WS1-T2 · LOS BLOQUEOS DESCUENTAN CAPACIDAD ────────────────────────
 * Un día cerrado por un bloqueo no es tiempo disponible que se desaprovechó:
 * es tiempo que no existió. Contarlo en el denominador hace que diciembre
 * parezca flojo por cerrar el 25, y que Sabina conteste «los viernes tienes
 * huecos» señalando un viernes de vacaciones. Los minutos bloqueados se restan
 * de la capacidad de su día de la semana.
 *
 * 🔴 QUÉ BLOQUEOS DESCUENTAN, Y POR QUÉ NO TODOS. El denominador de la clínica
 * son SILLONES, no doctores, así que un bloqueo de UN doctor no se puede
 * traducir a sillones sin inventar un número — y este archivo existe
 * precisamente para no inventar denominadores. Por eso:
 *   · midiendo LA CLÍNICA → solo descuentan los de toda la clínica
 *     (`doctorId` null), que cierran los sillones de verdad;
 *   · midiendo UN DOCTOR  → descuentan los suyos y los de la clínica, porque
 *     ahí el denominador es su propio tiempo y la cuenta sí es exacta.
 *
 * ── WS1-T2 · horario · EL HORARIO DEL DOCTOR TAMBIÉN ─────────────────
 * Por el mismo razonamiento: midiendo a UN doctor, su tiempo disponible es el
 * de la clínica RECORTADO a su horario propio (la intersección). Un doctor que
 * no trabaja los miércoles no tiene «los miércoles vacíos»: no los tiene. Sin
 * horario propio, la cuenta sale idéntica a la de antes. Midiendo la clínica
 * no se aplica: el denominador son sillones, y el horario de un doctor no se
 * traduce a sillones sin inventar un número.
 */

import { z } from "zod";
import { buildAppointmentWhere } from "@/lib/auth-context";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { comoAuthContext, dbDe, definirHerramienta, pct } from "./base";
import {
  diaSemana,
  diaSemanaDe,
  esquemaRango,
  NOMBRES_DIA,
  resolverRango,
  sumarDias,
  type ParamsRango,
} from "./fechas";
import { ESTADOS_ACTIVOS } from "./estados";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import { bloqueoAlcanzaDoctor, type BloqueoLike } from "@/lib/agenda-bloqueos/core";
import { leerBloqueosDelRango } from "@/lib/agenda-bloqueos/consulta.server";
import { ventanaDelDoctor, type DiaHorario } from "@/lib/horario-doctor/core";
import { leerHorarioDeDoctor } from "@/lib/horario-doctor/consulta.server";
import type { SabinaCtx } from "../tipos";

const parametros = esquemaRango.extend({
  /** Solo un doctor (su `User.id`). Sin él, toda la clínica (o el propio doctor). */
  doctorId: z.string().min(1).optional(),
});

export type ParamsOcupacion = z.infer<typeof parametros>;

export interface FilaHorario {
  dayOfWeek: number;
  enabled: boolean;
  openTime: string;
  closeTime: string;
}

export interface OcupacionDia {
  /** 0 = lunes … 6 = domingo (convención de ClinicSchedule y de la vista Semana). */
  dia: number;
  nombre: string;
  /**
   * El día está cerrado según el horario de la clínica — o, midiendo a UN
   * doctor con horario propio, ese día él no atiende (WS1-T2 · horario).
   */
  cerrado: boolean;
  /** Cuántas veces cae este día de la semana dentro del rango. */
  veces: number;
  citas: number;
  minutosAgendados: number;
  /** `null` cuando no se puede calcular (sin sillones, o día cerrado). */
  capacidadMinutos: number | null;
  ocupacionPct: number | null;
}

export interface DatosOcupacion {
  desde: string;
  hasta: string;
  alcance: "clinica" | "propio" | "doctor";
  /** Unidades de atención en paralelo: sillones activos, o 1 si se mide a un solo doctor. */
  unidades: number;
  /** Horario tomado de Ajustes (`ClinicSchedule`) o del `agendaDayStart/End` histórico. */
  fuenteHorario: "ajustes" | "horario_general";
  porDia: OcupacionDia[];
  citasTotales: number;
  minutosAgendadosTotal: number;
  ocupacionPctTotal: number | null;
  /** El día más lleno y el más vacío de los días ABIERTOS con capacidad conocida. */
  masLleno: OcupacionDia | null;
  masVacio: OcupacionDia | null;
}

export const agendaOcupacion = definirHerramienta<ParamsOcupacion, DatosOcupacion>({
  nombre: "agenda_ocupacion",
  descripcion:
    "Qué tan llena está la agenda por día de la semana en un rango: porcentaje de ocupación, citas y " +
    "minutos agendados frente al tiempo disponible (horario de la clínica × sillones activos), más el " +
    "día más lleno y el más vacío. Úsala para «¿qué días tengo huecos?», «¿está llena mi agenda?», " +
    "«¿cuándo me conviene meter una promoción?» o para razonar sobre capacidad y crecimiento. " +
    "Para las citas concretas de un día usa citas_del_dia.",
  parametros,
  permiso: "agenda.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOcupacion> {
    const db = dbDe(ctx);
    const rango = resolverRango(params, ctx.timezone, 30);
    const { desde, hasta } = rango.ventana;
    const auth = comoAuthContext(ctx);

    // 🔴 EL SCOPE DEL ROL MANDA SOBRE EL PARÁMETRO.
    //
    // `buildAppointmentWhere` arma `{clinicId, ...(isDoctor && {doctorId}), ...extra}`,
    // así que un `doctorId` metido en `extra` PISARÍA el scope del rol — y este
    // parámetro lo elige el MODELO. Un doctor podría pedir la ocupación de su
    // compañera pasando su id, algo que la agenda no le deja hacer: allí
    // `doctorIdScope` tiene prioridad explícita sobre el filtro `doctorId`
    // (ver `fetchAppointmentsForDay` en @/lib/agenda/server). Aquí se replica esa
    // prioridad descartando el parámetro cuando quien pregunta es un DOCTOR.
    const doctorPedido = ctx.role === "DOCTOR" ? undefined : params.doctorId;
    // Un DOCTOR mide SU agenda, así que su denominador es su propio tiempo: una
    // unidad, no los sillones de la casa. Lo mismo si se pide un doctor concreto.
    const unDoctor = ctx.role === "DOCTOR" || !!doctorPedido;
    // Midiendo a UN doctor, el suyo; midiendo la clínica, `null` y entonces
    // solo descuentan los bloqueos de toda la clínica.
    const doctorMedido = unDoctor ? (doctorPedido ?? ctx.userId ?? null) : null;

    const where = buildAppointmentWhere(auth, {
      startsAt: { gte: desde, lt: hasta },
      status: { notIn: [...ESTADOS_ACTIVOS] },
      ...(doctorPedido ? { doctorId: doctorPedido } : {}),
    });

    const [clinica, horarios, sillones, citas, bloqueos, horarioDoctor] = await Promise.all([
      db.clinic.findFirst({
        where: { id: ctx.clinicId },
        select: { agendaDayStart: true, agendaDayEnd: true },
      }),
      db.clinicSchedule.findMany({
        where: { clinicId: ctx.clinicId },
        select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
      }),
      unDoctor
        ? Promise.resolve(1)
        : db.resource.count({
            where: { clinicId: ctx.clinicId, isActive: true, kind: { in: [...TREATMENT_KINDS] } },
          }),
      db.appointment.findMany({
        where,
        select: { startsAt: true, endsAt: true },
      }),
      // WS1-T2 — los bloqueos del rango. Sin filtro de doctor: `calcularOcupacion`
      // decide cuáles descuentan según se esté midiendo la clínica o a uno solo
      // (ver la cabecera). Con el `db` de la sesión, como las cuatro de arriba.
      leerBloqueosDelRango(ctx.clinicId, desde, hasta, { db: db as any }),
      // WS1-T2 · horario — el horario propio del doctor medido. Seis consultas
      // en total, por debajo del tope de siete de la casa.
      doctorMedido
        ? leerHorarioDeDoctor(ctx.clinicId, doctorMedido, { db: db as any })
        : Promise.resolve(null),
    ]);

    const calculado = calcularOcupacion({
      citas,
      horarios: horarios as FilaHorario[],
      horarioGeneral: {
        agendaDayStart: clinica?.agendaDayStart ?? 8,
        agendaDayEnd: clinica?.agendaDayEnd ?? 20,
      },
      unidades: sillones,
      desdeISO: rango.desdeISO,
      hastaISO: rango.hastaISO,
      timezone: ctx.timezone,
      bloqueos,
      doctorMedido,
      horarioDoctor,
    });

    return {
      desde: rango.desdeISO,
      hasta: rango.hastaISO,
      alcance: doctorPedido ? "doctor" : ctx.role === "DOCTOR" ? "propio" : "clinica",
      unidades: sillones,
      ...calculado,
    };
  },

  vacio: (d) => d.citasTotales === 0,

  resumir(d) {
    const de = d.alcance === "clinica" ? "la clínica" : "esa agenda";
    if (d.unidades === 0) {
      return (
        `${d.citasTotales} citas y ${d.minutosAgendadosTotal} minutos agendados entre ${d.desde} y ` +
        `${d.hasta}, pero no puedo calcular la ocupación de ${de}: no hay sillones activos ` +
        `configurados en el catálogo, así que no hay con qué comparar.`
      );
    }
    const cabeza = `Ocupación de ${de} entre ${d.desde} y ${d.hasta}: ${pct(d.ocupacionPctTotal)} (${d.citasTotales} citas).`;
    if (!d.masLleno || !d.masVacio) return cabeza;
    if (d.masLleno.dia === d.masVacio.dia) {
      return `${cabeza} Solo hay datos del ${d.masLleno.nombre} (${pct(d.masLleno.ocupacionPct)}).`;
    }
    return (
      `${cabeza} El día más lleno es el ${d.masLleno.nombre} (${pct(d.masLleno.ocupacionPct)}) y el más ` +
      `vacío el ${d.masVacio.nombre} (${pct(d.masVacio.ocupacionPct)}).`
    );
  },
});

/**
 * La aritmética, sin base de datos: así se puede probar con importes y horarios
 * a mano, que es lo único que demuestra que el porcentaje es el que se dice.
 */
export function calcularOcupacion(input: {
  citas: Array<{ startsAt: Date | string; endsAt: Date | string | null }>;
  horarios: FilaHorario[];
  horarioGeneral: { agendaDayStart: number; agendaDayEnd: number };
  unidades: number;
  desdeISO: string;
  hastaISO: string;
  timezone: string;
  /** WS1-T2 — los bloqueos del rango. Ausente = como antes de esa tarea. */
  bloqueos?: readonly BloqueoLike[];
  /**
   * WS1-T2 — a quién se está midiendo. `null` = la clínica entera, y entonces
   * solo descuentan los bloqueos de toda la clínica. Ver la cabecera.
   */
  doctorMedido?: string | null;
  /**
   * WS1-T2 · horario — el horario PROPIO del doctor medido. Solo se aplica si
   * `doctorMedido` no es `null` (ver la cabecera). Ausente o `null` = hereda
   * el de la clínica = la cuenta de siempre.
   */
  horarioDoctor?: readonly DiaHorario[] | null;
}): Omit<DatosOcupacion, "desde" | "hasta" | "alcance" | "unidades"> {
  const { citas, horarios, horarioGeneral, unidades, desdeISO, hastaISO, timezone } = input;
  const horarioDoctor = input.doctorMedido ? input.horarioDoctor ?? null : null;

  const utilizables = (horarios ?? []).filter((d) => {
    const abre = minutosHHMM(d.openTime);
    const cierra = minutosHHMM(d.closeTime);
    return abre !== null && cierra !== null && cierra > abre;
  });
  const fuenteHorario: DatosOcupacion["fuenteHorario"] =
    utilizables.length > 0 ? "ajustes" : "horario_general";

  // Cuántas veces cae cada día de la semana en el rango. Del CALENDARIO, no de
  // los datos: un martes sin ninguna cita sigue siendo un martes con capacidad,
  // y contarlo solo cuando hubo citas es lo que hace que un mes flojo parezca
  // lleno.
  const veces = [0, 0, 0, 0, 0, 0, 0];
  // WS1-T2 — minutos que un bloqueo se comió DENTRO del horario de atención,
  // por día de la semana. Solo cuentan los que están dentro de la ventana
  // abierta: cerrar de 20:00 a 22:00 una clínica que cierra a las 19:00 no
  // resta capacidad, porque esa capacidad nunca existió.
  const minutosBloqueadosPorDia = [0, 0, 0, 0, 0, 0, 0];

  // Los que descuentan, según a quién se mida (ver la cabecera). Los retirados
  // ya no llegan aquí, pero se filtran igual: esta función es pura y puede
  // recibir una lista armada a mano en una prueba.
  const aplicables = (input.bloqueos ?? []).filter(
    (b) => !b.deletedAt && bloqueoAlcanzaDoctor(b, input.doctorMedido ?? null),
  );

  let cursor = desdeISO;
  let guarda = 0;
  while (cursor <= hastaISO && guarda++ < 400) {
    const d = diaSemana(cursor, timezone);
    veces[d]++;

    if (aplicables.length > 0) {
      const v = ventanaEfectiva(d, utilizables, horarioGeneral, fuenteHorario, horarioDoctor);
      if (!v.cerrado) {
        const abreUtc = tzLocalToUtc(cursor, Math.floor(v.abre / 60), v.abre % 60, timezone);
        const cierraUtc = tzLocalToUtc(cursor, Math.floor(v.cierra / 60), v.cierra % 60, timezone);
        minutosBloqueadosPorDia[d] += minutosTapados(aplicables, abreUtc, cierraUtc);
      }
    }

    cursor = sumarDias(cursor, 1);
  }

  const citasPorDia = [0, 0, 0, 0, 0, 0, 0];
  const minutosPorDia = [0, 0, 0, 0, 0, 0, 0];
  for (const c of citas) {
    const inicio = new Date(c.startsAt);
    if (Number.isNaN(inicio.getTime())) continue;
    // El día de la semana se decide por el ARRANQUE de la cita, visto en la zona
    // de la clínica. Una cita que cruza medianoche cuenta en el día en que empezó.
    const d = diaSemanaDe(inicio, timezone);
    citasPorDia[d]++;
    const fin = c.endsAt ? new Date(c.endsAt) : null;
    if (fin && !Number.isNaN(fin.getTime()) && fin > inicio) {
      minutosPorDia[d] += Math.round((fin.getTime() - inicio.getTime()) / 60000);
    }
  }

  const porDia: OcupacionDia[] = [];
  for (let d = 0; d < 7; d++) {
    const ventana = ventanaEfectiva(d, utilizables, horarioGeneral, fuenteHorario, horarioDoctor);
    const abiertoMin = ventana.cerrado ? 0 : ventana.cierra - ventana.abre;
    // WS1-T2 — los minutos bloqueados salen del numerador de tiempo abierto
    // ANTES de multiplicar por sillones: un cierre de clínica se lleva los
    // sillones con él. `Math.max(0, …)` porque un bloqueo que empieza antes de
    // abrir y acaba después de cerrar ya viene recortado a la ventana, pero un
    // solo minuto de desajuste no puede dejar una capacidad negativa.
    const abiertoNeto = Math.max(0, abiertoMin * veces[d] - minutosBloqueadosPorDia[d]);
    const capacidad =
      unidades > 0 && abiertoMin > 0 && veces[d] > 0 ? abiertoNeto * unidades : null;
    porDia.push({
      dia: d,
      nombre: NOMBRES_DIA[d],
      cerrado: ventana.cerrado,
      veces: veces[d],
      citas: citasPorDia[d],
      minutosAgendados: minutosPorDia[d],
      capacidadMinutos: capacidad,
      ocupacionPct: capacidad ? Math.round((minutosPorDia[d] / capacidad) * 100) : null,
    });
  }

  const citasTotales = citasPorDia.reduce((a, b) => a + b, 0);
  const minutosAgendadosTotal = minutosPorDia.reduce((a, b) => a + b, 0);
  const capacidadTotal = porDia.reduce((a, f) => a + (f.capacidadMinutos ?? 0), 0);
  const conDato = porDia.filter((f) => f.ocupacionPct !== null && f.veces > 0);
  const ordenados = [...conDato].sort((a, b) => (b.ocupacionPct ?? 0) - (a.ocupacionPct ?? 0));

  return {
    fuenteHorario,
    porDia,
    citasTotales,
    minutosAgendadosTotal,
    ocupacionPctTotal: capacidadTotal > 0 ? Math.round((minutosAgendadosTotal / capacidadTotal) * 100) : null,
    masLleno: ordenados[0] ?? null,
    masVacio: ordenados.length > 0 ? ordenados[ordenados.length - 1] : null,
  };
}

/**
 * Los minutos que la clínica está abierta ese día de la semana.
 *
 * Con `ClinicSchedule` utilizable manda la fila de ESE día, días cerrados
 * incluidos — que es lo que el panel nunca validaba. Sin `ClinicSchedule` se
 * conserva el criterio viejo (`agendaDayStart/End`) para los siete días. Mismo
 * orden de preferencia que `scheduleViolation`.
 */
function ventanaDelDiaSemana(
  dia: number,
  utilizables: FilaHorario[],
  general: { agendaDayStart: number; agendaDayEnd: number },
  fuente: DatosOcupacion["fuenteHorario"],
): { abre: number; cierra: number; cerrado: boolean } {
  if (fuente === "horario_general") {
    return { abre: general.agendaDayStart * 60, cierra: general.agendaDayEnd * 60, cerrado: false };
  }
  const fila = utilizables.find((f) => f.dayOfWeek === dia);
  if (!fila || !fila.enabled) return { abre: 0, cierra: 0, cerrado: true };
  return { abre: minutosHHMM(fila.openTime)!, cierra: minutosHHMM(fila.closeTime)!, cerrado: false };
}

/**
 * La ventana del día de la semana que CUENTA como capacidad: la de la clínica
 * y, si se mide a un doctor con horario propio, recortada a él (WS1-T2 ·
 * horario). Sin horario propio devuelve la de la clínica tal cual.
 */
function ventanaEfectiva(
  dia: number,
  utilizables: FilaHorario[],
  general: { agendaDayStart: number; agendaDayEnd: number },
  fuente: DatosOcupacion["fuenteHorario"],
  horarioDoctor: readonly DiaHorario[] | null,
): { abre: number; cierra: number; cerrado: boolean } {
  const v = ventanaDelDiaSemana(dia, utilizables, general, fuente);
  if (v.cerrado || !horarioDoctor || horarioDoctor.length === 0) return v;
  const recortada = ventanaDelDoctor({ abre: v.abre, cierra: v.cierra }, horarioDoctor, dia);
  return recortada ? { ...recortada, cerrado: false } : { abre: 0, cierra: 0, cerrado: true };
}

/**
 * MINUTOS DE `[abre, cierra)` QUE TAPA ALGÚN BLOQUEO (WS1-T2).
 *
 * 🔴 FUSIONA LOS SOLAPES ANTES DE SUMAR. Dos bloqueos que se pisan —«congreso
 * de 9 a 14» y «toda la mañana»— sumados por separado darían más minutos
 * cerrados que horas tiene el día, y la capacidad saldría negativa: el
 * porcentaje se dispararía a miles justo en la clínica que más bloqueos usa.
 */
function minutosTapados(
  bloqueos: readonly BloqueoLike[],
  abre: Date,
  cierra: Date,
): number {
  const tramos: Array<[number, number]> = [];
  const a = abre.getTime();
  const c = cierra.getTime();
  for (const b of bloqueos) {
    const ini = Math.max(b.startsAt.getTime(), a);
    const fin = Math.min(b.endsAt.getTime(), c);
    if (fin > ini) tramos.push([ini, fin]);
  }
  if (tramos.length === 0) return 0;

  tramos.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let [iniActual, finActual] = tramos[0];
  for (let i = 1; i < tramos.length; i++) {
    const [ini, fin] = tramos[i];
    if (ini <= finActual) {
      finActual = Math.max(finActual, fin);
    } else {
      total += finActual - iniActual;
      iniActual = ini;
      finActual = fin;
    }
  }
  total += finActual - iniActual;
  return Math.round(total / 60_000);
}

/** "09:30" → 570. `null` si no es una hora. Mismo criterio que `parseHHMM` de clinic-hours. */
function minutosHHMM(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
}
