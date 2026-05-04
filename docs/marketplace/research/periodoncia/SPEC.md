# SPEC — Módulo Periodoncia (MediFlow 3/5)

> **Estado:** listo para implementación por Bot Git 1.
> **Posición:** módulo 3 de 5 del marketplace de especialidades. Pediatría (1/5) y Endodoncia (2/5) ya en producción.
> **Owner técnico:** Rafael Salazar.
> **Última revisión:** mayo 2026.

---

## 0. Resumen ejecutivo

Periodoncia es el módulo más denso de UI de toda la suite MediFlow. La pieza central es el **periodontograma 6×32 = 192 sitios** que se captura completo en cada sondaje. Los PMS mexicanos no tienen ningún periodontograma usable en español; Florida Probe (gold standard US) cuesta más de 3 000 USD y es inglés-only. El diferenciador real está en cuatro cosas que MediFlow va a resolver:

1. **Captura ultrarrápida** — manual con teclado en MVP (formato `PD-REC` + Tab automático + atajos de espacio/P/S), voz en v1.1 (Web Speech API), tablet con keypad numérico para asistente.
2. **Clasificación 2017 AAP/EFP automática** — estadio I-IV + grado A-C + extensión + modificadores (tabaco, HbA1c). El doctor puede sobrescribir con justificación.
3. **Comparativos pre/post visuales** — overlay y lado a lado de hasta 4 periodontogramas para validación clínica de Fase 2 → Fase 3.
4. **Tracking de mantenimientos personalizados por riesgo** — Berna Risk Assessment (Lang & Tonetti) determina intervalo (3 / 4 / 6 meses) y dispara recordatorios WhatsApp + widget de "vencidos" en dashboard general.

Reutiliza al 100% los tokens dark-mode, PatientHeader, sidebar, SignaturePad, Server Actions, audit log, recordatorios WhatsApp y patrón de Drawer ya consolidados en Pediatría y Endodoncia.

**Mobile:** lectura únicamente. La captura del periodontograma exige tablet/desktop (densidad de 192 sitios la hace inviable en celular). El sondaje siempre se hace en consultorio con tablet — es justificable.

**Modelos nuevos:** 8 (`PeriodontalRecord`, `PeriodontalClassification`, `GingivalRecession`, `PeriodontalTreatmentPlan`, `SRPSession`, `PeriodontalReevaluation`, `PeriodontalRiskAssessment`, `PeriodontalSurgery`, `PeriImplantAssessment`).

**Server actions:** 16 mutaciones clínicas, todas con audit log obligatorio.

---

## 1. Decisiones bloqueadas (NO revaluar)

| # | Decisión | Justificación |
|---|----------|---------------|
| 1.1 | Tab "Periodoncia" en patient-detail con sub-tabs internos: **Resumen, Periodontograma, Plan, Cirugías, Mantenimientos** | Periodontograma es lo suficientemente denso para tener su propio sub-tab |
| 1.2 | Página dedicada `/dashboard/specialties/periodontics` con index (lista + dashboard mantenimientos vencidos) y `[patientId]` | Utilidad operativa real para recepcionista |
| 1.3 | Captura del periodontograma **INLINE** en la misma vista. NO drawer, NO modal, NO wizard | El doctor ve los 192 sitios al mismo tiempo y tap/teclea sobre cada uno |
| 1.4 | Drawer solo para edición de detalle por diente (movilidad, furca, recesión avanzada) | Mantiene la vista principal limpia para sondaje rápido |
| 1.5 | Modal full-screen solo para consentimientos (SRP, cirugía periodontal) | Reuso del SignaturePad de pediatría |
| 1.6 | 3 métodos de captura: manual teclado (MVP), voz (v1.1), tablet keypad (v1.1) | Manual cubre 100% de los flujos en MVP |
| 1.7 | Layout del periodontograma: arcadas superior arriba e inferior abajo (FDI 18→11→21→28 / 48→41→31→38), 32 columnas | Disposición FDI estándar internacional |
| 1.8 | Cada columna: fila vestibular arriba (3 mini-celdas MV/MB/DV), diente al centro con FDI debajo, fila lingual abajo (3 mini-celdas DL/ML/MB_palatino) | Replica el flujo del sondaje real |
| 1.9 | Color de cada celda según severidad de PD: verde 1-3mm, amarillo 4-5mm, rojo ≥6mm | Estándar clínico universal |
| 1.10 | Indicadores en VIVO arriba (BoP%, Plaque Index, distribución bolsas, dientes con bolsas ≥5mm) calculados conforme se captura | Feedback inmediato al doctor |
| 1.11 | Clasificación 2017 AAP/EFP **automática** en footer permanente. Sobrescribible con justificación | Diferenciador clave vs competencia |
| 1.12 | Recesiones gingivales: clasificación **Cairo 2018 (RT1, RT2, RT3)**. NO Miller 1985 | Consenso World Workshop 2017 reemplazó Miller |
| 1.13 | Sonda de referencia para captura digital: **UNC-15** (marcas cada milímetro). NO Williams | Más precisa para captura digital |
| 1.14 | Plan de tratamiento por **4 fases** (consenso EFP 2020): Causal → Subgingival/SRP → Quirúrgica → Mantenimiento | Estándar global |
| 1.15 | Riesgo periodontal por **Berna Risk Assessment (Lang & Tonetti)**: bajo → 6m, moderado → 4m, alto → 3m | Evidencia clínica sólida |
| 1.16 | **NO crear modelo Radiography**. Reutilizar `PatientFile` con `FileCategory` (XRAY_PERIAPICAL/PANORAMIC/BITEWING/OCCLUSAL). `intraoperativeFileId` en `PeriodontalSurgery` (FK a `PatientFile`) | Mismo patrón que endodoncia, consistencia |
| 1.17 | `PeriImplantAssessment` SE INCLUYE en MVP con `implantId: String?` nullable (sin FK al módulo Implantología que aún no existe). Migración futura agregará FK real | Evita romper trazabilidad clínica para clínicas con implantes ya colocados |
| 1.18 | **Mobile = SOLO LECTURA** del periodontograma. Captura solo en tablet/desktop | Densidad de 192 sitios inviable en celular |
| 1.19 | Comparativo pre/post: lado a lado por defecto, overlay con slider on-demand | Análisis cuidadoso vs presentación al paciente |
| 1.20 | Widget "Mantenimientos vencidos" en dashboard general, filtrable por riesgo | Utilidad operativa, no estética |
| 1.21 | Icono de la especialidad en sidebar: `Activity` de lucide-react | Diferenciado de pediatría (`Baby`) y endodoncia (`Zap`) |
| 1.22 | Valores del enum `Gender`: `M | F | OTHER` (NO `MALE/FEMALE`) | Coincide con repo existente |

---

## 2. Stack y convenciones (heredadas)

- **Framework:** Next.js 14 App Router.
- **Lenguaje:** TypeScript estricto. `noImplicitAny`, `strictNullChecks`.
- **Estilos:** Tailwind CSS con tokens dark-mode existentes (`--text-1`, `--text-2`, `--text-3`, `--bg-base`, `--bg-elev`, `--bg-elev-2`, `--brand`, `--brand-soft`, `--border-soft`, `--success`, `--warning`, `--danger`, `--info`).
- **Iconos:** `lucide-react`. Icono de la especialidad: `Activity`.
- **Notificaciones:** `react-hot-toast` (ya configurado en root).
- **Charts:** `recharts` (gráficos de evolución BoP%/Plaque Index).
- **ORM:** Prisma 5.22 + Supabase (Postgres 15).
- **Multi-tenant:** todo modelo nuevo lleva `clinicId String` con índice. RLS activa en Supabase.
- **Audit log:** obligatorio en TODA mutación clínica. Tabla `AuditLog` ya existe; reuso del helper `recordAudit`.
- **Soft delete:** todos los modelos nuevos tienen `deletedAt DateTime?`. Nunca hard delete.
- **Compliance:** NOM-024-SSA3-2012 (expediente clínico — conservación 5 años) + LFPDPPP (consentimiento explícito para compartir con médico tratante).
- **Idioma de UI:** español neutro mexicano. NUNCA argentino. `agrega/prueba/verifica`, NO `agregá/probá/verificá`. Tú, NO vos.
- **Sin emojis en UI clínica.** Iconos lucide o nada.

### Convenciones de servidor (heredadas de pediatría y endodoncia)

```ts
// Patrón estándar de Server Action
'use server';

export async function someAction(input: Input): Promise<Result<Data>> {
  // 1. Auth + tenant
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'UNAUTHENTICATED' };
  const clinicId = await getActiveClinicId();
  if (!clinicId) return { ok: false, error: 'NO_CLINIC_CONTEXT' };

  // 2. Permiso al módulo
  if (!(await canAccessModule(user.id, clinicId, PERIODONTICS_MODULE_KEY))) {
    return { ok: false, error: 'FORBIDDEN_MODULE' };
  }

  // 3. Validación zod
  const parsed = SomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION', issues: parsed.error.issues };

  // 4. Transacción + audit
  const result = await prisma.$transaction(async (tx) => {
    const before = /* snapshot si es update */;
    const data = await tx.someModel.create/update/delete(...);
    await recordAudit(tx, {
      userId: user.id, clinicId,
      entity: 'PeriodontalRecord', entityId: data.id,
      action: 'CREATE' | 'UPDATE' | 'DELETE',
      before, after: data,
    });
    return data;
  });

  // 5. Revalidate
  revalidatePath(`/dashboard/patients/${input.patientId}`);

  return { ok: true, data: result };
}
```

Resultado de cualquier action es discriminated union:

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: ZodIssue[] };
```

Helper `isFailure(r): r is { ok: false; ... }` ya existe.

### Constante del módulo

```ts
// src/lib/specialties/keys.ts (ya existe)
export const PERIODONTICS_MODULE_KEY = 'periodontics' as const;
```

---

## 3. Estructura de archivos

```
src/
├── app/dashboard/
│   ├── patients/[patientId]/
│   │   └── periodontics/
│   │       ├── page.tsx                          # Tab principal con sub-tabs
│   │       ├── _components/
│   │       │   ├── PeriodonticsTab.tsx
│   │       │   ├── PerioSubTabs.tsx              # Resumen | Periodontograma | Plan | Cirugías | Mant.
│   │       │   ├── ResumenTab.tsx
│   │       │   ├── PeriodontogramaTab.tsx
│   │       │   ├── PlanTab.tsx
│   │       │   ├── CirugiasTab.tsx
│   │       │   └── MantenimientosTab.tsx
│   │       ├── periodontogram/
│   │       │   ├── PeriodontogramGrid.tsx        # 6×32 — núcleo
│   │       │   ├── ToothColumn.tsx               # columna por diente (3 vest + diente + 3 ling)
│   │       │   ├── SiteCell.tsx                  # celda de sitio individual (PD/REC/BoP/Placa/Sup)
│   │       │   ├── ToothCenter.tsx               # ilustración del diente con FDI
│   │       │   ├── LiveIndicators.tsx            # BoP%, Plaque, distribución (header del grid)
│   │       │   ├── ClassificationFooter.tsx      # Estadio + Grado + Extensión calculados
│   │       │   ├── KeyboardCaptureLayer.tsx      # listener de teclado para PD-REC, Tab, espacio, P, S
│   │       │   ├── VoiceCaptureLayer.tsx         # v1.1 — Web Speech API
│   │       │   ├── ToothDetailDrawer.tsx         # movilidad, furca, recesión avanzada
│   │       │   └── PeriodontogramSidebar.tsx     # historial de periodontogramas previos
│   │       ├── plan/
│   │       │   ├── PhaseProgress.tsx             # 4 fases con check
│   │       │   ├── QuadrantMap.tsx               # Q1-Q4 SRP visual
│   │       │   └── PlanTimeline.tsx
│   │       ├── surgery/
│   │       │   ├── SurgeryList.tsx
│   │       │   ├── SurgeryDrawer.tsx
│   │       │   └── BeforeAfterCompare.tsx
│   │       ├── maintenance/
│   │       │   ├── MaintenanceTable.tsx
│   │       │   ├── BoPTrendChart.tsx
│   │       │   └── RiskBadge.tsx
│   │       ├── recession/
│   │       │   └── RecessionDrawer.tsx
│   │       ├── consent/
│   │       │   ├── SRPConsentModal.tsx
│   │       │   └── SurgeryConsentModal.tsx
│   │       ├── compare/
│   │       │   ├── PrePostCompare.tsx            # lado a lado
│   │       │   └── PrePostOverlay.tsx            # overlay con slider
│   │       └── _actions/
│   │           ├── createPeriodontalRecord.ts
│   │           ├── updatePeriodontalRecord.ts
│   │           ├── upsertSiteData.ts             # mutación granular por sitio (autosave)
│   │           ├── upsertToothData.ts            # mutación granular por diente
│   │           ├── classifyPatient.ts            # clasificación 2017
│   │           ├── overrideClassification.ts
│   │           ├── createGingivalRecession.ts
│   │           ├── updateGingivalRecession.ts
│   │           ├── createTreatmentPlan.ts
│   │           ├── advancePhase.ts
│   │           ├── createSRPSession.ts
│   │           ├── createReevaluation.ts
│   │           ├── createRiskAssessment.ts
│   │           ├── createPeriodontalSurgery.ts
│   │           ├── createPeriImplantAssessment.ts
│   │           └── exportPerioReportPdf.ts
│   └── specialties/
│       └── periodontics/
│           ├── page.tsx                          # Lista + dashboard mantenimientos vencidos
│           ├── [patientId]/
│           │   └── page.tsx                      # Vista por paciente desde la página dedicada
│           └── _components/
│               ├── OverdueMaintenanceWidget.tsx
│               ├── PerioPatientList.tsx
│               └── RiskDistributionChart.tsx
├── lib/
│   └── periodontics/
│       ├── classification-2017.ts                # algoritmo de cálculo automático
│       ├── risk-berna.ts                         # Lang & Tonetti
│       ├── site-helpers.ts                       # mapeo sitios, orden de captura
│       ├── periodontogram-math.ts                # CAL = PD + REC, BoP%, Plaque, distribución
│       ├── cairo-classification.ts               # validación RT1/RT2/RT3
│       ├── keyboard-shortcuts.ts                 # parser "5-2", Tab logic
│       ├── voice-parser.ts                       # v1.1
│       ├── pdf-templates/
│       │   ├── perio-report.tsx                  # informe paciente
│       │   ├── perio-medico-tratante.tsx         # informe legal
│       │   └── pre-post-compare.tsx              # comparativo PDF
│       └── whatsapp-templates.ts
├── components/
│   └── ui/
│       └── (componentes compartidos ya existentes — Drawer, Modal, SignaturePad, etc.)
└── prisma/
    ├── schema.prisma                              # +8 modelos +12 enums
    ├── migrations/
    │   └── 2026_05_periodontics_init/
    │       └── migration.sql
    └── seeds/
        └── periodontics-mock.ts                  # 3 pacientes (María, Juan, Carmen)

public/
└── (sin SVGs anatómicas nuevas — el periodontograma se dibuja inline en SVG dentro de ToothCenter.tsx con dispatching por tipo de diente vía un helper en site-helpers.ts)
```

---

## 4. Modelo de datos (Prisma)

### 4.1 Enums

```prisma
enum PeriodontalRecordType {
  INICIAL
  PRE_TRATAMIENTO
  POST_FASE_1
  POST_FASE_2
  MANTENIMIENTO
  CIRUGIA_PRE
  CIRUGIA_POST
}

enum SitePosition {
  MV   // mesiovestibular
  MB   // mediovestibular (antes "media-bucal")
  DV   // distovestibular
  DL   // distolingual / distopalatino
  ML   // mediolingual / mediopalatino
  MB_PAL // mesiolingual / mesiopalatino
}

enum PeriodontalStage {
  SALUD
  GINGIVITIS
  STAGE_I
  STAGE_II
  STAGE_III
  STAGE_IV
}

enum PeriodontalGrade {
  GRADE_A   // < 0.25 ratio %BL/edad — lenta
  GRADE_B   // 0.25 – 1.0 — moderada
  GRADE_C   // > 1.0 — rápida
}

enum PeriodontalExtension {
  LOCALIZADA          // < 30% de dientes
  GENERALIZADA        // ≥ 30% de dientes
  PATRON_MOLAR_INCISIVO
}

enum CairoClassification {
  RT1   // sin pérdida interproximal
  RT2   // pérdida interproximal ≤ vestibular
  RT3   // pérdida interproximal > vestibular
}

enum GingivalPhenotype {
  DELGADO
  GRUESO
}

enum PeriodontalPhase {
  PHASE_1   // causal/higiénica
  PHASE_2   // subgingival/SRP
  PHASE_3   // quirúrgica
  PHASE_4   // mantenimiento
}

enum SRPTechnique {
  SRP_CUADRANTE
  FULL_MOUTH_DISINFECTION
  FULL_MOUTH_SCALING
}

enum SRPInstrumentation {
  MANUAL
  ULTRASONICO
  COMBINADO
}

enum SmokingStatus {
  NO
  MENOR_10        // < 10 cig/día
  MAYOR_O_IGUAL_10  // ≥ 10 cig/día — sube grado
}

enum PeriodontalRiskCategory {
  BAJO        // → recall 6m
  MODERADO    // → recall 4m
  ALTO        // → recall 3m
}

enum PeriodontalSurgeryType {
  COLGAJO_ACCESO
  GINGIVECTOMIA
  RESECTIVA_OSEA
  RTG                       // regeneración tisular guiada
  INJERTO_GINGIVAL_LIBRE
  INJERTO_TEJIDO_CONECTIVO
  TUNELIZACION
  CORONALLY_ADVANCED_FLAP
  OTRO
}

enum PeriImplantStatus {
  SALUD
  MUCOSITIS
  PERIIMPLANTITIS_INICIAL
  PERIIMPLANTITIS_MODERADA
  PERIIMPLANTITIS_AVANZADA
}

