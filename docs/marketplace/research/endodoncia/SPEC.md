# SPEC — Módulo Endodoncia (Marketplace 2/5)

> **Estado:** Listo para implementación
> **Especialidad:** Endodoncia
> **Predecesor:** Pediatría (1/5) — completado
> **Ruta destino:** `docs/marketplace/research/endodoncia/SPEC.md`
> **Última actualización:** 2026-05-04
> **Autor:** Equipo MediFlow

---

## 0. Resumen Ejecutivo

El módulo de **Endodoncia** es el segundo de los cinco módulos de especialidad del marketplace de MediFlow. Resuelve el flujo clínico del endodoncista mexicano: tratamientos de conductos (TC) primarios, retratamientos, cirugías apicales, controles de seguimiento radiográficos y documentación legal NOM-024.

A diferencia de pediatría —que es paciente-céntrica con dashboard de niño— endodoncia es **diente-céntrica**: cada vista se centra en un diente específico (FDI), porque toda la práctica clínica del endodoncista gira alrededor de un diente que está siendo tratado, retratado o vigilado.

El diferenciador clínico real frente al mercado mexicano (Dentrix, OpenDental, Eaglesoft, Curve, iDental, flowww) es la combinación de:

1. **Mapa canalicular visual por diente** con anatomía Vertucci/Ahmed estática y conductos coloreados dinámicamente según calidad de obturación.
2. **Tracking automático de seguimiento 6m / 12m / 24m** con recordatorios WhatsApp y agenda automática.
3. **Dashboard de tasa de éxito personal del doctor** (porcentaje de éxitos a 12m / 24m por tipo de diente, por sistema de instrumentación, por diagnóstico inicial). Ningún PMS del mercado mexicano lo ofrece.
4. **Diagnóstico AAE estructurado** (no texto libre).
5. **Registro por conducto**, no por diente, con conductometría vinculada a la radiografía específica del conducto.

Métricas de éxito del módulo a 90 días post-lanzamiento:

- ≥ 70% de los TC capturados en el wizard (vs. nota de texto libre).
- ≥ 80% de los conductos con conductometría vinculada a radiografía específica.
- ≥ 95% de los TC con plan de seguimiento 6m/12m/24m generado automáticamente.
- ≥ 60% de las radiografías de control con PAI score capturado.
- 0 disputas legales por documentación faltante (objetivo absoluto).

---

## 1. Decisiones Tomadas (Locked-in)

Estas decisiones ya fueron evaluadas y bloqueadas. **No se revaloran** en implementación. Cualquier cambio requiere re-discusión explícita.

### 1.1 Arquitectura de pantalla

- **Tab nuevo "Endodoncia"** dentro de `patient-detail`. NO es página dedicada, NO es widget de dashboard.
- **Vista única diente-céntrica**, sin sub-tabs.
- **Layout de 3 secciones verticales** en el centro: Diagnóstico (arriba), Mapa canalicular (centro), Línea de tiempo del diente (abajo).
- **Panel izquierdo de 280px** con odontograma en miniatura coloreado por estado endodóntico de cada diente.

### 1.2 Captura de datos

- **TC = WIZARD de 4 pasos**: Acceso → Preparación → Irrigación → Obturación.
- **Diagnóstico AAE, vitalidad y controles de seguimiento = drawer lateral derecho** (no modal, no página).
- **Consentimiento informado = modal full-screen con firma canvas** (reusa el componente exacto de pediatría).
- **Detalle de un conducto = drawer lateral derecho** al hacer clic sobre el conducto en el mapa canalicular.

### 1.3 Anatomía y mapa canalicular

- **Mapa canalicular = SVG estática anatómica por arquetipo de diente.** No se genera dinámicamente.
- Se entregan **8 SVGs** en `public/specialties/endodontics/anatomy/*.svg`:
  1. `incisor.svg`
  2. `canine.svg`
  3. `premolar-upper-1canal.svg`
  4. `premolar-upper-2canal.svg`
  5. `premolar-lower.svg`
  6. `molar-upper-mb2.svg`
  7. `molar-lower.svg`
  8. `molar-lower-cshape.svg`
- Cada SVG usa **`<g id="canal-{nombre}">`** por conducto (`canal-mb`, `canal-mb2`, `canal-db`, `canal-p`, `canal-mv`, `canal-ml`, `canal-d`, `canal-v`, `canal-l`, `canal-unico`) para que el componente `<CanalMap />` coloree cada conducto dinámicamente.
- **Estilo:** técnico esquemático estilo libro de texto endodóntico actualizado, líneas claras, no realista.
- **Vertucci 1984 = default** en configuración del doctor.
- **Ahmed 2017 = opción avanzada** (toggle en `/dashboard/clinic/configuracion/especialidades/endodoncia`). No bloquea el módulo si está apagado.

### 1.4 Radiografías — reutilización de PatientFile

**NO se crea modelo `Radiography`.** Se reutiliza el modelo existente `PatientFile` con `FileCategory` apropiada:

- `XRAY_PERIAPICAL` (radiografía periapical, la más usada en endo)
- `XRAY_PANORAMIC` (panorámica)
- `XRAY_BITEWING` (aleta de mordida)
- `XRAY_OCCLUSAL` (oclusal)
- `XRAY_CBCT` (estudio CBCT — solo metadata, no visor DICOM en MVP)
- `PHOTO_INTRAORAL` (foto intraoral, usada en cirugía apical)

Ajustes al schema del brief original:

| Campo del brief | Campo final | Motivo |
|---|---|---|
| `RootCanal.conductometryRadiographId` | `RootCanal.conductometryFileId` (FK PatientFile) | Reutilizar PatientFile en lugar de modelo nuevo. |
| `EndodonticFollowUp.radiographId` | `EndodonticFollowUp.controlFileId` (FK PatientFile) | Reutilizar PatientFile. |
| `ApicalSurgery.intraoperativePhotoUrl` | `ApicalSurgery.intraoperativeFileId` (FK PatientFile) | Reutilizar PatientFile. |

El módulo de **`XrayAnalysis`** (análisis IA existente, ligado a PatientFile) ya detecta lesiones periapicales. En **v2.0** alimentará automáticamente el campo `paiScore` sugerido en cada `EndodonticFollowUp`. En MVP el PAI lo captura manualmente el doctor.

### 1.5 Multi-tenant y compliance

- Todas las tablas nuevas tienen `clinicId` y `doctorId` y se filtran por `clinicId` activo (`getActiveClinicId()`).
- **Audit log obligatorio** en toda mutación clínica (diagnóstico, longitud de trabajo, conclusión de control, motivo de fracaso). Se reutiliza `createAuditLog()` existente.
- Compliance: **NOM-024-SSA3-2012** (expediente clínico) + **LFPDPPP** (datos sensibles de salud).
- Conservación mínima: **5 años** desde la última intervención sobre el diente.

### 1.6 Reutilización desde pediatría (1/5)

El módulo reutiliza estos componentes / patrones ya implementados:

- **Tokens dark-mode:** `--text-1`, `--text-2`, `--text-3`, `--bg-base`, `--bg-elev`, `--bg-elev-2`, `--brand`, `--brand-soft`, `--border-soft`, `--success`, `--warning`, `--danger`, `--info`.
- **Header del paciente** (`<PatientHeader />`): nombre, edad, alergias, próxima cita, botón "Nueva cita".
- **Sidebar** grupo "Especialidades" — se agrega ítem "Endodoncia" con icono `Stethoscope` (lucide-react).
- **Componente de firma canvas** (`<SignatureCanvas />`) del modal de consentimiento.
- **Patrón de Server Actions** uno por mutación, con `'use server'` y revalidación.
- **Pre-fill SOAP** + **recordatorios WhatsApp** + **audit log** — los tres helpers ya existen.
- **Patrón de drawer lateral derecho** (`<DetailDrawer />`).
- **Patrón de wizard** (`<StepWizard />`) con persistencia en localStorage por si el doctor pierde la sesión a media captura.

### 1.7 Idioma

Español neutro mexicano. **NUNCA argentino.** Verbos en imperativo de tú: `agrega`, `prueba`, `verifica`, `confirma`. NUNCA `agregá`, `probá`, `verificá`. Términos clínicos: `diente`, `conducto` (no `canal radicular` — aunque sea técnicamente correcto, en consultorio mexicano se dice `conducto`), `obturación`, `endodoncia`, `tratamiento de conductos` (TC), `pulpa`, `lesión periapical`.

---

## 2. Stack & Convenciones

### 2.1 Stack

- **Framework:** Next.js 14 App Router
- **Lenguaje:** TypeScript estricto (`strict: true`)
- **UI:** Tailwind CSS + tokens CSS variables
- **Iconos:** `lucide-react`
- **Notificaciones:** `react-hot-toast`
- **Charts:** `recharts` (dashboards de tasa de éxito)
- **ORM:** Prisma 5.22
- **DB:** Supabase Postgres (multi-tenant por `clinicId`)
- **Auth:** Supabase Auth + RLS
- **Storage:** Supabase Storage (radiografías y fotos en bucket `patient-files/{clinicId}/{patientId}/`)

### 2.2 Convenciones de naming

- **Componentes:** PascalCase, sufijo descriptivo (`CanalMap`, `RootCanalDrawer`, `TreatmentWizard`).
- **Server actions:** camelCase, prefijo de verbo (`createDiagnosis`, `updateRootCanal`, `scheduleFollowUp`).
- **Archivos de página:** `app/dashboard/patient/[id]/endodoncia/page.tsx` (no aplicable porque es tab dentro de patient-detail; el tab vive en el componente padre).
- **Archivos de componente:** `components/specialties/endodontics/{Component}.tsx`.
- **Server actions:** `app/actions/endodontics/{action}.ts`.
- **Tipos/zod schemas:** `lib/types/endodontics.ts` y `lib/validation/endodontics.ts`.

### 2.3 Convenciones de DB

- Toda tabla nueva: `id` UUID, `createdAt`, `updatedAt`, `clinicId`, `createdByUserId`.
- Soft delete con `deletedAt` (no hard delete por NOM-024).
- Índices compuestos: `(clinicId, patientId, toothFdi)` en tablas de tratamiento; `(clinicId, doctorId, createdAt)` en tablas con dashboards.
- FK `onDelete: Restrict` para no perder evidencia legal por error.

### 2.4 Convenciones de UI

- **Sin animaciones gratuitas.** Solo transiciones de 150ms en hover/focus y 250ms en aparición de drawer.
- **Densidad alta** pero estructurada en secciones. El endodoncista es especialista experto, no novato; quiere ver datos rápido.
- **Sin emojis en UI clínica.** Iconos `lucide-react` únicamente.
- **Tipografía:** la del proyecto base de MediFlow (no se inventa nueva fuente).
- **Tooltips:** en todo dato técnico abreviado (lima maestra, cono maestro, ISO, conicidad).
- **Errores:** toast con descripción accionable. Nunca "Error inesperado" sin contexto.

---

## 3. Estructura de Archivos

```
mediflow/
├── app/
│   ├── actions/
│   │   └── endodontics/
│   │       ├── createDiagnosis.ts
│   │       ├── updateDiagnosis.ts
│   │       ├── recordVitalityTest.ts
│   │       ├── startTreatment.ts
│   │       ├── updateTreatmentStep.ts
│   │       ├── upsertRootCanal.ts
│   │       ├── recordIntracanalMedication.ts
│   │       ├── completeTreatment.ts
│   │       ├── scheduleFollowUp.ts
│   │       ├── completeFollowUp.ts
│   │       ├── createRetreatmentInfo.ts
│   │       ├── createApicalSurgery.ts
│   │       ├── exportTreatmentReportPdf.ts
│   │       └── exportLegalReportPdf.ts
│   └── dashboard/
│       └── patient/
│           └── [id]/
│               └── (tab "Endodoncia" se monta dentro del layout existente)
├── components/
│   └── specialties/
│       └── endodontics/
│           ├── EndodonticsTab.tsx           ← entrada principal del tab
│           ├── ToothMiniOdontogram.tsx       ← panel izquierdo 280px
│           ├── DiagnosisCard.tsx              ← sección 1 (arriba)
│           ├── CanalMap.tsx                   ← motor SVG (sección 2 centro)
│           ├── ToothTimeline.tsx              ← sección 3 (abajo)
│           ├── RootCanalDrawer.tsx            ← drawer detalle conducto
│           ├── DiagnosisDrawer.tsx            ← drawer captura AAE
│           ├── VitalityDrawer.tsx             ← drawer pruebas vitalidad
│           ├── FollowUpDrawer.tsx             ← drawer control 6/12/24m
│           ├── TreatmentWizard/
│           │   ├── index.tsx
│           │   ├── Step1Access.tsx
│           │   ├── Step2Preparation.tsx
│           │   ├── Step3Irrigation.tsx
│           │   └── Step4Obturation.tsx
│           ├── ConsentModal.tsx               ← modal full-screen + firma
│           ├── RetreatmentBadge.tsx
│           ├── ApicalSurgeryDrawer.tsx
│           ├── SuccessRateChart.tsx           ← dashboard recharts
│           ├── PendingFollowUpsList.tsx
│           ├── PendingRestorationList.tsx
│           └── RadiographComparisonView.tsx
├── lib/
│   ├── types/
│   │   └── endodontics.ts
│   ├── validation/
│   │   └── endodontics.ts                    ← zod schemas
│   ├── helpers/
│   │   ├── canalAnatomy.ts                    ← Vertucci/Ahmed lookup
│   │   ├── soapPrefillEndo.ts
│   │   ├── whatsappTemplatesEndo.ts
│   │   ├── prescriptionTemplatesEndo.ts
│   │   └── successRateCalculator.ts
│   └── pdf/
│       ├── treatmentReport.tsx                ← @react-pdf/renderer
│       └── legalEndoReport.tsx
├── prisma/
│   ├── schema.prisma                         ← +8 modelos nuevos
│   └── migrations/
│       └── 20260504_add_endodontics_module/
│           └── migration.sql
└── public/
    └── specialties/
        └── endodontics/
            └── anatomy/
                ├── incisor.svg
                ├── canine.svg
                ├── premolar-upper-1canal.svg
                ├── premolar-upper-2canal.svg
                ├── premolar-lower.svg
                ├── molar-upper-mb2.svg
                ├── molar-lower.svg
                └── molar-lower-cshape.svg
```

---

## 4. Modelo de Datos (Prisma)

### 4.1 Nuevos modelos (8)

