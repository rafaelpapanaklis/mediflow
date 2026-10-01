import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { metadataMetaDePeticion } from "@/lib/analytics/meta-capi.server";
import { prisma } from "@/lib/prisma";
import { getStripeSafe, stripeUnavailableResponse } from "@/lib/stripe";
import { PLAN_IDS, type PlanId } from "@/lib/billing/plans";
import { getResolvedPlan } from "@/lib/plans";
import { CLINIC_OVERRIDE_SELECT, applyClinicOverrides } from "@/lib/billing/plan-overrides";
import { ensureFirstMonthCoupon, isFirstContract } from "@/lib/billing/first-month-promo";
import { ivaParaPagoDeClinica } from "@/lib/billing/iva-cobro";
import { exencionIvaDeClinica } from "@/lib/billing/iva-clinica";
import { logAudit, extractAuditMeta } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan: z.enum(PLAN_IDS),
  // Método de pago. "card" = suscripción que auto-renueva. "spei"/"oxxo" = pago
  // único (asíncrono, NO auto-renueva). Default "card" para no romper
  // a los llamadores existentes (p. ej. las tarjetas de /dashboard/suspended).
  method: z.enum(["card", "spei", "oxxo"]).default("card"),
  // Ciclo de facturación. "annual" = 35% de descuento (plan.priceMxnAnnual).
  // Default "monthly" para no romper a los llamadores existentes.
  billing: z.enum(["monthly", "annual"]).default("monthly"),
});

