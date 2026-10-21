// «Que nada se cobre dos veces» (ws1-t12 · fase 2, P5) — la regla, en funciones PURAS.
//
// Decisión de Rafael (20-oct-2026): una nota de cobro POR PLAN; los pagos son abonos a ella. Hasta
// aquí, un mismo procedimiento del plan podía acabar en tres facturas: la nota del plan, la factura
// BORRADOR que la consulta crea sola con «Procedimientos realizados» y la que crea «Crear factura»
// de «Tratamientos detectados» al completar la consulta. Desde ahora:
//
//  · Lo que está en un plan se cobra en la nota del plan (y sus abonos), nunca en una factura suelta.
//    La consulta y «Tratamientos detectados» lo reconocen con `emparejarConElPlan` y lo apartan: el
//    borrador de la consulta y «Crear factura» se quedan solo con lo que NO está en ningún plan.
//  · Lo que no está en ningún plan se cobra como hoy (una consulta suelta no cambia).
//
// Cuándo una cosa cobrable «es» una fila del plan:
//  · el mismo procedimiento: el mismo `procedureId` del tarifario, o el mismo TIPO de procedimiento
//    (`claveDeProcedimiento`: «Resina 2 caras» del plan y «Restauración con resina» que propone el
//    odontograma son la misma resina), o el mismo nombre sin mayúsculas ni acentos;
//  · y el mismo diente, cuando los dos dicen diente (una fila sin dientes —limpieza de toda la boca—
//    vale para cualquiera; una cosa sin diente —la consulta no los pide— vale para cualquier fila);
//  · la fila está por hacer (pendiente o en curso) o se marcó hecha HACE POCO (`HECHO_RECIENTE_MS`):
//    el «hecho → odontograma» escribe en el odontograma justo lo que «Tratamientos detectados» vería
//    como trabajo nuevo. Una fila hecha hace días no se toma: lo de hoy es trabajo nuevo.
//  · una fila cancelada nunca.
// Con diente: una fila con ESE diente cubre todo lo de ese tipo en ese diente (el odontograma propone
// una resina por cara: 16 M y 16 O son la resina «2 caras» del plan, no dos). Sin diente: cada unidad
// toma UNA unidad de fila (una fila con cantidad 2 cubre dos), así dos resinas en la consulta y una
// en el plan dejan una en la factura de la consulta.

import type { EstadoDeFila } from "./items";
import { claveDeProcedimiento } from "./sugerir-procedimiento";

/** Cuánto tiempo, tras marcarse hecha, una fila sigue «siendo» lo que se detecta hoy. */
export const HECHO_RECIENTE_MS = 24 * 60 * 60 * 1000;

/** Lo que hace falta de una fila del plan para emparejarla (vale `FilaDelPlan` y `FilaDto`). */
export interface FilaParaEmparejar {
  id: string;
  planId: string;
  nombre: string;
  procedureId: string | null;
  dientes: number[];
  cantidad: number;
  estado: EstadoDeFila;
  hechoEn: Date | string | null;
  invoiceId: string | null;
}

/** Algo que una pantalla está a punto de cobrar (un procedimiento de la consulta, un tratamiento detectado). */
export interface CosaCobrable {
  nombre: string;
  /** Llave `ODO_*` del procedimiento, si la trae (lo que propone el odontograma). */
  codigo?: string | null;
  procedureId?: string | null;
  diente?: number | null;
  cantidad?: number;
}

export interface EmparejadoConElPlan {
  /** Índice de la cosa en la lista de entrada. */
  indice: number;
  filaId: string;
  planId: string;
  /** Unidades de la cosa que cubre esta fila. */
  unidades: number;
  /** La fila ya está en una nota de cobro. */
  enNota: boolean;
}

export interface Emparejamiento {
  delPlan: EmparejadoConElPlan[];
  /** Por cada cosa, cuántas unidades NO son de ningún plan (lo que se sigue cobrando como hoy). */
  fuera: number[];
}