```prisma
// ============================================================
// ENDODONCIA — schema.prisma (extracto)
// ============================================================

model EndodonticDiagnosis {
  id                  String   @id @default(uuid())
  clinicId            String
  patientId           String
  doctorId            String
  toothFdi            Int      // 11..48
  diagnosedAt         DateTime @default(now())

  pulpalDiagnosis     PulpalDiagnosis
  periapicalDiagnosis PeriapicalDiagnosis
  justification       String?  @db.Text

  createdByUserId     String
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  deletedAt           DateTime?

  clinic              Clinic   @relation(fields: [clinicId], references: [id], onDelete: Restrict)
  patient             Patient  @relation(fields: [patientId], references: [id], onDelete: Restrict)
  doctor              User     @relation("EndoDiagnosisDoctor", fields: [doctorId], references: [id], onDelete: Restrict)
  treatments          EndodonticTreatment[]

  @@index([clinicId, patientId, toothFdi])
  @@index([clinicId, doctorId, diagnosedAt])
  @@map("endodontic_diagnoses")
}

model VitalityTest {
  id              String         @id @default(uuid())
  clinicId        String
  patientId       String
  doctorId        String
  toothFdi        Int
  controlTeeth    Json           // number[] FDIs
  testType        VitalityTestType
  result          VitalityResult
  intensity       Int?           // 0-10 cuando aplica
  evaluatedAt     DateTime       @default(now())
  notes           String?        @db.Text

  createdByUserId String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  deletedAt       DateTime?

  clinic          Clinic         @relation(fields: [clinicId], references: [id], onDelete: Restrict)
  patient         Patient        @relation(fields: [patientId], references: [id], onDelete: Restrict)
  doctor          User           @relation("VitalityDoctor", fields: [doctorId], references: [id], onDelete: Restrict)

  @@index([clinicId, patientId, toothFdi, evaluatedAt])
  @@map("vitality_tests")
}

model EndodonticTreatment {
  id                       String                    @id @default(uuid())
  clinicId                 String
  patientId                String
  doctorId                 String
  toothFdi                 Int
  treatmentType            EndoTreatmentType
  diagnosisId              String?
  startedAt                DateTime                  @default(now())
  completedAt              DateTime?
  sessionsCount            Int                       @default(1)
  currentStep              Int                       @default(1) // 1..4 wizard
  isMultiSession           Boolean                   @default(false)

  // Acceso e instrumentación
  rubberDamPlaced          Boolean                   @default(false)
  accessType               AccessType?
  instrumentationSystem    InstrumentationSystem?
  technique                InstrumentationTechnique?
  motorBrand               String?
  torqueSettings           String?
  rpmSetting               Int?

  // Irrigación
  irrigants                Json?                     // [{ substance, concentration, volumeMl, order }]
  irrigationActivation     IrrigationActivation?
  totalIrrigationMinutes   Int?

  // Obturación
  obturationTechnique      ObturationTechnique?
  sealer                   SealerType?
  masterConePresetIso      Int?

  // Restauración pos-TC
  postOpRestorationPlan    PostOpRestorationType?
  requiresPost             Boolean                   @default(false)
  postMaterial             String?
  restorationUrgencyDays   Int?
  restorationDoctorId      String?
  postOpRestorationCompletedAt DateTime?

  // Resultado global
  outcomeStatus            EndoOutcomeStatus         @default(EN_CURSO)

  notes                    String?                   @db.Text

  createdByUserId          String
  createdAt                DateTime                  @default(now())
  updatedAt                DateTime                  @updatedAt
  deletedAt                DateTime?

  clinic                   Clinic                    @relation(fields: [clinicId], references: [id], onDelete: Restrict)
  patient                  Patient                   @relation(fields: [patientId], references: [id], onDelete: Restrict)
  doctor                   User                      @relation("EndoTreatmentDoctor", fields: [doctorId], references: [id], onDelete: Restrict)
  diagnosis                EndodonticDiagnosis?      @relation(fields: [diagnosisId], references: [id], onDelete: SetNull)
  rootCanals               RootCanal[]
  intracanalMedications    IntracanalMedication[]
  followUps                EndodonticFollowUp[]
  retreatmentInfo          EndodonticRetreatmentInfo?
  apicalSurgery            ApicalSurgery?

  @@index([clinicId, patientId, toothFdi])
  @@index([clinicId, doctorId, startedAt])
  @@index([clinicId, outcomeStatus])
  @@map("endodontic_treatments")
}

model RootCanal {
  id                      String              @id @default(uuid())
  treatmentId             String
  canonicalName           CanalCanonicalName
  customLabel             String?             // cuando no aplica un nombre canónico
  workingLengthMm         Decimal             @db.Decimal(4,1)
  coronalReferencePoint   String              // "cúspide MV", "borde incisal", etc.
  masterApicalFileIso     Int                 // 15, 20, 25, 30, 35, 40, 45, 50, 55, 60
  masterApicalFileTaper   Decimal             @db.Decimal(3,2) // 0.04, 0.06, 0.08
  apexLocatorReadingMm    Decimal?            @db.Decimal(4,1)
  radiographicLengthMm    Decimal?            @db.Decimal(4,1)
  apexLocatorBrand        String?
  conductometryFileId     String?             // FK PatientFile (XRAY_PERIAPICAL)
  obturationQuality       ObturationQuality?
  notes                   String?             @db.Text

  createdByUserId         String
  createdAt               DateTime            @default(now())
  updatedAt               DateTime            @updatedAt
  deletedAt               DateTime?

  treatment               EndodonticTreatment @relation(fields: [treatmentId], references: [id], onDelete: Cascade)
  conductometryFile       PatientFile?        @relation("ConductometryFile", fields: [conductometryFileId], references: [id], onDelete: SetNull)

  @@index([treatmentId])
  @@map("root_canals")
}

model IntracanalMedication {
  id                  String              @id @default(uuid())
  treatmentId         String
  substance           IntracanalSubstance
  placedAt            DateTime
  expectedRemovalAt   DateTime?
  actualRemovalAt     DateTime?
  notes               String?             @db.Text

  createdByUserId     String
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  deletedAt           DateTime?

  treatment           EndodonticTreatment @relation(fields: [treatmentId], references: [id], onDelete: Cascade)

  @@index([treatmentId, placedAt])
  @@map("intracanal_medications")
}

model EndodonticFollowUp {
  id                String                @id @default(uuid())
  treatmentId       String
  milestone         FollowUpMilestone
  scheduledAt       DateTime
  performedAt       DateTime?
  paiScore          Int?                  // 1..5
  symptomsPresent   Boolean?
  conclusion        FollowUpConclusion?
  recommendedAction String?               @db.Text
  controlFileId     String?               // FK PatientFile (XRAY_PERIAPICAL)
  notes             String?               @db.Text

  createdByUserId   String
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt
  deletedAt         DateTime?

  treatment         EndodonticTreatment   @relation(fields: [treatmentId], references: [id], onDelete: Cascade)
  controlFile       PatientFile?          @relation("FollowUpFile", fields: [controlFileId], references: [id], onDelete: SetNull)

  @@index([treatmentId, scheduledAt])
  @@index([scheduledAt, performedAt])
  @@map("endodontic_follow_ups")
}

model EndodonticRetreatmentInfo {
  id                            String                  @id @default(uuid())
  treatmentId                   String                  @unique
  failureReason                 RetreatmentFailureReason
  originalTreatmentDate         DateTime?
  fracturedInstrumentRecovered  Boolean                 @default(false)
  difficulty                    RetreatmentDifficulty   @default(MEDIA)
  notes                         String?                 @db.Text

  createdByUserId               String
  createdAt                     DateTime                @default(now())
  updatedAt                     DateTime                @updatedAt
  deletedAt                     DateTime?

  treatment                     EndodonticTreatment     @relation(fields: [treatmentId], references: [id], onDelete: Cascade)

  @@map("endodontic_retreatment_info")
}

model ApicalSurgery {
  id                       String                @id @default(uuid())
  treatmentId              String                @unique
  interventedRoot          String                // "MV", "DV", "P", "única"
  resectedRootLengthMm     Decimal               @db.Decimal(3,1)
  retroFillingMaterial     RetroFillingMaterial
  flapType                 FlapType
  sutureType               String?
  postOpControlAt          DateTime?
  intraoperativeFileId     String?               // FK PatientFile (PHOTO_INTRAORAL)
  notes                    String?               @db.Text

  createdByUserId          String
  createdAt                DateTime              @default(now())
  updatedAt                DateTime              @updatedAt
  deletedAt                DateTime?

  treatment                EndodonticTreatment   @relation(fields: [treatmentId], references: [id], onDelete: Cascade)
  intraoperativeFile       PatientFile?          @relation("ApicalSurgeryFile", fields: [intraoperativeFileId], references: [id], onDelete: SetNull)

  @@map("apical_surgeries")
}
```

### 4.2 Enums

```prisma
enum PulpalDiagnosis {
  PULPA_NORMAL
  PULPITIS_REVERSIBLE
  PULPITIS_IRREVERSIBLE_SINTOMATICA
  PULPITIS_IRREVERSIBLE_ASINTOMATICA
  NECROSIS_PULPAR
  PREVIAMENTE_TRATADO
  PREVIAMENTE_INICIADO
}

enum PeriapicalDiagnosis {
  TEJIDOS_PERIAPICALES_NORMALES
  PERIODONTITIS_APICAL_SINTOMATICA
  PERIODONTITIS_APICAL_ASINTOMATICA
  ABSCESO_APICAL_AGUDO
  ABSCESO_APICAL_CRONICO
  OSTEITIS_CONDENSANTE
}

enum VitalityTestType {
  FRIO
  CALOR
  EPT
  PERCUSION_VERTICAL
  PERCUSION_HORIZONTAL
  PALPACION_APICAL
  MORDIDA_TOOTHSLOOTH
}

enum VitalityResult {
  POSITIVO
  NEGATIVO
  EXAGERADO
  DIFERIDO
  SIN_RESPUESTA
}

enum EndoTreatmentType {
  TC_PRIMARIO
  RETRATAMIENTO
  APICECTOMIA
  PULPOTOMIA_EMERGENCIA
  TERAPIA_REGENERATIVA
}

enum AccessType {
  CONVENCIONAL
  CONSERVADOR
  RECTIFICACION_PREVIO
  POSTE_RETIRADO
}

enum InstrumentationSystem {
  PROTAPER_GOLD
  PROTAPER_NEXT
  WAVEONE_GOLD
  RECIPROC_BLUE
  BIORACE
  HYFLEX_EDM
  TRUNATOMY
  MANUAL_KFILES
  OTRO
}

enum InstrumentationTechnique {
  ROTACION_CONTINUA
  RECIPROCACION
  MANUAL
  HIBRIDA
}

enum IrrigationActivation {
  NINGUNA
  SONICA          // EndoActivator
  ULTRASONICA     // PUI
  LASER           // PIPS / SWEEPS
  XPF
}

enum ObturationTechnique {
  CONDENSACION_LATERAL
  CONDENSACION_VERTICAL_CALIENTE
  OLA_CONTINUA
  CONO_UNICO
  TERMOPLASTICA_INYECTABLE
  BIOCERAMIC_SINGLE_CONE
}

enum SealerType {
  AH_PLUS
  MTA_FILLAPEX
  BIOROOT_RCS
  BC_SEALER
  TUBLISEAL
  SEALAPEX
  OTRO
}

enum CanalCanonicalName {
  MB        // mesiovestibular (mesiobucal)
  MB2       // segundo mesiovestibular
  DB        // distovestibular
  MV        // mesiovestibular (sinónimo MB en algunos contextos)
  DV        // distovestibular
  MP        // mesiopalatino
  P         // palatino
  D         // distal
  M         // mesial
  L         // lingual
  V         // vestibular
  ML        // mesiolingual
  DL        // distolingual
  CONDUCTO_UNICO
  OTRO
}

enum ObturationQuality {
  HOMOGENEA
  ADECUADA
  CON_HUECOS
  SOBREOBTURADA
  SUBOBTURADA
}

enum IntracanalSubstance {
  HIDROXIDO_CALCIO
  CTZ
  LEDERMIX
  FORMOCRESOL
  PROPILENGLICOL
  OTRO
}

enum FollowUpMilestone {
  CONTROL_6M
  CONTROL_12M
  CONTROL_24M
  CONTROL_EXTRA
}

enum FollowUpConclusion {
  EXITO
  EN_CURACION
  FRACASO
  INCIERTO
}

enum RetreatmentFailureReason {
  FILTRACION_CORONAL
  INSTRUMENTO_FRACTURADO
  CONDUCTO_NO_TRATADO
  SOBREOBTURACION
  SUBOBTURACION
  FRACTURA_RADICULAR
  REINFECCION
  DESCONOCIDO
}

enum RetreatmentDifficulty {
  BAJA
  MEDIA
  ALTA
}

enum RetroFillingMaterial {
  MTA
  BIOCERAMIC_PUTTY
  SUPER_EBA
  IRM
  OTRO
}

enum FlapType {
  OCHSENBEIN_LUEBKE
  SULCULAR
  SEMILUNAR
  PAPILAR
}

enum EndoOutcomeStatus {
  EN_CURSO
  COMPLETADO
  FALLIDO
  ABANDONADO
}

enum PostOpRestorationType {
  CORONA_PORCELANA_METAL
  CORONA_ZIRCONIA
  CORONA_DISILICATO_LITIO
  ONLAY
  RESTAURACION_DIRECTA_RESINA
  POSTE_FIBRA_CORONA
  POSTE_METALICO_CORONA
}
```

### 4.3 Relaciones con modelos existentes

Se agregan relaciones inversas en modelos existentes:

```prisma
model Patient {
  // ...campos existentes
  endodonticDiagnoses   EndodonticDiagnosis[]
  vitalityTests         VitalityTest[]
  endodonticTreatments  EndodonticTreatment[]
}

model User {
  // ...campos existentes
  endoDiagnosisDoctor   EndodonticDiagnosis[]   @relation("EndoDiagnosisDoctor")
  vitalityDoctor        VitalityTest[]          @relation("VitalityDoctor")
  endoTreatmentDoctor   EndodonticTreatment[]   @relation("EndoTreatmentDoctor")
}

model PatientFile {
  // ...campos existentes
  conductometryRootCanals  RootCanal[]            @relation("ConductometryFile")
  followUpsAsControl       EndodonticFollowUp[]   @relation("FollowUpFile")
  apicalSurgeries          ApicalSurgery[]        @relation("ApicalSurgeryFile")
}

model Clinic {
  // ...campos existentes
  endodonticDiagnoses   EndodonticDiagnosis[]
  vitalityTests         VitalityTest[]
  endodonticTreatments  EndodonticTreatment[]
}
```

### 4.4 Migración SQL

Generación recomendada:

```bash
npx prisma migrate dev --name add_endodontics_module
```

Pasos manuales adicionales tras `prisma migrate`:

1. Agregar índice GIN sobre `irrigants` JSON para búsquedas tipo "todos los TC con NaOCl 5.25%":
   ```sql
   CREATE INDEX idx_endo_treatments_irrigants_gin
     ON endodontic_treatments USING GIN (irrigants);
   ```

2. Constraint de FDI válido (11..18, 21..28, 31..38, 41..48):
   ```sql
   ALTER TABLE endodontic_diagnoses
     ADD CONSTRAINT endo_diag_tooth_fdi_valid
     CHECK (
       (tooth_fdi BETWEEN 11 AND 18) OR
       (tooth_fdi BETWEEN 21 AND 28) OR
       (tooth_fdi BETWEEN 31 AND 38) OR
       (tooth_fdi BETWEEN 41 AND 48)
     );
   -- repetir para vitality_tests, endodontic_treatments
   ```

3. Constraint PAI score 1..5:
   ```sql
   ALTER TABLE endodontic_follow_ups
     ADD CONSTRAINT endo_followup_pai_valid
     CHECK (pai_score IS NULL OR pai_score BETWEEN 1 AND 5);
   ```

4. Constraint working length 1..40 mm (rango anatómico):
   ```sql
   ALTER TABLE root_canals
     ADD CONSTRAINT root_canal_wl_valid
     CHECK (working_length_mm BETWEEN 5 AND 40);
   ```

5. RLS Policy (Supabase) para multi-tenant:
   ```sql
   ALTER TABLE endodontic_diagnoses ENABLE ROW LEVEL SECURITY;
   CREATE POLICY endo_diag_tenant_isolation ON endodontic_diagnoses
     USING (clinic_id = current_setting('app.current_clinic_id')::uuid);
   -- repetir para todas las tablas nuevas
   ```


---

## 5. Server Actions

Cada mutación clínica es un Server Action separado en `app/actions/endodontics/`. Todas comparten:

- Validación con `zod` (en `lib/validation/endodontics.ts`).
- Resolución de `clinicId` via `getActiveClinicId()`.
- Resolución de `userId` via `getCurrentUser()`.
- Creación de audit log via `createAuditLog({ clinicId, userId, entity, entityId, action, before, after })`.
- Revalidación de path con `revalidatePath('/dashboard/patient/${patientId}')`.
- Try/catch con retorno discriminado: `{ ok: true, data } | { ok: false, error }`.

### 5.1 createDiagnosis

```ts
// app/actions/endodontics/createDiagnosis.ts
'use server'

import { z } from 'zod'
import { getActiveClinicId, getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { createAuditLog } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

const Schema = z.object({
  patientId: z.string().uuid(),
  toothFdi: z.number().int().refine(isValidFdi, 'FDI inválido'),
  pulpalDiagnosis: z.enum([
    'PULPA_NORMAL', 'PULPITIS_REVERSIBLE',
    'PULPITIS_IRREVERSIBLE_SINTOMATICA', 'PULPITIS_IRREVERSIBLE_ASINTOMATICA',
    'NECROSIS_PULPAR', 'PREVIAMENTE_TRATADO', 'PREVIAMENTE_INICIADO'
  ]),
  periapicalDiagnosis: z.enum([
    'TEJIDOS_PERIAPICALES_NORMALES',
    'PERIODONTITIS_APICAL_SINTOMATICA', 'PERIODONTITIS_APICAL_ASINTOMATICA',
    'ABSCESO_APICAL_AGUDO', 'ABSCESO_APICAL_CRONICO',
    'OSTEITIS_CONDENSANTE'
  ]),
  justification: z.string().max(2000).optional()
})

export async function createDiagnosis(input: z.infer<typeof Schema>) {
  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Datos inválidos' }

  const clinicId = await getActiveClinicId()
  const user = await getCurrentUser()
  if (!clinicId || !user) return { ok: false as const, error: 'No autorizado' }

  try {
    const created = await db.endodonticDiagnosis.create({
      data: {
        clinicId,
        patientId: parsed.data.patientId,
        doctorId: user.id,
        toothFdi: parsed.data.toothFdi,
        pulpalDiagnosis: parsed.data.pulpalDiagnosis,
        periapicalDiagnosis: parsed.data.periapicalDiagnosis,
        justification: parsed.data.justification,
        createdByUserId: user.id
      }
    })

    await createAuditLog({
      clinicId,
      userId: user.id,
      entity: 'EndodonticDiagnosis',
      entityId: created.id,
      action: 'CREATE',
      before: null,
      after: created
    })

    revalidatePath(`/dashboard/patient/${parsed.data.patientId}`)
    return { ok: true as const, data: created }
  } catch (e) {
    console.error('createDiagnosis', e)
    return { ok: false as const, error: 'Error al crear diagnóstico' }
  }
}

function isValidFdi(n: number) {
  return (n >= 11 && n <= 18) || (n >= 21 && n <= 28)
      || (n >= 31 && n <= 38) || (n >= 41 && n <= 48)
}
```

