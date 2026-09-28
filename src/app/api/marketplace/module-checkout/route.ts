import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { ivaParaCobro } from "@/lib/billing/iva-cobro";
import {
  hasActiveAccess,
  resolveModulePriceMxn,
  MODULE_SUBSCRIPTION_KIND,
  type ModuleBillingCycle,
} from "@/lib/marketplace/module-purchase-core";
import { getModuleAnnualPriceMxn } from "@/lib/marketplace/module-annual-price";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  moduleKey: z.string().min(1),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
  method: z.enum(["card", "spei", "oxxo"]).default("card"),
});

/**
 * POST /api/marketplace/module-checkout
 *
 * Crea una Stripe Checkout Session para que la clínica del usuario compre
 * UN módulo del marketplace directo (sin pasar por el carrito multi-módulo
 * de Sprint 2, que sigue sin checkout — ver src/lib/marketplace/pricing.ts).
 *
 * - Auth: getCurrentUser. Multi-tenant: clinicId SIEMPRE de la sesión.
 * - Precio: `Module.priceMxnMonthly` / columna cruda `price_mxn_annual`
 *   (fuente única — nunca hardcodeado aquí). `price_data` dinámico: no
 *   hace falta crear Price/Product en el Dashboard de Stripe.
 * - IVA: SIEMPRE se cobra (STRIPE_IVA_TAX_RATE_ID / Stripe Tax). La
 *   exención de clínicas de antes del 26-sep-2026 (`iva-cobro.ts`) es POR
 *   PLAN de la clínica — un módulo no es "su mismo plan", así que nunca
 *   aplica aquí. Confirmado leyendo el código antes de escribir esto.
 * - Si la clínica YA tiene el módulo activo (comprado o "admin"), 409: no
 *   se genera ninguna sesión — así una activación "admin" (Rafael Clínica,
 *   clínica de prueba) nunca puede pisarse con una compra real.
 * - Webhook: la activación real ocurre en /api/webhooks/stripe cuando
 *   llega `checkout.session.completed` (tarjeta) o
 *   `checkout.session.async_payment_succeeded` (SPEI/OXXO) con
 *   `metadata.kind === "module-subscription"`.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
  }
  const { moduleKey, billing, method } = parsed.data;

  const stripe = getStripeSafe();
  if (!stripe) return NextResponse.json(stripeUnavailableResponse(), { status: 503 });

  const mod = await prisma.module.findUnique({ where: { key: moduleKey } });
  if (!mod || !mod.isActive) {
    return NextResponse.json({ error: "Módulo no disponible" }, { status: 404 });
  }

  const priceMxnAnnual = await getModuleAnnualPriceMxn(prisma, mod.id);
  const price = resolveModulePriceMxn(
    { priceMxnMonthly: mod.priceMxnMonthly, priceMxnAnnual },
    billing as ModuleBillingCycle,
  );
  if (price.ok === false) return NextResponse.json({ error: price.error }, { status: 400 });

  const existing = await prisma.clinicModule.findUnique({
    where: { clinicId_moduleId: { clinicId, moduleId: mod.id } },
    select: { status: true, currentPeriodEnd: true },
  });
  if (hasActiveAccess(existing, new Date())) {
    return NextResponse.json(
      { error: "Esta clínica ya tiene este módulo activo.", alreadyActive: true },
      { status: 409 },
    );
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  let customerId = clinic.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: clinic.email ?? user.email ?? undefined,
      name: clinic.name,
      metadata: { clinicId: clinic.id, source: "mediflow" },
    });
    customerId = customer.id;
    await prisma.clinic.update({ where: { id: clinic.id }, data: { stripeCustomerId: customerId } });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(req.url).origin;

  // IVA de un módulo: SIEMPRE (nunca la exención de "clínica de antes", ver
  // el comentario del handler arriba). Sin STRIPE_IVA_TAX_RATE_ID /
  // STRIPE_AUTOMATIC_TAX configurados, 503 claro — nunca se cobra sin IVA
  // en silencio.
  const iva = ivaParaCobro(process.env);
  if (iva.ok === false) return NextResponse.json({ error: iva.error, code: iva.codigo }, { status: 503 });

  const unitAmount = price.amountMxn * 100;
  const meta = {
    clinicId: clinic.id,
    moduleKey: mod.key,
    kind: MODULE_SUBSCRIPTION_KIND,
    method,
    billing,
  };

  let session;
  if (method === "card") {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      customer_update: { address: "auto" },
      ...iva.sesion,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            unit_amount: unitAmount,
            recurring: { interval: billing === "annual" ? "year" : "month" },
            product_data: {
              name: `DaleControl · Módulo ${mod.name} — ${billing === "annual" ? "anual" : "mensual"}`,
              metadata: { moduleKey: mod.key },
            },
          },
          quantity: 1,
          ...iva.linea,
        },
      ],
      metadata: meta,
      subscription_data: { metadata: meta },
      success_url: `${baseUrl}/dashboard/marketplace?compra=${mod.key}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/dashboard/marketplace`,
    });
  } else {
    // SPEI/OXXO: pago ÚNICO de un periodo (Stripe no permite estos métodos
    // en mode "subscription"). No auto-renueva — para el siguiente periodo
    // la clínica vuelve a comprar, mismo patrón que /api/billing/checkout.
    const isSpei = method === "spei";
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_update: { address: "auto" },
      ...iva.sesion,
      payment_method_types: [isSpei ? "customer_balance" : "oxxo"],
      ...(isSpei
        ? { payment_method_options: { customer_balance: { funding_type: "bank_transfer", bank_transfer: { type: "mx_bank_transfer" } } } }
        : {}),
      line_items: [
        {
          price_data: {
            currency: "mxn",
            unit_amount: unitAmount,
            product_data: {
              name: `DaleControl · Módulo ${mod.name} — ${billing === "annual" ? "1 año" : "1 mes"}`,
              metadata: { moduleKey: mod.key },
            },
          },
          quantity: 1,
          ...iva.linea,
        },
      ],
      metadata: meta,
      payment_intent_data: { metadata: meta },
      success_url: `${baseUrl}/dashboard/marketplace?compra=${mod.key}&pendiente=${method}`,
      cancel_url: `${baseUrl}/dashboard/marketplace`,
    });
  }

  if (!session.url) {
    return NextResponse.json({ error: "Stripe no devolvió URL de checkout" }, { status: 502 });
  }

  const { ipAddress, userAgent } = extractAuditMeta(req);
  await logAudit({
    clinicId: clinic.id,
    userId: user.id,
    entityType: "subscription",
    entityId: session.id,
    action: "create",
    changes: {
      _created: {
        before: null,
        after: { moduleKey: mod.key, billing, method, amountMxn: price.amountMxn, sessionId: session.id },
      },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ url: session.url });
}
