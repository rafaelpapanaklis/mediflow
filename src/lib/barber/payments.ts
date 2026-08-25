import "server-only";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMissingTableError } from "@/lib/barber/db-errors";
import {
  BARBER_DEPOSIT_LINE_PREFIX,
  centsToMoney,
  centsToNumber,
  depositLineDescription,
  formatCents,
  moneyToCents,
} from "@/lib/barber/memberships-core";
import {
  BARBER_PAYMENTS_WEBHOOK_EVENTS,
  DCB_KIND_MEMBERSHIP,
  DEFAULT_BARBER_DEPOSIT_POLICY,
  buildDepositMetadata,
  buildMembershipMetadata,
  classifyPaymentIntent,
  describeDepositPolicy,
  isChargeableAmount,
  isOurWebhookEvent,
  isWithinRefundWindow,
  normalizeDepositPolicy,
  quoteDeposit,
  toStripeAmount,
  toStripeRecurring,
  type BarberClientDepositStats,
  type BarberDepositPolicy,
  type BarberDepositView,
} from "@/lib/barber/payments-core";

/**
 * DaleControl BARBER — anticipos y pagos en línea del CLIENTE FINAL.
 *
 * ⚠️ FRONTERA CON T6 (suscripción del SaaS). Lo repito aquí porque es el
 * error que ya nos costó caro en el dental (dos webhooks procesando lo
 * mismo):
 *   · T6  cobra a la BARBERÍA por usar DaleControl.
 *         Dueño de src/lib/barber/billing.ts y /api/barber/stripe/**.
 *         Escucha checkout.session.* y customer.subscription.*.
 *   · AQUÍ cobramos al CLIENTE FINAL su membresía y su anticipo.
 *         Dueño de este archivo y de /api/barber/payments/**.
 *         Escucha SOLO payment_intent.* (BARBER_PAYMENTS_WEBHOOK_EVENTS).
 * Cero solapamiento de tipos de evento, secretos distintos, endpoints
 * distintos. La renovación de una membresía en Stripe se detecta por el
 * PaymentIntent de su factura, NUNCA por invoice.paid.
 *
 * Envs (Rafael las crea en Vercel — ver reporte; jamás en el código):
 *   BARBER_PAYMENTS_STRIPE_WEBHOOK_SECRET  (Sensitive, OBLIGATORIA — es el
 *     secreto de NUESTRO endpoint, distinto del de T6)
 *   BARBER_PAYMENTS_STRIPE_SECRET_KEY      (Sensitive, opcional → cae a
 *     BARBER_STRIPE_SECRET_KEY y luego a STRIPE_SECRET_KEY)
 */

/** Moneda del vertical. NO es un precio: los precios los pone cada barbería. */
export const BARBER_CURRENCY = "MXN";

export class BarberPaymentsError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BarberPaymentsError";
    this.code = code;
    this.status = status;
  }
}

function requireShop(barbershopId: string | null | undefined): string {
  if (!barbershopId || typeof barbershopId !== "string") {
    throw new BarberPaymentsError("NO_SHOP", "Falta la barbería en el contexto.", 401);
  }
  return barbershopId;
}

// ═══════════════════════════════════════════════════════════════════════
// Cliente Stripe propio de la ola
// ═══════════════════════════════════════════════════════════════════════

let _stripe: Stripe | null | undefined;

/** Cliente de Stripe del vertical. null si no hay llave configurada. */
export function getBarberStripe(): Stripe | null {
  if (_stripe !== undefined) return _stripe;
  // Orden: llave propia de esta ola → la del vertical barber (la que usa T6
  // para la suscripción del SaaS; misma cuenta de Stripe, distinto flujo) →
  // la del dental como último recurso. Así Rafael solo tiene que crear el
  // SECRETO DEL WEBHOOK y no una llave nueva.
  const key =
    process.env.BARBER_PAYMENTS_STRIPE_SECRET_KEY ||
    process.env.BARBER_STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET_KEY ||
    "";
  _stripe = key
    ? new Stripe(key, {
        apiVersion: "2024-06-20" as any,
        timeout: 15_000,
        maxNetworkRetries: 2,
      })
    : null;
  return _stripe;
}

export function isBarberStripeConfigured(): boolean {
  return getBarberStripe() !== null;
}

