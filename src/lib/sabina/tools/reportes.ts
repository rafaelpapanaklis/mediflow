/**
 * `reportes` — lo que calculan las pantallas de Finanzas, Reportes y el
 * catálogo de procedimientos, en cinco vistas: utilidad (ingresos contra
 * gastos), producción por doctor, rentabilidad por procedimiento, pacientes
 * atendidos y nuevos, y un resumen general de la clínica en un periodo.
 * SOLO LEE.
 *
 * ── CADA PARTE CON SU PERMISO, Y LO QUE FALTA SE DICE ──────────────────
 * Es una herramienta compuesta, igual que `resumen_clinica`: su `permiso` es
 * `today.view` (lo tiene todo rol) y cada parte se vuelve a gatear con la llave
 * de SU pantalla. Lo que el rol no puede ver sale en `omitidas` y en el
 * `resumen` con la frase de siempre: «no tienes acceso a finanzas» y «no hay
 * datos» no son lo mismo, y confundirlos le haría creer a quien pregunta que la
 * clínica no ganó nada.
 *
 *   utilidad, producción por doctor, saldos → `analytics.view` (Finanzas)
 *   rentabilidad por procedimiento          → `procedures.view` (el catálogo)
 *   pacientes atendidos y nuevos            → `reports.view` (Reportes)
 *
 * Recepción, sin `analytics.view`, no ve utilidad ni producción: se le dice.
 *
 * ── DE DÓNDE SALE CADA CIFRA (nada recalculado) ────────────────────────
 *  · Ingresos, gastos, utilidad, producción por doctor y saldos:
 *    `calcularResumenFinanzas` de @/lib/finanzas-resumen.server — la MISMA
 *    función que ejecuta GET /api/finanzas. Y el periodo, el de Finanzas
 *    (./finanzas-comun): hoy, este mes, mes anterior o un rango, en días
 *    naturales de México.
 *  · «Producción» de un doctor es lo que Finanzas llama «Por doctor»: el total
 *    de las facturas EMITIDAS del periodo (sin borradores ni canceladas) por
 *    `Invoice.doctorId`. Es lo facturado, no lo cobrado.
 *  · Rentabilidad: NO existía como reporte. Se arma con las mismas piezas que
 *    la pantalla de Procedimientos —`gastoDe` y `margenDe` de
 *    dashboard/procedures/margen, y `costoDeRecetaPorProcedimiento`— sobre el
 *    precio de catálogo (`basePrice`). El margen es precio − gasto, y SOLO
 *    cuando hay gasto: sin gasto capturado se dice «sin costo capturado», nunca
 *    se inventa un 100% de margen. Es el margen del CATÁLOGO, no de lo cobrado
 *    en cada factura.
 *  · Pacientes nuevos: el conteo de altas del periodo que hace Reportes
 *    (`patient.count` por `createdAt`). «Atendidos» no lo calcula ninguna
 *    pantalla: son los pacientes distintos con una cita cumplida
 *    (`ESTADOS_CUMPLIDOS`, el criterio del barrido de reactivación) en el mismo
 *    periodo.
 */

import { z } from "zod";
import { money } from "@/lib/caja";
import { cargarFiltroSinPrueba } from "@/lib/patients/paciente-de-prueba-db";
import { calcularResumenFinanzas, type ResumenFinanzas } from "@/lib/finanzas-resumen.server";
import { costoDeRecetaPorProcedimiento } from "@/lib/inventory/costo-receta.server";
import { gastoDe, margenDe } from "@/app/dashboard/procedures/margen";
import { dbDe, definirHerramienta, fraseRecorte, lineasDeLista, pesos, pesosDeLista, plural, recortar, tienePermiso, type Lista } from "./base";
import { ESTADOS_CUMPLIDOS } from "./estados";
import { esquemaPeriodo, nombreDelPeriodo, pctConSigno, pctMargen, pesosConSigno, variacionPct, ventanaAnterior, ventanaFinanzas, type VentanaFinanzas } from "./finanzas-comun";
import type { SeccionOmitida } from "./resumen-clinica";
import type { PermissionKey, SabinaCtx } from "../tipos";
import { fraseSinPermiso } from "../engine-core";
import { causaSinPermiso } from "../permisos-sabina";

export const ENLACES_REPORTES = {
  finanzas: "/dashboard/finanzas",
  reportes: "/dashboard/reports",
  procedimientos: "/dashboard/procedures",
} as const;

