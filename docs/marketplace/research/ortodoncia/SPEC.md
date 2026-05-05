# SPEC — Módulo Ortodoncia (MediFlow 5/5)

> **Estado:** listo para implementación por Bot Git 1.
> **Posición:** módulo 5 de 5 — última especialidad dental del marketplace. Pediatría (1/5), Endodoncia (2/5), Periodoncia (3/5) en producción. Implantología (4/5) en `feature/implant-module-v1` lista para QA.
> **Branch base:** `origin/feature/periodontics-module-v1` si Perio ya está mergeada con build verde; en caso contrario `origin/feature/endodontics-module-v1`. Bot Git 1 decide al inicio según `git log origin/main`.
> **Pricing:** $329 MXN/mes (tier intermedio: Perio $279 < Orto $329 < Implant $349).
> **Owner técnico:** Rafael Salazar.
> **Última revisión:** mayo 2026.

---

## 0. Resumen ejecutivo

Ortodoncia es la especialidad más larga en duración (12-30 meses por paciente), la que más fricción genera con cobranza y la única que el doctor revisa **mes a mes durante 2 años**. Los PMS mexicanos resuelven mal dos cosas: no tienen vista operativa por fase del tratamiento (el doctor no sabe cuántos pacientes están en "alineación" vs "detalles" sin abrir cada expediente), y el plan de pagos vive en un módulo de cobros genérico desconectado del progreso clínico (la recepcionista no sabe que Andrea va atrasada 2 mensualidades el día que llega a control). MediFlow domina ambos: kanban a nivel clínica como vista principal del módulo, plan de pagos dedicado linkeado al progreso clínico, comparativo visual de fotografías T0/T1/T2 lado a lado, e importación de cefalometrías PDF + modelos STL para que el doctor no tenga que cambiar de software durante el control.

Cuatro diferenciadores reales:

1. **Kanban a nivel clínica como página dedicada** — `/dashboard/specialties/orthodontics/page.tsx` muestra todos los pacientes activos agrupados por fase de tratamiento (Alineación / Nivelación / Cierre de espacios / Detalles / Finalización / Retención). Cada card lleva foto del paciente, mes del tratamiento ("Mes 8/24"), próxima cita, y dos indicadores: compliance ✓/⚠ (asistió a sus últimos 3 controles) + adeudo $$ (mensualidades vencidas). El doctor ve la operación completa en una pantalla.

2. **Plan de pagos integrado al progreso clínico** — `OrthoPaymentPlan` dedicado al módulo (NO se reutiliza el módulo general de cobros). Mensualidades estructuradas con `dueDate` + `paidAt`, cálculo automático de status (al-corriente / atraso-leve <30 días / atraso-severo >30 días). El kanban refleja el adeudo en cada card, las citas de control muestran el estado financiero en el SOAP, y los recordatorios WhatsApp encolan automáticamente cuando una mensualidad vence sin pago.

3. **Comparativo visual T0/T1/T2** — serie fotográfica estándar de 8 vistas por sesión (frontal/perfil/sonrisa + intraorales 5 vistas). `OrthoPhotoSet` agrupa cada sesión y la pieza visual estrella es la vista lado a lado: T0 izquierda, T2 derecha, sliders verticales sincronizados. El paciente ve el cambio, el doctor lo usa para auditoría clínica y para venta del próximo paciente.

4. **Importar cefalometrías PDF + modelos STL** — el ortodoncista exporta de Nemotec/Dolphin/3Shape/iTero/Medit. MediFlow no compite con software de planeación 3D; solo permite *vincular y previsualizar* el archivo del análisis ya hecho, sin que el doctor tenga que abrir otro programa durante el control. PDF con react-pdf, STL con Three.js + STLLoader. Captura numérica de los valores cefalométricos → v1.1.

**Mobile = lectura + captura de foto en consulta.** A diferencia de Implantología (mobile read-only), aquí el doctor puede tomar las 8 fotos del set desde el celular durante el control mensual. NO permite captura de diagnóstico inicial ni edición de plan/pagos por densidad de campos.

**Modelos:** 9 en MVP. 6 en v1.1 (cefalometría con captura numérica, IPR, alineadores tracking, TADs, brackets map, refinamientos).

**Server actions:** 15 mutaciones clínicas + financieras. Audit log obligatorio. Reglas anti-aliasing en `OrthoInstallment.paidAt` (no permitir backdating sin justificación).

---

## 1. Decisiones bloqueadas (NO revaluar)

| # | Decisión | Justificación |
|---|----------|---------------|
| 1.1 | **MVP estricto = 6 features MUST**: diagnóstico estructurado, plan con fases y plan de pagos, serie fotográfica 8 vistas (T0/T1/T2), control mensual estructurado, comparativo visual fotos, plan de pagos con tracking | Decisión de Rafael — evitar scope creep del módulo más amplio |
| 1.2 | **`OrthoPaymentPlan` dedicado al módulo**, NO reutiliza el módulo general de cobros. Modelo propio con `installments[]`, `totalAmount`, `installmentAmount`, `paidAmount`, `pendingAmount`, `status`, `paymentMethod`, `signedFinancialAgreementFileId` | Decisión de Rafael — el orto tiene reglas específicas (atraso leve/severo, refinanciamiento mid-treatment, descuentos por pronto pago) que el módulo de cobros general no modela |
| 1.3 | **Storage de fotos: Supabase Storage**. Reutilizar `PatientFile` con `FileCategory` ortodóntico: `ORTHO_PHOTO_T0`, `ORTHO_PHOTO_T1`, `ORTHO_PHOTO_T2`, `ORTHO_PHOTO_CONTROL`. `OrthoPhotoSet` agrupador relacional (sin duplicar archivos físicos). Thumbnail con `sharp` server-side al upload | Decisión de Rafael — no duplicar arquitectura de archivos, generar thumbnail acelera el comparativo visual |
| 1.4 | **Cefalometría en MVP = solo importar archivos**. PDF (react-pdf) y STL (Three.js + STLLoader). Captura manual de valores Steiner/Ricketts → v1.1 | Decisión de Rafael — el MVP no compite con Nemotec/Dolphin, solo evita cambio de software |
| 1.5 | **Pacientes menores — lectura NO forzada de PediatricProfile**. Si Pediatría activa: Orto consulta el perfil sin duplicar. Si no: Orto capta inline mínimos (consentimiento tutor + asentimiento >12 años + hábitos). Botón sugerencia "Crea perfil pediátrico completo" si Pedi activo | Decisión de Rafael — Pedi puede no estar contratado por la clínica |
| 1.6 | **Kanban a nivel clínica como vista principal del módulo**. Página `/dashboard/specialties/orthodontics/page.tsx` con 6 columnas (Alineación / Nivelación / Cierre espacios / Detalles / Finalización / Retención). Cards con foto + mes "X/Y" + próxima cita + compliance + adeudo | Decisión de Rafael — diferenciador comercial real |
| 1.7 | Tab del paciente "Ortodoncia" con sub-tabs: **Diagnóstico, Plan, Fotos, Controles, Pagos** (5 sub-tabs, más que otros módulos por ámbito clínico-financiero) | Densidad ámbito |
| 1.8 | Comparativo fotos T0/T1/T2 con sliders verticales sincronizados (vista lado a lado) | Pieza visual estrella, pieza de venta |
| 1.9 | Captura primaria: **WIZARDS** para diagnóstico inicial (4 pasos), plan de tratamiento (3 pasos), set fotográfico (8 vistas guiadas), control mensual (3 pasos). Drawer lateral solo para registro rápido de pago | Flujos largos lineales |
| 1.10 | **Modal full-screen para consentimientos** (3 tipos: tratamiento + financiero + asentimiento menor). NUNCA captura inline | Densidad |
| 1.11 | Status del plan de pagos calculado server-side con cron diario que evalúa `OrthoInstallment.dueDate < now() AND paidAt IS NULL`: **on-time** (al día), **light-delay** (1-30 días), **severe-delay** (>30 días), **paid-in-full** (todas pagadas) | Cálculo determinista, evita estados inconsistentes |
| 1.12 | `OrthoInstallment.paidAt` requiere ser >= `dueDate - 60 días` y <= `now()`. Backdating fuera de ese rango requiere justificación ≥20 chars + audit log | Anti-fraude contable |
| 1.13 | **Mobile = lectura + captura de foto en control**. NO captura diagnóstico, NO edita plan/pagos, NO modifica consentimiento. SÍ permite ver kanban, abrir card, ver historia financiera, tomar 8 fotos del set | Diferencia importante con Implantología |
| 1.14 | Reuso obligatorio: `SignaturePad` (pediatría), `Drawer`/`Modal`/`Section` (design system), `recordAudit`, `getCurrentUser`, `getActiveClinicId`, `canAccessModule`, `Result<T>`, patrón Server Actions con barrel estricto | Consistencia con módulos previos |
| 1.15 | Constante: `ORTHODONTICS_MODULE_KEY = "orthodontics"` en `src/lib/specialties/keys.ts` | Patrón establecido |
| 1.16 | Icono del módulo en sidebar: **`Smile`** de lucide-react | Sonrisa = resultado del orto, metáfora directa. Diferencia clara vs `Anchor` (Implant), `Activity` (Perio), `Baby` (Pedi), `Zap` (Endo) |
| 1.17 | Stack particular del módulo: `react-pdf` (Mozilla pdf.js wrapper) para preview cefalo PDF, `three` + `@types/three` con `STLLoader` y `OrbitControls` para preview STL, `sharp` para thumbnails (verificar si ya está instalado en el repo) | Necesario para diferenciador 4 |
| 1.18 | **Regla del barrel** (lección Periodoncia): `_actions/index.ts` SOLO reexporta archivos cuya primer línea es `'use server'`. Archivos con underscore (`_helpers.ts`) NUNCA en barrel. Componentes cliente importan acciones desde archivo específico | Aprendizaje aplicado en Implant, replicar |
| 1.19 | **Verificación obligatoria**: `npm run build` (NO solo `tsc --noEmit`) tras cada fase + push antes de la siguiente. Aprendizaje de Periodoncia: tsc no detecta errores de bundle cliente/servidor | Aprendizaje aplicado en Implant, replicar |
| 1.20 | NO crear modelo `Cephalometry`. Reutilizar `PatientFile` con `FileCategory`: `CEPH_ANALYSIS_PDF`, `SCAN_STL`. `OrthodonticDigitalRecord` solo agrupa referencias | Patrón consistente con Implant (PatientFile no `Radiography`) |
| 1.21 | Idioma de UI: español neutro mexicano. NUNCA argentino. Tú, NO vos | Patrón establecido |
| 1.22 | Gender enum: `M | F | OTHER` | Patrón establecido |
| 1.23 | Manejador de paquetes: **npm** (NO pnpm) | Convención del repo |
| 1.24 | Stack heredado sin cambios: Next.js 14 App Router, TypeScript estricto, Tailwind tokens dark-mode, `lucide-react`, `react-hot-toast`, `recharts`, Prisma 5.22 + Supabase | No inventar dependencias |
| 1.25 | Multi-tenant: todo modelo nuevo lleva `clinicId String` con índice. RLS activa en Supabase | Patrón establecido |

**3 confirmaciones adicionales del Coordinator (post Mensaje 1):**

- **`OrthoPhotoSet` con 8 columnas tipadas** (no tabla relacional): facilita queries de comparativo y validación de "set completo".
- **Cron diario de payment status = Vercel Cron Job** (no `pg_cron`): documentado en §8.1.
- **`OrthodonticDigitalRecord.recordType` = `enum DigitalRecordType { CEPH_ANALYSIS_PDF, SCAN_STL }`** (no string libre): tipado estricto.

---

## 2. Stack y convenciones

Heredadas de los 4 módulos previos:
- Next.js 14 App Router, TypeScript estricto (`noImplicitAny`, `strictNullChecks`).
- Tailwind con tokens dark-mode (`--text-1/2/3`, `--bg-base/elev/elev-2`, `--brand`, `--success`, `--warning`, `--danger`, `--info`, `--border-soft`).
- `lucide-react` (icono módulo: `Smile`).
- `react-hot-toast` (root).
- `recharts` para evolución temporal (cumplimiento de pagos, asistencia mensual).
- Prisma 5.22 + Supabase (Postgres 15).
- Multi-tenant con `clinicId` y RLS.
- Audit log obligatorio en TODA mutación clínica O financiera.
- Compliance: NOM-024-SSA3-2012 (expediente clínico, conservación 5 años) + LFPDPPP (consentimientos firmados, fotos del paciente).

### Stack particular del módulo Ortodoncia

| Paquete | Uso | Notas instalación |
|---------|-----|-------------------|
| `react-pdf` | Preview de cefalometrías PDF inline | `npm install react-pdf` (verificar si ya en repo). Configurar `pdfjs.GlobalWorkerOptions.workerSrc` en cliente |
| `three` + `@types/three` | Renderizado STL de modelos 3D | `npm install three @types/three`. Importar `STLLoader` desde `three/examples/jsm/loaders/STLLoader` y `OrbitControls` desde `three/examples/jsm/controls/OrbitControls` |
| `sharp` | Thumbnails server-side al upload de fotos | Verificar instalación previa. Usar en route handler del upload |

Componentes pesados (`PdfViewer`, `STLViewer3D`) se cargan con `dynamic(() => import(...), { ssr: false })` para evitar SSR de librerías que tocan `window`.

### Convenciones de servidor (heredadas)

```ts
'use server';

export async function someAction(input: Input): Promise<Result<Data>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'UNAUTHENTICATED' };
  const clinicId = await getActiveClinicId();
  if (!clinicId) return { ok: false, error: 'NO_CLINIC_CONTEXT' };

  if (!(await canAccessModule(user.id, clinicId, ORTHODONTICS_MODULE_KEY))) {
    return { ok: false, error: 'FORBIDDEN_MODULE' };
  }

  const parsed = SomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION', issues: parsed.error.issues };

  const result = await prisma.$transaction(async (tx) => {
    const data = await tx.someModel.create/update(...);
    await recordAudit(tx, {
      userId: user.id, clinicId,
      entity: 'OrthodonticTreatmentPlan', entityId: data.id,
      action: 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'PAYMENT_RECORDED',
      before, after: data,
    });
    return data;
  });

  revalidatePath(`/dashboard/patients/${input.patientId}/orthodontics`);
  revalidatePath(`/dashboard/specialties/orthodontics`);
  return { ok: true, data: result };
}
```

```ts
export const ORTHODONTICS_MODULE_KEY = 'orthodontics' as const;
```


---

## 3. Estructura de archivos

```
src/
├── app/
│   ├── dashboard/
│   │   ├── patients/[patientId]/
│   │   │   └── orthodontics/
│   │   │       └── page.tsx                       # Tab del paciente con 5 sub-tabs
│   │   └── specialties/
│   │       └── orthodontics/
│   │           ├── page.tsx                       # Kanban a nivel clínica
│   │           └── _components/
│   │               ├── OrthoKanbanBoard.tsx
│   │               ├── OrthoKanbanColumn.tsx
│   │               ├── OrthoPatientCard.tsx
│   │               ├── PaymentDelayWidget.tsx
│   │               └── ComplianceFilter.tsx
│   ├── actions/
│   │   └── orthodontics/
│   │       ├── index.ts                           # BARREL ESTRICTO (solo 'use server')
│   │       ├── result.ts                          # types Result<T> (importado directo)
│   │       ├── audit-actions.ts                   # constantes (importado directo)
│   │       ├── _helpers.ts                        # auth+tenant+audit (NUNCA en barrel)
│   │       ├── createDiagnosis.ts
│   │       ├── updateDiagnosis.ts
│   │       ├── createTreatmentPlan.ts
│   │       ├── updateTreatmentPlan.ts
│   │       ├── advanceTreatmentPhase.ts
│   │       ├── createPaymentPlan.ts
│   │       ├── recordInstallmentPayment.ts
│   │       ├── recalculatePaymentStatus.ts
│   │       ├── createPhotoSet.ts
│   │       ├── uploadPhotoToSet.ts
│   │       ├── createControlAppointment.ts
│   │       ├── linkDigitalRecord.ts               # PDF cefalo o STL scan
│   │       ├── createOrthodonticConsent.ts
│   │       ├── exportTreatmentPlanPdf.ts
│   │       └── exportFinancialAgreementPdf.ts
│   └── api/
│       └── orthodontics/
│           ├── photos/upload/route.ts             # multipart, sharp thumbnail
│           └── kanban/route.ts                    # endpoint para refresh del board
├── components/
│   └── specialties/
│       └── orthodontics/
│           ├── OrthodonticsTab.tsx                # entrada al módulo en patient
│           ├── OrthoSubTabs.tsx                   # Diagnóstico|Plan|Fotos|Controles|Pagos
│           ├── EmptyState.tsx
│           ├── diagnosis/
│           │   ├── DiagnosisView.tsx
│           │   ├── DiagnosisWizard.tsx            # 4 pasos
│           │   └── steps/
│           ├── plan/
│           │   ├── TreatmentPlanView.tsx
│           │   ├── TreatmentPlanWizard.tsx        # 3 pasos
│           │   ├── PhaseTimeline.tsx
│           │   └── steps/
│           ├── photos/
│           │   ├── PhotoSetGrid.tsx
│           │   ├── PhotoSetWizard.tsx             # 8 vistas guiadas
│           │   ├── PhotoCompareSlider.tsx         # T0/T1/T2 lado a lado
│           │   ├── PhotoCaptureMobile.tsx         # mobile capture flow
│           │   └── photo-grid-positions.ts
│           ├── controls/
│           │   ├── ControlsList.tsx
│           │   ├── ControlAppointmentWizard.tsx   # 3 pasos
│           │   └── ComplianceTracker.tsx
│           ├── payments/
│           │   ├── PaymentPlanView.tsx
│           │   ├── PaymentPlanWizard.tsx          # crear plan
│           │   ├── InstallmentList.tsx
│           │   ├── RecordPaymentDrawer.tsx
│           │   ├── PaymentStatusBadge.tsx
│           │   └── BackdateJustificationModal.tsx
│           ├── digital/
│           │   ├── DigitalRecordsPanel.tsx
│           │   ├── PdfViewer.tsx                  # dynamic import
│           │   └── STLViewer3D.tsx                # dynamic import
│           ├── consent/
│           │   ├── TreatmentConsentModal.tsx      # full-screen
│           │   ├── FinancialAgreementModal.tsx
│           │   └── MinorAssentModal.tsx
│           └── shared/
│               ├── PediatricProfileBanner.tsx     # sugerencia si Pedi activo
│               └── OrthoStageBadge.tsx
├── lib/
│   └── orthodontics/
│       ├── permissions.ts                         # ORTHODONTICS_MODULE_KEY
│       ├── phase-machine.ts                       # transiciones válidas entre OrthoPhaseKey
│       ├── payment-status.ts                      # cálculo on-time/light/severe
│       ├── photo-set-helpers.ts                   # validación 8 vistas, ordenamiento
│       ├── compliance-helpers.ts                  # último 3 controles asistidos
│       ├── kanban-helpers.ts                      # agrupamiento por fase con counts
│       ├── pdf-templates/
│       │   ├── treatment-plan.tsx                 # plan al paciente
│       │   ├── financial-agreement.tsx            # acuerdo financiero firmable
│       │   └── progress-report.tsx                # reporte de progreso T1/T2
│       ├── consent-texts.ts                       # 4 textos legales
│       └── whatsapp-templates.ts                  # 7 plantillas
└── prisma/
    ├── schema.prisma                              # +9 modelos MVP +6 v1.1 +14 enums
    ├── migrations/
    │   └── YYYYMMDD_orthodontics_init/
    │       └── migration.sql
    └── seeds/
        └── orthodontics-mock.ts                   # 3 pacientes (Andrea, Sofía, Mauricio)
```

