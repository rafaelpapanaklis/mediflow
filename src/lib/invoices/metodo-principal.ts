// «Método» del detalle de la factura (auditoría de uso C-32, 4-oct-2026).
// `Invoice.paymentMethod` es el ÚLTIMO método usado: una factura de $3,500 por
// transferencia y un abono de $100 en efectivo decía «Efectivo». Aquí sale el
// método por el que entró la MAYOR parte del dinero. Puro (pantalla y pruebas).

type Pago = { method?: string | null; amount?: number | null; refundMethod?: string | null };

const c = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** El método con más dinero cobrado (sin reembolsos). Sin cobros, `porDefecto`. */
export function metodoPrincipal(pagos: readonly Pago[] | null | undefined, porDefecto: string | null = null): string | null {
  const suma = new Map<string, number>();
  for (const p of pagos ?? []) {
    const m = String(p?.method ?? "");
    if (!m || m === "refund") continue;
    suma.set(m, (suma.get(m) ?? 0) + c(p.amount));
  }
  let mejor: string | null = null;
  let max = 0;
  for (const [m, v] of Array.from(suma)) if (v > max) { max = v; mejor = m; }
  return mejor ?? porDefecto;
}

/** Lo reembolsado de una factura: lo que SALIÓ al paciente y lo que pasó a su saldo a favor. */
export function reembolsadoDeFactura(pagos: readonly Pago[] | null | undefined): { devuelto: number; aSaldoAFavor: number } {
  let devuelto = 0;
  let aSaldo = 0;
  for (const p of pagos ?? []) {
    if (p?.method !== "refund") continue;
    if (p.refundMethod === "saldo_a_favor") aSaldo += c(p.amount);
    else devuelto += c(p.amount);
  }
  return { devuelto: devuelto / 100, aSaldoAFavor: aSaldo / 100 };
}