enum GingivitisType {
  SALUD_INTACTO
  SALUD_REDUCIDO_ESTABLE       // ex-paciente periodontal estabilizado
  GINGIVITIS_INDUCIDA_PLACA
  GINGIVITIS_NO_INDUCIDA_PLACA
  PERIODONTITIS               // ya pasa a clasificación 2017 estadio
}
```

### 4.2 Modelos

#### `PeriodontalRecord` — el sondaje completo

```prisma
model PeriodontalRecord {
  id          String                 @id @default(cuid())
  patientId   String
  clinicId    String
  doctorId    String
  recordedAt  DateTime               @default(now())
  recordType  PeriodontalRecordType

  // 192 sitios capturados (6 × 32). JSON denso para evitar tabla pesada.
  // Estructura: Array<{ fdi:number, position:SitePosition, pdMm:number, recMm:number, bop:bool, plaque:bool, suppuration:bool }>
  sites       Json

  // 32 dientes con datos a nivel diente
  // Estructura: Array<{ fdi:number, mobility:0|1|2|3, furcation:0|1|2|3, absent:bool, isImplant:bool }>
  toothLevel  Json

  // Calculados por trigger en server action
  bopPercentage         Float?
  plaqueIndexOleary     Float?
  sites1to3mm           Int?
  sites4to5mm           Int?
  sites6PlusMm          Int?
  teethWithPockets5Plus Int?

  // Clasificación 2017 (relación 1:1)
  classification  PeriodontalClassification?

  notes             String?
  durationMinutes   Int?

  // Comparación
  comparedToRecordId String?
  comparedToRecord   PeriodontalRecord? @relation("PerioCompare", fields: [comparedToRecordId], references: [id])
  derivedRecords     PeriodontalRecord[] @relation("PerioCompare")

  // Soft delete + audit
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  deletedAt   DateTime?

  patient     Patient    @relation(fields: [patientId], references: [id])
  clinic      Clinic     @relation(fields: [clinicId], references: [id])
  doctor      User       @relation(fields: [doctorId], references: [id])

  reevaluationsAsInitial PeriodontalReevaluation[] @relation("ReevalInitial")
  reevaluationsAsPost    PeriodontalReevaluation[] @relation("ReevalPost")

  @@index([patientId, recordedAt(sort: Desc)])
  @@index([clinicId, recordedAt(sort: Desc)])
  @@index([clinicId, deletedAt])
}
```

#### `PeriodontalClassification` — Estadio + Grado + Extensión 2017

```prisma
model PeriodontalClassification {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  periodontalRecordId String @unique
  periodontalRecord   PeriodontalRecord @relation(fields: [periodontalRecordId], references: [id])

  stage      PeriodontalStage
  grade      PeriodontalGrade?       // null si stage = SALUD o GINGIVITIS
  extension  PeriodontalExtension?   // null si stage = SALUD o GINGIVITIS

  // Modificadores que ajustan el grado:
  // { smokingCigsPerDay:number?, hba1c:number?, otherFactors:string[] }
  modifiers  Json

  // Campos de soporte al cálculo automático (auditables)
  // { maxCalInterproximalMm, maxBoneLossPct, maxPdMm, lostTeethPerio, complexityFactors:string[], boneLossAgeRatio }
  computationInputs Json

  calculatedAutomatically Boolean
  overriddenByDoctor      Boolean  @default(false)
  justification           String?  // requerido si overriddenByDoctor

  classifiedAt   DateTime @default(now())
  classifiedById String
  classifiedBy   User     @relation(fields: [classifiedById], references: [id])

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
  clinic  Clinic  @relation(fields: [clinicId], references: [id])

  @@index([patientId, classifiedAt(sort: Desc)])
  @@index([clinicId])
}
```

#### `GingivalRecession` — Cairo 2018

```prisma
model GingivalRecession {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  toothFdi         Int
  surface          String              // 'vestibular' | 'lingual'
  recessionHeightMm Float
  recessionWidthMm  Float
  keratinizedTissueMm Float

  cairoClassification CairoClassification
  gingivalPhenotype   GingivalPhenotype

  recordedAt   DateTime  @default(now())
  recordedById String
  recordedBy   User      @relation(fields: [recordedById], references: [id])

  notes      String?
  resolvedAt DateTime?  // si se hizo cirugía mucogingival exitosa

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
  clinic  Clinic  @relation(fields: [clinicId], references: [id])

  @@index([patientId, toothFdi])
  @@index([clinicId, recordedAt(sort: Desc)])
}
```

#### `PeriodontalTreatmentPlan`

```prisma
model PeriodontalTreatmentPlan {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  currentPhase  PeriodontalPhase

  phase1StartedAt   DateTime?
  phase1CompletedAt DateTime?
  phase2StartedAt   DateTime?
  phase2CompletedAt DateTime?
  phase3StartedAt   DateTime?
  phase3CompletedAt DateTime?
  phase4StartedAt   DateTime?  // mantenimiento ongoing — sin completedAt

  nextEvaluationAt DateTime?

  planNotes        String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  patient   Patient   @relation(fields: [patientId], references: [id])
  clinic    Clinic    @relation(fields: [clinicId], references: [id])
  srpSessions SRPSession[]
  reevaluations PeriodontalReevaluation[]
  surgeries   PeriodontalSurgery[]

  @@index([patientId])
  @@index([clinicId, currentPhase])
  @@index([nextEvaluationAt])
}
```

#### `SRPSession`

```prisma
model SRPSession {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  planId    String
  plan      PeriodontalTreatmentPlan @relation(fields: [planId], references: [id])

  performedAt DateTime  @default(now())
  doctorId    String
  doctor      User      @relation(fields: [doctorId], references: [id])

  technique        SRPTechnique
  instrumentation  SRPInstrumentation
  // { Q1: { completed:bool, completedAt:Date|null, notes:string? }, Q2:..., Q3:..., Q4:... }
  quadrantsCompleted Json

  anesthesiaUsed  Boolean  @default(false)
  anesthesiaType  String?  // "Lidocaína 2% c/epinefrina 1:80,000"
  durationMinutes Int?

  observations String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
  clinic  Clinic  @relation(fields: [clinicId], references: [id])

  @@index([patientId, performedAt(sort: Desc)])
  @@index([clinicId])
  @@index([planId])
}
```

#### `PeriodontalReevaluation`

```prisma
model PeriodontalReevaluation {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  planId   String
  plan     PeriodontalTreatmentPlan @relation(fields: [planId], references: [id])

  initialRecordId String
  initialRecord   PeriodontalRecord @relation("ReevalInitial", fields: [initialRecordId], references: [id])

  postRecordId String
  postRecord   PeriodontalRecord @relation("ReevalPost", fields: [postRecordId], references: [id])

  bopImprovementPct        Float
  pdAverageImprovementMm   Float
  // [ { fdi:number, position:SitePosition, pdMm:number, bop:true } ]
  residualSites            Json
  // [ fdi:number ]
  surgicalCandidatesTeeth  Json

  evaluatedAt   DateTime @default(now())
  evaluatedById String
  evaluatedBy   User     @relation(fields: [evaluatedById], references: [id])

  recommendation String?    // texto libre del doctor

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
  clinic  Clinic  @relation(fields: [clinicId], references: [id])

  @@index([patientId, evaluatedAt(sort: Desc)])
  @@index([clinicId])
}
```

#### `PeriodontalRiskAssessment` (Berna)

```prisma
model PeriodontalRiskAssessment {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  evaluatedAt DateTime @default(now())

  bopPct                Float
  residualSites5Plus    Int
  lostTeethPerio        Int
  boneLossAgeRatio      Float?
  smokingStatus         SmokingStatus
  hba1c                 Float?

  riskCategory                PeriodontalRiskCategory
  recommendedRecallMonths     Int      // 3 | 4 | 6

  evaluatedById String
  evaluatedBy   User     @relation(fields: [evaluatedById], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
  clinic  Clinic  @relation(fields: [clinicId], references: [id])

  @@index([patientId, evaluatedAt(sort: Desc)])
  @@index([clinicId, riskCategory])
}
```

#### `PeriodontalSurgery`

```prisma
model PeriodontalSurgery {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  planId    String?
  plan      PeriodontalTreatmentPlan? @relation(fields: [planId], references: [id])

  surgeryType  PeriodontalSurgeryType

  // [ { fdi:number, sites:SitePosition[]? } ]
  treatedSites Json

  // { membrane:string?, boneGraft:string?, connectiveTissue:string?, growthFactor:string?, otros:string[] }
  biomaterials Json?

  sutureType String?

  surgeryDate DateTime
  doctorId    String
  doctor      User       @relation(fields: [doctorId], references: [id])

  sutureRemovalDate    DateTime?
  postOpComplications  String?

  // Reuso de PatientFile (NO Radiography). Foto intraoperatoria.
  intraoperativeFileId String?
  intraoperativeFile   PatientFile? @relation("SurgeryIntraOpFile", fields: [intraoperativeFileId], references: [id])

  consentSignedFileId  String?
  consentSignedFile    PatientFile? @relation("SurgeryConsentFile", fields: [consentSignedFileId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
  clinic  Clinic  @relation(fields: [clinicId], references: [id])

  @@index([patientId, surgeryDate(sort: Desc)])
  @@index([clinicId])
  @@index([planId])
}
```

#### `PeriImplantAssessment` (con `implantId` String? nullable)

```prisma
model PeriImplantAssessment {
  id        String  @id @default(cuid())
  patientId String
  clinicId  String

  // Sin FK al módulo de Implantología (módulo 4/5, aún no implementado).
  // Cuando exista, se hará migración para agregar FK real.
  implantId   String?
  implantFdi  Int

  status                   PeriImplantStatus
  bop                      Boolean
  suppuration              Boolean
  radiographicBoneLossMm   Float?
  recommendedTreatment     String?

  evaluatedAt   DateTime @default(now())
  evaluatedById String
  evaluatedBy   User     @relation(fields: [evaluatedById], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  patient Patient @relation(fields: [patientId], references: [id])
  clinic  Clinic  @relation(fields: [clinicId], references: [id])

  @@index([patientId, evaluatedAt(sort: Desc)])
  @@index([clinicId, status])
  @@index([implantId])
}
```

### 4.3 Relaciones inversas a agregar a modelos existentes

```prisma
// model Patient { ... agregar:
  periodontalRecords          PeriodontalRecord[]
  periodontalClassifications  PeriodontalClassification[]
  gingivalRecessions          GingivalRecession[]
  periodontalPlans            PeriodontalTreatmentPlan[]
  srpSessions                 SRPSession[]
  periodontalReevaluations    PeriodontalReevaluation[]
  periodontalRiskAssessments  PeriodontalRiskAssessment[]
  periodontalSurgeries        PeriodontalSurgery[]
  periImplantAssessments      PeriImplantAssessment[]
// }

// model Clinic { ... agregar las mismas inversas con prefijo clinic. }

// model User { ... agregar:
  periodontalRecordsAsDoctor       PeriodontalRecord[]
  periodontalClassifications       PeriodontalClassification[]
  recordedRecessions               GingivalRecession[]
  srpSessionsAsDoctor              SRPSession[]
  reevaluationsAsEvaluator         PeriodontalReevaluation[]
  riskAssessmentsAsEvaluator       PeriodontalRiskAssessment[]
  surgeriesAsDoctor                PeriodontalSurgery[]
  periImplantAssessmentsAsEvaluator PeriImplantAssessment[]
// }

// model PatientFile { ... agregar:
  surgeryIntraOpFor PeriodontalSurgery[] @relation("SurgeryIntraOpFile")
  surgeryConsentFor PeriodontalSurgery[] @relation("SurgeryConsentFile")
// }
```

### 4.4 Migración SQL adicional

```sql
-- Índice GIN para búsqueda en sites JSON (encontrar pacientes con sitios ≥6mm rápido)
CREATE INDEX idx_perio_record_sites_gin
  ON "PeriodontalRecord" USING GIN ("sites" jsonb_path_ops);

-- Constraints de rango clínico (defensa en profundidad — validación primaria es zod)
ALTER TABLE "PeriodontalRecord"
  ADD CONSTRAINT chk_perio_bop_range
    CHECK ("bopPercentage" IS NULL OR ("bopPercentage" >= 0 AND "bopPercentage" <= 100)),
  ADD CONSTRAINT chk_perio_plaque_range
    CHECK ("plaqueIndexOleary" IS NULL OR ("plaqueIndexOleary" >= 0 AND "plaqueIndexOleary" <= 100)),
  ADD CONSTRAINT chk_perio_sites_nonneg
    CHECK (
      ("sites1to3mm" IS NULL OR "sites1to3mm" >= 0) AND
      ("sites4to5mm" IS NULL OR "sites4to5mm" >= 0) AND
      ("sites6PlusMm" IS NULL OR "sites6PlusMm" >= 0)
    );

ALTER TABLE "PeriodontalRiskAssessment"
  ADD CONSTRAINT chk_recall_months_valid
    CHECK ("recommendedRecallMonths" IN (3, 4, 6));

ALTER TABLE "GingivalRecession"
  ADD CONSTRAINT chk_recession_height_range
    CHECK ("recessionHeightMm" >= 0 AND "recessionHeightMm" <= 20),
  ADD CONSTRAINT chk_recession_width_range
    CHECK ("recessionWidthMm" >= 0 AND "recessionWidthMm" <= 20),
  ADD CONSTRAINT chk_kt_range
    CHECK ("keratinizedTissueMm" >= 0 AND "keratinizedTissueMm" <= 20),
  ADD CONSTRAINT chk_surface_valid
    CHECK ("surface" IN ('vestibular', 'lingual'));

ALTER TABLE "PeriImplantAssessment"
  ADD CONSTRAINT chk_implant_fdi_range
    CHECK ("implantFdi" >= 11 AND "implantFdi" <= 48);

-- RLS policies multi-tenant
ALTER TABLE "PeriodontalRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_record_tenant ON "PeriodontalRecord"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "PeriodontalClassification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_class_tenant ON "PeriodontalClassification"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "GingivalRecession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_recession_tenant ON "GingivalRecession"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "PeriodontalTreatmentPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_plan_tenant ON "PeriodontalTreatmentPlan"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "SRPSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_srp_tenant ON "SRPSession"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "PeriodontalReevaluation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_reeval_tenant ON "PeriodontalReevaluation"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "PeriodontalRiskAssessment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_risk_tenant ON "PeriodontalRiskAssessment"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "PeriodontalSurgery" ENABLE ROW LEVEL SECURITY;
CREATE POLICY perio_surgery_tenant ON "PeriodontalSurgery"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));

ALTER TABLE "PeriImplantAssessment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY periimp_tenant ON "PeriImplantAssessment"
  USING ("clinicId" = current_setting('app.current_clinic_id', true));
```

---
## 5. Server Actions (16 mutaciones)

Todas las actions:
- archivo en `src/app/dashboard/patients/[patientId]/periodontics/_actions/`
- empiezan con `'use server'`
- validan con zod (`src/lib/periodontics/schemas.ts`)
- llaman `getCurrentUser()` + `getActiveClinicId()` + `canAccessModule(..., PERIODONTICS_MODULE_KEY)`
- ejecutan en `prisma.$transaction` con `recordAudit`
- llaman `revalidatePath(`/dashboard/patients/${patientId}`)` + el path específico del sub-tab
- retornan `Result<T>`

### 5.1 Schemas (zod)

```ts
// src/lib/periodontics/schemas.ts
import { z } from 'zod';

export const SiteSchema = z.object({
  fdi: z.number().int().min(11).max(48),
  position: z.enum(['MV', 'MB', 'DV', 'DL', 'ML', 'MB_PAL']),
  pdMm: z.number().int().min(0).max(15),
  recMm: z.number().int().min(-5).max(15),
  bop: z.boolean(),
  plaque: z.boolean(),
  suppuration: z.boolean(),
});

export const ToothLevelSchema = z.object({
  fdi: z.number().int().min(11).max(48),
  mobility: z.number().int().min(0).max(3),
  furcation: z.number().int().min(0).max(3),
  absent: z.boolean(),
  isImplant: z.boolean(),
});

export const CreatePeriodontalRecordSchema = z.object({
  patientId: z.string().cuid(),
  recordType: z.enum([
    'INICIAL', 'PRE_TRATAMIENTO', 'POST_FASE_1', 'POST_FASE_2',
    'MANTENIMIENTO', 'CIRUGIA_PRE', 'CIRUGIA_POST',
  ]),
  sites: z.array(SiteSchema).max(192),
  toothLevel: z.array(ToothLevelSchema).max(32),
  notes: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  comparedToRecordId: z.string().cuid().optional(),
});

export const UpsertSiteDataSchema = z.object({
  recordId: z.string().cuid(),
  site: SiteSchema,
});

export const UpsertToothDataSchema = z.object({
  recordId: z.string().cuid(),
  tooth: ToothLevelSchema,
});

export const ClassifyPatientSchema = z.object({
  recordId: z.string().cuid(),
  modifiers: z.object({
    smokingCigsPerDay: z.number().int().min(0).optional(),
    hba1c: z.number().min(3).max(20).optional(),
    otherFactors: z.array(z.string()).optional(),
  }),
});

export const OverrideClassificationSchema = z.object({
  classificationId: z.string().cuid(),
  stage: z.enum(['SALUD', 'GINGIVITIS', 'STAGE_I', 'STAGE_II', 'STAGE_III', 'STAGE_IV']),
  grade: z.enum(['GRADE_A', 'GRADE_B', 'GRADE_C']).nullable(),
  extension: z.enum(['LOCALIZADA', 'GENERALIZADA', 'PATRON_MOLAR_INCISIVO']).nullable(),
  justification: z.string().min(10, 'Justifica la sobrescritura (mínimo 10 caracteres).'),
});

export const CreateGingivalRecessionSchema = z.object({
  patientId: z.string().cuid(),
  toothFdi: z.number().int().min(11).max(48),
  surface: z.enum(['vestibular', 'lingual']),
  recessionHeightMm: z.number().min(0).max(20),
  recessionWidthMm: z.number().min(0).max(20),
  keratinizedTissueMm: z.number().min(0).max(20),
  cairoClassification: z.enum(['RT1', 'RT2', 'RT3']),
  gingivalPhenotype: z.enum(['DELGADO', 'GRUESO']),
  notes: z.string().optional(),
});

export const CreateSRPSessionSchema = z.object({
  patientId: z.string().cuid(),
  planId: z.string().cuid(),
  technique: z.enum(['SRP_CUADRANTE', 'FULL_MOUTH_DISINFECTION', 'FULL_MOUTH_SCALING']),
  instrumentation: z.enum(['MANUAL', 'ULTRASONICO', 'COMBINADO']),
  quadrantsCompleted: z.object({
    Q1: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
    Q2: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
    Q3: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
    Q4: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
  }),
  anesthesiaUsed: z.boolean(),
  anesthesiaType: z.string().optional(),
  durationMinutes: z.number().int().positive().optional(),
  observations: z.string().optional(),
});

export const CreateRiskAssessmentSchema = z.object({
  patientId: z.string().cuid(),
  bopPct: z.number().min(0).max(100),
  residualSites5Plus: z.number().int().min(0),
  lostTeethPerio: z.number().int().min(0).max(32),
  boneLossAgeRatio: z.number().min(0).optional(),
  smokingStatus: z.enum(['NO', 'MENOR_10', 'MAYOR_O_IGUAL_10']),
  hba1c: z.number().min(3).max(20).optional(),
});

export const CreatePeriodontalSurgerySchema = z.object({
  patientId: z.string().cuid(),
  planId: z.string().cuid().optional(),
  surgeryType: z.enum([
    'COLGAJO_ACCESO', 'GINGIVECTOMIA', 'RESECTIVA_OSEA', 'RTG',
    'INJERTO_GINGIVAL_LIBRE', 'INJERTO_TEJIDO_CONECTIVO',
    'TUNELIZACION', 'CORONALLY_ADVANCED_FLAP', 'OTRO',
  ]),
  treatedSites: z.array(z.object({
    fdi: z.number().int().min(11).max(48),
    sites: z.array(z.enum(['MV', 'MB', 'DV', 'DL', 'ML', 'MB_PAL'])).optional(),
  })),
  biomaterials: z.object({
    membrane: z.string().optional(),
    boneGraft: z.string().optional(),
    connectiveTissue: z.string().optional(),
    growthFactor: z.string().optional(),
    others: z.array(z.string()).optional(),
  }).optional(),
  sutureType: z.string().optional(),
  surgeryDate: z.string().datetime(),
  consentSignedFileId: z.string().cuid().optional(),
});

export const CreatePeriImplantAssessmentSchema = z.object({
  patientId: z.string().cuid(),
  implantId: z.string().optional(),  // String?, sin FK aún
  implantFdi: z.number().int().min(11).max(48),
  status: z.enum([
    'SALUD', 'MUCOSITIS',
    'PERIIMPLANTITIS_INICIAL', 'PERIIMPLANTITIS_MODERADA', 'PERIIMPLANTITIS_AVANZADA',
  ]),
  bop: z.boolean(),
  suppuration: z.boolean(),
  radiographicBoneLossMm: z.number().min(0).max(15).optional(),
  recommendedTreatment: z.string().optional(),
});
```

### 5.2 Catálogo de actions

```ts
// 1. createPeriodontalRecord       — crea sondaje completo desde cero
// 2. updatePeriodontalRecord       — actualiza notas/duración (NO sites — se usa upsertSiteData)
// 3. upsertSiteData                — granular: actualiza UN sitio (autosave por celda)
// 4. upsertToothData               — granular: movilidad/furca/ausente/implante por diente
// 5. classifyPatient               — corre algoritmo 2017, crea PeriodontalClassification
// 6. overrideClassification        — sobrescribe con justificación
// 7. createGingivalRecession       — registra recesión Cairo
// 8. updateGingivalRecession       — modifica recesión (auditable)
// 9. createTreatmentPlan           — abre plan 4 fases
// 10. advancePhase                 — marca fase X completada y avanza a X+1
// 11. createSRPSession             — sesión SRP
// 12. createReevaluation           — compara record inicial vs post, identifica residuales
// 13. createRiskAssessment         — Berna risk
// 14. createPeriodontalSurgery     — cirugía con biomateriales
// 15. createPeriImplantAssessment  — periimplantitis
// 16. exportPerioReportPdf         — PDF informe paciente / médico tratante / pre-post compare
```

### 5.3 Detalle de las actions críticas

#### `createPeriodontalRecord` — crea el sondaje y dispara cálculos

```ts
// src/app/dashboard/patients/[patientId]/periodontics/_actions/createPeriodontalRecord.ts
'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { CreatePeriodontalRecordSchema } from '@/lib/periodontics/schemas';
import { computePerioMetrics } from '@/lib/periodontics/periodontogram-math';
import { classifyPerio2017 } from '@/lib/periodontics/classification-2017';
import { getCurrentUser, getActiveClinicId } from '@/lib/auth/session';
import { canAccessModule, PERIODONTICS_MODULE_KEY } from '@/lib/specialties/keys';
import { recordAudit } from '@/lib/audit';
import type { Result } from '@/lib/result';
import type { PeriodontalRecord } from '@prisma/client';

export async function createPeriodontalRecord(
  input: z.infer<typeof CreatePeriodontalRecordSchema>,
): Promise<Result<PeriodontalRecord & { classificationId: string | null }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'UNAUTHENTICATED' };
  const clinicId = await getActiveClinicId();
  if (!clinicId) return { ok: false, error: 'NO_CLINIC_CONTEXT' };

  if (!(await canAccessModule(user.id, clinicId, PERIODONTICS_MODULE_KEY))) {
    return { ok: false, error: 'FORBIDDEN_MODULE' };
  }

  const parsed = CreatePeriodontalRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION', issues: parsed.error.issues };

  // Métricas in-memory antes del INSERT
  const metrics = computePerioMetrics(parsed.data.sites, parsed.data.toothLevel);

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.periodontalRecord.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId,
        doctorId: user.id,
        recordType: parsed.data.recordType,
        sites: parsed.data.sites,
        toothLevel: parsed.data.toothLevel,
        bopPercentage: metrics.bopPct,
        plaqueIndexOleary: metrics.plaquePct,
        sites1to3mm: metrics.sites1to3,
        sites4to5mm: metrics.sites4to5,
        sites6PlusMm: metrics.sites6plus,
        teethWithPockets5Plus: metrics.teethWithPockets5plus,
        notes: parsed.data.notes,
        durationMinutes: parsed.data.durationMinutes,
        comparedToRecordId: parsed.data.comparedToRecordId,
      },
    });

    await recordAudit(tx, {
      userId: user.id, clinicId,
      entity: 'PeriodontalRecord', entityId: created.id,
      action: 'CREATE', after: created,
    });

    return created;
  });

  revalidatePath(`/dashboard/patients/${parsed.data.patientId}/periodontics`);
  revalidatePath(`/dashboard/specialties/periodontics`);

  return { ok: true, data: { ...record, classificationId: null } };
}
```

#### `upsertSiteData` — autosave por celda (alta frecuencia)

```ts
// src/app/dashboard/patients/[patientId]/periodontics/_actions/upsertSiteData.ts
'use server';

