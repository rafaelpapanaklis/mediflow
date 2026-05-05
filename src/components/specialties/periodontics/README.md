# Periodoncia (módulo 3/5 del paquete dental)

Implementación completa del módulo de Periodoncia para MediFlow.
Sigue la SPEC en `docs/marketplace/research/periodoncia/SPEC.md` con las
22 decisiones bloqueadas de la sección 1.

## Activación

El módulo se activa por clínica vía `ClinicModule.status = "active"` con
`module.key = "periodontics"`. Visibilidad UI requiere también el permiso
`specialties.periodontics` en el rol del usuario (default DOCTOR + RECEPTIONIST).

```ts
import { canAccessModule } from "@/lib/marketplace/access-control";
import { PERIODONTICS_MODULE_KEY } from "@/lib/specialties/keys";

const { hasAccess } = await canAccessModule(clinicId, PERIODONTICS_MODULE_KEY);
```

Ruta dedicada: `/dashboard/specialties/periodontics` (lista) y
`/dashboard/specialties/periodontics/[patientId]` (detalle).

## Estructura

```
src/lib/periodontics/
├── schemas.ts                 # zod schemas (19 actions)
├── types.ts                   # tipos derivados de Prisma + UI
├── site-helpers.ts            # FDI_ALL, SITE_CAPTURE_ORDER, nextSite, toothCategory
├── periodontogram-math.ts     # computePerioMetrics, calMm, pdSeverity, compareRecords
├── classification-2017.ts     # classifyPerio2017 (Stage I-IV, Grade A-C, Extension)
├── risk-berna.ts              # computeBernaRisk (6 factores)
├── cairo-classification.ts    # RT1/RT2/RT3
├── keyboard-shortcuts.ts      # parsePdRecInput "5-2"
├── whatsapp-templates.ts      # 8 plantillas
├── consent-texts.ts           # SRP §10.3 + cirugía §10.4
├── soap-prefill.ts            # SOAP S/O/A/P por tipo de visita
├── prescription-templates.ts  # 3 plantillas NOM-024
├── pdf-templates/
│   ├── perio-report.tsx       # paciente, lenguaje accesible
│   ├── referrer-report.tsx    # médico tratante, técnico
│   └── pre-post-compare.tsx   # comparativo landscape
└── __tests__/                 # 36 tests unit verde

src/app/actions/periodontics/
├── _helpers.ts                # ctx + audit + module gating
├── result.ts                  # ActionResult<T> + isFailure
├── chart.ts                   # createPeriodontalRecord, update, finalize, delete
├── sites.ts                   # upsertSiteData, upsertToothData, bulkUpsertSiteData
├── classification.ts          # classifyPatient + overrideClassification
├── recession.ts               # createGingivalRecession + resolveGingivalRecession
├── risk.ts                    # createRiskAssessment (encola WA reminder)
├── peri-implant.ts            # createPeriImplantAssessment
├── plan.ts                    # createTreatmentPlan + advancePhase
├── srp.ts                     # createSRPSession
├── reevaluation.ts            # createReevaluation
├── surgery.ts                 # createPeriodontalSurgery
├── consents.ts                # signSrpConsent + signSurgeryConsent
├── reports.ts                 # 3 PDF exports (stubs → /api/periodontics/reports/*)
└── maintenance.ts             # scheduleMaintenance + completeMaintenance

src/app/api/periodontics/
├── context/route.ts           # GET ?patientId=…&reason=… para integraciones
└── reports/{patient,referrer,pre-post}/  # endpoints @react-pdf/renderer

src/components/specialties/periodontics/
├── PerioSubTabs.tsx, PerioPatientList.tsx
├── ResumenTab.tsx, PlanTab.tsx, CirugiasTab.tsx, MantenimientosTab.tsx
├── OverdueMaintenanceWidget.tsx
├── PeriodonticsTab.tsx        # shell del módulo
├── PeriodonticsClient.tsx     # cablea server actions a callbacks
├── consents/{SRPConsentModal,SurgeryConsentModal}.tsx
└── periodontogram/
    ├── reducer.ts             # PerioState + perioReducer
    ├── SiteCell.tsx           # celda atómica (memo)
    ├── ToothCenter.tsx        # silueta SVG con badges
    ├── ToothColumn.tsx        # 6 sites + ToothCenter
    ├── PeriodontogramGrid.tsx # 6×32 con bridge events
    ├── LiveIndicators.tsx     # header BoP/Plaque/distribución
    ├── ClassificationFooter.tsx
    ├── KeyboardCaptureLayer.tsx
    ├── ToothDetailDrawer.tsx
    └── MobileFallback.tsx
```

## Decisiones bloqueadas (SPEC §1)

22 decisiones inamovibles. Las más relevantes para extender el módulo:

- **1.1** No revaluar este SPEC. Cualquier cambio se documenta como
  `// PRECAUCIÓN:` y se procede con la implementación más cercana.
- **1.5** Modal full-screen solo para consentimientos (SRP, cirugía).
- **1.7** Mobile (≤1024 px) = read-only. Banner persistente.
- **1.9** Convención: vestibular ARRIBA en ambas arcadas (Florida Probe).
  TODO en `ToothColumn.tsx` para validar con periodoncista real.
- **1.12** Recesiones SOLO Cairo 2018 (no Miller 1985).
- **1.13** Clasificación SOLO 2017 AAP/EFP. NO World Workshop 1999.
- **1.16** Reuso de `PatientFile` para fotos intraoperatorias y
  consentimientos (NO modelo `Radiography` separado).
- **1.17** `PeriImplantAssessment.implantId: String?` — el módulo de
  Implantología (4/5) aún no existe, FK se agregará en migración futura.
