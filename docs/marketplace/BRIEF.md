# MediFlow — Sistema de Marketplace de Módulos con Trial

> **Brief para Claude Code**
> Implementación completa del sistema de módulos por especialidad con trial de 14 días, descuentos por volumen, carrito multi-pago y CFDI 4.0.

---

## 0. Contexto del proyecto

MediFlow es un SaaS de gestión clínica para médicos y clínicas en México (pre-launch). Este brief describe el **sistema de monetización**: cómo se venden los módulos por especialidad médica/dental, cómo funciona el trial inicial, y cómo se procesan los pagos.

**Stack confirmado:**
- Next.js 14 (App Router, Server Components) + TypeScript
- Prisma 5.22 + Supabase PostgreSQL (con RLS deny-all)
- TailwindCSS, lucide-react, react-hot-toast
- Auth: Supabase Auth (cookie httpOnly, 30 días)
- Pagos: Stripe (suscripciones), MercadoPago, PayPal
- CFDI: FacturAPI
- Notificaciones: Twilio (WhatsApp/SMS), Postmark (email)
- Crons: Vercel Cron
- Compliance: NOM-024-SSA3-2012, LFPDPPP

**Archivo adjunto:** `mediflow_marketplace.jsx` — prototipo React funcional con las 5 pantallas del flujo. Sirve como referencia visual y como base de componentes para extraer.

---

## 1. Reglas de negocio (críticas)

### 1.1 Modelo de monetización

- **No hay plan base con precio fijo.** La clínica paga **por módulo activado**.
- Cada módulo es una especialidad (Ortodoncia, Pediatría, Cardiología, etc.) con precio mensual propio (rango $229–$399 MXN/mes).
- La clínica puede activar 1 o 30 módulos según su perfil.

### 1.2 Trial de 14 días

- **Inicia automáticamente** al registrar la clínica (`Clinic.created_at` = `trial_started_at`).
- **Duración:** 14 días naturales (se computa a `trial_started_at + INTERVAL '14 days'`).
- **Acceso durante trial:** Todos los módulos del marketplace, sin restricciones, sin necesidad de "activarlos".
- **No requiere tarjeta** al iniciar — completamente sin compromiso.
- **Al expirar sin compras:** bloqueo total (la clínica solo puede ver el marketplace y comprar).
- **Al expirar con compras parciales:** solo los módulos comprados quedan accesibles; el resto se bloquea.
- **Datos del trial:** Pacientes, citas y registros creados durante el trial **se conservan siempre** (NOM-024 / NOM-004). Si compran después, recuperan acceso a esos datos.

### 1.3 Descuentos por volumen (aplicados en checkout)

| Módulos en carrito | Descuento |
|--------------------|-----------|
| 3+ | 10% |
| 5+ | 15% |
| 10+ | 25% |

### 1.4 Frecuencia de pago

- **Mensual:** precio normal por módulo.
- **Anual:** se cobran 10 meses por 12 (bonificación de 2 meses gratis).
- **Orden de cálculo (importa fiscalmente):**
  1. Subtotal = suma de precios × meses
  2. Restar bonificación anual (si aplica)
  3. Restar descuento por volumen (sobre subtotal post-anual)
  4. Aplicar IVA 16% sobre el resultado
  5. Total = subtotal – bonificación – descuento + IVA

### 1.5 Métodos de pago

- **Tarjeta crédito/débito** (Stripe): suscripción recurrente automática.
- **PayPal**: suscripción recurrente automática.
- **SPEI (transferencia bancaria)**: SOLO para pago anual. Confirmación manual 24–48h. Genera referencia única `MF-{año}-{nnnnn}`.

### 1.6 Estados de un módulo (desde el punto de vista del frontend)

| Estado | Significado | UI badge |
|--------|-------------|----------|
| `available` | No comprado, durante trial es accesible; post-trial bloqueado | Verde "Disponible" / Morado "Trial activo" / Rojo "Bloqueado" |
| `trial` | Periodo de prueba de 14 días tras compra individual (opcional, ver §1.7) | Amarillo "En prueba · Xd" |
| `purchased` | Activo y pagado | Azul "Comprado" |

### 1.7 Trial post-compra (futuro, opcional)

El JSX incluye estado `trial` para futuros casos donde un módulo individual se ofrezca con prueba antes de cobrar (ej. si después decides ofrecer "prueba 14d en módulo nuevo lanzado"). **Por ahora ignóralo** — el único trial real es el global de 14 días al registro.