const VISTAS = ["resumen", "utilidad", "produccion_doctores", "rentabilidad", "pacientes"] as const;
export type VistaReportes = (typeof VISTAS)[number];

const parametros = esquemaPeriodo.extend({
  vista: z
    .enum(VISTAS)
    .optional()
    .describe(
      "resumen (default, la clínica en el periodo) | utilidad (ingresos − gastos) | produccion_doctores | " +
        "rentabilidad (margen por procedimiento; no usa periodo) | pacientes (atendidos y nuevos)",
    ),
});

export type ParamsReportes = z.infer<typeof parametros>;

export interface FilaMargen {
  nombre: string;
  categoria: string;
  /** Precio de catálogo. */
  precio: number;
  /** Gasto del procedimiento y de dónde sale (manual o receta de materiales). */
  gasto: number;
  origenGasto: "manual" | "receta";
  margen: number;
  /** margen ÷ precio, entero. `null` si el precio es 0. */
  margenPct: number | null;
}

export interface DatosReportes {
  vista: VistaReportes;
  periodo: string;
  desde: string;
  hasta: string;
  utilidad: {
    ingresos: number;
    reembolsos: number;
    gastos: number;
    utilidad: number;
    /** utilidad ÷ ingresos, entero. `null` si no hubo ingresos. */
    margenPct: number | null;
    anterior: { desde: string; hasta: string; ingresos: number; gastos: number; utilidad: number } | null;
    /** `null` si la utilidad anterior no fue positiva: no hay base para un %. */
    variacionUtilidadPct: number | null;
  } | null;
  produccion: {
    total: number;
    facturas: number;
    doctores: Lista<{ doctor: string; facturado: number; porcentaje: number }>;
  } | null;
  /** Solo en `resumen`: lo demás que cuenta la pantalla de Finanzas. */
  actividad: {
    citas: number;
    porCobrar: number;
    vencido: number;
    saldosIncompletos: boolean;
  } | null;
  rentabilidad: {
    procedimientos: number;
    /** Con gasto capturado, del mayor al menor margen (%). */
    conMargen: Lista<FilaMargen>;
    /** Sin gasto manual ni receta: no se les inventa margen. */
    sinCosto: Lista<{ nombre: string; categoria: string; precio: number }>;
  } | null;
  pacientes: {
    nuevos: number;
    nuevosAnterior: number;
    variacionPct: number | null;
    /** Pacientes distintos con al menos una cita cumplida en el periodo. */
    atendidos: number;
    citasCumplidas: number;
  } | null;
  omitidas: SeccionOmitida[];
  enlaces: typeof ENLACES_REPORTES;
}