---

## 4. Modelo de datos (Prisma)

### 4.1 Enums

```prisma
enum AngleClass {
  CLASS_I
  CLASS_II_DIV_1
  CLASS_II_DIV_2
  CLASS_III
  ASYMMETRIC
}

enum OrthoTechnique {
  METAL_BRACKETS
  CERAMIC_BRACKETS
  SELF_LIGATING_METAL
  SELF_LIGATING_CERAMIC
  LINGUAL_BRACKETS
  CLEAR_ALIGNERS
  HYBRID
}

enum AnchorageType {
  MAXIMUM
  MODERATE
  MINIMUM
  COMPOUND
}

enum OrthoPhaseKey {
  ALIGNMENT
  LEVELING
  SPACE_CLOSURE
  DETAILS
  FINISHING
  RETENTION
}

enum OrthoPhaseStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
  DELAYED
}

enum OrthoTreatmentStatus {
  PLANNED
  IN_PROGRESS
  ON_HOLD
  RETENTION
  COMPLETED
  DROPPED_OUT
}

enum OrthoPaymentStatus {
  ON_TIME
  LIGHT_DELAY
  SEVERE_DELAY
  PAID_IN_FULL
}

enum InstallmentStatus {
  PENDING
  PAID
  OVERDUE
  WAIVED
}

enum OrthoPhotoSetType {
  T0
  T1
  T2
  CONTROL
}

enum OrthoPhotoView {
  EXTRA_FRONTAL
  EXTRA_PROFILE
  EXTRA_SMILE
  INTRA_FRONTAL_OCCLUSION
  INTRA_LATERAL_RIGHT
  INTRA_LATERAL_LEFT
  INTRA_OCCLUSAL_UPPER
  INTRA_OCCLUSAL_LOWER
}

enum DentalPhase {
  DECIDUOUS
  MIXED_EARLY
  MIXED_LATE
  PERMANENT
}

enum HabitType {
  DIGITAL_SUCKING
  MOUTH_BREATHING
  TONGUE_THRUSTING
  BRUXISM
  NAIL_BITING
  LIP_BITING
  OTHER
}

enum TreatmentObjective {
  AESTHETIC_ONLY
  FUNCTIONAL_ONLY
  AESTHETIC_AND_FUNCTIONAL
}

enum OrthoConsentType {
  TREATMENT
  FINANCIAL
  MINOR_ASSENT
  PHOTO_USE
}

enum ControlAttendance {
  ATTENDED
  RESCHEDULED
  NO_SHOW
}

enum AdjustmentType {
  WIRE_CHANGE
  BRACKET_REPOSITION
  ELASTIC_CHANGE
  NEW_ALIGNERS_DELIVERED
  IPR
  BUTTON_PLACEMENT
  ATTACHMENT_PLACEMENT
  HYGIENE_REINFORCEMENT
  OTHER
}

enum PaymentMethod {
  CASH
  DEBIT_CARD
  CREDIT_CARD
  BANK_TRANSFER
  CHECK
  WALLET
}

enum DigitalRecordType {
  CEPH_ANALYSIS_PDF
  SCAN_STL
}
```

### 4.2 Modelos MVP (9)

NOTA CRÍTICA — `OrthoPhotoSet` mantiene 8 columnas tipadas (decisión confirmada Coordinator), no tabla relacional. Facilita queries de comparativo y validación de "set completo".

```prisma
model OrthodonticDiagnosis {
  id          String  @id @default(uuid())
  patientId   String
  clinicId    String
  diagnosedById String
  diagnosedAt DateTime  @default(now())

  angleClassRight    AngleClass
  angleClassLeft     AngleClass
  overbiteMm         Decimal     @db.Decimal(4, 1)
  overbitePercentage Int
  overjetMm          Decimal     @db.Decimal(4, 1)
  midlineDeviationMm Decimal?    @db.Decimal(4, 1)
  crossbite          Boolean      @default(false)
  crossbiteDetails   String?
  openBite           Boolean      @default(false)
  openBiteDetails    String?
  crowdingUpperMm    Decimal?    @db.Decimal(4, 1)
  crowdingLowerMm    Decimal?    @db.Decimal(4, 1)

  etiologySkeletal   Boolean      @default(false)
  etiologyDental     Boolean      @default(false)
  etiologyFunctional Boolean      @default(false)
  etiologyNotes      String?

  habits             HabitType[]
  habitsDescription  String?

  dentalPhase        DentalPhase

  tmjPainPresent     Boolean      @default(false)
  tmjClickingPresent Boolean      @default(false)
  tmjNotes           String?

  initialPhotoSetId  String?      @unique
  initialCephFileId  String?
  initialScanFileId  String?

  clinicalSummary    String

  treatmentPlan      OrthodonticTreatmentPlan?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  patient   Patient   @relation(fields: [patientId], references: [id])
  clinic    Clinic    @relation(fields: [clinicId], references: [id])
  diagnosedBy User    @relation("OrthoDiagnosedBy", fields: [diagnosedById], references: [id])

  @@index([patientId])
  @@index([clinicId, diagnosedAt(sort: Desc)])
}

model OrthodonticTreatmentPlan {
  id          String  @id @default(uuid())
  diagnosisId String  @unique
  patientId   String
  clinicId    String

  technique               OrthoTechnique
  techniqueNotes          String?
  estimatedDurationMonths Int
  startDate               DateTime?
  installedAt             DateTime?

  totalCostMxn            Decimal   @db.Decimal(10, 2)
  anchorageType           AnchorageType
  anchorageNotes          String?

  extractionsRequired     Boolean   @default(false)
  extractionsTeethFdi     Int[]
  iprRequired             Boolean   @default(false)
  tadsRequired            Boolean   @default(false)

  treatmentObjectives     TreatmentObjective
  patientGoals            String?

  retentionPlanText       String

  status                  OrthoTreatmentStatus  @default(PLANNED)
  statusUpdatedAt         DateTime              @default(now())

  onHoldReason            String?
  onHoldStartedAt         DateTime?
  droppedOutAt            DateTime?
  droppedOutReason        String?

  signedTreatmentConsentFileId String?

  diagnosis        OrthodonticDiagnosis  @relation(fields: [diagnosisId], references: [id])
  patient          Patient               @relation(fields: [patientId], references: [id])
  clinic           Clinic                @relation(fields: [clinicId], references: [id])
  phases           OrthodonticPhase[]
  paymentPlan      OrthoPaymentPlan?
  controls         OrthodonticControlAppointment[]
  photoSets        OrthoPhotoSet[]
  digitalRecords   OrthodonticDigitalRecord[]
  consents         OrthodonticConsent[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([patientId])
  @@index([clinicId, status])
  @@index([clinicId, installedAt(sort: Desc)])
}

model OrthodonticPhase {
  id              String  @id @default(uuid())
  treatmentPlanId String
  clinicId        String

  phaseKey        OrthoPhaseKey
  status          OrthoPhaseStatus  @default(NOT_STARTED)
  startedAt       DateTime?
  expectedEndAt   DateTime?
  completedAt     DateTime?
  notes           String?
  orderIndex      Int

  treatmentPlan   OrthodonticTreatmentPlan @relation(fields: [treatmentPlanId], references: [id])
  clinic          Clinic                   @relation(fields: [clinicId], references: [id])

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@unique([treatmentPlanId, phaseKey])
  @@index([clinicId, status])
  @@index([treatmentPlanId, orderIndex])
}

model OrthoPaymentPlan {
  id                    String  @id @default(uuid())
  treatmentPlanId       String  @unique
  patientId             String
  clinicId              String

  totalAmount           Decimal   @db.Decimal(10, 2)
  initialDownPayment    Decimal   @db.Decimal(10, 2)
  installmentAmount     Decimal   @db.Decimal(10, 2)
  installmentCount      Int

  startDate             DateTime
  endDate               DateTime
  paymentDayOfMonth     Int

  paidAmount            Decimal   @db.Decimal(10, 2) @default(0)
  pendingAmount         Decimal   @db.Decimal(10, 2)
  status                OrthoPaymentStatus @default(ON_TIME)
  statusUpdatedAt       DateTime  @default(now())

  preferredPaymentMethod PaymentMethod
  signedFinancialAgreementFileId String?

  notes                 String?

  treatmentPlan         OrthodonticTreatmentPlan @relation(fields: [treatmentPlanId], references: [id])
  patient               Patient                  @relation(fields: [patientId], references: [id])
  clinic                Clinic                   @relation(fields: [clinicId], references: [id])
  installments          OrthoInstallment[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([clinicId, status])
  @@index([patientId])
}

model OrthoInstallment {
  id              String  @id @default(uuid())
  paymentPlanId   String
  clinicId        String

  installmentNumber Int
  amount            Decimal   @db.Decimal(10, 2)
  dueDate           DateTime
  status            InstallmentStatus  @default(PENDING)

  paidAt            DateTime?
  amountPaid        Decimal?  @db.Decimal(10, 2)
  paymentMethod     PaymentMethod?
  receiptFileId     String?
  recordedById      String?
  backdatingJustification String?

  waivedAt          DateTime?
  waivedById        String?
  waiverReason      String?

  paymentPlan       OrthoPaymentPlan @relation(fields: [paymentPlanId], references: [id])
  clinic            Clinic           @relation(fields: [clinicId], references: [id])

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@unique([paymentPlanId, installmentNumber])
  @@index([clinicId, dueDate, status])
  @@index([clinicId, status])
}

model OrthoPhotoSet {
  id              String  @id @default(uuid())
  treatmentPlanId String
  patientId       String
  clinicId        String

  setType         OrthoPhotoSetType
  capturedAt      DateTime
  capturedById    String
  monthInTreatment Int?
  notes           String?

  photoFrontalId          String?
  photoProfileId          String?
  photoSmileId            String?
  photoIntraFrontalId     String?
  photoIntraLateralRId    String?
  photoIntraLateralLId    String?
  photoOcclusalUpperId    String?
  photoOcclusalLowerId    String?

  treatmentPlan   OrthodonticTreatmentPlan @relation(fields: [treatmentPlanId], references: [id])
  patient         Patient                  @relation(fields: [patientId], references: [id])
  clinic          Clinic                   @relation(fields: [clinicId], references: [id])

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([treatmentPlanId, setType])
  @@index([clinicId, capturedAt(sort: Desc)])
}

model OrthodonticControlAppointment {
  id              String  @id @default(uuid())
  treatmentPlanId String
  patientId       String
  clinicId        String

  scheduledAt     DateTime
  performedAt     DateTime?
  monthInTreatment Int
  attendance      ControlAttendance @default(ATTENDED)
  attendedById    String?

  hygieneScore    Int?
  bracketsLoose   Int?
  bracketsBroken  Int?
  appliancesIntact Boolean?
  patientReportsPain Boolean @default(false)
  patientPainNotes String?

  adjustments     AdjustmentType[]
  adjustmentNotes String?

  photoSetId      String?

  nextAppointmentAt DateTime?
  nextAppointmentNotes String?

  paymentStatusSnapshot OrthoPaymentStatus?

  treatmentPlan   OrthodonticTreatmentPlan @relation(fields: [treatmentPlanId], references: [id])
  patient         Patient                  @relation(fields: [patientId], references: [id])
  clinic          Clinic                   @relation(fields: [clinicId], references: [id])

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([treatmentPlanId, monthInTreatment])
  @@index([clinicId, scheduledAt])
  @@index([clinicId, performedAt])
}

model OrthodonticDigitalRecord {
  id              String  @id @default(uuid())
  treatmentPlanId String
  patientId       String
  clinicId        String

  recordType      DigitalRecordType
  fileId          String
  capturedAt      DateTime
  uploadedById    String
  notes           String?

  treatmentPlan   OrthodonticTreatmentPlan @relation(fields: [treatmentPlanId], references: [id])
  patient         Patient                  @relation(fields: [patientId], references: [id])
  clinic          Clinic                   @relation(fields: [clinicId], references: [id])

  createdAt DateTime  @default(now())

  @@index([treatmentPlanId, recordType])
}

model OrthodonticConsent {
  id              String  @id @default(uuid())
  treatmentPlanId String
  patientId       String
  clinicId        String

  consentType     OrthoConsentType
  signedAt        DateTime
  signerName      String
  signerRelationship String?
  patientSignatureImage String?
  guardianSignatureImage String?
  signedFileId    String?
  notes           String?

  treatmentPlan   OrthodonticTreatmentPlan @relation(fields: [treatmentPlanId], references: [id])
  patient         Patient                  @relation(fields: [patientId], references: [id])
  clinic          Clinic                   @relation(fields: [clinicId], references: [id])

  createdAt DateTime  @default(now())

  @@index([treatmentPlanId, consentType])
}
```

### 4.3 Modelos v1.1 (6, documentados con TODO, NO implementar lógica)

`OrthodonticCephalometryAnalysis` (captura numérica Steiner/Ricketts/Jarabak con 30+ campos), `OrthodonticBracketsMap` (bracket por diente con prescripción Roth/MBT/Andrews), `OrthodonticAligner` (tracking de set de alineadores), `OrthodonticIPR` (reducción interproximal), `OrthodonticTAD` (mini-implantes de anclaje), `OrthodonticRefinement` (segundo curso por ajustes finales).

### 4.4 Relaciones inversas

`Patient`: `orthodonticDiagnoses`, `orthodonticTreatmentPlans`, `orthoPaymentPlans`, `orthoPhotoSets`, `orthodonticControls`, `orthodonticConsents`, `orthodonticDigitalRecords`.

`Clinic`: las mismas en plural a nivel clínica para queries del kanban.

`User`: `orthodonticDiagnosesAsDoctor`, `orthodonticControlsAttended`, `orthoInstallmentsRecorded`, `orthoInstallmentsWaived`.

`PatientFile`: 8 relaciones inversas para las 8 vistas de fotos, más `orthoTreatmentConsentsSignedFile`, `orthoFinancialAgreementsSignedFile`, `orthoInstallmentsReceipt`.

### 4.5 Migración SQL adicional

CHECK constraints:
- `OrthodonticDiagnosis`: `overbiteMm BETWEEN -10 AND 15`, `overbitePercentage BETWEEN 0 AND 100`, `overjetMm BETWEEN -5 AND 20`.
- `OrthodonticTreatmentPlan`: `estimatedDurationMonths BETWEEN 3 AND 60`, `totalCostMxn > 0`.
- `OrthoPaymentPlan`: `installmentCount BETWEEN 1 AND 60`, `paymentDayOfMonth BETWEEN 1 AND 28`.
- `OrthoInstallment`: `amount > 0`, `(paidAt IS NULL) = (amountPaid IS NULL AND paymentMethod IS NULL)`.
- `OrthodonticTreatmentPlan`: si `status = DROPPED_OUT` entonces `droppedOutAt IS NOT NULL AND length(droppedOutReason) >= 20`.

Triggers:
- `recalc_payment_plan_status`: tras INSERT/UPDATE en `OrthoInstallment`, recalcula `OrthoPaymentPlan.paidAmount`, `pendingAmount`, `status`.

NOTA: NO se crea trigger `auto_overdue_installments`. Esa lógica vive en Vercel Cron (§8.1) — decisión confirmada por Coordinator. Razón: Supabase pooler en plan Pro no soporta `pg_cron` con la fiabilidad requerida.

RLS multi-tenant en los 9 modelos MVP siguiendo el patrón establecido.

Índices: `idx_ortho_kanban_lookup` en `OrthodonticPhase (clinicId, status, phaseKey)` para query del kanban <100ms con 500 pacientes activos.

---

## 5. Server Actions (15) + Helpers

### 5.1 Catálogo de actions