### 5.2 updateDiagnosis

Mismo patrón. Valida que el `clinicId` del registro coincida con el activo (defensivo aunque RLS lo cubra).

```ts
// app/actions/endodontics/updateDiagnosis.ts
'use server'
// Patrón análogo a createDiagnosis. Recibe id + campos editables.
// Audit log incluye snapshot before/after.
```

### 5.3 recordVitalityTest

```ts
// app/actions/endodontics/recordVitalityTest.ts
'use server'

const Schema = z.object({
  patientId: z.string().uuid(),
  toothFdi: z.number().int().refine(isValidFdi),
  controlTeeth: z.array(z.number().int()).min(1).max(4),
  testType: z.enum(['FRIO','CALOR','EPT','PERCUSION_VERTICAL',
                    'PERCUSION_HORIZONTAL','PALPACION_APICAL','MORDIDA_TOOTHSLOOTH']),
  result: z.enum(['POSITIVO','NEGATIVO','EXAGERADO','DIFERIDO','SIN_RESPUESTA']),
  intensity: z.number().int().min(0).max(10).optional(),
  notes: z.string().max(500).optional()
})

export async function recordVitalityTest(input: z.infer<typeof Schema>) {
  // patrón estándar: validar, escribir, audit, revalidar
}
```

### 5.4 startTreatment

Crea el `EndodonticTreatment` en estado `EN_CURSO`, paso 1 del wizard, vinculado a `diagnosisId` opcional. Si el paciente ya tiene un tratamiento activo en ese diente (`outcomeStatus: EN_CURSO` y mismo `toothFdi`), retorna error con sugerencia "Continúa el tratamiento existente".

```ts
// app/actions/endodontics/startTreatment.ts
'use server'

const Schema = z.object({
  patientId: z.string().uuid(),
  toothFdi: z.number().int(),
  treatmentType: z.enum(['TC_PRIMARIO','RETRATAMIENTO','APICECTOMIA',
                         'PULPOTOMIA_EMERGENCIA','TERAPIA_REGENERATIVA']),
  diagnosisId: z.string().uuid().optional(),
  isMultiSession: z.boolean().default(false)
})

export async function startTreatment(input: z.infer<typeof Schema>) {
  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Datos inválidos' }

  const clinicId = await getActiveClinicId()
  const user = await getCurrentUser()
  if (!clinicId || !user) return { ok: false as const, error: 'No autorizado' }

  // Bloquea duplicados activos
  const existing = await db.endodonticTreatment.findFirst({
    where: {
      clinicId,
      patientId: parsed.data.patientId,
      toothFdi: parsed.data.toothFdi,
      outcomeStatus: 'EN_CURSO',
      deletedAt: null
    }
  })
  if (existing) {
    return { ok: false as const,
             error: `Ya existe un tratamiento activo en el diente ${parsed.data.toothFdi}.`,
             existingId: existing.id }
  }

  const created = await db.endodonticTreatment.create({
    data: {
      clinicId,
      patientId: parsed.data.patientId,
      doctorId: user.id,
      toothFdi: parsed.data.toothFdi,
      treatmentType: parsed.data.treatmentType,
      diagnosisId: parsed.data.diagnosisId,
      isMultiSession: parsed.data.isMultiSession,
      currentStep: 1,
      sessionsCount: 1,
      outcomeStatus: 'EN_CURSO',
      createdByUserId: user.id
    }
  })

  await createAuditLog({ clinicId, userId: user.id, entity: 'EndodonticTreatment',
                         entityId: created.id, action: 'CREATE',
                         before: null, after: created })

  revalidatePath(`/dashboard/patient/${parsed.data.patientId}`)
  return { ok: true as const, data: created }
}
```

### 5.5 updateTreatmentStep

Avanza el wizard. Persiste por paso.

```ts
// app/actions/endodontics/updateTreatmentStep.ts
'use server'

const StepSchemas = {
  1: z.object({
    treatmentId: z.string().uuid(),
    rubberDamPlaced: z.boolean(),
    accessType: z.enum(['CONVENCIONAL','CONSERVADOR','RECTIFICACION_PREVIO','POSTE_RETIRADO'])
  }),
  2: z.object({
    treatmentId: z.string().uuid(),
    instrumentationSystem: z.enum(['PROTAPER_GOLD','PROTAPER_NEXT','WAVEONE_GOLD',
                                   'RECIPROC_BLUE','BIORACE','HYFLEX_EDM','TRUNATOMY',
                                   'MANUAL_KFILES','OTRO']),
    technique: z.enum(['ROTACION_CONTINUA','RECIPROCACION','MANUAL','HIBRIDA']),
    motorBrand: z.string().max(100).optional(),
    torqueSettings: z.string().max(100).optional(),
    rpmSetting: z.number().int().min(50).max(1500).optional()
    // los conductos se persisten con upsertRootCanal por separado
  }),
  3: z.object({
    treatmentId: z.string().uuid(),
    irrigants: z.array(z.object({
      substance: z.string(),
      concentration: z.string(),
      volumeMl: z.number().min(0).max(50),
      order: z.number().int()
    })).min(1).max(8),
    irrigationActivation: z.enum(['NINGUNA','SONICA','ULTRASONICA','LASER','XPF']),
    totalIrrigationMinutes: z.number().int().min(1).max(60).optional()
  }),
  4: z.object({
    treatmentId: z.string().uuid(),
    obturationTechnique: z.enum(['CONDENSACION_LATERAL','CONDENSACION_VERTICAL_CALIENTE',
                                 'OLA_CONTINUA','CONO_UNICO','TERMOPLASTICA_INYECTABLE',
                                 'BIOCERAMIC_SINGLE_CONE']),
    sealer: z.enum(['AH_PLUS','MTA_FILLAPEX','BIOROOT_RCS','BC_SEALER',
                    'TUBLISEAL','SEALAPEX','OTRO']),
    masterConePresetIso: z.number().int().optional(),
    postOpRestorationPlan: z.enum(['CORONA_PORCELANA_METAL','CORONA_ZIRCONIA',
                                   'CORONA_DISILICATO_LITIO','ONLAY',
                                   'RESTAURACION_DIRECTA_RESINA',
                                   'POSTE_FIBRA_CORONA','POSTE_METALICO_CORONA']),
    requiresPost: z.boolean(),
    postMaterial: z.string().max(100).optional(),
    restorationUrgencyDays: z.number().int().min(1).max(90).default(30),
    restorationDoctorId: z.string().uuid().optional()
  })
}

export async function updateTreatmentStep<S extends 1|2|3|4>(
  step: S,
  input: z.infer<typeof StepSchemas[S]>
) {
  const schema = StepSchemas[step]
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'Datos inválidos' }

  // Carga treatment, valida clinicId, escribe campos, avanza currentStep si corresponde,
  // crea audit log con before/after, revalida.
  // ...
}
```

Notas:

- Si `step === 4` y todos los conductos del tratamiento tienen `obturationQuality !== null`, se invoca `completeTreatment(treatmentId)` automáticamente al final.
- El wizard persiste un draft en `localStorage` con clave `endo:wizard:${treatmentId}` que se limpia al completar el paso.

### 5.6 upsertRootCanal

Crea o actualiza el conducto. Llamado desde el wizard paso 2 cuando el doctor agrega un conducto, o desde el drawer del conducto cuando lo edita.

```ts
// app/actions/endodontics/upsertRootCanal.ts
'use server'

const Schema = z.object({
  id: z.string().uuid().optional(),
  treatmentId: z.string().uuid(),
  canonicalName: z.enum(['MB','MB2','DB','MV','DV','MP','P','D','M','L',
                         'V','ML','DL','CONDUCTO_UNICO','OTRO']),
  customLabel: z.string().max(50).optional(),
  workingLengthMm: z.number().min(5).max(40),
  coronalReferencePoint: z.string().max(100),
  masterApicalFileIso: z.number().int().min(10).max(80),
  masterApicalFileTaper: z.number().min(0.02).max(0.12),
  apexLocatorReadingMm: z.number().min(5).max(40).optional(),
  radiographicLengthMm: z.number().min(5).max(40).optional(),
  apexLocatorBrand: z.string().max(50).optional(),
  conductometryFileId: z.string().uuid().optional(),
  obturationQuality: z.enum(['HOMOGENEA','ADECUADA','CON_HUECOS',
                             'SOBREOBTURADA','SUBOBTURADA']).optional(),
  notes: z.string().max(1000).optional()
})

export async function upsertRootCanal(input: z.infer<typeof Schema>) {
  // Valida treatment.clinicId === activeClinicId.
  // Si id provided -> update; si no -> create.
  // Audit log.
}
```

### 5.7 recordIntracanalMedication

Llamado al cerrar paso 3 si el TC es multi-sesión.

```ts
// app/actions/endodontics/recordIntracanalMedication.ts
'use server'

const Schema = z.object({
  treatmentId: z.string().uuid(),
  substance: z.enum(['HIDROXIDO_CALCIO','CTZ','LEDERMIX','FORMOCRESOL',
                     'PROPILENGLICOL','OTRO']),
  placedAt: z.coerce.date(),
  expectedRemovalAt: z.coerce.date().optional(),
  notes: z.string().max(500).optional()
})

export async function recordIntracanalMedication(input: z.infer<typeof Schema>) {
  // valida y crea
  // si treatment.isMultiSession === false, devuelve error
}
```

### 5.8 completeTreatment

Cierra el tratamiento, marca `outcomeStatus = COMPLETADO`, dispara `scheduleFollowUps` automáticamente para 6m, 12m y 24m, y dispara recordatorio WhatsApp pos-TC.

```ts
// app/actions/endodontics/completeTreatment.ts
'use server'

export async function completeTreatment(treatmentId: string) {
  // 1. valida que todos los conductos tienen obturationQuality
  // 2. valida que paso 4 tiene postOpRestorationPlan
  // 3. actualiza completedAt y outcomeStatus
  // 4. crea 3 EndodonticFollowUp (CONTROL_6M, CONTROL_12M, CONTROL_24M)
  //    con scheduledAt = completedAt + 6 / 12 / 24 meses
  // 5. encola recordatorio WhatsApp pos-TC inmediato
  // 6. encola recordatorio de restauración a 7d y 21d
  // 7. encola recordatorios de los 3 controles
  // 8. audit log
}
```

### 5.9 scheduleFollowUp / completeFollowUp

`scheduleFollowUp` se llama internamente por `completeTreatment`. `completeFollowUp` se llama desde `FollowUpDrawer` cuando el doctor cierra un control.

```ts
// app/actions/endodontics/completeFollowUp.ts
'use server'

const Schema = z.object({
  followUpId: z.string().uuid(),
  performedAt: z.coerce.date(),
  paiScore: z.number().int().min(1).max(5),
  symptomsPresent: z.boolean(),
  conclusion: z.enum(['EXITO','EN_CURACION','FRACASO','INCIERTO']),
  recommendedAction: z.string().max(1000).optional(),
  controlFileId: z.string().uuid().optional()
})

export async function completeFollowUp(input: z.infer<typeof Schema>) {
  // valida, escribe, audit log
  // si conclusion === FRACASO: marca treatment.outcomeStatus = FALLIDO y notifica al doctor
  // si conclusion === EN_CURACION y milestone === CONTROL_24M: programa CONTROL_EXTRA
}
```

### 5.10 createRetreatmentInfo / createApicalSurgery

Patrones análogos. `createRetreatmentInfo` se invoca cuando `treatmentType === RETRATAMIENTO` desde el wizard paso 1 (campos extra).

### 5.11 exportTreatmentReportPdf / exportLegalReportPdf

Generan PDFs vía `@react-pdf/renderer` (ver sección 11). Devuelven URL firmada de Supabase Storage.

### 5.12 Helper: createAuditLog (existente)

```ts
// lib/audit.ts (existente, se reutiliza tal cual)
export async function createAuditLog({
  clinicId, userId, entity, entityId, action, before, after
}: AuditInput) { /* ... */ }
```

### 5.13 Convención de errores

Todas las server actions devuelven el mismo discriminated union:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; existingId?: string }
```

En el cliente:

```tsx
const r = await createDiagnosis(input)
if (!r.ok) { toast.error(r.error); return }
toast.success('Diagnóstico registrado')
```

---

## 6. Componentes React

### 6.1 Árbol de componentes

```
<EndodonticsTab patientId>
  ├── <ToothMiniOdontogram patientId selectedFdi onSelect>     [izq 280px]
  └── <ToothCenterView patientId selectedFdi>                   [centro flex-1]
       ├── <DiagnosisCard toothFdi patientId>                   [sección 1]
       │    └── on click → <DiagnosisDrawer />
       │    └── on click "Pruebas" → <VitalityDrawer />
       ├── <CanalMap toothFdi treatment>                        [sección 2]
       │    └── on click conducto → <RootCanalDrawer />
       └── <ToothTimeline patientId toothFdi>                   [sección 3]
            └── on click control → <FollowUpDrawer />
            └── on click "Iniciar TC" → <TreatmentWizard />

<TreatmentWizard />                                             [overlay full]
  ├── <Step1Access />
  ├── <Step2Preparation />
  │    └── <RootCanalForm /> (×N conductos)
  ├── <Step3Irrigation />
  └── <Step4Obturation />
       └── on submit final → <ConsentModal /> si firma faltante

<ConsentModal />                                                [modal full-screen]
  └── <SignatureCanvas /> (reuso pediatría)
```

### 6.2 EndodonticsTab.tsx (entrada del módulo)

Componente cliente. Maneja estado del diente seleccionado en URL search param `?tooth=36` (deep-linkable).

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ToothMiniOdontogram } from './ToothMiniOdontogram'
import { ToothCenterView } from './ToothCenterView'
import { TreatmentWizard } from './TreatmentWizard'

interface Props {
  patientId: string
  initialEndoState: ToothEndoState[]  // server-fetched
}

export function EndodonticsTab({ patientId, initialEndoState }: Props) {
  const params = useSearchParams()
  const router = useRouter()
  const selectedFdi = Number(params.get('tooth')) || null

  const [wizardOpen, setWizardOpen] = useState(false)
  const [activeTreatmentId, setActiveTreatmentId] = useState<string | null>(null)

  function selectTooth(fdi: number) {
    const url = new URL(window.location.href)
    url.searchParams.set('tooth', String(fdi))
    router.replace(url.pathname + url.search)
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6 h-full">
      <ToothMiniOdontogram
        patientId={patientId}
        endoState={initialEndoState}
        selectedFdi={selectedFdi}
        onSelect={selectTooth}
      />

      {selectedFdi ? (
        <ToothCenterView
          patientId={patientId}
          toothFdi={selectedFdi}
          onStartTreatment={(tid) => { setActiveTreatmentId(tid); setWizardOpen(true) }}
          onContinueTreatment={(tid) => { setActiveTreatmentId(tid); setWizardOpen(true) }}
        />
      ) : (
        <EmptyState
          title="Selecciona un diente"
          description="Haz clic en cualquier diente del odontograma para ver su historial endodóntico."
        />
      )}

      {wizardOpen && activeTreatmentId && (
        <TreatmentWizard
          treatmentId={activeTreatmentId}
          onClose={() => setWizardOpen(false)}
          onComplete={() => { setWizardOpen(false); router.refresh() }}
        />
      )}
    </div>
  )
}
```

