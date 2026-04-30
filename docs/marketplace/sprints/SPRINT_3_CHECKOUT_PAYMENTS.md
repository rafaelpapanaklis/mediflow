# Sprint 3 — Checkout + Payments (Stripe + PayPal + SPEI + CFDI)

> **Objetivo:** Construir el flujo completo de checkout: carrito, métodos de pago, integración con Stripe/PayPal/SPEI, y emisión de CFDI 4.0.
>
> **Tiempo estimado:** 3–4 días
>
> **Pre-requisitos:** Sprint 2 ✅ DONE

---

## Contexto del sprint

Este es el sprint más complejo. Maneja dinero real, así que **prioridad #1 es la corrección sobre la velocidad**. Mejor ir despacio y validar cada integración con sandbox antes de producción.

Lee `BRIEF.md` secciones 1.4 (cálculo fiscal), 1.5 (métodos de pago), 3.4 (webhooks) y 3.5 (server action checkout) antes de empezar.

---

## Tareas

### Tarea 3.1 — Variables de entorno

Agregar a `.env.local` (sandbox/test) y a Vercel (producción):

```bash
# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# PayPal
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_MODE=sandbox

# FacturAPI
FACTURAPI_KEY=

# SPEI (datos a mostrar al usuario)
SPEI_BANK_NAME="BBVA México"
SPEI_BENEFICIARY="MediFlow Tecnología SA de CV"
SPEI_CLABE="012180012345678901"

# Cron secret
CRON_SECRET=
```

Validarlas con zod en `lib/env.ts` (MediFlow ya usa zod para esto):

```ts
const envSchema = z.object({
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  // ...
});
```

### Tarea 3.2 — Página del carrito

**`app/(clinic)/marketplace/cart/page.tsx`**

Server Component que:
1. Lee el `Cart` de la clínica
2. Hidrata con `Module.findMany()` los módulos del carrito
3. Pasa todo a un Client Component `<CheckoutContent />`

Si el carrito está vacío, redirige a `/marketplace` o muestra el `EmptyCart` del JSX.

### Tarea 3.3 — Componente CheckoutContent

Extraer del JSX el componente `CheckoutScreen`. Migrar a TypeScript con props correctos.

Componentes hijos a extraer también:
- `components/marketplace/CartItem.tsx`
- `components/marketplace/OrderSummary.tsx`
- `components/marketplace/PaymentOption.tsx`
- `components/marketplace/CardForm.tsx` (placeholder, se reemplaza con Stripe Elements en tarea 3.5)
- `components/marketplace/PayPalNotice.tsx`
- `components/marketplace/SpeiNotice.tsx`

### Tarea 3.4 — Server Action: `processCheckout`

**`app/actions/checkout.ts`**

```ts
'use server'
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getCurrentClinic } from '@/lib/auth';
import { calculateTotal } from '@/lib/marketplace/pricing';

const checkoutSchema = z.object({
  moduleIds: z.array(z.string().cuid()).min(1).max(30),
  billingCycle: z.enum(['monthly', 'annual']),
  paymentMethod: z.enum(['card', 'paypal', 'spei']),
}).refine(
  data => !(data.paymentMethod === 'spei' && data.billingCycle === 'monthly'),
  { message: 'SPEI solo está disponible para pago anual' }
);

export async function processCheckout(input: unknown) {
  const validated = checkoutSchema.parse(input);
  const clinic = await getCurrentClinic();
  if (!clinic) throw new Error('Unauthorized');

  // 1. Verificar que ningún módulo ya esté comprado
  const existing = await prisma.clinicModule.findMany({
    where: {
      clinicId: clinic.id,
      moduleId: { in: validated.moduleIds },
      status: 'active'
    }
  });
  if (existing.length > 0) {
    throw new Error('Algunos módulos ya están comprados');
  }

  // 2. Obtener precios de los módulos
  const modules = await prisma.module.findMany({
    where: { id: { in: validated.moduleIds }, isActive: true }
  });
  if (modules.length !== validated.moduleIds.length) {
    throw new Error('Uno o más módulos no existen');
  }

  // 3. Calcular totales
  const totals = calculateTotal(
    modules.map(m => m.priceMxnMonthly),
    validated.billingCycle
  );

  // 4. Crear Order pendiente
  const order = await prisma.order.create({
    data: {
      clinicId: clinic.id,
      status: 'pending',
      paymentMethod: validated.paymentMethod,
      billingCycle: validated.billingCycle,
      moduleIds: validated.moduleIds,
      subtotalMxn: totals.subtotal,
      annualBonusMxn: totals.annualBonus,
      volumeDiscountPct: getDiscountTier(modules.length)?.discount || 0,
      volumeDiscountMxn: totals.discount,
      taxMxn: totals.tax,
      totalMxn: totals.final,
    }
  });

  // 5. Iniciar pago según método
  switch (validated.paymentMethod) {
    case 'card':
      return startStripeCheckout(order, clinic, modules);
    case 'paypal':
      return startPayPalCheckout(order, clinic, modules);
    case 'spei':
      return startSpeiCheckout(order, clinic);
  }
}
```