const normalizar = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** ¿La fila puede ser lo que se cobra hoy? */
export function filaTomable(f: Pick<FilaParaEmparejar, "estado" | "hechoEn">, ahora: Date = new Date()): boolean {
  if (f.estado === "pendiente" || f.estado === "en_curso") return true;
  if (f.estado !== "hecho" || !f.hechoEn) return false;
  const en = new Date(f.hechoEn).getTime();
  return Number.isFinite(en) && ahora.getTime() - en <= HECHO_RECIENTE_MS;
}

function mismoProcedimiento(c: CosaCobrable, f: FilaParaEmparejar): boolean {
  if (c.procedureId && f.procedureId && c.procedureId === f.procedureId) return true;
  if (normalizar(c.nombre) && normalizar(c.nombre) === normalizar(f.nombre)) return true;
  // Otro procedimiento del tarifario (o sin id) pero del mismo TIPO: es el mismo trabajo.
  const tipo = claveDeProcedimiento({ codigo: c.codigo ?? null, nombre: c.nombre });
  return !!tipo && tipo === claveDeProcedimiento({ nombre: f.nombre });
}

/** 2 = mismo diente; 1 = compatible (alguno no dice diente); 0 = otro diente. */
function cercaniaDeDiente(c: CosaCobrable, f: FilaParaEmparejar): number {
  const d = c.diente == null ? null : Number(c.diente);
  if (d == null || !Number.isFinite(d)) return 1;
  if (f.dientes.length === 0) return 1;
  return f.dientes.indexOf(d) !== -1 ? 2 : 0;
}

/**
 * Qué de lo que se va a cobrar ya es del plan. Prefiere, por cosa: el mismo diente, luego la fila que
 * ya está en una nota (es la que más riesgo tiene de cobrarse dos veces), luego el orden del plan.
 */
export function emparejarConElPlan(cosas: CosaCobrable[], filas: FilaParaEmparejar[], ahora: Date = new Date()): Emparejamiento {
  const capacidad = new Map<string, number>();
  const tomables = filas.filter((f) => f.estado !== "cancelado" && filaTomable(f, ahora));
  // Una fila con varios dientes cubre al menos uno de cada uno.
  for (const f of tomables) capacidad.set(f.id, Math.max(1, Math.round(Number(f.cantidad) || 1), f.dientes.length));

  const delPlan: EmparejadoConElPlan[] = [];
  const fuera: number[] = [];
  // Fila + diente ya tomados: lo demás de ese tipo en ese diente es el mismo trabajo (otra cara).
  const dienteTomado = new Set<string>();
  const anotar = (indice: number, f: FilaParaEmparejar, unidades: number) => {
    const previo = delPlan.find((x) => x.indice === indice && x.filaId === f.id);
    if (previo) previo.unidades += unidades;
    else delPlan.push({ indice, filaId: f.id, planId: f.planId, unidades, enNota: !!f.invoiceId });
  };
  cosas.forEach((c, indice) => {
    let resta = Math.max(1, Math.round(Number(c.cantidad ?? 1) || 1));
    const candidatas = tomables
      .map((f, orden) => ({ f, orden, cerca: cercaniaDeDiente(c, f) }))
      .filter((x) => x.cerca > 0 && mismoProcedimiento(c, x.f))
      .sort((a, b) => b.cerca - a.cerca || Number(!!b.f.invoiceId) - Number(!!a.f.invoiceId) || a.orden - b.orden);
    for (const { f, cerca } of candidatas) {
      if (resta <= 0) break;
      if (cerca === 2) {
        const llave = `${f.id}:${c.diente}`;
        if (dienteTomado.has(llave) || (capacidad.get(f.id) ?? 0) > 0) {
          if (!dienteTomado.has(llave)) capacidad.set(f.id, (capacidad.get(f.id) ?? 0) - 1);
          dienteTomado.add(llave);
          anotar(indice, f, resta);
          resta = 0;
        }
        continue;
      }
      const libre = capacidad.get(f.id) ?? 0;
      if (libre <= 0) continue;
      const toma = Math.min(libre, resta);
      capacidad.set(f.id, libre - toma);
      resta -= toma;
      anotar(indice, f, toma);
    }
    fuera.push(resta);
  });
  return { delPlan, fuera };
}