### 6.3 ToothMiniOdontogram.tsx (panel izquierdo)

Renderiza un odontograma condensado de los 32 dientes adultos (FDI). Cada diente coloreado según `endoState[fdi]`:

| Estado | Color token | Significado |
|---|---|---|
| `none` | `var(--text-3)` | Sin TC ni diagnóstico |
| `tc_exitoso` | `var(--success)` | TC con conclusión EXITO en último control |
| `tc_seguimiento` | `var(--warning)` | TC con controles pendientes pero sin alarma |
| `tc_alerta` | `#FB923C` (naranja) | PAI ≥ 3 o síntomas en último control |
| `tc_fracaso` | `var(--danger)` | Fracaso confirmado o retratamiento pendiente |
| `tc_en_curso` | `var(--info)` | Multi-sesión activa, no completado |
| `cirugia` | `#A78BFA` (morado) | Cirugía apical realizada |

Layout: 2 filas (superior/inferior), 16 dientes por fila (8 derecho + 8 izquierdo) con espacio central. Cada diente es un botón ovalado de 26×30 px con número FDI debajo. Diente seleccionado tiene ring de 2px en `var(--brand)`.

```tsx
'use client'

import { cn } from '@/lib/utils'

const FDI_UPPER_RIGHT = [18,17,16,15,14,13,12,11]
const FDI_UPPER_LEFT  = [21,22,23,24,25,26,27,28]
const FDI_LOWER_LEFT  = [38,37,36,35,34,33,32,31]
const FDI_LOWER_RIGHT = [41,42,43,44,45,46,47,48]

const STATE_COLORS: Record<EndoToothState, string> = {
  none:           'fill-[var(--text-3)] opacity-30',
  tc_exitoso:     'fill-[var(--success)]',
  tc_seguimiento: 'fill-[var(--warning)]',
  tc_alerta:      'fill-orange-400',
  tc_fracaso:     'fill-[var(--danger)]',
  tc_en_curso:    'fill-[var(--info)]',
  cirugia:        'fill-violet-400'
}

export function ToothMiniOdontogram({ patientId, endoState, selectedFdi, onSelect }: Props) {
  return (
    <aside className="w-[280px] rounded-xl bg-[var(--bg-elev)] border border-[var(--border-soft)] p-4">
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--text-1)]">Estado endodóntico</h3>
        <p className="text-xs text-[var(--text-3)] mt-0.5">Haz clic en un diente</p>
      </header>

      <div className="space-y-3">
        <ToothRow fdis={FDI_UPPER_RIGHT.concat(FDI_UPPER_LEFT)} {...} />
        <div className="border-t border-dashed border-[var(--border-soft)]" />
        <ToothRow fdis={FDI_LOWER_RIGHT.concat(FDI_LOWER_LEFT)} {...} />
      </div>

      <Legend />
    </aside>
  )
}
```

Loading skeleton: misma rejilla con dientes en color `var(--bg-elev-2)` pulsante.

### 6.4 DiagnosisCard.tsx (sección 1 — arriba)

Card que muestra:

- Diagnóstico AAE pulpar + periapical actual.
- Fecha del último diagnóstico y doctor.
- Mini-tabla de últimas 3 pruebas de vitalidad (tipo, resultado, fecha).
- Botón "Reevaluar diagnóstico" → abre `<DiagnosisDrawer />` modo edit/create.
- Botón "Pruebas de vitalidad" → abre `<VitalityDrawer />`.

Si no hay diagnóstico previo: muestra estado vacío con CTA "Capturar diagnóstico inicial".

```tsx
<section className="rounded-xl bg-[var(--bg-elev)] border border-[var(--border-soft)] p-5">
  <header className="flex items-start justify-between">
    <div>
      <h2 className="text-sm uppercase tracking-wide text-[var(--text-3)]">Diagnóstico</h2>
      <h3 className="mt-1 text-lg font-semibold text-[var(--text-1)]">
        {diagnosis ? AAE_LABELS[diagnosis.pulpalDiagnosis] : 'Sin diagnóstico'}
      </h3>
      {diagnosis && (
        <p className="text-sm text-[var(--text-2)]">
          {AAE_LABELS[diagnosis.periapicalDiagnosis]}
        </p>
      )}
    </div>
    <div className="flex gap-2">
      <button onClick={openVitalityDrawer} className="btn-secondary">
        <Activity className="w-4 h-4" /> Pruebas
      </button>
      <button onClick={openDiagnosisDrawer} className="btn-primary">
        {diagnosis ? 'Reevaluar' : 'Capturar diagnóstico'}
      </button>
    </div>
  </header>

  {diagnosis && (
    <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
      <Field label="Última actualización" value={formatDate(diagnosis.diagnosedAt)} />
      <Field label="Doctor" value={diagnosis.doctor.fullName} />
      <Field label="Justificación" value={diagnosis.justification ?? '—'} />
    </div>
  )}

  {recentVitality.length > 0 && (
    <div className="mt-5 pt-5 border-t border-[var(--border-soft)]">
      <h4 className="text-xs uppercase tracking-wide text-[var(--text-3)] mb-2">
        Pruebas recientes
      </h4>
      <table className="w-full text-sm">
        <thead className="text-[var(--text-3)]">
          <tr>
            <th className="text-left pb-1">Prueba</th>
            <th className="text-left pb-1">Diente</th>
            <th className="text-left pb-1">Resultado</th>
            <th className="text-right pb-1">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {recentVitality.map(v => <VitalityRow key={v.id} test={v} />)}
        </tbody>
      </table>
    </div>
  )}
</section>
```

### 6.5 CanalMap.tsx (sección 2 — centro)

El componente estrella. Carga la SVG estática del arquetipo correspondiente y colorea cada `<g id="canal-{name}">` dinámicamente.

Lógica de selección de SVG:

```ts
function selectCanalSvg(toothFdi: number, doctorPrefersAhmed: boolean): string {
  const cat = categorizeTooth(toothFdi)
  if (cat === 'incisor')        return '/specialties/endodontics/anatomy/incisor.svg'
  if (cat === 'canine')         return '/specialties/endodontics/anatomy/canine.svg'
  if (cat === 'premolar_upper') {
    // En arquetipo Vertucci: 14, 24 a menudo 2 conductos; 15, 25 a menudo 1.
    return defaultPremolarUpperCanals(toothFdi) === 2
      ? '/specialties/endodontics/anatomy/premolar-upper-2canal.svg'
      : '/specialties/endodontics/anatomy/premolar-upper-1canal.svg'
  }
  if (cat === 'premolar_lower') return '/specialties/endodontics/anatomy/premolar-lower.svg'
  if (cat === 'molar_upper')    return '/specialties/endodontics/anatomy/molar-upper-mb2.svg'
  if (cat === 'molar_lower')    {
    // Si el treatment tiene una nota de "conducto en C", usar SVG de C-shape
    return treatmentHasCShape ? 'molar-lower-cshape.svg' : 'molar-lower.svg'
  }
  return '/specialties/endodontics/anatomy/molar-lower.svg' // fallback
}
```

Coloreado dinámico: el SVG se inyecta como `dangerouslySetInnerHTML` (controlado, archivos propios) y luego un `useEffect` busca cada `<g id="canal-..."` y aplica `style.fill` según `obturationQuality` del conducto correspondiente:

```ts
const QUALITY_COLORS: Record<ObturationQuality | 'none', string> = {
  none:           '#3F3F46',
  HOMOGENEA:      '#22C55E',
  ADECUADA:       '#84CC16',
  CON_HUECOS:     '#EAB308',
  SOBREOBTURADA:  '#EF4444',
  SUBOBTURADA:    '#F97316'
}

useEffect(() => {
  if (!svgRef.current) return
  rootCanals.forEach(canal => {
    const id = `canal-${canal.canonicalName.toLowerCase()}`
    const g = svgRef.current!.querySelector<SVGGElement>(`#${id}`)
    if (g) {
      g.style.fill = QUALITY_COLORS[canal.obturationQuality ?? 'none']
      g.style.cursor = 'pointer'
      g.dataset.canalId = canal.id
    }
  })
}, [rootCanals])
```

Click handling (event delegation a nivel del SVG container):

```tsx
function onSvgClick(e: React.MouseEvent) {
  const target = (e.target as Element).closest('[data-canal-id]')
  if (!target) return
  const canalId = target.getAttribute('data-canal-id')
  if (canalId) onCanalClick(canalId)
}
```

Estados:

- **Sin tratamiento:** SVG renderizada con todos los conductos en gris (`#3F3F46`), opacidad 0.5, banner overlay "Inicia tratamiento de conductos" con botón.
- **Con tratamiento en curso:** conductos sin obturar en gris claro, los obturados con su color.
- **Con tratamiento completo:** todos coloreados.
- **Con cirugía apical:** raíz intervenida tiene un overlay de línea horizontal punteada al nivel de resección, con tooltip "Apicectomía: {longitudResecada} mm".

Tooltip al hover del conducto: nombre canónico, LT, lima maestra, calidad obturación.

### 6.6 ToothTimeline.tsx (sección 3 — abajo)

Timeline horizontal con eventos cronológicos del diente:

- Diagnóstico inicial (icono `Stethoscope`)
- Inicio de TC (icono `Play`)
- Cada sesión multi (icono `Repeat`)
- Medicación intraconducto colocada/retirada (icono `Beaker`)
- Obturación final (icono `CheckCircle2`)
- Restauración pos-TC (icono `Crown`)
- Controles 6m, 12m, 24m (icono `CalendarCheck` para realizados, `CalendarClock` para programados)
- Retratamiento iniciado (icono `RotateCcw`)
- Cirugía apical (icono `Scissors`)

Cada evento es un nodo en la línea, con miniatura de radiografía si aplica (con tooltip ampliable). Color del nodo según severidad (verde/ámbar/rojo). Click en evento abre el contexto correspondiente (drawer del control, drawer del conducto, etc.).

Render compacto: scroll horizontal si hay muchos eventos. Indicador de "hoy" como línea vertical punteada.

```tsx
<section className="rounded-xl bg-[var(--bg-elev)] border border-[var(--border-soft)] p-5">
  <header className="flex items-center justify-between mb-4">
    <h2 className="text-sm uppercase tracking-wide text-[var(--text-3)]">
      Línea de tiempo del diente
    </h2>
    <select className="select-sm">
      <option>Todos los eventos</option>
      <option>Solo controles</option>
      <option>Solo radiografías</option>
    </select>
  </header>

  <div className="relative overflow-x-auto pb-2">
    <div className="flex items-center gap-3 min-w-max relative">
      {events.map((ev, i) => (
        <TimelineNode key={ev.id} event={ev} isLast={i === events.length - 1} />
      ))}
    </div>
    <TodayMarker date={new Date()} />
  </div>
</section>
```

### 6.7 RootCanalDrawer.tsx

Drawer derecho de 480px que se abre al hacer clic en un conducto del `CanalMap`. Modo `view` o `edit`. Campos:

- Nombre canónico (dropdown enum, default según ID del SVG)
- Longitud de trabajo (mm) — input number con paso 0.5
- Punto de referencia coronal (text, sugerencias: "cúspide MV", "cúspide DV", "borde incisal", "MB cusp tip")
- Lima maestra apical: ISO (10..80) y conicidad (0.02..0.12)
- Lectura del localizador apical (mm) + marca del localizador (text)
- Longitud radiográfica (mm)
- Conductometría: archivo PatientFile (XRAY_PERIAPICAL) — selector con upload inline o link a archivos del paciente
- Calidad de obturación (radios: homogénea / adecuada / con huecos / sobreobturada / subobturada)
- Notas (textarea)

Botones: Guardar / Cancelar / Eliminar (con confirmación, soft delete).

### 6.8 DiagnosisDrawer.tsx

Drawer derecho 480px. Campos:

- Diagnóstico pulpar (radio cards con descripción AAE)
- Diagnóstico periapical (radio cards)
- Justificación (textarea, opcional)

Al guardar, opcionalmente sugiere abrir el wizard de TC si el diagnóstico es `PULPITIS_IRREVERSIBLE_*` o `NECROSIS_PULPAR`.

### 6.9 VitalityDrawer.tsx

Drawer derecho 600px (más ancho por la tabla). Permite agregar múltiples pruebas de una sentada:

- Tabla con filas dinámicas: + Agregar prueba
- Por fila: tipo de prueba (dropdown), diente evaluado (default = seleccionado), dientes control (multi-select 1..4), resultado (dropdown), intensidad (slider 0-10 cuando aplica EPT/Frío)
- Botón "Guardar todas"

Server action: `recordVitalityTest` se invoca por cada fila en `Promise.allSettled` y al final se reporta cuántas se guardaron / cuántas fallaron.

### 6.10 FollowUpDrawer.tsx

Drawer derecho 480px que se abre al hacer clic en un control en el timeline. Campos:

- Fecha real del control (default hoy)
- Síntomas presentes (radio sí/no, si sí: campo libre)
- PAI score 1-5 (radio cards con icono y descripción de Ørstavik)
- Conclusión: éxito / en curación / fracaso / incierto (radio)
- Acción recomendada (textarea, sugerencias según conclusión)
- Adjuntar radiografía de control (PatientFile XRAY_PERIAPICAL)

Si conclusión = fracaso, banner rojo: "Esto marcará el tratamiento como fallido y notificará al doctor."

### 6.11 TreatmentWizard/

Componente overlay full-page (no modal — es lo bastante denso para usar la pantalla completa con header de breadcrumb y stepper).

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Step1Access } from './Step1Access'
import { Step2Preparation } from './Step2Preparation'
import { Step3Irrigation } from './Step3Irrigation'
import { Step4Obturation } from './Step4Obturation'

interface Props {
  treatmentId: string
  onClose: () => void
  onComplete: () => void
}

