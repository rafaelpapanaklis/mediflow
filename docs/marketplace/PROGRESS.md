# 📊 PROGRESS — Estado del proyecto

> Claude Code: actualiza este archivo después de cada sprint terminado.
> Rafael: revisa este archivo para saber dónde va Claude Code.

---

## Sprint actual

**Sprint 3 — Checkout + Payments (Stripe + PayPal + SPEI + CFDI)**

➡️ Próximo paso: Rafael valida Sprint 2 (entra a `/dashboard/marketplace`, prueba el carrito persistente, ve el TrialBanner). Cuando confirme, leer `sprints/SPRINT_3_CHECKOUT_PAYMENTS.md`.

---

## Estado de cada sprint

| # | Sprint | Estado | Notas |
|---|--------|--------|-------|
| 1 | Foundation (BD + schema + seeds + access control) | ✅ DONE | Mergeado a main (commit `2ab24a4`) |
| 2 | Marketplace UI (componentes + página + carrito persistente) | ✅ DONE | Branch `marketplace-sprint-2` listo para QA |
| 3 | Checkout + Payments (Stripe + PayPal + SPEI + CFDI) | ⏳ TODO | — |
| 4 | Trial Lockdown (banners + expiry + bloqueos) | ⏳ TODO | — |
| 5 | Crons + Notifications (Vercel Cron + Postmark + Twilio) | ⏳ TODO | — |
| 6 | QA + Polish (tests + auditoría + verificación final) | ⏳ TODO | — |

**Leyenda:**
- ⏳ TODO — no iniciado
- 🔨 IN PROGRESS — en curso
- ✅ DONE — terminado y validado por Rafael
- ⚠️ BLOCKED — bloqueado, requiere decisión de Rafael

---

## Bitácora de cambios

> Claude Code: agrega una entrada cada vez que termines un sprint o tomes una decisión importante.
> Formato: `### [YYYY-MM-DD] — Título corto`

### [2026-04-30] — Sprint 2 completado

**Branch:** `marketplace-sprint-2` (worktree en `../mediflow-mkt`).

**Resumen:**
- `pricing.ts` con `getDiscountTier` (3+/5+/10+ → 10/15/25 %) y
  `calculateTotal` (subtotal × meses, bonificación anual de 2 meses,
  descuento por volumen, IVA 16 % al final). 5 tests con `node:test`,
  todos verdes.
- `icons.ts` mapper string → `LucideIcon` (fallback `Package`).
- Server Actions del carrito en `src/app/actions/cart.ts`:
  `addToCart`, `removeFromCart`, `clearCart`. Validación con zod
  (cuid), multi-tenant via `getAuthContext()`, dedupe del array,
  bloqueo si el módulo ya está activo, `revalidatePath`.
- 6 componentes en `src/components/marketplace/`:
  `ModuleCard`, `DiscountTiersBar`, `FloatingCart`, `CartItem`
  (esqueleto), `OrderSummary` (esqueleto), y `MarketplaceContent`
  (Client wrapper con `useTransition` + estado optimista + rollback +
  `react-hot-toast` en error).
- Página Server Component `/dashboard/marketplace` (`force-dynamic`)
  que carga `modules + clinicModules + trialStatus + cart` con
  `Promise.all`.
- Sidebar: nuevo item "Marketplace" con ícono `ShoppingBag`, gated
  por `marketplace.view`. Mini-status del trial
  (`TrialSidebarStatus`) con 3 estados según urgencia (>7d morado /
  4-7d amarillo / 1-3d rojo) entre el switcher y el menú.
- `marketplace.view` agregado a `permissions.ts` (en `ALL_PERMISSIONS`,
  `PERMISSION_GROUPS` nuevo grupo "Marketplace", y default de DOCTOR
  + RECEPTIONIST). SUPER_ADMIN/ADMIN/READONLY lo heredan automático.
- `trial-banner.tsx` extendido (un-deprecated): 3 estados según
  `daysLeft`, CTA "Elegir mis módulos" → `/dashboard/marketplace`,
  oculto si trial expirado o ausente. Montado en
  `src/app/dashboard/layout.tsx` debajo del Topbar.
- `tailwind.config.ts`: safelist con regex para clases de iconos del
  catálogo (`bg-(blue|cyan|...)-50` y `text-(blue|...)-600`) — vienen
  de BD y serían purgadas sin safelist.
- `prisma generate`, `tsc --noEmit`, `npm run build` (163 páginas) y
  ambos test suites (12 tests) limpios.

**Decisiones tomadas:**
- 1 módulo $329 mensual → IVA 53, total 382 (cómputo correcto vs.
  los valores 52/381 del sprint doc, que estaban mal redondeados).
- `MarketplaceContent` usa `useTransition` con set local de IDs
  pendientes — un módulo sigue siendo interactivo mientras otro
  está pendiente.
- TrialPill (topbar, ya existente) y TrialBanner (banner ancho con
  CTA al marketplace) coexisten — propósitos distintos. La pill sigue
  apuntando al flujo de upgrade del plan, el banner empuja al
  marketplace.

---

## Decisiones pendientes para Rafael