---

## 2. Cambios en base de datos (Prisma schema)

### 2.1 Modificar tabla `Clinic`

```prisma
model Clinic {
  // ... campos existentes ...

  trialStartedAt   DateTime  @default(now()) @map("trial_started_at")
  trialEndsAt      DateTime  @map("trial_ends_at")  // calculated: trialStartedAt + 14d
  trialNotified7d  Boolean   @default(false) @map("trial_notified_7d")
  trialNotified3d  Boolean   @default(false) @map("trial_notified_3d")
  trialNotified1d  Boolean   @default(false) @map("trial_notified_1d")

  modules          ClinicModule[]
  moduleUsageLogs  ModuleUsageLog[]
}
```

> Para clínicas existentes (si las hay): backfill `trialEndsAt = createdAt + 14d` y marca `trialNotified*` según corresponda.

### 2.2 Nueva tabla `Module` (catálogo de módulos disponibles)

```prisma
model Module {
  id              String   @id @default(cuid())
  key             String   @unique  // "orthodontics", "cardiology", etc.
  name            String              // "Ortodoncia"
  category        String              // "Dental", "Pediatría", etc.
  description     String   @db.Text
  iconKey         String   @map("icon_key")  // "Activity" (lucide-react name)
  iconBg          String   @map("icon_bg")   // "bg-cyan-50"
  iconColor       String   @map("icon_color") // "text-cyan-600"
  features        String[] // array de strings cortos
  priceMxnMonthly Int      @map("price_mxn_monthly") // 329
  isCore          Boolean  @default(false) @map("is_core") // si es núcleo (gratis si tiene módulos de su familia)
  dependsOn       String[] @map("depends_on") // ["dental_core"]
  sortOrder       Int      @default(0) @map("sort_order")
  isActive        Boolean  @default(true) @map("is_active") // si está disponible para venta

  clinicModules   ClinicModule[]

  @@map("modules")
}
```

### 2.3 Nueva tabla `ClinicModule` (relación many-to-many con estado)

```prisma
model ClinicModule {
  id                  String    @id @default(cuid())
  clinicId            String    @map("clinic_id")
  moduleId            String    @map("module_id")
  status              String    // "active" | "trial" | "paused" | "cancelled"
  billingCycle        String    @map("billing_cycle") // "monthly" | "annual"
  activatedAt         DateTime  @default(now()) @map("activated_at")
  currentPeriodStart  DateTime  @map("current_period_start")
  currentPeriodEnd    DateTime  @map("current_period_end")
  cancelledAt         DateTime? @map("cancelled_at")
  stripeSubscriptionId String?  @map("stripe_subscription_id")
  paypalSubscriptionId String?  @map("paypal_subscription_id")
  paymentMethod       String    @map("payment_method") // "card" | "paypal" | "spei"
  pricePaidMxn        Int       @map("price_paid_mxn") // precio que efectivamente pagó (con descuento)

  clinic   Clinic  @relation(fields: [clinicId], references: [id], onDelete: Cascade)
  module   Module  @relation(fields: [moduleId], references: [id])

  @@unique([clinicId, moduleId])
  @@index([clinicId])
  @@index([currentPeriodEnd]) // para cron de renovación
  @@map("clinic_modules")
}
```

### 2.4 Nueva tabla `ModuleUsageLog` (para sugerencias post-trial)

```prisma
model ModuleUsageLog {
  id        String   @id @default(cuid())
  clinicId  String   @map("clinic_id")
  moduleKey String   @map("module_key")  // "orthodontics"
  action    String   // "view" | "create_record" | "upload_photo" | "edit"
  userId    String?  @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")

  clinic    Clinic   @relation(fields: [clinicId], references: [id], onDelete: Cascade)

  @@index([clinicId, moduleKey])
  @@index([createdAt])
  @@map("module_usage_logs")
}
```

### 2.5 Nueva tabla `Order` (transacciones de checkout)

