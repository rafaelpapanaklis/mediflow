# Módulo de Odontopediatría — MediFlow

> Módulo del marketplace que agrega un expediente pediátrico clínico
> dentro del detalle del paciente (cuando aplica). Cubre conducta,
> riesgo cariogénico, hábitos orales, cronología de erupción,
> mantenedores, sellantes, flúor, endodoncia pediátrica y
> consentimiento parental con firma digital.

**Spec completo:** `docs/marketplace/research/odontopediatria/SPEC.md`
**Branch original:** `feature/pediatrics-module-v1`

---

## 1. Resumen

| Aspecto | Estado |
|---|---|
| Modelos Prisma nuevos | 11 (`PediatricRecord`, `Guardian`, `BehaviorAssessment`, `CariesRiskAssessment`, `OralHabit`, `EruptionRecord`, `SpaceMaintainer`, `Sealant`, `FluorideApplication`, `PediatricEndodonticTreatment`, `PediatricConsent`). |
| Enums | 16 (todos prefijados `Ped*`). |
| Server actions | 12 archivos en `src/app/actions/pediatrics/` con auth + zod + audit + revalidatePath. |
| UI | Tab "Pediatría" dentro de `/dashboard/patients/[id]` con 6 sub-secciones (Resumen, Odontograma, Erupción, Hábitos, Conducta, Plan preventivo). |
| Drawer base | `src/components/ui/design-system/Drawer.tsx` con focus-trap manual y portal. |
| Tests | 5 archivos en `src/lib/pediatrics/__tests__/` (44 casos) corriendo con `tsx --test`. |
| Multi-tenant | Sí — cada query y mutación usa `clinicId` del `getAuthContext()`. |
| RLS | Sí — deny-all para anon/authenticated en las 11 tablas nuevas. |
| Audit log | Catálogo `PEDIATRIC_AUDIT_ACTIONS` integrado a `src/lib/audit.ts`. |
| WhatsApp | 4 plantillas pediátricas (`PED_PRECITA`, `PED_POSTFLUOR`, `PED_SELANTE_REVISION`, `PED_CUMPLE`) que resuelven a `guardian.phone`. |

---

## 2. Estructura de carpetas

```
src/
├── app/
│   ├── actions/pediatrics/         # Server actions (12 archivos + helpers)
│   │   ├── _helpers.ts             # loadPatientForPediatrics + auditPediatric
│   │   ├── result.ts               # ActionResult / isFailure (client-safe)
│   │   ├── record.ts               # createPediatricRecord, getPediatricRecord
│   │   ├── guardian.ts             # addGuardian, setPrimaryGuardian, ...
│   │   ├── behavior.ts             # captureBehavior (Frankl/Venham)
│   │   ├── cambra.ts               # captureCambra
│   │   ├── habits.ts, eruption.ts, ...
│   │   └── index.ts                # barrel
│   ├── api/pediatrics/context/     # GET context para nueva cita
│   └── dashboard/patients/[id]/    # Page integrado con gating
├── components/
│   ├── ui/design-system/Drawer.tsx # Drawer base reutilizable
│   └── patient-detail/pediatrics/
│       ├── PediatricsTab.tsx       # shell del módulo
│       ├── PediatricsContextStrip.tsx
│       ├── PediatricsSiderail.tsx
│       ├── PediatricsSubNav.tsx
│       ├── sections/               # 6 sub-tabs
│       ├── cards/                  # 7 cards
│       ├── charts/                 # EruptionChart, FranklTrendChart, HabitsTimeline
│       ├── odontogram/             # PediatricOdontogram + Tooth
│       ├── drawers/                # 12 drawers de captura
│       └── modals/                 # ConsentModal, SignaturePad, EvolutionCompare
├── lib/pediatrics/
│   ├── age.ts                      # calculateAge, isPediatric
│   ├── dentition.ts                # classifyDentition + tablas FDI
│   ├── eruption-data.ts            # ERUPTION_TABLE OMS (52 dientes)
│   ├── cambra.ts                   # scoreCambra + opciones
│   ├── frankl.ts                   # labels + detectRegression
│   ├── permissions.ts              # canSeePediatrics, PEDIATRICS_MODULE_KEY
│   ├── audit.ts                    # PEDIATRIC_AUDIT_ACTIONS catálogo
│   ├── soap-prefill.ts             # buildPediatricSoapPrefill
│   ├── whatsapp-templates.ts       # 4 plantillas + resolver de tutor
│   └── __tests__/                  # 44 casos
└── types/pediatrics.ts             # Prisma generic types
```

---

