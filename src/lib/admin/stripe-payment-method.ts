import type Stripe from "stripe";
import { getStripeSafe } from "@/lib/stripe";

/**
 * Método de pago VIGENTE en Stripe — el que se va a cobrar en la próxima
 * renovación.
 *
 * Existe porque `Clinic.paymentMethodCollected` / `paymentMethodType` /
 * `paymentMethodLast4` SOLO se escriben en el alta (api/auth/register y
 * api/auth/register-oauth) con lo que mandó el formulario, y NADA los vuelve a
 * tocar: ni el webhook de Stripe, ni el checkout, ni el portal de cliente. Una
 * clínica que se registró sin tarjeta y luego pagó por Stripe Checkout se queda
 * con `paymentMethodCollected = false` para siempre. Ese campo describe el
 * formulario de alta, no el cobro.
 *
 * Es lectura pura sobre Stripe: no crea, no cobra y no modifica nada.
 */
export type StripeLivePaymentMethod =
  | {
      state: "found";
      /** "card" | "sepa_debit" | "link" | … (tipo del PaymentMethod de Stripe). */
      type: string;
      brand: string | null;
      last4: string | null;
      expMonth: number | null;
      expYear: number | null;
      /** La suscripción manda sobre el customer cuando las dos tienen método. */
      source: "subscription" | "customer";
    }
  /** El cliente existe en Stripe pero no tiene método por defecto → la próxima renovación falla. */
  | { state: "none" }
  /** No se pudo consultar (Stripe sin configurar, caído, timeout, customer borrado). */
  | { state: "unavailable"; reason: string };

/**
 * Presupuesto TOTAL de la consulta. El cliente de @/lib/stripe trae
 * timeout 15 s y maxNetworkRetries 2 (hasta 45 s en el peor caso): demasiado
 * para el render de una página. Aquí bajamos ambos y además ponemos un plazo
 * duro por si el SDK no lo respeta.
 */
const LOOKUP_TIMEOUT_MS = 4000;
const REQUEST_OPTIONS = { timeout: LOOKUP_TIMEOUT_MS, maxNetworkRetries: 0 };

/** Corta la promesa a los `ms`. Promise.race deja la original con handler → sin unhandledRejection. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Stripe no respondió en ${ms} ms`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/** Normaliza `string | PaymentMethod | null` a un PaymentMethod (lo resuelve si vino sin expandir). */
async function resolvePaymentMethod(
  stripe: Stripe,
  value: string | Stripe.PaymentMethod | null | undefined,
): Promise<Stripe.PaymentMethod | null> {
  if (!value) return null;
  if (typeof value !== "string") return value;
  return stripe.paymentMethods.retrieve(value, {}, REQUEST_OPTIONS);
}

function describe(
  pm: Stripe.PaymentMethod,
  source: "subscription" | "customer",
): StripeLivePaymentMethod {
  const card = pm.card ?? null;
  return {
    state: "found",
    type: pm.type,
    brand: card?.brand ?? null,
    last4: card?.last4 ?? pm.sepa_debit?.last4 ?? null,
    expMonth: card?.exp_month ?? null,
    expYear: card?.exp_year ?? null,
    source,
  };
}

async function lookup(
  stripe: Stripe,
  stripeCustomerId: string,
  stripeSubscriptionId: string | null,
): Promise<StripeLivePaymentMethod> {
  // 1) default_payment_method de la suscripción: es el que se cobra.
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(
      stripeSubscriptionId,
      { expand: ["default_payment_method"] },
      REQUEST_OPTIONS,
    );
    const pm = await resolvePaymentMethod(stripe, sub.default_payment_method);
    if (pm) return describe(pm, "subscription");
  }

  // 2) Si la suscripción no lo fija, Stripe cae al del customer.
  const customer = await stripe.customers.retrieve(
    stripeCustomerId,
    { expand: ["invoice_settings.default_payment_method"] },
    REQUEST_OPTIONS,
  );
  // `Response<Customer | DeletedCustomer>` es una intersección, no una unión
  // discriminada: TypeScript no estrecha solo con `if (customer.deleted)`.
  if ((customer as Stripe.DeletedCustomer).deleted) {
    return { state: "unavailable", reason: "El cliente fue eliminado en Stripe" };
  }

  const invoiceSettings = (customer as Stripe.Customer).invoice_settings;
  const pm = await resolvePaymentMethod(stripe, invoiceSettings?.default_payment_method);
  return pm ? describe(pm, "customer") : { state: "none" };
}

/**
 * Consulta el método de pago vigente. NUNCA lanza: si Stripe no está
 * configurado, no responde o devuelve error, la página se sigue renderizando
 * con estado "unavailable".
 */
export async function getLivePaymentMethod(params: {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<StripeLivePaymentMethod> {
  if (!params.stripeCustomerId) {
    return { state: "unavailable", reason: "La clínica no tiene cliente en Stripe" };
  }

  const stripe = getStripeSafe();
  // Stripe sin configurar ≠ clínica sin método: es "no disponible".
  if (!stripe) return { state: "unavailable", reason: "Stripe no está configurado" };

  try {
    return await withDeadline(
      lookup(stripe, params.stripeCustomerId, params.stripeSubscriptionId),
      LOOKUP_TIMEOUT_MS,
    );
  } catch (e: any) {
    console.warn("[admin] no se pudo leer el método de pago en Stripe:", e?.message ?? e);
    return { state: "unavailable", reason: "No respondió Stripe" };
  }
}