| # | Action | Propósito |
|---|--------|-----------|
| 1 | `createDiagnosis` | Crea `OrthodonticDiagnosis` con análisis Angle/overbite/overjet/etc. |
| 2 | `updateDiagnosis` | Actualiza análisis (audit log con before/after) |
| 3 | `createTreatmentPlan` | Crea `OrthodonticTreatmentPlan` + 6 `OrthodonticPhase` (NOT_STARTED) en transacción |
| 4 | `updateTreatmentPlan` | Edita técnica/duración/costo con audit |
| 5 | `advanceTreatmentPhase` | Cambia `OrthoPhaseStatus` siguiendo `phase-machine.ts`, marca `completedAt` y arranca la siguiente |
| 6 | `createPaymentPlan` | Crea `OrthoPaymentPlan` + N `OrthoInstallment` con `dueDate` calculado en transacción |
| 7 | `recordInstallmentPayment` | Marca instalment como `PAID` con validación de backdating ±60 días + justificación si fuera de rango |
| 8 | `recalculatePaymentStatus` | Llamada manual o cron — actualiza `paidAmount`/`pendingAmount`/`status` del plan |
| 9 | `createPhotoSet` | Crea `OrthoPhotoSet` (T0/T1/T2/CONTROL) con relaciones a `PatientFile` ya subidas |
| 10 | `uploadPhotoToSet` | Server action que recibe `setId` + `view` + `fileId` y actualiza la columna correspondiente |
| 11 | `createControlAppointment` | Crea `OrthodonticControlAppointment` con hallazgos + ajustes + snapshot del payment status |
| 12 | `linkDigitalRecord` | Vincula PDF cefalo o STL al `OrthodonticTreatmentPlan` (crea `OrthodonticDigitalRecord` con `recordType: DigitalRecordType`) |
| 13 | `createOrthodonticConsent` | Crea `OrthodonticConsent` con firma base64 — 4 tipos posibles |
| 14 | `exportTreatmentPlanPdf` | Carga datos del plan para que el componente PDF lo arme |
| 15 | `exportFinancialAgreementPdf` | Carga datos del plan financiero para PDF firmable |

### 5.2 Detalle de las críticas

**`createTreatmentPlan`**: en una sola transacción crea el plan + las 6 fases (`ALIGNMENT/LEVELING/SPACE_CLOSURE/DETAILS/FINISHING/RETENTION`) con `orderIndex 0..5` y `status: NOT_STARTED`. La primera (`ALIGNMENT`) se marca como `IN_PROGRESS` con `startedAt = installedAt` solo si el plan tiene `installedAt` definido. Audit log `TREATMENT_PLAN_CREATED`.

**`createPaymentPlan`**: transacción crea `OrthoPaymentPlan` + N `OrthoInstallment` cada uno con `dueDate = startDate + (i * 1 mes)` ajustando al `paymentDayOfMonth`. Validación: `installmentAmount * installmentCount + initialDownPayment >= totalAmount` (margen 1% por redondeo). Audit log `PAYMENT_PLAN_CREATED`.

**`recordInstallmentPayment`**: valida que `paidAt` esté en `[dueDate - 60 días, now()]`. Si está fuera, exige `backdatingJustification ≥20 chars`. Marca `status = PAID`, registra `recordedById`, dispara `recalculatePaymentStatus` del plan. Audit log `INSTALLMENT_PAID`.

**`recalculatePaymentStatus`**: query agregada que suma `amount` de instalments `PAID`, calcula días de retraso del instalment más vencido, mapea a `OrthoPaymentStatus`. Idempotente.

**`advanceTreatmentPhase`**: valida transición contra `phase-machine.ts`. Marca fase actual como `COMPLETED` con `completedAt = now()`, busca la siguiente por `orderIndex`, la marca `IN_PROGRESS` con `startedAt = now()`. Audit log `PHASE_ADVANCED`.

**`uploadPhotoToSet`**: complementa al route handler `/api/orthodontics/photos/upload/route.ts` que recibe el archivo, lo procesa con `sharp` (resize 2400×2400 jpeg q85 + thumbnail 300×300 webp), sube a Supabase Storage, crea `PatientFile` con `FileCategory: ORTHO_PHOTO_*`. Esta action actualiza la columna del `OrthoPhotoSet` (`photoFrontalId`, etc.).

### 5.3 Helpers

`phase-machine.ts`: transiciones válidas (cada fase solo avanza linealmente).

`payment-status.ts`: dada una lista de `OrthoInstallment` calcula el status global con la regla on-time / 1-30 / >30 días.

`photo-set-helpers.ts`: validación de las 8 vistas obligatorias, helpers de ordenamiento, comparativos cross-set.

`compliance-helpers.ts`: dado un `treatmentPlanId`, busca los últimos 3 controles y devuelve `{ ok: boolean, attendance: ControlAttendance[], lastNoShow?: Date }`.

`kanban-helpers.ts`: query agregada que devuelve `Map<OrthoPhaseKey, OrthoKanbanCard[]>` con todos los pacientes activos. Limita a 50 cards por columna.

### 5.4 Regla del barrel

`src/app/actions/orthodontics/index.ts` SOLO reexporta los 15 archivos `'use server'`. **NO reexporta** `_helpers.ts`, `result.ts`, `audit-actions.ts`. Componentes cliente importan directamente desde `./result`, `./audit-actions`, o desde el archivo de la action. Verificación: `npm run build` tras Fase 3.


---

## 6. Componentes UI

### 6.1 Árbol de componentes

```
[Página clínica] /dashboard/specialties/orthodontics/page.tsx
└── OrthoKanbanBoard
    ├── OrthoKanbanFilters
    ├── OrthoKanbanColumn × 6
    │   └── OrthoPatientCard × N
    └── PaymentDelayWidget

[Tab del paciente] /dashboard/patients/[patientId]/orthodontics/page.tsx
└── OrthodonticsTab
    └── OrthoSubTabs (Diagnóstico | Plan | Fotos | Controles | Pagos)
        ├── DiagnosisView + DiagnosisWizard (4 pasos)
        ├── TreatmentPlanView + PhaseTimeline + TreatmentPlanWizard (3 pasos)
        ├── PhotoSetGrid + PhotoSetWizard (8 vistas) + PhotoCaptureMobile + PhotoCompareSlider
        ├── ControlsList + ControlAppointmentWizard (3 pasos)
        ├── PaymentPlanView + InstallmentList + RecordPaymentDrawer + BackdateJustificationModal
        └── DigitalRecordsPanel + PdfViewer + STLViewer3D

[Modales globales]
├── TreatmentConsentModal (full-screen, SignaturePad)
├── FinancialAgreementModal (full-screen, SignaturePad)
├── MinorAssentModal (solo si paciente ≥12 y <18)
└── PhotoUseConsentModal

[Helpers]
└── PediatricProfileBanner
```

### 6.2 `OrthoKanbanBoard` — la pieza estrella

Vista clínica con 6 columnas de ancho fijo (~280px) con scroll horizontal en pantallas estrechas. Header de columna con label + contador + barra de progreso visual.

Filtros en `OrthoKanbanFilters`:
- Técnica (chips multi-select)
- Compliance (✓/⚠/sin filtro)
- Adeudo (al corriente / leve / severo / sin filtro)
- Doctor responsable
- Búsqueda por nombre (debounce 300ms)

Carga: server component invoca `buildKanbanData()` que devuelve `Map<OrthoPhaseKey, OrthoKanbanCard[]>`. Auto-refresh cada 5 min con `useInterval` no agresivo.

Si una columna tiene >50 cards, banner azul "{N} pacientes adicionales — usa filtros para ver detalle".

### 6.3 `OrthoPatientCard`

Card de ~280×140px:

```
┌──────────────────────────────────┐
│ [foto]  Andrea Reyes Domínguez   │
│ 28a     Mes 8 / 18  ████░░ 44%   │
│                                  │
│ Próx: 15 abr · Dr. Salazar       │
│                                  │
│ ✓ Compliance     ⚠ -$3,200       │
└──────────────────────────────────┘
```

Click → `/dashboard/specialties/orthodontics/[patientId]`.

Indicadores cromáticos:
- Compliance: ✓ verde (3/3 ATTENDED), ⚠ ámbar (1-2 issues), ✗ rojo (3 issues).
- Adeudo: silencio (ON_TIME), `-$X` ámbar (LIGHT_DELAY), `-$X · {N} días` rojo (SEVERE_DELAY).

### 6.4 `OrthodonticsTab` + `OrthoSubTabs`

Header con icono `Smile`, nombre paciente, badge técnica + mes en tratamiento. 5 sub-tabs con contadores en badge:

```
[Diagnóstico] [Plan] [Fotos 3] [Controles 7] [Pagos 8/18]
```

Activo "Diagnóstico" por default si no hay diagnóstico (vista vacía con CTA "+ Iniciar diagnóstico"). Si hay diagnóstico Y plan, defaultea a "Controles".

Mobile: 5 sub-tabs con scroll horizontal, solo lectura excepto sub-tab "Fotos" donde se permite captura de control con `PhotoCaptureMobile`.

### 6.5 `DiagnosisView` + `DiagnosisWizard`

Vista lectura: ficha estructurada en 5 secciones colapsables (Análisis Angle, Mediciones cuantitativas, Etiología y hábitos, ATM, Resumen clínico). Botón "Editar diagnóstico" abre wizard.

`DiagnosisWizard` 4 pasos (modal full-screen 80vw):

1. **Análisis Angle + mordida** — selector clase D/I, sliders overbite mm/%, overjet mm, midline, toggles crossbite + open bite con detalle textual condicional.
2. **Apiñamiento + etiología** — sliders apiñamiento sup/inf, 3 toggles etiología + textarea notas.
3. **Hábitos + fase dental + ATM** — multi-select `HabitType` con descriptor, radio `DentalPhase`, 2 toggles ATM + notas.
4. **Resumen + archivos digitales** — textarea `clinicalSummary` ≥40 chars, upload opcional cefalometría PDF y/o scan STL → crea `PatientFile` + `OrthodonticDigitalRecord` con `recordType: DigitalRecordType.CEPH_ANALYSIS_PDF` o `SCAN_STL`.

### 6.6 `TreatmentPlanView` + `TreatmentPlanWizard` + `PhaseTimeline`

`TreatmentPlanView`: card resumen (técnica + duración + costo + mes actual) + `PhaseTimeline` vertical con 6 fases. Cada nodo:
- Círculo con `OrthoPhaseStatus` (gris/azul pulsante/verde/ámbar).
- Label + fechas.
- Notas si existen.
- Botón "Avanzar a siguiente fase" disponible solo si actual `IN_PROGRESS` y siguiente `NOT_STARTED`.

`TreatmentPlanWizard` 3 pasos:

1. **Técnica + duración + costo** — radio `OrthoTechnique`, slider `estimatedDurationMonths` (3-60), input `totalCostMxn` con formato MX, fecha programada de instalación.
2. **Anclaje + extracciones + objetivos** — radio `AnchorageType`, toggles extracciones + IPR + TADs, multi-FDI picker, radio `TreatmentObjective`, textarea `patientGoals`.
3. **Plan de retención + consentimiento** — textarea `retentionPlanText` (prepoblado con plantilla), CTA "Firmar consentimiento de tratamiento" abre `TreatmentConsentModal`. Al guardar, `createTreatmentPlan` crea plan + 6 fases.

### 6.7 `PhotoSetGrid` + `PhotoSetWizard` + `PhotoCompareSlider`

`PhotoSetGrid`: agrupador por `OrthoPhotoSetType` ordenado cronológicamente. T0 arriba, controles intermedios cronológicos colapsables, T2 abajo. Cada set en grid 4×2 = 8 thumbnails. Click abre lightbox con zoom + navegación.

Botón "+ Nueva sesión fotográfica" abre `PhotoSetWizard`. El selector inicial usa `photo-set-helpers.ts` para decidir qué tipos están disponibles (T0 si no existe, T1/CONTROL/T2 si T0 ya existe).

`PhotoSetWizard` (modal full-screen 90vw, 8 pasos):

Cada paso muestra diagrama SVG de posicionamiento + drop zone + cámara device + preview tras subida.

| Orden | Vista | Cámara mobile | Captura |
|-------|-------|---------------|---------|
| 1 | EXTRA_FRONTAL | `environment` | Asistente |
| 2 | EXTRA_PROFILE | `environment` | Asistente |
| 3 | EXTRA_SMILE | `environment` | Asistente |
| 4 | INTRA_FRONTAL_OCCLUSION | `environment` | Doctor con espejo |
| 5 | INTRA_LATERAL_RIGHT | `environment` | Doctor con espejo |
| 6 | INTRA_LATERAL_LEFT | `environment` | Doctor con espejo |
| 7 | INTRA_OCCLUSAL_UPPER | `environment` | Doctor con espejo |
| 8 | INTRA_OCCLUSAL_LOWER | `environment` | Doctor con espejo |

Upload usa `/api/orthodontics/photos/upload/route.ts` que: recibe multipart, procesa con `sharp` (2400×2400 max + thumbnail 300×300 webp), sube a Supabase Storage path `{clinicId}/orthodontics/{patientId}/{setId}-{view}.{ext}`, crea `PatientFile` con `FileCategory: ORTHO_PHOTO_T0/T1/T2/CONTROL`. Devuelve `{ fileId, url, thumbUrl }`.

Cliente invoca `uploadPhotoToSet({ setId, view, fileId })` que actualiza la columna correspondiente del `OrthoPhotoSet`.

`PhotoCompareSlider`: vista lado a lado para comparar dos sets. Toolbar con dos selectores `OrthoPhotoSetType` + selector `OrthoPhotoView`. Render: dos canvas con la misma vista, slider vertical en medio con drag para revelar/ocultar. Sincronización de zoom y pan. Botón "Exportar comparativo PNG".

### 6.8 `ControlsList` + `ControlAppointmentWizard`

`ControlsList`: tabla cronológica con columnas Mes, Fecha, Asistencia (✓/⚠/✗), Hallazgos resumen, Próxima cita, Estado pago snapshot. Click expande detalle.

CTA "+ Nuevo control" cuando hay cita programada en agenda dentro de las próximas 48 hrs.

`ControlAppointmentWizard` 3 pasos:

1. **Asistencia + hallazgos** — radio `ControlAttendance`, slider `hygieneScore` (0-100), counters `bracketsLoose`/`bracketsBroken`, toggle `appliancesIntact`, toggle `patientReportsPain` con textarea condicional.
2. **Ajustes realizados** — multi-select `AdjustmentType` con notas, link "+ Capturar foto de control" abre `PhotoSetWizard` con `setType = CONTROL`.
3. **Próxima cita** — DatePicker + textarea + preview del estado financiero (snapshot a `paymentStatusSnapshot`).

### 6.9 `PaymentPlanView` + `InstallmentList` + `RecordPaymentDrawer` + `BackdateJustificationModal`

`PaymentPlanView`: card con 4 KPIs (Total / Pagado / Pendiente / Status) + barra de progreso. Botón "Acuerdo financiero PDF".

`InstallmentList`: tabla con N filas. Columnas: #, Vence, Monto, Status badge, Pagado en, Método, Acciones. Cada fila pendiente con botón "Registrar pago".

`RecordPaymentDrawer` (480px derecho):
- DatePicker `paidAt` con default `now()`. Fuera de `[dueDate - 60d, now()]` → abre `BackdateJustificationModal`.
- NumberInput `amountPaid` default `installment.amount`. ±5% del valor o requiere justificación.
- Radio `PaymentMethod`.
- FileUpload `receiptFileId`.
- Textarea notas opcional.
- Botón "Confirmar pago" → `recordInstallmentPayment` + `recalculatePaymentStatus`.

`BackdateJustificationModal`: textarea con contador en vivo (rojo <20, verde ≥20). Banner ámbar: "Estás registrando un pago con fecha fuera del rango permitido. Esta acción queda en audit log con tu cédula y el motivo".

### 6.10 `DigitalRecordsPanel`

Lista de `OrthodonticDigitalRecord` agrupada por `DigitalRecordType`:

```
┌─ Cefalometrías ─────────────────────────────────┐
│ • Cefalometría inicial — 12 mar 2024  [Ver]     │
│ • Cefalometría intermedia — 03 nov 2024 [Ver]   │
└─────────────────────────────────────────────────┘
┌─ Modelos 3D (STL) ──────────────────────────────┐
│ • Scan inicial 3Shape — 12 mar 2024  [Ver]      │
│ • Scan intermedio iTero — 03 nov 2024 [Ver]     │
└─────────────────────────────────────────────────┘
```

Click "Ver" abre lightbox con `PdfViewer` (si `recordType === CEPH_ANALYSIS_PDF`) o `STLViewer3D` (si `SCAN_STL`).

`PdfViewer`: dynamic import `react-pdf`. Virtualización por páginas. Toolbar zoom + página + descargar.

`STLViewer3D`: dynamic import `three`. Canvas 600×600. `STLLoader` + `OrbitControls`. Lighting básico. Botón "Resetear vista".

Botón "+ Importar archivo" con dos opciones: "PDF de cefalometría" → `FileCategory: CEPH_ANALYSIS_PDF`, `recordType: DigitalRecordType.CEPH_ANALYSIS_PDF`. "STL de scanner" → `FileCategory: SCAN_STL`, `recordType: DigitalRecordType.SCAN_STL`.

### 6.11 `PhotoCaptureMobile`

Wizard simplificado mobile-first:
- Pantalla completa, una vista a la vez.
- Diagrama grande de posicionamiento.
- Botón "Tomar foto" usa `<input type="file" capture>`.
- Preview fullscreen, "Reintentar / Continuar".
- Indicador "5 de 8" arriba.
- Pausa/reanudar entre vistas.

Las fotos se suben en background al endpoint mientras el doctor sigue. UI asíncrona con loaders por foto. Si una falla, banner "1 foto pendiente — reintentar".

### 6.12 Modales de consentimiento

3 full-screen overlay con `SignaturePad` (reuso de pediatría):

- `TreatmentConsentModal`: texto literal `TREATMENT_CONSENT_TEXT` (§10.4), firma paciente. Si menor: además firma tutor. Genera PDF con texto + firma + datos, guarda como `PatientFile`, referenciado en `OrthodonticTreatmentPlan.signedTreatmentConsentFileId`. Crea `OrthodonticConsent` con `consentType: TREATMENT`.
- `FinancialAgreementModal`: texto `FINANCIAL_AGREEMENT_TEXT` (§10.5) + tabla de mensualidades pre-pobladas + firma. Crea `OrthoPaymentPlan.signedFinancialAgreementFileId` y `OrthodonticConsent` con `consentType: FINANCIAL`.
- `MinorAssentModal`: aparece solo si `Patient.age >= 12 AND < 18`. Texto adaptado al menor. Firma del menor. `OrthodonticConsent` con `consentType: MINOR_ASSENT`. Si <12: el modal se omite.

---

## 7. Flujos UX

### 7.1 Andrea Reyes Domínguez (28, brackets metálicos, mes 8/18) — caso principal

Andrea diagnosticada con clase II división 1 con apiñamiento moderado superior (4mm). Plan: brackets metálicos 18 meses con extracciones premolares 14/24, enganche $4,000 + 18 mensualidades $2,400 = $47,200 MXN.

