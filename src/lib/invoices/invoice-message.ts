// Texto de «Enviar la factura» por WhatsApp (ws1-t6, punto 8 del tercer ticket).
//
// Antes ese botón mandaba el AVISO DE SALDO (`payment-notice.ts`): con la ventana
// de 24 h cerrada salía la plantilla dc_aviso_saldo, «Tienes un saldo pendiente
// de $X», sin folio ni link. Una nota recién hecha le llegaba al paciente como un
// cobro de deuda. Este es el mensaje de la NOTA: folio, monto y cómo pagarla (el
// link de Mercado Pago si la factura se cobra así).
//
// PURO: sin Prisma ni red. Lo usan la ruta que envía y el popup de Nueva factura,
// que enseña ESTE MISMO texto antes de guardar.

import { lineaLinkWhatsApp } from "@/lib/factura-mp/core";

function fmtMXN(n: number): string {
  const v = new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return `${v} MXN`;
}

/** "Limpieza, Resina y 2 más". */
function resumirConceptos(raw: unknown): string {
  const items = Array.isArray(raw) ? (raw as any[]) : [];
  const nombres = items.map((it) => String(it?.description ?? it?.name ?? "").trim()).filter((s) => s.length > 0);
  if (nombres.length === 0) return "";
  const vistos = nombres.slice(0, 3);
  const resto = nombres.length - vistos.length;
  return resto > 0 ? `${vistos.join(", ")} y ${resto} más` : vistos.join(", ");
}

/** Meta rechaza un parámetro con saltos de línea, tabuladores o más de 4 espacios seguidos. */
function paraPlantilla(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

export interface MensajeFacturaInput {
  /** A quién se saluda: el paciente, o el responsable de pago. */
  saludo: { firstName?: string | null; lastName?: string | null } | null | undefined;
  /** El nombre del paciente cuando el mensaje va al responsable de pago. */
  aNombreDe?: string | null;
  clinicName: string;
  /** Teléfono de la clínica, ya recortado. */
  clinicPhone: string;
  invoiceNumber: string;
  total: number;
  /** Lo que queda por pagar (la nota pudo nacer con un anticipo aplicado). */
  balance: number;
  items: unknown;
  /** Link de Mercado Pago de la factura. Sin él, se dice cómo pagar en la clínica. */
  linkPago?: { url: string; monto: number } | null;
}

export interface MensajeFactura {
  /** Texto libre: lo que sale con la ventana de 24 h abierta (con el PDF adjunto). */
  body: string;
  /** {{1}}…{{5}} de dc_factura_lista, en el orden del catálogo. */
  templateParams: string[];
}

export function buildMensajeFactura(input: MensajeFacturaInput): MensajeFactura {
  const nombre = `${input.saludo?.firstName ?? ""} ${input.saludo?.lastName ?? ""}`.trim() || "Paciente";
  const conceptos = resumirConceptos(input.items);
  const debe = Math.max(0, Number(input.balance) || 0);
  const total = Math.max(0, Number(input.total) || 0);
  // Nació con un anticipo aplicado: el monto que importa es lo que queda.
  const monto = debe < total - 0.005 ? `${fmtMXN(total)} (por pagar: ${fmtMXN(debe)})` : fmtMXN(total);
  const deQuien = input.aNombreDe ? `la nota ${input.invoiceNumber} de ${input.aNombreDe}` : `tu nota ${input.invoiceNumber}`;

  const body =
    `Hola ${nombre}, ${input.clinicName} te comparte ${deQuien}` +
    `${conceptos ? ` (${conceptos})` : ""} por ${monto}.` +
    (input.linkPago
      // El link en su propia línea: pegado a un punto, WhatsApp lo corta mal.
      ? `\n\n${lineaLinkWhatsApp(input.linkPago.url, input.linkPago.monto)}\n\n` +
        `También puedes pagar en la clínica o llamarnos al ${input.clinicPhone}.`
      : ` Puedes pagarla en la clínica o llamarnos al ${input.clinicPhone}.`) +
    ` Si tienes dudas, responde este mensaje.`;

  const comoPagar = input.linkPago
    ? `en línea en ${input.linkPago.url} o en la clínica`
    : `en la clínica o llamándonos al ${input.clinicPhone}`;

  // Orden de dc_factura_lista: nombre, clínica, folio, monto, cómo pagar.
  return {
    body,
    templateParams: [nombre, input.clinicName, input.invoiceNumber, monto, comoPagar].map(paraPlantilla),
  };
}