export async function upsertSiteData(
  input: z.infer<typeof UpsertSiteDataSchema>,
): Promise<Result<{ recordId: string; updatedAt: Date; metrics: PerioMetrics }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'UNAUTHENTICATED' };
  const clinicId = await getActiveClinicId();
  if (!clinicId) return { ok: false, error: 'NO_CLINIC_CONTEXT' };
  if (!(await canAccessModule(user.id, clinicId, PERIODONTICS_MODULE_KEY))) {
    return { ok: false, error: 'FORBIDDEN_MODULE' };
  }
  const parsed = UpsertSiteDataSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION', issues: parsed.error.issues };

  const updated = await prisma.$transaction(async (tx) => {
    const record = await tx.periodontalRecord.findFirst({
      where: { id: parsed.data.recordId, clinicId, deletedAt: null },
    });
    if (!record) throw new Error('RECORD_NOT_FOUND');

    const sites = (record.sites as any[]) ?? [];
    const idx = sites.findIndex(
      (s) => s.fdi === parsed.data.site.fdi && s.position === parsed.data.site.position,
    );
    if (idx >= 0) sites[idx] = parsed.data.site;
    else sites.push(parsed.data.site);

    const metrics = computePerioMetrics(sites, record.toothLevel as any[]);

    const next = await tx.periodontalRecord.update({
      where: { id: record.id },
      data: {
        sites,
        bopPercentage: metrics.bopPct,
        plaqueIndexOleary: metrics.plaquePct,
        sites1to3mm: metrics.sites1to3,
        sites4to5mm: metrics.sites4to5,
        sites6PlusMm: metrics.sites6plus,
        teethWithPockets5Plus: metrics.teethWithPockets5plus,
      },
    });

    await recordAudit(tx, {
      userId: user.id, clinicId,
      entity: 'PeriodontalRecord', entityId: record.id,
      action: 'UPDATE_SITE',
      meta: { fdi: parsed.data.site.fdi, position: parsed.data.site.position },
    });

    return { record: next, metrics };
  });

  // NO revalidatePath aquí — es alta frecuencia, el cliente actualiza via optimistic update.
  return {
    ok: true,
    data: {
      recordId: updated.record.id,
      updatedAt: updated.record.updatedAt,
      metrics: updated.metrics,
    },
  };
}
```

> **Decisión de arquitectura:** las celdas hacen `optimistic update` local + debounce 300ms antes de llamar `upsertSiteData`. Se evita lag en captura rápida.

#### `classifyPatient` — algoritmo 2017 AAP/EFP

```ts
// src/app/dashboard/patients/[patientId]/periodontics/_actions/classifyPatient.ts
'use server';

export async function classifyPatient(
  input: z.infer<typeof ClassifyPatientSchema>,
): Promise<Result<PeriodontalClassification>> {
  /* ... auth, tenant, validación ... */

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.periodontalRecord.findFirst({
      where: { id: parsed.data.recordId, clinicId, deletedAt: null },
      include: { patient: true },
    });
    if (!record) throw new Error('RECORD_NOT_FOUND');

    // patient.birthDate es necesario para boneLossAgeRatio
    const sites = record.sites as any[];
    const toothLevel = record.toothLevel as any[];

    const out = classifyPerio2017({
      sites,
      toothLevel,
      patientAge: differenceInYears(new Date(), record.patient.birthDate),
      modifiers: parsed.data.modifiers,
      // boneLossPct viene del análisis IA de PatientFile XRAY si está disponible
      boneLossPct: await getRadiographicBoneLossPct(tx, record.patientId),
    });

    // Si ya existía clasificación para este record, soft-delete antes (audit trail)
    const existing = await tx.periodontalClassification.findUnique({
      where: { periodontalRecordId: record.id },
    });
    if (existing) {
      await tx.periodontalClassification.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
    }

    const classification = await tx.periodontalClassification.create({
      data: {
        patientId: record.patientId, clinicId,
        periodontalRecordId: record.id,
        stage: out.stage, grade: out.grade, extension: out.extension,
        modifiers: parsed.data.modifiers,
        computationInputs: out.inputs,
        calculatedAutomatically: true,
        classifiedById: user.id,
      },
    });

    await recordAudit(tx, {
      userId: user.id, clinicId,
      entity: 'PeriodontalClassification', entityId: classification.id,
      action: 'CREATE', after: classification,
    });

    return classification;
  });

  revalidatePath(`/dashboard/patients/${input.recordId}`);
  return { ok: true, data: result };
}
```

#### `overrideClassification` — sobrescribir con justificación

```ts
// src/app/dashboard/patients/[patientId]/periodontics/_actions/overrideClassification.ts
'use server';

export async function overrideClassification(
  input: z.infer<typeof OverrideClassificationSchema>,
): Promise<Result<PeriodontalClassification>> {
  /* auth + tenant + validación */

  if (!parsed.data.justification || parsed.data.justification.trim().length < 10) {
    return { ok: false, error: 'JUSTIFICATION_REQUIRED' };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.periodontalClassification.findFirst({
      where: { id: parsed.data.classificationId, clinicId, deletedAt: null },
    });
    if (!before) throw new Error('NOT_FOUND');

    const next = await tx.periodontalClassification.update({
      where: { id: before.id },
      data: {
        stage: parsed.data.stage,
        grade: parsed.data.grade,
        extension: parsed.data.extension,
        overriddenByDoctor: true,
        justification: parsed.data.justification,
      },
    });

    await recordAudit(tx, {
      userId: user.id, clinicId,
      entity: 'PeriodontalClassification', entityId: next.id,
      action: 'OVERRIDE',
      before, after: next,
    });

    return next;
  });

  return { ok: true, data: updated };
}
```

#### `createReevaluation` — comparativo Fase 2

```ts
export async function createReevaluation(input): Promise<Result<PeriodontalReevaluation>> {
  /* auth + tenant + validación */

  const result = await prisma.$transaction(async (tx) => {
    const [initial, post] = await Promise.all([
      tx.periodontalRecord.findFirst({ where: { id: input.initialRecordId, clinicId } }),
      tx.periodontalRecord.findFirst({ where: { id: input.postRecordId, clinicId } }),
    ]);
    if (!initial || !post) throw new Error('RECORDS_NOT_FOUND');

    const initialSites = initial.sites as any[];
    const postSites = post.sites as any[];

    // Sitios residuales = aún PD ≥5 con BoP+
    const residualSites = postSites.filter((s) => s.pdMm >= 5 && s.bop);

    // FDI candidatos a cirugía = ≥2 sitios residuales por diente
    const fdiCounts = new Map<number, number>();
    residualSites.forEach((s) => fdiCounts.set(s.fdi, (fdiCounts.get(s.fdi) ?? 0) + 1));
    const surgicalCandidatesTeeth = [...fdiCounts.entries()]
      .filter(([_, count]) => count >= 2)
      .map(([fdi]) => fdi);

    const bopImprovement = (initial.bopPercentage ?? 0) - (post.bopPercentage ?? 0);
    const pdImprovement = avgPd(initialSites) - avgPd(postSites);

    const created = await tx.periodontalReevaluation.create({
      data: {
        patientId: initial.patientId,
        clinicId,
        planId: input.planId,
        initialRecordId: initial.id,
        postRecordId: post.id,
        bopImprovementPct: bopImprovement,
        pdAverageImprovementMm: pdImprovement,
        residualSites,
        surgicalCandidatesTeeth,
        evaluatedById: user.id,
      },
    });

    await recordAudit(tx, { /* ... */ });
    return created;
  });

  return { ok: true, data: result };
}
```

#### `createRiskAssessment` — Berna

```ts
export async function createRiskAssessment(input): Promise<Result<PeriodontalRiskAssessment>> {
  /* auth + tenant + validación */

  const { riskCategory, recommendedRecallMonths } = computeBernaRisk(input);

  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.periodontalRiskAssessment.create({
      data: {
        patientId: input.patientId, clinicId,
        bopPct: input.bopPct,
        residualSites5Plus: input.residualSites5Plus,
        lostTeethPerio: input.lostTeethPerio,
        boneLossAgeRatio: input.boneLossAgeRatio,
        smokingStatus: input.smokingStatus,
        hba1c: input.hba1c,
        riskCategory,
        recommendedRecallMonths,
        evaluatedById: user.id,
      },
    });
    await recordAudit(tx, { /* ... */ });
    return r;
  });

  // Encolar recordatorio WhatsApp para mantenimiento
  await enqueueMaintenanceReminder({
    patientId: input.patientId,
    monthsFromNow: recommendedRecallMonths,
  });

  return { ok: true, data: created };
}
```

### 5.4 Helpers de cálculo

#### `periodontogram-math.ts`

```ts
// src/lib/periodontics/periodontogram-math.ts
import type { Site, ToothLevel } from './schemas';

export type PerioMetrics = {
  bopPct: number;
  plaquePct: number;
  sites1to3: number;
  sites4to5: number;
  sites6plus: number;
  teethWithPockets5plus: number;
  totalSites: number;
  avgPd: number;
};

export function computePerioMetrics(sites: Site[], teeth: ToothLevel[]): PerioMetrics {
  const present = sites.filter((s) => {
    const t = teeth.find((tt) => tt.fdi === s.fdi);
    return !t || !t.absent;
  });
  const total = present.length || 1;

  const bopCount = present.filter((s) => s.bop).length;
  const plaqueCount = present.filter((s) => s.plaque).length;
  const s1to3 = present.filter((s) => s.pdMm >= 1 && s.pdMm <= 3).length;
  const s4to5 = present.filter((s) => s.pdMm >= 4 && s.pdMm <= 5).length;
  const s6plus = present.filter((s) => s.pdMm >= 6).length;

  // Dientes con al menos 1 sitio ≥5mm
  const fdisWithPockets5 = new Set(present.filter((s) => s.pdMm >= 5).map((s) => s.fdi));

  return {
    bopPct: round1((bopCount / total) * 100),
    plaquePct: round1((plaqueCount / total) * 100),
    sites1to3: s1to3,
    sites4to5: s4to5,
    sites6plus: s6plus,
    teethWithPockets5plus: fdisWithPockets5.size,
    totalSites: total,
    avgPd: round1(present.reduce((acc, s) => acc + s.pdMm, 0) / total),
  };
}

