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
  /** El día está cerrado según el horario de la clínica. */
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

    const where = buildAppointmentWhere(auth, {
      startsAt: { gte: desde, lt: hasta },
      status: { notIn: [...ESTADOS_ACTIVOS] },
      ...(doctorPedido ? { doctorId: doctorPedido } : {}),
    });

    const [clinica, horarios, sillones, citas] = await Promise.all([
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
}): Omit<DatosOcupacion, "desde" | "hasta" | "alcance" | "unidades"> {
  const { citas, horarios, horarioGeneral, unidades, desdeISO, hastaISO, timezone } = input;

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
  let cursor = desdeISO;
  let guarda = 0;
  while (cursor <= hastaISO && guarda++ < 400) {
    veces[diaSemana(cursor, timezone)]++;
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
    const ventana = ventanaDelDiaSemana(d, utilizables, horarioGeneral, fuenteHorario);
    const abiertoMin = ventana.cerrado ? 0 : ventana.cierra - ventana.abre;
    const capacidad =
      unidades > 0 && abiertoMin > 0 && veces[d] > 0 ? abiertoMin * veces[d] * unidades : null;
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

/** "09:30" → 570. `null` si no es una hora. Mismo criterio que `parseHHMM` de clinic-hours. */
function minutosHHMM(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
}
