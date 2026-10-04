// Identidad de un timbrado ante Facturapi (ws1-t4, vuelta 2: F-12 y F-19).
//
// · F-12 · `idempotency_key`: la llave sale del APARTADO de la factura (o del
//   pago), que es aleatorio por intento y se queda guardado en `cfdiUuid`
//   mientras no se sabe si el timbre salió. Reintentar con el mismo apartado =
//   la misma llave = Facturapi devuelve el CFDI que ya emitió, no otro. Un
//   timbrado nuevo y legítimo (otro apartado: p. ej. el sustituto de un CFDI
//   cancelado) lleva otra llave.
// · F-19 · serie y folio del CFDI = los de la factura interna, para encontrarlo
//   en Facturapi y en la contabilidad con el mismo número que ve la clínica.
//
// Solo servidor (usa node:crypto).

import { createHash } from "node:crypto";

/** La llave de idempotencia de un apartado: 50 caracteres, siempre la misma para el mismo apartado. */
export function llaveIdempotencia(apartado: string): string {
  return "dc" + createHash("sha256").update(String(apartado)).digest("hex").slice(0, 48);
}

/**
 * «F-000155» → { series: "F", folioNumber: 155 }; «MF-0042» → { "MF", 42 }.
 * Serie: solo letras y números, hasta 25 (límite de Facturapi). Sin un número
 * al final no se manda nada y Facturapi pone el suyo, como siempre.
 */
export function serieYFolio(invoiceNumber: string | null | undefined): { series?: string; folioNumber?: number } {
  const t = String(invoiceNumber ?? "").trim();
  const m = /^(.*?)(\d+)$/.exec(t);
  if (!m) return {};
  const folioNumber = Number.parseInt(m[2], 10);
  if (!Number.isSafeInteger(folioNumber) || folioNumber <= 0) return {};
  const series = m[1].replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 25);
  return { ...(series ? { series } : {}), folioNumber };
}
