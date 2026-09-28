// La etiqueta de cada factura en la tarjeta «Cobros» de la portada (ws1-t4
// ronda 6). Puro: sin React.
//
// La portada decidía por su cuenta —«¿queda saldo? Pendiente : Pagada»— y la
// pestaña Facturación decide por el ESTADO de la factura (`invoiceStatusBadge`,
// la fuente única de `billing/invoice-status.ts`). Resultado: la misma factura
// MF-1017 ($36,000, pagados $13,000) decía «Pendiente» en la portada y
// «Parcial» en Facturación. Ahora la portada pregunta a la MISMA función, así
// que no pueden volver a decir cosas distintas.

import {
  invoiceStatusBadge,
  type InvoiceStatusTone,
} from "@/components/dashboard/billing/invoice-status";

/** Los seis tonos de `invoice-status.ts` en las etiquetas de `rediseno.module.css`
 *  (el mismo reparto que `TONO_ETIQUETA` de las fichas de factura). */
export const CLASE_ETIQUETA_COBRO: Record<InvoiceStatusTone, string> = {
  success: "etiquetaExito",
  warning: "etiquetaAlerta",
  danger: "etiquetaPeligro",
  info: "etiquetaVioleta",
  brand: "etiquetaVioleta",
  neutral: "etiquetaNeutra",
};

export interface EtiquetaDeCobro {
  /** Clave i18n, la misma que pinta Facturación. */
  labelKey: string;
  /** Nombre de la clase de la etiqueta en `rediseno.module.css`. */
  clase: string;
  /** La factura está pagada: el punto de la fila va en verde. */
  saldada: boolean;
}

export function etiquetaDeCobro(inv: { status?: string | null }): EtiquetaDeCobro {
  const badge = invoiceStatusBadge(inv?.status);
  return {
    labelKey: badge.labelKey,
    clase: CLASE_ETIQUETA_COBRO[badge.tone],
    saldada: badge.tone === "success",
  };
}