function requireStripe(): Stripe {
  const s = getBarberStripe();
  if (!s) {
    throw new BarberPaymentsError(
      "STRIPE_NOT_CONFIGURED",
      "El cobro en línea todavía no está configurado. Cobra en efectivo o por transferencia mientras tanto.",
      503,
    );
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════════
// Configuración de anticipos por barbería
//
// NOTA DE ALMACENAMIENTO: la política vive en `barber_payment_settings`
// (modelo BarberPaymentSettings). La tabla nació en sql/barber_membresias.sql
// cuando el schema estaba congelado y hoy ya está en prisma/schema.prisma,
// así que se lee con el cliente Prisma. La red de seguridad NO se quitó:
// si esta base todavía no tiene la tabla (P2021), todo cae a los valores
// por defecto y el panel avisa, en vez de tronar (mismo criterio que
// plans.ts con barber_plan_configs).
// ═══════════════════════════════════════════════════════════════════════

const SETTINGS_TTL_MS = 30_000;
const settingsCache = new Map<string, { policy: BarberDepositPolicy; ready: boolean; at: number }>();

export interface BarberPaymentSettings {
  policy: BarberDepositPolicy;
  /** false = falta correr sql/barber_membresias.sql en Supabase. */
  storageReady: boolean;
}

export async function getBarberPaymentSettings(
  barbershopId: string,
): Promise<BarberPaymentSettings> {
  const shopId = requireShop(barbershopId);
  const hit = settingsCache.get(shopId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) {
    return { policy: hit.policy, storageReady: hit.ready };
  }

  try {
    const row = await prisma.barberPaymentSettings.findUnique({
      where: { barbershopId: shopId },
      select: { settings: true },
    });
    const raw: unknown = row?.settings ?? null;
    const policy = normalizeDepositPolicy(
      raw && typeof raw === "object" ? (raw as Record<string, unknown>).deposit ?? raw : null,
    );
    settingsCache.set(shopId, { policy, ready: true, at: Date.now() });
    return { policy, storageReady: true };
  } catch (err) {
    // Tabla aún sin crear (P2021) o BD caída: valores por defecto, jamás
    // romper el panel ni la reserva pública. Solo se registra lo que NO es
    // "falta la tabla", para no confundir un problema real con SQL pendiente.
    if (!isMissingTableError(err)) {
      console.warn("[barber/payments] no se pudo leer la política de anticipos:", err);
    }
    const policy = { ...DEFAULT_BARBER_DEPOSIT_POLICY };
    settingsCache.set(shopId, { policy, ready: false, at: Date.now() });
    return { policy, storageReady: false };
  }
}

export async function saveBarberDepositPolicy(
  barbershopId: string,
  raw: unknown,
): Promise<BarberDepositPolicy> {
  const shopId = requireShop(barbershopId);
  const policy = normalizeDepositPolicy(raw);
  // Ida y vuelta por JSON: deja el blob exactamente como lo dejaba el
  // `::jsonb` de antes (sin undefined, sin prototipos) y con el tipo Json
  // que pide Prisma.
  const payload = JSON.parse(JSON.stringify({ deposit: policy })) as Prisma.InputJsonObject;

  try {
    await prisma.barberPaymentSettings.upsert({
      where: { barbershopId: shopId },
      create: { barbershopId: shopId, settings: payload },
      update: { settings: payload },
      select: { barbershopId: true },
    });
  } catch (err) {
    // Casi siempre es la tabla sin crear, pero se registra el error real para
    // no confundir un problema de BD con "falta correr el SQL".
    console.error("[barber/payments] no se pudo guardar la política de anticipos:", err);
    throw new BarberPaymentsError(
      "SETTINGS_STORAGE_MISSING",
      "Falta aplicar sql/barber_membresias.sql en la base de datos para poder guardar la política de anticipos.",
      503,
    );
  }

  settingsCache.set(shopId, { policy, ready: true, at: Date.now() });
  return policy;
}

/** Invalida la cache en memoria (tras un guardado externo). */
export function clearBarberPaymentSettingsCache(barbershopId?: string): void {
  if (barbershopId) settingsCache.delete(barbershopId);
  else settingsCache.clear();
}

// ═══════════════════════════════════════════════════════════════════════
// Cotización del anticipo
// ═══════════════════════════════════════════════════════════════════════

/** Historial del cliente en ESTA barbería (visitas completadas y ausencias). */
export async function getClientDepositStats(
  barbershopId: string,
  clientId: string | null | undefined,
): Promise<BarberClientDepositStats | null> {
  const shopId = requireShop(barbershopId);
  if (!clientId) return null;
  const [doneVisits, noShows] = await Promise.all([
    prisma.barberAppointment.count({
      where: { barbershopId: shopId, clientId, status: "DONE" },
    }),
    prisma.barberAppointment.count({
      where: { barbershopId: shopId, clientId, status: "NO_SHOW" },
    }),
  ]);
  return { doneVisits, noShows };
}

export interface DepositQuoteForBooking {
  required: boolean;
  /** Monto en pesos (para pintar). */
  amount: number;
  amountCents: number;
  reason: "DISABLED" | "NOT_IN_AUDIENCE" | "ZERO_AMOUNT" | "REQUIRED";
  /** Texto de la política, VISIBLE antes de pagar. Sin letra chica. */
  policyText: string;
  /** ¿Se puede cobrar en línea con tarjeta ahora mismo? */
  onlineAvailable: boolean;
  currency: string;
  refundWindowHours: number;
}

/**
 * ═══ PARA T5 (reserva pública) ═══
 * ¿Este cliente necesita anticipo para esta reserva y de cuánto? Se llama
 * ANTES de crear la cita para poder enseñar la política antes de cobrar.
 *
 *   const q = await quoteDepositForBooking({
 *     barbershopId,                 // resuelto por el slug público, NUNCA del body
 *     clientId: cliente?.id ?? null, // o phone si todavía no existe la ficha
 *     phone: "5512345678",
 *     serviceIds: ["svc_1", "svc_2"],
 *   });
 *   q.required === true  ->  muestra q.policyText y cobra q.amount
 */
export async function quoteDepositForBooking(args: {
  barbershopId: string;
  clientId?: string | null;
  phone?: string | null;
  /** Servicios elegidos: el total se calcula del catálogo, nunca del cliente. */
  serviceIds?: string[];
  /** Alternativa si quien llama ya tiene el total (en pesos). */
  serviceTotal?: number | string | null;
  locale?: string;
}): Promise<DepositQuoteForBooking> {
  const shopId = requireShop(args.barbershopId);
  const { policy } = await getBarberPaymentSettings(shopId);

  // Total de servicios: SIEMPRE del catálogo de la barbería.
  let totalCents = 0;
  if (args.serviceIds && args.serviceIds.length > 0) {
    const services = await prisma.barberService.findMany({
      where: { barbershopId: shopId, id: { in: args.serviceIds } },
      select: { price: true },
    });
    for (const s of services) totalCents += moneyToCents(s.price.toString());
  } else if (args.serviceTotal !== undefined && args.serviceTotal !== null) {
    totalCents = moneyToCents(args.serviceTotal);
  }

  // Cliente: por id o, si la ficha aún no existe, por teléfono.
  let clientId = args.clientId ?? null;
  if (!clientId && args.phone) {
    const digits = args.phone.replace(/\D/g, "");
    if (digits) {
      const found = await prisma.barberClient.findFirst({
        where: { barbershopId: shopId, phone: digits },
        select: { id: true },
      });
      clientId = found?.id ?? null;
    }
  }

  const stats = await getClientDepositStats(shopId, clientId);
  const q = quoteDeposit(policy, totalCents, stats);

  return {
    required: q.required,
    amount: centsToNumber(q.amountCents),
    amountCents: q.amountCents,
    reason: q.reason,
    policyText: describeDepositPolicy(policy, {
      amountCents: q.amountCents,
      currency: BARBER_CURRENCY,
      locale: args.locale,
    }),
    onlineAvailable: policy.onlineEnabled && isBarberStripeConfigured(),
    currency: BARBER_CURRENCY,
    refundWindowHours: policy.refundWindowHours,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Cobro del anticipo
// ═══════════════════════════════════════════════════════════════════════

async function loadAppointmentForDeposit(barbershopId: string, appointmentId: string) {
  const appt = await prisma.barberAppointment.findFirst({
    where: { id: appointmentId, barbershopId },
    select: {
      id: true,
      clientId: true,
      clientName: true,
      startAt: true,
      status: true,
      depositAmount: true,
      depositStatus: true,
      notes: true,
      client: { select: { id: true, name: true, email: true, phone: true } },
      services: { select: { priceAtBooking: true } },
      barbershop: { select: { name: true, locale: true } },
    },
  });
  if (!appt) {
    throw new BarberPaymentsError("APPOINTMENT_NOT_FOUND", "No encontramos esa cita.", 404);
  }
  return appt;
}

export interface StartDepositResult {
  /** URL de Stripe Checkout (mode "checkout"). */
  url: string | null;
  /** clientSecret del PaymentIntent (mode "intent"). */
  clientSecret: string | null;
  amount: number;
  amountCents: number;
  policyText: string;
  currency: string;
}

/**
 * ═══ PARA T5 (reserva pública) ═══
 * Arranca el cobro del anticipo de una cita ya creada. Deja la cita en
 * depositAmount = monto y depositStatus = PENDING, y devuelve la URL de
 * Stripe Checkout (mode "checkout", cero UI que construir) o el clientSecret
 * si prefieres montar el formulario de tarjeta (mode "intent").
 *
 * El anticipo pasa a PAID SOLO cuando Stripe confirma el cobro
 * (payment_intent.succeeded en /api/barber/payments/webhook). Nunca desde el
 * navegador.
 */
export async function startDepositPayment(args: {
  barbershopId: string;
  appointmentId: string;
  mode?: "checkout" | "intent";
  successUrl?: string;
  cancelUrl?: string;
  locale?: string;
}): Promise<StartDepositResult> {
  const shopId = requireShop(args.barbershopId);
  const stripe = requireStripe();
  const { policy } = await getBarberPaymentSettings(shopId);

  if (!policy.enabled || !policy.onlineEnabled) {
    throw new BarberPaymentsError(
      "ONLINE_DEPOSIT_DISABLED",
      "Esta barbería no cobra anticipos en línea.",
      409,
    );
  }

  const appt = await loadAppointmentForDeposit(shopId, args.appointmentId);
  if (appt.depositStatus === "PAID") {
    throw new BarberPaymentsError("ALREADY_PAID", "Este anticipo ya está pagado.", 409);
  }

  // El monto se recalcula en el servidor SIEMPRE (jamás del cliente).
  let totalCents = 0;
  for (const s of appt.services) totalCents += moneyToCents(s.priceAtBooking.toString());
  const stats = await getClientDepositStats(shopId, appt.clientId);
  const q = quoteDeposit(policy, totalCents, stats);

  if (!q.required || q.amountCents <= 0) {
    throw new BarberPaymentsError(
      "NO_DEPOSIT_REQUIRED",
      "Esta cita no necesita anticipo.",
      409,
    );
  }
  if (!isChargeableAmount(q.amountCents, BARBER_CURRENCY)) {
    throw new BarberPaymentsError(
      "AMOUNT_TOO_LOW",
      `El anticipo mínimo que acepta el cobro con tarjeta es ${formatCents(1000)}.`,
    );
  }

  const policyText = describeDepositPolicy(policy, {
    amountCents: q.amountCents,
    currency: BARBER_CURRENCY,
    locale: args.locale ?? appt.barbershop.locale,
  });

  await prisma.barberAppointment.updateMany({
    where: { id: appt.id, barbershopId: shopId },
    data: {
      depositAmount: new Prisma.Decimal(centsToMoney(q.amountCents)),
      depositStatus: "PENDING",
    },
  });

  const metadata = buildDepositMetadata({
    barbershopId: shopId,
    appointmentId: appt.id,
    clientId: appt.clientId,
  });
  const transfer = policy.stripeAccountId
    ? { transfer_data: { destination: policy.stripeAccountId } }
    : {};
  const label = `${appt.barbershop.name} — anticipo de tu cita`;

  if ((args.mode ?? "checkout") === "intent") {
    const pi = await stripe.paymentIntents.create({
      amount: toStripeAmount(q.amountCents),
      currency: BARBER_CURRENCY.toLowerCase(),
      description: label,
      metadata,
      automatic_payment_methods: { enabled: true },
      ...(transfer as any),
    });
    return {
      url: null,
      clientSecret: pi.client_secret,
      amount: centsToNumber(q.amountCents),
      amountCents: q.amountCents,
      policyText,
      currency: BARBER_CURRENCY,
    };
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: BARBER_CURRENCY.toLowerCase(),
          unit_amount: toStripeAmount(q.amountCents),
          product_data: { name: label, description: policyText.slice(0, 500) },
        },
      },
    ],
    // La metadata que importa va en el PaymentIntent: nuestro webhook
    // escucha payment_intent.*, jamás checkout.session.* (eso es de T6).
    payment_intent_data: { metadata, ...(transfer as any) },
    metadata,
    customer_email: appt.client?.email ?? undefined,
    success_url: args.successUrl ?? `${resolveBaseUrl()}/b?anticipo=ok`,
    cancel_url: args.cancelUrl ?? `${resolveBaseUrl()}/b?anticipo=cancelado`,
  });

  return {
    url: session.url,
    clientSecret: null,
    amount: centsToNumber(q.amountCents),
    amountCents: q.amountCents,
    policyText,
    currency: BARBER_CURRENCY,
  };
}

function resolveBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = raw || "https://www.dalecontrol.com";
  return base.startsWith("http") ? base.replace(/\/+$/, "") : `https://${base.replace(/\/+$/, "")}`;
}

/**
 * Anticipo cobrado EN MOSTRADOR (efectivo o transferencia). No pasa por
 * Stripe: la barbería lo registra y queda igual de válido que uno en línea.
 */
export async function markDepositPaidManually(args: {
  barbershopId: string;
  appointmentId: string;
  amount: number | string;
}): Promise<void> {
  const shopId = requireShop(args.barbershopId);
  const cents = moneyToCents(args.amount);
  if (cents <= 0) {
    throw new BarberPaymentsError("BAD_AMOUNT", "El monto del anticipo debe ser mayor a cero.");
  }
  const res = await prisma.barberAppointment.updateMany({
    where: { id: args.appointmentId, barbershopId: shopId },
    data: {
      depositAmount: new Prisma.Decimal(centsToMoney(cents)),
      depositStatus: "PAID",
    },
  });
  if (res.count === 0) {
    throw new BarberPaymentsError("APPOINTMENT_NOT_FOUND", "No encontramos esa cita.", 404);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Aplicar el anticipo al ticket — UNA sola vez
// ═══════════════════════════════════════════════════════════════════════

export interface DepositApplication {
  applied: boolean;
  reason: "APPLIED" | "NO_DEPOSIT" | "NOT_PAID" | "ALREADY_APPLIED" | "SALE_NOT_FOUND";
  amount: number;
  amountCents: number;
  creditLine: { description: string; unitPriceCents: number; qty: number } | null;
}

/** ¿Qué anticipo trae esta cita? SOLO LECTURA. */
export async function previewDepositForSale(args: {
  barbershopId: string;
  appointmentId: string;
}): Promise<DepositApplication> {
  const shopId = requireShop(args.barbershopId);
  const appt = await prisma.barberAppointment.findFirst({
    where: { id: args.appointmentId, barbershopId: shopId },
    select: { id: true, depositAmount: true, depositStatus: true, startAt: true },
  });
  if (!appt) throw new BarberPaymentsError("APPOINTMENT_NOT_FOUND", "No encontramos esa cita.", 404);

  const cents = appt.depositAmount ? moneyToCents(appt.depositAmount.toString()) : 0;
  if (cents <= 0) return { applied: false, reason: "NO_DEPOSIT", amount: 0, amountCents: 0, creditLine: null };
  if (appt.depositStatus !== "PAID") {
    return { applied: false, reason: "NOT_PAID", amount: centsToNumber(cents), amountCents: cents, creditLine: null };
  }

  const already = await prisma.barberSaleItem.count({
    where: {
      sale: { appointmentId: appt.id, barbershopId: shopId },
      description: { startsWith: BARBER_DEPOSIT_LINE_PREFIX },
    },
  });
  if (already > 0) {
    return {
      applied: false,
      reason: "ALREADY_APPLIED",
      amount: centsToNumber(cents),
      amountCents: cents,
      creditLine: null,
    };
  }

  return {
    applied: false,
    reason: "APPLIED",
    amount: centsToNumber(cents),
    amountCents: cents,
    creditLine: {
      description: depositLineDescription(formatDepositLabel(appt.startAt)),
      unitPriceCents: -cents,
      qty: 1,
    },
  };
}

function formatDepositLabel(startAt: Date): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(startAt);
  } catch {
    return startAt.toISOString().slice(0, 10);
  }
}

