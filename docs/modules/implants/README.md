# Módulo de Implantología — MediFlow

> Módulo del marketplace (4/5) que agrega un expediente implantológico
> con trazabilidad COFEPRIS clase III, tarjeta-timeline horizontal de
> 6 hitos clicables, wizards de cirugía y fase protésica, carnet
> del implante PDF horizontal landscape, y mantenimiento periimplantario
> con criterios Albrektsson 1986.

**Spec completo:** `docs/marketplace/research/implantologia/SPEC.md`
**Branch original:** `feature/implant-module-v1` (sale de `feature/endodontics-module-v1`)
**Validación trigger COFEPRIS:** `docs/marketplace/research/implantologia/TRIGGER_COFEPRIS_VALIDATION.md`

---

## 1. Resumen

| Aspecto | Estado |
|---|---|
| Modelos Prisma nuevos | 9 (`Implant`, `ImplantSurgicalRecord`, `ImplantHealingPhase`, `ImplantSecondStageSurgery`, `ImplantProstheticPhase`, `ImplantComplication`, `ImplantFollowUp`, `ImplantConsent`, `ImplantPassport`). |
| Enums nuevos | 13 (`ImplantBrand`, `ImplantConnectionType`, `ImplantSurfaceTreatment`, `LekholmZarbDensity`, `ImplantStatus`, `ImplantProtocol`, `AbutmentType`, `ProsthesisType`, `ProsthesisMaterial`, `ImplantComplicationType`, `ASAClassification`, `ImplantFollowUpMilestone`, `ImplantConsentType`, + `BoneGraftSource` declarado para v1.1). |
| Cambios a enums existentes | `FileCategory` ampliado con `XRAY_CBCT` y `PHOTO_PATIENT`. |
| Server actions | 16 archivos en `src/app/actions/implants/` con auth + tenant + zod + audit + revalidatePath + retorno `ActionResult<T>`. |
| Migraciones SQL | 2: `20260504200000_implants_module` (schema + triggers + RLS) y `20260504210000_drop_implant_traceability_trigger` (drop por incompatibilidad con pooler). |
| PDFs | 3 templates `@react-pdf/renderer`: carnet horizontal landscape (85.6×54mm), reporte quirúrgico legal NOM-024 A4, plan implantológico A4 paciente-friendly. |
| Wizards | `SurgeryWizard` (3 pasos al cierre de cirugía) + `ProstheticWizard` (3 pasos con auto-generación del carnet). |
| Drawers | `MaintenanceDrawer` (sondaje + Albrektsson en vivo + STUB perio), `ComplicationDrawer` (categorías biológica/mecánica/quirúrgica/otra), `SecondStageDrawer` (TWO_STAGE). |
| Modales | `NewImplantModal`, `RemoveImplantModal` (motivo ≥20), `BrandUpdateJustificationModal` (COFEPRIS justificación ≥20 + contador en vivo), `SurgeryConsentModal` (texto NOM-024 + SignaturePad reusado de pediatría). |
| Página dedicada | `/dashboard/specialties/implants` con widgets de controles vencidos + complicaciones activas. Detalle por paciente: `/dashboard/specialties/implants/[patientId]`. |
| Sidebar | Item "Implantología" en grupo Especialidades, icono `Anchor` lucide-react, gating por permission `specialties.implants`. |
| Mock data | 3 pacientes (Roberto Méndez Straumann BLX 36 FUNCTIONAL, María Salazar 4 Neodent All-on-4, Carlos Vega BioHorizons 26 con peri-implantitis activa) en `prisma/seeds/implants-mock.ts`. |
| Tests | 11 archivos en `src/lib/implants/__tests__/` con 62 casos (status-machine, Albrektsson, ISQ, appointment-types, soap-prefill, zod COFEPRIS, trigger E2E). |
| Multi-tenant | Sí — todas las queries y mutaciones usan `clinicId` del `getAuthContext()` (verificado en auditoría Fase 10). |
| RLS | Sí — deny-all para anon/authenticated en las 9 tablas nuevas. |
| Audit log | Catálogo `IMPLANT_AUDIT_ACTIONS` (22 acciones) integrado a `prisma.auditLog`. Acciones especiales con `meta.cofeprisTraceability=true` para defensa legal. |
| Mobile fallback | Sí — banner read-only si viewport <1024px. Lectura permitida (cards + carnet PDF), captura bloqueada. |
| Reutilización | `SignaturePad` de pediatría (sin duplicar), `PatientFile` para radiografías y carnet PDF, `OdontogramEntry` con state `IMPLANTE`, `recordAudit` y `getAuthContext` compartidos, tokens dark-mode existentes. |