export function avgPd(sites: Site[]): number {
  if (!sites.length) return 0;
  return sites.reduce((acc, s) => acc + s.pdMm, 0) / sites.length;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
```

#### `classification-2017.ts` — algoritmo AAP/EFP

```ts
// src/lib/periodontics/classification-2017.ts
import type { Site, ToothLevel } from './schemas';
import type { PeriodontalStage, PeriodontalGrade, PeriodontalExtension } from '@prisma/client';

type ClassifyInput = {
  sites: Site[];
  toothLevel: ToothLevel[];
  patientAge: number;
  boneLossPct?: number;          // del análisis IA de PatientFile XRAY
  modifiers: {
    smokingCigsPerDay?: number;
    hba1c?: number;
    otherFactors?: string[];
  };
};

type ClassifyOutput = {
  stage: PeriodontalStage;
  grade: PeriodontalGrade | null;
  extension: PeriodontalExtension | null;
  inputs: {
    maxCalInterproximalMm: number;
    maxBoneLossPct: number;
    maxPdMm: number;
    lostTeethPerio: number;
    complexityFactors: string[];
    boneLossAgeRatio: number;
    bopPct: number;
    affectedTeethPct: number;
  };
};

export function classifyPerio2017(input: ClassifyInput): ClassifyOutput {
  const { sites, toothLevel, patientAge, boneLossPct, modifiers } = input;

  // — CAL interproximal por sitio —
  // CAL = PD + REC. "Interproximal" = MV/DV/MB_PAL/DL.
  const interProx = sites.filter((s) => ['MV', 'DV', 'MB_PAL', 'DL'].includes(s.position));
  const calValues = interProx.map((s) => s.pdMm + s.recMm);
  const maxCal = Math.max(0, ...calValues);

  // PD máximo
  const maxPd = Math.max(0, ...sites.map((s) => s.pdMm));

  // % dientes afectados (con CAL ≥ 3 o PD ≥4 con BoP)
  const affectedFdis = new Set<number>();
  sites.forEach((s) => {
    const cal = s.pdMm + s.recMm;
    if (cal >= 3 || (s.pdMm >= 4 && s.bop)) affectedFdis.add(s.fdi);
  });
  const presentTeeth = toothLevel.filter((t) => !t.absent).length || 1;
  const affectedTeethPct = (affectedFdis.size / presentTeeth) * 100;

  // Dientes perdidos (proxy: ausentes > 0). En MVP no diferenciamos por causa
  // — el doctor puede sobrescribir el grado si desea afinar.
  const lostTeethPerio = toothLevel.filter((t) => t.absent).length;

  // Factores de complejidad (Stage III/IV)
  const complexity: string[] = [];
  if (toothLevel.some((t) => t.mobility >= 2)) complexity.push('movilidad ≥ 2');
  if (toothLevel.some((t) => t.furcation >= 2)) complexity.push('furca II-III');
  if (maxPd >= 6) complexity.push('PD ≥ 6mm');
  if (lostTeethPerio >= 5) complexity.push('≥5 dientes perdidos');

  // — BoP global —
  const bopCount = sites.filter((s) => s.bop).length;
  const bopPct = (bopCount / (sites.length || 1)) * 100;

  // ── Stage ──────────────────────────────────────────────────────
  let stage: PeriodontalStage;
  if (maxCal === 0 && maxPd <= 3 && bopPct < 10) {
    stage = 'SALUD';
  } else if (maxCal === 0 && bopPct >= 10) {
    stage = 'GINGIVITIS';
  } else if (maxCal >= 1 && maxCal <= 2) {
    stage = 'STAGE_I';
  } else if (maxCal >= 3 && maxCal <= 4) {
    stage = 'STAGE_II';
  } else if (maxCal >= 5 && lostTeethPerio <= 4 && complexity.length <= 2) {
    stage = 'STAGE_III';
  } else if (maxCal >= 5 && (lostTeethPerio >= 5 || complexity.length >= 3)) {
    stage = 'STAGE_IV';
  } else {
    stage = 'STAGE_III';  // fallback razonable
  }

  // ── Grade ──────────────────────────────────────────────────────
  let grade: PeriodontalGrade | null = null;
  let boneLossAgeRatio = 0;

  if (stage !== 'SALUD' && stage !== 'GINGIVITIS') {
    // Indicador directo: ratio %BL / edad
    if (typeof boneLossPct === 'number' && patientAge > 0) {
      boneLossAgeRatio = boneLossPct / patientAge;
      if (boneLossAgeRatio < 0.25) grade = 'GRADE_A';
      else if (boneLossAgeRatio <= 1.0) grade = 'GRADE_B';
      else grade = 'GRADE_C';
    } else {
      // Sin radiografía: grado B por defecto (asunción conservadora)
      grade = 'GRADE_B';
    }

    // Modificador: tabaquismo ≥ 10 cig/día sube un grado
    if (modifiers.smokingCigsPerDay && modifiers.smokingCigsPerDay >= 10) {
      grade = bumpGrade(grade);
    }
    // Modificador: HbA1c ≥ 7% sube un grado
    if (modifiers.hba1c && modifiers.hba1c >= 7) {
      grade = bumpGrade(grade);
    }
  }

  // ── Extension ──────────────────────────────────────────────────
  let extension: PeriodontalExtension | null = null;
  if (stage !== 'SALUD' && stage !== 'GINGIVITIS') {
    // Patrón molar/incisivo si afectados son SOLO molares (16,17,26,27,36,37,46,47) e incisivos (11-13,21-23,31-33,41-43)
    const affectedArr = [...affectedFdis];
    const allMolarOrIncisor = affectedArr.every((fdi) => isMolar(fdi) || isIncisor(fdi));
    const hasMolar = affectedArr.some(isMolar);
    const hasIncisor = affectedArr.some(isIncisor);

    if (allMolarOrIncisor && hasMolar && hasIncisor && affectedTeethPct < 50) {
      extension = 'PATRON_MOLAR_INCISIVO';
    } else if (affectedTeethPct < 30) {
      extension = 'LOCALIZADA';
    } else {
      extension = 'GENERALIZADA';
    }
  }

  return {
    stage, grade, extension,
    inputs: {
      maxCalInterproximalMm: round1(maxCal),
      maxBoneLossPct: boneLossPct ?? 0,
      maxPdMm: maxPd,
      lostTeethPerio,
      complexityFactors: complexity,
      boneLossAgeRatio: round1(boneLossAgeRatio),
      bopPct: round1(bopPct),
      affectedTeethPct: round1(affectedTeethPct),
    },
  };
}

function bumpGrade(g: PeriodontalGrade): PeriodontalGrade {
  if (g === 'GRADE_A') return 'GRADE_B';
  if (g === 'GRADE_B') return 'GRADE_C';
  return 'GRADE_C';
}

function isMolar(fdi: number): boolean {
  const last = fdi % 10;
  return last >= 6 && last <= 8;
}
function isIncisor(fdi: number): boolean {
  const last = fdi % 10;
  return last === 1 || last === 2;
}
const round1 = (n: number) => Math.round(n * 10) / 10;
```

#### `risk-berna.ts` — Lang & Tonetti

```ts
// src/lib/periodontics/risk-berna.ts
import type { PeriodontalRiskCategory, SmokingStatus } from '@prisma/client';

type RiskInput = {
  bopPct: number;
  residualSites5Plus: number;
  lostTeethPerio: number;
  boneLossAgeRatio?: number;
  smokingStatus: SmokingStatus;
  hba1c?: number;
};

type RiskOutput = {
  riskCategory: PeriodontalRiskCategory;
  recommendedRecallMonths: 3 | 4 | 6;
  factors: { name: string; level: 'BAJO' | 'MODERADO' | 'ALTO'; weight: number }[];
};

export function computeBernaRisk(input: RiskInput): RiskOutput {
  // Cada factor aporta un nivel; el peor de los 6 manda la categoría final
  const factors: RiskOutput['factors'] = [];

  // 1. BoP%
  if (input.bopPct < 10) factors.push({ name: 'BoP %', level: 'BAJO', weight: 1 });
  else if (input.bopPct < 25) factors.push({ name: 'BoP %', level: 'MODERADO', weight: 2 });
  else factors.push({ name: 'BoP %', level: 'ALTO', weight: 3 });

  // 2. Sitios residuales ≥ 5mm
  if (input.residualSites5Plus <= 4) factors.push({ name: 'Sitios residuales ≥5mm', level: 'BAJO', weight: 1 });
  else if (input.residualSites5Plus <= 8) factors.push({ name: 'Sitios residuales ≥5mm', level: 'MODERADO', weight: 2 });
  else factors.push({ name: 'Sitios residuales ≥5mm', level: 'ALTO', weight: 3 });

  // 3. Dientes perdidos por causa periodontal (de hasta 28 — sin 3eros molares)
  if (input.lostTeethPerio <= 4) factors.push({ name: 'Dientes perdidos', level: 'BAJO', weight: 1 });
  else if (input.lostTeethPerio <= 8) factors.push({ name: 'Dientes perdidos', level: 'MODERADO', weight: 2 });
  else factors.push({ name: 'Dientes perdidos', level: 'ALTO', weight: 3 });

  // 4. Pérdida ósea / edad
  if (input.boneLossAgeRatio !== undefined) {
    if (input.boneLossAgeRatio < 0.25) factors.push({ name: 'BL/edad', level: 'BAJO', weight: 1 });
    else if (input.boneLossAgeRatio <= 1.0) factors.push({ name: 'BL/edad', level: 'MODERADO', weight: 2 });
    else factors.push({ name: 'BL/edad', level: 'ALTO', weight: 3 });
  }

  // 5. Fumador
  if (input.smokingStatus === 'NO') factors.push({ name: 'Tabaco', level: 'BAJO', weight: 1 });
  else if (input.smokingStatus === 'MENOR_10') factors.push({ name: 'Tabaco', level: 'MODERADO', weight: 2 });
  else factors.push({ name: 'Tabaco', level: 'ALTO', weight: 3 });

  // 6. HbA1c
  if (input.hba1c !== undefined) {
    if (input.hba1c < 6.5) factors.push({ name: 'HbA1c', level: 'BAJO', weight: 1 });
    else if (input.hba1c < 7.5) factors.push({ name: 'HbA1c', level: 'MODERADO', weight: 2 });
    else factors.push({ name: 'HbA1c', level: 'ALTO', weight: 3 });
  }

  // Categoría = nivel del peor factor
  const maxWeight = Math.max(...factors.map((f) => f.weight));
  const riskCategory: PeriodontalRiskCategory =
    maxWeight === 1 ? 'BAJO' : maxWeight === 2 ? 'MODERADO' : 'ALTO';

  const recommendedRecallMonths = (riskCategory === 'BAJO' ? 6 : riskCategory === 'MODERADO' ? 4 : 3) as 3 | 4 | 6;

  return { riskCategory, recommendedRecallMonths, factors };
}
```

#### `site-helpers.ts` — orden de captura y mapeo

```ts
// src/lib/periodontics/site-helpers.ts
import type { SitePosition } from '@prisma/client';

// FDI orden tradicional sondaje (dentista derecho mirando al paciente)
export const FDI_ORDER_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const FDI_ORDER_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const FDI_ALL = [...FDI_ORDER_UPPER, ...FDI_ORDER_LOWER];

// Orden lógico de los 6 sitios al sondear un diente:
// vestibular MV → MB → DV  →  palatino DL → ML → MB_PAL
export const SITE_CAPTURE_ORDER: SitePosition[] = ['MV', 'MB', 'DV', 'DL', 'ML', 'MB_PAL'];

// Helper: dado un (fdi, position) actual, retorna el siguiente sitio
export function nextSite(fdi: number, position: SitePosition): { fdi: number; position: SitePosition } | null {
  const sIdx = SITE_CAPTURE_ORDER.indexOf(position);
  if (sIdx === -1) return null;
  if (sIdx < SITE_CAPTURE_ORDER.length - 1) {
    return { fdi, position: SITE_CAPTURE_ORDER[sIdx + 1] };
  }
  // siguiente diente
  const fIdx = FDI_ALL.indexOf(fdi);
  if (fIdx === -1 || fIdx === FDI_ALL.length - 1) return null;
  return { fdi: FDI_ALL[fIdx + 1], position: SITE_CAPTURE_ORDER[0] };
}

// Categoría del diente para dibujar la silueta (incisivo, canino, premolar, molar)
export function toothCategory(fdi: number): 'incisor' | 'canine' | 'premolar' | 'molar' {
  const last = fdi % 10;
  if (last === 1 || last === 2) return 'incisor';
  if (last === 3) return 'canine';
  if (last === 4 || last === 5) return 'premolar';
  return 'molar';
}

// Sitio vestibular vs lingual
export function isFacialSite(p: SitePosition): boolean {
  return p === 'MV' || p === 'MB' || p === 'DV';
}
```

#### `keyboard-shortcuts.ts` — parser `5-2`

```ts
// src/lib/periodontics/keyboard-shortcuts.ts

// Parser del input "5-2", "5/2", "5", "5-", "-2"
export function parsePdRecInput(raw: string): { pdMm: number | null; recMm: number | null } {
  const normalized = raw.trim().replace(/\s+/g, '').replace(/[/,]/g, '-');
  const m = /^(-?\d{1,2})?-?(-?\d{1,2})?$/.exec(normalized);
  if (!m) return { pdMm: null, recMm: null };
  const pd = m[1] ? parseInt(m[1], 10) : null;
  const rec = m[2] ? parseInt(m[2], 10) : null;
  return {
    pdMm: pd !== null && pd >= 0 && pd <= 15 ? pd : null,
    recMm: rec !== null && rec >= -5 && rec <= 15 ? rec : null,
  };
}

// Atajos:
// Tab     → siguiente sitio
// Shift+Tab → sitio anterior
// Espacio → toggle BoP
// p / P   → toggle placa
// s / S   → toggle supuración
// Enter   → siguiente sitio (alternativa a Tab)
// Esc     → cancela edición de la celda actual

export const SHORTCUTS = {
  TOGGLE_BOP: ' ',
  TOGGLE_PLAQUE: 'p',
  TOGGLE_SUPPURATION: 's',
  NEXT_SITE: 'Tab',
  PREV_SITE: 'Shift+Tab',
  CONFIRM: 'Enter',
  CANCEL: 'Escape',
} as const;
```

---
## 6. Componentes UI

### 6.1 Árbol de componentes

```
PeriodonticsTab (page.tsx)
├── PerioSubTabs                                  ← navega entre sub-tabs
│   ├── ResumenTab
│   │   ├── CurrentClassificationCard
│   │   ├── BoPTrendChart                         ← recharts LineChart
│   │   ├── NextMaintenanceCard                   ← countdown + riesgo
│   │   ├── ClinicalAlertsCard                    ← residuales, recesiones
│   │   └── SystemicFactorsCard                   ← diabetes, fumador, embarazo
│   │
│   ├── PeriodontogramaTab                        ← núcleo del módulo
│   │   ├── PeriodontogramSidebar                 ← timeline de records previos
│   │   │   └── RecordCard (×N)
│   │   ├── PeriodontogramHeader
│   │   │   ├── LiveIndicators                    ← BoP%, Plaque, distribución
│   │   │   ├── CaptureModeSwitch                 ← teclado | voz | tablet
│   │   │   └── SaveStatusIndicator               ← "Guardando..." / "Guardado HH:MM"
│   │   ├── PeriodontogramGrid                    ← 6×32 (núcleo)
│   │   │   ├── ArcadeRow (upper)
│   │   │   │   └── ToothColumn (×16)
│   │   │   │       ├── SiteCell (vestibular ×3: MV, MB, DV)
│   │   │   │       ├── ToothCenter (silueta SVG + FDI + indicadores)
│   │   │   │       └── SiteCell (lingual/palatino ×3: DL, ML, MB_PAL)
│   │   │   └── ArcadeRow (lower)
│   │   │       └── ToothColumn (×16)
│   │   ├── ClassificationFooter                  ← Estadio + Grado + Extensión
│   │   ├── KeyboardCaptureLayer                  ← invisible — captura teclas
│   │   └── ToothDetailDrawer                     ← movilidad/furca/recesión
│   │
│   ├── PlanTab
│   │   ├── PhaseProgress (4 fases con check)
│   │   ├── QuadrantMap (Q1-Q4 SRP)
│   │   └── PlanTimeline
│   │
│   ├── CirugiasTab
│   │   ├── SurgeryList
│   │   ├── SurgeryDrawer
│   │   └── BeforeAfterCompare
│   │
│   └── MantenimientosTab
│       ├── MaintenanceTable
│       ├── BoPTrendChart
│       └── RiskBadge
│
└── (Modals fuera del tab tree)
    ├── SRPConsentModal       ← reuso de SignaturePad
    ├── SurgeryConsentModal
    └── PrePostCompare
```

### 6.2 Componente clave: `PeriodontogramGrid`

Es la pieza más compleja del módulo. Responsabilidades:

1. Renderizar 32 dientes (16 superiores + 16 inferiores) en disposición FDI estándar.
2. Mostrar 6 sitios por diente (3 vestibulares arriba, 3 linguales abajo).
3. Codificación por color según severidad PD (verde/amarillo/rojo).
4. Indicadores: BoP (punto rojo), placa (punto azul), supuración (punto naranja).
5. Movilidad (estrellas 1-3) y furca (triángulo I/II/III) en `ToothCenter`.
6. Captura inline por teclado: clic en celda → input — Tab avanza al siguiente sitio.
7. Optimistic update + debounce 300ms al `upsertSiteData`.

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/PeriodontogramGrid.tsx
'use client';

import { useReducer, useCallback, useEffect } from 'react';
import { ToothColumn } from './ToothColumn';
import { LiveIndicators } from './LiveIndicators';
import { ClassificationFooter } from './ClassificationFooter';
import { KeyboardCaptureLayer } from './KeyboardCaptureLayer';
import { ToothDetailDrawer } from './ToothDetailDrawer';
import { FDI_ORDER_UPPER, FDI_ORDER_LOWER, nextSite } from '@/lib/periodontics/site-helpers';
import { computePerioMetrics } from '@/lib/periodontics/periodontogram-math';
import { upsertSiteData } from '../_actions/upsertSiteData';
import { useDebouncedCallback } from '@/lib/hooks/useDebouncedCallback';
import type { Site, ToothLevel, PerioMetrics } from '@/lib/periodontics/schemas';

type Props = {
  recordId: string;
  initialSites: Site[];
  initialTooth: ToothLevel[];
  classification: PerioClassification | null;
  readOnly?: boolean;
};

type State = {
  sites: Site[];
  toothLevel: ToothLevel[];
  focused: { fdi: number; position: SitePosition } | null;
  drawer: { fdi: number } | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  metrics: PerioMetrics;
};

export function PeriodontogramGrid(props: Props) {
  const [state, dispatch] = useReducer(reducer, {
    sites: props.initialSites,
    toothLevel: props.initialTooth,
    focused: null,
    drawer: null,
    saveStatus: 'idle',
    metrics: computePerioMetrics(props.initialSites, props.initialTooth),
  });

  const debouncedSave = useDebouncedCallback(async (site: Site) => {
    dispatch({ type: 'SAVE_START' });
    const r = await upsertSiteData({ recordId: props.recordId, site });
    if (r.ok) dispatch({ type: 'SAVE_OK', metrics: r.data.metrics });
    else dispatch({ type: 'SAVE_ERROR' });
  }, 300);

  const handleCellChange = useCallback(
    (fdi: number, position: SitePosition, patch: Partial<Site>) => {
      dispatch({ type: 'PATCH_SITE', fdi, position, patch });
      const next = mergeSite(state.sites, fdi, position, patch);
      debouncedSave(next);
    },
    [state.sites, debouncedSave],
  );

  const handleAdvance = useCallback(() => {
    if (!state.focused) return;
    const n = nextSite(state.focused.fdi, state.focused.position);
    if (n) dispatch({ type: 'FOCUS', focused: n });
  }, [state.focused]);

  return (
    <div className="space-y-4">
      <PeriodontogramHeader
        metrics={state.metrics}
        saveStatus={state.saveStatus}
      />

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        {/* Arcada superior */}
        <div className="flex justify-center gap-px">
          {FDI_ORDER_UPPER.map((fdi) => (
            <ToothColumn
              key={fdi}
              fdi={fdi}
              arcade="upper"
              sites={state.sites.filter((s) => s.fdi === fdi)}
              tooth={state.toothLevel.find((t) => t.fdi === fdi)}
              focused={state.focused}
              onCellFocus={(p) => dispatch({ type: 'FOCUS', focused: { fdi, position: p } })}
              onCellChange={(p, patch) => handleCellChange(fdi, p, patch)}
              onToothClick={() => dispatch({ type: 'OPEN_DRAWER', fdi })}
              readOnly={props.readOnly}
            />
          ))}
        </div>

        <div className="my-4 border-t border-dashed border-zinc-700" />

        {/* Arcada inferior */}
        <div className="flex justify-center gap-px">
          {FDI_ORDER_LOWER.map((fdi) => (
            <ToothColumn
              key={fdi}
              fdi={fdi}
              arcade="lower"
              sites={state.sites.filter((s) => s.fdi === fdi)}
              tooth={state.toothLevel.find((t) => t.fdi === fdi)}
              focused={state.focused}
              onCellFocus={(p) => dispatch({ type: 'FOCUS', focused: { fdi, position: p } })}
              onCellChange={(p, patch) => handleCellChange(fdi, p, patch)}
              onToothClick={() => dispatch({ type: 'OPEN_DRAWER', fdi })}
              readOnly={props.readOnly}
            />
          ))}
        </div>
      </div>

      <ClassificationFooter
        classification={props.classification}
        recordId={props.recordId}
      />

      {!props.readOnly && (
        <KeyboardCaptureLayer
          focused={state.focused}
          onAdvance={handleAdvance}
          onPrevious={() => {/* ... */}}
          onToggleBop={() => {/* ... */}}
          onTogglePlaque={() => {/* ... */}}
          onToggleSuppuration={() => {/* ... */}}
        />
      )}

      {state.drawer && (
        <ToothDetailDrawer
          fdi={state.drawer.fdi}
          tooth={state.toothLevel.find((t) => t.fdi === state.drawer!.fdi)}
          recordId={props.recordId}
          onClose={() => dispatch({ type: 'CLOSE_DRAWER' })}
        />
      )}
    </div>
  );
}
```

### 6.3 `ToothColumn` — columna por diente

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/ToothColumn.tsx
'use client';

import { SiteCell } from './SiteCell';
import { ToothCenter } from './ToothCenter';

type Props = {
  fdi: number;
  arcade: 'upper' | 'lower';
  sites: Site[];           // hasta 6
  tooth?: ToothLevel;
  focused: { fdi: number; position: SitePosition } | null;
  onCellFocus: (p: SitePosition) => void;
  onCellChange: (p: SitePosition, patch: Partial<Site>) => void;
  onToothClick: () => void;
  readOnly?: boolean;
};

const facialOrder: SitePosition[] = ['MV', 'MB', 'DV'];
const lingualOrder: SitePosition[] = ['DL', 'ML', 'MB_PAL'];

export function ToothColumn(props: Props) {
  const findSite = (p: SitePosition) => props.sites.find((s) => s.position === p);
  const isFocused = (p: SitePosition) =>
    props.focused?.fdi === props.fdi && props.focused?.position === p;

  // Para superior: vestibular arriba, lingual abajo.
  // Para inferior: invertimos visualmente para que siempre la cara visible quede arriba.
  // Decisión simplificadora: mantenemos misma disposición — vestibular arriba siempre — y al revisar el diente
  // mentalmente. Esto sigue convención de Florida Probe.

  return (
    <div className="flex w-9 flex-col items-center">
      {/* Fila vestibular */}
      <div className="flex">
        {facialOrder.map((p) => (
          <SiteCell
            key={p}
            site={findSite(p)}
            position={p}
            focused={isFocused(p)}
            onFocus={() => props.onCellFocus(p)}
            onChange={(patch) => props.onCellChange(p, patch)}
            readOnly={props.readOnly}
          />
        ))}
      </div>

      {/* Diente al centro con FDI */}
      <ToothCenter
        fdi={props.fdi}
        arcade={props.arcade}
        tooth={props.tooth}
        sites={props.sites}
        onClick={props.onToothClick}
      />

      {/* Fila lingual/palatina */}
      <div className="flex">
        {lingualOrder.map((p) => (
          <SiteCell
            key={p}
            site={findSite(p)}
            position={p}
            focused={isFocused(p)}
            onFocus={() => props.onCellFocus(p)}
            onChange={(patch) => props.onCellChange(p, patch)}
            readOnly={props.readOnly}
          />
        ))}
      </div>
    </div>
  );
}
```

### 6.4 `SiteCell` — celda de un sitio

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/SiteCell.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { parsePdRecInput } from '@/lib/periodontics/keyboard-shortcuts';

type Props = {
  site?: Site;
  position: SitePosition;
  focused: boolean;
  onFocus: () => void;
  onChange: (patch: Partial<Site>) => void;
  readOnly?: boolean;
};

const PD_COLOR = {
  unset: 'bg-zinc-900',
  green: 'bg-emerald-900/40 text-emerald-200',
  yellow: 'bg-amber-900/40 text-amber-200',
  red: 'bg-red-900/50 text-red-200',
};

function pdTone(pd: number | undefined): keyof typeof PD_COLOR {
  if (pd === undefined) return 'unset';
  if (pd <= 3) return 'green';
  if (pd <= 5) return 'yellow';
  return 'red';
}

export function SiteCell({ site, focused, onFocus, onChange, readOnly }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focused && !readOnly) inputRef.current?.focus();
  }, [focused, readOnly]);

  const tone = pdTone(site?.pdMm);

  return (
    <button
      onClick={() => { onFocus(); setEditing(true); setDraft(`${site?.pdMm ?? ''}-${site?.recMm ?? ''}`); }}
      className={`
        relative h-7 w-3 border-r border-zinc-800 text-[10px] leading-none
        ${PD_COLOR[tone]}
        ${focused ? 'ring-2 ring-blue-500 ring-inset' : ''}
        hover:brightness-110 focus-visible:outline-none
      `}
      tabIndex={readOnly ? -1 : 0}
      aria-label={`Sitio ${site?.fdi ?? ''} ${site?.position ?? ''}: PD ${site?.pdMm ?? '-'} REC ${site?.recMm ?? '-'}`}
    >
      {!editing && (
        <div className="flex h-full flex-col items-center justify-center">
          <span className="font-mono font-semibold">
            {site?.pdMm ?? '·'}
          </span>
          {site?.recMm !== undefined && site.recMm !== 0 && (
            <span className="font-mono text-[7px] opacity-70">
              {site.recMm > 0 ? `↓${site.recMm}` : `↑${Math.abs(site.recMm)}`}
            </span>
          )}
        </div>
      )}

      {editing && !readOnly && (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const { pdMm, recMm } = parsePdRecInput(draft);
            if (pdMm !== null) onChange({ pdMm, recMm: recMm ?? 0 });
            setEditing(false);
          }}
          className="absolute inset-0 w-full bg-zinc-950 text-center font-mono text-[10px] text-zinc-100 outline-none"
        />
      )}

      {/* Indicadores en esquina superior derecha */}
      <div className="absolute right-[1px] top-[1px] flex flex-col gap-px">
        {site?.bop && <span className="h-1 w-1 rounded-full bg-red-500" title="Sangrado" />}
        {site?.plaque && <span className="h-1 w-1 rounded-full bg-blue-400" title="Placa" />}
        {site?.suppuration && <span className="h-1 w-1 rounded-full bg-orange-400" title="Supuración" />}
      </div>
    </button>
  );
}
```

### 6.5 `ToothCenter` — silueta del diente con FDI

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/ToothCenter.tsx
'use client';

import { toothCategory } from '@/lib/periodontics/site-helpers';

type Props = {
  fdi: number;
  arcade: 'upper' | 'lower';
  tooth?: ToothLevel;
  sites: Site[];
  onClick: () => void;
};

export function ToothCenter({ fdi, arcade, tooth, sites, onClick }: Props) {
  if (tooth?.absent) return <ToothAbsentSlot fdi={fdi} onClick={onClick} />;

  const category = toothCategory(fdi);
  const maxRec = Math.max(...sites.map((s) => s.recMm), 0);
  const maxRecVisualPx = Math.min(maxRec * 1.2, 8); // recesión visualizada como línea de inserción

  return (
    <button
      onClick={onClick}
      className="group relative flex h-12 w-9 items-center justify-center hover:bg-zinc-800/40"
      title={`Diente ${fdi}${tooth?.isImplant ? ' (implante)' : ''}`}
    >
      <ToothSilhouette category={category} arcade={arcade} isImplant={tooth?.isImplant} />

      {/* Línea de inserción (recesión) */}
      {maxRecVisualPx > 0 && (
        <div
          className="absolute left-1 right-1 h-px bg-orange-400/70"
          style={{ top: arcade === 'upper' ? `${4 + maxRecVisualPx}px` : `${36 - maxRecVisualPx}px` }}
        />
      )}

      {/* FDI debajo */}
      <span className="absolute -bottom-3 text-[8px] font-medium text-zinc-500">{fdi}</span>

      {/* Movilidad: estrellas */}
      {tooth && tooth.mobility >= 1 && (
        <span className="absolute -top-3 text-[8px] text-amber-400">
          {'★'.repeat(tooth.mobility)}
        </span>
      )}

      {/* Furca: triángulo */}
      {tooth && tooth.furcation >= 1 && (
        <span
          className="absolute right-0 bottom-0 text-[10px] leading-none"
          style={{
            color: tooth.furcation === 1 ? '#84CC16' : tooth.furcation === 2 ? '#EAB308' : '#EF4444',
          }}
        >
          ▲
        </span>
      )}
    </button>
  );
}

function ToothSilhouette({ category, arcade, isImplant }: { category: string; arcade: 'upper'|'lower'; isImplant?: boolean }) {
  // Silueta esquemática por categoría. Escala: 28×40.
  const fill = isImplant ? '#3F3F46' : '#52525B';
  if (category === 'molar') {
    return (
      <svg width="28" height="40" viewBox="0 0 28 40">
        <path
          d={arcade === 'upper'
            ? 'M 4 2 Q 4 0 6 0 L 22 0 Q 24 0 24 2 L 26 16 Q 26 18 24 18 L 4 18 Q 2 18 2 16 Z M 6 18 L 4 38 Q 4 40 6 40 L 22 40 Q 24 40 24 38 L 22 18 Z'
            : 'M 6 2 Q 4 0 4 2 L 2 24 Q 2 26 4 26 L 24 26 Q 26 26 26 24 L 24 2 Q 24 0 22 2 Z M 4 26 L 6 38 Q 6 40 8 40 L 20 40 Q 22 40 22 38 L 24 26 Z'
          }
          fill={fill} stroke="#71717A" strokeWidth="0.5"
        />
      </svg>
    );
  }
  // ... incisor, canine, premolar (siluetas distintas pero misma estructura)
  return <svg width="28" height="40" viewBox="0 0 28 40">{/* ... */}</svg>;
}
```

### 6.6 `LiveIndicators` — header del periodontograma

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/LiveIndicators.tsx

type Props = { metrics: PerioMetrics; saveStatus: 'idle'|'saving'|'saved'|'error' };

export function LiveIndicators({ metrics, saveStatus }: Props) {
  const bopTone = metrics.bopPct < 10 ? 'success' : metrics.bopPct < 25 ? 'warning' : 'danger';
  const plaqueTone = metrics.plaquePct < 20 ? 'success' : metrics.plaquePct < 40 ? 'warning' : 'danger';

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Indicator label="BoP %" value={`${metrics.bopPct}%`} tone={bopTone} hint="Meta: <10%" />
      <Indicator label="Placa O'Leary" value={`${metrics.plaquePct}%`} tone={plaqueTone} hint="Meta: <20%" />
      <Indicator label="Sitios 1-3mm" value={metrics.sites1to3} tone="muted" />
      <Indicator label="Sitios 4-5mm" value={metrics.sites4to5} tone="warning" />
      <Indicator label="Sitios ≥6mm" value={metrics.sites6plus} tone="danger" />
    </div>
  );
}
```

### 6.7 `ClassificationFooter` — Estadio + Grado + Extensión

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/ClassificationFooter.tsx
'use client';

import { useState } from 'react';
import { classifyPatient } from '../_actions/classifyPatient';
import { overrideClassification } from '../_actions/overrideClassification';

export function ClassificationFooter({ classification, recordId }: Props) {
  const [showOverride, setShowOverride] = useState(false);
  const [showInputs, setShowInputs] = useState(false);

  if (!classification) {
    return (
      <button
        onClick={() => classifyPatient({ recordId, modifiers: {} })}
        className="rounded-md border border-blue-700 bg-blue-900/30 px-4 py-2 text-sm text-blue-200"
      >
        Clasificar paciente (2017 AAP/EFP)
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">Clasificación 2017</h3>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-sm font-semibold text-zinc-100">
            {labelStage(classification.stage)}
            {classification.grade && ` · Grado ${classification.grade.replace('GRADE_', '')}`}
            {classification.extension && ` · ${labelExtension(classification.extension)}`}
          </span>
          {classification.overriddenByDoctor && (
            <span className="rounded bg-purple-500/15 px-2 py-0.5 text-[10px] text-purple-300">Sobrescrito</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowInputs(true)} className="text-xs text-zinc-400 hover:text-zinc-200">
            Ver cómo se calculó
          </button>
          <button onClick={() => setShowOverride(true)} className="text-xs text-blue-400 hover:text-blue-300">
            Sobrescribir
          </button>
        </div>
      </div>

      {showInputs && <ComputationInputsPopover inputs={classification.computationInputs} />}
      {showOverride && (
        <OverrideDialog classificationId={classification.id} current={classification} onClose={() => setShowOverride(false)} />
      )}
    </div>
  );
}
```

### 6.8 `KeyboardCaptureLayer` — listener global

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/KeyboardCaptureLayer.tsx
'use client';

import { useEffect } from 'react';

type Props = {
  focused: { fdi: number; position: SitePosition } | null;
  onAdvance: () => void;
  onPrevious: () => void;
  onToggleBop: () => void;
  onTogglePlaque: () => void;
  onToggleSuppuration: () => void;
};

export function KeyboardCaptureLayer(props: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // No interferir con inputs activos (la celda en edición tiene foco)
      const isInput = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (isInput && e.key !== 'Tab' && e.key !== 'Escape') return;

      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        props.onAdvance();
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        props.onPrevious();
      } else if (!isInput && e.key === ' ') {
        e.preventDefault();
        props.onToggleBop();
      } else if (!isInput && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        props.onTogglePlaque();
      } else if (!isInput && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        props.onToggleSuppuration();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [props]);

  return null;
}
```

### 6.9 `ToothDetailDrawer` — movilidad/furca/recesión

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/periodontogram/ToothDetailDrawer.tsx

export function ToothDetailDrawer({ fdi, tooth, recordId, onClose }: Props) {
  const [mobility, setMobility] = useState(tooth?.mobility ?? 0);
  const [furcation, setFurcation] = useState(tooth?.furcation ?? 0);
  const [absent, setAbsent] = useState(tooth?.absent ?? false);
  const [isImplant, setIsImplant] = useState(tooth?.isImplant ?? false);
  const [recession, setRecession] = useState({ height: 0, width: 0, kt: 0, surface: 'vestibular' as 'vestibular'|'lingual', cairo: 'RT1' as CairoClassification });

  // ... handler de save → upsertToothData + opcionalmente createGingivalRecession

  return (
    <Drawer onClose={onClose}>
      <DrawerHeader>Diente {fdi}</DrawerHeader>
      <DrawerBody>
        <Section title="Estado">
          <Toggle label="Ausente" checked={absent} onChange={setAbsent} />
          <Toggle label="Implante" checked={isImplant} onChange={setIsImplant} disabled={absent} />
        </Section>

        <Section title="Movilidad (Miller)">
          <RadioGroup
            value={mobility}
            options={[
              { value: 0, label: '0 — Fisiológica' },
              { value: 1, label: '1 — < 1mm horizontal' },
              { value: 2, label: '2 — > 1mm horizontal' },
              { value: 3, label: '3 — Vertical / desplazable' },
            ]}
            onChange={setMobility}
          />
        </Section>

        <Section title="Furca (Hamp)">
          <RadioGroup
            value={furcation}
            options={[
              { value: 0, label: '0 — Sin afectación' },
              { value: 1, label: 'I — Pérdida horizontal < 3mm' },
              { value: 2, label: 'II — Pérdida horizontal ≥ 3mm sin atravesar' },
              { value: 3, label: 'III — Atraviesa de lado a lado' },
            ]}
            onChange={setFurcation}
          />
        </Section>

        <Section title="Recesión (Cairo 2018)">
          <Select label="Superficie" value={recession.surface} options={['vestibular', 'lingual']} onChange={(v) => setRecession({...recession, surface: v as any})} />
          <NumberInput label="Altura recesión (mm)" value={recession.height} step={0.5} onChange={(v) => setRecession({...recession, height: v})} />
          <NumberInput label="Ancho recesión (mm)" value={recession.width} step={0.5} onChange={(v) => setRecession({...recession, width: v})} />
          <NumberInput label="Encía queratinizada (mm)" value={recession.kt} step={0.5} onChange={(v) => setRecession({...recession, kt: v})} />
          <Select label="Clasificación" value={recession.cairo} options={['RT1', 'RT2', 'RT3']} onChange={(v) => setRecession({...recession, cairo: v as any})} />
          <p className="text-xs text-zinc-500">RT1: sin pérdida interproximal · RT2: pérdida interproximal ≤ vestibular · RT3: pérdida interproximal &gt; vestibular</p>
        </Section>
      </DrawerBody>
      <DrawerFooter>
        <button onClick={onClose}>Cancelar</button>
        <button onClick={handleSave}>Guardar</button>
      </DrawerFooter>
    </Drawer>
  );
}
```

### 6.10 Sub-tab `Resumen`

Cards en grid 2-col en desktop, 1-col en mobile (mobile = solo lectura, recordar):

- **CurrentClassificationCard** — Estadio + Grado + Extensión actuales con fecha, link a "Ver historial".
- **BoPTrendChart** — `recharts` LineChart con últimas 5 visitas (eje X = fecha, eje Y = BoP%). Línea horizontal en 10% (meta). Línea horizontal en 30% (umbral de progresión). Datos vienen de query `prisma.periodontalRecord.findMany({ where: { patientId, deletedAt: null }, orderBy: { recordedAt: 'asc' }, take: 5 })`.
- **NextMaintenanceCard** — countdown a `nextEvaluationAt` del último `PeriodontalRiskAssessment`. Badge de riesgo (BAJO/MODERADO/ALTO).
- **ClinicalAlertsCard** — lista de alertas clínicas auto-generadas: sitios residuales >5mm con BoP, recesiones progresivas (delta vs anterior > 0.5mm), mantenimiento vencido, paciente con HbA1c >7% sin reevaluación reciente.
- **SystemicFactorsCard** — tags por modificador (Diabetes HbA1c X%, Fumador X cig/día, Embarazada, etc.).

### 6.11 Sub-tab `Plan`

```tsx
// src/app/dashboard/patients/[patientId]/periodontics/_components/PlanTab.tsx

export function PlanTab({ plan }: { plan: PeriodontalTreatmentPlan | null }) {
  if (!plan) return <EmptyPlan />;

  return (
    <div className="space-y-4">
      <PhaseProgress
        phases={[
          { key: 'PHASE_1', label: 'Fase 1 — Causal/Higiénica',     started: plan.phase1StartedAt, completed: plan.phase1CompletedAt },
          { key: 'PHASE_2', label: 'Fase 2 — Subgingival/SRP',       started: plan.phase2StartedAt, completed: plan.phase2CompletedAt },
          { key: 'PHASE_3', label: 'Fase 3 — Quirúrgica',            started: plan.phase3StartedAt, completed: plan.phase3CompletedAt },
          { key: 'PHASE_4', label: 'Fase 4 — Mantenimiento',         started: plan.phase4StartedAt, completed: null },
        ]}
        current={plan.currentPhase}
      />

      <QuadrantMap
        quadrants={getLatestSRPSession(plan)?.quadrantsCompleted}
      />

      <PlanTimeline plan={plan} />
    </div>
  );
}
```

`QuadrantMap` es un grid 2×2 (Q1/Q2 arriba, Q4/Q3 abajo — mirroring boca real). Cada cuadrante:
- Si completado: fondo verde + check + fecha.
- Si pendiente: fondo zinc + outline.
- Si en curso (algún sitio del cuadrante con SRP iniciado pero no terminado): fondo amarillo.

### 6.12 Sub-tab `Cirugías` y `Mantenimientos`

- **`SurgeryList`**: tabla con fecha, tipo, sitios intervenidos, biomateriales (chips), badge de estado post-op.
- **`BeforeAfterCompare`**: lado a lado de `PeriodontalRecord` pre y post quirúrgico del sitio. Slider para overlay.
- **`MaintenanceTable`**: tabla cronológica con BoP%, Plaque, sitios residuales por visita. Column sortable.
- **`BoPTrendChart`** dentro de mantenimientos, con todos los registros (no solo 5 últimos).
- **`RiskBadge`**: bajo (verde), moderado (amarillo), alto (rojo).

### 6.13 Página dedicada `/dashboard/specialties/periodontics`

Vista operativa, no clínica:

```tsx
// src/app/dashboard/specialties/periodontics/page.tsx

export default async function Page() {
  const overdue = await getOverdueMaintenancePatients();  // SQL query con riesgo
  const distribution = await getRiskDistribution();

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Periodoncia</h1>

      <OverdueMaintenanceWidget patients={overdue} />
      <RiskDistributionChart data={distribution} />
      <PerioPatientList />
    </div>
  );
}
```

`OverdueMaintenanceWidget`: tabla filtrable por riesgo (BAJO/MODERADO/ALTO), columnas: paciente, último mantenimiento, días vencido, riesgo, teléfono, acción rápida (botón "Llamar" + botón "WhatsApp"). El widget es la utilidad real para recepcionista.

---

## 7. Flujos UX

### 7.1 Flujo: paciente nuevo — primer sondaje

1. Doctor abre paciente → tab "Periodoncia".
2. Vista vacía: "Aún no se ha realizado periodontograma. Iniciar nuevo."
3. Clic en "Nuevo periodontograma" → abre `PeriodontogramGrid` con 192 sitios `unset` y modal de selección de tipo (`INICIAL`).
4. Foco automático en `18 MV` (primer sitio). Mensaje hint visible: "Teclea `5-2` para PD 5mm REC 2mm. Tab para avanzar. Espacio = sangrado, P = placa, S = supuración."
5. Doctor sondea con UNC-15 y captura. Métricas se actualizan en vivo arriba.
6. Al terminar 192 sitios + datos a nivel diente (drawer) → clic en "Calcular clasificación 2017".
7. Sistema corre algoritmo, muestra Estadio/Grado/Extensión + factores que llevaron al cálculo (expandible).
8. Doctor revisa, guarda. Si discrepa, clic "Sobrescribir" → modal pide justificación (mín 10 caracteres) → guarda override auditado.
9. Si paciente sin plan: prompt "Crear plan de tratamiento" → abre `Plan` con Fase 1 activa.
10. Audit log captura el record + la clasificación + la creación del plan.

### 7.2 Flujo: SRP por cuadrante

1. Doctor en sub-tab "Plan", marca paciente en Fase 2 → `advancePhase`.
2. Clic "Nueva sesión SRP" → drawer:
   - Técnica: SRP por cuadrante / FMD / FMS.
   - Instrumental: manual / ultrasónico / combinado.
   - Anestesia: bool + tipo.
   - Cuadrantes a tratar HOY: Q1 ✓, Q2 ✓ (resto pendiente).
   - Observaciones.
3. Guarda → encola WhatsApp template "Post-SRP estándar" para el paciente.
4. En próxima cita, abre la misma sesión y marca Q3 ✓, Q4 ✓.
5. Cuando los 4 cuadrantes están completos → sistema sugiere "Reevaluar a las 6-8 semanas" → crea cita propuesta en agenda.

### 7.3 Flujo: reevaluación post-Fase 2

1. 6-8 semanas después del SRP, doctor abre paciente → "Nuevo periodontograma" tipo `POST_FASE_2`.
2. Captura los 192 sitios.
3. Al guardar → sistema detecta record anterior tipo `INICIAL` o `PRE_TRATAMIENTO` y prompt: "¿Crear reevaluación comparativa?".
4. Doctor confirma → `createReevaluation` corre: calcula `bopImprovementPct`, `pdAverageImprovementMm`, `residualSites`, `surgicalCandidatesTeeth`.
5. Vista de comparativo lado a lado se abre automáticamente.
6. Si hay candidatos quirúrgicos: badge "X dientes candidatos a Fase 3".
7. Doctor decide: avanzar a Fase 3 o mantener Fase 2 con segundo refuerzo.

### 7.4 Flujo: cirugía periodontal con consentimiento

1. Sub-tab "Cirugías" → "Nueva cirugía".
2. Modal full-screen abre `SurgeryConsentModal`:
   - Tipo de cirugía (afecta el texto del consentimiento — el sistema escoge plantilla).
   - Riesgos y alternativas mostrados según tipo (RTG vs gingivectomía vs injerto).
   - Firma del paciente (canvas) + firma del doctor.
   - Sistema genera PDF y lo guarda como `PatientFile` con `FileCategory: CONSENT`.
3. Drawer `SurgeryDrawer`:
   - Sitios intervenidos (multiselect FDI + sitios).
   - Biomateriales (membrana, injerto óseo, etc.).
   - Tipo de sutura.
   - Foto intraoperatoria (upload → `PatientFile` con `FileCategory: PHOTO_INTRAORAL`, vinculado vía `intraoperativeFileId`).
4. Guarda → encola "Post-cirugía día 1" + "Post-cirugía día 7" (recordatorio retiro suturas).
5. Próximos sondajes en los sitios operados se marcan como protegidos durante 12 meses (no sondaje profundo).

### 7.5 Flujo: mantenimiento vencido (recepcionista)

1. Recepcionista abre `/dashboard/specialties/periodontics`.
2. Widget "Mantenimientos vencidos" muestra 23 pacientes ordenados por riesgo.
3. Filtra por "Alto riesgo" → 8 pacientes.
4. Para cada uno: clic "WhatsApp" → abre WhatsApp Web con plantilla pre-cargada (`whatsapp-templates.ts`).
5. Si confirma cita: clic "Agendar" → abre calendario en hueco sugerido de 45 min.
6. Audit log captura quién contactó a quién.

---

## 8. Integraciones con módulos existentes

### 8.1 Appointments

Duraciones sugeridas (configurables por clínica):

| Tipo de cita | Duración default |
|--------------|------------------|
| Sondaje completo (paciente nuevo) | 60 min |
| Mantenimiento periodontal | 45 min |
| SRP por cuadrante | 60 min |
| Full-mouth disinfection (1 sesión) | 120 min |
| Cirugía periodontal | 90-120 min |
| Reevaluación post-Fase 2 | 45 min |
| Retiro de suturas | 15 min |
| Control RTG 6 / 12 meses | 30 min |

Al agendar cita, si el paciente tiene `PeriodontalRiskAssessment` activo y la cita es de mantenimiento, el sistema valida que `recommendedRecallMonths` sea respetado (warning si se agenda antes/después).

### 8.2 SOAP pre-fill

```ts
// Cuando el doctor abre nota SOAP de paciente con módulo Periodoncia activo:

S (Subjetivo): pre-cargar quejas previas del último periodontograma + plantilla
  "Paciente refiere [sangrado al cepillado / mal aliento / movilidad / sensibilidad]"

O (Objetivo): pre-cargar
  "BoP %: {ultimo.bopPct}%
   Plaque Index O'Leary: {ultimo.plaqueIndexOleary}%
   Sitios ≥5mm: {ultimo.teethWithPockets5Plus} dientes
   Movilidad relevante: {tooth con mobility ≥ 2}
   Recesiones nuevas: {GingivalRecession del último mes}"

A (Análisis): pre-cargar clasificación 2017 actual
  "Periodontitis Estadio {stage}, Grado {grade}, {extension}"

P (Plan): pre-cargar fase actual del plan periodontal
  "Continuar Fase {currentPhase} del tratamiento periodontal.
   Próxima evaluación: {nextEvaluationAt}."
```

### 8.3 Plan de tratamiento general

Las 4 fases del plan periodontal se proyectan como ítems del plan general con dependencias:

```
Plan general:
├── [Periodoncia] Fase 1 — Higiene y profilaxis
├── [Periodoncia] Fase 2 — SRP completo (depende de Fase 1)
│   ├── SRP Q1
│   ├── SRP Q2
│   ├── SRP Q3
│   └── SRP Q4
├── [Periodoncia] Reevaluación 6-8 semanas (depende de Fase 2 completa)
├── [Periodoncia] Fase 3 — Cirugía (condicional, depende de reevaluación)
└── [Periodoncia] Mantenimiento cada 3/4/6 meses (ongoing)
```

### 8.4 Odontograma general

Dientes con `PeriodontalRecord.sites` que tengan PD ≥5mm en ≥2 sitios, o `mobility ≥ 2`, o `furcation ≥ 2`, se marcan en el odontograma general con un badge periodontal pequeño. Al hover muestra tooltip con métricas. Clic lleva al tab Periodoncia con el diente destacado.

```ts
// Pseudo-query
const periodontalFlaggedFdis = await prisma.$queryRaw`
  SELECT DISTINCT toothLevel
  FROM "PeriodontalRecord"
  WHERE "patientId" = ${patientId}
    AND "deletedAt" IS NULL
  ORDER BY "recordedAt" DESC
  LIMIT 1;
`;
// luego en JS extrae los FDI con criterios.
```

### 8.5 PatientFile (radiografías)

Reuso total. NO se crea modelo `Radiography`. Dos puntos de integración:

1. **Cálculo de Grado por pérdida ósea radiográfica**: el `XrayAnalysis` IA existente (que ya analiza radiografías panorámicas) recibirá un nuevo modo `PERIODONTAL_BONE_LOSS` que mide el porcentaje de pérdida ósea radiográfica desde la unión cemento-esmalte hasta el ápice. Este valor alimenta `boneLossPct` en `classifyPerio2017`.

2. **Foto intraoperatoria**: el campo `PeriodontalSurgery.intraoperativeFileId` apunta a `PatientFile` con `FileCategory: PHOTO_INTRAORAL`.

3. **Foto pre/post tratamiento mucogingival**: para cirugías de injerto, reuso del mismo patrón.

### 8.6 Recetas NOM-024 (3 plantillas)

#### Plantilla 1: Post-SRP estándar

```
RECETA MÉDICA
NOM-024-SSA3-2012

Paciente: {patient.name}
CURP: {patient.curp}
Edad: {patient.age} años
Fecha: {today}

Cédula profesional: {doctor.licenseNumber}
{doctor.name}

INDICACIONES:

1. Ibuprofeno 400 mg
   Tomar 1 tableta cada 8 horas por 2 días.
   En caso de molestia. Si la molestia persiste por más de 3 días, contactar al consultorio.

2. Clorhexidina 0.12% colutorio
   Enjuagar con 15 ml durante 30 segundos cada 12 horas por 14 días.
   No comer ni beber durante los 30 minutos posteriores al enjuague.

3. Cepillo dental ultrasuave
   Usar durante los primeros 7 días, luego retomar cepillo regular.

OBSERVACIONES:
- Evite alimentos muy calientes o ácidos durante las primeras 24 horas.
- Si presenta sangrado abundante, dolor intenso o fiebre: contacte al consultorio.

Firma: ____________________
{doctor.name}
Cédula: {doctor.licenseNumber}
```

#### Plantilla 2: Post-cirugía periodontal

```
RECETA MÉDICA
NOM-024-SSA3-2012

[encabezado igual]

INDICACIONES:

1. Amoxicilina 875 mg + Ácido clavulánico 125 mg
   Tomar 1 tableta cada 12 horas por 7 días.
   Iniciar inmediatamente después de la cirugía. Tomar todo el tratamiento aunque se sienta mejor.
   Tomar con alimentos.

2. Ibuprofeno 600 mg
   Tomar 1 tableta cada 8 horas por 3 días, luego cada 12 horas por 2 días más.
   Tomar con alimentos para prevenir gastritis.

3. Clorhexidina 0.12% colutorio
   Enjuagar con 15 ml durante 30 segundos cada 12 horas por 14 días.
   Iniciar a las 24 horas de la cirugía.

4. Compresas frías
   Aplicar sobre la mejilla del lado operado, 15 minutos cada hora durante las primeras 24 horas.

OBSERVACIONES:
- NO escupir, hacer gárgaras, fumar, ni usar pajillas durante 7 días.
- NO realizar ejercicio físico intenso durante 5 días.
- Cita de retiro de suturas: {sutureRemovalDate}.

Firma: ____________________
```

#### Plantilla 3: Periodontitis avanzada con compromiso sistémico (van Winkelhoff)

```
RECETA MÉDICA
NOM-024-SSA3-2012

[encabezado igual]

PROTOCOLO ANTIBIOTICOTERAPIA ADYUVANTE PERIODONTITIS ESTADIO IV
(Consenso EFP S3 2020 — administrar tras la fase activa de SRP)

INDICACIONES:

1. Metronidazol 400 mg
   Tomar 1 tableta cada 8 horas por 7 días.
   Iniciar el día del SRP completo. Tomar con alimentos.
   Evitar alcohol durante el tratamiento y 48 horas después.

2. Amoxicilina 500 mg
   Tomar 1 tableta cada 8 horas por 7 días.
   Sincronizar con el metronidazol.

3. Ibuprofeno 400 mg
   Tomar 1 tableta cada 8 horas por 2-3 días si hay molestia.

4. Clorhexidina 0.12% colutorio
   Enjuagar con 15 ml cada 12 horas por 14 días.

OBSERVACIONES:
- Importante: este protocolo se prescribe únicamente en periodontitis severa y progresiva.
- Si presenta diarrea, alergia o malestar intenso: suspender y contactar al consultorio.
- NO consumir alcohol durante 48 horas posteriores al término del tratamiento.

Firma: ____________________
```

### 8.7 Recordatorios WhatsApp (8 plantillas)

```ts
// src/lib/periodontics/whatsapp-templates.ts
export const PERIO_WHATSAPP_TEMPLATES = {
  PRE_MAINTENANCE: (months: number, patientName: string) => `
Hola ${patientName}, te escribo desde {clinicName}.

Es momento de tu mantenimiento periodontal. Tu última visita fue hace ${months} meses, y para mantener tus encías saludables es importante venir cada ${months} meses.

¿Te agendamos en los próximos días? Te ofrezco estos horarios: {availableSlots}.

— {doctorName}`.trim(),

  POST_SRP_DAY_0: (patientName: string) => `
Hola ${patientName}. Acabas de terminar tu primera sesión de raspado y alisado.

Recuerda:
• Toma tu ibuprofeno cada 8 horas por 2 días.
• Inicia los enjuagues con clorhexidina cada 12 horas por 14 días.
• Usa cepillo ultrasuave durante esta semana.
• Evita alimentos muy calientes o ácidos hoy.

Si tienes molestias intensas o sangrado abundante: escríbenos.

— {clinicName}`.trim(),

  POST_SRP_DAY_3: (patientName: string) => `
Hola ${patientName}, ¿cómo te sientes después de tu sesión de raspado?

Recuerda continuar con la clorhexidina cada 12 horas hasta completar 14 días.

Tu próxima cita es: {nextAppointmentDate}.

Si tienes dudas, escríbenos.

— {clinicName}`.trim(),

  POST_SURGERY_DAY_0: (patientName: string) => `
Hola ${patientName}. Tu cirugía periodontal terminó. Por favor sigue al pie de la letra:

• Aplica frío (compresas con hielo) sobre la mejilla 15 min cada hora durante las primeras 24 h.
• Toma tu medicamento como indicamos: amoxicilina cada 12 h, ibuprofeno cada 8 h.
• NO escupas, NO fumes, NO uses pajillas durante 7 días.
• NO te enjuagues vigorosamente por 24 h.
• Reposo relativo hoy y mañana.

Si presentas dolor intenso, sangrado abundante o fiebre: contáctanos de inmediato.

— {clinicName}`.trim(),

  POST_SURGERY_DAY_1: (patientName: string) => `
Buenos días ${patientName}. ¿Cómo amaneciste?

Recordatorio:
• Continúa con tu antibiótico (amoxicilina 875+125 cada 12 h).
• Inicia hoy los enjuagues con clorhexidina cada 12 h.
• Sigue con dieta blanda y fría 2-3 días más.

Cualquier duda, escríbenos.

— {clinicName}`.trim(),

  POST_SURGERY_DAY_7: (patientName: string, time: string) => `
Hola ${patientName}, te recordamos tu cita de retiro de suturas mañana a las ${time}.

Por favor, evita comer alimentos duros y sigue tu higiene cuidadosa hasta la cita.

— {clinicName}`.trim(),

  HYGIENE_INSTRUCTIONS: (patientName: string, items: string[]) => `
Hola ${patientName}, te comparto las recomendaciones de higiene oral personalizadas según lo que vimos hoy:

${items.map((s) => `• ${s}`).join('\n')}

Si tienes dudas, escríbenos.

— {clinicName}`.trim(),

  REEVAL_RESULT: (patientName: string, bopBefore: number, bopAfter: number) => `
Hola ${patientName}, tu reevaluación periodontal mostró excelentes resultados:

• Sangrado al sondaje (BoP): ${bopBefore}% → ${bopAfter}%
• {pocketImprovement}

¡Sigue así! Tu próximo mantenimiento es: {nextDate}.

— {clinicName}`.trim(),
};
```

### 8.8 Audit log

Cada mutación clínica registra en `AuditLog` con:

- `userId`, `clinicId`, `entity`, `entityId`, `action`, `before`, `after`, `meta`.
- Acciones especiales: `UPDATE_SITE` (granular en sitio), `OVERRIDE` (sobrescritura clasificación), `ADVANCE_PHASE`, `CREATE_REEVALUATION`.
- En consulta de auditoría se reconstruye el historial completo del periodontograma evento por evento.

---
## 9. Reportes / Exportes PDF

### 9.1 PDF "Informe periodontal del paciente"

Lenguaje accesible, no técnico. 4-6 páginas:

1. **Página 1** — Datos del paciente, fecha del informe, doctor responsable. Resumen visual: clasificación 2017 traducida ("Periodontitis moderada generalizada de progresión rápida — Estadio III, Grado C").
2. **Página 2** — Periodontograma actual a tamaño legible (full page landscape), con leyenda de color.
3. **Página 3** — Evolución BoP% últimas visitas (gráfico), comparativo con visita anterior si existe.
4. **Página 4** — Plan en lenguaje accesible: "Tu tratamiento consiste en 4 fases. Estás en la Fase X. La siguiente cita es...".
5. **Página 5** — Recomendaciones de higiene personalizadas (instrucciones generadas según hallazgos).

Implementación: `react-pdf` (`@react-pdf/renderer`). Plantilla en `src/lib/periodontics/pdf-templates/perio-report.tsx`.

```tsx
// src/lib/periodontics/pdf-templates/perio-report.tsx
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  h1: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#0F172A' },
  h2: { fontSize: 14, fontWeight: 'bold', marginTop: 16, marginBottom: 6, color: '#334155' },
  meta: { fontSize: 9, color: '#64748B', marginBottom: 4 },
  sectionBox: { padding: 10, backgroundColor: '#F1F5F9', borderRadius: 4, marginBottom: 12 },
});