**Mes 0 — diagnóstico inicial:**
1. Recepcionista crea `Patient`. Doctor abre tab Ortodoncia → vista vacía → CTA "+ Iniciar diagnóstico".
2. `DiagnosisWizard` 4 pasos con datos clínicos. Paso 4 sube cefalometría PDF de Nemotec → `OrthodonticDigitalRecord` con `recordType: DigitalRecordType.CEPH_ANALYSIS_PDF`.
3. Captura set T0 (8 vistas) desde tablet.
4. `TreatmentPlanWizard`: técnica `METAL_BRACKETS`, duración 18m, costo $47,200, anclaje moderado, extracciones FDI 14/24. Firma `TreatmentConsentModal`. Crea plan + 6 fases (`ALIGNMENT` → `IN_PROGRESS`).
5. Recepcionista sub-tab Pagos → "+ Crear plan de pagos": $4,000 + 18×$2,400 día 15. Firma `FinancialAgreementModal`. Crea 18 `OrthoInstallment`.

**Mes 1 — instalación:** cita "Instalación brackets" 90min. Doctor marca `installedAt: now()`.

**Meses 1-8 — controles mensuales:** cada mes cita "Control ortodóntico" 30min. Mes 6: avanza fase `ALIGNMENT → LEVELING`. Mes 7: paciente NO_SHOW. Mes 8: asiste, captura ajustes (cambio de arco), set CONTROL.

**Mes 8 — adeudo:** mensualidad día 15 vencida hace 12 días. Cron marcó `OVERDUE`, status del plan = `LIGHT_DELAY`. Kanban muestra `-$2,400 · 12 días`. Andrea paga al día siguiente: `RecordPaymentDrawer` con `paidAt = today()`, dentro del rango ±60 días, sin justificación. Status vuelve a `ON_TIME`.

### 7.2 Sofía Hernández (12, mixta tardía, con PediatricProfile activo) — caso menor

Sofía con `PediatricProfile` activo. Clase III esquelética leve.

1. Tab Ortodoncia muestra `PediatricProfileBanner` con datos heredados (María Vargas madre/tutor, hábitos previos).
2. `DiagnosisWizard` paso 3: `habits` pre-poblados desde Pedi. `dentalPhase: MIXED_LATE`.
3. `TreatmentPlanWizard`: brackets metálicos con expansor maxilar previo (en `techniqueNotes`), 24 meses, $52,000.
4. `TreatmentConsentModal` exige firma del **tutor** — `signerRelationship: 'tutor'`.
5. Sofía 12 años (≥12) → `MinorAssentModal` aparece. Texto adaptado. Sofía firma. Crea segundo `OrthodonticConsent` `consentType: MINOR_ASSENT`.

**Edge case:** otro menor de 11 años (Daniel) → `MinorAssentModal` se omite por `if (patient.age < 18 && patient.age >= 12)`.

**Edge case 2:** clínica sin Pediatría activa atiende a un menor → banner "Esta clínica no tiene módulo de Pediatría activo. Captura los datos mínimos requeridos:" → checkboxes hábitos inline en `DiagnosisWizard` paso 3, captura del tutor inline en `TreatmentConsentModal`.

### 7.3 Mauricio López (32, alineadores Smileco) — caso alineadores

Clase I con apiñamiento leve inferior. Caso ideal alineadores.

1. `DiagnosisWizard` con apiñamiento mucho menor.
2. Sube scan STL Medit en paso 4 → `OrthodonticDigitalRecord` con `recordType: DigitalRecordType.SCAN_STL`. Click "Ver" abre `STLViewer3D`.
3. `TreatmentPlanWizard`: `CLEAR_ALIGNERS`, 12 meses, $38,000, IPR planeado.
4. Plan de pagos: $8,000 + 12×$2,500.
5. Mes 1: doctor entrega primer set. `ControlAppointmentWizard` paso 2 selecciona `AdjustmentType: NEW_ALIGNERS_DELIVERED` con notas.
6. Mes 6: scan intermedio para refinamiento (en MVP solo se sube el STL; refinamiento estructurado es v1.1).

### Edge: backdating

Recepcionista descubre día 1 mayo que olvidó pago efectivo del 15 abril. `RecordPaymentDrawer`, `paidAt: 15 abr`. Como `dueDate = 15 abr` y `paidAt = 15 abr` → dentro del rango, pasa sin justificación.

Otro caso: pago hecho hace 3 meses. `paidAt: hace 90 días`, fuera del rango ±60 días → `BackdateJustificationModal` exige texto ≥20 chars: "Pago en efectivo registrado en cuaderno físico, traspaso retrasado al sistema". Audit log incluye la justificación.

### Edge: paciente que abandona

Paciente deja de asistir 3 meses consecutivos (3 NO_SHOW). Sin respuesta a contacto. Doctor marca `OrthoTreatmentStatus.DROPPED_OUT` con `droppedOutReason ≥20 chars`. Plan queda en historial sin borrar. Mensualidades pendientes visibles para cobranza separada.

---

## 8. Integraciones

### 8.1 Vercel Cron Jobs — recálculo diario (decisión confirmada)

`vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/orthodontics/recalculate-payment-status",
      "schedule": "0 7 * * *"
    }
  ]
}
```

(7:00 AM UTC = 1:00 AM CST de México.)

Endpoint `/api/cron/orthodontics/recalculate-payment-status/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recalculatePaymentStatus } from '@/app/actions/orthodontics/recalculatePaymentStatus';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const overdueResult = await prisma.orthoInstallment.updateMany({
    where: {
      status: 'PENDING',
      paidAt: null,
      dueDate: { lt: new Date() },
    },
    data: { status: 'OVERDUE' },
  });

  const affectedPlans = await prisma.orthoPaymentPlan.findMany({
    where: { installments: { some: { status: 'OVERDUE' } } },
    select: { id: true },
  });

  let recalculated = 0;
  for (const plan of affectedPlans) {
    const result = await recalculatePaymentStatus({ paymentPlanId: plan.id });
    if (result.ok) recalculated++;
  }

  return NextResponse.json({
    ok: true,
    overdueMarked: overdueResult.count,
    plansRecalculated: recalculated,
    timestamp: new Date().toISOString(),
  });
}
```

`CRON_SECRET` — Vercel inyecta automáticamente el header `Authorization: Bearer ${CRON_SECRET}` en cron calls.

**Defensa en 2 capas:** si el cron falla un día, la action `recalculatePaymentStatus` se invoca manualmente desde botón "Recalcular ahora" en `PaymentPlanView` (visible para ADMIN/RECEPTIONIST). Y cualquier `recordInstallmentPayment` la dispara internamente.

### 8.2 Citas — 9 duraciones sugeridas

| Tipo de cita | Duración default |
|--------------|------------------|
| Consulta de valoración ortodóntica | 45 min |
| Diagnóstico + estudios iniciales | 60 min |
| Instalación de brackets (1 arcada) | 60 min |
| Instalación de brackets (2 arcadas) | 90 min |
| Entrega de alineadores (set inicial) | 45 min |
| Control ortodóntico mensual | 30 min |
| Control con cambio de arco | 45 min |
| Retiro de brackets + retención | 60 min |
| Control de retención | 20 min |

### 8.3 SOAP pre-fill por mes

- **S**: "Paciente en mes {N} de tratamiento ortodóntico con {technique}. Refiere {dolor / molestia / asintomático / problema con bracket / pérdida de elástico}".
- **O**: "Aparatología {íntegra / con bracket suelto en {FDI} / con módulo perdido en {FDI}}. Higiene: {score}/100. Fase actual: {phaseKey}."
- **A**: "Tratamiento progresando {según plan / con retraso} en fase {phaseKey}. Adeudo financiero: {paymentStatus}."
- **P**: "Próxima cita en {N} semanas. Ajustes: {adjustments[]}. {Si LIGHT_DELAY o SEVERE_DELAY: 'Recordar regularización del plan de pagos'}."

### 8.4 Plan general

Cada `OrthodonticTreatmentPlan` se inserta como ítem padre en `TreatmentPlan` general con sub-ítems por fase + sub-ítems "Diagnóstico inicial", "Instalación de aparatología", "Retiro y retención". Dependencias temporales (no agendar "Retiro" antes de completar `FINISHING`).

### 8.5 Odontograma general

Pacientes con tratamiento activo: badge en cada diente involucrado:
- Brackets: `<rect>` minimalista con punto central, color por fase global (azul `IN_PROGRESS`, ámbar `DELAYED`, verde `RETENTION`).
- Alineadores: paréntesis `()` — visualmente distinto.
- Extracciones planeadas: marca "X" tenue.

Click → `/dashboard/specialties/orthodontics/[patientId]` con FDI resaltado.

### 8.6 Recetas NOM-024 — 3 plantillas

**Plantilla 1: Profilaxis post-extracción ortodóntica**
Ibuprofeno 400 mg cada 8 h por 3 días con alimentos. Clorhexidina 0.12% colutorio cada 12 h por 7 días iniciando a las 24 h.

**Plantilla 2: Manejo de dolor post-ajuste de brackets**
Paracetamol 500 mg cada 8 h por 48 h máximo según molestia. Cera ortodóntica de protección sobre brackets que rocen.

**Plantilla 3: Aftas / lesiones por aparatología**
Bencidamina 0.15% colutorio cada 8 h por 5 días. Triamcinolona 0.1% pomada bucal aplicada localmente cada 12 h.

Encabezado NOM-024 estándar con datos del paciente, cédula del doctor, firma. Sin antibióticos rutinarios.

### 8.7 WhatsApp — 7 plantillas

- **APPOINTMENT_REMINDER_24H**: "Hola {nombre}, te recordamos tu control ortodóntico mañana a las {hora}. Recuerda cepillarte muy bien antes de venir."
- **MISSED_APPOINTMENT**: "Te esperamos hoy a las {hora}. ¿Todo bien? Reagenda fácil respondiendo este mensaje."
- **INSTALLMENT_DUE_3_DAYS**: "Tu mensualidad #{N} vence en 3 días ({fecha}) por ${amount}. Métodos: {methods}."
- **INSTALLMENT_OVERDUE_LIGHT**: "Tu mensualidad #{N} venció hace {N} días. Saldo pendiente: ${pending}."
- **INSTALLMENT_OVERDUE_SEVERE**: "Notamos un retraso de más de un mes en tu mensualidad #{N}. Es importante regularizar para no detener tu tratamiento."
- **MONTHLY_PROGRESS** (mes 6, 12, 18): "Hola {nombre}, llevas {N} meses de tratamiento. Estás en fase {phaseKey}. ¡Vas excelente!"
- **PRE_INSTALLATION_INSTRUCTIONS**: "Mañana es tu cita de instalación. Llega con dientes muy bien lavados. Trae 1 hr disponible."

`INSTALLMENT_*` se encolan automáticamente desde el cron diario tras cambio de status. Encolado con `type='ORTHO'`.

### 8.8 Audit log

Acciones especiales en `AuditLog`:
- `ORTHO_DIAGNOSIS_CREATED` / `_UPDATED`
- `ORTHO_TREATMENT_PLAN_CREATED` / `_UPDATED` / `_STATUS_CHANGED`
- `ORTHO_PHASE_ADVANCED`
- `ORTHO_PAYMENT_PLAN_CREATED`
- `ORTHO_INSTALLMENT_PAID` (incluye `installmentNumber`, `amountPaid`, `paymentMethod`, `backdatingJustification` si aplica)
- `ORTHO_INSTALLMENT_WAIVED`
- `ORTHO_PAYMENT_STATUS_RECALCULATED` (con `from` → `to`)
- `ORTHO_PHOTO_SET_CREATED` / `_PHOTO_UPLOADED`
- `ORTHO_CONTROL_CREATED`
- `ORTHO_DIGITAL_RECORD_LINKED` (con `recordType: DigitalRecordType`)
- `ORTHO_CONSENT_SIGNED` (con `consentType`)

### 8.9 Storage Supabase

Bucket: `patient-files` (existente).
Path: `{clinicId}/orthodontics/{patientId}/{photoSetId}-{view}.{ext}` + `{photoSetId}-{view}-thumb.webp`.

Procesamiento server-side `runtime: 'nodejs'`:

```ts
import sharp from 'sharp';

const original = await sharp(buffer)
  .rotate()
  .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85, mozjpeg: true })
  .toBuffer();

const thumbnail = await sharp(buffer)
  .rotate()
  .resize(300, 300, { fit: 'cover' })
  .webp({ quality: 80 })
  .toBuffer();
```

Signed URLs con expiración 1 hora.

### 8.10 Endpoint `/api/orthodontics/context`

Devuelve `{ moduleActive, hasActivePlan, currentPhase, paymentStatus, monthInTreatment }` para componentes globales.


---

## 9. Reportes / Exportes PDF

Los 3 PDFs siguen el patrón de Implantología (carnet, surgical-report, plan): generación server-side con `@react-pdf/renderer` + route handlers que devuelven `Content-Type: application/pdf`.

### 9.0 Patrón compartido

Cada PDF tiene 3 piezas:
1. **Componente PDF** en `src/lib/orthodontics/pdf-templates/<name>.tsx` — React component con `<Document>`, `<Page>`, `<Text>`, `<View>`.
2. **Server action de datos** en `src/app/actions/orthodontics/export*Pdf.ts` — carga el plan + relaciones, valida auth/tenant/módulo.
3. **Route handler** en `src/app/api/orthodontics/.../route.ts` — invoca la action, llama `renderToBuffer(<Component data={data} />)`, responde con `Content-Type: application/pdf`.