- **1.18** Captura `5-2` con `Tab/Espacio/p/s` — NO drag de slider.
- **1.20** No usar `localStorage`/`sessionStorage`/`IndexedDB`. Toda
  persistencia vía server actions con audit log.
- **1.21** `upsertSiteData` con debounce 300ms cliente. NO
  `revalidatePath` en cada call (rompe captura rápida).

## Lógica clínica clave

### Clasificación 2017 (`classifyPerio2017`)

- **Stage** = `max CAL interproximal` + complejidad (mobility ≥2, furca
  II-III, PD ≥6, ≥5 dientes perdidos):
  - SALUD: maxCal=0, maxPd≤3, BoP<10%
  - GINGIVITIS: maxCal=0, BoP≥10%
  - STAGE_I: maxCal 1-2 mm
  - STAGE_II: maxCal 3-4 mm
  - STAGE_III: maxCal ≥5 mm con ≤4 dientes perdidos y ≤2 factores
    complejidad
  - STAGE_IV: maxCal ≥5 mm con ≥5 dientes perdidos o ≥3 factores
- **Grade** = `boneLossPct / patientAge`:
  - <0.25 = GRADE_A (lenta)
  - 0.25-1.0 = GRADE_B (moderada)
  - >1.0 = GRADE_C (rápida)
  - Sin radiografía: default GRADE_B (asunción conservadora)
  - `bumpGrade` si tabaquismo ≥10 cig/día o HbA1c ≥7%
- **Extension** = patrón molar/incisivo (solo molares 16-17/26-27/36-37/46-47
  e incisivos afectados con <50% dientes), localizada (<30%) o
  generalizada (≥30%).

### Riesgo Berna (`computeBernaRisk`)

6 factores (BoP%, sitios residuales ≥5mm, dientes perdidos perio,
BL/edad, tabaco, HbA1c). Categoría = peor factor. Recall: BAJO=6m,
MODERADO=4m, ALTO=3m.

### Cairo 2018 (`classifyCairo`)

- RT1: sin pérdida interproximal (CAL_int=0)
- RT2: CAL_int >0 y ≤ CAL_vest
- RT3: CAL_int > CAL_vest

## Stubs autorizados (TODO v1.1)

| Stub | Estado | Ubicación |
|------|--------|-----------|
| `getRadiographicBoneLossPct(patientId)` | Devuelve `undefined`. Default GRADE_B. | `src/lib/periodontics/periodontogram-math.ts` |
| `enqueueMaintenanceReminder` | Encolado vía audit log con `type='PERIO'`; worker no procesa todavía. | `src/app/actions/periodontics/risk.ts` |
| `useDebouncedCallback` | Creado en `src/hooks/use-debounced-callback.ts` para reuso. | — |

## Mock seed (idempotente)

```bash
# Requiere clínica DENTAL con módulo `periodontics` activo + DOCTOR.
npx tsx prisma/seeds/periodontics-mock.ts
```

Crea 3 pacientes:
1. **MOCK-PERIO-001** María González — Estadio II generalizada, Fase 2.
2. **MOCK-PERIO-002** Juan Pérez — Estadio III Grado C, cirugía RTG en
   36 y 46, riesgo ALTO con tabaquismo + HbA1c.
3. **MOCK-PERIO-003** Carmen López — Estadio I controlado en
   mantenimiento Fase 4 (con recall vencido para activar el widget).

## Tests

```bash
# Tests unitarios (Node test runner)
npx tsx --test src/lib/periodontics/__tests__/*.test.ts
# 36 tests verde:
#  - 11 classification-2017
#  - 8 risk-berna
#  - 4 cairo-classification
#  - 13 keyboard-shortcuts
```

### Tests deferidos a v1.1

El repo no tiene Playwright ni Storybook configurados. Los siguientes
tests del SPEC §13.2 quedan como TODO documentados:
- E2E captura completa con teclado (192 sitios)
- E2E mobile read-only
- E2E sobreescribir clasificación requiere justificación
- Snapshots Storybook de SiteCell / ToothCenter / Grid

Tests RLS multi-tenant: la deny-all RLS está activa en migración
(`DO $ DECLARE perio_table TEXT loop`); los server actions filtran por
`clinicId` defensivamente. Tests automatizados de RLS requieren DB de
test (no hay infra) — pendiente para v1.1.

## Integraciones

- **Sidebar**: item "Periodoncia" en sección Especialidades.
- **Marketplace**: módulo activo si `module.key='periodontics'`.
- **API context** (`/api/periodontics/context?patientId=...&reason=...`):
  para que otros módulos (modal de cita, SOAP pre-fill, badge perio en
  odontograma general) consulten el estado periodontal del paciente.
- **PDFs**: `/api/periodontics/reports/{patient|referrer|pre-post}` con
  `@react-pdf/renderer`.
- **Recetas**: 3 plantillas NOM-024 (`PERIO_PRESCRIPTION_TEMPLATES`).
- **WhatsApp**: 8 plantillas (`PERIO_WHATSAPP_TEMPLATES`).
- **Duración cita**: `suggestPerioAppointmentDuration(reason)` mapea
  motivos a 45/50/60/90 min.

## Compliance

- **NOM-024-SSA3-2012**: audit log granular por mutación (catálogo
  `PERIO_AUDIT_ACTIONS` con 24 acciones) + retención de
  PeriodontalRecord por 5 años (soft-delete vía `deletedAt`).
- **LFPDPPP**: consentimiento explícito SRP/cirugía vía
  `signSrpConsent`/`signSurgeryConsent`. Compartir con médico tratante
  registrado en audit log.
- **RLS**: deny-all en las 9 tablas del módulo. MediFlow usa service
  role bypass; defensa adicional con `clinicId` filter en cada server
  action.