export function PerioReportPDF({ patient, classification, record, plan, recommendations, doctor }: Props) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Informe periodontal</Text>
        <Text style={styles.meta}>Paciente: {patient.name}  ·  Edad: {patient.age}  ·  Fecha: {today}</Text>
        <Text style={styles.meta}>Dr./Dra. {doctor.name}  ·  Cédula {doctor.licenseNumber}</Text>

        <View style={styles.sectionBox}>
          <Text style={styles.h2}>Tu diagnóstico</Text>
          <Text>{translateClassificationToPlainSpanish(classification)}</Text>
        </View>

        <View style={styles.sectionBox}>
          <Text style={styles.h2}>¿Qué significa esto?</Text>
          <Text>{getDiagnosisExplanation(classification)}</Text>
        </View>

        <View style={styles.sectionBox}>
          <Text style={styles.h2}>Tu plan de tratamiento</Text>
          <Text>{describePhaseProgress(plan)}</Text>
        </View>
      </Page>

      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.h1}>Periodontograma actual</Text>
        <PeriodontogramSVGForPdf record={record} />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Recomendaciones de higiene</Text>
        {recommendations.map((r, i) => (
          <Text key={i}>• {r}</Text>
        ))}
      </Page>
    </Document>
  );
}
```

### 9.2 PDF "Reporte legal al médico tratante"

Para diabéticos (HbA1c documentada), embarazadas, cardiópatas, oncológicos. Lenguaje técnico:

1. Encabezado con membretado de la clínica + cédula profesional del periodoncista.
2. Datos del paciente + condición sistémica relevante.
3. Diagnóstico periodontal completo (clasificación 2017 + factores).
4. Hallazgos relevantes (BoP%, sitios profundos, pérdida ósea radiográfica si aplica).
5. Plan periodontal y pronóstico.
6. Recomendaciones de coordinación interdisciplinaria.
7. Firma del periodoncista + cédula.

Generación: clic en `Resumen` → "Generar reporte para médico tratante" → modal con campos `medicoDestinoNombre`, `medicoDestinoEmail`, `recomendaciones`. Al guardar genera PDF, lo guarda como `PatientFile` con `FileCategory: REFERRAL_LETTER`.

### 9.3 PDF "Comparativo pre/post"

Lado a lado de dos periodontogramas. Tabla de cambios por sitio: PD antes/después, delta, marcado en verde si mejoró, rojo si empeoró. Métricas globales: BoP antes/después, Plaque antes/después, sitios ≥6mm antes/después.

```tsx
// src/lib/periodontics/pdf-templates/pre-post-compare.tsx
export function PrePostComparePDF({ initial, post, deltas }: Props) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.h1}>Comparativo pre/post tratamiento</Text>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h2}>Inicial · {format(initial.recordedAt)}</Text>
            <PeriodontogramSVGForPdf record={initial} />
            <MetricsBlock record={initial} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.h2}>Post-Fase 2 · {format(post.recordedAt)}</Text>
            <PeriodontogramSVGForPdf record={post} />
            <MetricsBlock record={post} />
          </View>
        </View>

        <View style={styles.sectionBox}>
          <Text style={styles.h2}>Cambios significativos</Text>
          <Text>BoP: {initial.bopPercentage}% → {post.bopPercentage}% (Δ {deltas.bop > 0 ? '+' : ''}{deltas.bop.toFixed(1)}%)</Text>
          <Text>Plaque Index: {initial.plaqueIndexOleary}% → {post.plaqueIndexOleary}%</Text>
          <Text>Sitios ≥6mm: {initial.sites6PlusMm} → {post.sites6PlusMm}</Text>
          <Text>Sitios residuales con BoP+: {deltas.residualCount}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