```prisma
model Order {
  id                 String   @id @default(cuid())
  clinicId           String   @map("clinic_id")
  status             String   // "pending" | "paid" | "failed" | "refunded"
  paymentMethod      String   @map("payment_method")
  billingCycle       String   @map("billing_cycle")
  moduleIds          String[] @map("module_ids") // array de Module.id
  subtotalMxn        Int      @map("subtotal_mxn")
  annualBonusMxn     Int      @default(0) @map("annual_bonus_mxn")
  volumeDiscountPct  Int      @default(0) @map("volume_discount_pct")
  volumeDiscountMxn  Int      @default(0) @map("volume_discount_mxn")
  taxMxn             Int      @map("tax_mxn") // IVA
  totalMxn           Int      @map("total_mxn")
  speiReference      String?  @map("spei_reference") // "MF-2026-04839"
  stripePaymentIntent String? @map("stripe_payment_intent")
  paypalOrderId      String?  @map("paypal_order_id")
  cfdiId             String?  @map("cfdi_id") // FacturAPI invoice id
  cfdiUuid           String?  @map("cfdi_uuid") // SAT UUID
  createdAt          DateTime @default(now()) @map("created_at")
  paidAt             DateTime? @map("paid_at")

  clinic   Clinic @relation(fields: [clinicId], references: [id])

  @@index([clinicId])
  @@index([status])
  @@map("orders")
}
```

### 2.6 RLS policies (importante)

Mantén el patrón deny-all. Agrega policies SELECT/INSERT/UPDATE para:

- `modules`: SELECT público (cualquier autenticado puede ver el catálogo).
- `clinic_modules`: SELECT/UPDATE solo si `clinic_id IN (SELECT id FROM clinics WHERE owner_id = auth.uid() OR user is in clinic_users)`.
- `orders`: SELECT solo dueño/admin de la clínica. INSERT vía service role (server actions). UPDATE solo service role.
- `module_usage_logs`: INSERT vía cualquier sesión autenticada de la clínica. SELECT solo dueño/admin.

---

## 3. Lógica del backend (qué construir)

### 3.1 Server Action / API Route: estado del trial

```ts
// app/api/clinic/trial-status/route.ts
GET /api/clinic/trial-status
→ {
    daysLeft: number,
    expiresAt: ISOString,
    isExpired: boolean,
    hasActivePurchases: boolean
  }
```

### 3.2 Middleware de control de acceso (CRÍTICO)

Crear un helper `canAccessModule(clinicId, moduleKey)` que se llama en cada Server Component o Route Handler de un módulo:

```ts
// lib/access-control.ts
export async function canAccessModule(clinicId: string, moduleKey: string) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    include: { modules: { include: { module: true } } }
  });

  if (!clinic) return false;

  const now = new Date();
  const isInTrial = now < clinic.trialEndsAt;

  // Durante trial: acceso a TODO
  if (isInTrial) return true;

  // Post-trial: solo si está comprado y activo
  const cm = clinic.modules.find(m => m.module.key === moduleKey);
  if (!cm) return false;

  const isActive = cm.status === 'active' && cm.currentPeriodEnd > now;
  return isActive;
}
```

Aplicarlo en:
- Layouts de cada módulo (`app/(clinic)/orthodontics/layout.tsx`, etc.)
- Route handlers que crean/leen registros de cada módulo
- Si retorna `false`, redirect a `/marketplace?expired=true`