/**
 * Lo que queda para la factura suelta: cada cosa con sus unidades fuera de plan; las que quedan en 0
 * se van. Conserva el orden y el resto de campos de cada cosa.
 */
export function soloLoDeFuera<T extends CosaCobrable>(cosas: T[], e: Emparejamiento): T[] {
  return cosas
    .map((c, i) => ({ c, n: e.fuera[i] ?? Math.max(1, Math.round(Number(c.cantidad ?? 1) || 1)) }))
    .filter((x) => x.n > 0)
    .map((x) => (x.c.cantidad != null || x.n !== 1 ? { ...x.c, cantidad: x.n } : x.c));
}

/** Los nombres (únicos, en orden) de lo que se apartó por ser del plan: para avisarlo en pantalla. */
export function nombresApartados(cosas: CosaCobrable[], e: Emparejamiento): string[] {
  const vistos: string[] = [];
  for (const m of e.delPlan) {
    const n = cosas[m.indice]?.nombre?.trim();
    if (n && vistos.indexOf(n) === -1) vistos.push(n);
  }
  return vistos;
}

// ── «Cobrar hoy» con plan ─────────────────────────────────────────────────

/** Lo que la hoja sabe de cada plan del paciente (GET /api/treatments/cuentas). */
export interface PlanConCuenta {
  planId: string;
  nombre: string;
  /** Estado del plan (ACTIVE, PAUSED, COMPLETED). */
  estado: string;
  /** El plan tiene filas (plan nuevo). Uno de texto se cobra como siempre: la hoja no lo toma. */
  conFilas: boolean;
  /** La cuenta del plan (`CuentaDelPlan` de cobro.ts). */
  total: number;
  facturado: number;
  pagado: number;
  soloDelPlan: boolean;
  /** Lo que deben sus notas vivas. */
  saldo: number;
  /** Lo del plan que aún no está en ninguna nota (plan sin aceptar, o filas nuevas). */
  porFacturar: number;
  notas: Array<{ invoiceId: string; invoiceNumber: string; status: string; total: number; paid: number; createdAt: string }>;
  /** Filas vivas (para reconocer lo que la hoja va a cobrar). */
  filas: FilaParaEmparejar[];
}

export type ModoCobroHoy = "abono" | "nota_del_plan" | "nota_nueva";

/**
 * Con qué empieza la hoja. Con un plan que debe algo: ABONO a su nota (lo de hoy no es una factura
 * nueva). Con un plan sin nota pero con algo por facturar: crear la nota del plan y abonar. Sin
 * planes: la nota nueva de siempre.
 */
export function modoInicialCobroHoy(planes: PlanConCuenta[]): { modo: ModoCobroHoy; planId: string | null } {
  const nuevos = planes.filter((p) => p.conFilas);
  const conSaldo = nuevos.find((p) => p.saldo > 0.005);
  if (conSaldo) return { modo: "abono", planId: conSaldo.planId };
  // Un plan cancelado no estrena nota: solo se abona la que ya tenía.
  const porFacturar = nuevos.find((p) => p.porFacturar > 0.005 && p.notas.length === 0 && p.estado !== "ABANDONED");
  if (porFacturar) return { modo: "nota_del_plan", planId: porFacturar.planId };
  return { modo: "nota_nueva", planId: null };
}

/**
 * Conceptos de una nota NUEVA que ya están en un plan con nota: cobrarlos aparte sería el doble cobro
 * de siempre. La hoja los enseña y pide confirmar que es OTRO procedimiento.
 */
export function conceptosQueYaSonDelPlan(conceptos: CosaCobrable[], planes: PlanConCuenta[], ahora: Date = new Date()): Array<{ indice: number; plan: string }> {
  const filas = planes.flatMap((p) => p.filas);
  const nombreDe = new Map(planes.map((p) => [p.planId, p.nombre] as const));
  const e = emparejarConElPlan(conceptos, filas, ahora);
  const vistos = new Set<number>();
  const out: Array<{ indice: number; plan: string }> = [];
  for (const m of e.delPlan) {
    if (vistos.has(m.indice)) continue;
    vistos.add(m.indice);
    out.push({ indice: m.indice, plan: nombreDe.get(m.planId) ?? "" });
  }
  return out;
}