---

## 10. Compliance NOM-024 / LFPDPPP

### 10.1 NOM-024-SSA3-2012

- **Conservación**: cada `PeriodontalRecord` se conserva 5 años mínimo. Soft delete via `deletedAt` permite ocultar sin destruir. La purga real se hace solo después de 5 años por job programado.
- **Audit log obligatorio**: cualquier `UPDATE` o `OVERRIDE` queda registrado con `before`/`after`. Importante para el caso de modificación de un periodontograma anterior — la versión original siempre es recuperable.
- **Identificación del responsable**: cada record y cada clasificación llevan `doctorId` o `classifiedById` con cédula profesional consultable vía `User` joined.
- **Receta NOM-024**: las 3 plantillas siguen el formato requerido (datos del paciente, dosis exacta, duración, motivo, firma + cédula).

### 10.2 LFPDPPP

- **Aviso de privacidad reforzado**: pacientes con condiciones sistémicas (diabetes, embarazo, VIH+, oncológicos) ven un módulo adicional en su consentimiento de tratamiento que explicita: "Su periodontograma y clasificación pueden ser compartidos con su médico tratante con fines de coordinación interdisciplinaria."
- **Consentimiento explícito para compartir**: antes de generar el PDF al médico tratante, el sistema muestra un modal de confirmación. El paciente firma una vez al inicio del tratamiento (consentimiento amplio) o por evento (granular). Decisión: amplio al inicio + log granular de cada compartición.
- **Derecho al olvido**: el paciente puede solicitar baja. Sistema marca `deletedAt` en todos los modelos relacionados. Conservación legal de 5 años de los datos clínicos sigue aplicando — el sistema notifica al paciente que la baja es completa solo tras los 5 años.

### 10.3 Texto del consentimiento informado de SRP

```ts
// src/lib/periodontics/consent-texts.ts
export const SRP_CONSENT_TEXT = `
CONSENTIMIENTO INFORMADO PARA RASPADO Y ALISADO RADICULAR (SRP)

Yo, {patientName}, con domicilio en {patientAddress}, en pleno uso de mis facultades, autorizo
al Dr./Dra. {doctorName} (cédula profesional {doctorLicense}) a realizarme el procedimiento
de raspado y alisado radicular en {scope: 'boca completa' | 'cuadrantes Q1, Q2'}.

He sido informado(a) sobre:

1. EN QUÉ CONSISTE
   El raspado y alisado radicular es un procedimiento mediante el cual se elimina la placa
   bacteriana, el sarro y las toxinas adheridas a la superficie de las raíces de los dientes,
   por debajo de la línea de la encía. Se realiza con instrumentos manuales (curetas) y/o
   instrumentos ultrasónicos.

2. POR QUÉ SE ME REALIZA
   Tengo periodontitis (clasificación 2017: {classification}). Sin tratamiento, esta enfermedad
   puede llevar a la pérdida de los dientes. El raspado es la primera línea de tratamiento
   y reduce la inflamación, el sangrado y la profundidad de las bolsas periodontales.

3. RIESGOS Y MOLESTIAS
   - Sensibilidad dental al frío y al calor durante 1-4 semanas posteriores.
   - Recesión gingival adicional al desinflamarse las encías, lo que puede exponer raíces.
   - Aumento transitorio de la movilidad dental en casos avanzados.
   - Necesidad de cirugía periodontal en sitios donde el raspado no resuelva las bolsas profundas.
   - Sangrado y molestia leve durante 24-48 horas.

4. ALTERNATIVAS
   - No realizar tratamiento (riesgo de progresión y pérdida dental).
   - Higiene casera reforzada solamente (insuficiente para periodontitis confirmada).