---

## 2. Estructura de carpetas

```
src/
├── app/
│   ├── actions/implants/                # 16 server actions + helpers
│   │   ├── _helpers.ts                  # getImplantActionContext + auditImplant + loaders
│   │   ├── result.ts                    # ActionResult / isFailure
│   │   ├── audit-actions.ts             # IMPLANT_AUDIT_ACTIONS catálogo
│   │   ├── createImplant.ts             # + sync OdontogramEntry
│   │   ├── updateImplantTraceability.ts # COFEPRIS — zod ≥20 + audit
│   │   ├── removeImplant.ts             # status REMOVED (NO delete)
│   │   ├── createSurgicalRecord.ts      # + healing phase + status OSSEOINTEGRATING
│   │   ├── updateImplantStatus.ts       # validate transition vs status-machine
│   │   ├── createHealingPhase.ts        # upsert
│   │   ├── createSecondStageSurgery.ts  # only TWO_STAGE → UNCOVERED
│   │   ├── createProstheticPhase.ts     # auto-genera passport
│   │   ├── createComplication.ts        # → status COMPLICATION
│   │   ├── createFollowUp.ts            # auto-evalúa Albrektsson
│   │   ├── createImplantConsent.ts
│   │   ├── generateImplantPassport.ts
│   │   ├── exportSurgicalReportPdf.ts   # data action (PDF en route handler)
│   │   ├── exportImplantPlanPdf.ts      # data action (1 implant o by-patient)
│   │   ├── createPeriImplantAssessment.ts  # STUB hasta integrar Perio
│   │   ├── enableQrPublicAccess.ts      # QR opt-in con token
│   │   └── index.ts                     # BARREL — solo reexporta 'use server'
│   ├── api/
│   │   └── implants/
│   │       ├── [id]/passport/route.ts        # GET PDF carnet
│   │       ├── [id]/surgical-report/route.ts # GET PDF reporte
│   │       ├── [id]/plan/route.ts            # GET PDF plan
│   │       └── context/route.ts              # GET contexto integraciones
│   └── dashboard/specialties/implants/
│       ├── page.tsx                     # widgets clínicos
│       └── [patientId]/page.tsx         # detalle paciente
├── components/specialties/implants/
│   ├── ImplantsTab.tsx                  # shell + dialog state machine
│   ├── ImplantsSubTabs.tsx              # Implantes | Cirugías | Mantenimiento
│   ├── ImplantsListTab.tsx              # lista con threshold compacto a 8+
│   ├── ImplantCard.tsx                  # tarjeta-timeline horizontal (núcleo)
│   ├── ImplantHeader.tsx                # FDI + brand + badge status
│   ├── ImplantTimeline.tsx              # 6 hitos clicables + countdown
│   ├── TimelineMilestone.tsx            # botón circular con ring de color
│   ├── ImplantSidePanel.tsx             # datos técnicos en mono, lotes amber
│   ├── ImplantActions.tsx               # footer de acciones rápidas
│   ├── CompactImplantList.tsx           # vista para 8+ (All-on-4 doble arcada)
│   ├── EmptyState.tsx
│   ├── widgets/
│   │   ├── OverdueFollowUpsWidget.tsx   # tabla controles vencidos
│   │   └── ActiveComplicationsWidget.tsx
│   ├── wizards/
│   │   ├── SurgeryWizard.tsx            # 3 pasos al cierre
│   │   └── ProstheticWizard.tsx         # 3 pasos + auto-passport
│   ├── drawers/
│   │   ├── MaintenanceDrawer.tsx        # sondaje + Albrektsson + STUB perio
│   │   ├── ComplicationDrawer.tsx       # 4 categorías
│   │   └── SecondStageDrawer.tsx        # TWO_STAGE
│   └── modals/
│       ├── NewImplantModal.tsx
│       ├── RemoveImplantModal.tsx       # motivo ≥20 chars
│       ├── BrandUpdateJustificationModal.tsx  # COFEPRIS contador en vivo
│       └── SurgeryConsentModal.tsx      # full-screen + SignaturePad
├── lib/
│   ├── implants/
│   │   ├── permissions.ts               # IMPLANTS_MODULE_KEY = "implants"
│   │   ├── status-machine.ts            # 10 transiciones + REMOVED terminal
│   │   ├── albrektsson-success.ts       # 1.5mm año 1, +0.2/año después
│   │   ├── isq-thresholds.ts            # ITI: ≥70 / 60-69 / <60
│   │   ├── lekholm-zarb.ts              # D1-D4 + protocolo + torque + weeks
│   │   ├── implant-helpers.ts           # status→milestone, border color
│   │   ├── appointment-types.ts         # 10 tipos + duración default
│   │   ├── soap-prefill.ts              # bloque S-Subjetivo
│   │   ├── treatment-plan.ts            # singleImplant + AllOnFour
│   │   ├── odontogram-sync.ts           # IMPLANTE state + color class
│   │   ├── prescription-templates.ts    # 5 plantillas NOM-024
│   │   ├── whatsapp-templates.ts        # 7 plantillas IMPL_*
│   │   ├── consent-texts.ts             # SURGERY_CONSENT_TEXT + bone augment + QR
│   │   ├── pdf-templates/
│   │   │   ├── implant-passport.tsx     # licencia 85.6×54mm landscape
│   │   │   ├── surgical-report.tsx      # A4 vertical legal
│   │   │   └── implant-plan.tsx         # A4 vertical paciente
│   │   └── __tests__/
│   │       ├── status-machine.test.ts
│   │       ├── albrektsson-success.test.ts
│   │       ├── isq-thresholds.test.ts
│   │       ├── appointment-types.test.ts
│   │       ├── soap-prefill.test.ts
│   │       ├── updateImplantTraceability.test.ts  # zod COFEPRIS
│   │       └── trigger-cofepris.test.ts            # E2E (requiere DATABASE_URL)
│   ├── types/implants.ts                # re-exports + ImplantFull
│   └── validation/implants.ts           # 16 schemas zod
└── prisma/
    ├── schema.prisma                    # +9 models +13 enums
    ├── migrations/
    │   ├── 20260504200000_implants_module/migration.sql
    │   └── 20260504210000_drop_implant_traceability_trigger/migration.sql
    └── seeds/
        └── implants-mock.ts             # Roberto + María + Carlos
```

