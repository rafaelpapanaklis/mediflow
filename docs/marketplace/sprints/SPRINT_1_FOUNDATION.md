# Sprint 1 — Foundation (BD + Schema + Access Control)

> **Objetivo:** Sentar las bases de datos, modelos y lógica de control de acceso. NO tocar frontend en este sprint.
>
> **Tiempo estimado:** 1–2 días
>
> **Pre-requisitos:** Ninguno

---

## Contexto del sprint

Antes de poder vender módulos, necesitamos las tablas que los representan. Este sprint crea toda la fundación de datos y la lógica que controla quién puede acceder a qué módulo.

Lee `BRIEF.md` secciones 1 (reglas de negocio) y 2 (cambios en BD) antes de empezar.

---

## Tareas

### Tarea 1.1 — Migración Prisma: nuevos campos en `Clinic`

Modifica `prisma/schema.prisma` para agregar al modelo `Clinic`:

```prisma
trialStartedAt   DateTime  @default(now()) @map("trial_started_at")
trialEndsAt      DateTime  @map("trial_ends_at")
trialNotified7d  Boolean   @default(false) @map("trial_notified_7d")
trialNotified3d  Boolean   @default(false) @map("trial_notified_3d")
trialNotified1d  Boolean   @default(false) @map("trial_notified_1d")
```

Y las relaciones inversas (que se completarán cuando se creen los modelos siguientes):

```prisma
modules          ClinicModule[]
moduleUsageLogs  ModuleUsageLog[]
orders           Order[]
cart             Cart?
```

**Backfill de clínicas existentes:** crea un script `prisma/migrations/backfill_trial.sql` que haga:

```sql
UPDATE clinics
SET trial_ends_at = created_at + INTERVAL '14 days'
WHERE trial_ends_at IS NULL;
```

### Tarea 1.2 — Crear modelo `Module`

Ver `BRIEF.md` sección 2.2. Schema completo:

```prisma
model Module {
  id              String   @id @default(cuid())
  key             String   @unique
  name            String
  category        String
  description     String   @db.Text
  iconKey         String   @map("icon_key")
  iconBg          String   @map("icon_bg")
  iconColor       String   @map("icon_color")
  features        String[]
  priceMxnMonthly Int      @map("price_mxn_monthly")
  isCore          Boolean  @default(false) @map("is_core")
  dependsOn       String[] @map("depends_on")
  sortOrder       Int      @default(0) @map("sort_order")
  isActive        Boolean  @default(true) @map("is_active")

  clinicModules   ClinicModule[]

  @@map("modules")
}
```

### Tarea 1.3 — Crear modelo `ClinicModule`

Ver `BRIEF.md` sección 2.3.

### Tarea 1.4 — Crear modelo `ModuleUsageLog`

Ver `BRIEF.md` sección 2.4.

### Tarea 1.5 — Crear modelo `Order`

Ver `BRIEF.md` sección 2.5.

### Tarea 1.6 — Crear modelo `Cart`

```prisma
model Cart {
  clinicId  String   @id @map("clinic_id")
  moduleIds String[] @map("module_ids")
  updatedAt DateTime @updatedAt @map("updated_at")

  clinic    Clinic @relation(fields: [clinicId], references: [id], onDelete: Cascade)

  @@map("carts")
}
```

### Tarea 1.7 — Generar la migración

```bash
npx prisma migrate dev --name marketplace_foundation
```

**IMPORTANTE:** Antes de correr esto, muéstrale a Rafael el SQL generado para que lo apruebe (puede usar `--create-only` para generar sin aplicar).

### Tarea 1.8 — Crear seed de los 12 módulos

Crear `prisma/seed-modules.ts` con los 12 módulos del catálogo. La data exacta está en `BRIEF.md` sección 5 (el array `SEED_MODULES`).

Asegúrate que el seed sea **idempotente** (usar `upsert`, no `create`) para que se pueda ejecutar varias veces sin duplicar.

Agregar al `package.json`:
```json
{
  "scripts": {
    "seed:modules": "tsx prisma/seed-modules.ts"
  }
}
```

Y ejecutar `npm run seed:modules` para verificar que carga bien.

### Tarea 1.9 — RLS Policies en Supabase

MediFlow usa RLS deny-all en todas las tablas. Crear migración SQL `prisma/migrations/marketplace_rls.sql`:

```sql
-- Modules: catálogo público (cualquier autenticado puede leer)
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "modules_select_authenticated" ON modules
  FOR SELECT TO authenticated USING (is_active = true);

-- ClinicModules: solo dueños/admins de la clínica
ALTER TABLE clinic_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic_modules_select_own" ON clinic_modules
  FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE user_id = auth.uid()
  ));

-- Orders: solo dueños/admins, INSERT/UPDATE solo desde service role
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_select_own" ON orders
  FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE user_id = auth.uid()
  ));

-- ModuleUsageLogs: INSERT desde sesión, SELECT solo dueños
ALTER TABLE module_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_logs_insert_own" ON module_usage_logs
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE user_id = auth.uid()
  ));
CREATE POLICY "usage_logs_select_own" ON module_usage_logs
  FOR SELECT TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE user_id = auth.uid()
  ));

-- Cart: solo el dueño de la clínica
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cart_all_own" ON carts
  FOR ALL TO authenticated
  USING (clinic_id IN (
    SELECT clinic_id FROM clinic_users WHERE user_id = auth.uid()
  ));
```

> **Nota:** Si la tabla que vincula usuarios con clínicas se llama distinto a `clinic_users` en MediFlow, ajusta. Pregunta a Rafael si no está claro.

### Tarea 1.10 — Crear `lib/marketplace/access-control.ts`

```ts
// lib/marketplace/access-control.ts
import { prisma } from '@/lib/prisma';

export interface ModuleAccess {
  hasAccess: boolean;
  reason: 'trial' | 'purchased' | 'expired' | 'not_purchased';
}

export async function canAccessModule(
  clinicId: string,
  moduleKey: string
): Promise<ModuleAccess> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    include: {
      modules: {
        include: { module: true },
        where: { module: { key: moduleKey } }
      }
    }
  });

  if (!clinic) return { hasAccess: false, reason: 'not_purchased' };

  const now = new Date();
  const isInTrial = now < clinic.trialEndsAt;

  // Durante trial: acceso a TODO
  if (isInTrial) {
    return { hasAccess: true, reason: 'trial' };
  }

  // Post-trial: solo si está comprado y activo
  const cm = clinic.modules[0];
  if (!cm) {
    return { hasAccess: false, reason: 'not_purchased' };
  }

  const isActive = cm.status === 'active' && cm.currentPeriodEnd > now;
  return {
    hasAccess: isActive,
    reason: isActive ? 'purchased' : 'expired'
  };
}

export async function getTrialStatus(clinicId: string) {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { trialStartedAt: true, trialEndsAt: true }
  });

  if (!clinic) return null;

  const now = new Date();
  const msLeft = clinic.trialEndsAt.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));

  return {
    trialStartedAt: clinic.trialStartedAt,
    trialEndsAt: clinic.trialEndsAt,
    daysLeft,
    isExpired: msLeft <= 0,
  };
}
```

### Tarea 1.11 — Tests unitarios de access-control

Crear `lib/marketplace/access-control.test.ts` con casos:

1. Clínica en día 5 del trial → tiene acceso a cualquier módulo (`reason: 'trial'`)
2. Clínica en día 14 sin compras → no tiene acceso (`reason: 'not_purchased'`)
3. Clínica en día 14 con módulo comprado activo → tiene acceso (`reason: 'purchased'`)
4. Clínica con módulo comprado pero `currentPeriodEnd` pasado → no tiene acceso (`reason: 'expired'`)
5. Clínica inexistente → no tiene acceso

Usa Vitest o Jest según lo que ya use MediFlow (revisa `package.json`).

### Tarea 1.12 — Verificación manual

Antes de cerrar el sprint, valida que:

- [ ] `npx prisma migrate status` muestra todas las migraciones aplicadas
- [ ] `npm run seed:modules` crea los 12 módulos sin errores
- [ ] En Supabase Studio puedes ver las tablas nuevas con sus RLS policies
- [ ] Los tests de access-control pasan
- [ ] Una clínica nueva (de test) automáticamente tiene `trial_ends_at = now + 14 días`

---

## Criterios de "DONE"

✅ Schema Prisma actualizado, migración aplicada y verificada en Supabase
✅ Los 12 módulos en la tabla `modules`
✅ RLS policies activas y probadas
✅ `canAccessModule()` y `getTrialStatus()` con tests pasando
✅ `PROGRESS.md` actualizado con bitácora del sprint y archivos modificados
✅ NO se ha tocado código de frontend todavía

---

## Después de terminar

1. Actualiza `PROGRESS.md`:
   - Marca Sprint 1 como ✅ DONE
   - Agrega entrada en bitácora con fecha y resumen
   - Lista archivos creados/modificados en la sección "Sprint 1"
   - Cambia "Sprint actual" a Sprint 2

2. **DETÉNTE.** Avisa a Rafael que Sprint 1 está listo y espera su validación antes de continuar.