### 3.3 Vercel Crons (3 cron jobs)

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/trial-reminders", "schedule": "0 15 * * *" },  // 9am CST
    { "path": "/api/cron/trial-expiry-check", "schedule": "0 * * * *" }, // cada hora
    { "path": "/api/cron/subscription-renewal", "schedule": "0 16 * * *" } // 10am CST
  ]
}
```

**Cron 1 — `trial-reminders`** (diario):
```ts
// Busca clinics con trialEndsAt en ventana 7d / 3d / 1d
// y trialNotifiedXd = false
// Envía email (Postmark) + WhatsApp (Twilio) según urgencia
// Marca el flag correspondiente
```

**Cron 2 — `trial-expiry-check`** (cada hora):
```ts
// Marca clinics con trialEndsAt < NOW() y sin módulos activos
// para mostrar pantalla de bloqueo (no requiere cambio de DB,
// la lógica está en canAccessModule)
// Pero útil para invalidar caches y forzar re-render
```

**Cron 3 — `subscription-renewal`** (diario):
```ts
// Para clinic_modules con currentPeriodEnd < NOW():
//   - Si stripeSubscriptionId existe: Stripe maneja renovación
//   - Si paypalSubscriptionId existe: PayPal maneja renovación
//   - Si paymentMethod=spei y no se renovó: marcar como "paused"
//     y a los 7 días "cancelled"
```

### 3.4 Webhooks

**Stripe webhook** (`/api/webhooks/stripe`):
- `invoice.paid` → activa `clinic_modules` correspondientes, emite CFDI vía FacturAPI
- `invoice.payment_failed` → marca como `paused`, manda email
- `customer.subscription.deleted` → marca como `cancelled`

**PayPal webhook** (`/api/webhooks/paypal`):
- `BILLING.SUBSCRIPTION.ACTIVATED` → activa
- `BILLING.SUBSCRIPTION.CANCELLED` → cancela
- `PAYMENT.SALE.COMPLETED` → emite CFDI

**SPEI** (no hay webhook):
- Crear endpoint admin manual `/api/admin/orders/{id}/confirm-spei` que el admin marque cuando llegue la transferencia. Activa el módulo y emite CFDI.

### 3.5 Server Action: checkout

```ts
// app/actions/checkout.ts
'use server'
export async function processCheckout(input: {
  moduleIds: string[],
  billingCycle: 'monthly' | 'annual',
  paymentMethod: 'card' | 'paypal' | 'spei'
}) {
  // 1. Validar con zod
  // 2. Verificar que la clínica no tiene ya esos módulos comprados
  // 3. Calcular totales (ver §1.4)
  // 4. Crear Order en estado "pending"
  // 5. Según paymentMethod:
  //    - card: crear Stripe Subscription, retornar client_secret
  //    - paypal: crear PayPal subscription, retornar approval_url
  //    - spei: generar referencia, retornar datos bancarios
  // 6. NO activar módulos aún — eso pasa en el webhook
}
```

### 3.6 Logging de uso de módulos

En cada acción importante de un módulo, llamar:
```ts
await logModuleUsage(clinicId, 'orthodontics', 'create_record', userId);
```

Esto alimenta las **sugerencias post-trial** (§3.7).

### 3.7 Server Action: recomendaciones post-trial

```ts
// app/actions/recommendations.ts
'use server'
export async function getTrialRecommendations(clinicId: string) {
  // Top 3 módulos con más logs en module_usage_logs
  // durante los últimos 14 días para esta clínica
  // Si no hay logs (clínica nunca usó nada), retorna top 3 por categoría
  // detectada en clinic.specialty
}
```

---

## 4. Frontend (cómo descomponer el JSX adjunto)

El archivo `mediflow_marketplace.jsx` es un **monolito de preview** con 5 pantallas en un solo componente. Para producción, descomponer así:

### 4.1 Estructura de carpetas sugerida

```
app/
  (clinic)/
    marketplace/
      page.tsx                    ← MarketplaceScreen
      [moduleKey]/
        page.tsx                  ← ModuleDetailScreen
      cart/
        page.tsx                  ← CheckoutScreen
      success/
        page.tsx                  ← SuccessScreen
      trial-expired/
        page.tsx                  ← TrialExpiredScreen
    layout.tsx                    ← incluye <TrialBanner /> y <Sidebar />

components/
  marketplace/
    ModuleCard.tsx
    BundleCard.tsx               (no se usa actualmente, está OK eliminarlo)
    DiscountTiersBar.tsx
    FloatingCart.tsx
    CartItem.tsx
    OrderSummary.tsx
    PaymentOption.tsx
    CardForm.tsx
    PayPalNotice.tsx
    SpeiNotice.tsx
    SuggestedCard.tsx
    CompactModuleCard.tsx
    StatCard.tsx
    TrialStat.tsx
  trial/
    TrialBanner.tsx              (server component - lee trial status)
    TrialSidebarStatus.tsx
    ExpiredOverlay.tsx

lib/
  marketplace/
    pricing.ts                   ← getDiscountTier, calculateTotal
    access-control.ts            ← canAccessModule
  payment/
    stripe.ts
    paypal.ts
    spei.ts
  cfdi/
    facturapi.ts
