# Sprint 2 — Marketplace UI (componentes + página + carrito persistente)

> **Objetivo:** Construir la UI del marketplace, descomponiendo el JSX de prototipo en componentes reales de Next.js 14, y conectándolo a la BD via Server Components.
>
> **Tiempo estimado:** 2–3 días
>
> **Pre-requisitos:** Sprint 1 ✅ DONE

---

## Contexto del sprint

El archivo `mediflow_marketplace.jsx` es un **monolito de preview** con todo en un solo componente. En este sprint lo descomponemos en componentes reusables, lo conectamos a Prisma y montamos la página real del marketplace.

Lee `BRIEF.md` sección 4 (cómo descomponer el JSX) antes de empezar.

---

## Tareas

### Tarea 2.1 — Estructura de carpetas

Crear las carpetas si no existen:

```
app/
  (clinic)/
    marketplace/
      page.tsx
      layout.tsx
components/
  marketplace/
lib/
  marketplace/
    pricing.ts
```

### Tarea 2.2 — Extraer función `pricing.ts`

Desde el JSX, extraer y migrar a TypeScript en `lib/marketplace/pricing.ts`:

```ts
export interface DiscountTier {
  discount: number;
  count: number;
  label: string;
}

export interface CartTotals {
  subtotal: number;
  subtotalMonthly: number;
  annualBonus: number;
  discount: number;
  tax: number;
  final: number;
}

export function getDiscountTier(count: number): DiscountTier | null {
  if (count >= 10) return { discount: 25, count: 10, label: '10+ módulos' };
  if (count >= 5) return { discount: 15, count: 5, label: '5+ módulos' };
  if (count >= 3) return { discount: 10, count: 3, label: '3+ módulos' };
  return null;
}

export function calculateTotal(
  prices: number[],
  billingCycle: 'monthly' | 'annual'
): CartTotals {
  const subtotalMonthly = prices.reduce((sum, p) => sum + p, 0);
  const subtotal = billingCycle === 'annual' ? subtotalMonthly * 12 : subtotalMonthly;
  const annualBonus = billingCycle === 'annual' ? subtotalMonthly * 2 : 0;

  const tier = getDiscountTier(prices.length);
  const baseAfterAnnual = subtotal - annualBonus;
  const discount = tier ? Math.round(baseAfterAnnual * (tier.discount / 100)) : 0;
  const afterDiscount = baseAfterAnnual - discount;
  const tax = Math.round(afterDiscount * 0.16);
  const final = afterDiscount + tax;

  return { subtotal, subtotalMonthly, annualBonus, discount, tax, final };
}
```

**Crear tests** en `lib/marketplace/pricing.test.ts` para casos:

1. 1 módulo mensual a $329 → subtotal 329, sin descuento, tax 52, total 381
2. 3 módulos mensual → 10% descuento aplicado
3. 5 módulos anual → bonificación 2 meses + 15% descuento
4. 10 módulos anual → bonificación + 25% descuento
5. Carrito vacío → todo en 0

### Tarea 2.3 — Helper para resolver íconos

Como los íconos en BD se guardan como strings (`"Activity"`, `"Smile"`, etc.), crear un helper para mapearlos a componentes lucide-react:

```ts
// lib/marketplace/icons.ts
import * as Icons from 'lucide-react';
import { LucideIcon } from 'lucide-react';

export function getModuleIcon(iconKey: string): LucideIcon {
  const Icon = (Icons as any)[iconKey];
  return Icon || Icons.Package;
}
```

### Tarea 2.4 — Componentes de presentación (Client Components)

Extraer del JSX cada componente y guardarlo en su propio archivo TypeScript. Son **Client Components** porque manejan estado de UI:

**`components/marketplace/ModuleCard.tsx`**
- Props: `module` (con tipo `Module` de Prisma), `inCart`, `inTrial`, `trialExpired`, `onAddToCart`, `onRemoveFromCart`, `onDetailClick`
- Convertir el ícono usando `getModuleIcon(module.iconKey)`

**`components/marketplace/DiscountTiersBar.tsx`**
- Props: `cartCount: number`
- Sin cambios mayores, copiar del JSX

