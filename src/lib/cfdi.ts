// Abstracción para emitir/cancelar CFDI (factura SAT). El usuario aún no ha
// contratado un PAC (Proveedor Autorizado de Certificación) — esta interfaz
// queda lista para que, cuando lo haga, solo reemplace PlaceholderProvider
// con la implementación del PAC elegido.
//
// Opciones recomendadas (de menor a mayor complejidad):
//   · Facturama          — https://facturama.mx     — ~$0.50 MXN/timbre
//   · Solución Factible  — https://solucionfactible.com
//   · FacturaBox         — https://facturabox.com
//
// Ejemplo de integración con Facturama (no activo):
//
//   export class FacturamaProvider implements CFDIProvider {
//     private base = "https://api.facturama.mx/api";
//     async generateInvoice(data: CFDIInvoiceInput): Promise<CFDIResult> {
//       const res = await fetch(`${this.base}/cfdi/3`, {
//         method: "POST",
//         headers: {
//           Authorization: "Basic " + Buffer.from(`${process.env.FACTURAMA_USER}:${process.env.FACTURAMA_PASS}`).toString("base64"),
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({ ... data en formato Facturama ... }),
//       });
//       if (!res.ok) throw new Error(await res.text());
//       const cfdi = await res.json();
//       return { uuid: cfdi.Complement.TaxStamp.Uuid, xmlUrl: ..., pdfUrl: ... };
//     }
//     async cancelInvoice(uuid: string) { ... }
//     async getStatus(uuid: string) { ... }
//   }

export interface CFDIReceptor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cpReceptor: string;
  usoCfdi?: string; // ej: "G03" gastos en general
  email?: string;
}

export interface CFDIEmisor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cpEmisor: string;
}

export interface CFDIConcepto {
  claveProdServ: string; // catálogo SAT
  cantidad: number;
  claveUnidad: string;   // catálogo SAT
  descripcion: string;
  valorUnitario: number;
  importe: number;
  /** IVA 16% por defecto */
  iva?: number;
}

export interface CFDIInvoiceInput {
  emisor:   CFDIEmisor;
  receptor: CFDIReceptor;
  conceptos: CFDIConcepto[];
  metodoPago: string;    // PUE | PPD
  formaPago:  string;    // 01 efectivo, 03 transferencia, 04 tarjeta, etc.
  moneda:     string;    // MXN
  tipoComprobante: "I" | "E" | "P"; // Ingreso | Egreso | Pago
}

export interface CFDIResult {
  uuid: string;
  serie?: string;
  folio?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  status: "valid" | "cancelled" | "pending";
}

export interface CFDIStatus {
  uuid: string;
  status: "valid" | "cancelled" | "pending";
  cancelledAt?: string;
}

export interface CFDIProvider {
  generateInvoice(data: CFDIInvoiceInput): Promise<CFDIResult>;
  cancelInvoice(uuid: string, reason?: string): Promise<{ success: boolean }>;
  getStatus(uuid: string): Promise<CFDIStatus>;
}

class NotConfiguredError extends Error {
  instructions: string;
  constructor() {
    super("PAC no configurado");
    this.instructions = [
      "Para generar CFDI necesitas contratar un PAC (Proveedor Autorizado de Certificación).",
      "",
      "Opciones recomendadas:",
      "  • Facturama (~$0.50 MXN por timbre) — https://facturama.mx",
      "  • Solución Factible — https://solucionfactible.com",
      "  • FacturaBox — https://facturabox.com",
      "",
      "Después de contratar:",
      "  1) Completa los datos fiscales de la clínica en /dashboard/settings (RFC emisor, régimen, CP).",
      "  2) Agrega credenciales del PAC en Vercel Environment Variables (ej: FACTURAMA_USER, FACTURAMA_PASS).",
      "  3) Implementa la clase *Provider en src/lib/cfdi.ts usando el ejemplo de Facturama como referencia.",
      "  4) Cambia getCFDIProvider() para que retorne la nueva implementación cuando las env vars estén presentes.",
    ].join("\n");
  }
}

/** Placeholder que siempre falla. Úsalo mientras no haya PAC configurado. */
export class PlaceholderProvider implements CFDIProvider {
  async generateInvoice(_: CFDIInvoiceInput): Promise<CFDIResult> { throw new NotConfiguredError(); }
  async cancelInvoice(_uuid: string, _reason?: string):           Promise<{ success: boolean }> { throw new NotConfiguredError(); }
  async getStatus(_uuid: string):                                  Promise<CFDIStatus>          { throw new NotConfiguredError(); }
}

export function isCFDIConfigured(): boolean {
  // Detecta si alguna integración PAC está activa. Hoy siempre false porque
  // no hay ninguna implementación real. Cuando se integre Facturama, cambiar
  // por ej: return Boolean(process.env.FACTURAMA_USER && process.env.FACTURAMA_PASS);
  return false;
}

export function getCFDIProvider(): CFDIProvider {
  // Cuando haya integración: if (process.env.FACTURAMA_USER) return new FacturamaProvider();
  return new PlaceholderProvider();
}

export function cfdiNotConfiguredInstructions(): string {
  return new NotConfiguredError().instructions;
}