export function TreatmentWizard({ treatmentId, onClose, onComplete }: Props) {
  const [step, setStep] = useState(1)
  const [draftSync, setDraftSync] = useState<Date | null>(null)

  // Carga treatment del server, hidrata draft de localStorage si más reciente
  // Persiste cambios en localStorage cada 5s

  return (
    <div className="fixed inset-0 z-50 bg-[var(--bg-base)] flex flex-col">
      <header className="border-b border-[var(--border-soft)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="btn-ghost"><X /></button>
          <div>
            <h1 className="text-lg font-semibold">
              Tratamiento de conductos — Diente {treatment.toothFdi}
            </h1>
            {draftSync && (
              <p className="text-xs text-[var(--text-3)]">
                Borrador guardado {timeAgo(draftSync)}
              </p>
            )}
          </div>
        </div>

        <Stepper current={step} steps={[
          { n: 1, label: 'Acceso' },
          { n: 2, label: 'Preparación' },
          { n: 3, label: 'Irrigación' },
          { n: 4, label: 'Obturación' }
        ]} />

        <div className="flex gap-2">
          {step > 1 && <button onClick={() => setStep(step - 1)} className="btn-secondary">Anterior</button>}
          {step < 4 && <button onClick={advanceStep} className="btn-primary">Siguiente</button>}
          {step === 4 && <button onClick={completeAndClose} className="btn-primary">Completar TC</button>}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        {step === 1 && <Step1Access treatment={treatment} onChange={updateLocalDraft} />}
        {step === 2 && <Step2Preparation treatment={treatment} onChange={updateLocalDraft} />}
        {step === 3 && <Step3Irrigation treatment={treatment} onChange={updateLocalDraft} />}
        {step === 4 && <Step4Obturation treatment={treatment} onChange={updateLocalDraft} />}
      </main>
    </div>
  )
}
```

### 6.12 ConsentModal.tsx

Modal full-screen reutilizando `<SignatureCanvas />` de pediatría.

Texto de consentimiento dinámico según `treatmentType`:

- TC primario: descripción del procedimiento + alternativas (extracción, no tratamiento) + riesgos generales (fractura instrumental, perforación, sobreobturación, fracaso, necesidad de retratamiento o cirugía, posible extracción) + riesgos específicos por tipo de diente (anteriores: cambio de color; molares: fractura coronal sin restauración).
- Retratamiento: agrega "probabilidad de éxito menor que tratamiento primario".
- Apicectomía: documento separado, riesgos quirúrgicos (sangrado, infección, parestesia en posteriores inferiores por proximidad al nervio dentario inferior, fracaso, posible extracción posterior).

El consentimiento se almacena como `PatientFile` con `FileCategory: CONSENT` y `meta: { treatmentId, signedAt }`.

### 6.13 RetreatmentBadge.tsx

Badge visual visible junto al número FDI cuando un diente está en retratamiento o cirugía. Iconos:

- Retratamiento: `RotateCcw` color naranja, fondo `var(--bg-elev-2)`.
- Cirugía apical: `Scissors` color violeta.

### 6.14 ApicalSurgeryDrawer.tsx

Drawer dedicado cuando `treatmentType === APICECTOMIA`. Campos del modelo `ApicalSurgery` + foto intraoperatoria.

### 6.15 SuccessRateChart.tsx

Componente recharts que renderiza el dashboard de tasa de éxito personal. Vive en `/dashboard/clinic/reportes/endodoncia` (no dentro del tab del paciente).

Visualizaciones:

- KPI: % de éxitos a 12m (todos los TC del doctor)
- KPI: % de éxitos a 24m
- BarChart por categoría de diente (anterior / premolar / molar)
- BarChart por sistema de instrumentación
- BarChart por diagnóstico inicial
- LineChart de evolución mensual

### 6.16 PendingFollowUpsList.tsx / PendingRestorationList.tsx

Listas filtrables (por mes, por doctor) con acción rápida "Llamar" / "Enviar WhatsApp" / "Agendar cita".

### 6.17 RadiographComparisonView.tsx

Vista lado a lado de hasta 4 radiografías del mismo diente: pre-TC, post-TC inmediato, control 6m, control 12m. Usa zoom sincronizado y pan sincronizado. Comparativo visual estándar en endodoncia.


---

## 7. Anatomía SVG — entregables y convenciones

### 7.1 Estructura por arquetipo

Cada SVG es un archivo estático en `public/specialties/endodontics/anatomy/`. ViewBox estándar: `0 0 200 400` (corte longitudinal del diente vertical). El componente `<CanalMap />` lo carga vía `fetch` y lo inyecta en el DOM controladamente.

Estructura común de cada SVG:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400">
  <defs>
    <linearGradient id="enamel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E5E7EB"/>
      <stop offset="1" stop-color="#9CA3AF"/>
    </linearGradient>
    <linearGradient id="dentin" ...>...</linearGradient>
  </defs>

  <!-- Esmalte -->
  <path id="enamel-shape" d="..." fill="url(#enamel)"/>

  <!-- Dentina -->
  <path id="dentin-shape" d="..." fill="url(#dentin)"/>

  <!-- Cámara pulpar -->
  <path id="pulp-chamber" d="..." fill="#7F1D1D" opacity="0.7"/>

  <!-- Conductos (el motor colorea estos) -->
  <g id="canal-mb"  data-canal-name="Mesiovestibular">
    <path d="M..." stroke="currentColor" stroke-width="3"/>
  </g>
  <g id="canal-mb2" data-canal-name="MB2">
    <path d="M..." stroke="currentColor" stroke-width="2.5"/>
  </g>
  <g id="canal-db"  data-canal-name="Distovestibular">
    <path d="M..." stroke="currentColor" stroke-width="3"/>
  </g>
  <g id="canal-p"   data-canal-name="Palatino">
    <path d="M..." stroke="currentColor" stroke-width="3"/>
  </g>

  <!-- Etiquetas (no se colorean dinámicamente) -->
  <g id="labels">
    <text x="50" y="380" font-size="10" fill="#71717A">MV</text>
    ...
  </g>
</svg>
```

### 7.2 Convención de IDs por SVG

| SVG | IDs de conducto |
|---|---|
| `incisor.svg` | `canal-unico` |
| `canine.svg` | `canal-unico` |
| `premolar-upper-1canal.svg` | `canal-unico` |
| `premolar-upper-2canal.svg` | `canal-v`, `canal-p` |
| `premolar-lower.svg` | `canal-unico` |
| `molar-upper-mb2.svg` | `canal-mb`, `canal-mb2`, `canal-db`, `canal-p` |
| `molar-lower.svg` | `canal-mv`, `canal-ml`, `canal-d` |
| `molar-lower-cshape.svg` | `canal-c-buccal`, `canal-c-isthmus`, `canal-c-lingual` |

Los IDs son **lowercase con guiones**. El componente normaliza el `canonicalName` del enum (ej. `MB2` → `mb2`) para hacer match.

### 7.3 Estilo visual

