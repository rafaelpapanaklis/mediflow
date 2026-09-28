"use client";

// El responsable de pago (tutor) de la factura de un caso de ortodoncia, con sus
// datos fiscales, para precargar el CFDI (ws1-t10, punto 9). Solo lectura
// (GET /api/invoices/[id]/receptor-responsable). Sin caso o sin respuesta: null y
// el formulario sigue con los datos del paciente, exactamente como hasta ahora.

import { useEffect, useState } from "react";
import type { ResponsableParaCfdi } from "@/lib/orthodontics/receptor-responsable";

export async function pedirResponsableDeFactura(invoiceId: string, signal?: AbortSignal): Promise<ResponsableParaCfdi | null> {
  try {
    const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/receptor-responsable`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.responsable as ResponsableParaCfdi | null) ?? null;
  } catch {
    return null;
  }
}

export function useResponsableDeFactura(invoiceId: string | null | undefined, activo = true): ResponsableParaCfdi | null {
  const [r, setR] = useState<ResponsableParaCfdi | null>(null);
  useEffect(() => {
    setR(null);
    if (!activo || !invoiceId) return;
    const ctrl = new AbortController();
    pedirResponsableDeFactura(invoiceId, ctrl.signal).then((x) => { if (!ctrl.signal.aborted) setR(x); });
    return () => ctrl.abort();
  }, [invoiceId, activo]);
  return r;
}
