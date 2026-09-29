// ws1-t4 — decisión de Rafael (29-sep-2026): una factura CON pagos SÍ se
// puede editar (conceptos, precios, descuentos), con límites. Puro: lo usan
// PATCH /api/invoices/:id (que además repite la regla EN EL MISMO UPDATE) y
// el editor de la pantalla, para decir lo mismo antes de mandar.
//
//  (a) Nunca si está timbrada (CFDI vigente) o cancelada.
//  (b) El nuevo total nunca por debajo de lo ya pagado. `Invoice.paid` YA
//      incluye el saldo a favor aplicado: entra como un Payment de método
//      «anticipo» (patient-credit-aplicar.ts) y los reembolsos lo restan.
//  (c) Con plan a plazos, cambiar el total RECALCULA las mensualidades (el
//      calendario se deriva del total: enganche fijo + resto en N cuotas). Eso
//      no pasa en silencio: sin `planAvisado` el servidor contesta 409 con el
//      aviso, y el editor lo enseña antes de guardar.
//  (d) El rastro (quién, cuándo, antes/después) lo deja la ruta con
//      `logMutation` + `patientId`/`texto` (movimientos del paciente, ws1-t12).

import { calendarioDeCuotas, cuadreDelPlan, esPlanAPlazos, type DescuadrePlan } from "./plan-de-pagos";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";

const CENTAVO = 0.005;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const CODIGO_PLAN_SE_RECALCULA = "PLAN_SE_RECALCULA";

export interface FacturaAEditar {
  status: string;
  paid: number;
  total: number;
  cfdiUuid?: string | null;
}

/** ¿La factura admite editar sus conceptos? (a) — sin mirar el total nuevo. */
export function motivoParaNoEditar(f: FacturaAEditar): string | null {
  if (f.status === "CANCELLED") return "Esta factura está cancelada: no se edita.";
  if (f.cfdiUuid) return "Esta factura ya está timbrada (CFDI): no se edita. Para corregirla, cancela el CFDI y emite otra.";
  return null;
}

export interface AvisoDePlan {
  /** Hay plan a plazos y el total cambia: las mensualidades se recalculan. */
  cambia: boolean;
  enganche: number;
  numPagos: number;
  /** Importe típico de cada mensualidad antes y después (sin el enganche). */
  cuotaAntes: number | null;
  cuotaDespues: number | null;
  /** Con el total nuevo, el plan acordado ya no cabe (ver `cuadreDelPlan`). */
  descuadre: DescuadrePlan | null;
  texto: string;
}

function cuotaTipica(c: CondicionesPago, total: number): number | null {
  const cuotas = calendarioDeCuotas(c, total).filter((q) => !q.esEnganche);
  if (cuotas.length === 0) return null;
  return Math.min(...cuotas.map((q) => q.importe));
}

const fmt = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

const TEXTO_DESCUADRE: Record<DescuadrePlan, string> = {
  engancheCubreTodo: "el enganche acordado ya cubre todo el total nuevo",
  menosCuotasQueLasAcordadas: "el total nuevo no da para todas las mensualidades acordadas",
  noSumaElTotal: "las cuotas no suman el total nuevo",
};