- **Estilo:** técnico esquemático estilo libro de texto (Cohen's Pathways of the Pulp 11th ed., Hargreaves), no realista.
- **Líneas:** stroke `#E5E7EB` para contornos en dark mode; el conducto recibe color por `style.fill` o `style.stroke` desde el motor.
- **Sin sombras realistas.** Sin gradientes complejos en los conductos (los conductos son trazos limpios coloreables).
- **Etiquetas:** font-size 10-12, color `#71717A`, fuera del área coloreable.
- **Anchos de stroke:** conducto principal 3px, conductos secundarios (MB2, accesorios) 2-2.5px.

### 7.4 Mapeo color → calidad

```ts
// lib/helpers/canalAnatomy.ts
export const QUALITY_COLORS: Record<ObturationQuality | 'none', string> = {
  none:           '#3F3F46',  // gris zinc-700
  HOMOGENEA:      '#22C55E',  // verde-500 — ideal
  ADECUADA:       '#84CC16',  // lima-500 — bien pero sin ser perfecto
  CON_HUECOS:     '#EAB308',  // ámbar-500 — aceptable, monitorear
  SOBREOBTURADA:  '#EF4444',  // rojo-500 — fuera del ápice
  SUBOBTURADA:    '#F97316'   // naranja-500 — corto del ápice
} as const
```

Tooltip al hover sobre un conducto coloreado:

```
Conducto Mesiovestibular (MB)
LT: 19.5 mm · Lima maestra: 25/.06
Calidad: Homogénea
Conductometría: ver radiografía →
```

### 7.5 Vertucci 1984 vs Ahmed 2017

Por defecto el módulo asume Vertucci. La configuración del doctor en `/dashboard/clinic/configuracion/especialidades/endodoncia` permite:

```
[ ] Usar clasificación Ahmed 2017 (avanzado)
    Ahmed describe variantes de raíces múltiples y conductos en C con notación
    sistemática. Recomendado solo si conoces la clasificación; el equipo de la
    clínica debe estar alineado.
```

Cuando el toggle está activo, el `RootCanalDrawer` muestra un campo extra "Notación Ahmed" (ej. `1¹MB1, 1²MB2`) y los reportes PDF lo incluyen.

### 7.6 Anatomía esperada por defecto (función helper)

```ts
// lib/helpers/canalAnatomy.ts
export function defaultCanalsForFdi(fdi: number): CanalCanonicalName[] {
  // Centrales y laterales superiores e inferiores: 1 conducto
  if ([11,12,21,22,31,32,41,42].includes(fdi)) return ['CONDUCTO_UNICO']

  // Caninos: 1 conducto
  if ([13,23,33,43].includes(fdi)) return ['CONDUCTO_UNICO']

  // Premolares superiores: 14, 24 frecuentemente 2 conductos (V+P); 15, 25 frecuentemente 1
  if ([14,24].includes(fdi)) return ['V','P']
  if ([15,25].includes(fdi)) return ['CONDUCTO_UNICO']

  // Premolares inferiores: 1 conducto (variabilidad anatómica alta)
  if ([34,35,44,45].includes(fdi)) return ['CONDUCTO_UNICO']

  // Molares superiores: MB, MB2, DB, P (MB2 presente en ~60% de primeros molares)
  if ([16,26,17,27].includes(fdi)) return ['MB','MB2','DB','P']

  // Tercer molar superior: variable, default 3 conductos
  if ([18,28].includes(fdi)) return ['MB','DB','P']

  // Molares inferiores: MV, ML, D
  if ([36,46,37,47].includes(fdi)) return ['MV','ML','D']

  // Tercer molar inferior: variable
  if ([38,48].includes(fdi)) return ['MV','ML','D']

  return ['CONDUCTO_UNICO']
}

export function categorizeTooth(fdi: number): ToothCategory {
  const last = fdi % 10
  if ([1,2].includes(last)) return 'incisor'
  if (last === 3)            return 'canine'
  if ([4,5].includes(last))  {
    return fdi >= 30 ? 'premolar_lower' : 'premolar_upper'
  }
  return fdi >= 30 ? 'molar_lower' : 'molar_upper'
}
```

---

## 8. UX Flows

### 8.1 Flujo: Nuevo TC primario (caso típico)

1. Doctor abre `/dashboard/patient/{id}` → tab "Endodoncia".
2. En el panel izquierdo, hace clic en el diente afectado (ej. 36).
3. Sección 1 muestra "Sin diagnóstico". Doctor presiona **"Capturar diagnóstico inicial"**.
4. Drawer derecho `<DiagnosisDrawer>` se abre. Doctor selecciona:
   - Pulpar: Pulpitis irreversible sintomática
   - Periapical: Periodontitis apical sintomática
   - Justificación: "Dolor pulsátil EVA 8/10, frío exagerado y persistente."
5. Guarda. Drawer se cierra.
6. Banner aparece en sección 1: "Diagnóstico de pulpitis irreversible. ¿Iniciar TC?"
7. Doctor presiona **"Iniciar TC"** → drawer modal de confirmación de tipo:
   - Tipo: TC primario / Retratamiento / Apicectomía / Pulpotomía emergencia / Terapia regenerativa
   - Multi-sesión: sí/no
8. Confirma → backend crea `EndodonticTreatment` con `currentStep: 1` → `<TreatmentWizard />` se abre.
9. **Antes de capturar el wizard**, si el paciente no tiene consentimiento firmado para este tratamiento, aparece `<ConsentModal>` full-screen. Doctor explica al paciente, paciente firma.
10. Wizard paso 1 (Acceso): doctor marca "Dique de hule colocado", "Acceso convencional".
11. Pasa a paso 2 (Preparación): selecciona ProTaper Gold + Rotación continua. Agrega 4 conductos uno por uno (MB, MB2, DB, P) con sus longitudes y limas maestras. Cada conducto puede tener su radiografía de conductometría adjuntada o agregada después.
12. Paso 3 (Irrigación): protocolo NaOCl 5.25% + EDTA 17% + NaOCl final, activación PUI 3 min. Si multi-sesión, agrega medicación intraconducto Ca(OH)₂.
13. Paso 4 (Obturación): técnica BioCeramic single cone + BC Sealer. Indica obturación y calidad por conducto. Plan de restauración: corona porcelana sobre metal en <30 días, derivado a `Dr. González`.
14. Presiona **"Completar TC"**. Backend marca `outcomeStatus: COMPLETADO`, agenda automáticamente:
    - WhatsApp inmediato pos-TC
    - Recordatorio restauración a 7d y 21d
    - Control 6m, 12m, 24m programados
15. Wizard se cierra, vista vuelve al diente seleccionado con el mapa canalicular ahora con todos los conductos coloreados en verde.

### 8.2 Flujo: TC multi-sesión

Mismos pasos 1-12. En paso 3 marca `medicación: hidróxido de calcio, fecha colocación hoy, retiro estimado +7d`. En paso 4 indica solo restauración temporal (Cavit + ionómero).

Al cerrar la sesión, `outcomeStatus` queda `EN_CURSO`. El timeline del diente muestra "Sesión 1 completada — medicación intraconducto activa".

Para sesión 2 (cita futura): doctor entra al tab Endodoncia, selecciona el diente, sección 1 muestra estado activo. Presiona **"Continuar tratamiento"** → wizard se reabre en paso 3 (irrigación final + retiro de medicación). Después salta directo a paso 4 (obturación) y lo completa.

El sistema diferencia "sesión actual" vs "TC completo" y solo agenda los seguimientos al cerrar paso 4 con todos los conductos obturados.

### 8.3 Flujo: Control de seguimiento (6m / 12m / 24m)

1. Recepcionista usa `PendingFollowUpsList` (vista de reportes) para ver controles del mes. Llama a Roberto.
2. Roberto agenda cita "Control endodóntico" — duración default 45 min.
3. Día de la cita, doctor abre paciente, tab Endodoncia, selecciona diente 36.
4. Timeline (sección 3) muestra control 6m **programado** en azul.
5. Doctor toma radiografía periapical → la sube via "Adjuntar radiografía" (o desde el módulo general de radiografías y luego la vincula al control).
6. Hace clic en el nodo "Control 6m" del timeline → se abre `<FollowUpDrawer>`:
   - Síntomas: ninguno
   - PAI score: 2 (cambio menor, no patológico)
   - Conclusión: en curación
   - Acción: control adicional a 24m
   - Adjunta radiografía
7. Guarda. Timeline actualiza el nodo a verde "realizado".
8. Sistema envía WhatsApp automático: "Tu control endodóntico fue exitoso, todo evoluciona bien. Tu siguiente control está programado para 12 meses."

### 8.4 Flujo: Retratamiento

1. Paciente Mariana llega con molestia en 21 (TC previo hace 4 años hecho por otro dentista).
2. Doctor selecciona 21. Si el sistema no tiene historia previa del 21, el mapa canalicular se ve vacío (gris claro).
3. Captura diagnóstico AAE: Previamente tratado + Periodontitis apical asintomática.
4. Presiona "Iniciar TC" → selecciona tipo **Retratamiento**.
5. Aparece sub-formulario `<RetreatmentBadge>`:
   - Motivo de fracaso: subobturación
   - Fecha de TC original: hace 4 años (aproximada)
   - Instrumentos fracturados: no
   - Dificultad estimada: media
6. Wizard procede igual que TC primario. Paso 1 incluye nota especial: "Acceso = retiro de obturación previa."
7. Al completar, el badge `RotateCcw` naranja queda asociado al diente en el odontograma del módulo.

### 8.5 Flujo: Cirugía apical

1. Después de un retratamiento fallido o lesión persistente, doctor decide apicectomía.
2. Presiona "Iniciar TC" → tipo: **Apicectomía**.
3. Wizard se reduce a 2 pantallas para apicectomía (no 4):
   - Pantalla 1: Datos clínicos pre-quirúrgicos + consentimiento quirúrgico (modal separado).
   - Pantalla 2: Datos quirúrgicos (raíz intervenida, longitud resecada, material retroobturación, tipo de colgajo, sutura, foto intraoperatoria).
4. Al completar, mapa canalicular muestra la raíz con línea horizontal punteada al nivel de resección.
5. Plan de control post-quirúrgico se agenda automáticamente (7 días retiro de sutura, 1 mes, 6 meses, 12 meses).

---

## 9. Wizard de TC — Detalle por paso

### 9.1 Paso 1: Acceso y aislamiento

**Objetivo:** documentar el acceso coronal y el aislamiento absoluto.

Campos:

- ✅ Dique de hule colocado (toggle)
- Tipo de acceso (radio):
  - Convencional (clase I oclusal)
  - Conservador (mínimamente invasivo, microscopio)
  - Rectificación de previo (en retratamiento)
  - Poste retirado (en retratamiento con poste)
- Notas del acceso (textarea, opcional, ej. "Cámara calcificada, localización con microscopio 8×")

Validación:

- Aviso (no bloqueo) si `rubberDamPlaced === false`: "El dique de hule es estándar de cuidado en endodoncia. ¿Confirmas que no se colocó?"

**Layout:** card centrado de 720px máx, con 2 columnas (toggle a la izquierda, dropdown + textarea a la derecha).

### 9.2 Paso 2: Preparación canalicular

**Objetivo:** registrar sistema de instrumentación + cada conducto con sus medidas.

**Header del paso:**

- Sistema de instrumentación (dropdown: ProTaper Gold, ProTaper Next, WaveOne Gold, Reciproc Blue, BioRaCe, HyFlex EDM, TruNatomy, Manual K-files, Otro)
- Técnica (radio: Rotación continua, Reciprocación, Manual, Híbrida)
- Marca del motor (text, opcional)
- Torque (text, opcional, ej. "preset por lima")
- RPM (number, opcional, ej. 300)

**Tabla de conductos (lo más importante del paso):**

```
┌──────────────────┬───────┬────────────────┬─────────────┬──────────────┬─────────────┬────────────┐
│ Conducto         │ LT mm │ Ref. coronal   │ Lima ISO    │ Conicidad    │ Loc. apical │ Acciones   │
├──────────────────┼───────┼────────────────┼─────────────┼──────────────┼─────────────┼────────────┤
│ Mesiovestibular  │ 19.5  │ cúspide MV     │ 25          │ 0.06         │ 19.0        │ ✏ ✕ 📎    │
│ MB2              │ 18.0  │ cúspide MV     │ 25          │ 0.06         │ —           │ ✏ ✕ 📎    │
│ Distovestibular  │ 18.5  │ cúspide DV     │ 25          │ 0.06         │ 18.5        │ ✏ ✕ 📎    │
│ Palatino         │ 20.0  │ cúspide P      │ 30          │ 0.06         │ 20.0        │ ✏ ✕ 📎    │
└──────────────────┴───────┴────────────────┴─────────────┴──────────────┴─────────────┴────────────┘
[+ Agregar conducto]    [Sugerir según FDI: 4 conductos esperados (MB, MB2, DB, P)]
```

Cada acción:

- ✏ → abre `<RootCanalDrawer>` modo edit
- ✕ → soft delete con confirmación
- 📎 → abre selector para vincular radiografía de conductometría

Validaciones:

- Mínimo 1 conducto para avanzar.
- LT entre 5 y 40 mm.
- ISO entre 10 y 80 (avisos fuera de rango común 15-50).
- No permitir dos conductos con mismo `canonicalName` excepto `OTRO` y `CONDUCTO_UNICO`.

Al lado de la tabla: visualización pequeña del mapa canalicular del diente (mismo SVG, escala 60%) que se actualiza en tiempo real conforme el doctor agrega conductos. Sin coloreado dinámico aún (no hay obturación todavía).

### 9.3 Paso 3: Irrigación y medicación

**Objetivo:** documentar el protocolo de irrigación y la medicación intraconducto si aplica.

**Sección Irrigación:**

Tabla de irrigantes (filas dinámicas):

```
┌──────┬──────────────────────┬─────────────────┬──────────┐
│ Orden│ Sustancia            │ Concentración   │ Volumen  │
├──────┼──────────────────────┼─────────────────┼──────────┤
│ 1    │ NaOCl                │ 5.25%           │ 10 ml    │
│ 2    │ EDTA                 │ 17%             │ 3 ml     │
│ 3    │ NaOCl (final)        │ 5.25%           │ 5 ml     │
│ 4    │ CHX (opcional)       │ 2%              │ 2 ml     │
└──────┴──────────────────────┴─────────────────┴──────────┘
[+ Agregar]
```

- Activación (radio: Ninguna / Sónica EndoActivator / Ultrasónica PUI / Láser PIPS-SWEEPS / XPF)
- Tiempo total de irrigación (number, minutos)

Plantillas pre-cargadas (botones rápidos): "Protocolo estándar (NaOCl + EDTA + NaOCl)", "Protocolo + CHX final", "Custom".

**Sección Medicación intraconducto** (visible solo si `treatment.isMultiSession === true`):

- Sustancia (radio: Hidróxido de calcio, CTZ, Ledermix, Formocresol — desaconsejado, Propilenglicol, Otro)
- Fecha de colocación (default hoy)
- Fecha estimada de retiro (default +7 días)
- Notas (textarea)

Si toda la captura del paso 3 está completa y el TC es multi-sesión, banner "Esta sesión termina aquí. La obturación se hará en la siguiente cita."

### 9.4 Paso 4: Obturación y restauración

**Objetivo:** registrar técnica de obturación, calidad por conducto y plan de restauración pos-TC.

**Sección Obturación:**

- Técnica (radio cards con icono):
  - Condensación lateral (cono maestro + accesorios)
  - Condensación vertical caliente (Schilder)
  - Ola continua (System B)
  - Cono único (gutapercha sola)
  - Termoplástica inyectable (Obtura, Calamus)
  - **BioCeramic single cone** (preferido en los últimos años)
- Cemento (dropdown: AH Plus, MTA Fillapex, BioRoot RCS, BC Sealer, TubliSeal, Sealapex, Otro)
- Cono maestro ISO + conicidad (opcional, default según lima maestra del paso 2)

**Calidad por conducto** (tabla obligatoria, una fila por conducto creado en paso 2):

```
Conducto         | Calidad obturación
─────────────────┼─────────────────────────────────────
Mesiovestibular  | (○) Homogénea (●) Adecuada (○) Con huecos (○) Sobreobturada (○) Subobturada
MB2              | (●) Homogénea (○) Adecuada ...
...
```

**Sección Restauración pos-TC:**

- Tipo (radio):
  - Corona porcelana sobre metal
  - Corona zirconia
  - Corona disilicato litio
  - Onlay
  - Restauración directa con resina
  - Poste de fibra + corona
  - Poste metálico + corona (poco recomendado)
- ¿Requiere poste? (toggle)
- Material del poste (text, condicional)
- Urgencia (number, días, default 30 — alerta si > 30)
- Derivado a doctor (selector de doctores de la clínica, opcional)
- Notas (textarea)

**Validación final del paso:**

- Todos los conductos del paso 2 deben tener `obturationQuality` para poder completar.
- Si la calidad de algún conducto es `SOBREOBTURADA`, banner amarillo: "Considera control radiográfico inmediato."
- Si la calidad de algún conducto es `CON_HUECOS` o `SUBOBTURADA`, banner amarillo: "Considera retratamiento de ese conducto."

Al presionar **"Completar TC"** se invoca `completeTreatment(treatmentId)`.

### 9.5 Validaciones y autosave

- **Autosave de borrador:** cada cambio de campo persiste en `localStorage` con clave `endo:wizard:${treatmentId}` debounced a 1500ms. Al montar el wizard, hidrata desde localStorage si la versión local es más reciente que la del server (compara `updatedAt`).
- **Persistencia en server:** al avanzar de paso (botón "Siguiente") se invoca `updateTreatmentStep(step, payload)`. Si falla, el paso no avanza y el toast describe el error específico.
- **Salida sin completar:** botón X en header pregunta "¿Guardar borrador? El TC quedará en estado EN_CURSO." Default sí.
- **Recovery:** si el doctor cierra el navegador a media captura, al volver al diente verá banner "Tienes un TC en curso. Continuar →" que abre el wizard en el paso correcto.

---

## 10. Integraciones con flujo existente

### 10.1 Appointment — duraciones sugeridas

`lib/helpers/endoAppointmentDurations.ts`:

```ts
export function suggestEndoAppointmentDuration(reason: string): number {
  const lower = reason.toLowerCase()
  if (lower.includes('control')) return 45
  if (lower.includes('retratamiento')) return 90
  if (lower.includes('apicectomia') || lower.includes('cirugía apical')) return 90
  if (lower.includes('tc') || lower.includes('tratamiento de conducto')) return 90
  if (lower.includes('pulpotomia')) return 30
  return 60
}
```

Cuando el motivo de la cita contiene esos keywords, el formulario de cita pre-llena `durationMinutes`. El doctor puede editar.

**Sugerencia de siguiente sesión:** al cerrar la cita actual, si el paciente tiene un TC con `outcomeStatus === EN_CURSO` y `isMultiSession === true`, modal sugerente: "Este paciente tiene un TC multi-sesión activo en el diente {fdi}. ¿Agendar siguiente sesión?" con sugerencia de fecha en función de la `expectedRemovalAt` de la medicación intraconducto.

### 10.2 SOAP pre-fill

Cuando el doctor abre la nota SOAP de la cita y el motivo o el plan de tratamiento referencian el diente con TC activo, los 4 campos S/O/A/P se pre-llenan parcialmente (editable):

```ts
// lib/helpers/soapPrefillEndo.ts
export async function prefillSoapForEndo(
  patientId: string, toothFdi: number
): Promise<SoapPrefill> {
  const [diag, vitality, activeTreatment, lastFollowUp] = await Promise.all([
    getLatestDiagnosis(patientId, toothFdi),
    getRecentVitality(patientId, toothFdi, 3),
    getActiveTreatment(patientId, toothFdi),
    getLastFollowUp(patientId, toothFdi)
  ])

  return {
    subjective: composeSubjective(diag, activeTreatment),
    objective:  composeObjective(vitality, lastFollowUp),
    assessment: composeAssessment(diag),
    plan:       composePlan(activeTreatment)
  }
}
```

Ejemplos de salida:

- **S (Subjetivo):** "Paciente refiere dolor pulsátil en diente 36, EVA 8/10, despertar nocturno desde hace 3 días."
- **O (Objetivo):** "Frío en 36: respuesta exagerada y persistente >30s. Percusión vertical positiva. Diagnóstico AAE: pulpitis irreversible sintomática + periodontitis apical sintomática."
- **A (Análisis):** "Pulpitis irreversible sintomática + periodontitis apical sintomática en 36."
- **P (Plan):** "TC en 36 en 2 sesiones. Sesión 1 hoy: acceso, instrumentación, irrigación, medicación con Ca(OH)₂. Sesión 2 en 7-10 días: obturación. Restauración con corona en <30 días."

### 10.3 Plan de tratamiento

Cuando el doctor crea o cierra un `EndodonticTreatment`, se inserta un ítem en el plan de tratamiento general del paciente con:

- Concepto: "Tratamiento de conductos en {fdi} ({sessionsCount} sesiones)"
- Precio: pre-llenado del catálogo de servicios de la clínica si tiene "TC molar / premolar / anterior"
- **Dependencia obligatoria:** subitem "Restauración definitiva pos-TC en {fdi}" con plazo `restorationUrgencyDays` (default 30 días) y status `pendiente` hasta que se registre la finalización.

### 10.4 Odontograma general (existente)

Se modifica el componente `<Odontogram />` existente (no se reemplaza) para:

- Agregar icono endodóntico distintivo (ej. punto rojo en el ápice del diente con TC).
- Click en diente → si tiene historia endodóntica, ofrecer en el menú contextual la opción "Ver historial endodóntico" que navega a `/dashboard/patient/{id}?tab=endodoncia&tooth={fdi}`.

### 10.5 Radiografías (PatientFile + XrayAnalysis)

- Se reutiliza el modal `<UploadPatientFileModal>` existente con `defaultCategory="XRAY_PERIAPICAL"` cuando se sube desde el módulo endo.
- El campo `meta` de `PatientFile` puede incluir:
  ```json
  { "linkedToothFdi": 36, "endoContext": "conductometry", "rootCanalId": "uuid" }
  ```
  Esto permite buscar todas las radiografías endodónticas de un diente.
- `XrayAnalysis` (modelo de IA existente que detecta lesiones periapicales en radiografías) en v2.0 alimentará automáticamente un PAI score sugerido. En MVP se muestra el resultado del análisis IA como texto informativo en el `FollowUpDrawer` ("La IA detectó lesión periapical de ~3 mm. PAI sugerido: 3.").

### 10.6 Recetas NOM-024 — plantillas endodónticas

Se agregan 3 plantillas al módulo de recetas existente:

**Plantilla "Pos-TC estándar":**
```
Ibuprofeno 600 mg, vía oral, cada 8 h por 3 días.
Paracetamol 500 mg, vía oral, cada 6 h en caso de dolor adicional (rescate, máximo 4 dosis al día).
```

**Plantilla "Pos-TC con absceso":**
```
Amoxicilina 875 mg + ácido clavulánico 125 mg, vía oral, cada 12 h por 7 días.
Ibuprofeno 600 mg, vía oral, cada 8 h por 3 días.
Indicaciones: tomar con alimentos. Si presenta erupción cutánea o diarrea severa, suspender y comunicarse al consultorio.
```

**Plantilla "Pos-cirugía apical":**
```
Amoxicilina 875 mg + ácido clavulánico 125 mg, vía oral, cada 12 h por 7 días.
Ibuprofeno 600 mg, vía oral, cada 8 h por 5 días.
Clorhexidina 0.12% colutorio, 15 ml, enjuagar 60 segundos cada 12 h por 7 días (no comer ni beber 30 min posteriores).
Indicaciones: dieta fría y blanda 24 h, no escupir ni hacer enjuagues vigorosos las primeras 24 h, frío local intermitente las primeras 6 h.
```

Las plantillas son editables por el doctor antes de imprimir/enviar (NOM-024 obliga responsabilidad del prescriptor).

### 10.7 Recordatorios WhatsApp

Templates en `lib/helpers/whatsappTemplatesEndo.ts`:

```ts
export const WA_TEMPLATES = {
  preTcReminder: (patientName: string, dateTime: string, doctorName: string) =>
    `Hola ${patientName}, te recordamos tu cita endodóntica el ${dateTime} con ${doctorName}. ` +
    `Recomendaciones: come algo ligero 1 hora antes, trae tus radiografías recientes si las tienes. ` +
    `Cualquier duda, responde a este mensaje.`,

  postTcImmediate: (patientName: string, toothFdi: number) =>
    `${patientName}, tu tratamiento de conductos en el diente ${toothFdi} se completó hoy. ` +
    `Es normal sentir sensibilidad por 24 a 72 horas. Toma tu medicamento como te indicamos. ` +
    `Si el dolor es intenso o persiste más de 3 días, llámanos.`,

  restorationReminder7d: (patientName: string, toothFdi: number) =>
    `${patientName}, han pasado 7 días de tu tratamiento de conductos en el diente ${toothFdi}. ` +
    `Recuerda agendar tu restauración definitiva (corona, onlay o resina) en las próximas 3 semanas para evitar fractura del diente.`,

  restorationReminder21d: (patientName: string, toothFdi: number) =>
    `${patientName}, ya van 21 días desde tu tratamiento de conductos en el diente ${toothFdi} y aún no tienes la restauración definitiva. ` +
    `Tu diente está en riesgo de fractura. Agenda lo antes posible respondiendo este mensaje.`,

  followUp6m: (patientName: string, toothFdi: number) =>
    `${patientName}, te recordamos que pronto cumples 6 meses de tu tratamiento de conductos en el diente ${toothFdi}. ` +
    `Aunque no tengas molestias, el control radiográfico es importante para confirmar el éxito del tratamiento. Agenda tu control respondiendo este mensaje.`,

  followUp12m: (patientName: string, toothFdi: number) =>
    `${patientName}, ya cumpliste un año de tu tratamiento de conductos en el diente ${toothFdi}. ` +
    `Te invitamos a tu control anual para verificar la cicatrización.`,

  followUp24m: (patientName: string, toothFdi: number) =>
    `${patientName}, han pasado 2 años de tu tratamiento de conductos en el diente ${toothFdi}. ` +
    `Este es el último control de seguimiento programado. Agenda para confirmar éxito final del tratamiento.`,

  followUpResultPositive: (patientName: string, toothFdi: number, nextDate?: string) =>
    `${patientName}, tu control endodóntico en el diente ${toothFdi} fue exitoso. ` +
    `Todo evoluciona bien.${nextDate ? ` Tu siguiente control está programado para ${nextDate}.` : ''}`
}
```

Los recordatorios se encolan en el job runner existente (`jobs/whatsappQueue.ts`) usando el template apropiado.

### 10.8 Audit log

Cada server action de mutación llama a `createAuditLog`. La pestaña "Auditoría" del expediente del paciente filtrable por entity = `EndodonticTreatment` muestra el historial completo de cambios con before/after JSON expandible.

---

## 11. Reportes y Exportes

### 11.1 Informe al doctor referente (PDF)

Cuando el endodoncista no es el doctor de cabecera del paciente, el informe se entrega al referente. Generación con `@react-pdf/renderer`.

Contenido:

- Header con logo de la clínica, datos del consultorio (cédula del endodoncista NOM-024).
- Datos del paciente: nombre, edad, expediente.
- Datos del referente.
- Diagnóstico AAE pulpar y periapical.
- Tratamiento realizado (tipo, número de sesiones, fechas).
- **Mapa canalicular** (mismo SVG embebido como imagen, con conductos coloreados).
- Tabla de conductos: nombre, LT, lima maestra, conicidad, calidad de obturación.
- Sistema de instrumentación, irrigación, obturación, cemento.
- **Recomendación de restauración:** tipo + plazo en días + urgencia.
- Plan de seguimiento programado.
- Firma electrónica del endodoncista (cédula).
- Footer NOM-024 con número de expediente.

Generación:

```ts
// app/actions/endodontics/exportTreatmentReportPdf.ts
'use server'

import { renderToBuffer } from '@react-pdf/renderer'
import { TreatmentReportDocument } from '@/lib/pdf/treatmentReport'

export async function exportTreatmentReportPdf(treatmentId: string) {
  const data = await fetchFullTreatment(treatmentId)
  const pdfBuffer = await renderToBuffer(<TreatmentReportDocument data={data} />)
  const url = await uploadToSupabaseStorage(pdfBuffer, `endo-reports/${treatmentId}.pdf`)
  return { ok: true as const, url }
}
```

### 11.2 Informe legal NOM-024 (PDF)

Documento extensivo para uso legal/auditoría. Contenido:

- Todo lo anterior +
- Pruebas de vitalidad documentadas (todas).
- Protocolo de irrigación detallado por sesión.
- Medicación intraconducto si aplicó.
- **Todas las radiografías** del tratamiento (inicial, conductometrías por conducto, post-TC inmediato, controles 6/12/24m).
- Audit log resumido (lista de modificaciones con fecha, doctor, acción).
- Consentimiento informado firmado embebido.
- Certificación: "Documento generado conforme a NOM-024-SSA3-2012."

### 11.3 Dashboard tasa de éxito personal del doctor

Vive en `/dashboard/clinic/reportes/endodoncia/tasa-de-exito`. Solo el doctor ve sus propios datos (a menos que sea admin de clínica, que ve agregado).

KPIs principales:

- **% éxito a 12m:** (tratamientos con `controlFollowUp12m.conclusion === EXITO`) / (total tratamientos con control 12m realizado) × 100.
- **% éxito a 24m:** análogo con CONTROL_24M.
- **% retratamientos:** retratamientos / total TC.
- **Tasa de adherencia a controles:** (controles realizados) / (controles programados).

Breakdowns:

- Por categoría de diente (anterior / premolar / molar) — bar chart.
- Por sistema de instrumentación — bar chart.
- Por diagnóstico inicial AAE — bar chart.
- Tendencia mensual de tasa de éxito — line chart.

Filtros: rango de fechas, doctor (si admin), tipo de tratamiento.

Recharts componentes usados:

```tsx
<BarChart data={byToothCategory}>
  <CartesianGrid stroke="var(--border-soft)" />
  <XAxis dataKey="category" />
  <YAxis />
  <Tooltip />
  <Bar dataKey="successRate12m" fill="var(--success)" />
  <Bar dataKey="successRate24m" fill="var(--info)" />
</BarChart>
```

### 11.4 Lista de controles pendientes

Vista filtrable por mes para que la recepcionista pueda llamar/escribir.

Columnas: paciente, diente, tipo de control, fecha programada, días de retraso, doctor responsable, último contacto WhatsApp, acciones (Llamar / Enviar WA / Agendar).

Filtros: mes, doctor, tipo de control (6m/12m/24m), retraso mayor a N días.

### 11.5 Lista de TC sin restauración definitiva

Alerta clínica importante: TC sin restaurar a 30 días tiene riesgo significativo de fracaso por filtración coronal.

Columnas: paciente, diente, fecha TC, días desde TC, derivado a, último contacto.

Banner rojo en filas con > 30 días.

### 11.6 Comparativo radiográfico

Componente que muestra hasta 4 radiografías del mismo diente lado a lado: pre-TC, post-TC inmediato, control 6m, control 12m. Zoom y pan sincronizados (cuando el doctor hace zoom en una, las demás hacen zoom igual).

Implementación con `react-zoom-pan-pinch` o componente custom basado en CSS transforms. Barra inferior con miniaturas para cambiar las 4 radiografías mostradas.

---

## 12. Compliance

### 12.1 NOM-024-SSA3-2012

Documentación obligatoria mínima del expediente endodóntico (verificable en cualquier auditoría de la SSA):

- Diagnóstico clínico (pulpar y periapical).
- Plan de tratamiento.
- Procedimientos realizados con fecha y profesional responsable.
- Materiales utilizados (sistema de instrumentación, irrigantes, cemento, cono maestro).
- Radiografías inicial, de conductometría y post-tratamiento.
- Indicaciones pos-operatorias.
- Consentimiento informado firmado.
- Conservación: 5 años mínimos desde la última intervención.

El módulo cumple porque:

- Ningún campo crítico (diagnóstico, LT, materiales) es opcional al completar el wizard.
- Las radiografías están vinculadas al tratamiento y/o al conducto específico (no como archivos sueltos).
- El consentimiento se almacena con firma y `signedAt`.
- El `EndodonticTreatment` y todos sus relacionados son soft-delete (`deletedAt`), nunca hard-delete, manteniendo la cadena legal.
- El audit log registra cada modificación.

### 12.2 LFPDPPP — Datos sensibles de salud

Las radiografías y el CBCT son **datos personales sensibles** (datos de salud). Aviso de privacidad LFPDPPP debe incluir explícitamente:

- Uso de imágenes diagnósticas (radiografías, fotos intraorales, CBCT).
- Almacenamiento en servidores de terceros (Supabase = subencargado de tratamiento).
- Posibilidad de ejercer derechos ARCO sobre las imágenes.

El consentimiento del paciente al registrarse en MediFlow ya incluye una cláusula general de datos de salud. **Adicionalmente**, el consentimiento informado de endodoncia incluye una cláusula específica sobre uso de radiografías para enseñanza/investigación que el paciente puede aceptar o rechazar por separado (opt-out).

### 12.3 Consentimiento informado de endodoncia (MVP)

Texto legal en `lib/legal/endoConsent.ts`:

```ts
export function getEndoConsentText(
  toothFdi: number,
  treatmentType: EndoTreatmentType,
  patient: Patient,
  doctor: User,
  clinic: Clinic
): string {
  return `
CONSENTIMIENTO INFORMADO PARA TRATAMIENTO DE ENDODONCIA

Yo, ${patient.fullName}, mayor de edad / representado(a) por mi tutor(a) ${patient.guardianName ?? ''},
en pleno uso de mis facultades mentales, declaro:

1. PROCEDIMIENTO. Autorizo al Dr(a). ${doctor.fullName}, con cédula profesional ${doctor.medicalLicense},
   a realizar el siguiente procedimiento en el diente ${toothFdi}:
   ${treatmentLabel(treatmentType)}.

   Este procedimiento consiste en eliminar el tejido pulpar (nervio) y los microorganismos del interior
   del diente, limpiar y dar forma a los conductos radiculares, irrigar con sustancias antimicrobianas
   y rellenarlos con un material biocompatible.

2. ALTERNATIVAS. He sido informado(a) de las siguientes alternativas:
   a) Extracción del diente.
   b) No realizar tratamiento alguno.
   Comprendo que ambas alternativas tienen consecuencias propias.