5. CUIDADOS POSTERIORES
   - Tomar los medicamentos prescritos en los horarios indicados.
   - Usar el colutorio de clorhexidina por 14 días.
   - Acudir a la cita de reevaluación a las 6-8 semanas.
   - Mantener mantenimiento periodontal cada 3-6 meses según riesgo.

He tenido la oportunidad de hacer todas las preguntas que consideré necesarias y han sido
respondidas a mi satisfacción. Doy mi consentimiento libre y voluntariamente.

Firma del paciente: _____________________      Fecha: _____________________

Firma del doctor:   _____________________      Cédula: {doctorLicense}
`.trim();
```

### 10.4 Texto del consentimiento informado de cirugía periodontal

```ts
export const SURGERY_CONSENT_TEXT = (surgeryType: PeriodontalSurgeryType) => {
  const specificRisks: Record<PeriodontalSurgeryType, string[]> = {
    COLGAJO_ACCESO: [
      'Recesión gingival post-quirúrgica (esperable, parte de la cicatrización).',
      'Sensibilidad radicular prolongada.',
      'Reabsorción ósea periférica.',
    ],
    GINGIVECTOMIA: [
      'Cicatrización por segunda intención (más lenta).',
      'Pérdida de papila interdental.',
    ],
    RESECTIVA_OSEA: [
      'Recesión gingival significativa.',
      'Sensibilidad radicular.',
      'Pérdida de altura ósea adicional intencional para crear contornos fisiológicos.',
    ],
    RTG: [
      'Posible exposición de la membrana antes de la cicatrización completa.',
      'Fracaso del injerto óseo en 5-15% de los casos.',
      'Necesidad de retirar la membrana en una segunda cirugía si es no reabsorbible.',
      'Reacción a biomateriales (rara).',
    ],
    INJERTO_GINGIVAL_LIBRE: [
      'Necrosis del injerto en 3-8% de los casos.',
      'Cicatriz visible en zona donante (paladar).',
      'Aspecto estético del injerto puede diferir del tejido circundante.',
    ],
    INJERTO_TEJIDO_CONECTIVO: [
      'Necrosis del injerto en 3-10% de los casos.',
      'Molestia en zona donante (paladar) por 1-2 semanas.',
    ],
    TUNELIZACION: [
      'Perforación involuntaria del colgajo.',
      'Necrosis parcial del colgajo en 2-5% de los casos.',
    ],
    CORONALLY_ADVANCED_FLAP: [
      'Recidiva de la recesión en 15-25% de los casos a 5 años.',
      'Tensión del colgajo puede causar molestia inicial.',
    ],
    OTRO: [
      'Riesgos específicos del procedimiento serán explicados verbalmente y consignados en nota clínica.',
    ],
  };

  return `
CONSENTIMIENTO INFORMADO PARA CIRUGÍA PERIODONTAL

Yo, {patientName}, autorizo al Dr./Dra. {doctorName} (cédula {doctorLicense}) a realizarme
una cirugía periodontal del tipo: ${labelSurgeryType(surgeryType)}.

Se intervendrán los siguientes dientes/sitios: {treatedSites}.

He sido informado(a) sobre:

1. EN QUÉ CONSISTE
   ${getSurgeryDescription(surgeryType)}

2. RIESGOS ESPECÍFICOS DE ESTE PROCEDIMIENTO
${specificRisks[surgeryType].map((r) => `   - ${r}`).join('\n')}

3. RIESGOS GENERALES DE TODA CIRUGÍA ORAL
   - Inflamación, hematoma y dolor moderado durante 3-7 días.
   - Sangrado postoperatorio leve.
   - Infección post-quirúrgica (poco frecuente con antibiótico profiláctico).
   - Reacción a la anestesia local (rara).
   - Dehiscencia de sutura.

4. ALTERNATIVAS
   - No realizar cirugía (riesgo de progresión periodontal y pérdida dental en sitios afectados).
   - Continuar solo con tratamiento no quirúrgico (insuficiente cuando hay sitios residuales ≥5mm con BoP+).

5. CUIDADOS POSTERIORES (ESTRICTOS)
   - Antibiótico completo aunque me sienta bien.
   - NO escupir, fumar ni usar pajillas durante 7 días.
   - Compresas frías 24h.
   - Dieta blanda y fría 3 días.
   - Reposo relativo 48h.
   - Cita de retiro de suturas a los 7-14 días.
   - Control postoperatorio a los 6 y 12 meses.

He tenido la oportunidad de hacer todas las preguntas y han sido respondidas. Doy mi
consentimiento libre y voluntariamente.

Firma del paciente: _____________________      Fecha: _____________________

Firma del doctor:   _____________________      Cédula: {doctorLicense}
`.trim();
};
```

---

## 11. Estados visuales

| Estado | Visual |
|--------|--------|
| **Vacío (sin periodontograma)** | Onboarding card centrado: ilustración mini-periodontograma + CTA "Iniciar primer sondaje". |
| **En captura** | Sitios sin capturar = `bg-zinc-900` con `·`. Sitios capturados = color por severidad. Banner "X / 192 sitios" arriba. |
| **Completo** | 192/192 sitios + datos a nivel diente. Banner verde "Periodontograma completo · Listo para clasificar". |
| **Salud periodontal** | Periodontograma mayoritariamente verde, casi sin puntos rojos de BoP. Footer: "Salud periodontal — sin acción terapéutica adicional, mantener higiene." |
| **Gingivitis** | Verde con muchos puntos rojos de BoP. Footer: "Gingivitis inducida por placa." |
| **Periodontitis avanzada** | Mucho rojo en celdas, dientes ausentes, movilidad alta. Footer rojo: "Estadio IV, Grado C, Generalizada — Plan inmediato Fase 2." |
| **Comparativo pre/post** | Dos grids lado a lado o overlay con slider; celdas marcadas con delta colorimétrico (verde si mejoró). |
| **Mantenimiento vencido** | Banner persistente naranja arriba del paciente: "Mantenimiento vencido por X días según riesgo {category}". |
| **Sitio quirúrgico protegido** | Diente con sitio operado en últimos 12m → halo verde-azulado en `ToothCenter`. Tooltip "No sondaje profundo hasta {12m post-cirugía}". |
| **Peri-implantitis** | Implantes con `PeriImplantStatus !== SALUD` → silueta del diente con fill metálico distintivo + badge según severidad. |

### Codificación cromática consolidada

| Token | Hex | Uso |
|-------|-----|-----|
| `--success` | `#22C55E` | PD 1-3mm, mejoría comparativa, riesgo BAJO, fase completada |
| `--warning` | `#EAB308` | PD 4-5mm, riesgo MODERADO, fase en curso |
| `--danger`  | `#EF4444` | PD ≥6mm, riesgo ALTO, fase pendiente urgente |
| `BoP+`      | `#EF4444` (punto) | Sangrado al sondaje |
| `Placa+`    | `#3B82F6` (punto) | Placa bacteriana |
| `Supuración+` | `#F97316` (punto) | Supuración |
| Recesión visible | `#FB923C` (línea) | Línea de inserción gingival movida |
| Furca I / II / III | `#84CC16` / `#EAB308` / `#EF4444` | Triángulo coloreado por grado |
| Implante | `#3F3F46` (fill metálico) | Silueta diferenciada de diente natural |

---

## 12. Mock data — 3 pacientes

`prisma/seeds/periodontics-mock.ts` debe sembrar exactamente estos 3 pacientes (deterministicos para reproducibilidad).

### 12.1 Paciente 1 — María Pérez Rodríguez (38, Estadio III Grado C Generalizada)

```ts
{
  id: 'pat_perio_maria',
  name: 'María Pérez Rodríguez',
  birthDate: '1987-04-12',
  gender: 'F',
  phone: '+529991122334',
  systemicFactors: {
    smokingCigsPerDay: 12,
    smokingYearsActive: 16,
    diabetic: false,
    pregnancy: false,
    bruxism: true,
  },
  clinicId: 'clinic_demo',
}

// PeriodontalRecord — sondaje inicial
{
  id: 'rec_maria_inicial',
  patientId: 'pat_perio_maria',
  doctorId: 'doc_demo',
  recordedAt: '2024-10-15T10:00:00Z',
  recordType: 'INICIAL',
  sites: [
    // 16 — diente con problema importante
    { fdi: 16, position: 'MV', pdMm: 6, recMm: 1, bop: true, plaque: true, suppuration: false },
    { fdi: 16, position: 'MB', pdMm: 5, recMm: 0, bop: true, plaque: true, suppuration: false },
    { fdi: 16, position: 'DV', pdMm: 7, recMm: 2, bop: true, plaque: true, suppuration: false },
    { fdi: 16, position: 'MB_PAL', pdMm: 5, recMm: 0, bop: true, plaque: false, suppuration: false },
    { fdi: 16, position: 'ML', pdMm: 4, recMm: 0, bop: true, plaque: false, suppuration: false },
    { fdi: 16, position: 'DL', pdMm: 6, recMm: 1, bop: true, plaque: true, suppuration: false },
    // 26 — peor sitio (con supuración)
    { fdi: 26, position: 'DV', pdMm: 7, recMm: 2, bop: true, plaque: true, suppuration: true },
    { fdi: 26, position: 'DL', pdMm: 6, recMm: 1, bop: true, plaque: true, suppuration: true },
    // ... resto de 26 dientes con generador determinístico
    // Total = 32 × 6 = 192 sitios
  ],
  toothLevel: [
    { fdi: 16, mobility: 1, furcation: 2, absent: false, isImplant: false },
    { fdi: 26, mobility: 1, furcation: 1, absent: false, isImplant: false },
    { fdi: 31, mobility: 2, furcation: 0, absent: false, isImplant: false },
    { fdi: 41, mobility: 2, furcation: 0, absent: false, isImplant: false },
    { fdi: 36, mobility: 1, furcation: 1, absent: false, isImplant: false },
    { fdi: 46, mobility: 1, furcation: 1, absent: false, isImplant: false },
    // ... resto sin movilidad ni furca
  ],
  bopPercentage: 68,
  plaqueIndexOleary: 81,
  sites1to3mm: 70,
  sites4to5mm: 80,
  sites6PlusMm: 35,
  teethWithPockets5Plus: 14,
  notes: 'Paciente refiere sangrado al cepillado y mal aliento desde hace 1 año. Bruxismo nocturno. Fumadora 12 cig/día.',
  durationMinutes: 65,
}

// PeriodontalClassification
{
  id: 'cls_maria',
  periodontalRecordId: 'rec_maria_inicial',
  stage: 'STAGE_III',
  grade: 'GRADE_C',
  extension: 'GENERALIZADA',
  modifiers: { smokingCigsPerDay: 12, otherFactors: ['bruxismo'] },
  computationInputs: {
    maxCalInterproximalMm: 8,
    maxBoneLossPct: 45,
    maxPdMm: 7,
    lostTeethPerio: 0,
    complexityFactors: ['movilidad ≥2 (31, 41)', 'furca II (16)', 'PD ≥6mm'],
    boneLossAgeRatio: 1.18,
    bopPct: 68,
    affectedTeethPct: 87,
  },
  calculatedAutomatically: true,
  overriddenByDoctor: false,
}

// PeriodontalTreatmentPlan
{
  id: 'plan_maria',
  patientId: 'pat_perio_maria',
  currentPhase: 'PHASE_1',
  phase1StartedAt: '2024-10-15T10:00:00Z',
  nextEvaluationAt: '2024-10-22T10:00:00Z',
  planNotes: 'Refiere a apoyo médico para cesación tabáquica. Fase 2 programada en 1 semana — full-mouth disinfection.',
}

// PeriodontalRiskAssessment
{
  patientId: 'pat_perio_maria',
  evaluatedAt: '2024-10-15T10:00:00Z',
  bopPct: 68,
  residualSites5Plus: 35,
  lostTeethPerio: 0,
  smokingStatus: 'MAYOR_O_IGUAL_10',
  riskCategory: 'ALTO',
  recommendedRecallMonths: 3,
}
```

### 12.2 Paciente 2 — Juan López Hernández (55, regresión leve en mantenimiento)

```ts
{
  id: 'pat_perio_juan',
  name: 'Juan López Hernández',
  birthDate: '1970-09-23',
  gender: 'M',
  phone: '+529991233455',
  systemicFactors: {
    smokingCigsPerDay: 0,
    exSmokerSince: '2024-01-01',
    diabetic: true,
    hba1c: 6.5,
    pregnancy: false,
  },
  clinicId: 'clinic_demo',
}

// 2 records: hace 4 meses + hoy
{
  id: 'rec_juan_4m',
  recordedAt: '2025-12-15T10:00:00Z',
  recordType: 'MANTENIMIENTO',
  bopPercentage: 12,
  plaqueIndexOleary: 22,
  sites1to3mm: 175,
  sites4to5mm: 14,
  sites6PlusMm: 3,
  teethWithPockets5Plus: 3,
}

{
  id: 'rec_juan_hoy',
  recordedAt: '2026-04-15T10:00:00Z',
  recordType: 'MANTENIMIENTO',
  bopPercentage: 18,
  plaqueIndexOleary: 35,
  sites1to3mm: 168,
  sites4to5mm: 19,
  sites6PlusMm: 5,
  teethWithPockets5Plus: 5,
}

// Risk assessment recalculado
{
  evaluatedAt: '2026-04-15T10:00:00Z',
  bopPct: 18,
  residualSites5Plus: 5,
  lostTeethPerio: 0,
  smokingStatus: 'NO',
  hba1c: 6.5,
  riskCategory: 'MODERADO',
  recommendedRecallMonths: 4,
}

// PeriodontalClassification (estable)
{
  id: 'cls_juan',
  periodontalRecordId: 'rec_juan_hoy',
  stage: 'STAGE_II',
  grade: 'GRADE_B',
  extension: 'LOCALIZADA',
  modifiers: { hba1c: 6.5, otherFactors: ['ex-fumador'] },
  calculatedAutomatically: true,
}
```

### 12.3 Paciente 3 — Carmen Sánchez Vega (62, post-RTG en 36, control 8 semanas)

```ts
{
  id: 'pat_perio_carmen',
  name: 'Carmen Sánchez Vega',
  birthDate: '1963-06-08',
  gender: 'F',
  phone: '+529991344566',
  clinicId: 'clinic_demo',
}

// PeriodontalRecord pre-cirugía (Estadio IV Grado B)
{
  id: 'rec_carmen_precirugia',
  recordedAt: '2026-02-20T10:00:00Z',
  recordType: 'CIRUGIA_PRE',
  sites: [
    { fdi: 36, position: 'DL', pdMm: 9, recMm: 1, bop: true, plaque: false, suppuration: false },
    { fdi: 36, position: 'DV', pdMm: 7, recMm: 1, bop: true, plaque: false, suppuration: false },
  ],
  toothLevel: [
    { fdi: 36, mobility: 1, furcation: 2, absent: false, isImplant: false },
  ],
  bopPercentage: 22,
  plaqueIndexOleary: 28,
  sites6PlusMm: 8,
  teethWithPockets5Plus: 7,
}

// PeriodontalSurgery — RTG
{
  id: 'sur_carmen_rtg',
  surgeryType: 'RTG',
  treatedSites: [{ fdi: 36, sites: ['DL'] }],
  biomaterials: {
    membrane: 'Bio-Gide (membrana colágena reabsorbible)',
    boneGraft: 'Bio-Oss (xenogénico bovino)',
    others: [],
  },
  sutureType: 'PTFE 5-0',
  surgeryDate: '2026-02-22T09:00:00Z',
  sutureRemovalDate: '2026-03-01T09:00:00Z',
  postOpComplications: null,
  intraoperativeFileId: 'file_carmen_intraop_rtg',
  consentSignedFileId: 'file_carmen_consent_rtg',
}

// PeriodontalRecord post-cirugía 8 semanas
{
  id: 'rec_carmen_postcirugia',
  recordedAt: '2026-04-19T10:00:00Z',
  recordType: 'CIRUGIA_POST',
  comparedToRecordId: 'rec_carmen_precirugia',
  sites: [
    { fdi: 36, position: 'DL', pdMm: 4, recMm: 2, bop: false, plaque: false, suppuration: false },
    { fdi: 36, position: 'DV', pdMm: 4, recMm: 2, bop: false, plaque: false, suppuration: false },
  ],
  toothLevel: [
    { fdi: 36, mobility: 0, furcation: 1, absent: false, isImplant: false },
  ],
}
```

---

## 13. Testing

### 13.1 Tests unitarios

```ts
// tests/lib/periodontics/classification-2017.test.ts
describe('classifyPerio2017', () => {
  it('clasifica salud cuando todos los sitios PD ≤3 y BoP <10%', () => {});
  it('clasifica gingivitis cuando BoP ≥10% pero CAL = 0', () => {});
  it('clasifica Estadio I cuando max CAL interproximal 1-2mm', () => {});
  it('clasifica Estadio II cuando max CAL 3-4mm', () => {});
  it('clasifica Estadio III cuando max CAL ≥5mm sin complejidad alta', () => {});
  it('clasifica Estadio IV cuando max CAL ≥5 + ≥5 dientes perdidos', () => {});
  it('grado C por boneLossAgeRatio >1.0', () => {});
  it('sube grado de B a C cuando smokingCigsPerDay ≥10', () => {});
  it('sube grado de A a B cuando hba1c ≥7', () => {});
  it('detecta patrón molar/incisivo cuando solo molares e incisivos afectados', () => {});
});

// tests/lib/periodontics/periodontogram-math.test.ts
describe('computePerioMetrics', () => {
  it('calcula BoP% sobre sitios de dientes presentes', () => {});
  it('excluye dientes ausentes del denominador', () => {});
  it('cuenta correctamente sitios 1-3, 4-5, ≥6mm', () => {});
  it('teethWithPockets5plus es número de dientes con ≥1 sitio ≥5mm', () => {});
});

// tests/lib/periodontics/keyboard-shortcuts.test.ts
describe('parsePdRecInput', () => {
  it('parsea "5-2" como pd=5 rec=2', () => {});
  it('parsea "5" como pd=5 rec=null', () => {});
  it('parsea "/2" sin valor pd', () => {});
  it('rechaza valores fuera de rango (pd >15, rec <-5 o >15)', () => {});
});

// tests/lib/periodontics/risk-berna.test.ts
describe('computeBernaRisk', () => {
  it('riesgo BAJO con BoP <10, sitios residuales ≤4, sin tabaco', () => {});
  it('riesgo ALTO con BoP ≥25 o tabaco ≥10/día o HbA1c ≥7.5', () => {});
  it('recommendedRecallMonths: BAJO=6, MODERADO=4, ALTO=3', () => {});
});

// tests/lib/periodontics/site-helpers.test.ts
describe('nextSite', () => {
  it('avanza MV → MB → DV → DL → ML → MB_PAL', () => {});
  it('al terminar 6 sitios pasa al siguiente diente FDI', () => {});
  it('en último diente último sitio retorna null', () => {});
});
```

### 13.2 Tests de integración (Playwright)

```ts
// tests/e2e/periodontics.spec.ts
test('captura completa de periodontograma con teclado', async ({ page }) => {
  await login(page, 'doctor@demo.com');
  await page.goto('/dashboard/patients/pat_perio_demo/periodontics');
  await page.click('text=Nuevo periodontograma');

  for (let i = 0; i < 192; i++) {
    await page.keyboard.type('5-2');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
  }

  await expect(page.locator('[data-testid=bop-pct]')).toContainText('100%');
  await expect(page.locator('[data-testid=sites-4-5]')).toContainText('192');

  await page.click('text=Clasificar paciente');
  await expect(page.locator('[data-testid=classification-stage]')).toContainText('Estadio III');
});

test('sobrescribir clasificación requiere justificación', async ({ page }) => {
  await page.click('text=Sobrescribir');
  await page.click('text=Estadio IV');
  await page.click('text=Guardar');
  await expect(page.locator('text=Justifica la sobrescritura')).toBeVisible();
});

test('reevaluación calcula sitios residuales y candidatos quirúrgicos', async ({ page }) => {
  await expect(page.locator('[data-testid=residual-sites]')).toContainText('5');
  await expect(page.locator('[data-testid=surgical-candidates]')).toContainText('36, 26');
});

test('mobile = read-only del periodontograma', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto('/dashboard/patients/pat_perio_demo/periodontics');
  await expect(page.locator('text=Nuevo periodontograma')).not.toBeVisible();
  await expect(page.locator('text=Para captura, abre desde tablet o escritorio')).toBeVisible();
});

test('atajos de teclado funcionan: espacio toggle BoP, P toggle placa, S toggle supuración', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(page.locator('[data-testid=site-16-MV-bop]')).toHaveAttribute('data-active', 'true');
});

test('autosave debounced — guarda después de 300ms sin cambios', async ({ page }) => {
  await page.keyboard.type('5-2');
  await page.waitForTimeout(150);
  await expect(page.locator('text=Guardando...')).not.toBeVisible();
  await page.waitForTimeout(200);
  await expect(page.locator('text=Guardado')).toBeVisible();
});

test('odontograma general muestra badge en dientes con bolsas ≥5mm', async ({ page }) => {
  await page.goto('/dashboard/patients/pat_perio_demo');
  await expect(page.locator('[data-testid=odontogram-tooth-16] [data-testid=perio-badge]')).toBeVisible();
});
```

