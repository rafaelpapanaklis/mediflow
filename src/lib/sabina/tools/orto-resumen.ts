/**
 * `orto_resumen` — el histórico de ortodoncia de la clínica.
 *
 *   «¿cuántos casos de ortodoncia he tenido y cuánto me han generado?»
 *   «¿cuántos casos arrancaron este año?» · «¿y los de la Dra. Soto?»
 *
 * Contesta: casos totales y por estado (por colocar, en curso, pausados, en
 * retención, terminados, abandonados), por técnica y por doctor; y el dinero:
 * el valor de los casos, lo COBRADO (colocación, mensualidades, controles,
 * extras), lo que falta y lo vencido.
 *
 * 🔴 NI UN NÚMERO PROPIO (ver ./orto-resumen-motor). Los casos y el saldo son los
 * de la pantalla Casos/Cobranza (`loadOrthoCases` + `deudaDelCaso`); lo cobrado
 * es `Invoice.paid` de las facturas del caso; lo cobrado EN UN PERIODO es la
 * función de la «Producción del mes» del Tablero con otro rango. Aquí solo se
 * cuenta y se reparte.
 *
 * 🔴 SOLO LECTURA. No abre casos, no cobra y no cambia nada: da el enlace.
 *
 * ── EL PERIODO ──────────────────────────────────────────────────────────
 * Filtra los CASOS por la fecha en que arrancaron (colocación; si aún no se
 * coloca, cuando se abrieron): «los casos de 2026 y lo que han generado». Aparte,
 * con periodo, sale «cobrado en el periodo»: los pagos que ENTRARON en esas
 * fechas de cualquier caso, que es otra pregunta («¿cuánto cobré de ortodoncia
 * este año?») y no tiene por qué coincidir.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────
 * La key del módulo la mira el runner. Los conteos van con eso; el DINERO va
 * detrás de `billing.view` y, si falta, se DICE (`omitidas`). Visibilidad de
 * paciente: la del panel.
 */

import { z } from "zod";
import { sinAcentos } from "@/lib/orthodontics/cobranza-modulo";
import { conteoDeCasos } from "@/lib/orthodontics/finanzas-ortodoncia";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";
import { hoyEnZona } from "@/lib/fechas/hoy-en-zona";
import { definirHerramienta, pesos, plural, recortar, type Lista } from "./base";
import {
  ENLACES_ORTO,
  PERMISO_ORTO,
  anotador,
  avisoEnlace,
  avisoSinModulo,
  fraseOmitidas,
  sinModulo,
  type EstadoModulo,
  type OmitidaOrto,
} from "./orto-comun";
import type { CasoResumen } from "./orto-resumen-motor";
import type { SabinaCtx } from "../tipos";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const parametros = z.object({
  /** "este_anio" / "este_mes" = el año o el mes en curso de la clínica; "todo" (por defecto) = todo el histórico. */
  periodo: z.enum(["todo", "este_anio", "este_mes"]).optional(),
  /** Un año concreto (2025). */
  anio: z.number().int().min(2000).max(2100).optional(),
  /** Un mes concreto, "AAAA-MM". */
  mes: z.string().regex(MES, "mes debe ser AAAA-MM").optional(),
  /** Rango de fechas, "AAAA-MM-DD". Gana sobre mes, año y periodo. */
  desde: z.string().regex(FECHA, "desde debe ser AAAA-MM-DD").optional(),
  hasta: z.string().regex(FECHA, "hasta debe ser AAAA-MM-DD").optional(),
  /** Nombre (o parte) del doctor tratante. */
  doctor: z.string().max(120).optional(),
});

export type ParamsOrtoResumen = z.infer<typeof parametros>;

export interface GrupoResumen {
  nombre: string;
  casos: number;
  /** `null` = sin billing.view: el dinero no se enseña. */
  valor: number | null;
  cobrado: number | null;
  pendiente: number | null;
}