### Tarea 3.5 — Integración Stripe

**`lib/payment/stripe.ts`**

```ts
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});
```

**Flujo Stripe Subscription:**

1. Crear Stripe Customer (si la clínica no tiene `stripeCustomerId`):
   ```ts
   const customer = await stripe.customers.create({
     email: clinic.email,
     name: clinic.legalName,
     metadata: { clinic_id: clinic.id }
   });
   await prisma.clinic.update({
     where: { id: clinic.id },
     data: { stripeCustomerId: customer.id }
   });
   ```

2. Crear los Stripe Prices dinámicamente o usar un Price global con `quantity` ajustada. Para simplicidad y trazabilidad **fiscal**, recomendado: crear un Stripe Product/Price por cada Module + cada billing cycle (24 prices totales). Hazlo con un seed `prisma/seed-stripe-prices.ts` que sea idempotente.

3. Crear Subscription:
   ```ts
   const subscription = await stripe.subscriptions.create({
     customer: customer.id,
     items: modules.map(m => ({ price: m.stripePriceId[billingCycle] })),
     payment_behavior: 'default_incomplete',
     payment_settings: { save_default_payment_method: 'on_subscription' },
     expand: ['latest_invoice.payment_intent'],
     metadata: { order_id: order.id, clinic_id: clinic.id },
     // Aplicar coupon dinámico para descuento por volumen:
     ...(volumeDiscount && { coupon: await getOrCreateVolumeCoupon(volumeDiscount) }),
   });

   return {
     clientSecret: subscription.latest_invoice.payment_intent.client_secret,
     subscriptionId: subscription.id,
   };
   ```

4. En el frontend, usar `@stripe/react-stripe-js` para el form y confirmar el pago con `stripe.confirmCardPayment(clientSecret)`.

5. Reemplazar el `CardForm.tsx` placeholder con Stripe Elements.

> **NOTA:** Si Rafael ya tiene integración Stripe en MediFlow para algún cobro previo, **reutilizar el cliente y patrón existente**. Pregúntale antes de crear duplicados.

### Tarea 3.6 — Integración PayPal

**`lib/payment/paypal.ts`**

Usar el SDK oficial: `npm install @paypal/checkout-server-sdk`

Flujo:

1. Crear PayPal Subscription Plan (uno por módulo o uno genérico, similar a Stripe Price)
2. Generar approval URL con la API de PayPal y devolverla al frontend
3. Frontend redirige al usuario a PayPal
4. PayPal regresa al usuario a `/marketplace/cart/paypal-return?token=XXX`
5. Esa página llama un Server Action que captura la subscription y marca la Order

**Endpoint de retorno:** `app/(clinic)/marketplace/cart/paypal-return/page.tsx`

### Tarea 3.7 — Integración SPEI (manual)

Mucho más simple porque no hay API de pago. Solo:

1. Generar referencia única: `MF-{año}-{nnnnn}` donde `nnnnn` es el ID secuencial del Order (`order.id` truncado a 5 dígitos numéricos o un counter aparte).
2. Guardar en `order.speiReference`
3. Devolver al frontend los datos bancarios + referencia
4. La Order queda en `status: 'pending'` hasta que un admin confirme manualmente

**Endpoint admin para confirmar:**

`app/api/admin/orders/[id]/confirm-spei/route.ts`

```ts
// POST /api/admin/orders/[id]/confirm-spei
// Body: { confirmedAt: ISOString }
// Marca order como paid, activa los módulos, emite CFDI.
// Solo accesible para SUPER_ADMIN.
```

### Tarea 3.8 — Webhooks de Stripe

**`app/api/webhooks/stripe/route.ts`**

```ts
import Stripe from 'stripe';
import { stripe } from '@/lib/payment/stripe';
import { activateClinicModules, markOrderFailed } from '@/lib/marketplace/order-fulfillment';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')!;
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response('Invalid signature', { status: 400 });
  }

  switch (event.type) {
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionCancelled(event.data.object as Stripe.Subscription);
      break;
  }

  return new Response('OK', { status: 200 });
}
```

### Tarea 3.9 — Lógica de fulfillment

**`lib/marketplace/order-fulfillment.ts`**

