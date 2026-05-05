# Ortodoncia (módulo 5/5 del paquete dental)

Implementación completa del módulo de Ortodoncia para MediFlow.
Sigue la SPEC en `docs/marketplace/research/ortodoncia/SPEC.md` con las
25 decisiones bloqueadas + 3 confirmaciones del Coordinator.

## Activación

El módulo se activa por clínica vía `ClinicModule.status = "active"` con
`module.key = "orthodontics"`. Visibilidad UI requiere también el permiso
`specialties.orthodontics` en el rol del usuario (default DOCTOR + RECEPTIONIST).

```ts
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";

const { hasAccess } = await canAccessModule(clinicId, ORTHODONTICS_MODULE_KEY);
```

Rutas:
- `/dashboard/specialties/orthodontics` — kanban a nivel clínica.
- `/dashboard/specialties/orthodontics/[patientId]` — detalle del paciente.
- `/dashboard/patients/[id]/orthodontics` — vista embebida desde expediente.

## Estructura

```
src/lib/orthodontics/
├── load-data.ts              # loadOrthoData(clinicId, patientId)
├── build-kanban-data.ts      # buildKanbanData(clinicId)
├── phase-machine.ts          # PHASE_ORDER + canAdvance + classifyTransition
├── payment-status.ts         # computePaymentStatus (regla max severity)
├── photo-set-helpers.ts      # 8 vistas + availableSetTypes + buildComparePairs
├── compliance-helpers.ts     # summarizeCompliance (últimos 3 controles)
├── kanban-helpers.ts         # groupCardsByPhase + cap 50
├── appointment-durations.ts  # 9 patrones de duración de cita
├── soap-prefill.ts           # buildOrthoSoapPrefill
├── consent-texts.ts          # 4 textos legales literales §10.4-§10.7
├── whatsapp-templates.ts     # 7 plantillas §8.7
├── prescription-templates.ts # 3 plantillas NOM-024 §8.6
├── pdf-templates/
│   ├── treatment-plan.tsx       # A4 vertical 4 páginas (paciente)
│   ├── financial-agreement.tsx  # A4 vertical firmable (acuerdo)
│   └── progress-report.tsx      # A4 horizontal T0 vs T2
└── __tests__/                # 35 tests unit verde

src/app/actions/orthodontics/
├── index.ts                          # BARREL ESTRICTO (solo 'use server')
├── result.ts                         # types + isFailure (importado directo)
├── audit-actions.ts                  # ORTHO_AUDIT_ACTIONS (importado directo)
├── _helpers.ts                       # auth+tenant+audit (NUNCA en barrel)
├── createDiagnosis.ts
├── updateDiagnosis.ts
├── createTreatmentPlan.ts            # transacción: plan + 6 fases
├── updateTreatmentPlan.ts
├── advanceTreatmentPhase.ts
├── createPaymentPlan.ts              # transacción: plan + N installments
├── recordInstallmentPayment.ts       # backdating ±60d + just ≥20
├── recalculatePaymentStatus.ts       # idempotente
├── createPhotoSet.ts
├── uploadPhotoToSet.ts
├── createControlAppointment.ts
├── linkDigitalRecord.ts
├── createOrthodonticConsent.ts
├── exportTreatmentPlanPdf.ts
└── exportFinancialAgreementPdf.ts

src/app/api/orthodontics/
├── context/route.ts                              # GET para integraciones
├── photos/upload/route.ts                        # multipart + sharp
├── treatment-plans/[id]/treatment-plan-pdf/route.tsx
├── treatment-plans/[id]/progress-report-pdf/route.tsx
└── payment-plans/[id]/financial-agreement-pdf/route.tsx

src/app/api/cron/orthodontics/
└── recalculate-payment-status/route.ts           # cron diario 7:00 UTC

src/components/specialties/orthodontics/
├── _components/                # kanban (Board+Column+Card+Filters+Widget)
├── OrthodonticsTab.tsx         # shell con 5 sub-tabs
├── OrthodonticsClient.tsx      # wrapper client con wizards
├── OrthoSubTabs.tsx
├── EmptyState.tsx
├── shared/                     # WizardShell + OrthoStageBadge + PediatricProfileBanner
├── diagnosis/                  # DiagnosisView + DiagnosisWizard (4 pasos)
├── plan/                       # TreatmentPlanView + Wizard (3) + PhaseTimeline
├── photos/                     # PhotoSetGrid + PhotoSetWizard (8) + PhotoCompareSlider
├── controls/                   # ControlsList + ControlAppointmentWizard (3)
├── payments/                   # PaymentPlanView + InstallmentList +
│                                 RecordPaymentDrawer + BackdateJustificationModal +
│                                 PaymentStatusBadge
├── digital/                    # DigitalRecordsPanel + PdfViewer + STLViewer3D
└── consent/                    # 4 modales full-screen + ConsentModalShell
```

## Decisiones bloqueadas (SPEC §1)

25 decisiones inamovibles. Las más relevantes para extender:

- **1.6** Kanban a nivel clínica como vista principal del módulo.
- **1.11** Status del plan calculado server-side (cron + trigger SQL +
  invocación manual). 4 niveles: ON_TIME / LIGHT_DELAY (1-30d) /
  SEVERE_DELAY (>30d) / PAID_IN_FULL.
- **1.12** Backdating: `paidAt ∈ [dueDate - 60d, now()]` pasa sin
  justificación. Fuera de rango exige texto ≥20 chars + audit.
- **1.13** Mobile = lectura + captura de fotos en control mensual.
- **1.17** Stack particular: react-pdf, three + @types/three, sharp,
  @react-pdf/renderer.