```ts
import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { exportTreatmentPlanPdf } from '@/app/actions/orthodontics/exportTreatmentPlanPdf';
import { isFailure } from '@/app/actions/orthodontics/result';
import { TreatmentPlanPdf } from '@/lib/orthodontics/pdf-templates/treatment-plan';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const result = await exportTreatmentPlanPdf({ treatmentPlanId: params.id });
  if (isFailure(result)) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  const buffer = await renderToBuffer(<TreatmentPlanPdf data={result.data} />);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="plan-tratamiento-${params.id}.pdf"`,
    },
  });
}
```

### 9.1 PDF "Plan de tratamiento ortodóntico" (al paciente)

- **Path:** `/api/orthodontics/treatment-plans/[id]/treatment-plan-pdf`
- **Action:** `exportTreatmentPlanPdf`
- **Componente:** `src/lib/orthodontics/pdf-templates/treatment-plan.tsx`
- **Formato:** A4 vertical, 4 páginas, lenguaje accesible.

Páginas:
1. Encabezado clínica + datos paciente + odontograma con dientes a tratar destacados + diagnóstico traducido.
2. Plan: técnica, duración, 6 fases explicadas, extracciones, anclaje, objetivos, retención.
3. Costos por fase + IVA + métodos de pago + cronograma visual de mensualidades. NO firmable.
4. Riesgos generales + plan de cuidados + qué esperar mes a mes.

### 9.2 PDF "Acuerdo financiero" (firmable)

- **Path:** `/api/orthodontics/payment-plans/[id]/financial-agreement-pdf`
- **Action:** `exportFinancialAgreementPdf`
- **Componente:** `src/lib/orthodontics/pdf-templates/financial-agreement.tsx`
- **Formato:** A4 vertical, 2-3 páginas. Pieza más sensible legalmente.

Estructura:
1. Encabezado + datos completos (CURP, RFC) + responsable financiero si distinto.
2. Tabla de mensualidades pre-poblada desde `OrthoInstallment[]`.
3. Cláusulas financieras (texto literal §10.5).
4. Cláusulas clínicas vinculadas.
5. Firmas: paciente o tutor + representante de clínica con cédula.

PDF se descarga, firma físicamente, escanea, sube como `PatientFile` referenciado en `OrthoPaymentPlan.signedFinancialAgreementFileId`. Alternativa: firma digital con SignaturePad embebida en `FinancialAgreementModal`.

### 9.3 PDF "Reporte de progreso" (T0 vs T2)

- **Path:** `/api/orthodontics/treatment-plans/[id]/progress-report-pdf`
- **Action:** `exportProgressReportPdf`
- **Componente:** `src/lib/orthodontics/pdf-templates/progress-report.tsx`
- **Formato:** A4 horizontal landscape, 2 páginas.

Estructura:
1. Encabezado + datos paciente + duración real + técnica usada. Grid 2×4: 8 vistas T0 izquierda, 8 vistas T2 derecha. Cada vista pareada por `OrthoPhotoView`.
2. Mediciones cuantitativas iniciales vs finales (en MVP solo "Resumen clínico" textual). Carta de salida del ortodoncista. Plan de retención detallado.

**Disponibilidad condicional:** si paciente NO firmó `OrthodonticConsent` con `consentType: PHOTO_USE`, reporte se genera con marca de agua "Uso clínico — confidencial" y NO disponible como descarga shareable.

### 9.4 Notas de implementación

- Imágenes vía `<Image src={await getSignedUrl(...)} />` con URLs firmadas de Supabase Storage. El componente PDF debe ser `async` o recibir las URLs ya resueltas como prop.
- Renderizado nodejs runtime (NO edge) — `@react-pdf/renderer` requiere APIs de Node.
- `maxDuration: 60` en route handler.
- Logo de la clínica desde `Clinic.logoFileId` cargado como signed URL.

---

## 10. Compliance NOM-024-SSA3-2012 + LFPDPPP

### 10.1 NOM-024-SSA3-2012

- Conservación expediente clínico: 5 años mínimo. Recomendación interna: **7 años**.
- Audit log obligatorio en TODA mutación clínica O financiera.
- Identificación del responsable: cada mutación apunta a `User` con cédula consultable.
- Recetas: 3 plantillas (§8.6) cumplen formato NOM-024.
- `OrthodonticTreatmentPlan` con `status: COMPLETED | DROPPED_OUT` NO se hard-deletea; soft-delete con `deletedAt`.
- Receta digital con firma electrónica del doctor (cédula + timestamp).

### 10.2 LFPDPPP — específico para fotografías

- Las fotos del paciente son datos personales sensibles. Storage Supabase con RLS multi-tenant.
- `PHOTO_USE` es consentimiento separado del tratamiento. Sin esa firma: fotos solo para expediente clínico interno + reporte de progreso para el propio paciente. NUNCA en redes sociales o materiales publicitarios.
- Derecho al olvido: datos identificables eliminables a petición. Datos clínicos cuantitativos anónimos se conservan 5-7 años por NOM-024.
- Aviso de privacidad al iniciar el primer diagnóstico ortodóntico.
- Pacientes menores: las fotos requieren `PHOTO_USE` firmado por el tutor además del asentimiento del menor si tiene ≥12.

### 10.3 Almacenamiento de los textos legales

Todos en `src/lib/orthodontics/consent-texts.ts` como constantes exportadas. **NUNCA se modifican sin coordinación legal**. Placeholders entre llaves se reemplazan al renderizar.

### 10.4 `TREATMENT_CONSENT_TEXT` (texto literal)

```ts
export const TREATMENT_CONSENT_TEXT = `
CONSENTIMIENTO INFORMADO PARA TRATAMIENTO ORTODÓNTICO

Yo, {patientFullName}, con fecha de nacimiento {birthDate} y expediente clínico número {fileNumber}, después de haber sido informado(a) por el(la) Dr(a). {doctorFullName}, con cédula profesional {doctorLicense}, en términos comprensibles para mí, manifiesto que he comprendido y acepto los siguientes puntos:

1. EN QUÉ CONSISTE EL TRATAMIENTO ORTODÓNTICO

El tratamiento ortodóntico consiste en colocar aparatos correctores (brackets, alineadores u otros dispositivos) que ejercen fuerzas controladas sobre los dientes y los maxilares, con la finalidad de modificar su posición a lo largo de un periodo prolongado de tiempo. La técnica propuesta para mi caso es: {technique}. La aparatología incluye: {techniqueNotes}.

2. POR QUÉ SE ME PROPONE ESTE TRATAMIENTO

He sido diagnosticado(a) con: {diagnosisAccessibleSummary}. El tratamiento busca corregir esta condición con los siguientes objetivos: {treatmentObjectives}.

3. DURACIÓN ESTIMADA Y FACTORES QUE LA MODIFICAN

La duración estimada del tratamiento activo es de {estimatedDurationMonths} meses. Esta duración es una estimación clínica basada en mi caso y puede extenderse hasta un 30% adicional debido a factores como inasistencia, higiene oral deficiente, características biológicas individuales, daño a la aparatología, falta de cumplimiento con elásticos o alineadores.

Después del retiro de la aparatología activa inicia la fase de retención, que es de por vida.

4. ALTERNATIVAS DE TRATAMIENTO

Las alternativas que se me han explicado son no realizar tratamiento ortodóntico, tratamiento quirúrgico ortognático combinado con ortodoncia, o tratamientos parciales o limitados.

5. RIESGOS, MOLESTIAS Y LIMITACIONES POSIBLES

Acepto que el tratamiento ortodóntico, como cualquier acto médico, no está exento de riesgos: descalcificación del esmalte, reabsorción radicular, caries y enfermedad periodontal por higiene inadecuada, recidiva si no uso retenedores correctamente, dolor o molestia los primeros días tras instalación y ajustes, daño a la aparatología por alimentos duros o pegajosos con costo de reparación a mi cargo, resultados estéticos sujetos a mi anatomía individual y cumplimiento, posible necesidad de procedimientos coadyuvantes con costo adicional acordado por escrito, y en tratamientos con extracciones cierre incompleto de espacios o asimetrías leves.

6. MIS OBLIGACIONES COMO PACIENTE

Asistir a todas las citas mensuales, mantener higiene oral exhaustiva, usar elásticos o aparatología auxiliar al menos 22 horas al día si así me es prescrito, comunicar inmediatamente cualquier daño o dolor anormal, cumplir el plan de retención de por vida, cumplir con el plan de pagos firmado en acuerdo financiero separado.

7. PLAN DE RETENCIÓN

Al finalizar el tratamiento activo se iniciará la fase de retención: {retentionPlanText}. La retención es de por vida en la mayoría de los casos. El abandono o uso incorrecto de los retenedores es la principal causa de recidiva, y la responsabilidad de su uso es exclusivamente mía.

8. LO QUE NO SE GARANTIZA

He comprendido que NO se garantiza perfección estética absoluta, estabilidad indefinida sin uso de retenedores, ausencia total de recidiva por crecimiento facial post-tratamiento, ni resultados idénticos a fotos de casos previos mostrados con fines ilustrativos.

9. AUTORIZACIÓN

Habiendo entendido todo lo anterior y habiendo tenido la oportunidad de hacer preguntas que fueron respondidas a mi satisfacción, autorizo al(a la) Dr(a). {doctorFullName} y a su equipo a iniciar el tratamiento ortodóntico descrito.

Firmo el presente documento en {city} a los {day} días del mes de {month} de {year}.


_________________________________________
{patientFullName}
{signerRole: 'Paciente' | 'Tutor responsable'}
{guardianRelationship — solo si aplica}


_________________________________________
Dr(a). {doctorFullName}
Cédula profesional: {doctorLicense}
`.trim();
```

### 10.5 `FINANCIAL_AGREEMENT_TEXT` (texto literal)

```ts
export const FINANCIAL_AGREEMENT_TEXT = `
ACUERDO FINANCIERO PARA TRATAMIENTO ORTODÓNTICO

Entre {clinicLegalName} (en adelante "la Clínica"), representada por {clinicRepresentative}, y {patientFullName} (en adelante "el Paciente"), o en su caso {guardianFullName} en calidad de {guardianRelationship} actuando como responsable financiero del Paciente menor de edad, se celebra el presente acuerdo financiero conforme a los siguientes términos:

1. TRATAMIENTO Y COSTO TOTAL

El tratamiento ortodóntico autorizado en consentimiento informado separado tiene un costo total de $ {totalCostMxn} M.N., correspondiente a la técnica {technique} con duración estimada de {estimatedDurationMonths} meses.

2. ESTRUCTURA DE PAGO

Pago inicial (enganche): $ {initialDownPayment} M.N. al inicio del tratamiento.
Mensualidades: {installmentCount} pagos consecutivos de $ {installmentAmount} M.N. cada uno.
Día de pago de cada mensualidad: día {paymentDayOfMonth} de cada mes.
Fecha de inicio: {startDate}. Fecha de fin: {endDate}.
Método de pago preferente: {preferredPaymentMethod}.

3. TOLERANCIA Y CONSECUENCIAS DE RETRASO

a) Tolerancia: la Clínica acepta hasta 30 días naturales sin penalización.
b) Retraso mayor a 30 días: la Clínica se reserva el derecho de suspender citas de control hasta regularización. La suspensión NO modifica vencimientos subsecuentes.
c) Retraso reiterado: tres o más mensualidades vencidas no regularizadas autorizan a la Clínica a aplicar las cláusulas de abandono (numeral 5).

4. REFINANCIAMIENTO Y MODIFICACIONES

Cualquier modificación al calendario requiere acuerdo escrito separado. Acuerdos verbales no tienen efecto.

5. ABANDONO DEL TRATAMIENTO POR EL PACIENTE

Si el Paciente abandona unilateralmente (3 inasistencias consecutivas sin reagendamiento, sin respuesta durante 30 días naturales, o por declaración expresa):
a) NO procede reembolso del enganche.
b) NO procede reembolso de mensualidades pagadas.
c) Mensualidades vencidas hasta la fecha del abandono SÍ son exigibles por vía legal.
d) Retiro de aparatología en cita de retiro con costo de $ {removalAppointmentCost} M.N.

6. INCUMPLIMIENTO POR LA CLÍNICA

Si la Clínica suspende el tratamiento sin causa justificada, debe reembolsar mensualidades pagadas correspondientes a meses futuros no realizados.

7. RECETAS, ESTUDIOS Y PROCEDIMIENTOS NO INCLUIDOS

NO incluidos en el costo total: estudios de imagen, extracciones por especialista distinto, reparación por mal uso del Paciente, procedimientos coadyuvantes no contemplados, retenedores adicionales por pérdida o daño después del primer set.

8. EXPEDICIÓN DE COMPROBANTES FISCALES

La Clínica expedirá CFDI por cada pago. Datos de facturación: {rfc, razonSocial, regimenFiscal, usoCfdi}.

9. PROTECCIÓN DE DATOS PERSONALES

El tratamiento de datos se rige por el aviso de privacidad de la Clínica conforme a LFPDPPP.

10. JURISDICCIÓN

Para interpretación y cumplimiento, ambas partes se someten a la jurisdicción de tribunales competentes de {city}.

LEÍDO Y ACEPTADO en {city} a los {day} días del mes de {month} de {year}.


_________________________________________
{patientFullName}
{signerRole: 'Paciente' | 'Responsable financiero'}


_________________________________________
{clinicRepresentative}
Por {clinicLegalName}
`.trim();
```

### 10.6 `MINOR_ASSENT_TEXT` (lenguaje accesible para ≥12 años)

```ts
export const MINOR_ASSENT_TEXT = `
ASENTIMIENTO PARA TRATAMIENTO ORTODÓNTICO

Hola {minorFirstName},

Tus papás (o el familiar que es tu tutor) ya firmaron un papel donde dicen que están de acuerdo con que te pongan {techniqueAccessibleName: 'brackets' | 'alineadores'}. Como tú ya tienes {minorAge} años, queremos que tú también nos digas que entiendes lo que vamos a hacer y que estás de acuerdo.

QUÉ VAMOS A HACER

Te vamos a poner unos aparatos en los dientes que poco a poco los van a mover para que queden derechos. El tratamiento va a tomar entre {estimatedDurationMonths} y {estimatedDurationPlus30Percent} meses. Tendrás que venir cada mes a una cita corta donde te ajustamos los aparatos.

QUÉ TIENES QUE HACER TÚ

Cepillarte los dientes muy bien después de cada comida. Te vamos a enseñar la técnica especial.
Usar hilo dental todos los días.
NO comer cosas muy duras (palomitas duras, hielo, hueso de pollo, dulces duros).
NO comer cosas muy pegajosas (chicle, caramelos masticables, goma).
Si te ponen elásticos o tienes que usar alineadores, usarlos como te indique el doctor.
Avisarle a tus papás o llamarnos a la clínica si algo se rompe, se sale o te duele mucho.
Venir a TODAS tus citas mensuales.

QUÉ VAS A SENTIR AL PRINCIPIO

Los primeros 3 a 7 días te van a doler un poco al masticar. Es normal. Tu mamá o tu papá te puede dar paracetamol o ibuprofeno. La molestia se quita sola. Después de cada cita mensual también puede haber un par de días de molestia leve.

CUÁNTO VA A DURAR EN TOTAL

Tu tratamiento activo va a durar más o menos {estimatedDurationMonths} meses. Después usarás retenedores especiales por mucho tiempo (durante años, casi toda la vida).

LO QUE NO TE PODEMOS PROMETER

No podemos prometerte que tus dientes queden exactamente igual a alguna foto que hayas visto. Lo que sí te prometemos es trabajar con todo el cuidado posible para que tu sonrisa quede sana, funcional y con la mejor estética posible para ti.

¿ESTÁS DE ACUERDO?

Si entiendes lo que te explicamos y estás de acuerdo en empezar tu tratamiento, firma aquí abajo.


_________________________________________
{minorFullName}
Edad: {minorAge} años
Fecha: {today}
`.trim();
```

### 10.7 `PHOTO_USE_CONSENT_TEXT` (uso clínico vs comercial)

```ts
export const PHOTO_USE_CONSENT_TEXT = `
CONSENTIMIENTO PARA USO DE FOTOGRAFÍAS CLÍNICAS

Yo, {patientFullName}, o en su caso {guardianFullName} actuando como {guardianRelationship} del Paciente menor de edad, autorizo a {clinicLegalName} al uso de las fotografías clínicas tomadas durante mi tratamiento ortodóntico (extra/intraorales, T0/T1/T2/CONTROL).

Esta autorización es OPCIONAL. Marco con una "X" cada uso al que doy autorización expresa. Los usos NO marcados quedan automáticamente excluidos.

USOS CLÍNICOS (uso interno de la Clínica)

[ ] Expediente clínico personal del Paciente. Las fotografías forman parte del expediente clínico y se conservan según NOM-024-SSA3-2012. Este uso es intrínseco al tratamiento.

[ ] Casos de estudio interno entre profesionales de la Clínica con fines educativos, de calidad o de discusión clínica, SIN identificación visible del Paciente.

USOS EDUCATIVOS Y COMERCIALES (uso externo)

[ ] Materiales educativos para futuros pacientes (folletos, presentaciones), SIN nombre pero pudiendo incluir fotografías parciales o intraorales identificables.

[ ] Publicación en redes sociales, sitio web o materiales publicitarios con fines comerciales, INCLUYENDO fotografías extraorales completas e identificables, sin nombre.

[ ] Publicación en redes sociales, sitio web o materiales publicitarios con fines comerciales, INCLUYENDO fotografías y nombre o iniciales del Paciente.

CONDICIONES

1. La autorización se otorga sin contraprestación económica.
2. La autorización es REVOCABLE en cualquier momento por escrito. La revocación NO afecta usos previos pero detiene futuros usos.
3. La revocación NO obliga a retirar materiales ya impresos o publicados antes de la fecha de revocación.
4. La autorización NO transfiere derechos de autor sobre las fotografías.
5. El uso autorizado se limita a los fines descritos.
6. Esta autorización se rige por LFPDPPP y se complementa con el aviso de privacidad de la Clínica.

LEÍDO Y AUTORIZADO en {city} a los {day} días del mes de {month} de {year}.


_________________________________________
{patientFullName}
{signerRole: 'Paciente' | 'Tutor responsable'}


_________________________________________
{clinicRepresentative}
Por {clinicLegalName}
`.trim();
```

---

## 11. Estados visuales

### 11.1 Codificación cromática

| Token | Hex | Tailwind | Uso |
|-------|-----|----------|-----|
| Gris neutro | `#71717A` | `zinc-500` | NOT_STARTED, fases futuras |
| Azul progreso | `#3B82F6` | `blue-500` | IN_PROGRESS, ALIGNMENT/LEVELING/SPACE_CLOSURE |
| Verde éxito | `#22C55E` | `emerald-500` | COMPLETED, PAID, ON_TIME |
| Verde profundo | `#16A34A` | `emerald-600` | PAID_IN_FULL, RETENTION exitosa |
| Ámbar | `#F59E0B` | `amber-500` | DELAYED, LIGHT_DELAY |
| Naranja | `#F97316` | `orange-500` | RESCHEDULED frecuente, riesgo de drop |
| Rojo | `#EF4444` | `red-500` | SEVERE_DELAY, DROPPED_OUT, OVERDUE severo |
| Violeta | `#8B5CF6` | `violet-500` | RETENTION |

### 11.2 Color por `OrthoPhaseKey`

| Fase | Color |
|------|-------|
| ALIGNMENT | `blue-500` |
| LEVELING | `blue-500` |
| SPACE_CLOSURE | `blue-600` |
| DETAILS | `cyan-500` |
| FINISHING | `emerald-500` |
| RETENTION | `violet-500` |

### 11.3 Color por `OrthoPaymentStatus`

| Status | Visual |
|--------|--------|
| ON_TIME | sin badge |
| LIGHT_DELAY | badge `-$X` ámbar |
| SEVERE_DELAY | badge `-$X · {N} días` rojo + borde card naranja |
| PAID_IN_FULL | badge ✓ verde "Pagado" |

### 11.4 Color por `InstallmentStatus`

| Status | Visual |
|--------|--------|
| PENDING | fila gris claro |
| PAID | fila con check verde + fecha pagado |
| OVERDUE | fila roja con badge "{N} días vencido" |
| WAIVED | fila tachada con tooltip "Perdonado: {reason}" |

### 11.5 Color por compliance

| Patrón últimos 3 controles | Color | Indicador |
|---------------------------|-------|-----------|
| 3/3 ATTENDED | `emerald-500` | ✓ verde |
| 2/3 ATTENDED + 1 RESCHEDULED | `amber-500` | ⚠ ámbar leve |
| 2/3 ATTENDED + 1 NO_SHOW | `amber-500` | ⚠ ámbar |
| 1/3 ATTENDED + 2 issues | `orange-500` | ⚠ naranja |
| 0/3 ATTENDED | `red-500` | ✗ rojo + banner "Riesgo de drop" |

### 11.6 Estados generales

- Vacío: onboarding centrado con CTA "+ Iniciar diagnóstico ortodóntico".
- Diagnóstico hecho sin plan: banner ámbar "Diagnóstico capturado. Configura el plan."
- Plan firmado sin instalación: banner azul "Plan firmado. Programa la cita de instalación."
- Tratamiento activo: vista normal.
- ON_HOLD: banner gris "En pausa desde {fecha}. Razón: {onHoldReason}" + CTA "Reanudar".
- COMPLETED: vista de cierre con comparativo T0/T2 + plan de retención + CTA "Generar reporte de progreso PDF".
- DROPPED_OUT: vista archivada con razón documentada, sin permitir ediciones.


---

