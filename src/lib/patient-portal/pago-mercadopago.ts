// Pagar una factura con Mercado Pago desde el portal del paciente (ws1-t2).
//
// Rafael: «cuando se le genere la factura a ese paciente entonces él tenga el
// qr y link para pagar directamente desde el portal».
//
// El link NO es nuevo: es el mismo de src/lib/factura-mp/ que la recepción
// manda por WhatsApp o correo (misma fila en invoice_payment_links, mismo
// `?ref=factura:<linkId>` en el webhook). Aquí solo viven las reglas puras que
// comparten la ruta del portal y su pantalla:
//   · qué método de pago en línea se ofrece cuando la clínica tiene los dos;
//   · qué URL se acepta para el botón y el QR;
//   · los textos (es; el en está en src/i18n/dictionaries/en.json).
//
// PURO: sin Prisma, sin fetch, sin React. Lo prueba
// src/app/api/paciente/payments/__tests__/portal-mercadopago.test.ts.

import { MINIMO_LINK_MXN, formatoPesos } from "@/lib/factura-mp/core";

export type MetodoPagoEnLinea = "mercadopago" | "stripe";

/**
 * Qué botón ve el paciente. Mercado Pago PRIMERO: se conecta con un botón y es
 * lo que usan las clínicas; Stripe Connect se queda como segunda vía para la
 * clínica que algún día lo conecte y no tenga Mercado Pago. null = «Paga en tu
 * clínica».
 */
export function metodoDePagoEnLinea(c: { mercadoPago: boolean; stripe: boolean }): MetodoPagoEnLinea | null {
  if (c.mercadoPago) return "mercadopago";
  if (c.stripe) return "stripe";
  return null;
}

/**
 * ¿Es un link de cobro de Mercado Pago? Solo `https:` y un dominio de Mercado
 * Pago (el `init_point` de una preferencia es
 * https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=…).
 *
 * La URL ya viene del servidor, que la leyó de la respuesta de Mercado Pago;
 * esto es la segunda llave: lo que no pase no se pinta ni como botón ni como QR
 * (nada de un `javascript:` ni de un dominio ajeno detrás de un código que el
 * paciente escanea con confianza).
 */
export function esUrlDeMercadoPago(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return DOMINIOS_MP.some((d) => host === d || host.endsWith(`.${d}`));
}

const DOMINIOS_MP = ["mercadopago.com.mx", "mercadopago.com"];

/** Lo que devuelve POST /api/paciente/payments/mercadopago con 200. */
export interface LinkDePagoPortal {
  url: string;
  monto: number;
  /** ISO. Hasta cuándo acepta pagos el link. */
  venceA: string;
}

/** `code` de los errores de esa ruta (la pantalla lo traduce). */
export type ErrorPagoPortal = "peticion" | "no_encontrada" | "sin_saldo" | "bajo_minimo" | "sin_mp" | "mp_fallo" | "nada_debido";

/**
 * ¿El pago en línea de esta factura sería POR ADELANTADO? (26-oct, Rafael): tiene saldo, pero aún no
 * debe nada de él (tratamiento por hacer o cuotas por vencer). Entonces el portal ofrece «Pagar por
 * adelantado» por el saldo de la nota (queda como abono), igual con Mercado Pago y con Stripe; si debe
 * algo, el pago es por lo debido.
 */
export function esPagoPorAdelantado(f: { balance: number; aunNoSeDebe?: number | null }): boolean {
  return f.balance > 0 && (Number(f.aunNoSeDebe) || 0) >= f.balance - 0.005;
}

/**
 * Lo que cobraría el pago en línea de esta factura (la misma regla que el servidor, `montoParaLink`): lo
 * debido, o el saldo de la nota si el pago es por adelantado. El portal decide con ESTO si enseña
 * «Pagar» o «Paga en tu clínica» (revisión t5, v5): si lo debido no llega al mínimo en línea, el botón
 * sobraba aunque el saldo sí llegara. (El servidor puede cobrar aún menos —la mensualidad de un plan a
 * plazos—; si eso queda bajo el mínimo, contesta «paga en tu clínica».)
 */
export function montoEnLineaDelPortal(f: { balance: number; aunNoSeDebe?: number | null }): number {
  if (esPagoPorAdelantado(f)) return Math.round(f.balance * 100) / 100;
  return Math.max(0, Math.round((f.balance - Math.max(0, Number(f.aunNoSeDebe) || 0)) * 100) / 100);
}

/**
 * Textos del portal en español, ESPEJO EXACTO de `portalPagoMp` en
 * src/i18n/dictionaries/es.json (una prueba lo fija). El portal del paciente
 * todavía no monta I18nProvider: la pantalla usa `useTOptional()` y, sin
 * proveedor, cae aquí. Cuando el portal tenga idioma, sale en inglés sin tocar
 * la pantalla.
 */
export const TEXTOS_PAGO_MP_ES = {
  pagar: "Pagar con Mercado Pago",
  pagarAdelanto: "Pagar por adelantado con Mercado Pago",
  preparando: "Preparando tu link…",
  titulo: "Paga {monto} con Mercado Pago",
  abrir: "Abrir Mercado Pago",
  qrAyuda: "¿Estás en una computadora? Escanea este código con la cámara de tu celular.",
  qrAlt: "Código QR del link de pago de Mercado Pago",
  seRegistraSolo: "Cuando Mercado Pago acredite tu pago, esta factura se marca como pagada sola.",
  vence: "El link vale hasta el {fecha}.",
  ocultar: "Ocultar",
  errores: {
    peticion: "No se pudo preparar el pago. Intenta de nuevo.",
    no_encontrada: "Factura no encontrada o sin saldo pendiente.",
    sin_saldo: "Esta factura ya no tiene saldo por pagar.",
    bajo_minimo: "El saldo es menor al mínimo para pagar en línea ({minimo}). Paga en tu clínica.",
    sin_mp: "Esta clínica aún no acepta pagos en línea. Paga directamente en tu clínica.",
    mp_fallo: "Mercado Pago no respondió. Intenta de nuevo en unos minutos.",
    nada_debido: "Aún no debes nada de esta factura. Si quieres, puedes pagar por adelantado.",
  },
};

/** Variables que llevan los textos de error (hoy solo el mínimo). */
export function varsErrorPortal(): { minimo: string } {
  return { minimo: formatoPesos(MINIMO_LINK_MXN) };
}

/** Texto del error para la respuesta del servidor (el portal no tiene idioma todavía). */
export function textoErrorPortal(code: ErrorPagoPortal): string {
  const { minimo } = varsErrorPortal();
  return TEXTOS_PAGO_MP_ES.errores[code].replace("{minimo}", minimo);
}