export interface DatosOrtoResumen {
  modulo: EstadoModulo;
  /** El doctor pedido no coincide con ninguno: lo que dijo y los que sí hay. */
  doctorNoEncontrado: { dijo: string; doctores: string[] } | null;
  periodo: { etiqueta: string; desde: string | null; hasta: string | null };
  /** Los doctores a los que se ciñó la respuesta, si pidieron uno. */
  doctoresFiltrados: string[] | null;
  casos: {
    total: number;
    /** Planeados, en curso, en pausa y en retención (`conteoDeCasos`, la de Finanzas). */
    activos: number;
    porEstado: Array<{ estado: string; casos: number }>;
    /** Abandonados entre los que ya cerraron; `null` si ninguno cerró. */
    tasaDeAbandono: number | null;
    /** Con periodo: casos sin fecha de arranque que quedaron fuera. */
    sinFecha: number;
  } | null;
  porTecnica: Lista<GrupoResumen> | null;
  porDoctor: Lista<GrupoResumen> | null;
  dinero: {
    /** Lo facturado de los casos (tratamiento + controles + extras, sin canceladas). */
    valorTotal: number;
    cobrado: { total: number; colocacion: number; mensualidades: number; controles: number; extras: number };
    /** La cifra de la columna «saldo» de Casos y Cobranza. */
    pendiente: number;
    vencido: number;
  } | null;
  /** Solo con periodo y billing.view: los pagos que entraron en esas fechas (neto de reembolsos). */
  cobradoEnElPeriodo: { neto: number; porDoctor: Array<{ doctor: string; importe: number }> } | null;
  omitidas: OmitidaOrto[];
  enlace: string;
}

