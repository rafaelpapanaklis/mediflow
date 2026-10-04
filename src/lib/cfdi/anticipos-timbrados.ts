// Un mismo ingreso NUNCA en dos CFDI (segunda auditoría de uso, N-22). PURO.
//
// El saldo a favor es un libro (patient_credits): filas POSITIVAS dicen de dónde entró cada peso
// (cita cancelada, excedente de un cobro, anticipo por Mercado Pago, devolución de una aplicación…)
// y filas NEGATIVAS («aplicado_a_factura») dicen a qué nota se aplicó, con el Payment «anticipo».
// El libro no dice qué peso se gastó: se asume el más viejo primero (FIFO), igual para todos.
//
// Con eso se sabe, para cada aplicación, de qué entradas salió. Si la nota donde se aplicó tiene su
// CFDI (o ese abono tiene el suyo), ese ingreso ya está ante el SAT ahí: el reporte de la global
// lo saca del mes en que entró. Y al timbrar una nota con saldo a favor, se sabe en qué mes entró
// ese dinero para pedir la confirmación de la global (C-49) con esa fecha, no con la de hoy.

export interface EntradaSaldo {
  id: string;
  fecha: Date;
  monto: number;
  fuente: string;
  invoiceId: string | null;
  paymentId: string | null;
}

export interface AplicacionSaldo {
  id: string;
  fecha: Date;
  /** Positivo: cuánto se aplicó. */
  monto: number;
  /** El Payment «anticipo» de la nota destino. */
  paymentId: string | null;
}

export interface Tramo {
  entradaId: string;
  aplicacionPaymentId: string | null;
  monto: number;
}

const c = (x: number) => Math.round((Number(x) || 0) * 100);

/** Reparte cada aplicación sobre las entradas, la más vieja primero. */
export function asignarFifo(entradas: readonly EntradaSaldo[], aplicaciones: readonly AplicacionSaldo[]): Tramo[] {
  const fila = [...entradas].filter((e) => c(e.monto) > 0)
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.id.localeCompare(b.id))
    .map((e) => ({ e, resta: c(e.monto) }));
  const apps = [...aplicaciones].filter((a) => c(a.monto) > 0)
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.id.localeCompare(b.id));
  const tramos: Tramo[] = [];
  for (const a of apps) {
    let falta = c(a.monto);
    for (const x of fila) {
      if (falta <= 0) break;
      // Solo lo que ya había entrado cuando se aplicó.
      if (x.resta <= 0 || x.e.fecha.getTime() > a.fecha.getTime()) continue;
      const t = Math.min(falta, x.resta);
      tramos.push({ entradaId: x.e.id, aplicacionPaymentId: a.paymentId, monto: t / 100 });
      x.resta -= t;
      falta -= t;
    }
  }
  return tramos;
}
