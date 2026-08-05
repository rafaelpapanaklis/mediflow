import type Stripe from "stripe";
import { getStripeSafe } from "@/lib/stripe";
import { subscriptionItemInterval } from "@/lib/billing/proration";

/**
 * Lo que Stripe dice HOY de la suscripción de una clínica: con qué método se va
 * a cobrar y CUÁNTO. Las dos cosas salen de la misma llamada.
 *
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
 * Importe RECURRENTE que Stripe va a cobrar en la próxima renovación, leído del
 * price del item de la suscripción.
 *
 * Existe porque hay suscripciones vivas con Price viejos (p. ej. $499 o $1,796)
 * que ya no existen en plan_configs: van a renovar a ESE importe aunque el panel
 * muestre el precio actual del plan. Compararlo es la única forma de enterarse.
 *
 * La promo de primer mes NO ensucia este dato: se aplica con un cupón
 * `duration: "once"` (ver @/lib/billing/first-month-promo), así que el price
 * conserva el importe de lista.
 */
export interface StripeRecurringCharge {
  /** Importe por ciclo en PESOS (Stripe lo entrega en centavos) × cantidad. */
  amountMxn: number;
  /** "MXN", "USD"… en mayúsculas. */
  currency: string;
  interval: "month" | "year";
  /** 1 salvo ciclos raros (cada 3 meses…), donde no hay precio de plan comparable. */
  intervalCount: number;
}

/** Lo que se leyó de Stripe en UNA sola consulta. */
export interface StripeSubscriptionSnapshot {
  paymentMethod: StripeLivePaymentMethod;
  /** null = no hay suscripción, no se pudo leer, o ya no va a renovar. */
  recurring: StripeRecurringCharge | null;
}

/** Estados en los que la suscripción ya no va a cobrar nada más. */
const DEAD_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

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

/**
 * Importe recurrente a partir de la suscripción que YA tenemos en memoria: cero
 * llamadas extra a Stripe. null si no hay item, si el price es por tramos
 * (`unit_amount` null) o si la suscripción ya no va a cobrar.
 */
function readRecurring(sub: Stripe.Subscription): StripeRecurringCharge | null {
  if (DEAD_SUBSCRIPTION_STATUSES.has(sub.status)) return null;

  // DaleControl crea la suscripción con UN item (ver buildSubscriptionUpdateParams).
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (!price || price.unit_amount == null) return null;

  return {
    amountMxn: (price.unit_amount * (item.quantity ?? 1)) / 100,
    currency: (price.currency ?? "mxn").toUpperCase(),
    interval: subscriptionItemInterval(item),
    intervalCount: price.recurring?.interval_count ?? 1,
  };
}

async function lookup(
  stripe: Stripe,
  stripeCustomerId: string,
  stripeSubscriptionId: string | null,
): Promise<StripeSubscriptionSnapshot> {
  let recurring: StripeRecurringCharge | null = null;

  // 1) default_payment_method de la suscripción: es el que se cobra. De paso,
  //    la MISMA respuesta trae el importe recurrente.
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(
      stripeSubscriptionId,
      { expand: ["default_payment_method"] },
      REQUEST_OPTIONS,
    );
    recurring = readRecurring(sub);
    const pm = await resolvePaymentMethod(stripe, sub.default_payment_method);
    if (pm) return { paymentMethod: describe(pm, "subscription"), recurring };
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
    return {
      paymentMethod: { state: "unavailable", reason: "El cliente fue eliminado en Stripe" },
      recurring,
    };
  }

  const invoiceSettings = (customer as Stripe.Customer).invoice_settings;
  const pm = await resolvePaymentMethod(stripe, invoiceSettings?.default_payment_method);
  return {
    paymentMethod: pm ? describe(pm, "customer") : { state: "none" },
    recurring,
  };
}

/**
 * Consulta método de pago e importe recurrente vigentes. NUNCA lanza: si Stripe
 * no está configurado, no responde o devuelve error, la página se sigue
 * renderizando con estado "unavailable" y sin importe.
 */
export async function getLiveSubscriptionSnapshot(params: {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}): Promise<StripeSubscriptionSnapshot> {
  if (!params.stripeCustomerId) {
    return {
      paymentMethod: { state: "unavailable", reason: "La clínica no tiene cliente en Stripe" },
      recurring: null,
    };
  }

  const stripe = getStripeSafe();
  // Stripe sin configurar ≠ clínica sin método: es "no disponible".
  if (!stripe) {
    return {
      paymentMethod: { state: "unavailable", reason: "Stripe no está configurado" },
      recurring: null,
    };
  }

  try {
    return await withDeadline(
      lookup(stripe, params.stripeCustomerId, params.stripeSubscriptionId),
      LOOKUP_TIMEOUT_MS,
    );
  } catch (e: any) {
    console.warn("[admin] no se pudo leer la suscripción en Stripe:", e?.message ?? e);
    return {
      paymentMethod: { state: "unavailable", reason: "No respondió Stripe" },
      recurring: null,
    };
  }
}