**`components/marketplace/FloatingCart.tsx`**
- Props: `cart: ModuleInCart[]`, `billingCycle`, `onClick`
- Reemplazar el `useMemo` que llama a `calculateTotal()`

**`components/marketplace/CartItem.tsx`** y **`components/marketplace/OrderSummary.tsx`**
- Para Sprint 3, pero crearlos esqueléticos ahora si quieres adelantar

**`components/marketplace/Sidebar.tsx`**
- ATENCIÓN: MediFlow probablemente ya tiene un Sidebar. Pregúntale a Rafael cuál es el archivo del sidebar actual y agrégale solo el item "Marketplace" + el mini-status del trial. NO crees un sidebar nuevo.

### Tarea 2.5 — Server Component: la página principal

**`app/(clinic)/marketplace/page.tsx`**

```tsx
import { prisma } from '@/lib/prisma';
import { getCurrentClinic } from '@/lib/auth'; // o el helper que use MediFlow
import { getTrialStatus } from '@/lib/marketplace/access-control';
import { MarketplaceContent } from '@/components/marketplace/MarketplaceContent';

export default async function MarketplacePage() {
  const clinic = await getCurrentClinic();
  if (!clinic) redirect('/login');

  const [modules, clinicModules, trialStatus, cart] = await Promise.all([
    prisma.module.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' }
    }),
    prisma.clinicModule.findMany({
      where: { clinicId: clinic.id }
    }),
    getTrialStatus(clinic.id),
    prisma.cart.findUnique({ where: { clinicId: clinic.id } }),
  ]);

  return (
    <MarketplaceContent
      modules={modules}
      clinicModules={clinicModules}
      trialStatus={trialStatus}
      initialCart={cart?.moduleIds || []}
    />
  );
}
```

Y el `MarketplaceContent.tsx` es Client Component que recibe esos props y maneja la UI.

### Tarea 2.6 — Server Actions para el carrito

**`app/actions/cart.ts`**

```ts
'use server'
import { prisma } from '@/lib/prisma';
import { getCurrentClinic } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const moduleIdSchema = z.string().cuid();

export async function addToCart(moduleId: string) {
  const validated = moduleIdSchema.parse(moduleId);
  const clinic = await getCurrentClinic();
  if (!clinic) throw new Error('Unauthorized');

  // Verificar que el módulo no esté ya comprado
  const existing = await prisma.clinicModule.findFirst({
    where: { clinicId: clinic.id, moduleId: validated, status: 'active' }
  });
  if (existing) throw new Error('Module already purchased');

  await prisma.cart.upsert({
    where: { clinicId: clinic.id },
    create: { clinicId: clinic.id, moduleIds: [validated] },
    update: {
      moduleIds: { push: validated }, // Postgres array_append
    }
  });

  revalidatePath('/marketplace');
}

export async function removeFromCart(moduleId: string) {
  const validated = moduleIdSchema.parse(moduleId);
  const clinic = await getCurrentClinic();
  if (!clinic) throw new Error('Unauthorized');

  const cart = await prisma.cart.findUnique({ where: { clinicId: clinic.id } });
  if (!cart) return;

  await prisma.cart.update({
    where: { clinicId: clinic.id },
    data: { moduleIds: cart.moduleIds.filter(id => id !== validated) }
  });

  revalidatePath('/marketplace');
}

export async function clearCart() {
  const clinic = await getCurrentClinic();
  if (!clinic) throw new Error('Unauthorized');

  await prisma.cart.update({
    where: { clinicId: clinic.id },
    data: { moduleIds: [] }
  });

  revalidatePath('/marketplace');
}
```

### Tarea 2.7 — Estado del carrito en el cliente

En `MarketplaceContent.tsx` usar **optimistic updates** con `useTransition`:

