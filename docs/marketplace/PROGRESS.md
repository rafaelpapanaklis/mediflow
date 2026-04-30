# 📊 PROGRESS — Estado del proyecto

> Claude Code: actualiza este archivo después de cada sprint terminado.
> Rafael: revisa este archivo para saber dónde va Claude Code.

---

## Sprint actual

**Sprint 2 — Marketplace UI (componentes + página + carrito persistente)**

➡️ Próximo paso: Rafael valida Sprint 1 (aplica SQL en Supabase + corre seed). Cuando confirme, leer `sprints/SPRINT_2_MARKETPLACE_UI.md`.

---

## Estado de cada sprint

| # | Sprint | Estado | Notas |
|---|--------|--------|-------|
| 1 | Foundation (BD + schema + seeds + access control) | ✅ DONE | Branch `marketplace-sprint-1` listo para QA |
| 2 | Marketplace UI (componentes + página + carrito persistente) | ⏳ TODO | — |
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

### [2026-04-30] — Sprint 1 completado

**Branch:** `marketplace-sprint-1` (worktree en `../mediflow-mkt`).

**Resumen:**
- Schema Prisma extendido con campos de trial granular en `Clinic`
  (`trialStartedAt`, `trialNotified7d/3d/1d`) y conversión de
  `trialEndsAt` a NOT NULL. 5 modelos nuevos: `Module`, `ClinicModule`,
  `ModuleUsageLog`, `Order`, `Cart`.
- Migration SQL idempotente con `IF NOT EXISTS` en
  `prisma/migrations/20260430140000_marketplace_foundation/migration.sql`.
  Backfill de clínicas existentes: `trial_started_at = createdAt` y
  `trialEndsAt = createdAt + 14d` (solo si NULL — no sobreescribe).
  Habilita RLS deny-all en las 5 tablas nuevas.
- Seed canónico de 12 módulos en `prisma/seed.ts` (idempotente vía
  `upsert` por `key`). Scripts `npm run seed` y `npm run test:marketplace`.
- Helper `canAccessModule(clinicId, moduleKey)` en
  `src/lib/marketplace/access-control.ts`. Lógica pura
  `evaluateAccess()` extraída a `access-control-core.ts` para tests
  sin Prisma. 7 tests con `node:test` corren en ~250 ms — todos verdes.
- `prisma generate`, `tsc --noEmit` y `npm run build` limpios.

**Decisiones tomadas (confirmadas por Rafael en el prompt):**
- Tabla `Order` separada de `SubscriptionInvoice` (propósitos distintos).
- Migración B: todas las clínicas (existentes + nuevas) ven el marketplace.
- 1:1 `ClinicModule.stripeSubscriptionId` (5 módulos = 5 Subscriptions).
- Catálogo multi-tipo: 6 dentales + 6 no-dentales (cardiología,
  pediatría, ginecología, etc.) — todos válidos como producto.

---

## Decisiones pendientes para Rafael

> Claude Code: si encuentras algo que requiera input humano, agrégalo aquí en lugar de asumir.

- (Ninguna por ahora)

---

## Pasos de QA para Sprint 1

Antes de mergear `marketplace-sprint-1` a `main`:

1. **Aplicar SQL en Supabase**
   - Abrir `prisma/migrations/20260430140000_marketplace_foundation/migration.sql`.
   - Pegar en Supabase SQL Editor y ejecutar. Es idempotente — seguro
     re-correr si algo falla.
2. **Correr el seed**
   - `npx tsx prisma/seed.ts`
   - Esperado: log `Listo. Total de módulos en BD: 12`.
3. **Verificar que existen 12 filas en `modules`**
   - Supabase Studio → Table Editor → `modules` → 12 filas con keys:
     `general-dentistry`, `orthodontics`, `periodontics`, `endodontics`,
     `implantology`, `pediatric-dentistry`, `pediatrics`, `cardiology`,
     `dermatology`, `gynecology`, `nutrition`, `aesthetic-medicine`.
4. **Verificar backfill de trial en clínicas existentes**
   - `SELECT id, name, trial_started_at, "trialEndsAt" FROM clinics;`
   - Todas deben tener `trial_started_at` poblado (= `createdAt`)
     y `trialEndsAt` no nulo.
5. **Verificar RLS**
   - `SELECT tablename, policyname FROM pg_policies WHERE tablename IN
     ('modules','clinic_modules','module_usage_logs','orders','carts');`
   - Esperado: 5 filas, una por tabla, todas con `*_deny_anon`.
6. **Re-correr tests unitarios localmente**
   - `npm run test:marketplace` → `pass 7  fail 0`.

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
- (Pendiente)

### Sprint 3
- (Pendiente)

### Sprint 4
- (Pendiente)

### Sprint 5
- (Pendiente)

### Sprint 6
- (Pendiente)
