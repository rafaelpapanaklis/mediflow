// «Cerrar plan» (plan abandonado) — decisión de Rafael, 26-oct-2026. PURO: qué le pasa a cada nota.
//
// La nota del plan se queda en lo HECHO: sus líneas por hacer (filas pendientes o en curso) salen de
// la nota y esas filas se CANCELAN (nada se borra de la base: la fila queda con quién y cuándo, y la
// bitácora guarda las líneas quitadas y el motivo). Si lo pagado pasa de lo hecho, lo de más queda
// como SALDO A FAVOR del paciente (crédito que se aplica a otro plan o cobro futuro con el mecanismo
// de siempre); la devolución en efectivo solo si recepción la registra a mano.
//
// El ejecutor (`cerrar-plan.server.ts`) solo escribe lo que aquí se decide.

import { computeInvoiceTotal, itemDiscount, round2, spreadInvoiceDiscount, sumInvoiceItems } from "@/lib/invoice-totals";
import { deudaDeNotaDelPlan, type FilaParaDeuda, type NotaParaDeuda } from "./por-cobrar";

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
  /**
   * true = el descuento global no cuadraba al centavo y pasó a las líneas que se quedan (cada una con su
   * parte). Casi nunca: solo con IVA aparte y un redondeo de 1¢. La bitácora lo dice.
   */
  descuentoALasLineas: boolean;
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
 * Lo que se queda conserva EXACTAMENTE su parte del descuento de la nota (la que le tocó con el
 * reparto del timbrado, `spreadInvoiceDiscount`), y el total nuevo es el «Hecho» que la ficha
 * prometió al confirmar, al centavo (revisión t5, A6: con el reparto proporcional quedaba a ±1¢ y
 * una nota pagada justo quedaba PARCIAL por $0.01 o con $0.01 a favor).
 */
export function ajustarNotaAlCerrar(nota: NotaParaDeuda, filas: ReadonlyMap<string, FilaParaDeuda>): AjusteDeNota | null {
  const d = deudaDeNotaDelPlan(nota, filas, null);
  const salen = d.lineas.filter((l) => l.porHacer);
  if (salen.length === 0) return null;
  const items = Array.isArray(nota.items) ? (nota.items as unknown[]) : [];
  const sale = new Set(salen.map((l) => l.indice));
  const quedan = items.filter((_, i) => !sale.has(i));

  const parteDelDescuento = spreadInvoiceDiscount(items, round2(Math.max(0, Number(nota.discount) || 0)));
  // La nota guardada tiene que recalcularse EXACTAMENTE a su total (el editor y el timbrado recalculan;
  // revisión t5, sospecha 1), y el PDF y el detalle deben seguir enseñando el descuento GLOBAL como
  // estaba (sospecha de la v4). Primero: descuento global = la suma de las partes que les tocaban a las
  // líneas que se quedan. Si así la nota recalculada da lo «Hecho» al centavo (siempre con IVA incluido
  // o sin IVA; casi siempre con IVA aparte), se queda así. Si no —el IVA redondeado por línea se movió
  // 1¢ al repartir de nuevo—, cada línea que se queda lleva su parte como descuento propio y el global
  // queda en 0 (`descuentoALasLineas`), que sí cuadra siempre.
  const total = quedan.length ? d.hecho : 0;
  const globalQueSeQueda = round2(Math.min(sumInvoiceItems(quedan), items.reduce<number>((s, _, i) => (sale.has(i) ? s : s + (parteDelDescuento[i] ?? 0)), 0)));
  const cuadraConGlobal = !quedan.length
    || Math.abs(round2(computeInvoiceTotal(quedan, globalQueSeQueda, nota.taxRate, nota.taxIncluded).total) - total) < 0.005;
  const quedanFinal = cuadraConGlobal
    ? quedan
    : items
        .map((it, i) => ({ it, i }))
        .filter(({ i }) => !sale.has(i))
        .map(({ it, i }) => {
          const parte = parteDelDescuento[i] ?? 0;
          return parte > 0 ? { ...(it as object), discount: round2(itemDiscount(it) + parte) } : it;
        });
  const subtotalFinal = sumInvoiceItems(quedanFinal);
  const discount = cuadraConGlobal ? globalQueSeQueda : 0;
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
    items: quedanFinal,
    quitadas: salen.map((l) => ({ indice: l.indice, nombre: nombreDe(items[l.indice]), importe: l.importe, filaId: l.filaId })),
    subtotal: subtotalFinal,
    discount,
    descuentoALasLineas: !cuadraConGlobal && globalQueSeQueda > 0,
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