```tsx
'use client'
import { useTransition, useState } from 'react';
import { addToCart, removeFromCart } from '@/app/actions/cart';

export function MarketplaceContent({ modules, clinicModules, trialStatus, initialCart }) {
  const [cart, setCart] = useState<string[]>(initialCart);
  const [isPending, startTransition] = useTransition();

  const handleAdd = (moduleId: string) => {
    setCart(prev => [...prev, moduleId]); // optimistic
    startTransition(async () => {
      try {
        await addToCart(moduleId);
      } catch {
        setCart(prev => prev.filter(id => id !== moduleId)); // rollback
        toast.error('No se pudo agregar al carrito');
      }
    });
  };

  // ...
}
```

### Tarea 2.8 — Determinar el estado de cada módulo

Computar en el cliente (basado en datos del servidor) si cada módulo está:

```ts
function getModuleStatus(
  module: Module,
  clinicModules: ClinicModule[],
  trialStatus: TrialStatus
): 'purchased' | 'trial' | 'available' | 'locked' {
  const cm = clinicModules.find(cm => cm.moduleId === module.id);
  if (cm && cm.status === 'active' && cm.currentPeriodEnd > new Date()) {
    return 'purchased';
  }
  if (!trialStatus.isExpired) {
    return 'available'; // durante trial, todo accesible
  }
  return 'locked';
}
```

### Tarea 2.9 — TrialBanner (Server Component)

**`components/trial/TrialBanner.tsx`**

```tsx
import { getCurrentClinic } from '@/lib/auth';
import { getTrialStatus } from '@/lib/marketplace/access-control';
import { TrialBannerClient } from './TrialBannerClient';

export async function TrialBanner() {
  const clinic = await getCurrentClinic();
  if (!clinic) return null;

  const status = await getTrialStatus(clinic.id);
  if (!status || status.isExpired) return null;

  return <TrialBannerClient daysLeft={status.daysLeft} />;
}
```

`TrialBannerClient.tsx` es Client Component que recibe `daysLeft` y renderiza la versión visual del banner (los 3 estados de urgencia: morado, amarillo, rojo). Copiar del JSX.

### Tarea 2.10 — Layout con TrialBanner

Modificar (o crear) `app/(clinic)/layout.tsx` para incluir el TrialBanner arriba del contenido:

```tsx
import { TrialBanner } from '@/components/trial/TrialBanner';

export default function ClinicLayout({ children }) {
  return (
    <div>
      <TrialBanner />
      <div className="flex">
        <Sidebar />
        <main>{children}</main>
      </div>
    </div>
  );
}
```

### Tarea 2.11 — Verificación manual

Pruebas manuales antes de cerrar:

- [ ] La página `/marketplace` carga y muestra los 12 módulos
- [ ] El TrialBanner aparece arriba con el día actual del trial
- [ ] Al click "Agregar al carrito", el botón cambia a "En el carrito"
- [ ] Refrescar la página: el carrito persiste (porque está en BD)
- [ ] La barra de descuentos muestra el tier correcto según items en carrito
- [ ] El FloatingCart aparece cuando hay items y muestra el total correcto
- [ ] Si una clínica de test tiene un módulo "purchased", aparece en azul con "Ya comprado"

---

## Criterios de "DONE"

✅ Página `/marketplace` funcional con datos reales de Prisma
✅ Componentes descompuestos del JSX, todos en TypeScript
✅ `pricing.ts` con tests pasando
✅ Carrito persistente en BD via Server Actions
✅ TrialBanner como Server Component leyendo trial real
✅ Sidebar de MediFlow tiene item "Marketplace" + mini-status del trial
✅ `PROGRESS.md` actualizado

---

## Notas importantes

- **NO implementes el checkout todavía.** Eso es Sprint 3. Los botones "Comprar" pueden no hacer nada o llevar a `/marketplace/cart` (que no existirá aún).
- **NO implementes la pantalla de detalle del módulo todavía.** El "Gestionar" puede no hacer nada.
- **NO implementes la pantalla de trial expirado todavía.** Si el trial expira, no pasa nada visible aún (solo desaparece el banner).
- **El JSX tiene un slider para simular días del trial.** Eso es solo para preview, NO lo migres al código real. La data sale de la BD.

---

## Después de terminar

1. Actualiza `PROGRESS.md` (Sprint 2 ✅ DONE, lista de archivos creados, etc.)
2. **DETÉNTE** y espera validación de Rafael.