const ESTADOS: Array<{ clave: string; etiqueta: string }> = [
  { clave: "PLANNED", etiqueta: "Por colocar" },
  { clave: "IN_PROGRESS", etiqueta: "En curso" },
  { clave: "ON_HOLD", etiqueta: "Pausados" },
  { clave: "RETENTION", etiqueta: "En retención" },
  { clave: "COMPLETED", etiqueta: "Terminados" },
  { clave: "DROPPED_OUT", etiqueta: "Abandonados" },
];

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function ultimoDia(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** El periodo pedido como días de la clínica, o `null` = todo. Lo ilegible sale como error explicado. */
export function resolverPeriodo(
  p: ParamsOrtoResumen,
  hoy: string,
): { etiqueta: string; desde: string | null; hasta: string | null } {
  if (p.desde || p.hasta) {
    const desde = p.desde ?? "1900-01-01";
    const hasta = p.hasta ?? "2999-12-31";
    if (desde > hasta) throw new Error("parametros_invalidos: desde es posterior a hasta");
    return {
      etiqueta: p.desde && p.hasta ? `del ${p.desde} al ${p.hasta}` : p.desde ? `desde el ${p.desde}` : `hasta el ${p.hasta}`,
      desde: p.desde ?? null,
      hasta: p.hasta ?? null,
    };
  }
  const mesDe = (m: string) => {
    const [a, n] = m.split("-").map(Number);
    return { etiqueta: `${MESES[n - 1]} de ${a}`, desde: `${m}-01`, hasta: ultimoDia(a, n) };
  };
  if (p.mes) return mesDe(p.mes);
  if (p.anio) return { etiqueta: String(p.anio), desde: `${p.anio}-01-01`, hasta: `${p.anio}-12-31` };
  if (p.periodo === "este_mes") return mesDe(hoy.slice(0, 7));
  if (p.periodo === "este_anio") {
    const a = Number(hoy.slice(0, 4));
    return { etiqueta: String(a), desde: `${a}-01-01`, hasta: `${a}-12-31` };
  }
  return { etiqueta: "todo el histórico", desde: null, hasta: null };
}

function agrupar(casos: CasoResumen[], clave: (c: CasoResumen) => string, conDinero: boolean): GrupoResumen[] {
  const m = new Map<string, { casos: number; valor: number; cobrado: number; pendiente: number }>();
  for (const c of casos) {
    const k = clave(c);
    const g = m.get(k) ?? { casos: 0, valor: 0, cobrado: 0, pendiente: 0 };
    g.casos += 1;
    g.valor = Math.round((g.valor + c.valor) * 100) / 100;
    g.cobrado = Math.round((g.cobrado + c.cobrado.total) * 100) / 100;
    g.pendiente = Math.round((g.pendiente + c.pendiente) * 100) / 100;
    m.set(k, g);
  }
  return Array.from(m, ([nombre, g]) => ({
    nombre,
    casos: g.casos,
    valor: conDinero ? g.valor : null,
    cobrado: conDinero ? g.cobrado : null,
    pendiente: conDinero ? g.pendiente : null,
  })).sort((a, b) => b.casos - a.casos || (b.cobrado ?? 0) - (a.cobrado ?? 0) || a.nombre.localeCompare(b.nombre, "es"));
}

export const ortoResumen = definirHerramienta<ParamsOrtoResumen, DatosOrtoResumen>({
  nombre: "orto_resumen",
  descripcion:
    "ORTODONCIA, el histórico de la clínica: cuántos casos ha tenido y cuánto han generado. Casos totales y por " +
    "estado (por colocar, en curso, pausados, en retención, terminados, abandonados), por técnica y por doctor; " +
    "el valor de los casos, lo cobrado (colocación, mensualidades, controles, extras), lo que falta y lo vencido. " +
    "Filtros: `periodo` (\"este_anio\", \"este_mes\"), `anio`, `mes` (AAAA-MM), `desde`/`hasta` (AAAA-MM-DD) y `doctor`. " +
    "El periodo filtra los casos por la fecha en que arrancaron; con periodo también dice cuánto se cobró en esas " +
    "fechas. Son las cifras de Casos, Cobranza y Tablero del módulo. Solo lee; da el enlace. Para UN paciente usa orto_caso.",
  parametros,
  permiso: PERMISO_ORTO,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOrtoResumen> {
    const motor = await import("./orto-motor");
    const base: DatosOrtoResumen = {
      modulo: "activo",
      doctorNoEncontrado: null,
      periodo: { etiqueta: "todo el histórico", desde: null, hasta: null },
      doctoresFiltrados: null,
      casos: null,
      porTecnica: null,
      porDoctor: null,
      dinero: null,
      cobradoEnElPeriodo: null,
      omitidas: [],
      enlace: ENLACES_ORTO.pacientes,
    };
    const modulo = await motor.estadoDelModulo(ctx);
    if (modulo !== "activo") return { ...base, ...sinModulo(modulo) };

    const omitidas: OmitidaOrto[] = [];
    const puede = anotador(ctx, omitidas);
    const conDinero = puede("el dinero de los casos (valor, cobrado, pendiente)", "billing.view");

    const zona = motor.zonaDe(ctx);
    const periodo = resolverPeriodo(params, hoyEnZona(new Date(), zona));
    const resumen = await import("./orto-resumen-motor");
    const leido = await resumen.leerResumen(ctx);

    // El doctor: parte del nombre, sin acentos ni mayúsculas.
    let casos = leido.casos;
    let doctoresFiltrados: string[] | null = null;
    const dijo = (params.doctor ?? "").trim();
    if (dijo) {
      const q = sinAcentos(dijo).toLowerCase();
      const coinciden = casos.filter((c) => c.doctor && sinAcentos(c.doctor).toLowerCase().includes(q));
      if (coinciden.length === 0) {
        const doctores = Array.from(new Set(casos.map((c) => c.doctor).filter((d): d is string => !!d))).sort((a, b) => a.localeCompare(b, "es"));
        return { ...base, periodo, doctorNoEncontrado: { dijo, doctores }, omitidas };
      }
      casos = coinciden;
      doctoresFiltrados = Array.from(new Set(coinciden.map((c) => c.doctor as string))).sort((a, b) => a.localeCompare(b, "es"));
    }

    // El periodo filtra los casos por la fecha en que arrancaron.
    let sinFecha = 0;
    const delPeriodo = casos;
    if (periodo.desde || periodo.hasta) {
      const desde = periodo.desde ? calendarDayRangeUtc(periodo.desde, zona).startUtc : null;
      const hasta = periodo.hasta ? calendarDayRangeUtc(periodo.hasta, zona).endUtc : null;
      casos = casos.filter((c) => {
        if (!c.inicio) {
          sinFecha += 1;
          return false;
        }
        return (!desde || c.inicio >= desde) && (!hasta || c.inicio < hasta);
      });
    }

    const cuenta = conteoDeCasos(casos.map((c) => ({ status: c.status as never })));
    const porEstado = ESTADOS.map((e) => ({ estado: e.etiqueta, casos: casos.filter((c) => c.status === e.clave).length }));

    let dinero: DatosOrtoResumen["dinero"] = null;
    if (conDinero) {
      const c100 = (n: number) => Math.round(n * 100);
      const suma = (f: (c: CasoResumen) => number) => casos.reduce((s, c) => s + c100(f(c)), 0) / 100;
      dinero = {
        valorTotal: suma((c) => c.valor),
        cobrado: {
          total: suma((c) => c.cobrado.total),
          colocacion: suma((c) => c.cobrado.colocacion),
          mensualidades: suma((c) => c.cobrado.mensualidades),
          controles: suma((c) => c.cobrado.controles),
          extras: suma((c) => c.cobrado.extras),
        },
        pendiente: suma((c) => c.pendiente),
        vencido: suma((c) => c.vencido),
      };
    }

    let cobradoEnElPeriodo: DatosOrtoResumen["cobradoEnElPeriodo"] = null;
    if (conDinero && (periodo.desde || periodo.hasta)) {
      cobradoEnElPeriodo = await resumen.produccionDelPeriodo(
        ctx,
        delPeriodo,
        leido.invoiceIdByPlanId,
        { desde: periodo.desde ?? "1900-01-01", hasta: periodo.hasta ?? "2999-12-31" },
      );
    }

    return {
      ...base,
      periodo,
      doctoresFiltrados,
      casos: { total: cuenta.total, activos: cuenta.activos, porEstado, tasaDeAbandono: cuenta.tasaDeAbandono, sinFecha },
      porTecnica: recortar(agrupar(casos, (c) => c.tecnica, conDinero)),
      porDoctor: recortar(agrupar(casos, (c) => c.doctor ?? "Sin doctor tratante", conDinero)),
      dinero,
      cobradoEnElPeriodo,
      omitidas,
    };
  },

  // «Ningún caso en ese periodo» es una respuesta, no «sin datos».
  vacio: () => false,

  avisoObligatorio(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo);
    if (d.doctorNoEncontrado) return null;
    return avisoEnlace("ver el detalle de cada caso", "Casos de ortodoncia", ENLACES_ORTO.pacientes);
  },

  resumir(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo).frase;
    if (d.doctorNoEncontrado) {
      const hay = d.doctorNoEncontrado.doctores.length > 0 ? ` Los doctores con casos son: ${d.doctorNoEncontrado.doctores.join(", ")}.` : "";
      return `No encuentro un doctor tratante que se llame «${d.doctorNoEncontrado.dijo}».${hay} Pregunta cuál y vuelve a llamar con \`doctor\`; NO des cifras sin filtro como si fueran de ese doctor.${fraseOmitidas(d.omitidas)}`;
    }
    const c = d.casos!;
    const donde = d.doctoresFiltrados ? ` de ${d.doctoresFiltrados.join(" y ")}` : "";
    const cuando = d.periodo.desde || d.periodo.hasta ? ` que arrancaron ${d.periodo.etiqueta}` : "";
    // Lo cobrado en el periodo es otra pregunta que los casos que arrancaron en él: va aunque no haya casos.
    const fraseCobrado = (() => {
      if (!d.cobradoEnElPeriodo) return "";
      const p = d.cobradoEnElPeriodo;
      const por = p.porDoctor.length > 1 ? ` (${p.porDoctor.map((x) => `${x.doctor} ${pesos(x.importe)}`).join(", ")})` : "";
      return (
        `Aparte, los pagos que entraron ${d.periodo.etiqueta}, de cualquier caso: ${pesos(p.neto)}${por}. ` +
        "Es otra pregunta (cuándo se cobró, no cuándo arrancó el caso)."
      );
    })();
    if (c.total === 0) {
      return `No hay casos de ortodoncia${donde}${cuando}.${c.sinFecha > 0 ? ` (${plural(c.sinFecha, "caso no tiene", "casos no tienen")} fecha de arranque y no entran en un periodo.)` : ""}${fraseCobrado ? ` ${fraseCobrado}` : ""}${fraseOmitidas(d.omitidas)}`;
    }
    const partes: string[] = [];
    const estados = c.porEstado.filter((e) => e.casos > 0).map((e) => `${e.casos} ${e.estado.toLowerCase()}`);
    partes.push(`Casos de ortodoncia${donde}${cuando}: ${c.total} (${estados.join(", ")}); ${c.activos} abiertos.`);
    if (c.tasaDeAbandono !== null) partes.push(`Abandono: ${c.tasaDeAbandono}% de los que ya cerraron.`);

    if (d.dinero) {
      const m = d.dinero;
      const trozos = [
        m.cobrado.colocacion > 0 ? `colocación ${pesos(m.cobrado.colocacion)}` : null,
        m.cobrado.mensualidades > 0 ? `mensualidades ${pesos(m.cobrado.mensualidades)}` : null,
        m.cobrado.controles > 0 ? `controles ${pesos(m.cobrado.controles)}` : null,
        m.cobrado.extras > 0 ? `extras ${pesos(m.cobrado.extras)}` : null,
      ].filter(Boolean);
      partes.push(
        `Valor de esos casos: ${pesos(m.valorTotal)}. Cobrado: ${pesos(m.cobrado.total)}${trozos.length ? ` (${trozos.join(", ")})` : ""}. ` +
          `Por cobrar: ${pesos(m.pendiente)}${m.vencido > 0 ? `, de los cuales ${pesos(m.vencido)} ya vencieron` : ""}. ` +
          "No sumes ni restes estas cifras entre sí: el valor es lo facturado y el saldo es el de la pantalla de Cobranza.",
      );
    }
    if (fraseCobrado) partes.push(fraseCobrado);
    const linea = (g: GrupoResumen) =>
      `${g.nombre}: ${plural(g.casos, "caso", "casos")}${g.cobrado !== null ? `, cobrado ${pesos(g.cobrado)}, por cobrar ${pesos(g.pendiente ?? 0)}` : ""}`;
    if (d.porTecnica && d.porTecnica.filas.length > 1) partes.push(`Por técnica — ${d.porTecnica.filas.map(linea).join("; ")}.`);
    if (!d.doctoresFiltrados && d.porDoctor && d.porDoctor.filas.length > 1) partes.push(`Por doctor — ${d.porDoctor.filas.map(linea).join("; ")}.`);
    if (c.sinFecha > 0) partes.push(`${plural(c.sinFecha, "caso", "casos")} sin fecha de arranque no entra${c.sinFecha === 1 ? "" : "n"} en el periodo.`);
    partes.push(`Detalle en [Casos de ortodoncia](${ENLACES_ORTO.pacientes}), [Cobranza](${ENLACES_ORTO.cobranza}) y [el Tablero](${ENLACES_ORTO.tablero}).`);
    return `${partes.join(" ")}${fraseOmitidas(d.omitidas)}`;
  },
});