- **1.18** Barrel estricto: SOLO archivos `'use server'`.
- **1.19** Verificación: `npm run build` (NO solo `tsc --noEmit`) tras
  cada fase.
- **1.20** NO crear modelo Cephalometry. Reusa PatientFile +
  FileCategory `CEPH_ANALYSIS_PDF` / `SCAN_STL`.

## Lógica clínica clave

### Phase machine (`phase-machine.ts`)

Transiciones lineales: `ALIGNMENT → LEVELING → SPACE_CLOSURE → DETAILS →
FINISHING → RETENTION`. `canAdvance` solo permite +1; reaperturas via
`canForceTransition` (admin override con justificación).

### Payment status (`payment-status.ts`)

Regla "max severity" (peor instalment manda):
- Todas pagadas/perdonadas → `PAID_IN_FULL`
- Alguna >30d vencida → `SEVERE_DELAY`
- Alguna 1-30d vencida → `LIGHT_DELAY`
- Caso contrario → `ON_TIME`

Defensa en 3 capas: trigger SQL en INSERT/UPDATE + cron diario 7:00 UTC
+ botón manual "Recalcular ahora" en `PaymentPlanView`.

### Compliance (`compliance-helpers.ts`)

Resumen de últimos 3 controles:
- 3/3 ATTENDED → `ok` ✓ verde
- 2/3 con 1 issue → `warning` ⚠
- 0/3 ATTENDED → `danger` ✗ rojo + dropRisk
- <3 controles → `insufficient` (no penaliza)

## Mock seed

```bash
# Requiere clínica DENTAL con módulo `orthodontics` activo + DOCTOR.
npx tsx prisma/seeds/orthodontics-mock.ts
```

3 pacientes:
1. **ORT-2024-001 Andrea Reyes** — Estadio LEVELING mes 8/18, brackets
   metálicos $47,200, 7 mensualidades pagadas, 1 NO_SHOW (mes 7).
2. **ORT-2024-002 Sofía Hernández (12)** — PLANNED, expansor + brackets
   24m, 4 consentimientos firmados (TREATMENT+MINOR_ASSENT+FINANCIAL+
   PHOTO_USE).
3. **ORT-2024-003 Mauricio López** — ALIGNMENT mes 3, alineadores
   Smileco $38,000, 2 STL scans (T0 + M3), compliance 3/3 perfecto.

Importante: `paidAmount = initialDownPayment + sum(installments PAID)`,
matchea con el trigger SQL para evitar races durante INSERT del seed.

## Tests

```bash
npx tsx --test src/lib/orthodontics/__tests__/*.test.ts
# 35 tests verde:
#   - 7 phase-machine (orden + transiciones + classify)
#   - 8 payment-status (incluyendo límite 30/31, max severity, WAIVED)
#   - 8 photo-set-helpers (vistas, availableSetTypes con T2 bloqueando T1)
#   - 7 compliance-helpers (3/3, 2/3 con RESCHEDULED/NO_SHOW, 0/3, <3)
#   - 5 kanban-helpers (agrupamiento, orden, cap 50, progressPct)
```

### Tests deferidos a v1.1

El repo no tiene Playwright ni Storybook configurados. Los siguientes
tests del SPEC §13 quedan como TODO documentados:
- E2E Playwright (5 flujos: diagnóstico Andrea, Sofía con asentimiento,
  fotos mobile, backdating, advancePhase saltando fases).
- Tests RLS automatizados (requieren DB de test).
- Tests del cron Vercel (requieren mock de fetch del endpoint).
- Snapshots Storybook.
- Performance kanban 200 pacientes <300ms.

## Integraciones cubiertas (F8)

- ✅ Vercel Cron Job diario para recalculatePaymentStatus.
- ✅ 9 duraciones de cita (`suggestOrthoAppointmentDuration`).
- ✅ SOAP pre-fill por mes (`buildOrthoSoapPrefill`).
- ✅ 3 plantillas receta NOM-024 (`ORTHO_PRESCRIPTION_TEMPLATES`).
- ✅ 7 plantillas WhatsApp (`ORTHO_WHATSAPP_TEMPLATES`) — encolado real
  con `type='ORTHO'` se cablea cuando el sistema de queue del repo
  exponga su API.
- ✅ Endpoint `/api/orthodontics/context` para banner/badge.
- ✅ Storage Supabase con sharp (jpeg q85 2400×2400 + webp 300×300 thumb).
- ✅ Audit log: 18 acciones registradas con `auditOrtho`.

### Pendientes para futuras iteraciones

- ⏳ Badge brackets/alineadores en odontograma compartido (toca componente
  global del odontograma).
- ⏳ Sub-ítems orto en TreatmentPlan general (toca sistema de planes
  general).

## Compliance

- **NOM-024-SSA3-2012**: audit log granular por mutación clínica O
  financiera (catálogo `ORTHO_AUDIT_ACTIONS` con 18 acciones) +
  retención de planes con `deletedAt` (soft-delete).
- **LFPDPPP**: consentimiento `PHOTO_USE` separado del tratamiento; sin
  esa firma, fotos solo para uso interno + reporte de progreso al propio
  paciente. Watermark "Uso clínico — confidencial" en
  progress-report.tsx si no hay firma.
- **RLS**: deny-all en las 9 tablas del módulo. MediFlow usa service
  role bypass; defensa adicional con filtro `clinicId` en cada server
  action.

## Compatibilidad con módulo Pediatría

Best-effort: `loadOrthoData` lee `PediatricProfile` del paciente si
existe el modelo en el schema (try/catch). Si Pediatría no instalada,
no falla; el banner muestra "Esta clínica no tiene módulo de Pediatría
activo. Captura los datos mínimos requeridos directamente en el wizard
de diagnóstico".