### 13.3 Tests de RLS (multi-tenant)

```ts
// tests/db/rls-periodontics.test.ts
test('clínica A no ve PeriodontalRecord de clínica B', async () => {
  await setClinicContext('clinic_A');
  const records = await prisma.periodontalRecord.findMany();
  expect(records.every((r) => r.clinicId === 'clinic_A')).toBe(true);
});

test('clínica A no puede modificar PeriodontalSurgery de clínica B', async () => {
  await setClinicContext('clinic_A');
  await expect(
    prisma.periodontalSurgery.update({ where: { id: 'sur_clinic_B' }, data: { sutureType: 'X' } }),
  ).rejects.toThrow();
});
```

### 13.4 Tests visuales (snapshot)

Storybook + Chromatic. Snapshots de:
- `SiteCell` en cada estado (unset, verde, amarillo, rojo, focused, con BoP/placa/sup).
- `ToothColumn` con superior incisivo, premolar, molar.
- `PeriodontogramGrid` con datos de los 3 pacientes mock.
- `ClassificationFooter` con cada combinación stage/grade/extension.
- `OverdueMaintenanceWidget` con 0, 5, 23 pacientes.
- `BoPTrendChart` con 1, 5, 20 puntos de datos.
- `QuadrantMap` con 0, 1, 2, 3, 4 cuadrantes completados.

### 13.5 Tests de compliance

```ts
test('record soft-deleted preserva datos en backup 5 años', async () => {});
test('audit log captura UPDATE_SITE con fdi y position en meta', async () => {});
test('OVERRIDE de clasificación queda registrado con before/after', async () => {});
test('PDF receta NOM-024 incluye nombre, cédula y firma del doctor', async () => {});
test('compartir con médico tratante requiere consentimiento explícito', async () => {});
test('consentimiento de cirugía incluye riesgos específicos del tipo (RTG ≠ gingivectomía)', async () => {});
```

### 13.6 Performance

- `PeriodontogramGrid` con 192 sitios + 32 dientes debe renderizar en <100ms.
- `upsertSiteData` con debounce 300ms — máximo 3-4 calls/segundo en captura agresiva.
- `classifyPerio2017` ejecuta en <50ms para records de 192 sitios.
- Query `getOverdueMaintenancePatients` con 1000 pacientes ejecuta en <200ms (índice GIN + índice en `riskCategory`).

---

## 14. Roadmap

### MVP v1.0 (lanzamiento del módulo) — 6 features MUST

1. Periodontograma 6×32 con captura manual por teclado (PD, REC, BoP, placa, movilidad, furca).
2. Cálculos automáticos en vivo (BoP%, Plaque Index, distribución de bolsas).
3. Clasificación 2017 AAP/EFP automática (estadio + grado + extensión).
4. Recesiones gingivales con clasificación de Cairo.
5. Plan de tratamiento por 4 fases con tracking.
6. SRP por cuadrante con captura.

### v1.1 (Q+1) — SHOULD

- Reevaluación post-Fase 2 con comparativo pre/post visual.
- Riesgo periodontal (Berna) y agenda de mantenimiento automática.
- Cirugías periodontales con su modelo.
- Captura por voz (Web Speech API).
- Plantillas personalizadas de instrucciones de higiene oral.
- Modo de captura optimizado para tablet (asistente).

### v2.0 — NICE

- Peri-implantitis con su modelo dedicado conectado al módulo de Implantología (4/5).
- Integración con sondas electrónicas (Florida Probe, Pa-On) vía Bluetooth/USB.
- IA para predicción de progresión periodontal a 5 años.
- Análisis automático de pérdida ósea radiográfica con IA (extender XrayAnalysis existente).
- Reporte automatizado al médico tratante con un click.
- Comparación 3D con scanner intraoral.

---

## 15. Casos de uso resumidos

### Caso 1 — María Pérez (38, paciente nueva)

Tabaquismo 12 cig/día, BoP 68%, sitios ≥6mm en 16, 26 (con supuración), bolsas 4-5mm en 31, 41 (con movilidad 2). Cálculo automático: **Estadio III, Grado C, Generalizada**. Plan: F1 (higiene + apoyo cesación tabáquica) → F2 (FMD 2 sesiones + CHX) → reevaluación 8 semanas → F3 quirúrgica probable en 16 y 26. Pronóstico reservado por tabaquismo.

### Caso 2 — Juan López (55, mantenimiento con regresión leve)

Ex-paciente Estadio II tratado hace 18 meses, ex-fumador, HbA1c 6.5%. Hace 4 meses: BoP 12%, 3 sitios residuales. Hoy: BoP 18%, 5 sitios residuales. Riesgo recalculado: BAJO → MODERADO. Recall ajustado de 6 a 4 meses. Refuerzo F1 + cepillo interdental 1.0mm + CHX 7 días + WhatsApp post-cita.

### Caso 3 — Carmen Sánchez (62, post-RTG control 8 semanas)

Estadio IV B, post-Fase 2 con sitio residual 36 DL: PD 9mm + furca II + defecto vertical 6mm. Cirugía RTG con Bio-Gide + Bio-Oss + sutura PTFE 5-0. 8 semanas post: PD 4mm (mejoría 5mm), furca I, recesión postq 1mm esperada, relleno óseo radiográfico ~50%. Comparativo pre/post: sitio antes rojo profundo → ahora verde claro. Mantenimiento 3 meses. Control radiográfico 6 y 12 meses, sin sondaje profundo en 36 hasta 12 meses postcirugía.

---

## 16. Checklist de implementación (10 fases)

### Fase 1: Schema
- [ ] Schema Prisma con 9 modelos + 14 enums.
- [ ] Relaciones inversas en Patient, Clinic, User, PatientFile.
- [ ] Migración SQL con índices GIN, CHECK constraints, RLS policies.
- [ ] Verificar `prisma migrate deploy` en staging.

### Fase 2: Tipos + helpers
- [ ] `src/lib/periodontics/schemas.ts` con todos los zod schemas.
- [ ] `src/lib/periodontics/site-helpers.ts`.
- [ ] `src/lib/periodontics/periodontogram-math.ts`.
- [ ] `src/lib/periodontics/classification-2017.ts` con tests unitarios.
- [ ] `src/lib/periodontics/risk-berna.ts` con tests unitarios.
- [ ] `src/lib/periodontics/keyboard-shortcuts.ts` con tests unitarios.
- [ ] `src/lib/periodontics/cairo-classification.ts`.
- [ ] `src/lib/periodontics/whatsapp-templates.ts`.
- [ ] `src/lib/periodontics/consent-texts.ts`.
- [ ] `PERIODONTICS_MODULE_KEY` registrado en `src/lib/specialties/keys.ts`.

### Fase 3: Server actions
- [ ] 16 actions con auth + tenant + audit + revalidate.
- [ ] Discriminated union de retorno.
- [ ] Cobertura unitaria.

### Fase 4: Componentes — núcleo del periodontograma
- [ ] `SiteCell` con states verde/amarillo/rojo + BoP/placa/sup + edición inline.
- [ ] `ToothCenter` con siluetas SVG por categoría (incisor/canine/premolar/molar) + arcada + recesión visual + movilidad + furca + ausente/implante.
- [ ] `ToothColumn` orquesta 6 sitios + diente.
- [ ] `PeriodontogramGrid` con dos arcadas y reducer de estado.
- [ ] `LiveIndicators` reactivos a métricas.
- [ ] `ClassificationFooter` con override.
- [ ] `KeyboardCaptureLayer` con Tab/Shift+Tab/Espacio/P/S.
- [ ] `ToothDetailDrawer` con movilidad/furca/recesión Cairo.

### Fase 5: Sub-tabs
- [ ] `PerioSubTabs` (Resumen/Periodontograma/Plan/Cirugías/Mantenimientos).
- [ ] `ResumenTab` con 5 cards (Classification, BoPTrend, NextMaintenance, ClinicalAlerts, SystemicFactors).
- [ ] `PlanTab` con `PhaseProgress` + `QuadrantMap` + `PlanTimeline`.
- [ ] `CirugiasTab` con `SurgeryList` + `SurgeryDrawer` + `BeforeAfterCompare`.
- [ ] `MantenimientosTab` con tabla + chart + RiskBadge.

### Fase 6: Página dedicada
- [ ] `/dashboard/specialties/periodontics/page.tsx` con widget de mantenimientos vencidos.
- [ ] `OverdueMaintenanceWidget` con filtro por riesgo.
- [ ] `RiskDistributionChart`.
- [ ] `PerioPatientList`.
- [ ] Icono `Activity` registrado en sidebar grupo "Especialidades".

### Fase 7: Consentimientos y PDFs
- [ ] `SRPConsentModal` con texto completo + SignaturePad.
- [ ] `SurgeryConsentModal` con riesgos específicos por tipo.
- [ ] `perio-report.tsx` (informe paciente).
- [ ] `perio-medico-tratante.tsx`.
- [ ] `pre-post-compare.tsx`.

### Fase 8: Integraciones
- [ ] Duraciones de citas configuradas.
- [ ] Pre-fill SOAP con datos periodontales.
- [ ] Plan general con dependencias entre fases.
- [ ] Badge perio en odontograma general.
- [ ] 3 plantillas de receta NOM-024.
- [ ] 8 templates WhatsApp encolados en momentos correctos.
- [ ] Audit log en cada mutación.

### Fase 9: Mock data + testing
- [ ] Seed de los 3 pacientes mock (María, Juan, Carmen).
- [ ] Tests unitarios (helpers + algoritmos).
- [ ] Tests de integración Playwright (5 flujos UX).
- [ ] Tests RLS multi-tenant.
- [ ] Snapshots Storybook.
- [ ] Tests de compliance (audit log + consentimientos).
- [ ] Performance benchmarks.

### Fase 10: QA + lanzamiento
- [ ] Validación con periodoncista real (sondaje completo en tablet).
- [ ] Validación de la clasificación 2017 contra 10 casos de referencia (Papapanou et al. 2018).
- [ ] Validación NOM-024 (auditoría interna).
- [ ] Documentación de usuario (PDF + video tutorial).
- [ ] Toggle del módulo activable por clínica.
- [ ] Deploy a producción.

---

## 17. Hoja de referencia rápida

### Atajos del periodontograma

| Tecla | Acción |
|-------|--------|
| `5-2` | PD 5mm REC 2mm en celda activa |
| `Tab` | Siguiente sitio (en orden MV→MB→DV→DL→ML→MB_PAL → siguiente diente) |
| `Shift+Tab` | Sitio anterior |
| `Espacio` | Toggle BoP+ |
| `P` / `p` | Toggle placa |
| `S` / `s` | Toggle supuración |
| `Enter` | Confirmar y avanzar |
| `Esc` | Cancelar edición |

### Severidad PD

| PD (mm) | Color | Significado |
|---------|-------|-------------|
| 1-3 | Verde | Surco fisiológico |
| 4-5 | Amarillo | Bolsa moderada |
| ≥6 | Rojo | Bolsa profunda |

### Recall según riesgo Berna

| Riesgo | Intervalo |
|--------|-----------|
| BAJO | 6 meses |
| MODERADO | 4 meses |
| ALTO | 3 meses |

### Cairo 2018 (recesiones)

| Tipo | Pérdida interproximal |
|------|----------------------|
| RT1 | Ninguna |
| RT2 | ≤ vestibular |
| RT3 | > vestibular |

### Modificadores de grado

| Factor | Efecto |
|--------|--------|
| Tabaco ≥10 cig/día | Sube 1 grado |
| HbA1c ≥7% | Sube 1 grado |
| Ambos simultáneos | Sube 2 grados (capeado a Grado C) |

---

## 18. Notas finales

### Decisiones que el Bot Git 1 NO debe revaluar

Todas las 22 decisiones bloqueadas de la sección 1 son inamovibles. Si el Bot encuentra resistencia técnica para implementar alguna, debe documentar el obstáculo en un comentario `// PRECAUCIÓN:` y proceder con la implementación lo más cercana posible al spec, sin cambiar la decisión.

### Si una decisión clínica es ambigua

El Specialist tomó decisiones basadas en consenso EFP/AAP 2017-2020. Si el Bot encuentra ambigüedad clínica durante implementación (ej. "¿qué hacer si paciente tiene múltiples tipos de recesión por diente?"), implementar la opción más permisiva (permitir múltiples) y dejar TODO marcado para Rafael.

### Reuso obligatorio de pediatría/endodoncia

NO duplicar componentes ya existentes. Specifically:
- `SignaturePad` (de pediatría)
- `Drawer`, `Modal`, `Section`, `RadioGroup`, `Toggle`, `NumberInput`, `Select` (design system)
- `recordAudit`, `getCurrentUser`, `getActiveClinicId`, `canAccessModule` (auth/audit)
- `useDebouncedCallback` (hooks compartidos)
- `Result<T>` y `isFailure` (patrones de Server Action)

### Mobile cap

El periodontograma en mobile renderiza con `cursor: not-allowed` sobre las celdas y banner "Para captura, abre desde tablet o escritorio". Sí permitir lectura completa, navegar timeline, ver clasificación, ver gráficos. NO permitir crear/editar nada relacionado con el sondaje desde mobile.

### Persistencia del estado en captura

Si el doctor cierra la pestaña a media captura, al volver el `PeriodontogramRecord` ya tiene los sitios capturados hasta el momento (autosave). El reducer del cliente se hidrata desde la DB. NO se pierde nada.

---

## 19. Prompt para Bot Git 1

```
→ BOT GIT 1

Implementa el módulo Periodoncia (3/5) de MediFlow siguiendo el SPEC en docs/marketplace/research/periodoncia/SPEC.md al pie de la letra.

CONTEXTO
- Es el tercer módulo del marketplace de especialidades. Pediatría (1/5) y Endodoncia (2/5) ya están en producción — reutiliza lo que esté hecho.
- Tu worktree está dedicado al marketplace + módulos de especialidades. Bot Git 2 trabaja otras features en paralelo.
- Stack: Next.js 14 App Router, TypeScript estricto, Tailwind con tokens dark-mode, Prisma 5.22 + Supabase, lucide-react, react-hot-toast, recharts. NO inventes dependencias.

EJECUTA EN ESTE ORDEN (NO SALTES FASES)

Fase 1 — Schema Prisma:
1. Agrega los 9 modelos del SPEC sección 4.2 al schema.prisma.
2. Agrega los 14 enums de la sección 4.1.
3. Agrega las relaciones inversas en Patient, Clinic, User, PatientFile (sección 4.3).
4. Genera la migración con `pnpm prisma migrate dev --name periodontics_init`.
5. Aplica el SQL adicional de la sección 4.4 (índice GIN, CHECK constraints, RLS policies) en una migración SQL manual.
6. Corre `prisma generate`.

Fase 2 — Helpers + tipos:
1. Crea TODOS los archivos de src/lib/periodontics/ del SPEC sección 5.1 + 5.4.
2. classification-2017.ts debe pasar los tests unitarios de la sección 13.1.
3. risk-berna.ts debe pasar los tests de Berna.
4. Registra PERIODONTICS_MODULE_KEY = "periodontics" en src/lib/specialties/keys.ts.

Fase 3 — Server actions:
1. Implementa las 16 actions del SPEC sección 5.2.
2. Cada una con auth + tenant + canAccessModule + zod + transacción + recordAudit + revalidatePath.
3. Retorna Result<T> discriminado.

Fase 4 — Componentes núcleo del periodontograma:
1. SiteCell, ToothCenter, ToothColumn, PeriodontogramGrid (con reducer), LiveIndicators, ClassificationFooter, KeyboardCaptureLayer, ToothDetailDrawer.
2. Reutiliza Drawer, Modal, Section, RadioGroup, etc. del design system existente.
3. NO USES storage del navegador (localStorage, sessionStorage, IndexedDB) — todo se persiste vía server actions.

Fase 5 — Sub-tabs y página dedicada:
1. PerioSubTabs con 5 sub-tabs.
2. ResumenTab con sus 5 cards.
3. PlanTab con PhaseProgress, QuadrantMap, PlanTimeline.
4. CirugiasTab y MantenimientosTab.
5. /dashboard/specialties/periodontics/page.tsx con OverdueMaintenanceWidget.

Fase 6 — Consentimientos y PDFs:
1. SRPConsentModal y SurgeryConsentModal (texto exacto del SPEC sección 10.3 y 10.4).
2. 3 plantillas PDF: perio-report, perio-medico-tratante, pre-post-compare.
3. SignaturePad reutilizado de pediatría.

Fase 7 — Integraciones:
1. Pre-fill SOAP del SPEC sección 8.2.
2. Badge periodontal en odontograma general.
3. 3 plantillas receta NOM-024 (sección 8.6, texto exacto).
4. 8 templates WhatsApp encolados en los momentos correctos (sección 8.7).
5. Duraciones de cita configuradas.

Fase 8 — Mock data + tests:
1. Seed de los 3 pacientes (María, Juan, Carmen) según sección 12.
2. Tests unitarios para helpers.
3. Tests Playwright E2E para los 5 flujos del SPEC sección 7.
4. Tests RLS multi-tenant.
5. Snapshots Storybook.

REGLAS DE NEGOCIO INNEGOCIABLES
- Mobile = SOLO LECTURA del periodontograma. Banner explícito, sin botones de captura.
- Recesiones gingivales: SOLO Cairo 2018 (RT1/RT2/RT3). NO Miller 1985.
- Clasificación 2017: cálculo automático SIEMPRE. Sobrescritura requiere justificación ≥10 caracteres.
- Audit log obligatorio en TODAS las mutaciones clínicas.
- Soft delete (deletedAt). NUNCA hard delete.
- Idioma: español neutro mexicano. NUNCA argentino.
- Gender enum del repo: M | F | OTHER. NO MALE/FEMALE.
- NO crear modelo Radiography. Reutilizar PatientFile con FileCategory.
- PeriImplantAssessment con implantId: String? nullable (sin FK aún).
- Server Action de upsertSiteData = alta frecuencia. Debounce 300ms en cliente, NO revalidatePath en cada call.

CHECKLIST DE FINALIZACIÓN
Antes de marcar el módulo como listo, verifica:
- [ ] Las 16 server actions tienen audit log y validación zod.
- [ ] El periodontograma renderiza 192 sitios + 32 dientes en <100ms.
- [ ] Captura por teclado funciona: 5-2 + Tab + Espacio/P/S.
- [ ] Clasificación 2017 calcula correctamente los 3 casos mock.
- [ ] Mobile muestra solo lectura sin posibilidad de captura.
- [ ] Widget de mantenimientos vencidos lista pacientes correctamente.
- [ ] Los 3 PDFs se generan y descargan.
- [ ] RLS multi-tenant: clínica A no ve datos de clínica B.

Cualquier ambigüedad clínica que encuentres: implementa la opción más permisiva y deja TODO marcado para Rafael. Cualquier obstáculo técnico con una decisión bloqueada: comenta // PRECAUCIÓN: en el código y procede lo más cercano posible al spec.

Cuando termines, comenta en el PR los seeds de los 3 pacientes para validación clínica con Rafael.
```