```

### 4.2 Cosas que SÍ usar del JSX

- Estructura visual de cada componente (todos los `className`, layout, lucide icons)
- Lógica de `getDiscountTier()` y `calculateTotal()` → mover a `lib/marketplace/pricing.ts` y agregar tests
- Componentes UI (Cards, Banners, Modals)
- Paleta de colores y design tokens

### 4.3 Cosas que NO usar del JSX (es código de preview)

- El `useState(screen)` con tabs arriba → eliminar, usar routing real de Next.js
- El slider del "Día del trial" → eliminar, leer de DB real
- El array `modules` hardcoded → mover a seed de Prisma (`prisma/seed.ts`)
- `useState(cart)` local → reemplazar con server state (Server Action o React Query)

### 4.4 Estado del carrito

Como Next.js 14 + Server Components, el carrito debería ser:

**Opción A (simple):** localStorage + Zustand. Se pierde si cambia de dispositivo, pero es trivial.

**Opción B (recomendada):** tabla `Cart` en BD vinculada a `clinic_id`. Persiste entre sesiones y dispositivos. Server Action para add/remove.

```prisma
model Cart {
  clinicId  String   @id @map("clinic_id")
  moduleIds String[] @map("module_ids")
  updatedAt DateTime @updatedAt @map("updated_at")

  clinic    Clinic @relation(fields: [clinicId], references: [id], onDelete: Cascade)

  @@map("carts")
}
```

### 4.5 Trial banner: implementación recomendada

`TrialBanner.tsx` debe ser un **Server Component** que lee directo de DB (no necesita ser client):

```tsx
// components/trial/TrialBanner.tsx
import { getCurrentClinic } from '@/lib/auth'

