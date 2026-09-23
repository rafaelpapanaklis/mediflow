import type { StripeLivePaymentMethod } from "@/lib/admin/stripe-payment-method";

/**
 * Qué enseña Configuración → Suscripción en «Método de pago». Módulo PURO
 * (sin fetch, sin prisma): lo usan la pestaña de siempre y la del rediseño,
 * para que digan lo mismo.
 *
 * Existe porque la pestaña preguntaba por `Clinic.paymentMethodCollected`,
 * que SOLO escribe el formulario de alta y nadie vuelve a tocar. Una clínica
 * que se registró sin tarjeta y luego pagó por Stripe Checkout se queda en
 * `false` para siempre, y la pantalla le decía «no tienes método de pago» con
 * una suscripción activa y una tarjeta guardada en Stripe (caso BEVADENT,
 * tarjeta terminada en 0038).
 *
 * La fuente que manda es Stripe, leída por `@/lib/admin/stripe-payment-method`
 * (la misma pieza que usa /admin). Y cuando Stripe NO contesta, aquí no se
 * afirma nada: «no sé» nunca se convierte en «no tienes».
 */

export interface MetodoPagoAlta {
  /** `Clinic.paymentMethodCollected`: lo que eligió el formulario de registro. */
  collected: boolean;
  type: string | null;
  last4: string | null;
}

export type MetodoPagoVista =
  /** Todavía no se ha consultado a Stripe. */
  | { kind: "loading" }
  /** Tarjeta vigente en Stripe: marca y últimos 4. */
  | { kind: "card"; brand: string | null; last4: string | null }
  /** Otro método vigente en Stripe (SEPA, Link, OXXO…). */
  | { kind: "other"; type: string; last4: string | null }
  /** Stripe no tiene método, pero el alta dijo cómo paga (SPEI, PayPal, tarjeta). */
  | { kind: "signup"; type: string | null; last4: string | null }
  /** Stripe dice que no hay método y el alta tampoco. La suscripción sigue viva. */
  | { kind: "none-active" }
  /** Stripe dice que no hay método y el alta tampoco, y no hay suscripción activa. */
  | { kind: "none" }
  /** Stripe no contestó (o no está configurado) y el alta no dice nada: no se afirma nada. */
  | { kind: "unknown" };

export function resolverMetodoPago(params: {
  /** null = aún cargando. */
  live: StripeLivePaymentMethod | null;
  alta: MetodoPagoAlta;
  subscriptionActive: boolean;
}): MetodoPagoVista {
  const { live, alta, subscriptionActive } = params;

  if (live?.state === "found") {
    if (live.type === "card") return { kind: "card", brand: live.brand, last4: live.last4 };
    return { kind: "other", type: live.type, last4: live.last4 };
  }

  // Sin respuesta de Stripe (o aún cargando): lo que dijo el alta es lo único
  // cierto. Si no dijo nada, no se afirma lo contrario.
  if (live === null || live.state === "unavailable") {
    if (alta.collected) return { kind: "signup", type: alta.type, last4: alta.last4 };
    return live === null ? { kind: "loading" } : { kind: "unknown" };
  }

  // Stripe contestó «sin método por defecto». Lo que dijo el alta solo vale
  // si es un método que NO vive en Stripe (SPEI, PayPal): una «tarjeta» del
  // formulario que Stripe no tiene sería contradecir a Stripe.
  if (alta.collected && alta.type !== "card") return { kind: "signup", type: alta.type, last4: alta.last4 };
  return subscriptionActive ? { kind: "none-active" } : { kind: "none" };
}

/** Marcas de Stripe con su nombre; una desconocida se enseña tal cual. */
export const MARCA_TARJETA: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express",
  discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay",
};

export function nombreMarca(brand: string | null): string | null {
  if (!brand) return null;
  return MARCA_TARJETA[brand] ?? brand;
}

type Traductor = (key: string, params?: Record<string, string | number>) => string;

/**
 * Textos de la caja «método de pago» cuando HAY uno: la marca del recuadro,
 * el título y la línea de abajo. null cuando no hay método que enseñar (ver
 * `avisoMetodoPago`). Lo usan la pestaña de siempre y la del rediseño.
 */
export function textosMetodoPago(
  v: MetodoPagoVista,
  t: Traductor,
  anual: boolean,
): { marca: string; titulo: string; sub: string } | null {
  const cobro = t(anual ? "shell.subscriptionTab.autoAnnualCharge" : "shell.subscriptionTab.autoMonthlyCharge");
  const last4 = "last4" in v && v.last4 ? v.last4 : "••••";
  if (v.kind === "card") {
    const brand = nombreMarca(v.brand);
    return {
      marca: "CARD",
      titulo: brand
        ? t("shell.subscriptionTab.cardBrandEndingIn", { brand, last4 })
        : t("shell.subscriptionTab.cardEndingIn", { last4 }),
      sub: cobro,
    };
  }
  if (v.kind === "other") {
    return {
      marca: v.type.replace(/_/g, " ").slice(0, 6).toUpperCase(),
      titulo: v.last4 ? `${v.type} •••• ${v.last4}` : v.type,
      sub: t("shell.subscriptionTab.recurringSubscription"),
    };
  }
  if (v.kind === "signup") {
    if (v.type === "card") {
      return { marca: "CARD", titulo: t("shell.subscriptionTab.cardEndingIn", { last4 }), sub: cobro };
    }
    if (v.type === "paypal") {
      return { marca: "PayPal", titulo: "PayPal", sub: t("shell.subscriptionTab.recurringSubscription") };
    }
    return {
      marca: "SPEI",
      titulo: t("shell.subscriptionTab.bankTransfer"),
      sub: t("shell.subscriptionTab.manualPaymentConfirmation"),
    };
  }
  return null;
}

/**
 * Qué aviso va cuando NO hay método que enseñar. Solo «none» (sin método y
 * sin suscripción activa) alarma; los demás informan sin contradecir nada.
 */
export function avisoMetodoPago(v: MetodoPagoVista): { clave: string; tono: "alerta" | "neutro" } {
  switch (v.kind) {
    case "none":
      return { clave: "shell.subscriptionTab.noPaymentMethod", tono: "alerta" };
    case "none-active":
      return { clave: "shell.subscriptionTab.noPaymentMethodActive", tono: "neutro" };
    case "loading":
      return { clave: "shell.subscriptionTab.paymentMethodLoading", tono: "neutro" };
    default:
      return { clave: "shell.subscriptionTab.paymentMethodUnknown", tono: "neutro" };
  }
}