---

## 3. Cómo activar el módulo en una clínica

1. **Aplicar las 2 migraciones SQL** en Supabase SQL Editor (en orden):
   - `prisma/migrations/20260504200000_implants_module/migration.sql`
   - `prisma/migrations/20260504210000_drop_implant_traceability_trigger/migration.sql`

   Ambas son idempotentes — pueden re-ejecutarse sin efectos colaterales.

2. **Asegurar el `Module` en el marketplace** con `key="implants"`:
   ```sql
   INSERT INTO "Module" (id, key, "displayName", category, "monthlyPriceMxn", "isActive")
   VALUES (gen_random_uuid()::text, 'implants', 'Implantología', 'SPECIALTY', 1499, true)
   ON CONFLICT (key) DO NOTHING;
   ```

3. **Activar `ClinicModule`** para la clínica DENTAL que va a usarlo:
   ```sql
   INSERT INTO "ClinicModule" (id, "clinicId", "moduleId", status, "currentPeriodStart", "currentPeriodEnd")
   SELECT gen_random_uuid()::text, '<clinicId>', m.id, 'active', NOW(), NOW() + interval '1 month'
   FROM "Module" m WHERE m.key = 'implants';
   ```

4. **Otorgar permission `specialties.implants`** a los roles que usarán el módulo:
   - `SUPER_ADMIN` y `ADMIN` la obtienen automáticamente.
   - `DOCTOR` y `RECEPTIONIST` ya la tienen en el default; verificar que no esté excluida en `User.permissionsOverride`.

