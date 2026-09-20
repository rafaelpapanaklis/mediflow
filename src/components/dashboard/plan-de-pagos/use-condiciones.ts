"use client";

// Las condiciones de pago de UNA factura, para quien no las trae ya (Registrar
// pago y el detalle de factura). Es la misma ruta de solo lectura que usa la
// ficha (GET /api/invoices/condiciones), que ya filtra por clínica y por
// visibilidad de paciente, y que sin la tabla `invoice_payment_terms` contesta
// «ninguna»: entonces aquí no hay plan y no se pinta nada.

import { useEffect, useState } from "react";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";

export function useCondicionesDeFactura(invoiceId: string | null | undefined, activo = true): CondicionesPago | null {
  const [condiciones, setCondiciones] = useState<CondicionesPago | null>(null);
  useEffect(() => {
    setCondiciones(null);
    if (!activo || !invoiceId) return;
    const ctrl = new AbortController();
    fetch(`/api/invoices/condiciones?ids=${encodeURIComponent(invoiceId)}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { setCondiciones(data?.condiciones?.[invoiceId] ?? null); })
      .catch(() => { /* sin dato no hay bloque: el cobro sigue exactamente igual */ });
    return () => ctrl.abort();
  }, [invoiceId, activo]);
  return condiciones;
}
