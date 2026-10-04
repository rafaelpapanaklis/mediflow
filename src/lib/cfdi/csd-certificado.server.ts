// Lee el RFC y la vigencia del .cer del CSD ANTES de mandarlo a Facturapi (ws1-t8, F-15).
//
// El certificado del SAT (X.509 en DER) lleva el RFC en el atributo x500UniqueIdentifier
// (OID 2.5.4.45) del sujeto: «RFC» en una persona física y «RFC_EMPRESA / RFC_REPRESENTANTE»
// en una moral — el primero es siempre el del titular. Con eso se compara contra el RFC
// capturado en el panel sin depender de lo que conteste Facturapi.
//
// Solo lee el certificado PÚBLICO (.cer). La llave privada y su contraseña no se tocan aquí.

import { X509Certificate } from "crypto";

export interface DatosDelCertificado {
  rfc: string | null;
  validoDesde: Date | null;
  validoHasta: Date | null;
}

/** RFC del titular a partir del texto del sujeto que da Node (`X509Certificate.subject`). */
export function rfcDelSujeto(sujeto: string): string | null {
  for (const linea of sujeto.split("\n")) {
    const m = /^(?:x500UniqueIdentifier|2\.5\.4\.45)\s*=\s*(.+)$/i.exec(linea.trim());
    if (!m) continue;
    const primero = m[1].split("/")[0].trim().toUpperCase();
    if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(primero)) return primero;
  }
  return null;
}

/** null si el archivo no es un certificado legible (lo rechazará Facturapi con su mensaje). */
export function leerCertificadoCsd(cer: Buffer): DatosDelCertificado | null {
  try {
    const c = new X509Certificate(cer);
    const desde = new Date(c.validFrom);
    const hasta = new Date(c.validTo);
    return {
      rfc: rfcDelSujeto(c.subject),
      validoDesde: Number.isNaN(desde.getTime()) ? null : desde,
      validoHasta: Number.isNaN(hasta.getTime()) ? null : hasta,
    };
  } catch {
    return null;
  }
}
