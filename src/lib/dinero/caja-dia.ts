// El importe del encabezado de cada día en la tabla de Caja (QA de Rafael,
// 5-oct-2026, #6). Puro, client-safe.
//
// Antes sumaba solo los cobros («8 movimientos · $3,300.00») mientras «Cobrado
// hoy» y el corte restaban los reembolsos. Ahora, el mismo criterio que ellos:
//   · cobro → suma;
//   · reembolso REAL (salió dinero) → resta;
//   · traspaso a saldo a favor (refund «saldo_a_favor») y saldo a favor
//     aplicado (anticipo) → no son dinero que entró ni que salió: 0.
// En centavos.
export interface FilaDelDia {
  method: string;
  amount: number;
  refundMethod?: string | null;
}

export function netoDelDia(filas: ReadonlyArray<FilaDelDia>): number {
  let c = 0;
  for (const f of filas) {
    const monto = Math.round((Number(f.amount) || 0) * 100);
    if (f.method === "refund") {
      if (f.refundMethod === "saldo_a_favor") continue;
      c -= monto;
    } else if (f.method !== "anticipo") {
      c += monto;
    }
  }
  return c / 100;
}
