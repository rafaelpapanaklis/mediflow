// Texto del correo con el que se le manda una factura al paciente
// (POST /api/invoices/[id]/send-email).
//
// Hermano de `payment-notice.ts` (el aviso por WhatsApp): vive fuera del handler
// para poder probarlo sin Prisma ni red. PURO.
//
// Dos cosas a propósito:
//
//  · TODO lo que viene de la base pasa por `escaparHtml`. El nombre del paciente
//    y la descripción de un concepto los escribe una persona en un formulario, y
//    este HTML sale hacia el buzón de un tercero.
//  · El correo va SIN colores. Un correo no puede leer los tokens del panel
//    (`var(--m2-*)` no existe en Gmail) y copiar el violeta a mano es justo lo
//    que el rediseño prohíbe. Tipografía del sistema, negro sobre blanco.

import { dinero, frasePlan, hayCondiciones, ETIQUETA_METODO_ES, type CondicionesPago } from "@/lib/quotes/condiciones-pago";

export function escaparHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface CorreoFacturaInput {
  patient: { firstName?: string | null; lastName?: string | null } | null | undefined;
  clinicName: string;
  clinicPhone?: string | null;
  invoiceNumber: string;
  total: number;
  paid: number;
  balance: number;
  items: unknown;
  condiciones?: CondicionesPago | null;
  /**
   * Link de Mercado Pago para pagar el saldo (ws1-t1). Con él, el correo dice
   * cuánto y dónde pagar en línea; sin él, sale el correo de siempre.
   */
  linkPago?: { url: string; monto: number } | null;
}

export interface CorreoFactura {
  subject: string;
  html: string;
  text: string;
}

interface Concepto { descripcion: string; cantidad: number; importe: number }

function conceptos(raw: unknown): Concepto[] {
  const items = Array.isArray(raw) ? (raw as any[]) : [];
  return items
    .map((it) => {
      const cantidad = Number(it?.quantity) > 0 ? Number(it.quantity) : 1;
      const hayPrecio = it?.unitPrice !== undefined && it?.unitPrice !== null;
      const precio = Number(it?.unitPrice);
      const descuento = Number(it?.discount);
      // Mismo criterio que el resto de Facturación: cantidad × precio − descuento
      // de línea; `total` solo como respaldo de facturas viejas sin unitPrice
      // (ojo: `Number(null)` es 0 y pasaría por precio válido).
      const importe = hayPrecio && isFinite(precio)
        ? Math.max(0, cantidad * precio - (isFinite(descuento) ? descuento : 0))
        : (Number(it?.total) || 0);
      return { descripcion: String(it?.description ?? it?.name ?? "").trim(), cantidad, importe };
    })
    .filter((c) => c.descripcion.length > 0);
}

/**
 * La frase del trato — LA MISMA en la ficha (línea violeta) y en el correo. A
 * plazos: la frase entera de Presupuestos. Un pago con método: «Un solo pago ·
 * Efectivo». Sin condiciones: null — una factura de antes de esto se pinta sin
 * línea, no con una inventada.
 */
export function fraseCondiciones(total: number, c: CondicionesPago | null | undefined): string | null {
  if (!c || !hayCondiciones(c)) return null;
  if (c.modo === "plazos") return frasePlan(total, c);
  if (!c.metodo) return null;
  const base = `Un solo pago · ${ETIQUETA_METODO_ES[c.metodo]}`;
  return c.difiereConSuBanco ? `${base} · lo difiere con su banco` : base;
}

export function buildCorreoFactura(input: CorreoFacturaInput): CorreoFactura {
  const nombre = `${input.patient?.firstName ?? ""}`.trim() || "paciente";
  const lineas = conceptos(input.items);
  const frase = fraseCondiciones(input.total, input.condiciones);
  const telefono = (input.clinicPhone ?? "").trim();
  // A una factura ya pagada no se le invita a pagar (ni se le manda link).
  const link = input.balance > 0 && input.linkPago?.url ? input.linkPago : null;
  const cierre = !(input.balance > 0)
    ? "Tu nota está pagada. ¡Gracias!"
    : link
      ? telefono
        ? `También puedes pagar en la clínica o llamarnos al ${telefono}.`
        : "También puedes pagar en la clínica."
      : telefono
        ? `Puedes pagar en la clínica o llamarnos al ${telefono} para coordinarlo.`
        : "Puedes pagar en la clínica.";
  const lineaLink = link ? `Paga ${dinero(link.monto)} en línea con Mercado Pago:` : null;

  const subject = `Tu nota ${input.invoiceNumber} — ${input.clinicName}`;

  const text = [
    `Hola ${nombre}, te saludamos de ${input.clinicName}.`,
    "",
    `Esta es tu nota ${input.invoiceNumber}:`,
    ...lineas.map((l) => `  · ${l.cantidad > 1 ? `${l.cantidad} × ` : ""}${l.descripcion} — ${dinero(l.importe)}`),
    "",
    `Total: ${dinero(input.total)}`,
    ...(input.paid > 0 ? [`Pagado: ${dinero(input.paid)}`] : []),
    `Saldo: ${dinero(input.balance)}`,
    ...(frase ? ["", `Forma de pago acordada: ${frase}`] : []),
    ...(link ? ["", lineaLink as string, link.url] : []),
    "",
    cierre,
    "",
    "Este correo es informativo: no es un comprobante fiscal (CFDI).",
    "Enviado con DaleControl",
  ].join("\n");

  const e = escaparHtml;
  const celda = "padding: 6px 0; font-size: 14px; border-bottom: 1px solid;";
  const html = `<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; padding: 24px 16px;">
  <div style="max-width: 560px; margin: 0 auto;">
    <div style="font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 14px;">${e(input.clinicName)}</div>
    <h1 style="font-size: 20px; margin: 0 0 10px 0;">Tu nota ${e(input.invoiceNumber)}</h1>
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 18px 0;">Hola ${e(nombre)}, te compartimos el detalle de tu nota.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
      ${lineas.map((l) => `<tr><td style="${celda}">${l.cantidad > 1 ? `${l.cantidad} × ` : ""}${e(l.descripcion)}</td><td style="${celda} text-align: right; white-space: nowrap;">${e(dinero(l.importe))}</td></tr>`).join("\n      ")}
    </table>
    <p style="font-size: 16px; font-weight: 700; margin: 0 0 4px 0; text-align: right;">Total: ${e(dinero(input.total))}</p>
    ${input.paid > 0 ? `<p style="font-size: 13px; margin: 0 0 2px 0; text-align: right;">Pagado: ${e(dinero(input.paid))}</p>` : ""}
    <p style="font-size: 13px; margin: 0 0 16px 0; text-align: right;">Saldo: ${e(dinero(input.balance))}</p>
    ${frase ? `<p style="font-size: 14px; font-weight: 600; line-height: 1.5; margin: 0 0 16px 0;">Forma de pago acordada: ${e(frase)}</p>` : ""}
    ${link ? `<p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">${e(lineaLink)}<br /><a href="${e(link.url)}" style="font-weight: 700; text-decoration: underline; word-break: break-all;">${e(link.url)}</a></p>` : ""}
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 22px 0;">${e(cierre)}</p>
    <p style="font-size: 11px; line-height: 1.5; margin: 0;">Este correo es informativo: no es un comprobante fiscal (CFDI).<br />Enviado con DaleControl</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
