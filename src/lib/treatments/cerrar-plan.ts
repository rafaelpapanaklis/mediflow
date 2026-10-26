// «Cerrar plan» (plan abandonado) — decisión de Rafael, 26-oct-2026. PURO: qué le pasa a cada nota.
//
// La nota del plan se queda en lo HECHO: sus líneas por hacer (filas pendientes o en curso) salen de
// la nota y esas filas se CANCELAN (nada se borra de la base: la fila queda con quién y cuándo, y la
// bitácora guarda las líneas quitadas y el motivo). Si lo pagado pasa de lo hecho, lo de más queda
// como SALDO A FAVOR del paciente (crédito que se aplica a otro plan o cobro futuro con el mecanismo
// de siempre); la devolución en efectivo solo si recepción la registra a mano.
//
// El ejecutor (`cerrar-plan.server.ts`) solo escribe lo que aquí se decide.

import { round2, sumInvoiceItems } from "@/lib/invoice-totals";
import { deudaDeNotaDelPlan, totalDeLineas, type FilaParaDeuda, type NotaParaDeuda } from "./por-cobrar";

export const MAX_MOTIVO_CIERRE = 300;

/** El motivo es obligatorio (va a la bitácora). Devuelve el texto limpio o null si no sirve. */
export function motivoDeCierre(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const limpio = x.replace(/\s+/g, " ").trim();
  if (limpio.length < 3) return null;
  return limpio.slice(0, MAX_MOTIVO_CIERRE);
}

export interface AjusteDeNota {
  /** Líneas que se quedan (lo hecho y los cargos sin fila), ya en su orden. */
  items: unknown[];
  /** Las que salen, para la bitácora. */
  quitadas: Array<{ indice: number; nombre: string; importe: number; filaId: string | null }>;
  subtotal: number;
  discount: number;
  total: number;
  /** Lo pagado que pasa a saldo a favor (lo pagado de más sobre el nuevo total). */
  aFavor: number;
  paid: number;
  balance: number;
  /** null = sin cambio. Sin nada hecho la nota se CANCELA (su dinero, si lo hay, ya pasó a favor). */
  status: "PENDING" | "PARTIAL" | "PAID" | "CANCELLED";
  /** fila → su nueva posición en la nota (las que se quedan). */
  lineaNueva: Map<string, number>;
}

const nombreDe = (it: any) => String(it?.name ?? it?.description ?? "Concepto");

/**
 * Cómo queda una nota del plan al cerrarlo. null = no hay nada por hacer en ella (no cambia).
 * El descuento de la nota se reparte en proporción: lo que se queda conserva su parte.
 */
export function ajustarNotaAlCerrar(nota: NotaParaDeuda, filas: ReadonlyMap<string, FilaParaDeuda>): AjusteDeNota | null {
  const d = deudaDeNotaDelPlan(nota, filas, null);
  const salen = d.lineas.filter((l) => l.porHacer);
  if (salen.length === 0) return null;
  const items = Array.isArray(nota.items) ? (nota.items as unknown[]) : [];
  const sale = new Set(salen.map((l) => l.indice));
  const quedan = items.filter((_, i) => !sale.has(i));

  const subtotalAntes = sumInvoiceItems(items);
  const subtotal = sumInvoiceItems(quedan);
  const descuentoAntes = round2(Math.max(0, Number(nota.discount) || 0));
  const discount = subtotalAntes > 0 ? round2(Math.min(subtotal, (descuentoAntes * subtotal) / subtotalAntes)) : 0;
  const total = quedan.length ? round2(totalDeLineas(quedan, discount, nota.taxRate, nota.taxIncluded)) : 0;
  const pagado = round2(Math.max(0, Number(nota.paid) || 0));
  const aFavor = round2(Math.max(0, pagado - total));
  const paid = round2(pagado - aFavor);
  const balance = round2(Math.max(0, total - paid));
  const status: AjusteDeNota["status"] = quedan.length === 0 ? "CANCELLED" : balance <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING";

  const lineaNueva = new Map<string, number>();
  let n = 0;
  d.lineas.forEach((l) => {
    if (sale.has(l.indice)) return;
    if (l.filaId) lineaNueva.set(l.filaId, n);
    n++;
  });

  return {
    items: quedan,
    quitadas: salen.map((l) => ({ indice: l.indice, nombre: nombreDe(items[l.indice]), importe: l.importe, filaId: l.filaId })),
    subtotal,
    discount,
    total,
    aFavor,
    paid,
    balance,
    status,
    lineaNueva,
  };
}

export interface PagoDeLaNota {
  id: string;
  amount: number;
  method: string;
  paidAt: Date;
}

/**
 * De dónde sale lo que pasa a favor, para que cada peso diga de qué cobro vino (el CFDI de cada abono
 * ya lo ampara: así no se vuelve a declarar al usarlo en otra nota). Primero vuelve el saldo a favor
 * que se había APLICADO a la nota (`anticipo`, se devuelve a su aplicación); luego los cobros de
 * dinero, del más nuevo al más viejo.
 */
export function origenDelSaldoAFavor(
  aFavor: number,
  anticipoNeto: number,
  pagos: PagoDeLaNota[],
): { deAnticipo: number; deCobros: Array<{ paymentId: string | null; monto: number }> } {
  let resto = round2(Math.max(0, aFavor));
  const deAnticipo = round2(Math.min(resto, Math.max(0, anticipoNeto)));
  resto = round2(resto - deAnticipo);
  const deCobros: Array<{ paymentId: string | null; monto: number }> = [];
  const cobros = pagos
    .filter((p) => p.method !== "refund" && p.method !== "anticipo" && (Number(p.amount) || 0) > 0)
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
  for (const p of cobros) {
    if (resto <= 0) break;
    const monto = round2(Math.min(resto, Number(p.amount) || 0));
    deCobros.push({ paymentId: p.id, monto });
    resto = round2(resto - monto);
  }
  if (resto > 0) deCobros.push({ paymentId: null, monto: resto });
  return { deAnticipo, deCobros };
}