5. **Sembrar mock data (opcional, recomendado para QA):**
   ```bash
   DATABASE_URL=… DIRECT_URL=… npx tsx prisma/seeds/implants-mock.ts
   ```
   Crea 3 pacientes con la cédula de seed: Roberto (FUNCTIONAL), María (LOADED_DEFINITIVE All-on-4), Carlos (COMPLICATION).

6. **Validar acceso** — login con un user de la clínica activada y abrir
   `/dashboard/specialties/implants`. Debe aparecer el sidebar item
   "Implantología" con icono Anchor.

---

## 4. Cumplimiento legal y regulatorio

### COFEPRIS clase III — trazabilidad por lote

- `brand`, `lotNumber`, `placedAt` son inmutables por convención.
- Modificación SOLO vía `updateImplantTraceability` con justificación `≥20 chars` (validación zod).
- Audit log obligatorio con `meta.cofeprisTraceability=true`. Query de defensa legal:
  ```sql
  SELECT * FROM "audit_logs"
  WHERE entity_type='implant'
    AND changes->'_meta'->>'cofeprisTraceability'='true';
  ```
- DELETE bloqueado a nivel DB por `block_implant_delete_trg`. "Remoción" = `currentStatus = REMOVED + removalReason ≥20`.
- Query de recall por lote (objetivo <200 ms con miles de implantes):
  ```sql
  SELECT p."firstName", p."lastName", p.phone, i."toothFdi", i."placedAt", i."currentStatus"
  FROM "implants" i
  JOIN "patients" p ON p.id = i."patientId"
  WHERE i.brand = 'STRAUMANN' AND i."lotNumber" = 'A12345678';
  ```
  Respaldada por índice `idx_implant_brand_lot`.
- **Trigger `protect_implant_traceability` eliminado** porque Supabase pooler ignora `SET LOCAL`. Detalles + bitácora en `TRIGGER_COFEPRIS_VALIDATION.md`.

### NOM-024-SSA3-2012 — expediente clínico

- Conservación 10 años (recomendación interna por la naturaleza largo plazo del implante).
- 5 plantillas de receta con encabezado NOM-024 en `prescription-templates.ts`.
- Reporte quirúrgico PDF con cédula del cirujano + cuerpo médico + firma estructural.

### LFPDPPP — privacidad

- RLS deny-all en las 9 tablas nuevas (acceso solo por service role vía Prisma).
- QR público en carnet es OPT-IN — requiere `ImplantConsent` tipo `QR_PUBLIC` firmado y no revocado.
- CBCT y radiografías son datos sensibles; reusan `PatientFile` con su misma RLS.

---

## 5. Extending guide

### Agregar una marca de implante nueva

1. Agregar el valor al enum `ImplantBrand` en `prisma/schema.prisma`.
2. Crear migración:
   ```sql
   ALTER TYPE "ImplantBrand" ADD VALUE IF NOT EXISTS 'NEW_BRAND';
   ```