export const reportes = definirHerramienta<ParamsReportes, DatosReportes>({
  nombre: "reportes",
  descripcion:
    "Los reportes de la clínica que ya calculan Finanzas, Reportes y Procedimientos, en cinco vistas: " +
    "`utilidad` (ingresos menos gastos del periodo, contra el anterior), `produccion_doctores` (lo " +
    "facturado por cada doctor), `rentabilidad` (margen por procedimiento: precio de catálogo menos su " +
    "gasto; los que no tienen costo capturado se dicen así), `pacientes` (atendidos y nuevos del " +
    "periodo) y `resumen` (todo lo anterior junto: la clínica en un periodo). El periodo es hoy, este " +
    "mes, el mes anterior o un rango. Úsala para «¿cuánto gané este mes?», «¿cuál doctor produce más?», " +
    "«¿qué procedimiento deja más margen?», «¿cuántos pacientes atendí?» o «¿cómo va la clínica este " +
    "mes?». Cada parte exige su permiso: lo que no puedas ver viene en `omitidas` y HAY QUE DECÍRSELO a " +
    "quien pregunta (no es que no haya datos, es que no tiene acceso). Para solo gastos usa `gastos`.",
  parametros,
  // La llave de entrada la tiene todo rol; cada parte se gatea con la de su pantalla.
  permiso: "today.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosReportes> {
    const db = dbDe(ctx) as any;
    const vista: VistaReportes = params.vista ?? "resumen";
    const ahora = new Date();
    const v = ventanaFinanzas(params, ahora);
    // ws1-t11 (11d): los «Pacientes de prueba / no contactar» no cuentan, igual que en las pantallas.
    const sinPrueba = await cargarFiltroSinPrueba(ctx.clinicId);

    const omitidas: SeccionOmitida[] = [];
    const puede = (seccion: string, permiso: PermissionKey): boolean => {
      if (tienePermiso(ctx, permiso)) return true;
      const causa = causaSinPermiso(ctx, permiso);
      if (!omitidas.some((o) => o.seccion === seccion)) {
        omitidas.push(causa === "usuario" ? { seccion, permiso } : { seccion, permiso, causa });
      }
      return false;
    };

    const quiereFinanzas = vista === "resumen" || vista === "utilidad" || vista === "produccion_doctores";
    const verFinanzas =
      quiereFinanzas &&
      puede(vista === "produccion_doctores" ? "producción por doctor" : vista === "utilidad" ? "utilidad" : "utilidad, producción y saldos", "analytics.view");
    const verRentabilidad = (vista === "resumen" || vista === "rentabilidad") && puede("rentabilidad por procedimiento", "procedures.view");
    const verPacientes = (vista === "resumen" || vista === "pacientes") && puede("pacientes atendidos y nuevos", "reports.view");

    const datos: DatosReportes = {
      vista,
      periodo: v.periodo,
      desde: v.desde,
      hasta: v.hasta,
      utilidad: null,
      produccion: null,
      actividad: null,
      rentabilidad: null,
      pacientes: null,
      omitidas,
      enlaces: ENLACES_REPORTES,
    };

    // Tanda 1 — Finanzas (8 consultas en dos lotes dentro de la función; la comparación va DESPUÉS, no a la vez).
    if (verFinanzas) {
      const conSaldos = vista === "resumen";
      const actual = await calcularResumenFinanzas(
        { clinicId: ctx.clinicId, from: v.from, to: v.to, expenseTo: v.expenseTo, conSaldos, sinPrueba },
        db,
      );
      let anterior: ResumenFinanzas | null = null;
      let ventanaPrev: VentanaFinanzas | null = null;
      if (vista === "utilidad") {
        ventanaPrev = ventanaAnterior(v, ahora);
        anterior = await calcularResumenFinanzas(
          { clinicId: ctx.clinicId, from: ventanaPrev.from, to: ventanaPrev.to, expenseTo: ventanaPrev.expenseTo, conSaldos: false, sinPrueba },
          db,
        );
      }

      if (vista !== "produccion_doctores") {
        datos.utilidad = {
          ingresos: actual.ingresos,
          reembolsos: actual.reembolsos,
          gastos: actual.gastos,
          utilidad: actual.utilidad,
          margenPct: actual.ingresos > 0 ? Math.round((actual.utilidad / actual.ingresos) * 100) : null,
          anterior:
            anterior && ventanaPrev
              ? { desde: ventanaPrev.desde, hasta: ventanaPrev.hasta, ingresos: anterior.ingresos, gastos: anterior.gastos, utilidad: anterior.utilidad }
              : null,
          variacionUtilidadPct: anterior ? variacionPct(actual.utilidad, anterior.utilidad) : null,
        };
      }
      if (vista !== "utilidad") {
        const total = money(actual.porDoctor.reduce((s, d) => s + d.ingresos, 0));
        datos.produccion = {
          total,
          facturas: actual.ventas,
          doctores: recortar(
            actual.porDoctor.map((d) => ({
              doctor: d.doctor,
              facturado: d.ingresos,
              porcentaje: total > 0 ? Math.round((d.ingresos / total) * 100) : 0,
            })),
          ),
        };
      }
      if (vista === "resumen" && actual.saldos) {
        datos.actividad = {
          citas: actual.citas,
          porCobrar: actual.saldos.porCobrar,
          vencido: actual.saldos.vencido,
          saldosIncompletos: actual.saldos.incompleto,
        };
      }
    }

    // Tanda 2 — rentabilidad (2 consultas) y pacientes (4), una tras otra.
    if (verRentabilidad) {
      const [procs, costoReceta]: [any[], Record<string, number>] = await Promise.all([
        db.procedureCatalog.findMany({
          where: { clinicId: ctx.clinicId, isActive: true },
          select: { id: true, name: true, category: true, basePrice: true, cost: true },
          orderBy: [{ category: "asc" }, { name: "asc" }],
        }),
        costoDeRecetaPorProcedimiento(ctx.clinicId, db),
      ]);
      const conMargen: FilaMargen[] = [];
      const sinCosto: Array<{ nombre: string; categoria: string; precio: number }> = [];
      for (const p of procs) {
        const precio = Number(p.basePrice) || 0;
        const gasto = gastoDe(p.cost, costoReceta[p.id]);
        const margen = margenDe(precio, gasto ? gasto.monto : null);
        if (!gasto || margen === null) {
          sinCosto.push({ nombre: p.name, categoria: p.category, precio });
          continue;
        }
        conMargen.push({
          nombre: p.name,
          categoria: p.category,
          precio,
          gasto: money(gasto.monto),
          origenGasto: gasto.origen,
          margen: money(margen),
          margenPct: precio > 0 ? Math.round((margen / precio) * 100) : null,
        });
      }
      conMargen.sort((a, b) => (b.margenPct ?? -Infinity) - (a.margenPct ?? -Infinity) || b.margen - a.margen);
      datos.rentabilidad = {
        procedimientos: procs.length,
        conMargen: recortar(conMargen),
        sinCosto: recortar(sinCosto),
      };
    }

    if (verPacientes) {
      const prev = ventanaAnterior(v, ahora);
      const [nuevos, nuevosAnterior, cumplidas] = await Promise.all([
        db.patient.count({ where: { clinicId: ctx.clinicId, ...sinPrueba.paciente, createdAt: { gte: v.from, lte: v.to } } }),
        db.patient.count({ where: { clinicId: ctx.clinicId, ...sinPrueba.paciente, createdAt: { gte: prev.from, lte: prev.to } } }),
        db.appointment.groupBy({
          by: ["patientId"],
          where: {
            clinicId: ctx.clinicId,
            ...sinPrueba.porPatientId,
            startsAt: { gte: v.from, lte: v.to },
            status: { in: [...ESTADOS_CUMPLIDOS] },
          },
          _count: { _all: true },
        }),
      ]);
      datos.pacientes = {
        nuevos,
        nuevosAnterior,
        variacionPct: variacionPct(nuevos, nuevosAnterior),
        atendidos: cumplidas.length,
        citasCumplidas: cumplidas.reduce((s: number, g: any) => s + (g._count?._all ?? 0), 0),
      };
    }

    return datos;
  },

  // Una clínica en calma (todo en 0) es una respuesta; y si TODO está omitido por permisos, también.
  vacio: () => false,

  resumir(d) {
    const cuando = d.vista === "rentabilidad" ? "" : ` ${nombreDelPeriodo(d)} (${d.desde} al ${d.hasta})`;
    const partes: string[] = [];

    if (d.utilidad) {
      const u = d.utilidad;
      const dev = u.reembolsos > 0 ? ` (ya restados ${pesos(u.reembolsos)} de reembolsos)` : "";
      let t = `Ingresos ${pesos(u.ingresos)}${dev} − gastos ${pesos(u.gastos)} = ${u.utilidad < 0 ? "pérdida" : "utilidad"} de ${pesos(Math.abs(u.utilidad))}`;
      if (u.margenPct !== null) t += ` (${pctMargen(u.margenPct)} de los ingresos)`;
      t += ".";
      if (u.anterior) {
        t += ` El periodo anterior (${u.anterior.desde} al ${u.anterior.hasta}): ingresos ${pesos(u.anterior.ingresos)}, gastos ${pesos(u.anterior.gastos)}, utilidad ${pesosConSigno(u.anterior.utilidad)}` +
          `${u.variacionUtilidadPct === null ? "" : ` (${pctConSigno(u.variacionUtilidadPct)} la utilidad)`}.`;
      }
      partes.push(t);
    }

    if (d.produccion) {
      const p = d.produccion;
      if (p.doctores.filas.length === 0) {
        partes.push("No hay facturas emitidas en el periodo, así que ningún doctor tiene producción.");
      } else {
        const fmt = pesosDeLista(p.doctores.filas.map((x) => x.facturado));
        const linea = (x: { doctor: string; facturado: number; porcentaje: number }) => `${x.doctor}: ${fmt(x.facturado)} (${x.porcentaje}%)`;
        partes.push(
          `Producción por doctor (lo facturado, no lo cobrado): ${pesos(p.total)} en ${plural(p.facturas, "factura emitida", "facturas emitidas")}` +
            `${p.doctores.filas.length >= 2 ? `${fraseRecorte(p.doctores, "doctores")}:${lineasDeLista(p.doctores.filas, linea)}` : `, todo de ${linea(p.doctores.filas[0])}.`}`,
        );
      }
    }

    if (d.actividad) {
      const a = d.actividad;
      partes.push(
        `Citas del periodo: ${a.citas} (sin las canceladas). Por cobrar: ${pesos(a.porCobrar)}, de los cuales vencido ${pesos(a.vencido)}` +
          `${a.saldosIncompletos ? " (cifras mínimas: la clínica tiene muchísimas facturas abiertas)" : ""}.`,
      );
    }

    if (d.rentabilidad) {
      const r = d.rentabilidad;
      if (r.procedimientos === 0) {
        partes.push("El catálogo de procedimientos está vacío, así que no hay rentabilidad que calcular.");
      } else {
        const filas = r.conMargen.filas;
        const fm = (f: FilaMargen) =>
          `${f.nombre}: precio ${pesos(f.precio)}, gasto ${pesos(f.gasto)} (${f.origenGasto === "receta" ? "receta de materiales" : "capturado"}), margen ${pesosConSigno(f.margen)}${f.margenPct === null ? "" : ` (${pctMargen(f.margenPct)})`}`;
        let t = `Rentabilidad por procedimiento (margen del catálogo = precio − gasto): ${plural(r.conMargen.total, "procedimiento con costo capturado", "procedimientos con costo capturado")} de ${r.procedimientos}.`;
        if (filas.length > 0) {
          const arriba = filas.slice(0, 5);
          t += `\nMás rentables:${lineasDeLista(arriba, fm) || ` ${fm(arriba[0])}.`}`;
          if (filas.length > 5) {
            const abajo = filas.slice(-Math.min(3, filas.length - 5)).reverse();
            t += `\nMenos rentables:${lineasDeLista(abajo, fm) || ` ${fm(abajo[0])}.`}`;
          }
        }
        if (r.sinCosto.total > 0) {
          const nombres = r.sinCosto.filas.slice(0, 8).map((s) => s.nombre).join(", ");
          t += `\n${plural(r.sinCosto.total, "procedimiento está", "procedimientos están")} sin costo capturado (no se les calcula margen): ${nombres}${r.sinCosto.total > 8 ? " y más" : ""}.`;
        }
        partes.push(t);
      }
    }

    if (d.pacientes) {
      const p = d.pacientes;
      partes.push(
        `Pacientes: ${plural(p.atendidos, "atendido", "atendidos")} (${plural(p.citasCumplidas, "cita cumplida", "citas cumplidas")}) y ` +
          `${plural(p.nuevos, "nuevo", "nuevos")}` +
          `${p.variacionPct === null ? (p.nuevosAnterior === 0 ? "; en el periodo anterior no hubo altas" : "") : ` (${pctConSigno(p.variacionPct)} contra ${p.nuevosAnterior} del periodo anterior)`}.`,
      );
    }

    const enlaces: string[] = [];
    if (d.utilidad || d.produccion || d.actividad) enlaces.push(`[Finanzas](${d.enlaces.finanzas})`);
    if (d.pacientes) enlaces.push(`[Reportes](${d.enlaces.reportes})`);
    if (d.rentabilidad) enlaces.push(`[Procedimientos](${d.enlaces.procedimientos})`);
    const ver = enlaces.length > 0 ? `\nDetalle en ${enlaces.join(" · ")}.` : "";

    const base =
      partes.length === 0
        ? ""
        : d.vista === "rentabilidad"
          ? `${partes.join("\n")}${ver}`
          : `Reporte ${cuando.trim()}:\n${partes.join("\n")}${ver}`;

    if (d.omitidas.length === 0) return base;
    const delUsuario = d.omitidas.filter((o) => !o.causa);
    const deSabina = d.omitidas.filter((o) => o.causa);
    const avisos: string[] = [];
    if (delUsuario.length > 0) {
      const falta = delUsuario.map((o) => `${o.seccion} (falta ${o.permiso})`).join(", ");
      avisos.push(`NO tienes acceso a: ${falta} — dilo, no lo presentes como que no hay datos.`);
    }
    if (deSabina.length > 0) {
      const frases = Array.from(new Set(deSabina.map((o) => fraseSinPermiso(o.permiso, o.causa))));
      avisos.push(
        `Omití ${deSabina.map((o) => o.seccion).join(", ")}: el usuario SÍ tiene ese acceso, pero el Super Admin no te deja usarlo en su nombre. ` +
          `NO digas que no tiene acceso; di textualmente: "${frases.join(" ")}"`,
      );
    }
    return base ? `${base} ${avisos.join(" ")}` : avisos.join(" ");
  },
});
