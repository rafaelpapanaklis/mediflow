// «Por cobrar» de la NOTA DEL PLAN = lo HECHO menos lo PAGADO (decisión de Rafael, 26-oct-2026).
//
// La nota del plan nace al ACEPTAR con todo lo aceptado (`cobro.ts`), pero eso no es deuda: el
// paciente debe lo que ya se le hizo. Así lo cuentan Open Dental, Dentally, Dentrix, Dentalink y
// Doctocliq. Este archivo es PURO: lo usan Caja/Finanzas (`computeReceivables`, src/lib/caja.ts),
// la cuenta del plan en la ficha (`leerCuentaDelPlan`) y «Cerrar plan».
//
// Por cada línea de la nota (`invoices.items`):
//  · POR HACER — la línea viene de una fila del plan (`planItemId`) que sigue pendiente o en curso;
//  · HECHA     — todo lo demás: la fila está hecha, o la línea no tiene fila (un concepto del
//                presupuesto sin fila, un cargo extra que recepción agregó a la nota). Ante la duda,
//                cuenta como hoy: deuda.
//
// Con lo pagado de la nota:
//  · DEBE           = max(0, hecho − pagado);
//  · SALDO A FAVOR  = max(0, pagado − hecho)  (pagó por adelantado: sigue en la nota, no se mueve);
//  · POR HACER SIN PAGAR = saldo de la nota − debe. Así «Por cobrar» de antes = «Por cobrar» de
//    ahora + «Por hacer (aceptado)»: ningún peso desaparece de las cifras, solo cambia de renglón.
//  · VENCIDO: lo hecho y no pagado, a los `DIAS_PARA_VENCER` días de hecho. Lo pagado cubre primero
//    lo que se hizo antes (el abono más viejo paga el trabajo más viejo).

import { computeInvoiceTotal, invoiceLineBases, round2 } from "@/lib/invoice-totals";
import type { EstadoDeFila } from "./items";

/** Lo hecho y no pagado cuenta como VENCIDO a los 30 días de hecho (decisión de Rafael, 26-oct). */
export const DIAS_PARA_VENCER = 30;

const DIA_MS = 86_400_000;

/** Lo que se necesita de una fila para saber si su línea ya es deuda. */
export interface FilaParaDeuda {
  id: string;
  estado: EstadoDeFila;
  hechoEn: Date | null;
  /** Para reconocer la línea si el editor de facturas le quitó `planItemId`. */
  nombre?: string;
  invoiceId?: string | null;
  invoiceLinea?: number | null;
}

/** La nota del plan tal como está guardada. */
export interface NotaParaDeuda {
  id: string;
  total: number;
  /** Lo pagado neto (los reembolsos ya lo bajaron). */
  paid: number;
  createdAt: Date;
  items: unknown;
  discount: number;
  taxRate: number | null;
  taxIncluded: boolean;
}

export interface LineaClasificada {
  indice: number;
  /** Lo que suma la línea en el total de la nota (con su parte del descuento y su IVA). */
  importe: number;
  porHacer: boolean;
  filaId: string | null;
  /** Desde cuándo es deuda: el día que se hizo (o el día de la nota si no tiene fila). */
  desde: Date;
}

export interface DeudaDeNota {
  /** Total de la nota = lo aceptado que está en ella. */
  aceptado: number;
  hecho: number;
  porHacer: number;
  pagado: number;
  debe: number;
  saldoAFavor: number;
  /** De lo que falta pagar de la nota, la parte que aún no se hace (no es deuda todavía). */
  porHacerSinPagar: number;
  vencido: number;
  lineas: LineaClasificada[];
}

const esPorHacer = (estado: EstadoDeFila) => estado === "pendiente" || estado === "en_curso";

const normalizar = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Lo que suma cada línea dentro del total: su base (con su descuento y su parte del descuento de la
 * nota, igual que el timbrado) más su IVA si va aparte. La suma es el total de la nota.
 */
export function importesPorLinea(items: unknown[], discount: number, taxRate: number | null, taxIncluded: boolean): number[] {
  const bases = invoiceLineBases(items, discount);
  const rate = Number(taxRate) > 0 ? Number(taxRate) : 0;
  return bases.map((b) => round2(Math.max(0, b) + (taxIncluded || rate === 0 ? 0 : round2(b * (rate / 100)))));
}

