"use client";

// El CFDI (vigente o apartado) de cada pago de una factura, en una sola
// consulta (ws1-t1, sep-2026). Mismo espíritu que `use-condiciones.ts`: sin
// sql/cfdi-pagos-a-plazos.sql aplicado, el GET contesta `{ items: {} }` y
// aquí no se pinta ninguna insignia — el detalle de factura sigue igual.

import { useCallback, useEffect, useState } from "react";

export interface CfdiDePago {
  uuid: string;
  status: string;
  total: number;
  xmlUrl: string | null;
  pdfUrl: string | null;
}

export function usePagosConCfdi(invoiceId: string | null | undefined, activo = true) {
  const [mapa, setMapa] = useState<Record<string, CfdiDePago>>({});

  const recargar = useCallback(() => {
    if (!activo || !invoiceId) { setMapa({}); return; }
    fetch(`/api/payments/cfdi?invoiceId=${encodeURIComponent(invoiceId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMapa(data?.items ?? {}))
      .catch(() => { /* sin dato no se pinta insignia: el resto sigue igual */ });
  }, [invoiceId, activo]);

  useEffect(() => { recargar(); }, [recargar]);

  return { cfdiPorPago: mapa, recargarCfdiPorPago: recargar };
}