/** (c) Qué le pasa al plan a plazos si el total cambia. `null` = no hay nada que avisar. */
export function avisoDePlan(c: CondicionesPago | null | undefined, totalAntes: number, totalDespues: number): AvisoDePlan | null {
  if (!esPlanAPlazos(c)) return null;
  if (Math.abs(r2(totalDespues) - r2(totalAntes)) < CENTAVO) return null;
  const cuotaAntes = cuotaTipica(c, totalAntes);
  const cuotaDespues = cuotaTipica(c, totalDespues);
  const cuadre = cuadreDelPlan(c, totalDespues);
  const enganche = r2(Math.max(0, Number(c.enganche) || 0));
  const partes = [
    `Esta factura es a plazos${enganche > 0 ? ` (enganche de ${fmt(enganche)}` : " ("}${enganche > 0 ? " + " : ""}${c.numPagos} pagos).`,
    cuotaAntes != null && cuotaDespues != null
      ? `Al cambiar el total de ${fmt(totalAntes)} a ${fmt(totalDespues)}, cada mensualidad se recalcula: de ${fmt(cuotaAntes)} a ${fmt(cuotaDespues)}${enganche > 0 ? "; el enganche no cambia" : ""}.`
      : `Al cambiar el total de ${fmt(totalAntes)} a ${fmt(totalDespues)}, las mensualidades se recalculan.`,
    !cuadre.cuadra && cuadre.motivo
      ? `Ojo: ${TEXTO_DESCUADRE[cuadre.motivo]}; ajusta la forma de pago de la factura después de guardar.`
      : null,
  ].filter(Boolean);
  return {
    cambia: true,
    enganche,
    numPagos: c.numPagos,
    cuotaAntes,
    cuotaDespues,
    descuadre: cuadre.cuadra ? null : cuadre.motivo,
    texto: partes.join(" "),
  };
}

export type DecisionDeEdicion =
  | { ok: false; httpStatus: 400 | 409; codigo: string; error: string }
  | { ok: true; status: string; balance: number; reabre: boolean; liquida: boolean };

/**
 * La regla completa para guardar un total nuevo. La ruta la corre con la
 * factura leída y, además, la repite en el WHERE del UPDATE (cfdiUuid null,
 * no cancelada, `paid ≤ total nuevo`, mismo status y mismo paid que se leyó).
 */
export function decidirEdicion(p: {
  factura: FacturaAEditar;
  totalNuevo: number;
  condiciones: CondicionesPago | null | undefined;
  planAvisado: boolean;
}): DecisionDeEdicion {
  const no = motivoParaNoEditar(p.factura);
  if (no) return { ok: false, httpStatus: 400, codigo: p.factura.cfdiUuid ? "CFDI_VIGENTE" : "CANCELADA", error: no };
  const pagado = r2(Math.max(0, p.factura.paid || 0));
  const total = r2(p.totalNuevo);
  if (!(total >= 0) || !Number.isFinite(total)) return { ok: false, httpStatus: 400, codigo: "TOTAL_INVALIDO", error: "Total inválido." };
  if (total + CENTAVO < pagado) {
    return {
      ok: false,
      httpStatus: 400,
      codigo: "TOTAL_BAJO_LO_PAGADO",
      error: `El nuevo total (${fmt(total)}) no puede quedar por debajo de lo ya pagado (${fmt(pagado)}, incluido el saldo a favor aplicado). Si hay que devolver dinero, usa «Reembolsar».`,
    };
  }
  const aviso = avisoDePlan(p.condiciones, p.factura.total, total);
  if (aviso && !p.planAvisado) {
    return { ok: false, httpStatus: 409, codigo: CODIGO_PLAN_SE_RECALCULA, error: aviso.texto };
  }
  const balance = r2(Math.max(0, total - pagado));
  return { ok: true, ...estadoTrasEditar(p.factura.status, pagado, balance) };
}

/**
 * El estado tras cambiar el total. Un borrador sigue borrador. Si ya no queda
 * saldo, PAGADA. Una PAGADA a la que se le sube el total se REABRE (parcial si
 * tenía pagos). Lo demás conserva su estado.
 */
export function estadoTrasEditar(status: string, pagado: number, balance: number): { status: string; balance: number; reabre: boolean; liquida: boolean } {
  if (status === "DRAFT") return { status, balance, reabre: false, liquida: false };
  if (balance < CENTAVO) return { status: "PAID", balance: 0, reabre: false, liquida: status !== "PAID" };
  if (status === "PAID") return { status: pagado > 0 ? "PARTIAL" : "PENDING", balance, reabre: true, liquida: false };
  return { status, balance, reabre: false, liquida: false };
}