/** La fila de una línea: por `planItemId`; si el editor se lo quitó, por su posición y su nombre. */
function filaDeLinea(item: any, indice: number, notaId: string, filas: ReadonlyMap<string, FilaParaDeuda>, porLinea: ReadonlyMap<number, FilaParaDeuda>): FilaParaDeuda | null {
  const id = typeof item?.planItemId === "string" ? item.planItemId : null;
  if (id) return filas.get(id) ?? null;
  const f = porLinea.get(indice);
  if (!f || f.invoiceId !== notaId || !f.nombre) return null;
  // La nota escribe «Resina (16)»: el nombre de la fila, con o sin sus dientes.
  const linea = normalizar(item?.name ?? item?.description);
  const nombre = normalizar(f.nombre);
  return linea === nombre || linea.startsWith(`${nombre} (`) ? f : null;
}

/**
 * La deuda de UNA nota del plan. `corteVencido`: lo hecho ANTES de este instante ya venció
 * (`corteDeVencido`). `filas`: las del plan, por id (las canceladas también: una fila cancelada que
 * sigue en la nota cuenta como hecha, porque la nota la sigue cobrando).
 */
export function deudaDeNotaDelPlan(nota: NotaParaDeuda, filas: ReadonlyMap<string, FilaParaDeuda>, corteVencido: Date | null): DeudaDeNota {
  const total = round2(Math.max(0, Number(nota.total) || 0));
  const pagado = round2(Math.max(0, Number(nota.paid) || 0));
  const items = Array.isArray(nota.items) ? (nota.items as unknown[]) : [];
  const porLinea = new Map<number, FilaParaDeuda>();
  for (const f of Array.from(filas.values())) if (f.invoiceId === nota.id && typeof f.invoiceLinea === "number") porLinea.set(f.invoiceLinea, f);

  const importes = importesPorLinea(items, nota.discount, nota.taxRate, nota.taxIncluded);
  const lineas: LineaClasificada[] = items.map((it, i) => {
    const fila = filaDeLinea(it, i, nota.id, filas, porLinea);
    const porHacer = !!fila && esPorHacer(fila.estado);
    const desde = fila && fila.estado === "hecho" && fila.hechoEn ? fila.hechoEn : nota.createdAt;
    return { indice: i, importe: importes[i] ?? 0, porHacer, filaId: fila?.id ?? null, desde };
  });

  // El total guardado manda (una nota vieja pudo redondear distinto): lo por hacer sale de sus
  // líneas y lo hecho es el resto, sin pasar del total.
  const porHacer = round2(Math.min(total, lineas.filter((l) => l.porHacer).reduce((s, l) => s + l.importe, 0)));
  const hecho = round2(total - porHacer);
  const debe = round2(Math.max(0, hecho - pagado));
  const saldoAFavor = round2(Math.max(0, pagado - hecho));
  const saldoNota = round2(Math.max(0, total - pagado));
  const porHacerSinPagar = round2(Math.max(0, saldoNota - debe));

  let vencido = 0;
  if (debe > 0 && corteVencido) {
    // Lo pagado cubre primero lo que se hizo antes. Lo que queda sin cubrir y se hizo antes del
    // corte, venció. La diferencia de redondeo entre líneas y total va a la línea más nueva.
    const hechas = lineas.filter((l) => !l.porHacer).sort((a, b) => a.desde.getTime() - b.desde.getTime() || a.indice - b.indice);
    const sumaLineas = round2(hechas.reduce((s, l) => s + l.importe, 0));
    let resto = pagado;
    hechas.forEach((l, i) => {
      const importe = i === hechas.length - 1 ? round2(l.importe + (hecho - sumaLineas)) : l.importe;
      const cubre = Math.min(resto, Math.max(0, importe));
      resto = round2(resto - cubre);
      const falta = round2(importe - cubre);
      if (falta > 0 && l.desde.getTime() < corteVencido.getTime()) vencido = round2(vencido + falta);
    });
    // Una nota sin líneas legibles (vieja, o editada a mano) vence entera desde que nació.
    if (hechas.length === 0 && nota.createdAt.getTime() < corteVencido.getTime()) vencido = debe;
    vencido = round2(Math.min(vencido, debe));
  }

  return { aceptado: total, hecho, porHacer, pagado, debe, saldoAFavor, porHacerSinPagar, vencido, lineas };
}

/** Lo hecho antes de este instante ya venció: el inicio de HOY (zona de la clínica) menos 30 días. */
export function corteDeVencido(inicioDeHoy: Date, dias: number = DIAS_PARA_VENCER): Date {
  return new Date(inicioDeHoy.getTime() - dias * DIA_MS);
}

/** Total de una lista de líneas como lo calcula la nota (para rearmarla al cerrar el plan). */
export function totalDeLineas(items: unknown[], discount: number, taxRate: number | null, taxIncluded: boolean): number {
  return computeInvoiceTotal(items, discount, taxRate, taxIncluded).total;
}