> Claude Code: si encuentras algo que requiera input humano, agrégalo aquí en lugar de asumir.

- (Ninguna por ahora)

---

## Pasos de QA para Sprint 2

Antes de mergear `marketplace-sprint-2` a `main`:

1. **Marketplace renderiza el catálogo**
   - Entrar a `/dashboard/marketplace` → ver 12 módulos en grid
     (3 columnas en desktop, 2 en tablet, 1 en móvil).
   - Tabs: Todos, Dental, Pediatría, Cardiología, Dermatología,
     Ginecología, Nutrición, Estética. Filtran al click.
   - Búsqueda por nombre/descripción/categoría funciona.
2. **Carrito persistente**
   - Click "Agregar al carrito" en 3 módulos → botón cambia a
     "En el carrito" y `FloatingCart` aparece con total.
   - Refrescar la página → el carrito persiste (BD `Cart`).
   - Click "En el carrito" lo quita.
   - Reintentar agregar bajo bloqueo de red (devtools offline) →
     toast de error y rollback del optimista.
3. **TrialBanner muestra 3 estados**
   - Si la clínica está en trial con >7 días: banner morado
     "Prueba gratis · Acceso completo".
   - Con 4-7 días: banner amarillo.
   - Con 1-3 días: banner rojo "¡Tu prueba termina en X días!".
   - CTA "Elegir mis módulos" lleva a `/dashboard/marketplace`.
4. **Sidebar**
   - Nuevo item "Marketplace" con ícono ShoppingBag en sección
     workspace (después de "Mensajes"). Activo cuando estás en
     `/dashboard/marketplace`.
   - Mini-status del trial debajo del switcher de clínica con el
     mismo color que el banner.
5. **DiscountTiersBar**
   - Sin items: barra vacía, mensaje "Agrega 3 módulos más para
     desbloquear el 10% de descuento".
   - Con 3 items: 10% activo (badge verde), siguiente milestone 5+.
   - Con 5: 15%. Con 10: 25%, sin "next tier".
6. **Tests verdes**
   - `npm run test:marketplace`         → 7 tests
   - `npm run test:marketplace-pricing` → 5 tests
7. **Permisos (opcional)**
   - SUPER_ADMIN: ve "Marketplace" siempre.
   - DOCTOR / RECEPTIONIST / ADMIN: ven el item por default.
   - READONLY: lo ve también (es `.view`, pasa el filtro automático).
   - Si SUPER_ADMIN quita `marketplace.view` del override de un
     usuario en `/dashboard/team`, ese usuario ya no ve el item.

---

## Archivos creados / modificados (acumulado)

> Claude Code: lista aquí los archivos que crees o modifiques en cada sprint para que Rafael pueda hacer code review focalizado.

### Sprint 1
- **modificados**
  - `prisma/schema.prisma` — campos de trial en `Clinic` + 5 modelos nuevos.
  - `package.json` — scripts `seed`, `test:marketplace` y bloque `prisma.seed`.
  - `docs/marketplace/PROGRESS.md` — bitácora del sprint.
- **creados**
  - `prisma/migrations/20260430140000_marketplace_foundation/migration.sql`
  - `prisma/seed.ts`
  - `src/lib/marketplace/access-control.ts`
  - `src/lib/marketplace/access-control-core.ts`
  - `src/lib/marketplace/access-control.test.ts`

### Sprint 2
- **modificados**
  - `package.json` — script `test:marketplace-pricing`.
  - `tailwind.config.ts` — safelist de clases de íconos.
  - `src/lib/auth/permissions.ts` — `marketplace.view` (ALL_PERMISSIONS,
    PERMISSION_GROUPS, defaults DOCTOR + RECEPTIONIST).
  - `src/components/dashboard/sidebar.tsx` — item Marketplace +
    integración de `TrialSidebarStatus` + props `trialEndsAt` /
    `isInTrial`.
  - `src/components/dashboard/trial-banner.tsx` — 3 estados +
    CTA al marketplace (un-deprecated).
  - `src/app/dashboard/layout.tsx` — monta `TrialBanner` y pasa
    `trialEndsAt` / `isInTrial` al `Sidebar`.
  - `docs/marketplace/PROGRESS.md` — bitácora del sprint.
- **creados**
  - `src/lib/marketplace/pricing.ts`
  - `src/lib/marketplace/pricing.test.ts`
  - `src/lib/marketplace/icons.ts`
  - `src/app/actions/cart.ts`
  - `src/components/marketplace/ModuleCard.tsx`
  - `src/components/marketplace/DiscountTiersBar.tsx`
  - `src/components/marketplace/FloatingCart.tsx`
  - `src/components/marketplace/CartItem.tsx`
  - `src/components/marketplace/OrderSummary.tsx`
  - `src/components/marketplace/MarketplaceContent.tsx`
  - `src/components/dashboard/trial-sidebar-status.tsx`
  - `src/app/dashboard/marketplace/page.tsx`

### Sprint 3
- (Pendiente)

### Sprint 4
- (Pendiente)

### Sprint 5
- (Pendiente)

### Sprint 6
- (Pendiente)