export async function TrialBanner() {
  const clinic = await getCurrentClinic();
  if (!clinic) return null;

  const now = new Date();
  if (now >= clinic.trialEndsAt) return null; // expirado, otro componente maneja

  const daysLeft = Math.ceil((clinic.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // Render según urgencia (ver JSX adjunto)
}
```

---

## 5. Seed de módulos iniciales

Crear `prisma/seed.ts` con los 12 módulos del JSX. Lista canónica:

```ts
const SEED_MODULES = [
  { key: 'general-dentistry', name: 'Odontología General', category: 'Dental', priceMxnMonthly: 249, iconKey: 'Smile', iconBg: 'bg-blue-50', iconColor: 'text-blue-600', description: 'Odontograma interactivo y catálogo completo de procedimientos.', features: ['Odontograma FDI / Universal / Palmer', 'Histórico por pieza dental', 'Catálogo de 80+ procedimientos'] },
  { key: 'orthodontics', name: 'Ortodoncia', category: 'Dental', priceMxnMonthly: 329, iconKey: 'Activity', iconBg: 'bg-cyan-50', iconColor: 'text-cyan-600', description: 'Suite para ortodoncistas: brackets, autoligado y alineadores.', features: ['Fases de tratamiento', 'Tracking de alineadores', 'Recordatorios automáticos por WhatsApp'] },
  { key: 'periodontics', name: 'Periodoncia', category: 'Dental', priceMxnMonthly: 279, iconKey: 'Layers', iconBg: 'bg-blue-50', iconColor: 'text-blue-600', description: 'Periodontograma de 6 sitios con índices y comparativos visuales.', features: ['Sondaje y sangrado', "Índices de placa y O'Leary", 'Programa de mantenimiento'] },
  { key: 'endodontics', name: 'Endodoncia', category: 'Dental', priceMxnMonthly: 279, iconKey: 'Syringe', iconBg: 'bg-blue-50', iconColor: 'text-blue-600', description: 'Diagrama de conductos por diente con protocolo de irrigación.', features: ['Conductos por diente', 'Longitud de trabajo', 'Protocolos de irrigación'] },
  { key: 'implantology', name: 'Implantología', category: 'Dental', priceMxnMonthly: 349, iconKey: 'Bone', iconBg: 'bg-violet-50', iconColor: 'text-violet-600', description: 'Registro por implante con timeline de osteointegración.', features: ['Marca, modelo, lote y torque', 'Timeline de osteointegración', 'Etiqueta de garantía'] },
  { key: 'pediatric-dentistry', name: 'Odontopediatría', category: 'Dental', priceMxnMonthly: 249, iconKey: 'Baby', iconBg: 'bg-pink-50', iconColor: 'text-pink-600', description: 'Curvas dentales, escala de Frankl y consentimiento parental.', features: ['Cronograma de erupción', 'Escala de Frankl', 'Consentimiento parental digital'] },
  { key: 'pediatrics', name: 'Pediatría', category: 'Pediatría', priceMxnMonthly: 279, iconKey: 'Baby', iconBg: 'bg-pink-50', iconColor: 'text-pink-600', description: 'Curvas OMS, vacunación mexicana e hitos del desarrollo.', features: ['Curvas de crecimiento OMS', 'Esquema de vacunación MX', 'Hitos del desarrollo'] },
  { key: 'cardiology', name: 'Cardiología', category: 'Cardiología', priceMxnMonthly: 349, iconKey: 'Heart', iconBg: 'bg-red-50', iconColor: 'text-red-600', description: 'TA con tendencias, ECG, score de riesgo cardiovascular.', features: ['Tensión arterial con gráfico', 'ECG y Holter', 'Score Framingham / ASCVD'] },
  { key: 'dermatology', name: 'Dermatología', category: 'Dermatología', priceMxnMonthly: 329, iconKey: 'Sparkles', iconBg: 'bg-orange-50', iconColor: 'text-orange-600', description: 'Mapa corporal de lesiones con fotos dermatoscópicas.', features: ['Mapa corporal interactivo', 'Fotos dermatoscópicas', 'Comparativos pre/post'] },
  { key: 'gynecology', name: 'Ginecología', category: 'Ginecología', priceMxnMonthly: 329, iconKey: 'Activity', iconBg: 'bg-purple-50', iconColor: 'text-purple-600', description: 'Calendario obstétrico, ultrasonidos y plan prenatal.', features: ['Edad gestacional automática', 'Papanicolaou histórico', 'Plan prenatal estándar'] },
  { key: 'nutrition', name: 'Nutrición', category: 'Nutrición', priceMxnMonthly: 229, iconKey: 'Apple', iconBg: 'bg-green-50', iconColor: 'text-green-600', description: 'Antropometría, plan de alimentación y comparativos.', features: ['Pliegues y perímetros', 'Plan con porciones', 'Recordatorios de pesaje'] },
  { key: 'aesthetic-medicine', name: 'Medicina Estética', category: 'Estética', priceMxnMonthly: 399, iconKey: 'Sparkles', iconBg: 'bg-fuchsia-50', iconColor: 'text-fuchsia-600', description: 'Antes/después, tracking de toxina y rellenos por lote.', features: ['Fotos estandarizadas', 'Toxina: zonas, unidades, lote', 'Sesiones de láser'] },
];
```

---

## 6. Plan de implementación recomendado (orden)

Sugerencia para iterar por sprints chicos sin romper nada:

### Sprint 1 — Fundación (1–2 días)
1. Migración Prisma: `Module`, `ClinicModule`, `ModuleUsageLog`, `Order`, `Cart`
2. Campos nuevos en `Clinic`: `trialStartedAt`, `trialEndsAt`, `trialNotified*`
3. Backfill de clínicas existentes (si hay)
4. Seed de los 12 módulos
5. RLS policies para todas las tablas nuevas
6. Helper `canAccessModule()` en `lib/marketplace/access-control.ts` con tests

### Sprint 2 — Frontend del marketplace (2–3 días)
1. Extraer componentes del JSX a `components/marketplace/`
2. `app/(clinic)/marketplace/page.tsx` (Server Component que lee Modules)
3. Lógica de carrito persistente (Cart en DB + Server Actions add/remove)
4. `TrialBanner` Server Component leyendo trial status
5. `Sidebar` con mini status del trial

### Sprint 3 — Checkout y pagos (3–4 días)
1. `app/(clinic)/marketplace/cart/page.tsx`
2. Server Action `processCheckout()` con cálculo de totales
3. Stripe: crear Customer, Subscription, webhook handlers
4. PayPal: integración con SDK + webhook handler
5. SPEI: generación de referencia + endpoint admin para confirmar
6. CFDI: integración con FacturAPI al recibir webhook de pago exitoso

### Sprint 4 — Trial y bloqueos (2 días)
1. Aplicar `canAccessModule()` en layouts de módulos existentes
2. `TrialExpiredScreen` con sugerencias dinámicas
3. `ExpiredOverlay` global cuando trial expira sin compras
4. Logging de uso (`logModuleUsage()`) en acciones clave

### Sprint 5 — Crons y notificaciones (1–2 días)
1. Cron `trial-reminders` con templates de Postmark + Twilio
2. Cron `subscription-renewal` para SPEI principalmente
3. Templates de email/WhatsApp para días 7, 3, 1, expiración

### Sprint 6 — Polish y QA (1–2 días)
1. Tests E2E del flujo completo (trial → compra → renovación)
2. Auditoría de accesos (sentry, audit_logs)
3. Pruebas con tarjetas de Stripe test
4. Pruebas con sandbox de PayPal

---

## 7. Templates de notificaciones

### 7.1 Email "Te quedan 7 días"

```
Asunto: Te quedan 7 días de prueba en MediFlow

Hola {{firstName}},

Tu prueba gratuita de MediFlow termina el {{trialEndsAt | date}}.

En estos 7 días puedes seguir explorando todos los módulos. Cuando estés
listo, elige los que tu clínica necesita y empieza tu suscripción.

Por ahora has registrado:
- {{patientCount}} pacientes
- {{appointmentCount}} citas
- {{recordCount}} notas clínicas

Esa información se conserva siempre, aún cuando termine tu prueba.

[Elegir mis módulos →]

Saludos,
Equipo MediFlow
```

### 7.2 WhatsApp "Te quedan 3 días"

```
🩺 Hola {{firstName}}, tu prueba de MediFlow termina en 3 días.
Asegura tu acceso eligiendo los módulos que más usas:
{{marketplaceUrl}}
```

### 7.3 Email "Tu prueba terminó"

```
Asunto: Tu prueba de MediFlow terminó — tus datos siguen seguros

Hola {{firstName}},

Tu periodo de prueba terminó hoy. Para seguir trabajando en MediFlow,
elige los módulos que tu clínica necesita.

Buenas noticias:
✓ Todos tus pacientes y registros se conservan intactos
✓ Acceso inmediato al activar cualquier módulo
✓ Sin permanencia, cancelas cuando quieras

Basado en cómo usaste MediFlow, te recomendamos:
{{recommendedModules}}

[Activar mis módulos →]
```

---

## 8. Variables de entorno necesarias

```bash
# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=

# PayPal
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_MODE=sandbox # o "live"

# FacturAPI
FACTURAPI_KEY=

# SPEI (info de cuenta para mostrar al usuario)
SPEI_BANK_NAME=
SPEI_BENEFICIARY=
SPEI_CLABE=

# Cron secret (para proteger los endpoints)
CRON_SECRET=

# Twilio / Postmark (probablemente ya tienes)
TWILIO_*
POSTMARK_*
```

---

## 9. Cosas a NO hacer

- ❌ **No borrar datos** de módulos cuando expire el trial o se cancele suscripción. Solo ocultar (NOM-024 obliga a conservar 5 años).
- ❌ **No cobrar IVA dos veces.** El IVA se calcula UNA sola vez al final, sobre el subtotal ya descontado.
- ❌ **No emitir CFDI antes de confirmar el pago.** FacturAPI se llama solo desde el webhook de pago exitoso.
- ❌ **No permitir SPEI mensual.** Solo anual (en el frontend ya está bloqueado, asegurar también en backend con zod).
- ❌ **No usar `Stripe.subscriptions.cancel()` directo cuando un usuario cancele.** Usar `cancel_at_period_end: true` para que pueda usar lo que ya pagó.
- ❌ **No exponer `stripeSubscriptionId` o secrets** al frontend. Solo `clinicModule.id` y `status`.

---

## 10. Cómo iterar con Claude Code

Te recomiendo prompts pequeños por sprint, no uno gigante. Ejemplo de primer prompt:

> "Lee BRIEF.md y mediflow_marketplace.jsx. Implementa Sprint 1: las migraciones de Prisma para Module, ClinicModule, ModuleUsageLog, Order y Cart, además de los campos nuevos en Clinic. Genera el seed de los 12 módulos. Crea el helper canAccessModule() con tests unitarios. NO toques nada del frontend todavía."

Cuando termine, prompt 2:

> "Continúa con Sprint 2: extrae los componentes del marketplace del JSX a components/marketplace/. Crea la página app/(clinic)/marketplace/page.tsx como Server Component que lee Modules. Implementa el carrito persistente con Cart en DB y Server Actions."

Y así sucesivamente. Esto evita que Claude Code se atragante intentando hacer todo a la vez.

---

**Fin del brief.** Si algo no está claro o necesitas más detalle en alguna sección, pregúntale a Rafael (el dev/PO) directamente.