```ts
export async function activateClinicModules(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status === 'paid') return; // idempotencia

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  if (order.billingCycle === 'monthly') {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }

  // Activar cada módulo
  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: { status: 'paid', paidAt: new Date() }
    }),
    ...order.moduleIds.map(moduleId =>
      prisma.clinicModule.upsert({
        where: { clinicId_moduleId: { clinicId: order.clinicId, moduleId } },
        create: {
          clinicId: order.clinicId,
          moduleId,
          status: 'active',
          billingCycle: order.billingCycle,
          paymentMethod: order.paymentMethod,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          pricePaidMxn: 0, // calcular proporcional
        },
        update: {
          status: 'active',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        }
      })
    ),
    // Limpiar el carrito
    prisma.cart.update({
      where: { clinicId: order.clinicId },
      data: { moduleIds: [] }
    })
  ]);

  // Emitir CFDI
  await emitCfdi(orderId);

  // Email de confirmación
  await sendOrderConfirmation(orderId);
}
```

### Tarea 3.10 — Integración FacturAPI (CFDI 4.0)

**`lib/cfdi/facturapi.ts`**

```ts
import Facturapi from 'facturapi';
const facturapi = new Facturapi(process.env.FACTURAPI_KEY!);

export async function emitCfdi(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { clinic: true }
  });

  if (!order || order.cfdiId) return; // idempotencia

  const invoice = await facturapi.invoices.create({
    customer: {
      legal_name: order.clinic.legalName,
      tax_id: order.clinic.rfc,
      tax_system: order.clinic.taxSystem, // ej "601"
      address: { zip: order.clinic.zipCode },
    },
    items: order.moduleIds.map(/* mapear a items con descripción */),
    payment_form: getPaymentForm(order.paymentMethod), // "04" tarjeta, "03" transferencia
    use: order.clinic.cfdiUse || 'G03',
  });

  await prisma.order.update({
    where: { id: orderId },
    data: { cfdiId: invoice.id, cfdiUuid: invoice.uuid }
  });

  return invoice;
}
```

> **IMPORTANTE:** El CFDI se emite SOLO después del pago confirmado. Nunca antes. Si Rafael ya tiene integración con FacturAPI para otros cobros, reutilizar.

### Tarea 3.11 — Webhooks PayPal

**`app/api/webhooks/paypal/route.ts`**

Eventos importantes:
- `BILLING.SUBSCRIPTION.ACTIVATED` → activar módulos
- `BILLING.SUBSCRIPTION.CANCELLED` → marcar como cancelado
- `PAYMENT.SALE.COMPLETED` → emitir CFDI

Verificar signature con `paypalsdk.notifications.WebhooksApi.verifyNotificationSignature`.

### Tarea 3.12 — Pantalla de éxito

**`app/(clinic)/marketplace/success/page.tsx`**

Server Component que recibe `?orderId=XXX`, verifica que la Order esté `paid`, y muestra el `SuccessScreen` del JSX con datos reales.

Botón "Descargar CFDI" llama a `GET /api/orders/[id]/cfdi` que descarga el PDF/XML desde FacturAPI.

### Tarea 3.13 — Verificación manual

Pruebas en sandbox:

- [ ] Pago con tarjeta de test Stripe `4242 4242 4242 4242` → módulos activados
- [ ] Pago con tarjeta declinada `4000 0000 0000 0002` → Order marcada como failed
- [ ] Pago con PayPal sandbox → módulos activados
- [ ] Crear Order con SPEI, llamar endpoint admin de confirmación → módulos activados
- [ ] Webhook de Stripe llega y procesa correctamente (usa Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`)
- [ ] CFDI se genera en sandbox de FacturAPI con datos correctos
- [ ] Refrescando la página después del pago, el módulo aparece como "Comprado"
- [ ] Carrito se vacía después del pago exitoso

---

## Criterios de "DONE"

✅ Página `/marketplace/cart` funcional con los 3 métodos de pago
✅ Stripe en sandbox funcionando end-to-end
✅ PayPal en sandbox funcionando end-to-end
✅ SPEI con generación de referencia + endpoint admin para confirmar
✅ CFDI 4.0 emitido automáticamente al confirmarse pago
✅ Webhooks de Stripe y PayPal con verificación de signature
✅ Order de tipo "pending" se vuelve "paid" solo via webhook (no antes)
✅ Pantalla de éxito con descarga de CFDI
✅ `PROGRESS.md` actualizado

---

## Notas críticas

- 🚨 **Nunca emitir CFDI antes de confirmar pago.** Cancelar un CFDI emitido es lento y burocrático.
- 🚨 **Idempotencia en webhooks.** Stripe y PayPal pueden mandar el mismo evento múltiples veces. Verifica `order.status === 'paid'` antes de activar módulos.
- 🚨 **NO loguear secretos** ni body completo de webhooks (puede contener PII de pago).
- 🚨 **NO confiar en el frontend.** El precio se calcula SIEMPRE en el backend con `calculateTotal()`. Si el frontend dice $100 y el backend dice $1000, gana el backend.

---

## Después de terminar

1. Actualiza `PROGRESS.md` (Sprint 3 ✅ DONE)
2. **DETÉNTE** y avisa a Rafael que necesita probar manualmente con cuentas sandbox antes de continuar.
