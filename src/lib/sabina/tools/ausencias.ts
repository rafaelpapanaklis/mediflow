/**
 * `ausencias` — las citas que el paciente no atendió, y qué proporción son.
 *
 * El numerador y el denominador NO son el mismo criterio, y ahí está el detalle:
 *
 *  · numerador   → `status = NO_SHOW`.
 *  · denominador → citas AGENDADAS (`status != CANCELLED`), que es el criterio
 *    del KPI "Citas" del home del administrador (`aggregateAdminPeriodKpis`).
 *
 * Una cancelada no es una ausencia ni una oportunidad perdida de la misma
 * clase —el hueco se pudo reasignar—, así que meterla en el denominador diluye
 * la tasa y sacar las no asistidas del denominador la infla. Con estos dos, el
 * número de ausencias cuadra exactamente con la tarjeta "No-shows" del panel.
 */

import { buildAppointmentWhere } from "@/lib/auth-context";
import { canSeePatient } from "@/lib/patient-visibility";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  plural,
  recortar,
  visorDe,
  type Lista,
} from "./base";
import { esquemaRango, fechaDe, horaDe, resolverRango, type ParamsRango } from "./fechas";
import { ESTADOS_AGENDADOS } from "./estados";
import type { SabinaCtx } from "../tipos";

export type ParamsAusencias = ParamsRango;

export interface AusenciaFila {
  fecha: string;
  hora: string;
  paciente: string;
  doctor: string;
  motivo: string | null;
}

export interface DatosAusencias {
  desde: string;
  hasta: string;
  alcance: "clinica" | "propio";
  ausencias: Lista<AusenciaFila>;
  /** Citas agendadas del rango (sin canceladas) — el denominador de la tasa. */
  citasAgendadas: number;
  /** `noAsistieron / citasAgendadas`, en porcentaje entero. `null` si no hubo citas. */
  tasaPct: number | null;
  /** Cuántas ausencias por paciente, de mayor a menor (los 10 primeros). */
  reincidentes: Array<{ paciente: string; veces: number }>;
}

export const ausencias = definirHerramienta<ParamsAusencias, DatosAusencias>({
  nombre: "ausencias",
  descripcion:
    "Las citas que el paciente no atendió (no-shows) en un rango de fechas, con su tasa sobre el " +
    "total de citas agendadas y qué pacientes faltan más de una vez. Úsala para «¿cuánta gente me " +
    "falla?», «¿cuál es mi tasa de ausentismo?» o «¿quién no vino este mes?». " +
    "Las citas CANCELADAS no son ausencias y no entran aquí; para el detalle de un día usa citas_del_dia.",
  parametros: esquemaRango,
  permiso: "agenda.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosAusencias> {
    const db = dbDe(ctx);
    const rango = resolverRango(params, ctx.timezone, 30);
    const { desde, hasta } = rango.ventana;
    const visor = visorDe(ctx);
    const auth = comoAuthContext(ctx);

    const whereNoShow = buildAppointmentWhere(auth, {
      startsAt: { gte: desde, lt: hasta },
      status: "NO_SHOW",
    });
    const whereAgendadas = buildAppointmentWhere(auth, {
      startsAt: { gte: desde, lt: hasta },
      status: { notIn: [...ESTADOS_AGENDADOS] },
    });

    const [totalNoShow, filas, citasAgendadas] = await Promise.all([
      db.appointment.count({ where: whereNoShow }),
      db.appointment.findMany({
        where: whereNoShow,
        orderBy: { startsAt: "desc" },
        take: 51,
        select: {
          startsAt: true,
          type: true,
          patient: { select: { firstName: true, lastName: true, visibleUserIds: true } },
          doctor: { select: { firstName: true, lastName: true } },
        },
      }),
      db.appointment.count({ where: whereAgendadas }),
    ]);

    const lista: AusenciaFila[] = filas.map((a) => {
      const inicio = new Date(a.startsAt);
      const visible = canSeePatient(visor, a.patient?.visibleUserIds);
      return {
        fecha: fechaDe(inicio, ctx.timezone),
        hora: horaDe(inicio, ctx.timezone),
        paciente: visible ? nombre(a.patient) : "Paciente privado",
        doctor: nombre(a.doctor) || "sin doctor",
        motivo: a.type ?? null,
      };
    });

    // Reincidentes sobre las filas leídas (como mucho 51): es una pista para el
    // doctor, no un censo. Si el listado venía recortado, `truncado` lo dice.
    const cuenta: Record<string, number> = {};
    for (const f of lista) cuenta[f.paciente] = (cuenta[f.paciente] ?? 0) + 1;
    const reincidentes = Object.keys(cuenta)
      .filter((p) => cuenta[p] > 1)
      .sort((a, b) => cuenta[b] - cuenta[a])
      .slice(0, 10)
      .map((paciente) => ({ paciente, veces: cuenta[paciente] }));

    return {
      desde: rango.desdeISO,
      hasta: rango.hastaISO,
      alcance: ctx.role === "DOCTOR" ? "propio" : "clinica",
      ausencias: recortar(lista, totalNoShow),
      citasAgendadas,
      tasaPct: citasAgendadas > 0 ? Math.round((totalNoShow / citasAgendadas) * 100) : null,
      reincidentes,
    };
  },

  // Ojo: "sin ausencias" es un dato bueno, no una falta de dato. Solo se declara
  // vacío cuando NO HUBO CITAS en el rango: ahí no hay nada que medir.
  vacio: (d) => d.citasAgendadas === 0 && d.ausencias.total === 0,

  resumir(d) {
    const tasa = d.tasaPct === null ? "" : ` (${d.tasaPct}% de ${d.citasAgendadas} agendadas)`;
    if (d.ausencias.total === 0) {
      return `Ninguna ausencia entre ${d.desde} y ${d.hasta}, sobre ${plural(d.citasAgendadas, "cita agendada", "citas agendadas")}.`;
    }
    const n = d.reincidentes.length;
    const rein = n > 0
      ? n === 1
        ? " 1 paciente falló más de una vez."
        : ` ${n} pacientes fallaron más de una vez.`
      : "";
    return `${plural(d.ausencias.total, "ausencia", "ausencias")} entre ${d.desde} y ${d.hasta}${tasa}.${rein}`;
  },
});

function nombre(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  return [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();
}