/**
 * ═══ PUNTO DE ENTRADA DE T3 (ticket y caja) ═══
 *
 * Aplica el anticipo pagado al ticket de la visita como una línea de crédito
 * negativa. **No se puede aplicar dos veces**: la operación corre dentro de
 * una transacción que bloquea la fila de la cita (SELECT ... FOR UPDATE) y
 * revisa si algún ticket de esa cita ya trae la línea de anticipo. Dos
 * llamadas simultáneas → una aplica, la otra devuelve ALREADY_APPLIED.
 *
 *   const dep = await applyDepositToSale({ barbershopId: ctx.barbershopId,
 *                                          appointmentId, saleId: sale.id });
 *   dep.applied === true -> recalcula subtotal/total del ticket desde las líneas
 *
 * El total del ticket NO se recalcula aquí (es de T3): la línea es negativa y
 * las líneas son la fuente de verdad.
 */
export async function applyDepositToSale(args: {
  barbershopId: string;
  appointmentId: string;
  saleId: string;
}): Promise<DepositApplication> {
  const shopId = requireShop(args.barbershopId);

  return prisma.$transaction(async (tx) => {
    // 1. Candado sobre la cita: serializa a quien llegue al mismo tiempo.
    const locked = await tx.$queryRaw<
      { id: string; depositAmount: string | null; depositStatus: string | null; startAt: Date }[]
    >`
      SELECT "id", "depositAmount"::text AS "depositAmount", "depositStatus"::text AS "depositStatus", "startAt"
      FROM "barber_appointments"
      WHERE "id" = ${args.appointmentId} AND "barbershopId" = ${shopId}
      FOR UPDATE
    `;
    const appt = locked[0];
    if (!appt) {
      throw new BarberPaymentsError("APPOINTMENT_NOT_FOUND", "No encontramos esa cita.", 404);
    }

    const cents = moneyToCents(appt.depositAmount);
    if (cents <= 0) {
      return { applied: false, reason: "NO_DEPOSIT" as const, amount: 0, amountCents: 0, creditLine: null };
    }
    if (appt.depositStatus !== "PAID") {
      return {
        applied: false,
        reason: "NOT_PAID" as const,
        amount: centsToNumber(cents),
        amountCents: cents,
        creditLine: null,
      };
    }

    // 2. ¿Ya se aplicó en algún ticket de esta visita?
    const already = await tx.barberSaleItem.count({
      where: {
        sale: { appointmentId: appt.id, barbershopId: shopId },
        description: { startsWith: BARBER_DEPOSIT_LINE_PREFIX },
      },
    });
    if (already > 0) {
      return {
        applied: false,
        reason: "ALREADY_APPLIED" as const,
        amount: centsToNumber(cents),
        amountCents: cents,
        creditLine: null,
      };
    }

    // 3. El ticket debe ser de esta barbería y de esta cita.
    const sale = await tx.barberSale.findFirst({
      where: { id: args.saleId, barbershopId: shopId, appointmentId: appt.id },
      select: { id: true },
    });
    if (!sale) {
      return {
        applied: false,
        reason: "SALE_NOT_FOUND" as const,
        amount: centsToNumber(cents),
        amountCents: cents,
        creditLine: null,
      };
    }

    const description = depositLineDescription(formatDepositLabel(appt.startAt));
    await tx.barberSaleItem.create({
      data: {
        saleId: sale.id,
        serviceId: null,
        productId: null,
        description,
        qty: 1,
        unitPrice: new Prisma.Decimal(centsToMoney(-cents)),
      },
    });

    return {
      applied: true,
      reason: "APPLIED" as const,
      amount: centsToNumber(cents),
      amountCents: cents,
      creditLine: { description, unitPriceCents: -cents, qty: 1 },
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// No llegó: retener o devolver
// ═══════════════════════════════════════════════════════════════════════

async function appendAppointmentNote(
  barbershopId: string,
  appointmentId: string,
  line: string,
): Promise<void> {
  // Se ANEXA (nunca se reemplaza) para dejar rastro visible en la agenda.
  const appt = await prisma.barberAppointment.findFirst({
    where: { id: appointmentId, barbershopId },
    select: { notes: true },
  });
  const prev = appt?.notes ? `${appt.notes}\n` : "";
  await prisma.barberAppointment.updateMany({
    where: { id: appointmentId, barbershopId },
    data: { notes: `${prev}${line}`.slice(0, 4000) },
  });
}

export interface DepositDecisionResult {
  status: "REFUNDED" | "FORFEITED";
  amount: number;
  /** true si además se devolvió el dinero por Stripe. */
  refundedOnline: boolean;
}

/**
 * Devuelve el anticipo. Si se cobró con tarjeta busca su PaymentIntent por
 * metadata y ejecuta el reembolso en Stripe; si se cobró en mostrador solo
 * deja el registro (el dinero lo devuelve la barbería en caja).
 */
export async function refundDeposit(args: {
  barbershopId: string;
  appointmentId: string;
  actorName?: string;
}): Promise<DepositDecisionResult> {
  const shopId = requireShop(args.barbershopId);
  const appt = await prisma.barberAppointment.findFirst({
    where: { id: args.appointmentId, barbershopId: shopId },
    select: { id: true, depositAmount: true, depositStatus: true },
  });
  if (!appt) throw new BarberPaymentsError("APPOINTMENT_NOT_FOUND", "No encontramos esa cita.", 404);
  if (appt.depositStatus !== "PAID") {
    throw new BarberPaymentsError(
      "NOT_PAID",
      "Solo se puede devolver un anticipo que ya está pagado.",
      409,
    );
  }

  const cents = appt.depositAmount ? moneyToCents(appt.depositAmount.toString()) : 0;
  let refundedOnline = false;

  const stripe = getBarberStripe();
  if (stripe) {
    try {
      const found = await stripe.paymentIntents.search({
        query: `metadata["dcbAppt"]:"${appt.id}" AND status:"succeeded"`,
        limit: 1,
      });
      const pi = found.data[0];
      if (pi) {
        await stripe.refunds.create({ payment_intent: pi.id });
        refundedOnline = true;
      }
    } catch {
      // Sin búsqueda disponible o sin cargo en línea: se registra igual y la
      // barbería devuelve en efectivo. Nunca bloquea la decisión del dueño.
      refundedOnline = false;
    }
  }

  await prisma.barberAppointment.updateMany({
    where: { id: appt.id, barbershopId: shopId, depositStatus: "PAID" },
    data: { depositStatus: "REFUNDED" },
  });
  await appendAppointmentNote(
    shopId,
    appt.id,
    `[Anticipo] Devuelto ${formatCents(cents)}${refundedOnline ? " (reembolso en Stripe)" : " (en mostrador)"} — ${new Date().toLocaleDateString("es-MX")}${args.actorName ? ` · ${args.actorName}` : ""}`,
  );

  return { status: "REFUNDED", amount: centsToNumber(cents), refundedOnline };
}

/** Retiene el anticipo (el cliente no llegó y la barbería se lo queda). */
export async function forfeitDeposit(args: {
  barbershopId: string;
  appointmentId: string;
  actorName?: string;
}): Promise<DepositDecisionResult> {
  const shopId = requireShop(args.barbershopId);
  const appt = await prisma.barberAppointment.findFirst({
    where: { id: args.appointmentId, barbershopId: shopId },
    select: { id: true, depositAmount: true, depositStatus: true },
  });
  if (!appt) throw new BarberPaymentsError("APPOINTMENT_NOT_FOUND", "No encontramos esa cita.", 404);
  if (appt.depositStatus !== "PAID") {
    throw new BarberPaymentsError(
      "NOT_PAID",
      "Solo se puede retener un anticipo que ya está pagado.",
      409,
    );
  }

  const cents = appt.depositAmount ? moneyToCents(appt.depositAmount.toString()) : 0;
  await prisma.barberAppointment.updateMany({
    where: { id: appt.id, barbershopId: shopId, depositStatus: "PAID" },
    data: { depositStatus: "FORFEITED" },
  });
  await appendAppointmentNote(
    shopId,
    appt.id,
    `[Anticipo] Retenido ${formatCents(cents)} — ${new Date().toLocaleDateString("es-MX")}${args.actorName ? ` · ${args.actorName}` : ""}`,
  );

  return { status: "FORFEITED", amount: centsToNumber(cents), refundedOnline: false };
}

/** ¿La cita sigue dentro de la ventana de cancelación sin costo? */
export async function isDepositRefundableNow(args: {
  barbershopId: string;
  appointmentId: string;
}): Promise<boolean> {
  const shopId = requireShop(args.barbershopId);
  const { policy } = await getBarberPaymentSettings(shopId);
  const appt = await prisma.barberAppointment.findFirst({
    where: { id: args.appointmentId, barbershopId: shopId },
    select: { startAt: true },
  });
  if (!appt) return false;
  return isWithinRefundWindow(policy, appt.startAt, new Date());
}

// ═══════════════════════════════════════════════════════════════════════
// Listas de anticipos (panel y portal del cliente)
// ═══════════════════════════════════════════════════════════════════════

export type DepositListFilter = "all" | "pending" | "paid" | "closed";

export async function listDeposits(
  barbershopId: string,
  opts: { filter?: DepositListFilter; take?: number } = {},
): Promise<BarberDepositView[]> {
  const shopId = requireShop(barbershopId);
  const filter = opts.filter ?? "all";

  const where: Prisma.BarberAppointmentWhereInput = {
    barbershopId: shopId,
    depositStatus: { not: null },
  };
  if (filter === "pending") where.depositStatus = "PENDING";
  else if (filter === "paid") where.depositStatus = "PAID";
  else if (filter === "closed") where.depositStatus = { in: ["REFUNDED", "FORFEITED"] };

  const rows = await prisma.barberAppointment.findMany({
    where,
    select: {
      id: true,
      clientId: true,
      clientName: true,
      startAt: true,
      status: true,
      depositAmount: true,
      depositStatus: true,
      client: { select: { name: true } },
      sales: { select: { items: { select: { description: true } } } },
    },
    orderBy: { startAt: "desc" },
    take: Math.min(200, Math.max(1, opts.take ?? 60)),
  });

  return rows.map((r) => ({
    appointmentId: r.id,
    clientId: r.clientId,
    clientName: r.client?.name ?? r.clientName ?? "Cliente",
    startAt: r.startAt.toISOString(),
    status: (r.depositStatus ?? "PENDING") as BarberDepositView["status"],
    amount: r.depositAmount ? Number(r.depositAmount) : 0,
    appointmentStatus: r.status,
    applied: r.sales.some((s) =>
      s.items.some((i) => i.description.startsWith(BARBER_DEPOSIT_LINE_PREFIX)),
    ),
  }));
}

/**
 * ═══ PARA T5 (portal del cliente) ═══
 * Los anticipos del cliente con su estado, para que vea qué pagó y en qué
 * quedó cada uno.
 */
export async function listClientDeposits(args: {
  barbershopId: string;
  clientId: string;
  take?: number;
}): Promise<BarberDepositView[]> {
  const shopId = requireShop(args.barbershopId);
  const rows = await prisma.barberAppointment.findMany({
    where: { barbershopId: shopId, clientId: args.clientId, depositStatus: { not: null } },
    select: {
      id: true,
      clientId: true,
      clientName: true,
      startAt: true,
      status: true,
      depositAmount: true,
      depositStatus: true,
      client: { select: { name: true } },
      sales: { select: { items: { select: { description: true } } } },
    },
    orderBy: { startAt: "desc" },
    take: Math.min(50, Math.max(1, args.take ?? 20)),
  });

  return rows.map((r) => ({
    appointmentId: r.id,
    clientId: r.clientId,
    clientName: r.client?.name ?? r.clientName ?? "Cliente",
    startAt: r.startAt.toISOString(),
    status: (r.depositStatus ?? "PENDING") as BarberDepositView["status"],
    amount: r.depositAmount ? Number(r.depositAmount) : 0,
    appointmentStatus: r.status,
    applied: r.sales.some((s) =>
      s.items.some((i) => i.description.startsWith(BARBER_DEPOSIT_LINE_PREFIX)),
    ),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// Membresía cobrada con TARJETA (suscripción real de Stripe)
// ═══════════════════════════════════════════════════════════════════════

export interface MembershipCheckoutResult {
  url: string;
  sessionId: string;
}

/**
 * Cobro de la membresía con tarjeta. `recurring: true` crea una SUSCRIPCIÓN
 * real (se renueva sola cada periodDays); `false` cobra una sola vez y la
 * membresía vence normal.
 *
 * La fila BarberClientMembership NO se crea aquí: nace cuando Stripe
 * confirma el cobro (webhook payment_intent.succeeded o el sync de retorno),
 * así nunca queda una membresía activa sin dinero detrás.
 */
export async function createMembershipCheckoutSession(args: {
  barbershopId: string;
  clientId: string;
  membershipId: string;
  recurring?: boolean;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<MembershipCheckoutResult> {
  const shopId = requireShop(args.barbershopId);
  const stripe = requireStripe();

  const [client, plan, shop] = await Promise.all([
    prisma.barberClient.findFirst({
      where: { id: args.clientId, barbershopId: shopId },
      select: { id: true, name: true, email: true },
    }),
    prisma.barberMembership.findFirst({
      where: { id: args.membershipId, barbershopId: shopId, isActive: true },
      select: { id: true, name: true, description: true, price: true, periodDays: true },
    }),
    prisma.barbershop.findFirst({ where: { id: shopId }, select: { name: true } }),
  ]);

  if (!client) throw new BarberPaymentsError("CLIENT_NOT_FOUND", "No encontramos a ese cliente.", 404);
  if (!plan) throw new BarberPaymentsError("PLAN_NOT_FOUND", "No encontramos esa membresía.", 404);

  const cents = moneyToCents(plan.price.toString());
  if (!isChargeableAmount(cents, BARBER_CURRENCY)) {
    throw new BarberPaymentsError(
      "AMOUNT_TOO_LOW",
      `El cobro con tarjeta necesita un precio de al menos ${formatCents(1000)}.`,
    );
  }

  const { policy } = await getBarberPaymentSettings(shopId);
  const metadata = buildMembershipMetadata({
    barbershopId: shopId,
    clientId: client.id,
    membershipId: plan.id,
  });
  const recurring = args.recurring !== false;
  const base = resolveBaseUrl();
  const productName = `${plan.name} — ${shop?.name ?? "Barbería"}`;

  const session = await stripe.checkout.sessions.create({
    mode: recurring ? "subscription" : "payment",
    customer_email: client.email ?? undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: BARBER_CURRENCY.toLowerCase(),
          unit_amount: toStripeAmount(cents),
          product_data: {
            name: productName,
            ...(plan.description ? { description: plan.description.slice(0, 500) } : {}),
          },
          ...(recurring ? { recurring: toStripeRecurring(plan.periodDays) } : {}),
        } as any,
      },
    ],
    metadata,
    ...(recurring
      ? {
          subscription_data: {
            metadata,
            ...(policy.stripeAccountId
              ? { transfer_data: { destination: policy.stripeAccountId } }
              : {}),
          } as any,
        }
      : {
          payment_intent_data: {
            metadata,
            ...(policy.stripeAccountId
              ? { transfer_data: { destination: policy.stripeAccountId } }
              : {}),
          } as any,
        }),
    success_url:
      args.successUrl ?? `${base}/barber/membresias?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: args.cancelUrl ?? `${base}/barber/membresias?checkout=cancelado`,
  });

  if (!session.url) {
    throw new BarberPaymentsError("CHECKOUT_FAILED", "Stripe no devolvió la liga de pago.", 502);
  }
  return { url: session.url, sessionId: session.id };
}

/**
 * Confirma al volver de Stripe Checkout. Es idempotente y redundante con el
 * webhook a propósito: si el cliente cierra la pestaña, el webhook activa la
 * membresía igual; si el webhook tarda, esto la activa al instante.
 */
export async function syncMembershipCheckout(args: {
  barbershopId: string;
  sessionId: string;
}): Promise<{ activated: boolean }> {
  const shopId = requireShop(args.barbershopId);
  const stripe = getBarberStripe();
  if (!stripe) return { activated: false };

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(args.sessionId);
  } catch {
    return { activated: false };
  }

  const meta = (session.metadata ?? {}) as Record<string, string>;
  if (meta.dcb !== DCB_KIND_MEMBERSHIP || meta.dcbShop !== shopId) return { activated: false };
  if (session.payment_status !== "paid") return { activated: false };

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription as any)?.id ?? null;

  let periodEnd: Date | null = null;
  if (subscriptionId) {
    try {
      const sub: any = await stripe.subscriptions.retrieve(subscriptionId);
      if (sub?.current_period_end) periodEnd = new Date(sub.current_period_end * 1000);
    } catch {
      periodEnd = null;
    }
  }

  await activateStripeMembership({
    barbershopId: shopId,
    clientId: meta.dcbClient,
    membershipId: meta.dcbPlan,
    subscriptionId,
    periodEnd,
  });
  return { activated: true };
}

/** Cancela la suscripción en Stripe (la fila se marca CANCELLED aparte). */
export async function cancelMembershipSubscription(args: {
  barbershopId: string;
  clientMembershipId: string;
}): Promise<{ cancelled: boolean }> {
  const shopId = requireShop(args.barbershopId);
  const row = await prisma.barberClientMembership.findFirst({
    where: { id: args.clientMembershipId, barbershopId: shopId },
    select: { stripeSubscriptionId: true },
  });
  if (!row?.stripeSubscriptionId) return { cancelled: false };

  const stripe = getBarberStripe();
  if (!stripe) return { cancelled: false };
  try {
    await stripe.subscriptions.cancel(row.stripeSubscriptionId);
    return { cancelled: true };
  } catch {
    return { cancelled: false };
  }
}

/**
 * Crea o extiende la membresía del cliente a partir de un cobro confirmado
 * por Stripe. Idempotente: dos entregas del mismo evento no duplican filas ni
 * regalan un periodo extra (se compara contra el fin de periodo que manda
 * Stripe).
 */
async function activateStripeMembership(args: {
  barbershopId: string;
  clientId: string | undefined;
  membershipId: string | undefined;
  subscriptionId: string | null;
  periodEnd: Date | null;
}): Promise<void> {
  const { barbershopId, clientId, membershipId, subscriptionId } = args;
  if (!barbershopId || !clientId || !membershipId) return;

  // El plan Y el cliente tienen que ser de ESA barbería. La metadata la
  // ponemos nosotros al crear el cobro, pero igual se verifica: es la única
  // ruta de escritura que no nace de una sesión del panel.
  const [plan, client] = await Promise.all([
    prisma.barberMembership.findFirst({
      where: { id: membershipId, barbershopId },
      select: { id: true, periodDays: true },
    }),
    prisma.barberClient.findFirst({
      where: { id: clientId, barbershopId },
      select: { id: true },
    }),
  ]);
  if (!plan || !client) return;

  const now = new Date();
  const endAt =
    args.periodEnd ?? new Date(now.getTime() + Math.max(1, plan.periodDays) * 86_400_000);

  // El webhook y el retorno de Checkout pueden llegar a la vez para el MISMO
  // cobro. Un lock de asesoría por suscripción (o por cliente+plan si todavía
  // no hay suscripción) los serializa: nunca se crean dos filas.
  const lockKey = `dcb:mem:${subscriptionId ?? `${barbershopId}:${clientId}:${membershipId}`}`;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // 1. ¿Ya existe la fila de ESTA suscripción de Stripe?
    const existing = subscriptionId
      ? await tx.barberClientMembership.findFirst({
          where: { barbershopId, stripeSubscriptionId: subscriptionId },
          select: { id: true, endAt: true },
        })
      : null;

    if (existing) {
      // Idempotencia: si ya está extendida a ese periodo, no hacemos nada.
      if (existing.endAt.getTime() >= endAt.getTime()) return;
      await tx.barberClientMembership.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", startAt: existing.endAt, endAt, cutsUsed: 0 },
      });
      return;
    }

    // 2. ¿Tiene una vigente del mismo plan sin suscripción ligada? La adoptamos
    //    (es el mismo cobro entrando por el otro camino, o una membresía que
    //    se pagó en mostrador y ahora se pasa a tarjeta).
    const orphan = await tx.barberClientMembership.findFirst({
      where: {
        barbershopId,
        clientId,
        membershipId,
        status: "ACTIVE",
        endAt: { gt: now },
        stripeSubscriptionId: null,
      },
      select: { id: true, endAt: true },
    });
    if (orphan) {
      await tx.barberClientMembership.update({
        where: { id: orphan.id },
        data: {
          endAt: orphan.endAt.getTime() >= endAt.getTime() ? orphan.endAt : endAt,
          stripeSubscriptionId: subscriptionId,
          paymentMethod: "STRIPE",
        },
      });
      return;
    }

    // 3. Nueva.
    await tx.barberClientMembership.create({
      data: {
        barbershopId,
        clientId,
        membershipId,
        status: "ACTIVE",
        startAt: now,
        endAt,
        cutsUsed: 0,
        paymentMethod: "STRIPE",
        stripeSubscriptionId: subscriptionId,
      },
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Webhook — SOLO payment_intent.*
// ═══════════════════════════════════════════════════════════════════════

export interface BarberWebhookOutcome {
  received: true;
  handled: "deposit_paid" | "deposit_failed" | "membership_activated" | "ignored";
  eventType: string;
}

/**
 * Procesa el webhook de /api/barber/payments/webhook.
 *
 * Escucha EXACTAMENTE estos eventos y ningún otro:
 *   payment_intent.succeeded · payment_intent.payment_failed · payment_intent.canceled
 *
 * La cuenta de Stripe es la misma que usa el SaaS, así que aquí también caen
 * PaymentIntents de T6: todo lo que no traiga nuestro namespace `dcb` (o no
 * corresponda a una suscripción de membresía nuestra) se IGNORA sin tocar
 * nada. Y como T6 no escucha payment_intent.*, ningún evento se procesa dos
 * veces.
 */
export async function handleBarberPaymentsWebhook(
  rawBody: string,
  signature: string | null,
): Promise<BarberWebhookOutcome> {
  const stripe = requireStripe();
  const secret = process.env.BARBER_PAYMENTS_STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new BarberPaymentsError(
      "WEBHOOK_NOT_CONFIGURED",
      "Falta BARBER_PAYMENTS_STRIPE_WEBHOOK_SECRET.",
      500,
    );
  }
  if (!signature) {
    throw new BarberPaymentsError("NO_SIGNATURE", "Falta la firma de Stripe.", 400);
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new BarberPaymentsError("BAD_SIGNATURE", "Firma inválida.", 400);
  }

  // Candado de frontera: aunque alguien suscriba tipos de más en el
  // dashboard, aquí NUNCA se procesa nada fuera de nuestra lista.
  if (!isOurWebhookEvent(event.type)) {
    return { received: true, handled: "ignored", eventType: event.type };
  }

  const pi = event.data.object as Stripe.PaymentIntent;
  const kind = classifyPaymentIntent(pi as any);
  const meta = (pi.metadata ?? {}) as Record<string, string>;

  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
    if (kind === "deposit" && meta.dcbShop && meta.dcbAppt) {
      // El anticipo sigue PENDING: la cita queda sin apartar y la barbería lo
      // ve en la lista de anticipos pendientes.
      return { received: true, handled: "deposit_failed", eventType: event.type };
    }
    return { received: true, handled: "ignored", eventType: event.type };
  }

  // payment_intent.succeeded
  if (kind === "deposit") {
    if (!meta.dcbShop || !meta.dcbAppt) {
      return { received: true, handled: "ignored", eventType: event.type };
    }
    await prisma.barberAppointment.updateMany({
      where: {
        id: meta.dcbAppt,
        barbershopId: meta.dcbShop,
        OR: [{ depositStatus: "PENDING" }, { depositStatus: null }],
      },
      data: {
        depositStatus: "PAID",
        depositAmount: new Prisma.Decimal(centsToMoney(pi.amount_received || pi.amount || 0)),
      },
    });
    return { received: true, handled: "deposit_paid", eventType: event.type };
  }

  if (kind === "membership") {
    await activateStripeMembership({
      barbershopId: meta.dcbShop,
      clientId: meta.dcbClient,
      membershipId: meta.dcbPlan,
      subscriptionId: null,
      periodEnd: null,
    });
    return { received: true, handled: "membership_activated", eventType: event.type };
  }

  if (kind === "membership_invoice") {
    // Renovación de una suscripción de membresía: la factura nos lleva a la
    // suscripción, y su metadata dice si es NUESTRA. Si no lo es (es del SaaS
    // de T6), se ignora.
    // `invoice` no está en los tipos de la versión de API que fijamos, pero
    // el objeto real sí lo trae cuando el cobro viene de una factura.
    const rawInvoice = (pi as any).invoice;
    const invoiceId = typeof rawInvoice === "string" ? rawInvoice : rawInvoice?.id;
    if (!invoiceId) return { received: true, handled: "ignored", eventType: event.type };

    try {
      const invoice: any = await stripe.invoices.retrieve(invoiceId);
      const subId: string | null =
        (typeof invoice?.subscription === "string" ? invoice.subscription : invoice?.subscription?.id) ??
        invoice?.parent?.subscription_details?.subscription ??
        null;
      if (!subId) return { received: true, handled: "ignored", eventType: event.type };

      const sub: any = await stripe.subscriptions.retrieve(subId);
      const subMeta = (sub?.metadata ?? {}) as Record<string, string>;
      if (subMeta.dcb !== DCB_KIND_MEMBERSHIP) {
        return { received: true, handled: "ignored", eventType: event.type };
      }

      await activateStripeMembership({
        barbershopId: subMeta.dcbShop,
        clientId: subMeta.dcbClient,
        membershipId: subMeta.dcbPlan,
        subscriptionId: subId,
        periodEnd: sub?.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      });
      return { received: true, handled: "membership_activated", eventType: event.type };
    } catch {
      return { received: true, handled: "ignored", eventType: event.type };
    }
  }

  return { received: true, handled: "ignored", eventType: event.type };
}

/** Lista de eventos que Rafael debe marcar en el endpoint de Stripe. */
export const BARBER_PAYMENTS_STRIPE_EVENTS = BARBER_PAYMENTS_WEBHOOK_EVENTS;

// ── Re-export del núcleo puro: las otras terminales importan SOLO de aquí. ──
export * from "@/lib/barber/payments-core";
