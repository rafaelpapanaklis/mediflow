/**
 * `pacientes_nuevos` — las altas de un rango, con de dónde vinieron.
 *
 * ── EL SCOPE SALE DE `buildPatientWhere` ───────────────────────────────
 * No se arma un `where` a mano. `buildPatientWhere(ctx)` es el filtro de la
 * lista de /dashboard/patients y trae tres cosas que un `where` casero pierde:
 * el `clinicId` de la sesión, la visibilidad por paciente (`visibleUserIds`, con
 * las heurísticas del rol DOCTOR) y el `deletedAt: null` de ARCO — un paciente
 * cancelado no aparece en listas. Además es la regla dura de
 * @/lib/patient-visibility: a `prisma.patient` no se entra por otra puerta.
 *
 * ── LA FECHA ES LA DE LA CLÍNICA ───────────────────────────────────────
 * El KPI "nuevos este mes" de esa pantalla arma el inicio de mes con
 * `setDate(1); setHours(0,0,0,0)`, que es la zona del PROCESO — UTC en Vercel.
 * Aquí el mes empieza a las 00:00 de la clínica (`periodRangeUtc` /
 * `calendarRangeUtc`), así que en las horas de frontera los dos números pueden
 * separarse por una alta. Queda dicho en el reporte; el criterio correcto es
 * este, y es el que pide el prompt de esta tarea.
 */

import { buildPatientWhere } from "@/lib/auth-context";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  fraseRecorte,
  plural,
  recortar,
  type Lista,
} from "./base";
import { esquemaRango, fechaDe, resolverRango, sumarDias, ventanaDeRango, type ParamsRango } from "./fechas";
import type { SabinaCtx } from "../tipos";

export type ParamsNuevos = ParamsRango;

export interface NuevoFila {
  paciente: string;
  folio: string | null;
  /** Día de alta, en el calendario de la clínica. */
  alta: string;
  /** Cómo nos conoció (CRM). `null` si no se capturó. */
  origen: string | null;
  /** "patient" (ya atendido) | "prospect" (aún no convierte). */
  etapa: string | null;
}

export interface DatosNuevos {
  desde: string;
  hasta: string;
  nuevos: Lista<NuevoFila>;
  /** Altas del rango inmediatamente anterior, del mismo tamaño. Para comparar. */
  periodoAnterior: number;
  /** Variación porcentual contra el periodo anterior. `null` si antes hubo 0. */
  variacionPct: number | null;
  /** Cuántas altas por origen, de mayor a menor. Exacto, no una muestra. */
  porOrigen: Array<{ origen: string; altas: number }>;
}

export const pacientesNuevos = definirHerramienta<ParamsNuevos, DatosNuevos>({
  nombre: "pacientes_nuevos",
  descripcion:
    "Los pacientes dados de alta en un rango de fechas, con su folio, fecha de alta y cómo conocieron " +
    "la clínica, más la comparación con el periodo anterior del mismo tamaño y el desglose por origen. " +
    "Úsala para «¿cuántos pacientes nuevos tuve este mes?», «¿estoy creciendo?», «¿de dónde me llega " +
    "la gente?» o «¿está funcionando mi publicidad?». " +
    "Para los que dejaron de venir usa pacientes_inactivos.",
  parametros: esquemaRango,
  permiso: "patients.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosNuevos> {
    const db = dbDe(ctx);
    const rango = resolverRango(params, ctx.timezone, 30);
    const auth = comoAuthContext(ctx);

    // El periodo anterior tiene EXACTAMENTE los mismos días: comparar un tramo
    // de 12 días contra un mes entero es lo que producía los "-97%" que no
    // significan nada (misma lección que `aggregatePreviousPeriodKpis`).
    const antesHasta = sumarDias(rango.desdeISO, -1);
    const antesDesde = sumarDias(antesHasta, -(rango.dias - 1));
    const ventanaAntes = ventanaDeRango(antesDesde, antesHasta, ctx.timezone);

    const where = buildPatientWhere(auth, {
      createdAt: { gte: rango.ventana.desde, lt: rango.ventana.hasta },
    });
    const whereAntes = buildPatientWhere(auth, {
      createdAt: { gte: ventanaAntes.desde, lt: ventanaAntes.hasta },
    });

    const [total, filas, periodoAnterior, origenes] = await Promise.all([
      db.patient.count({ where }),
      db.patient.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 51,
        // Nada de alergias, padecimientos ni notas: es un listado.
        select: {
          firstName: true,
          lastName: true,
          patientNumber: true,
          createdAt: true,
          source: true,
          lifecycleStage: true,
        },
      }),
      db.patient.count({ where: whereAntes }),
      db.patient.groupBy({ by: ["source"], where, _count: { _all: true } }),
    ]);

    const nuevos: NuevoFila[] = filas.map((p: any) => ({
      paciente: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
      folio: p.patientNumber ?? null,
      alta: fechaDe(new Date(p.createdAt), ctx.timezone),
      origen: p.source ?? null,
      etapa: p.lifecycleStage ?? null,
    }));

    const porOrigen = (origenes as any[])
      .map((g) => ({ origen: g.source ?? "sin registrar", altas: g._count?._all ?? 0 }))
      .sort((a, b) => b.altas - a.altas);

    return {
      desde: rango.desdeISO,
      hasta: rango.hastaISO,
      nuevos: recortar(nuevos, total),
      periodoAnterior,
      variacionPct:
        periodoAnterior > 0
          ? Math.round(((total - periodoAnterior) / periodoAnterior) * 100)
          : null,
      porOrigen,
    };
  },

  vacio: (d) => d.nuevos.total === 0,

  resumir(d) {
    const comparacion =
      d.variacionPct === null
        ? d.periodoAnterior === 0
          ? " (el periodo anterior no hubo ninguna)"
          : ""
        : ` (${d.variacionPct >= 0 ? "+" : ""}${d.variacionPct}% frente a ${d.periodoAnterior} del periodo anterior)`;
    const top = d.porOrigen[0];
    const origen =
      top && top.origen !== "sin registrar"
        ? ` El origen más frecuente es ${top.origen} con ${top.altas}.`
        : "";
    return (
      `${plural(d.nuevos.total, "paciente nuevo", "pacientes nuevos")} entre ${d.desde} y ` +
      `${d.hasta}${comparacion}${fraseRecorte(d.nuevos, "pacientes")}.${origen}`
    );
  },
});