## 3. Cómo activar el módulo en una clínica

El módulo vive en el marketplace (Sprint 1) con la key `pediatric-dentistry`.
Para que aparezca el tab "Pediatría":

1. **Categoría compatible:** `clinic.category` debe ser `DENTAL` o `MEDICINE`.
2. **Módulo activo:** debe existir un registro en `clinic_modules` con:
   - `module.key = 'pediatric-dentistry'`
   - `status = 'active'`
   - `currentPeriodEnd > NOW()`
3. **Paciente menor de 14 años:** el chequeo usa `isPediatric(patient.dob, 14)`.
   El cutoff puede subirse a 16 vía `PediatricRecord.cutoffOverrideYears`.

Si los 3 predicados son `true`, el tab "Pediatría" se renderiza en
`/dashboard/patients/[id]`. Si alguno falla, el tab **se oculta** (no se
muestra deshabilitado).

### Activar manualmente vía SQL (dev)

```sql
INSERT INTO clinic_modules (
  id, clinic_id, module_id, status, billing_cycle,
  current_period_start, current_period_end, payment_method, price_paid_mxn
)
SELECT
  gen_random_uuid()::text,
  '<CLINIC_ID>',
  m.id,
  'active',
  'monthly',
  NOW(),
  NOW() + INTERVAL '12 months',
  'manual',
  m.price_mxn_monthly
FROM modules m
WHERE m.key = 'pediatric-dentistry';
```

---

## 4. Cómo agregar un nuevo tipo de captura

**Ejemplo:** quieres agregar "Toma de impresiones" como entidad propia.

1. **Schema** (`prisma/schema.prisma`):
   - Agrega un enum si necesitas categorizar tipos.
   - Agrega un nuevo modelo siguiendo las convenciones del módulo:
     `clinicId`, `patientId`, `pediatricRecordId`, `createdBy`,
     `createdAt`, `updatedAt`, `deletedAt`, `@@index([clinicId])`,
     `@@index([deletedAt])`.
2. **Migración:** crea `prisma/migrations/<timestamp>_<nombre>/migration.sql`
   siguiendo el patrón idempotente del repo (`DO $$ ... duplicate_object`,
   `IF NOT EXISTS` y RLS deny-all).
3. **Server action** (`src/app/actions/pediatrics/<tu-modulo>.ts`):
   - Importa `loadPatientForPediatrics`, `auditPediatric`, `ensurePediatricRecord`.
   - Define un `zod schema` para el input.
   - Sigue el patrón: auth → guard → ensure record → mutate → audit → revalidatePath → return ok/fail.
   - Exporta desde `src/app/actions/pediatrics/index.ts`.
4. **Tipo** en `src/types/pediatrics.ts`: añade el `Row` con `Prisma.<Modelo>GetPayload<{}>`.
5. **Audit action:** agrega la nueva acción al objeto `PEDIATRIC_AUDIT_ACTIONS` en `src/lib/pediatrics/audit.ts`.
6. **UI (drawer)** en `src/components/patient-detail/pediatrics/drawers/`:
   - Crea `<Tu>Drawer.tsx` que use `<CaptureDrawer>` y consuma tu server action.
   - Maneja `setSaving`, `isFailure(result)`, `toast.success/error`.
7. **UI (sección/card)** según corresponda.

Sigue las reglas de oro del módulo:

- Cero `any` en TypeScript; usa `unknown` y narrow.
- Cero hex crudos en componentes; usa `var(--brand)` y compañía.
- Español neutro mexicano (no voseo argentino).
- WCAG AA: `outline 2px brand` en todo elemento accionable.
- `prefers-reduced-motion` respetado en animaciones.

---

## 5. Pruebas

```bash
# Lib helpers (44 casos)
npx tsx --test src/lib/pediatrics/__tests__/*.test.ts

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

Casos clínicos cubiertos en los tests:

- Mateo Hernández García (4 a 7 m) → dentición temporal, CAMBRA Alto/Extremo según factores.
- Sofía (8 a 2 m) → dentición mixta.
- Diego (12 a 11 m) → dentición permanente, cerca del cutoff de 14 años.

---

## 6. Roadmap

| Versión | Funcionalidad |
|---|---|
| **v1.0 (MVP)** — entregado | Schema, 6 sub-tabs, drawers, charts, consents, audit, WhatsApp templates. |
| **v1.1** | Mantenedores tracking detallado por revisión, dosis pediátricas en recetas. |
| **v2.0** | `GrowthMeasurement` (percentiles OMS), galería intraoral con comparativo, IA en fotos para detección temprana de caries. |