## 12. Mock data — 3 pacientes (`prisma/seeds/orthodontics-mock.ts`)

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedOrthodontics() {
  const clinic = await prisma.clinic.findFirst({ where: { categories: { has: 'DENTAL' } } });
  if (!clinic) throw new Error('No DENTAL clinic found');
  const doctor = await prisma.user.findFirst({ where: { clinicId: clinic.id, role: 'DOCTOR' } });
  if (!doctor) throw new Error('No DOCTOR found');
  const clinicId = clinic.id;
  const doctorId = doctor.id;

  // CASO 1 — Andrea Reyes Domínguez (28, brackets metálicos, mes 8/18, LEVELING)
  const andrea = await prisma.patient.upsert({
    where: { patientNumber: 'ORT-2024-001' },
    update: {},
    create: {
      patientNumber: 'ORT-2024-001',
      firstName: 'Andrea',
      lastName: 'Reyes Domínguez',
      birthDate: new Date('1996-07-15'),
      gender: 'F',
      phone: '+529992345678',
      email: 'andrea.reyes@example.com',
      clinicId,
    },
  });

  const andreaDx = await prisma.orthodonticDiagnosis.create({
    data: {
      patientId: andrea.id,
      clinicId,
      diagnosedById: doctorId,
      diagnosedAt: new Date('2024-03-12'),
      angleClassRight: 'CLASS_II_DIV_1',
      angleClassLeft: 'CLASS_II_DIV_1',
      overbiteMm: 4.0,
      overbitePercentage: 35,
      overjetMm: 6.0,
      midlineDeviationMm: 1.5,
      crossbite: false,
      openBite: false,
      crowdingUpperMm: 4.0,
      crowdingLowerMm: 1.5,
      etiologyDental: true,
      habits: ['DIGITAL_SUCKING'],
      habitsDescription: 'Succión digital cesada en infancia (~6 años).',
      dentalPhase: 'PERMANENT',
      tmjPainPresent: false,
      tmjClickingPresent: false,
      clinicalSummary: 'Paciente femenina de 28 años con maloclusión clase II división 1 bilateral, overjet aumentado 6mm, overbite profundo 4mm/35%, apiñamiento moderado superior 4mm. Etiología dental por hábito de succión digital cesado. Plan: extracción de premolares 14 y 24, brackets metálicos por 18 meses con anclaje moderado.',
    },
  });

  const andreaPlan = await prisma.orthodonticTreatmentPlan.create({
    data: {
      diagnosisId: andreaDx.id,
      patientId: andrea.id,
      clinicId,
      technique: 'METAL_BRACKETS',
      estimatedDurationMonths: 18,
      startDate: new Date('2024-04-15'),
      installedAt: new Date('2024-04-15'),
      totalCostMxn: 47200,
      anchorageType: 'MODERATE',
      extractionsRequired: true,
      extractionsTeethFdi: [14, 24],
      treatmentObjectives: 'AESTHETIC_AND_FUNCTIONAL',
      patientGoals: 'Mejorar la mordida y la estética. Trabajo en atención al cliente.',
      retentionPlanText: 'Retenedor fijo lingual 3-3 inferior + retenedor removible Hawley superior. 24h por 6 meses, luego nocturno permanente.',
      status: 'IN_PROGRESS',
    },
  });

  await prisma.orthodonticPhase.createMany({
    data: [
      { treatmentPlanId: andreaPlan.id, clinicId, phaseKey: 'ALIGNMENT',     status: 'COMPLETED',   orderIndex: 0, startedAt: new Date('2024-04-15'), completedAt: new Date('2024-10-15') },
      { treatmentPlanId: andreaPlan.id, clinicId, phaseKey: 'LEVELING',      status: 'IN_PROGRESS', orderIndex: 1, startedAt: new Date('2024-10-15'), expectedEndAt: new Date('2025-02-15') },
      { treatmentPlanId: andreaPlan.id, clinicId, phaseKey: 'SPACE_CLOSURE', status: 'NOT_STARTED', orderIndex: 2 },
      { treatmentPlanId: andreaPlan.id, clinicId, phaseKey: 'DETAILS',       status: 'NOT_STARTED', orderIndex: 3 },
      { treatmentPlanId: andreaPlan.id, clinicId, phaseKey: 'FINISHING',     status: 'NOT_STARTED', orderIndex: 4 },
      { treatmentPlanId: andreaPlan.id, clinicId, phaseKey: 'RETENTION',     status: 'NOT_STARTED', orderIndex: 5 },
    ],
  });

  const andreaPayPlan = await prisma.orthoPaymentPlan.create({
    data: {
      treatmentPlanId: andreaPlan.id,
      patientId: andrea.id,
      clinicId,
      totalAmount: 47200,
      initialDownPayment: 4000,
      installmentAmount: 2400,
      installmentCount: 18,
      startDate: new Date('2024-04-15'),
      endDate: new Date('2025-10-15'),
      paymentDayOfMonth: 15,
      paidAmount: 21600,
      pendingAmount: 25600,
      status: 'ON_TIME',
      preferredPaymentMethod: 'DEBIT_CARD',
    },
  });

  for (let i = 1; i <= 18; i++) {
    const dueDate = new Date('2024-05-15');
    dueDate.setMonth(dueDate.getMonth() + (i - 1));
    const paid = i <= 7;
    await prisma.orthoInstallment.create({
      data: {
        paymentPlanId: andreaPayPlan.id,
        clinicId,
        installmentNumber: i,
        amount: 2400,
        dueDate,
        status: paid ? 'PAID' : 'PENDING',
        paidAt: paid ? new Date(dueDate.getTime() + (i === 7 ? 12 * 86400000 : 86400000)) : null,
        amountPaid: paid ? 2400 : null,
        paymentMethod: paid ? 'DEBIT_CARD' : null,
      },
    });
  }

  for (let m = 1; m <= 8; m++) {
    await prisma.orthodonticControlAppointment.create({
      data: {
        treatmentPlanId: andreaPlan.id,
        patientId: andrea.id,
        clinicId,
        scheduledAt: new Date(2024, 3 + m, 15),
        performedAt: m === 7 ? null : new Date(2024, 3 + m, 15),
        monthInTreatment: m,
        attendance: m === 7 ? 'NO_SHOW' : 'ATTENDED',
        attendedById: m === 7 ? null : doctorId,
        hygieneScore: m === 7 ? null : 85,
        bracketsLoose: 0,
        bracketsBroken: 0,
        appliancesIntact: m === 7 ? null : true,
        adjustments: m === 6 ? ['WIRE_CHANGE'] : m === 8 ? ['ELASTIC_CHANGE', 'WIRE_CHANGE'] : ['ELASTIC_CHANGE'],
        paymentStatusSnapshot: 'ON_TIME',
      },
    });
  }

  await prisma.orthodonticConsent.createMany({
    data: [
      { treatmentPlanId: andreaPlan.id, patientId: andrea.id, clinicId, consentType: 'TREATMENT', signedAt: new Date('2024-04-10'), signerName: 'Andrea Reyes Domínguez', signerRelationship: 'self' },
      { treatmentPlanId: andreaPlan.id, patientId: andrea.id, clinicId, consentType: 'FINANCIAL', signedAt: new Date('2024-04-10'), signerName: 'Andrea Reyes Domínguez', signerRelationship: 'self' },
      { treatmentPlanId: andreaPlan.id, patientId: andrea.id, clinicId, consentType: 'PHOTO_USE', signedAt: new Date('2024-04-10'), signerName: 'Andrea Reyes Domínguez', signerRelationship: 'self', notes: 'Autoriza casos de estudio interno + materiales educativos sin nombre. NO autoriza redes sociales identificable.' },
    ],
  });

  // CASO 2 — Sofía Hernández Vargas (12, mixta tardía, ortopedia + brackets, con PediatricProfile)
  const sofia = await prisma.patient.upsert({
    where: { patientNumber: 'ORT-2024-002' },
    update: {},
    create: {
      patientNumber: 'ORT-2024-002',
      firstName: 'Sofía',
      lastName: 'Hernández Vargas',
      birthDate: new Date('2013-05-20'),
      gender: 'F',
      phone: '+529993456789',
      clinicId,
    },
  });

  await prisma.pediatricProfile.upsert({
    where: { patientId: sofia.id },
    update: {},
    create: {
      patientId: sofia.id,
      clinicId,
      guardianName: 'María Vargas López',
      guardianRelationship: 'MOTHER',
      guardianPhone: '+529993456789',
      guardianEmail: 'maria.vargas@example.com',
      habits: ['TONGUE_THRUSTING', 'MOUTH_BREATHING'],
      habitsNotes: 'Deglución atípica observada desde los 6 años. Respirador bucal en consulta.',
    },
  });

  const sofiaDx = await prisma.orthodonticDiagnosis.create({
    data: {
      patientId: sofia.id,
      clinicId,
      diagnosedById: doctorId,
      diagnosedAt: new Date('2025-01-15'),
      angleClassRight: 'CLASS_III',
      angleClassLeft: 'CLASS_III',
      overbiteMm: 1.0,
      overbitePercentage: 8,
      overjetMm: -1.0,
      crossbite: true,
      crossbiteDetails: 'Mordida cruzada anterior incisivos superiores 11 y 21.',
      crowdingUpperMm: 2.0,
      crowdingLowerMm: 0.5,
      etiologySkeletal: true,
      etiologyFunctional: true,
      habits: ['TONGUE_THRUSTING', 'MOUTH_BREATHING'],
      habitsDescription: 'Deglución atípica documentada en módulo Pediatría. Respirador bucal observado en consulta inicial.',
      dentalPhase: 'MIXED_LATE',
      clinicalSummary: 'Paciente femenina de 12 años en dentición mixta tardía con maloclusión clase III esquelética leve y mordida cruzada anterior. Plan en dos fases: ortopedia (expansor maxilar) por 9 meses, seguido de brackets metálicos por 15 meses al alcanzar dentición permanente.',
    },
  });

  const sofiaPlan = await prisma.orthodonticTreatmentPlan.create({
    data: {
      diagnosisId: sofiaDx.id,
      patientId: sofia.id,
      clinicId,
      technique: 'METAL_BRACKETS',
      techniqueNotes: 'Fase 1 ortopédica con expansor maxilar Hyrax (9 meses) → Fase 2 brackets metálicos (15 meses). Total 24 meses.',
      estimatedDurationMonths: 24,
      startDate: new Date('2025-02-01'),
      installedAt: null,
      totalCostMxn: 52000,
      anchorageType: 'MODERATE',
      extractionsRequired: false,
      treatmentObjectives: 'AESTHETIC_AND_FUNCTIONAL',
      retentionPlanText: 'Retenedor removible Hawley superior + retenedor fijo lingual 3-3 inferior tras finalizar Fase 2.',
      status: 'PLANNED',
    },
  });

  for (const [orderIndex, phaseKey] of (['ALIGNMENT', 'LEVELING', 'SPACE_CLOSURE', 'DETAILS', 'FINISHING', 'RETENTION'] as const).entries()) {
    await prisma.orthodonticPhase.create({
      data: { treatmentPlanId: sofiaPlan.id, clinicId, phaseKey, status: 'NOT_STARTED', orderIndex },
    });
  }

  await prisma.orthoPaymentPlan.create({
    data: {
      treatmentPlanId: sofiaPlan.id,
      patientId: sofia.id,
      clinicId,
      totalAmount: 52000,
      initialDownPayment: 6000,
      installmentAmount: 1900,
      installmentCount: 24,
      startDate: new Date('2025-02-05'),
      endDate: new Date('2027-02-05'),
      paymentDayOfMonth: 5,
      paidAmount: 6000,
      pendingAmount: 46000,
      status: 'ON_TIME',
      preferredPaymentMethod: 'BANK_TRANSFER',
    },
  });

  await prisma.orthodonticConsent.createMany({
    data: [
      { treatmentPlanId: sofiaPlan.id, patientId: sofia.id, clinicId, consentType: 'TREATMENT', signedAt: new Date('2025-01-20'), signerName: 'María Vargas López', signerRelationship: 'tutor' },
      { treatmentPlanId: sofiaPlan.id, patientId: sofia.id, clinicId, consentType: 'MINOR_ASSENT', signedAt: new Date('2025-01-20'), signerName: 'Sofía Hernández Vargas', signerRelationship: 'self' },
      { treatmentPlanId: sofiaPlan.id, patientId: sofia.id, clinicId, consentType: 'FINANCIAL', signedAt: new Date('2025-01-20'), signerName: 'María Vargas López', signerRelationship: 'tutor' },
      { treatmentPlanId: sofiaPlan.id, patientId: sofia.id, clinicId, consentType: 'PHOTO_USE', signedAt: new Date('2025-01-20'), signerName: 'María Vargas López', signerRelationship: 'tutor', notes: 'Autoriza ÚNICAMENTE casos de estudio interno. NO autoriza materiales educativos ni redes sociales.' },
    ],
  });

  // CASO 3 — Mauricio López Aguirre (32, alineadores Smileco, ALIGNMENT mes 3)
  const mauricio = await prisma.patient.upsert({
    where: { patientNumber: 'ORT-2024-003' },
    update: {},
    create: {
      patientNumber: 'ORT-2024-003',
      firstName: 'Mauricio',
      lastName: 'López Aguirre',
      birthDate: new Date('1992-11-08'),
      gender: 'M',
      phone: '+529994567890',
      email: 'mauricio.lopez@example.com',
      clinicId,
    },
  });

  const mauricioDx = await prisma.orthodonticDiagnosis.create({
    data: {
      patientId: mauricio.id,
      clinicId,
      diagnosedById: doctorId,
      diagnosedAt: new Date('2024-08-25'),
      angleClassRight: 'CLASS_I',
      angleClassLeft: 'CLASS_I',
      overbiteMm: 2.5,
      overbitePercentage: 20,
      overjetMm: 2.0,
      crowdingLowerMm: 2.0,
      etiologyDental: true,
      habits: [],
      dentalPhase: 'PERMANENT',
      clinicalSummary: 'Paciente masculino de 32 años con maloclusión clase I y apiñamiento leve inferior 2mm. Caso ideal para alineadores transparentes. Plan: 22 sets de alineadores Smileco por 12 meses con IPR planeado en sectores 23-24 y 33-34.',
    },
  });

  const mauricioPlan = await prisma.orthodonticTreatmentPlan.create({
    data: {
      diagnosisId: mauricioDx.id,
      patientId: mauricio.id,
      clinicId,
      technique: 'CLEAR_ALIGNERS',
      techniqueNotes: 'Smileco — set de 22 alineadores. Cambio cada 14 días.',
      estimatedDurationMonths: 12,
      startDate: new Date('2024-09-10'),
      installedAt: new Date('2024-09-10'),
      totalCostMxn: 38000,
      anchorageType: 'MINIMUM',
      extractionsRequired: false,
      iprRequired: true,
      treatmentObjectives: 'AESTHETIC_AND_FUNCTIONAL',
      patientGoals: 'Mejorar la estética sin que se note el tratamiento. Trabajo en ventas, contacto frecuente con clientes.',
      retentionPlanText: 'Retenedor termoplástico tipo Essix superior e inferior. 24h por 4 meses, luego nocturno permanente.',
      status: 'IN_PROGRESS',
    },
  });

  await prisma.orthodonticPhase.createMany({
    data: [
      { treatmentPlanId: mauricioPlan.id, clinicId, phaseKey: 'ALIGNMENT',     status: 'IN_PROGRESS', orderIndex: 0, startedAt: new Date('2024-09-10'), expectedEndAt: new Date('2025-01-10') },
      { treatmentPlanId: mauricioPlan.id, clinicId, phaseKey: 'LEVELING',      status: 'NOT_STARTED', orderIndex: 1 },
      { treatmentPlanId: mauricioPlan.id, clinicId, phaseKey: 'SPACE_CLOSURE', status: 'NOT_STARTED', orderIndex: 2 },
      { treatmentPlanId: mauricioPlan.id, clinicId, phaseKey: 'DETAILS',       status: 'NOT_STARTED', orderIndex: 3 },
      { treatmentPlanId: mauricioPlan.id, clinicId, phaseKey: 'FINISHING',     status: 'NOT_STARTED', orderIndex: 4 },
      { treatmentPlanId: mauricioPlan.id, clinicId, phaseKey: 'RETENTION',     status: 'NOT_STARTED', orderIndex: 5 },
    ],
  });

  const mauricioPayPlan = await prisma.orthoPaymentPlan.create({
    data: {
      treatmentPlanId: mauricioPlan.id,
      patientId: mauricio.id,
      clinicId,
      totalAmount: 38000,
      initialDownPayment: 8000,
      installmentAmount: 2500,
      installmentCount: 12,
      startDate: new Date('2024-09-10'),
      endDate: new Date('2025-09-10'),
      paymentDayOfMonth: 10,
      paidAmount: 15500,
      pendingAmount: 22500,
      status: 'ON_TIME',
      preferredPaymentMethod: 'CREDIT_CARD',
    },
  });

  for (let i = 1; i <= 12; i++) {
    const dueDate = new Date('2024-10-10');
    dueDate.setMonth(dueDate.getMonth() + (i - 1));
    const paid = i <= 3;
    await prisma.orthoInstallment.create({
      data: {
        paymentPlanId: mauricioPayPlan.id,
        clinicId,
        installmentNumber: i,
        amount: 2500,
        dueDate,
        status: paid ? 'PAID' : 'PENDING',
        paidAt: paid ? dueDate : null,
        amountPaid: paid ? 2500 : null,
        paymentMethod: paid ? 'CREDIT_CARD' : null,
      },
    });
  }

  await prisma.orthodonticControlAppointment.createMany({
    data: [
      { treatmentPlanId: mauricioPlan.id, patientId: mauricio.id, clinicId, scheduledAt: new Date('2024-10-08'), performedAt: new Date('2024-10-08'), monthInTreatment: 1, attendance: 'ATTENDED', attendedById: doctorId, hygieneScore: 95, adjustments: ['NEW_ALIGNERS_DELIVERED'], paymentStatusSnapshot: 'ON_TIME', adjustmentNotes: 'Set 1 entregado. Compliance excelente.' },
      { treatmentPlanId: mauricioPlan.id, patientId: mauricio.id, clinicId, scheduledAt: new Date('2024-11-08'), performedAt: new Date('2024-11-08'), monthInTreatment: 2, attendance: 'ATTENDED', attendedById: doctorId, hygieneScore: 92, adjustments: ['NEW_ALIGNERS_DELIVERED', 'ATTACHMENT_PLACEMENT'], paymentStatusSnapshot: 'ON_TIME', adjustmentNotes: 'Sets 2-3 + attachments en 23, 24, 33, 34.' },
      { treatmentPlanId: mauricioPlan.id, patientId: mauricio.id, clinicId, scheduledAt: new Date('2024-12-09'), performedAt: new Date('2024-12-09'), monthInTreatment: 3, attendance: 'ATTENDED', attendedById: doctorId, hygieneScore: 90, adjustments: ['NEW_ALIGNERS_DELIVERED', 'IPR'], paymentStatusSnapshot: 'ON_TIME', adjustmentNotes: 'Sets 4-6 + IPR 0.3mm en 23-24 y 33-34.' },
    ],
  });

  await prisma.orthodonticDigitalRecord.createMany({
    data: [
      { treatmentPlanId: mauricioPlan.id, patientId: mauricio.id, clinicId, recordType: 'SCAN_STL', fileId: 'placeholder_scan_mauricio_T0', capturedAt: new Date('2024-09-05'), uploadedById: doctorId, notes: 'Scan inicial Medit i700' },
      { treatmentPlanId: mauricioPlan.id, patientId: mauricio.id, clinicId, recordType: 'SCAN_STL', fileId: 'placeholder_scan_mauricio_M3', capturedAt: new Date('2024-12-15'), uploadedById: doctorId, notes: 'Scan intermedio mes 3 — control de progreso' },
    ],
  });

  await prisma.orthodonticConsent.createMany({
    data: [
      { treatmentPlanId: mauricioPlan.id, patientId: mauricio.id, clinicId, consentType: 'TREATMENT', signedAt: new Date('2024-09-08'), signerName: 'Mauricio López Aguirre', signerRelationship: 'self' },
      { treatmentPlanId: mauricioPlan.id, patientId: mauricio.id, clinicId, consentType: 'FINANCIAL', signedAt: new Date('2024-09-08'), signerName: 'Mauricio López Aguirre', signerRelationship: 'self' },
    ],
  });

  console.log('Orthodontics seed: Andrea (LEVELING), Sofía (PLANNED), Mauricio (ALIGNMENT) creados.');
}

