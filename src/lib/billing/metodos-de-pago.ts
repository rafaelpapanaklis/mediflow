/**
 * QUÉ MÉTODOS DE PAGO SE OFRECEN, dicho con palabras — núcleo PURO (sin prisma ni React), para que la
 * cabecera de la pantalla de pago, el aviso de «no disponible» y el registro digan solo lo que existe.
 *
 *   · tarjeta y OXXO: los cobra Stripe. Necesitan el IVA 16 % configurado (`STRIPE_IVA_TAX_RATE_ID` o
 *     Stripe Tax) salvo para lo que la exención de una clínica de antes cubre.
 *   · SPEI: transferencia DIRECTA a nuestra cuenta (no pasa por Stripe). Solo existe si el admin capturó
 *     la cuenta en /admin → Configuración → «Datos banco».
 * Nunca se manda a un método que no existe: si SPEI no está configurado, el aviso de «tarjeta/OXXO no
 * disponibles» no lo nombra y manda a soporte.
 */

export const CORREO_SOPORTE = "soporte@dalecontrol.com";

export interface MetodosDisponibles {
  /** Tarjeta y OXXO (Stripe) se pueden cobrar ahora. */
  tarjetaOxxo: boolean;
  /** SPEI directo está configurado (hay cuenta bancaria y folio). */
  spei: boolean;
}

/** Qué combinación de métodos se ofrece; sirve de clave para los textos (es/en) de cada pantalla. */
export type VarianteMetodos = "todos" | "tarjetaOxxo" | "spei" | "ninguno";

export function varianteMetodos(m: MetodosDisponibles): VarianteMetodos {
  if (m.tarjetaOxxo && m.spei) return "todos";
  if (m.tarjetaOxxo) return "tarjetaOxxo";
  if (m.spei) return "spei";
  return "ninguno";
}

/** La línea de la cabecera de la pantalla de pago: «Elige cómo pagar… Tarjeta u OXXO con Stripe, o transferencia SPEI directa.» */
export function frasePagoSeguro(m: MetodosDisponibles): string {
  const v = varianteMetodos(m);
  if (v === "todos") return "Tarjeta u OXXO con Stripe, o transferencia SPEI directa.";
  if (v === "tarjetaOxxo") return "Tarjeta u OXXO con Stripe.";
  if (v === "spei") return "Transferencia SPEI directa.";
  return "";
}

/** El subtítulo completo de la pantalla de pago de una compra nueva. */
export function subtituloDePago(m: MetodosDisponibles): string {
  const frase = frasePagoSeguro(m);
  const base = "Elige cómo pagar tu plan y empieza a usar DaleControl.";
  return frase ? `${base} Pago seguro: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}` : `${base} Escríbenos a ${CORREO_SOPORTE} y te ayudamos a activar tu plan.`;
}

/**
 * El aviso cuando tarjeta y OXXO NO se pueden cobrar (falta el IVA en Stripe): ofrece SOLO lo que existe.
 * `null` = no hay nada que avisar.
 */
export function avisoTarjetaOxxoNoDisponible(m: MetodosDisponibles): { texto: string } | null {
  if (m.tarjetaOxxo) return null;
  if (m.spei) {
    return {
      texto: `El pago con tarjeta y OXXO no está disponible por ahora. Puedes pagar por transferencia SPEI o escribirnos a ${CORREO_SOPORTE}.`,
    };
  }
  return {
    texto: `Por ahora no hay ningún método de pago disponible para este plan. Escríbenos a ${CORREO_SOPORTE} y activamos tu plan contigo.`,
  };
}