3. RIESGOS Y POSIBLES COMPLICACIONES. Comprendo y acepto los siguientes riesgos:
   - Fractura de instrumental dentro del conducto.
   - Perforación radicular o coronal.
   - Sobreobturación o subobturación del conducto.
   - Persistencia o reaparición de los síntomas.
   - Necesidad de retratamiento o de cirugía apical complementaria.
   - Posible extracción del diente si el tratamiento fracasa.
   ${treatmentType === 'RETRATAMIENTO' ? `
   - Probabilidad de éxito menor que en un tratamiento primario.` : ''}
   ${categorizeTooth(toothFdi) === 'incisor' || categorizeTooth(toothFdi) === 'canine' ? `
   - Posible cambio de color de la corona del diente con el tiempo.` : ''}
   ${categorizeTooth(toothFdi).includes('molar') ? `
   - Riesgo de fractura coronal si el diente no recibe restauración definitiva (corona) en menos de 30 días.` : ''}

4. RESTAURACIÓN POS-TRATAMIENTO. Reconozco que el éxito del tratamiento depende de la colocación de
   una restauración definitiva (corona, onlay o restauración directa) dentro de los 30 días siguientes.
   Si no acudo a esa restauración, el tratamiento puede fracasar y el diente perderse, sin
   responsabilidad del profesional tratante.

5. RADIOGRAFÍAS. Autorizo la toma y conservación de las radiografías necesarias para el diagnóstico,
   tratamiento y seguimiento. Las radiografías formarán parte de mi expediente clínico conforme a
   NOM-024-SSA3-2012 por un mínimo de 5 años.

6. AVISO DE PRIVACIDAD. Manifiesto haber leído el Aviso de Privacidad de ${clinic.name} y conozco
   mis derechos ARCO bajo la LFPDPPP.

Lugar y fecha: ${clinic.city}, ${formatDate(new Date())}

Firma del paciente / tutor:                 Firma del profesional:
[FIRMA_PACIENTE]                            [FIRMA_DOCTOR]
  `.trim()
}
```

### 12.4 Consentimiento de cirugía apical

Documento separado, más extenso. Incluye explícitamente:

- Naturaleza quirúrgica del procedimiento.
- Anestesia local con vasoconstrictor.
- **Riesgo de parestesia** en cirugía de molares inferiores (proximidad al nervio dentario inferior).
- Riesgo de hemorragia, infección postoperatoria, dehiscencia de sutura.
- Posible fracaso quirúrgico y necesidad de extracción posterior.
- Indicaciones pos-quirúrgicas detalladas.

### 12.5 Backup de radiografías

Las radiografías son la principal evidencia legal en juicios por mala praxis. **Pérdida = problema mayor.**

Implementación de backup:

- Storage primario: Supabase Storage bucket `patient-files`.
- Backup secundario semanal: cron job que sincroniza a S3 (bucket frío) usando `s3 sync`. Configurable por clínica.
- Verificación semanal: hash SHA-256 de cada PatientFile crítico (categorías XRAY_*) almacenado en columna `fileHash`. Cron job verifica que el hash coincida con el archivo en storage primario.
- Alerta automática al admin de la clínica si se detecta corrupción o pérdida.

---

## 13. Estados visuales

### 13.1 Estados de la pantalla principal

| Estado | Descripción | Componente / mensaje |
|---|---|---|
| **Sin paciente seleccionado** | Tab abierto sin contexto | "Selecciona un paciente para ver el módulo de endodoncia." |
| **Paciente sin TC** | Ningún diente con historia endodóntica | Odontograma en gris. Banner: "Este paciente aún no tiene tratamientos endodónticos registrados. Selecciona un diente para empezar." |
| **Diente sin TC seleccionado** | Click en diente sin historia | Sección 1: "Sin diagnóstico". Sección 2: mapa canalicular con anatomía esperada en gris claro. Sección 3: timeline vacío. CTA central: "Capturar diagnóstico inicial" o "Iniciar TC directamente". |
| **TC en curso multi-sesión** | Sesión actual destacada | Banner azul en sección 1: "TC multi-sesión activo — sesión 2 pendiente. Medicación de Ca(OH)₂ desde {fecha}." Botón "Continuar TC". |
| **TC completado, en seguimiento** | Controles programados | Mapa canalicular completo coloreado. Timeline muestra controles futuros. Sección 1 "TC completado el {fecha}". |
| **Control con PAI ≥ 3** | Alerta clínica | Banner naranja: "El último control mostró PAI {score}. Considera evaluación adicional." Sección 1 muestra conclusión del control. |
| **Retratamiento en curso** | Tratamiento de tipo retratamiento | Badge `RotateCcw` naranja junto al FDI en odontograma. Banner amarillo: "Retratamiento en curso. Motivo del fracaso original: {reason}." |
| **Cirugía apical realizada** | Apicectomía completada | Icono `Scissors` violeta en mapa canalicular sobre la raíz intervenida. Línea horizontal punteada al nivel de resección. |
| **Restauración pos-TC pendiente >30d** | Alerta urgente | Banner rojo persistente en sección 1: "Han pasado {N} días desde el TC y aún no hay restauración definitiva. Riesgo alto de fractura/filtración." Botón "Marcar restauración completada" o "Notificar al paciente". |

### 13.2 Loading skeletons

- Panel izquierdo: 32 dientes en `bg-elev-2` con `animate-pulse`.
- Sección 1: card con líneas de skeleton.
- Sección 2: SVG genérica en gris uniforme.
- Sección 3: timeline con 4 nodos placeholder en `bg-elev-2`.

### 13.3 Errores

- Toast con descripción accionable.
- Si error en server action durante wizard: banner inline en el paso del wizard, no toast (el toast se pierde si el doctor está enfocado en la captura).

### 13.4 Empty states ilustrados

Empty state principal (paciente sin TC) usa una ilustración SVG simple en línea (no foto) consistente con el estilo del resto de MediFlow: silueta de un diente con líneas de conducto en tono `var(--text-3)` opacidad 0.4.

---

## 14. Mock data para QA

Se incluyen 3 escenarios de seed en `prisma/seeds/endodontics-mock.ts` para QA y demos:

### 14.1 Mock 1: Roberto Salinas — TC primario completado

```ts
{
  patient: { id: 'mock-roberto', fullName: 'Roberto Salinas Jiménez', age: 42 },
  diagnosis: {
    toothFdi: 36,
    pulpalDiagnosis: 'PULPITIS_IRREVERSIBLE_SINTOMATICA',
    periapicalDiagnosis: 'PERIODONTITIS_APICAL_SINTOMATICA',
    diagnosedAt: '2026-04-15',
    justification: 'Dolor pulsátil EVA 8/10, frío exagerado y persistente.'
  },
  vitalityTests: [
    { type: 'FRIO', tooth: 36, controls: [35,37], result: 'EXAGERADO', intensity: 9 },
    { type: 'PERCUSION_VERTICAL', tooth: 36, result: 'POSITIVO' },
    { type: 'PALPACION_APICAL', tooth: 36, result: 'POSITIVO', intensity: 4 },
    { type: 'EPT', tooth: 36, controls: [35,37], result: 'POSITIVO', intensity: 2 }
  ],
  treatment: {
    treatmentType: 'TC_PRIMARIO',
    isMultiSession: true,
    sessionsCount: 2,
    rubberDamPlaced: true,
    accessType: 'CONVENCIONAL',
    instrumentationSystem: 'PROTAPER_GOLD',
    technique: 'ROTACION_CONTINUA',
    obturationTechnique: 'BIOCERAMIC_SINGLE_CONE',
    sealer: 'BC_SEALER',
    irrigants: [
      { substance: 'NaOCl', concentration: '5.25%', volumeMl: 10, order: 1 },
      { substance: 'EDTA', concentration: '17%', volumeMl: 3, order: 2 },
      { substance: 'NaOCl', concentration: '5.25%', volumeMl: 5, order: 3 }
    ],
    irrigationActivation: 'ULTRASONICA',
    totalIrrigationMinutes: 6,
    outcomeStatus: 'COMPLETADO',
    completedAt: '2026-04-23'
  },
  rootCanals: [
    { canonicalName: 'MV',  workingLengthMm: 19.5, masterIso: 25, taper: 0.06, quality: 'HOMOGENEA' },
    { canonicalName: 'ML',  workingLengthMm: 19.0, masterIso: 25, taper: 0.06, quality: 'HOMOGENEA' },
    { canonicalName: 'MB2', workingLengthMm: 18.0, masterIso: 25, taper: 0.06, quality: 'HOMOGENEA' },
    { canonicalName: 'D',   workingLengthMm: 20.0, masterIso: 30, taper: 0.06, quality: 'HOMOGENEA' }
  ],
  intracanalMedication: {
    substance: 'HIDROXIDO_CALCIO',
    placedAt: '2026-04-15',
    expectedRemovalAt: '2026-04-23',
    actualRemovalAt: '2026-04-23'
  },
  followUps: [
    { milestone: 'CONTROL_6M',  scheduledAt: '2026-10-23' },
    { milestone: 'CONTROL_12M', scheduledAt: '2027-04-23' },
    { milestone: 'CONTROL_24M', scheduledAt: '2028-04-23' }
  ]
}
```

### 14.2 Mock 2: Mariana Torres — Retratamiento

```ts
{
  patient: { id: 'mock-mariana', fullName: 'Mariana Torres Cuevas', age: 28 },
  diagnosis: {
    toothFdi: 21,
    pulpalDiagnosis: 'PREVIAMENTE_TRATADO',
    periapicalDiagnosis: 'PERIODONTITIS_APICAL_ASINTOMATICA',
    justification: 'Lesión periapical 6mm circunscrita, fístula vestibular intermitente.'
  },
  treatment: {
    treatmentType: 'RETRATAMIENTO',
    isMultiSession: true,
    sessionsCount: 2,
    instrumentationSystem: 'WAVEONE_GOLD',
    technique: 'RECIPROCACION',
    obturationTechnique: 'CONDENSACION_LATERAL',
    sealer: 'AH_PLUS',
    outcomeStatus: 'EN_CURSO'
  },
  rootCanals: [
    { canonicalName: 'CONDUCTO_UNICO', workingLengthMm: 22.5, masterIso: 40, taper: 0.06 }
  ],
  retreatmentInfo: {
    failureReason: 'SUBOBTURACION',
    originalTreatmentDate: '2022-03-15',
    fracturedInstrumentRecovered: false,
    difficulty: 'MEDIA'
  }
}
```