seedOrthodontics().catch(console.error).finally(() => prisma.$disconnect());
```

---

## 13. Testing

### 13.1 Tests unitarios (`src/lib/orthodontics/__tests__/`)

`phase-machine.test.ts`: 6 transiciones lineales válidas, no permite saltar fases, reapertura con justificación es excepción.

`payment-status.test.ts`: ON_TIME / LIGHT_DELAY / SEVERE_DELAY / PAID_IN_FULL con casos límite (día 30 = LIGHT, día 31 = SEVERE), múltiples vencidas con regla "max severity".

`compliance-helpers.test.ts`: 3/3 verde, 2/3 + 1 RESCHEDULED amber-light, 2/3 + 1 NO_SHOW amber, 0/3 red con dropRisk, <3 controles devuelve null.

`photo-set-helpers.test.ts`: 8 vistas → completo, sin frontal → incompleto, pareo correcto T0 ↔ T2.

`kanban-helpers.test.ts`: agrupamiento por OrthoPhaseKey, ordenamiento por monthInTreatment desc, cap 50 por columna, RETENTION en su columna, DROPPED_OUT/COMPLETED/ON_HOLD filtrados.

### 13.2 Tests E2E Playwright — los 5 flujos críticos

**Flujo 1 — Crear diagnóstico + plan completo para Andrea:**
- Login como doctor.
- Navegar a `/dashboard/patients/{andreaId}/orthodontics`.
- Verificar EmptyState.
- DiagnosisWizard 4 pasos con datos clínicos completos.
- TreatmentPlanWizard 3 pasos. Firmar `TreatmentConsentModal`.
- Sub-tab Pagos → "+ Crear plan de pagos". Firmar `FinancialAgreementModal`.
- Verificar 18 instalments, status = ON_TIME.

**Flujo 2 — Diagnóstico para Sofía con PediatricProfile heredado + asentimiento:**
- Login en clínica con módulo Pediatría activo.
- Navegar a Sofía. Verificar `PediatricProfileBanner`.
- DiagnosisWizard paso 3: `habits` pre-poblados con TONGUE_THRUSTING, MOUTH_BREATHING.
- Completar wizard, plan, consentimientos.
- TreatmentConsentModal exige firma del tutor.
- MinorAssentModal aparece automáticamente (Sofía 12 ≥12).
- Verificar 4 consentimientos en BD.

**Flujo 3 — Capturar set fotográfico T0 desde mobile:**
- Viewport mobile 375×667.
- Login mobile, navegar a Andrea sub-tab Fotos.
- Click "+ Nueva sesión fotográfica" → seleccionar T0.
- PhotoCaptureMobile fullscreen, 8 vistas con uploads simulados.
- Verificar OrthoPhotoSet con 8 columnas pobladas.

**Flujo 4 — Registrar pago con backdating:**
- Andrea instalment #5 OVERDUE.
- RecordPaymentDrawer.
- Caso A: paidAt = today (dentro rango ±60d) → confirma sin justificación.
- Caso B: paidAt = hace 70 días → BackdateJustificationModal aparece. Justificación <20 disabled, ≥20 habilitado. Submit acepta. Audit log incluye `backdatingJustification`.

**Flujo 5 — Avanzar fase del tratamiento:**
- Mauricio en ALIGNMENT IN_PROGRESS.
- Sub-tab Plan, PhaseTimeline, click "Avanzar a siguiente fase".
- ALIGNMENT → COMPLETED, LEVELING → IN_PROGRESS.
- Audit log `ORTHO_PHASE_ADVANCED`.
- Intentar saltar LEVELING → DETAILS → action rechaza con "Transición inválida".

### 13.3 Tests RLS multi-tenant

- Clínica A no puede ver `OrthodonticTreatmentPlan` de clínica B.
- Query del kanban en clínica A no devuelve cards de clínica B.
- Endpoint del cron solo procesa instalments del tenant.
- Acceso cross-tenant → 404 o redirect.

### 13.4 Tests visuales (Storybook)

- OrthoPatientCard en cada combinación de status financiero/compliance.
- PhaseTimeline con cada combinación de phase status.
- PhotoCompareSlider con T0/T2 mock.
- InstallmentList con mezcla PENDING/PAID/OVERDUE/WAIVED.
- BackdateJustificationModal con contador 0/15/20+.
- OrthoKanbanBoard con 0/1/10/50 cards por columna.

### 13.5 Tests financieros

- Backdating fuera de rango sin justificación → rechaza.
- Backdating con justificación ≥20 → acepta + audit.
- Pago duplicado → rechazado.
- Cron diario marca correctamente OVERDUE y dispara recálculo.
- `recalculatePaymentStatus` idempotente.
- Pagar más del `installmentAmount` ±5% sin justificación → rechaza.
- Waiver con `waiverReason` <20 → rechaza.

### 13.6 Tests del cron Vercel

- Endpoint sin Authorization → 401.
- Con secret válido → procesa todos los planes activos.
- 500 planes con `maxDuration: 300` suficiente.
- Fallo de un plan no bloquea el resto.

### 13.7 Performance

- OrthoKanbanBoard con 200 pacientes <300ms.
- Query con índice `idx_ortho_kanban_lookup` <150ms.
- PhotoCompareSlider con 16 fotos <500ms.
- PDF treatment-plan <1.5s, financial-agreement <1s, progress-report <2.5s.

---

## 14. Roadmap

### MVP v1.0 — 6 features MUST

1. Diagnóstico ortodóntico estructurado.
2. Plan de tratamiento con fases y plan de pagos integrado.
3. Serie fotográfica 8 vistas T0/T1/T2.
4. Cita de control mensual estructurada.
5. Comparativo visual de fotografías.
6. Plan de pagos con tracking de mensualidades.

Cefalometría + STL en MVP solo importar + preview, captura numérica → v1.1.

### v1.1 (Q+1)

- OrthodonticCephalometryAnalysis (captura numérica Steiner/Ricketts/Jarabak).
- OrthodonticBracketsMap (bracket por diente con prescripción).
- OrthodonticAligner (tracking set actual).
- OrthodonticIPR (detalle teeth pairs + mm).
- OrthodonticTAD (mini-implantes con lote).
- OrthodonticRefinement.
- Mediciones cuantitativas finales (`_atClose`).
- Integración con Periodoncia para evaluar salud periodontal pre-orto.

### v2.0

- IA superpuesta para análisis automático de fotografías.
- Importación directa de planeación digital (ClinCheck, AOS).
- Vista 3D del tratamiento simulado.
- Dashboard analítico (tasa éxito por técnica, duración real vs estimada).
- Integración con PMS de cobranza externa para SEVERE_DELAY >90 días.
- Refinanciamiento self-service.
- SMS además de WhatsApp.
- Pago automatizado vía link Stripe/Mercado Pago.

---

## 15. Casos de uso resumidos

**Caso 1 — Andrea Reyes Domínguez (28, brackets metálicos, mes 8/18):** Clase II div 1 bilateral, apiñamiento moderado superior 4mm, extracciones premolares 14/24. Brackets metálicos 18 meses, anclaje moderado. Plan pagos $4,000 enganche + 18×$2,400 ($47,200). Estado: mes 8, fase LEVELING IN_PROGRESS, ON_TIME post-recuperación de LIGHT_DELAY del mes 7. 1 NO_SHOW en historial. Caso del mockup.

**Caso 2 — Sofía Hernández Vargas (12, ortopedia + brackets, con PediatricProfile):** Menor en mixta tardía con clase III esquelética leve y mordida cruzada anterior. Plan 2 fases: expansor 9 meses → brackets 15 meses (24 total). Hereda hábitos de Pediatría. 4 consentimientos: TREATMENT (tutor), MINOR_ASSENT (Sofía), FINANCIAL (tutor), PHOTO_USE solo casos internos. Estado: PLANNED. Plan pagos $52,000 en 24×$1,900 + $6,000.

**Caso 3 — Mauricio López Aguirre (32, alineadores Smileco):** Clase I con apiñamiento leve inferior. 22 sets alineadores Smileco, 12 meses con IPR planeado en 23-24 y 33-34. Pago $38,000 ($8,000 + 12×$2,500). Scan Medit inicial + intermedio mes 3 importados como `OrthodonticDigitalRecord` con `recordType: SCAN_STL`. Estado: mes 3 ALIGNMENT IN_PROGRESS, attachments + IPR realizados. Compliance excelente.

---

## 16. Checklist de implementación (10 fases)

Cada fase termina con `npm run build` verde + push antes de la siguiente.

### Fase 1: Schema + migración
- [ ] 9 modelos MVP + 14 enums (incluyendo `DigitalRecordType`).
- [ ] 6 modelos v1.1 documentados con TODO.
- [ ] Relaciones inversas en Patient, Clinic, User, PatientFile.
- [ ] Migración SQL con CHECK + RLS + índice `idx_ortho_kanban_lookup`.
- [ ] Trigger `recalc_payment_plan_status`.
- [ ] **NO crear** trigger `auto_overdue_installments` — vive en cron Vercel.
- [ ] `prisma:migrate:deploy` en staging.
- [ ] `npm run build` verde + push.

### Fase 2: Tipos + helpers + zod
- [ ] `src/lib/types/orthodontics.ts`.
- [ ] 5 helpers (`phase-machine`, `payment-status`, `photo-set-helpers`, `compliance-helpers`, `kanban-helpers`) con tests unitarios.
- [ ] Schemas zod para 15 actions.
- [ ] `whatsapp-templates.ts` (7) + `consent-texts.ts` (4 textos literales §10.4-§10.7).
- [ ] `ORTHODONTICS_MODULE_KEY` en `keys.ts`.
- [ ] `npm run build` verde + push.

### Fase 3: Server actions
- [ ] 15 actions con auth + tenant + canAccessModule + zod + transacción + recordAudit + revalidatePath.
- [ ] `recordInstallmentPayment` valida backdating ±60d + justificación.
- [ ] `recalculatePaymentStatus` idempotente.
- [ ] `advanceTreatmentPhase` respeta linealidad.
- [ ] **Barrel estricto**: `index.ts` SOLO `'use server'`.
- [ ] `npm run build` verde + push.

### Fase 4: Componentes núcleo + kanban
- [ ] Kanban completo (Board + Column + PatientCard + filtros).
- [ ] OrthodonticsTab + OrthoSubTabs.
- [ ] Vistas de cada sub-tab + auxiliares.
- [ ] PhotoCompareSlider con sliders sincronizados.
- [ ] PdfViewer (dynamic) + STLViewer3D (dynamic).
- [ ] **NO browser storage** (`localStorage`/`sessionStorage` prohibidos).
- [ ] `npm run build` verde + push.

### Fase 5: Wizards + drawers + modales
- [ ] DiagnosisWizard 4 pasos.
- [ ] TreatmentPlanWizard 3 pasos.
- [ ] PhotoSetWizard 8 vistas + PhotoCaptureMobile.
- [ ] ControlAppointmentWizard 3 pasos.
- [ ] RecordPaymentDrawer + BackdateJustificationModal.
- [ ] 4 modales de consentimiento full-screen con SignaturePad de pediatría.
- [ ] `npm run build` verde + push.

### Fase 6: Página dedicada + sidebar + permission
- [ ] `/dashboard/specialties/orthodontics/page.tsx` con kanban + filtros + widgets.
- [ ] `/dashboard/specialties/orthodontics/[patientId]/page.tsx`.
- [ ] Icono `Smile` en sidebar grupo "Especialidades".
- [ ] Permission key `specialties.orthodontics` en `permissions.ts`.
- [ ] `npm run build` verde + push.

### Fase 7: PDFs (3 con `@react-pdf/renderer`)
- [ ] `treatment-plan.tsx` (A4 vertical, 4 páginas).
- [ ] `financial-agreement.tsx` (A4 vertical, firmable).
- [ ] `progress-report.tsx` (A4 horizontal, comparativo T0/T2).
- [ ] 3 route handlers con `renderToBuffer` (patrón `/api/implants/[id]/passport/route.ts`).
- [ ] `npm run build` verde + push.

### Fase 8: Integraciones cruzadas
- [ ] **Vercel Cron Job**: `vercel.json` + `/api/cron/orthodontics/recalculate-payment-status/route.ts` con `Authorization: Bearer ${CRON_SECRET}`.
- [ ] 9 duraciones de cita en agenda.
- [ ] Pre-fill SOAP por mes.
- [ ] Plan general con sub-ítems.
- [ ] Badge brackets/alineadores en odontograma.
- [ ] 3 plantillas receta NOM-024.
- [ ] 7 templates WhatsApp encolados type='ORTHO'.
- [ ] Endpoint `/api/orthodontics/context`.
- [ ] Storage Supabase con `sharp` + thumbnails.
- [ ] Audit log con todas las acciones especiales.
- [ ] `npm run build` verde + push.

### Fase 9: Mock data + tests
- [ ] Seed Andrea + Sofía + Mauricio (script §12).
- [ ] Tests unitarios.
- [ ] Playwright E2E (5 flujos §13.2).
- [ ] Tests RLS.
- [ ] Tests financieros.
- [ ] Snapshots Storybook.
- [ ] Tests performance (kanban 200 pacientes <300ms).

### Fase 10: QA + lanzamiento
- [ ] Aplicar migración SQL en Supabase.
- [ ] Crear `Module` marketplace key="orthodontics" pricing $329 MXN/mes.
- [ ] Activar `ClinicModule` para clínica QA.
- [ ] Configurar `CRON_SECRET` en Vercel env vars.
- [ ] Validar primer ejecución del cron desde dashboard.
- [ ] Demo end-to-end con Andrea.
- [ ] Validación NOM-024 + LFPDPPP.
- [ ] Documentación de usuario.
- [ ] Toggle del módulo activable por clínica.
- [ ] Deploy a producción.

---

## 17. Hoja de referencia rápida

### Constantes

| Constante | Valor | Path |
|-----------|-------|------|
| Module key | `"orthodontics"` | `src/lib/specialties/keys.ts` |
| Permission key | `"specialties.orthodontics"` | `src/lib/auth/permissions.ts` |
| Pricing MXN/mes | `329` | Marketplace `Module` |
| Icono sidebar | `Smile` (lucide-react) | `src/components/dashboard/sidebar.tsx` |
| Audit prefix | `"ORTHO"` | `AuditLog.action` |
| WhatsApp queue type | `'ORTHO'` | `whatsapp_reminders.type` |

### Paths del módulo

| Tipo | Path |
|------|------|
| Schema | `prisma/schema.prisma` |
| Migración | `prisma/migrations/YYYYMMDD_orthodontics_init/migration.sql` |
| Seed | `prisma/seeds/orthodontics-mock.ts` |
| Lib | `src/lib/orthodontics/` |
| Types | `src/lib/types/orthodontics.ts` |
| Validation | `src/lib/validation/orthodontics.ts` |
| Actions | `src/app/actions/orthodontics/` |
| Components | `src/components/specialties/orthodontics/` |
| Tab paciente | `src/app/dashboard/patients/[patientId]/orthodontics/page.tsx` |
| Vista clínica | `src/app/dashboard/specialties/orthodontics/page.tsx` |
| Vista per-paciente | `src/app/dashboard/specialties/orthodontics/[patientId]/page.tsx` |
| API context | `src/app/api/orthodontics/context/route.ts` |
| API photos upload | `src/app/api/orthodontics/photos/upload/route.ts` |
| API treatment plan PDF | `src/app/api/orthodontics/treatment-plans/[id]/treatment-plan-pdf/route.ts` |
| API financial agreement PDF | `src/app/api/orthodontics/payment-plans/[id]/financial-agreement-pdf/route.ts` |
| API progress report PDF | `src/app/api/orthodontics/treatment-plans/[id]/progress-report-pdf/route.ts` |
| API cron payment recalc | `src/app/api/cron/orthodontics/recalculate-payment-status/route.ts` |
| Vercel cron config | `vercel.json` |

### Comandos clave

```bash
git fetch origin
git log --oneline origin/feature/periodontics-module-v1 | head -3
git checkout -b feature/orthodontics-module-v1 origin/<branch-elegido>
npm run prisma:migrate:dev -- --name orthodontics_init
npx prisma generate
npm run build
npx tsx --test src/lib/orthodontics/__tests__/*.test.ts
npx tsx prisma/seeds/orthodontics-mock.ts
git push origin feature/orthodontics-module-v1
```

### Las 6 fases del tratamiento

| Fase | Duración típica | Color | Objetivo clínico |
|------|-----------------|-------|------------------|
| ALIGNMENT | 4-6 meses | `blue-500` | Alinear dientes, descruzar mordidas |
| LEVELING | 3-5 meses | `blue-500` | Nivelar arcadas |
| SPACE_CLOSURE | 4-8 meses | `blue-600` | Cerrar espacios de extracciones |
| DETAILS | 2-4 meses | `cyan-500` | Detallar oclusión |
| FINISHING | 1-2 meses | `emerald-500` | Acabados |
| RETENTION | 24-60 meses | `violet-500` | Mantener resultados |

### Status del plan de pagos

| Status | Definición | Color |
|--------|------------|-------|
| ON_TIME | Sin instalments vencidas | sin badge |
| LIGHT_DELAY | 1+ vencidas, ninguna >30d | `amber-500` |
| SEVERE_DELAY | 1+ vencidas >30d | `red-500` |
| PAID_IN_FULL | Todas pagadas o waived | `emerald-600` |

### Consentimientos por edad

| Edad | TREATMENT | MINOR_ASSENT | FINANCIAL | PHOTO_USE |
|------|-----------|--------------|-----------|-----------|
| <12 | Tutor | (no aplica) | Tutor | Tutor (opcional) |
| 12-17 | Tutor | El menor | Tutor | Tutor (opcional) |
| ≥18 | El paciente | (no aplica) | El paciente | El paciente (opcional) |

### Backdating de pagos

| `paidAt` vs `dueDate` | Acción |
|----------------------|--------|
| Dentro de `[dueDate - 60d, now()]` | Pasa sin justificación |
| Fuera de ese rango | Exige `BackdateJustificationModal` ≥20 chars + audit log |

### Validaciones críticas

| Campo | Validación |
|-------|------------|
| `OrthodonticDiagnosis.clinicalSummary` | ≥40 chars |
| `OrthodonticTreatmentPlan.estimatedDurationMonths` | 3-60 |
| `OrthodonticTreatmentPlan.totalCostMxn` | >0 |
| `OrthoPaymentPlan.installmentCount` | 1-60 |
| `OrthoPaymentPlan.paymentDayOfMonth` | 1-28 |
| `OrthoInstallment.amount` | >0 |
| Suma instalments + enganche | ≥ totalAmount (margen 1%) |
| Si `DROPPED_OUT` | `droppedOutReason` ≥20 chars |
| Backdating fuera rango | `backdatingJustification` ≥20 chars |
| Waiver | `waiverReason` ≥20 chars |

---

## 18. Notas finales

### Decisiones inamovibles

Las 25 decisiones de §1 + las 3 confirmaciones del Coordinator no se revaluan:
- 8 columnas tipadas en `OrthoPhotoSet`.
- Vercel Cron Jobs en lugar de pg_cron.
- `DigitalRecordType` enum en lugar de String.

### Reuso obligatorio

- `SignaturePad` (pediatría) — los 4 modales de consentimiento.
- Drawer, Modal, Section, RadioGroup, Toggle, NumberInput, Select, TextArea, DateInput, FileUpload, MultiSelect (design system).
- `recordAudit`, `getCurrentUser`, `getActiveClinicId`, `canAccessModule` (auth/audit).
- `useDebouncedCallback`, `useInterval` (hooks).
- `Result<T>`, `isFailure`, `isSuccess` (Server Action patterns).
- Patrón de barrel estricto (lección Periodoncia).
- Patrón de PDFs server-side `@react-pdf/renderer` + route handler (Implantología).

### Mobile cap

Mobile = lectura + captura de fotos en control mensual. Permite ver kanban, abrir card, ver historia financiera, tomar las 8 fotos del set. NO permite captura de diagnóstico, edición de plan/pagos, modificar consentimiento.

### Storage Supabase y sharp

`sharp` instalación verificar (`npm install sharp` si no está). `runtime: 'nodejs'` (NO edge). Bucket `patient-files`, path `{clinicId}/orthodontics/{patientId}/{photoSetId}-{view}.{ext}`. Original 2400×2400 jpeg q85 + thumbnail 300×300 webp.

### Persistencia de wizards

Los wizards no persisten draft state — recargar pierde el progreso. Excepción: PhotoSetWizard persiste cada foto inmediatamente al subir.

### Cron Vercel — defensa en capas

Cron diario es defensa principal pero NO la única:
1. `recalculatePaymentStatus` se invoca manualmente desde botón "Recalcular ahora" en PaymentPlanView (ADMIN/RECEPTIONIST).
2. Se dispara automáticamente tras `recordInstallmentPayment` para el plan tocado.

### Contratos con otros módulos

- **Pediatría:** si activa, Orto LEE PediatricProfile para menores. Si no, capta inline mínimos sin crear PediatricProfile.
- **Periodoncia:** NO contrato directo en MVP. Integración salud periodontal pre-orto es v1.1.
- **Sistema de cobros general:** NO se reutiliza. OrthoPaymentPlan dedicado (decisión §1.2).
- **Endodoncia/Implantología:** sin dependencia directa.

### Comparativo con módulos previos

| Aspecto | Pedi | Endo | Perio | Implant | Orto |
|---------|------|------|-------|---------|------|
| Modelos MVP | 5+ | 6+ | 7+ | 9 | 9 |
| Wizards | 1 | 2 | 1 | 2 | 4 |
| Sub-tabs | 3 | 2 | 2 | 3 | 5 |
| Vista clínica dedicada | No | No | No | Sí | Sí (kanban) |
| Compliance financiera | No | No | No | No | Sí |
| Mobile capture | Sí | No | No | No | Sí (solo fotos) |
| Triggers SQL críticos | No | No | No | Sí (COFEPRIS) | No (cron Vercel) |
| Diferenciador estrella | Pedo-friendly | Endograma | Periodontograma | Carnet | Kanban + plan pagos |

### Para el día del lanzamiento

1. Aplicar migración en Supabase Production.
2. Crear `Module` con `key="orthodontics"` y pricing $329 MXN/mes.
3. Activar `ClinicModule` para 1-2 clínicas piloto.
4. Configurar `CRON_SECRET` — Vercel lo gestiona, verificar presencia en Production.
5. Validar primer ejecución del cron desde dashboard de Vercel.
6. Demo end-to-end con paciente real (Andrea-style) en clínica piloto.
7. Monitoreo de audit log las primeras 48 hrs.

---

## 19. Prompt de implementación → BOT GIT 1

> Este es el prompt que se le pega a Bot Git 1 (Claude Code en terminal Windows) para iniciar la implementación. Asume que el SPEC.md ya está commiteado en `docs/marketplace/research/ortodoncia/SPEC.md`.

```
→ BOT GIT 1

Implementa el módulo Ortodoncia (5/5) de MediFlow siguiendo el SPEC en docs/marketplace/research/ortodoncia/SPEC.md. NO hagas push final hasta confirmar conmigo. Sí push tras cada fase.

DECISIÓN INICIAL — BRANCH BASE

1. Ejecuta:
   git fetch origin
   git log --oneline origin/feature/periodontics-module-v1 | head -3
   git log --oneline origin/feature/endodontics-module-v1 | head -3
   git log --oneline origin/main | head -5

2. Si Periodoncia (`feature/periodontics-module-v1`) ya está mergeada en main O tiene un `npm run build` verde reciente reportado por mí: usa esa como base.

3. Si no: usa `feature/endodontics-module-v1` como base.

4. Reporta tu decisión: "Base elegida: feature/X — razón: Y".

5. Crea la rama:
   git checkout -b feature/orthodontics-module-v1 origin/<branch-elegido>

VERIFICACIÓN DE STACK PARTICULAR

Antes de empezar la Fase 1, verifica si están instalados:
- react-pdf: si no, npm install react-pdf
- three + @types/three: si no, npm install three @types/three
- sharp: ya en repo (Implantología). Verifica con grep en package.json.
- @react-pdf/renderer: ya en repo (Implantología). Verifica.

Reporta qué instalaste antes de seguir.

LAS 10 FASES (en orden, cada una con npm run build verde + push antes de la siguiente)

FASE 1 — Schema + migración
- 9 modelos MVP (OrthodonticDiagnosis, OrthodonticTreatmentPlan, OrthodonticPhase, OrthoPaymentPlan, OrthoInstallment, OrthoPhotoSet, OrthodonticControlAppointment, OrthodonticDigitalRecord, OrthodonticConsent).
- 14 enums (incluye DigitalRecordType { CEPH_ANALYSIS_PDF, SCAN_STL }).
- 6 modelos v1.1 documentados con TODO sin lógica.
- Relaciones inversas en Patient, Clinic, User, PatientFile.
- Migración SQL con CHECK constraints + RLS multi-tenant + índice idx_ortho_kanban_lookup.
- Trigger recalc_payment_plan_status (recalcula paidAmount/pendingAmount/status del plan en INSERT/UPDATE de OrthoInstallment).
- NO crear trigger auto_overdue_installments — esa lógica vive en cron Vercel (Fase 8).
- prisma:migrate:dev local + prisma generate.
- npm run build verde + git push.
- Reporta a mí cuando termines.

FASE 2 — Tipos + helpers + zod + textos legales
- src/lib/types/orthodontics.ts (re-exports de Prisma + tipos derivados como OrthoKanbanCard).
- 5 helpers en src/lib/orthodontics/ con tests unitarios:
  · phase-machine.ts (transiciones lineales válidas)
  · payment-status.ts (ON_TIME/LIGHT/SEVERE/PAID_IN_FULL con regla 1-30 días LIGHT, >30 SEVERE)
  · photo-set-helpers.ts (validación 8 vistas, ordenamiento, pareo cross-set)
  · compliance-helpers.ts (último 3 controles)
  · kanban-helpers.ts (agrupamiento + cap 50 por columna)
- Schemas zod para 15 actions en src/lib/validation/orthodontics.ts.
- src/lib/orthodontics/whatsapp-templates.ts (7 plantillas §8.7).
- src/lib/orthodontics/consent-texts.ts con los 4 textos LITERALES de §10.4-§10.7. NO modificar el wording.
- src/lib/specialties/keys.ts agregar ORTHODONTICS_MODULE_KEY = 'orthodontics'.
- npm run build verde + push.

FASE 3 — Server actions (15)
- 15 archivos en src/app/actions/orthodontics/, cada uno con 'use server' en primera línea.
- Patrón estricto §2: getCurrentUser → getActiveClinicId → canAccessModule → safeParse → transacción → recordAudit → revalidatePath.
- recordInstallmentPayment valida backdating ±60d + justificación ≥20 chars si fuera de rango.
- recalculatePaymentStatus idempotente.
- advanceTreatmentPhase valida transición contra phase-machine.ts.
- _helpers.ts con helpers internos (NUNCA en barrel).
- result.ts y audit-actions.ts con tipos/constantes (importados directo, no del barrel).
- index.ts barrel ESTRICTO: SOLO reexporta archivos cuya primer línea es 'use server'. Comentario explícito en el archivo.
- npm run build verde + push.

FASE 4 — Componentes núcleo + kanban
- OrthoKanbanBoard + OrthoKanbanColumn + OrthoPatientCard + OrthoKanbanFilters + PaymentDelayWidget + ComplianceFilter.
- OrthodonticsTab + OrthoSubTabs (5 sub-tabs).
- DiagnosisView, TreatmentPlanView, PhaseTimeline, PhotoSetGrid, PhotoCompareSlider, ControlsList, ComplianceTracker, PaymentPlanView, InstallmentList, PaymentStatusBadge, DigitalRecordsPanel.
- PdfViewer y STLViewer3D con `dynamic(() => import(...), { ssr: false })`.
- PediatricProfileBanner + OrthoStageBadge.
- EmptyState con CTA "+ Iniciar diagnóstico".
- PROHIBIDO localStorage, sessionStorage o cualquier API de browser storage. Usa React state.
- npm run build verde + push.

FASE 5 — Wizards + drawers + modales
- DiagnosisWizard 4 pasos (modal full-screen 80vw).
- TreatmentPlanWizard 3 pasos.
- PhotoSetWizard 8 vistas guiadas con upload por foto.
- PhotoCaptureMobile (mobile-first fullscreen, una vista a la vez).
- ControlAppointmentWizard 3 pasos.
- RecordPaymentDrawer (480px derecho) + BackdateJustificationModal con contador en vivo (rojo <20, verde ≥20).
- 4 modales de consentimiento full-screen con SignaturePad reusada de pediatría:
  · TreatmentConsentModal (texto §10.4)
  · FinancialAgreementModal (texto §10.5 + tabla mensualidades)
  · MinorAssentModal (solo si paciente ≥12 y <18, texto §10.6)
  · PhotoUseConsentModal (checkboxes opcionales por uso, texto §10.7)
- npm run build verde + push.

FASE 6 — Páginas + sidebar + permission
- /dashboard/specialties/orthodontics/page.tsx (kanban a nivel clínica).
- /dashboard/specialties/orthodontics/[patientId]/page.tsx.
- /dashboard/patients/[patientId]/orthodontics/page.tsx (tab paciente).
- Icono Smile en sidebar grupo "Especialidades" (lucide-react).
- Permission key 'specialties.orthodontics' en src/lib/auth/permissions.ts.
- npm run build verde + push.

FASE 7 — PDFs (3)
- src/lib/orthodontics/pdf-templates/treatment-plan.tsx (A4 vertical, 4 páginas).
- src/lib/orthodontics/pdf-templates/financial-agreement.tsx (A4 vertical, firmable, tabla pre-poblada de mensualidades).
- src/lib/orthodontics/pdf-templates/progress-report.tsx (A4 horizontal, comparativo T0/T2 grid 2×4).
- 3 route handlers en src/app/api/orthodontics/.../route.ts con renderToBuffer + Content-Type: application/pdf + maxDuration: 60.
- runtime nodejs (NO edge). Imágenes vía signed URLs Supabase.
- npm run build verde + push.

FASE 8 — Integraciones cruzadas
- vercel.json con cron schedule "0 7 * * *".
- /api/cron/orthodontics/recalculate-payment-status/route.ts con header Authorization: Bearer ${process.env.CRON_SECRET}.
- 9 duraciones de cita en agenda (ver §8.2).
- Pre-fill SOAP por mes (§8.3).
- TreatmentPlan general con sub-ítems por fase (§8.4).
- Badge brackets/alineadores en odontograma compartido (§8.5).
- 3 plantillas receta NOM-024 (§8.6).
- 7 templates WhatsApp encolados type='ORTHO' (§8.7).
- Endpoint /api/orthodontics/context (§8.10).
- Storage Supabase con sharp (2400×2400 jpeg q85 + 300×300 webp).
- Audit log con todas las acciones especiales (§8.8).
- npm run build verde + push.

FASE 9 — Mock data + tests
- prisma/seeds/orthodontics-mock.ts con Andrea + Sofía + Mauricio (script literal de §12).
- Tests unitarios de los 5 helpers.
- Playwright E2E con los 5 flujos críticos (§13.2).
- Tests RLS multi-tenant (§13.3).
- Tests financieros incluyendo backdating + waiver + sobrepago (§13.5).
- Tests del cron Vercel (§13.6).
- Snapshots Storybook (§13.4).
- Test performance kanban con 200 pacientes <300ms.
- npm run build verde + push.

FASE 10 — QA + lanzamiento (NO PUSH FINAL hasta confirmar conmigo)
- Aplicar migración SQL en Supabase Production manualmente.
- Crear Module marketplace con key="orthodontics" pricing $329 MXN/mes.
- Activar ClinicModule para clínica QA.
- Configurar CRON_SECRET en Vercel env vars (Production).
- Validar primer ejecución del cron desde dashboard de Vercel.
- Demo end-to-end con seed de Andrea.
- Reporta a mí con resumen estilo Bot Git 3 de Implantología:
  · Branch base elegida y por qué.
  · Paquetes instalados.
  · Resumen por fase con commits y notas relevantes.
  · Decisiones unilaterales que tomaste (si algo del SPEC fue ambiguo).
  · Tests pasando vs skip vs fallo.
  · Bloqueos pendientes para QA con ortodoncista.

REGLAS INNEGOCIABLES

1. Cada fase termina con `npm run build` verde (NO `tsc --noEmit`) + git push antes de la siguiente. Lección aprendida en Periodoncia/Implant: tsc no detecta errores de bundle cliente/servidor.
2. Barrel estricto en _actions/index.ts: SOLO reexporta archivos 'use server'. _helpers.ts, result.ts, audit-actions.ts NUNCA en barrel. Componentes cliente importan directamente del archivo.
3. Backdating de pagos: paidAt en `[dueDate - 60d, now()]` pasa sin justificación. Fuera de rango exige BackdateJustificationModal con texto ≥20 chars + audit log con la justificación.
4. Consentimiento de menor: MinorAssentModal aparece solo si patient.age >= 12 AND < 18. Por debajo de 12 se omite (solo firma tutor). Igual o mayor a 18 también se omite.
5. Storage de fotos: server-side con sharp (jpeg q85 2400×2400 + webp 300×300 thumbnail). Bucket patient-files. Path {clinicId}/orthodontics/{patientId}/{photoSetId}-{view}.{ext}. Runtime nodejs.
6. PDFs: server-side con @react-pdf/renderer + renderToBuffer + Content-Type: application/pdf. Patrón idéntico a Implantología (/api/implants/[id]/passport/route.ts).
7. Cron: Vercel Cron Jobs (NO pg_cron). Endpoint con header Authorization: Bearer ${CRON_SECRET}. Schedule "0 7 * * *" en vercel.json.
8. Idioma de UI: español neutro mexicano. NUNCA argentino. Tú, no vos. Gender enum: M | F | OTHER.
9. PROHIBIDO localStorage/sessionStorage. Solo React state. Para tema (light/dark) usar cookie + atributo data-theme en html, NO localStorage.
10. NO inventes paquetes. Solo: react-pdf, three + @types/three, sharp (verifica), @react-pdf/renderer (verifica). Todo lo demás ya en repo.

CONTRATO CON OTROS MÓDULOS

- Pediatría: si activa en clínica, LEE PediatricProfile para menores (banner sugerencia + auto-fill hábitos). Si no activa, capta inline mínimos sin crear PediatricProfile.
- Cobros general: NO se reutiliza. OrthoPaymentPlan dedicado.
- Endodoncia/Periodoncia/Implantología: sin dependencia directa.

REPORTE DE PROGRESO

Tras cada fase, reporta:
- Fase N completa.
- Commits creados (hash + mensaje).
- Tests pasando / skip / fallo.
- npm run build status.
- Decisiones unilaterales (si las hubo).
- Bloqueos antes de pasar a la siguiente fase.

Arranca con la decisión de branch base + verificación de paquetes + Fase 1.
```

---

**FIN DEL SPEC.**

Total: 19 secciones. Asume conocimiento del repo MediFlow y los 4 módulos previos.