3. Agregar el valor a `IMPLANT_BRAND` en `src/lib/validation/implants.ts`.
4. Si el doctor necesita un `brandCustomName`, no hace falta — eso ya
   está soportado en el schema cuando `brand=OTRO`.

### Agregar un tipo de complicación nueva

1. Agregar al enum `ImplantComplicationType` en schema + migración.
2. Agregar a `COMPLICATION_TYPE` en `validation/implants.ts`.
3. Asignar a una categoría en `COMPLICATION_GROUPS` en `lib/types/implants.ts`.

### Agregar un nuevo hito de seguimiento

1. Agregar al enum `ImplantFollowUpMilestone` (renombrado por colisión con endo).
2. Agregar a `FOLLOWUP_MILESTONE` en `validation/implants.ts`.
3. Agregar el label legible al `MILESTONE_LABEL` de `OverdueFollowUpsWidget` y `MaintenanceDrawer`.

### Implementar la integración real con Periodoncia

Cuando `feature/periodontics-module-v1` se mergee a `main`:

1. Borrar `src/app/actions/implants/createPeriImplantAssessment.ts` (STUB).
2. Reescribir como acción real que crea `PeriImplantAssessment`.
3. Agregar migración SQL para FK real:
   ```sql
   ALTER TABLE "peri_implant_assessments"
   ADD CONSTRAINT "peri_implant_assessment_implant_fkey"
   FOREIGN KEY ("implantId") REFERENCES "implants"("id") ON DELETE SET NULL;
   ```
4. El llamado desde `MaintenanceDrawer` cuando `bopPresent || suppuration` se mantiene igual.

### Implementar análisis IA de pérdida ósea peri-implantaria

- Reusar `XrayAnalysis` existente.
- Agregar modo `PERIIMPLANT_BONE_LOSS` que tome la radiografía periapical más reciente y devuelva `radiographicBoneLossMm`.
- Pre-fill del campo en `MaintenanceDrawer.boneLoss` (hoy es input manual).
- Pendiente para v1.1 — documentado en SPEC §0.

### Modelos v1.1 / v2.0 declarados pero no migrados

- `ImplantSurgicalPlan` (planeación pre-CBCT estructurada).
- `BoneAugmentation` (aumento óseo con biomateriales — `BoneGraftSource` enum ya declarado).
- `ImplantPrescription` (recetas implantológicas tipadas — actualmente las plantillas viven en `prescription-templates.ts`).
- `ImplantInventoryItem` (v2.0 — stock con caducidad).

Para activar cualquiera: descomentar el modelo en `schema.prisma`, escribir migración SQL idempotente, importar en `types/implants.ts`.

---

## 6. Validación local

```bash
cd /c/Users/Rafael/Documents/GitHub/mediflow-implant
npx prisma generate
npx tsc --noEmit          # cero errores
npx tsx --test src/lib/implants/__tests__/*.test.ts
npm run build             # detecta errores de bundle cliente/servidor
```

Tests E2E del trigger COFEPRIS requieren `DATABASE_URL` y `DIRECT_URL`
configurados — sin ellos los 4 casos correspondientes se skip-ean
limpiamente.

---

## 7. Bibliografía clínica

- **Lekholm-Zarb 1985** — clasificación de densidad ósea D1-D4.
- **Albrektsson 1986 (modificado ITI)** — criterios de éxito: 1.5 mm de pérdida ósea aceptada año 1, <0.2 mm/año después.
- **Consenso ITI** — umbrales ISQ: ≥70 carga ok, 60-69 zona límite, <60 NO cargar.
- **NOM-024-SSA3-2012** — expediente clínico mexicano.
- **COFEPRIS (Comisión Federal para la Protección contra Riesgos Sanitarios)** — clasificación clase III para implantes dentales.
- **LFPDPPP (Ley Federal de Protección de Datos Personales en Posesión de los Particulares)** — opt-in QR público.