### 14.3 Mock 3: Carlos Mendoza — Control 12m post-TC

```ts
{
  patient: { id: 'mock-carlos', fullName: 'Carlos Mendoza Ríos', age: 55 },
  diagnosis: { toothFdi: 47, pulpalDiagnosis: 'NECROSIS_PULPAR',
               periapicalDiagnosis: 'PERIODONTITIS_APICAL_ASINTOMATICA' },
  treatment: { treatmentType: 'TC_PRIMARIO', completedAt: '2025-05-10',
               outcomeStatus: 'COMPLETADO' },
  rootCanals: [
    { canonicalName: 'MV',  workingLengthMm: 20.0, quality: 'HOMOGENEA' },
    { canonicalName: 'ML',  workingLengthMm: 20.5, quality: 'HOMOGENEA' },
    { canonicalName: 'D',   workingLengthMm: 21.0, quality: 'HOMOGENEA' }
  ],
  followUps: [
    { milestone: 'CONTROL_6M',  scheduledAt: '2025-11-10', performedAt: '2025-11-12',
      paiScore: 3, symptomsPresent: false, conclusion: 'EN_CURACION',
      recommendedAction: 'Control 12m programado.' },
    { milestone: 'CONTROL_12M', scheduledAt: '2026-05-10', performedAt: '2026-05-04',
      paiScore: 2, symptomsPresent: false, conclusion: 'EN_CURACION',
      recommendedAction: 'Control 24m para confirmar éxito.' },
    { milestone: 'CONTROL_24M', scheduledAt: '2027-05-10' }
  ]
}
```

---

## 15. Testing

### 15.1 Tests unitarios

`__tests__/endodontics/`:

- `canalAnatomy.test.ts`: `defaultCanalsForFdi(36)` retorna `['MV','ML','D']`; `categorizeTooth(16)` retorna `'molar_upper'`.
- `successRateCalculator.test.ts`: cálculos de % éxito con dataset mock.
- `soapPrefillEndo.test.ts`: composición de SOAP con diagnósticos vacíos vs. completos.
- `endoAppointmentDurations.test.ts`: keywords detectadas correctamente.
- `whatsappTemplatesEndo.test.ts`: templates renderizan con placeholders correctos.
- `endoConsent.test.ts`: el texto de consentimiento varía correctamente según `treatmentType` y categoría de diente.

### 15.2 Tests de integración (Playwright o Vitest + Testing Library)

- Wizard completo de TC: flujo end-to-end de los 4 pasos con autosave en localStorage.
- Drawer de diagnóstico: validación de campos y persistencia.
- Drawer de vitalidad: agregar 3 pruebas y guardar todas.
- Drawer de control de seguimiento: PAI 5 → conclusión FRACASO marca treatment como FALLIDO.
- Mapa canalicular: click en conducto abre drawer correcto; conductos cambian color según calidad.
- Permisos multi-tenant: doctor de clínica A no puede ver tratamientos de clínica B (RLS test).

### 15.3 Tests visuales (Chromatic / Playwright snapshots)

- Estado vacío del módulo.
- Vista con TC completado (mock Roberto).
- Vista con retratamiento (mock Mariana).
- Vista con control PAI ≥3 (alerta).
- Wizard paso 2 con 4 conductos.

### 15.4 Tests de compliance

- Soft delete: marcar `deletedAt` en lugar de hard delete.
- Audit log: cada server action genera entry con before/after.
- Conservación: query de tratamientos antiguos retorna registros incluso con `deletedAt` set.
- Consentimiento: tratamiento sin consentimiento firmado dispara warning en wizard paso 1 (no bloquea — el consentimiento puede firmarse después en consultorio físico).

### 15.5 Carga de datos / performance

- 1000 tratamientos en una clínica: lista paginada carga en < 500ms.
- Dashboard de tasa de éxito con 5 años de datos: query optimizada con índices.
- SVG canal map: render en < 50ms.

---

## 16. Roadmap MVP / v1.1 / v2.0

### 16.1 MVP v1.0 — alcance del SPEC actual (6 features MUST)

1. **Diagnóstico AAE estructurado** pulpar + periapical.
2. **Pruebas de vitalidad** documentadas.
3. **Tratamiento de conductos con registro por conducto** y mapa canalicular básico.
4. **Conductometría con radiografía vinculada al conducto** (PatientFile reuse).
5. **Plan de seguimiento automático 6m/12m/24m** con recordatorios WhatsApp.
6. **Mapa anatómico canalicular visual** del diente (8 SVGs + motor).

Adicionalmente en MVP:

- Wizard de TC de 4 pasos con autosave.
- Consentimiento informado endodóntico con firma canvas.
- 3 plantillas de receta endodóntica.
- Tab dentro de patient-detail (no página dedicada).
- Soft delete + audit log.
- Multi-tenant RLS.
- Mock data de 3 pacientes para QA.

### 16.2 v1.1 (Q+1) — SHOULD

- **PAI score** capturado manualmente en cada control con escala visual.
- **Retratamiento diferenciado** con motivo de fracaso explícito.
- **Cirugía apical** con su propio modelo y wizard reducido (2 pantallas).
- **Dashboard de tasa de éxito personal** del doctor (recharts).
- **Plantillas de receta endodóntica** ampliadas (cirugía, alergias).
- **Comparativo radiográfico lado a lado** de hasta 4 radiografías.
- **Sistema de instrumentación analytics** (tasa de éxito por sistema).
- **Lista de TC sin restauración definitiva** con alertas a 30/60/90 días.

### 16.3 v2.0 — NICE / futuro

- **Integración con localizadores apicales vía Bluetooth** (lectura automática de mm). Investigar si Web Bluetooth API soporta los modelos comunes (Root ZX II, Propex IQ).
- **Visor DICOM básico** de CBCT integrado (Cornerstone.js) — solo lectura, marcado textual de ROI.
- **IA para PAI score automático** en radiografías de control (extender `XrayAnalysis` existente).
- **Alineación automática** de radiografías pre/post para comparación pixel-a-pixel.
- **Terapia pulpar regenerativa** con protocolo específico (pacientes jóvenes, ápice abierto).
- **Ahmed 2017 notación** completa con generador de strings sistemáticos.
- **Export al referente vía email** con PDF firmado.
- **Importación de tratamientos previos** desde formatos comunes (CSV de Dentrix/OpenDental).

---

## 17. Casos de uso reales (del brief)

Estos 3 casos están reflejados en el mock data de QA (sección 14) y son la prueba de manejo del módulo en escenarios reales del consultorio mexicano.

### 17.1 Caso 1: Roberto Salinas — TC primario en 36

- 42 años. Pulpitis irreversible sintomática + periodontitis apical sintomática.
- 4 conductos identificados (MB2 con microscopio).
- TC en 2 sesiones: medicación intraconducto Ca(OH)₂ entre sesiones.
- ProTaper Gold + BioCeramic single cone.
- Restauración temporal con resina + indicación de corona definitiva en <30 días.
- Plan de seguimiento: control 6m, 12m, 24m programados automáticamente.

### 17.2 Caso 2: Mariana Torres — Retratamiento en 21

- 28 años. Antecedente de TC hace 4 años con subobturación de 3 mm.
- Lesión periapical circunscrita ~6 mm, fístula vestibular.
- CBCT confirma lesión, descarta fractura vertical.
- Retratamiento ortógrado en 2 sesiones con WaveOne Gold.
- Pronóstico bueno: lesión circunscrita, sin fractura, motivo de fracaso identificado y corregido.
- Plan de seguimiento estricto a 12m y 24m por ser retratamiento.

### 17.3 Caso 3: Carlos Mendoza — Control 12m en 47

- 55 años. TC primario hace 12m por necrosis + periodontitis apical asintomática.
- Asintomático en el control.
- Radiografía: lesión previa de 4mm ahora ~1.5mm, regeneración ósea.
- PAI score 2: en curación.
- Acción: control adicional a 24m para confirmar éxito completo.
- WhatsApp automático al paciente con confirmación positiva y siguiente cita.

---

## 18. Checklist de implementación

Lista en orden de dependencia para que el equipo de implementación (Bot Git) pueda trabajar en paralelo en algunas etapas.

### Fase 1: Schema y migración
- [ ] Agregar 8 modelos a `prisma/schema.prisma`.
- [ ] Agregar enums (16 enums nuevos).
- [ ] Agregar relaciones inversas en `Patient`, `User`, `PatientFile`, `Clinic`.
- [ ] Generar migración: `npx prisma migrate dev --name add_endodontics_module`.
- [ ] Aplicar SQL adicional (índices GIN, constraints CHECK, RLS policies).
- [ ] Generar Prisma client: `npx prisma generate`.

### Fase 2: Tipos, validaciones, helpers
- [ ] `lib/types/endodontics.ts` (tipos derivados de Prisma + tipos de UI).
- [ ] `lib/validation/endodontics.ts` (zod schemas).
- [ ] `lib/helpers/canalAnatomy.ts` (`defaultCanalsForFdi`, `categorizeTooth`, `QUALITY_COLORS`, `selectCanalSvg`).
- [ ] `lib/helpers/soapPrefillEndo.ts`.
- [ ] `lib/helpers/whatsappTemplatesEndo.ts`.
- [ ] `lib/helpers/prescriptionTemplatesEndo.ts`.
- [ ] `lib/helpers/successRateCalculator.ts`.
- [ ] `lib/legal/endoConsent.ts`.

### Fase 3: Server actions
- [ ] `createDiagnosis`, `updateDiagnosis`.
- [ ] `recordVitalityTest`.
- [ ] `startTreatment`, `updateTreatmentStep`, `completeTreatment`.
- [ ] `upsertRootCanal`.
- [ ] `recordIntracanalMedication`.
- [ ] `scheduleFollowUp`, `completeFollowUp`.
- [ ] `createRetreatmentInfo`, `createApicalSurgery`.
- [ ] `exportTreatmentReportPdf`, `exportLegalReportPdf`.

### Fase 4: SVGs anatómicas
- [ ] `incisor.svg`.
- [ ] `canine.svg`.
- [ ] `premolar-upper-1canal.svg`.
- [ ] `premolar-upper-2canal.svg`.
- [ ] `premolar-lower.svg`.
- [ ] `molar-upper-mb2.svg`.
- [ ] `molar-lower.svg`.
- [ ] `molar-lower-cshape.svg`.

### Fase 5: Componentes UI
- [ ] `EndodonticsTab.tsx` (entrada).
- [ ] `ToothMiniOdontogram.tsx` (panel izquierdo).
- [ ] `DiagnosisCard.tsx` (sección 1).
- [ ] `CanalMap.tsx` (sección 2 — motor SVG).
- [ ] `ToothTimeline.tsx` (sección 3).
- [ ] `RootCanalDrawer.tsx`.
- [ ] `DiagnosisDrawer.tsx`.
- [ ] `VitalityDrawer.tsx`.
- [ ] `FollowUpDrawer.tsx`.
- [ ] `TreatmentWizard/` (4 steps).
- [ ] `ConsentModal.tsx` (reuso `SignatureCanvas`).
- [ ] `RetreatmentBadge.tsx`, `ApicalSurgeryDrawer.tsx`.

### Fase 6: Reportes y dashboards
- [ ] `SuccessRateChart.tsx`.
- [ ] `PendingFollowUpsList.tsx`.
- [ ] `PendingRestorationList.tsx`.
- [ ] `RadiographComparisonView.tsx`.
- [ ] PDFs `treatmentReport.tsx` y `legalEndoReport.tsx`.

### Fase 7: Integraciones
- [ ] Modificar `<Odontogram />` general para mostrar icono endodóntico y navegación al tab.
- [ ] Agregar item "Endodoncia" al sidebar dentro del grupo "Especialidades".
- [ ] Pre-fill SOAP cuando se abre nota de cita endodóntica.
- [ ] Sugerencia de duración de cita endodóntica.
- [ ] Plantillas de receta NOM-024 (3 nuevas).
- [ ] Encolar recordatorios WhatsApp.
- [ ] Tab "Auditoría" filtrable por entidad endodóntica.

### Fase 8: Mock data y QA
- [ ] Seed de 3 pacientes mock (Roberto, Mariana, Carlos).
- [ ] Tests unitarios.
- [ ] Tests de integración del wizard.
- [ ] Tests de RLS multi-tenant.
- [ ] Snapshot tests visuales.

### Fase 9: Configuración del doctor
- [ ] Página `/dashboard/clinic/configuracion/especialidades/endodoncia`.
- [ ] Toggle "Vertucci 1984 vs Ahmed 2017".
- [ ] Defaults editables (sistema preferido, técnica preferida, sealer preferido).

### Fase 10: Lanzamiento
- [ ] Smoke test completo en staging con los 3 pacientes mock.
- [ ] Verificar PDFs (informe referente y legal).
- [ ] Verificar audit log con tratamiento completo.
- [ ] Verificar agenda automática de controles 6m/12m/24m.
- [ ] Verificar recordatorios WhatsApp encolados correctamente.
- [ ] Documentar en `/docs/specialties/endodoncia.md` para usuarios finales.
- [ ] Anunciar en changelog interno.

---

## 19. Prompt corto para Bot Git

```
═══════════════════════════════════════════════════════════════
→ BOT GIT 2 — Implementación módulo Endodoncia (MediFlow 2/5)
═══════════════════════════════════════════════════════════════

Implementa el módulo de Endodoncia siguiendo el SPEC en
`docs/marketplace/research/endodoncia/SPEC.md` línea por línea.

Pediatría (1/5) ya está implementada y polished. Este módulo
reutiliza exactamente sus tokens, header, sidebar, signature canvas,
patrón de server actions, pre-fill SOAP y recordatorios WhatsApp.

ORDEN DE TRABAJO (sigue el checklist sección 18):

1. Schema Prisma + migración (sección 4 del SPEC).
   - 8 modelos nuevos: EndodonticDiagnosis, VitalityTest,
     EndodonticTreatment, RootCanal, IntracanalMedication,
     EndodonticFollowUp, EndodonticRetreatmentInfo, ApicalSurgery.
   - 16 enums.
   - SQL adicional: índice GIN en irrigants, CHECK constraints,
     RLS policies multi-tenant.

2. Tipos + validaciones + helpers (sección 6.1, 7.6, 10).

3. Server actions (sección 5, 14 actions). Cada una con:
   - 'use server'
   - Validación zod
   - getActiveClinicId + getCurrentUser
   - Audit log con before/after
   - revalidatePath
   - Discriminated union de retorno.

4. SVGs anatómicas en public/specialties/endodontics/anatomy/
   (sección 7). 8 archivos. Estilo técnico esquemático libro de
   texto. <g id="canal-{name}"> por conducto.

5. Componentes UI (sección 6). Empieza por:
   - EndodonticsTab → ToothMiniOdontogram → ToothCenterView
   - DiagnosisCard, CanalMap, ToothTimeline
   - Drawers (Diagnosis, Vitality, FollowUp, RootCanal)
   - TreatmentWizard de 4 pasos
   - ConsentModal (reuso SignatureCanvas de pediatría).

6. Mock data en prisma/seeds/endodontics-mock.ts con los 3
   pacientes (Roberto, Mariana, Carlos — sección 14).

7. Integraciones (sección 10).

8. Tests (sección 15).

REGLAS NO NEGOCIABLES:
- Español neutro mexicano. NUNCA argentino.
- Multi-tenant siempre con clinicId activo.
- Audit log obligatorio en TODA mutación clínica.
- Soft delete (deletedAt), nunca hard delete.
- Reutiliza PatientFile para radiografías (NO crear modelo Radiography).
- Vertucci default, Ahmed 2017 toggle en config.
- Tokens dark mode existentes (--text-1, --bg-elev, etc.).
- Sin emojis en UI clínica.

ENTREGABLE FINAL:
- PR único con commits por fase del checklist.
- Demo funcional en staging con los 3 pacientes mock cargados.
- Wizard de TC funcional end-to-end.
- Mapa canalicular con conductos coloreados según calidad.
- Recordatorios WhatsApp encolados al completar TC.
- Controles 6m/12m/24m agendados automáticamente.

Pegunta al humano antes de:
- Cambiar cualquier decisión bloqueada de la sección 1.
- Crear un modelo de datos no listado en el SPEC.
- Modificar un componente compartido fuera de endodoncia
  (ej. Odontogram general — solo agregar feature, no refactor).
```

---

**Fin del SPEC.** Total: ~2400 líneas. Listo para implementación por Bot Git 2.