/**
 * POST /api/billing/checkout
 *
 * Crea una Stripe Checkout Session para que la clínica del usuario
 * activo renueve/active su suscripción a la plataforma DaleControl.
 *
 * - Auth: getCurrentUser (cualquier rol logueado).
 * - Multi-tenant: clinicId siempre se toma del contexto, NUNCA del body.
 * - Precio: tomado del módulo `lib/billing/plans` (single source of
 *   truth). Se crea con `price_data` dinámico para no requerir Price IDs
 *   pre-creados en el dashboard de Stripe.
 * - Webhook: la activación real se hace en
 *   `/api/webhooks/stripe` cuando llega `checkout.session.completed`
 *   con `metadata.kind === 'platform-subscription'`.
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
    return NextResponse.json(
      { error: "plan inválido", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const stripe = getStripeSafe();
  if (!stripe) {
    return NextResponse.json(stripeUnavailableResponse(), { status: 503 });
  }

  const planId: PlanId = parsed.data.plan;
  const basePlan = await getResolvedPlan(planId);

  // Reusar customer existente si la clínica ya tiene uno. Si no, crear.
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      email: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      // Para la promo de 1er mes (isFirstContract): suscripción legacy y
      // último periodo activado — no se limpian al cancelar.
      subscriptionId: true,
      nextBillingDate: true,
      // Condiciones conservadas (clínicas de antes de los planes de sep-2026).
      // Incluye `plan`, que también lee la excepción de IVA (iva-cobro.ts).
      ...CLINIC_OVERRIDE_SELECT,
      // Para la excepción de IVA de las clínicas de antes (ver iva-cobro.ts).
      createdAt: true,
    },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });
  }

  // PRECIO A COBRAR. Si la clínica contrata (o renueva, o paga por SPEI/OXXO) el
  // MISMO plan que tiene, paga el precio que conserva (Clínica de antes: $1,719,
  // no $1,489). Si elige OTRO plan, paga el precio vigente de ese plan: el
  // override no se aplica a un plan distinto del suyo (ver applyClinicOverrides).
  // `plan` alimenta el importe, el cupón de primer mes y el nombre del producto.
  const plan = applyClinicOverrides(basePlan, clinic);

  let customerId = clinic.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: clinic.email ?? user.email ?? undefined,
      name: clinic.name,
      metadata: { clinicId: clinic.id, source: "mediflow" },
    });
    customerId = customer.id;
    await prisma.clinic.update({
      where: { id: clinic.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    new URL(req.url).origin;

  const method = parsed.data.method;
  const billing = parsed.data.billing;

  // Tarjeta: si la clínica YA tiene una suscripción de tarjeta viva en Stripe,
  // NO crear una segunda (evita doble cobro recurrente). La mandamos al billing
  // portal para gestionar la existente (cambiar tarjeta, plan o cancelar).
  // SPEI/OXXO no aplican (pago único; cada pago EXTIENDE el periodo vía webhook).
  if (method === "card" && clinic.stripeSubscriptionId) {
    let existing: any = null;
    try {
      existing = await stripe.subscriptions.retrieve(clinic.stripeSubscriptionId);
    } catch {
      existing = null; // la suscripción ya no existe en Stripe → seguir con alta normal
    }
    const liveStatuses = ["active", "trialing", "past_due", "unpaid"];
    if (existing && liveStatuses.indexOf(existing.status) >= 0) {
      try {
        const portal = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${baseUrl}/dashboard/settings`,
        });
        return NextResponse.json({
          url: portal.url,
          portal: true,
          message: "Ya tienes una suscripción de tarjeta activa. Gestiónala (cambiar tarjeta, plan o cancelar) en el portal de Stripe.",
        });
      } catch {
        return NextResponse.json(
          {
            error: "Ya tienes una suscripción de tarjeta activa. Para cambiar tu plan o método de pago usa el portal de facturación o contacta a soporte.",
            alreadySubscribed: true,
          },
          { status: 409 },
        );
      }
    }
  }

  // IVA 16 % de este cobro NUEVO (ver lib/billing/iva-cobro.ts): tasa de impuesto manual de
  // Stripe en la línea del plan (env STRIPE_IVA_TAX_RATE_ID), o Stripe Tax si STRIPE_AUTOMATIC_TAX
  // es "true" (nunca las dos). Sin ninguna NO se cobra sin IVA en silencio: 503 claro. Va DESPUÉS
  // del desvío al portal de arriba: quien ya tiene suscripción de tarjeta viva no pasa por aquí.
  // Regla del IVA (Ajuste 1c): una clínica creada ANTES del 26-sep-2026 no cambia (sin IVA en OXXO/SPEI
  // y en su tarjeta, mismo plan; con IVA en cambio de plan y al reactivar tarjeta tras cancelarla);
  // una creada después paga IVA en todo. Decidido aquí con la clínica de la SESIÓN, no con el body.
  const exencion = await exencionIvaDeClinica(clinic);
  const iva = ivaParaPagoDeClinica(process.env, { metodo: method, plan: planId, exencion });
  if (iva.ok === false) {
    return NextResponse.json({ error: iva.error, code: iva.codigo }, { status: 503 });
  }

  // Anual = 35% de descuento (priceMxnAnnual, fuente única de planes). El
  // PERIODO lo fija el webhook (nextBillingDate +1 año / +1 mes según billing).
  const unitAmount = (billing === "annual" ? plan.priceMxnAnnual : plan.priceMxn) * 100;

  // PROMO 1ER MES (total $19/$29/$39, IVA INCLUIDO: no se suma encima): SOLO tarjeta + ciclo mensual + PRIMERA
  // contratación de la clínica (reactivaciones y cambios de plan NO aplican;
  // change-plan ni siquiera pasa por aquí). Cupón "once": la 1a factura sale
  // al total promo y desde la 2a Stripe cobra el precio normal + IVA. NO es trial.
  const firstContract = isFirstContract(clinic);
  const applyFirstMonthPromo =
    method === "card" && billing === "monthly" && firstContract;
  const promoCouponId = applyFirstMonthPromo
    // El IVA va DENTRO de la promo: con IVA el cupón deja subtotal + IVA = total exacto de la promo.
    ? await ensureFirstMonthCoupon(stripe, plan, { conIva: iva.modo !== "exento" })
    : null;

  // metadata compartida: el webhook discrimina por kind y activa según método+billing.
  const meta = {
    clinicId: clinic.id,
    plan: plan.id,
    kind: "platform-subscription",
    method,
    billing,
    firstMonthPromo: promoCouponId ? "1" : "0",
    // MEDICIÓN, no cobro (WS1-T3): "1" = esta sesión es la PRIMERA contratación
    // de la clínica (nunca tuvo suscripción ni periodo activado), estampado
    // AQUÍ porque es el único momento en que el dato existe: al confirmar el
    // pago, el webhook fija nextBillingDate/stripeSubscriptionId y ya no se
    // distingue de una renovación. Lo lee /dashboard/suspended/success para
    // mandar la conversión «Pago completado» a Google Ads solo esa vez.
    firstContract: firstContract ? "1" : "0",
  };
  // Señales del navegador para el Purchase de Meta del webhook (WS1-T4): IP, user
  // agent, fbp y fbc de quien inicia el pago. Solo en la metadata de la SESIÓN
  // (la lee el webhook), no en la de la suscripción ni la del cobro.
  const sessionMeta = { ...meta, ...metadataMetaDePeticion(req, (n) => req.cookies.get(n)?.value) };

  let session;
  if (method === "card") {
    // Tarjeta → suscripción mensual que se auto-renueva.
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
              name: `DaleControl ${plan.name} — Suscripción ${billing === "annual" ? "anual" : "mensual"}`,
              metadata: { plan: plan.id },
            },
          },
          quantity: 1,
          ...iva.linea,
        },
      ],
      metadata: sessionMeta,
      subscription_data: { metadata: meta },
      // discounts es incompatible con allow_promotion_codes (no usamos códigos
      // manuales aquí); solo se manda cuando la promo aplica.
      ...(promoCouponId ? { discounts: [{ coupon: promoCouponId }] } : {}),
      // Vuelve a la pantalla de confirmación, NO al panel: Stripe redirige en
      // milisegundos y el webhook checkout.session.completed (el que activa la
      // clínica) puede no haber corrido aún. Aterrizar en /dashboard con la
      // clínica todavía "vencida" la rebotaba a "elige tu plan" y el usuario,
      // creyendo que el pago falló, pagaba OTRA VEZ (segunda suscripción viva
      // en Stripe). /suspended/success espera al webhook antes de dar acceso.
      success_url: `${baseUrl}/dashboard/suspended/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/dashboard/suspended`,
    });
  } else {
    // SPEI / OXXO → pago ÚNICO de 1 mes (asíncrono, NO auto-renueva). El usuario
    // recibe CLABE/voucher y deposita; la activación llega por
    // checkout.session.async_payment_succeeded. Una sesión de Checkout no mezcla
    // mode "subscription" con OXXO/SPEI, por eso aquí va mode "payment".
    const isSpei = method === "spei";
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      customer_update: { address: "auto" },
      ...iva.sesion,
      payment_method_types: [isSpei ? "customer_balance" : "oxxo"],
      ...(isSpei
        ? {
            payment_method_options: {
              customer_balance: {
                funding_type: "bank_transfer",
                bank_transfer: { type: "mx_bank_transfer" },
              },
            },
          }
        : {}),
      line_items: [
        {
          price_data: {
            currency: "mxn",
            unit_amount: unitAmount,
            product_data: {
              name: `DaleControl ${plan.name} — ${billing === "annual" ? "1 año" : "1 mes"}`,
              metadata: { plan: plan.id },
            },
          },
          quantity: 1,
          ...iva.linea,
        },
      ],
      metadata: sessionMeta,
      payment_intent_data: { metadata: meta },
      // Vuelve al panel mostrando "esperando confirmación" (sigue pending_payment
      // hasta que Stripe confirme el depósito/voucher).
      success_url: `${baseUrl}/dashboard/suspended?pending=${method}`,
      cancel_url: `${baseUrl}/dashboard/suspended`,
    });
  }

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe no devolvió URL de checkout" },
      { status: 502 },
    );
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
        after: { plan: plan.id, priceMxn: plan.priceMxn, billing, amountMxn: unitAmount / 100, ivaModo: iva.modo, firstMonthCoupon: promoCouponId, sessionId: session.id },
      },
    },
    ipAddress,
    userAgent,
  });

  return NextResponse.json({ url: session.url });
}
