# MediFlow · Ortodoncia — SPEC técnico consolidado

> Fuente de verdad para implementación. Cubre data model, mapping de 160 elementos interactivos, 48 server actions, validaciones zod, integración cross-módulo, lógica disabled, permisos por rol, notificaciones y atajos. Al final, lista completa de artifacts entregados en el proyecto.

---

## 1.1 Data model Prisma — multi-tenant

### Tabla "qué cambia" vs schema actual

| Cambio | Detalle |
|---|---|
| **+ 14 modelos nuevos** | OrthoCase, OrthoDiagnosis, TreatmentPlan, ArchPlanned, PhotoSet, Photo, TreatmentCard, FinancialPlan, Installment, RetentionPlan, OrthoDocument, LabOrder, CommunicationLog, OrthoTemplate, ApplianceType, NoteTemplate, IndicationTemplate |
| **+ 11 enums** | CaseStatus, PhaseEnum, AngleClass, OpenBite, CrossBite, FacialProfile, SkeletalPattern, ArchMaterial, ArchStatus, PhotoKind, VisitType, InstStatus, RetainerKind, DocumentKind, LabOrderStatus |
| **0 modificaciones destructivas** | No se altera Patient, User, Clinic, Appointment, Invoice — solo se agregan FKs opcionales |
| **+ FK a Patient** | `Patient.orthoCase OrthoCase?` |
| **+ FK a Appointment** | `Appointment.treatmentCardId String?` (link bidi) |
| **+ FK a Invoice** | `Invoice.installmentId String?` |
| **+ FK a Xray** | `Xray.photoId String?` (Rx subida desde orto) |

### Schema Prisma — completo

```prisma
// ════════ ENUMS ════════
enum CaseStatus     { DRAFT EVAL ACCEPTED ACTIVE PAUSED DEBONDING RETENTION COMPLETED }
enum PhaseEnum      { ALIGNMENT LEVELING SPACE_CLOSE DETAIL FINISHING RETENTION }
enum AngleClass     { I II_DIV1 II_DIV2 III COMBO }
enum OpenBite       { NONE ANTERIOR POSTERIOR BOTH }
enum CrossBite      { NONE ANTERIOR LATERAL_R LATERAL_L POSTERIOR_R POSTERIOR_L BILATERAL }
enum FacialProfile  { CONCAVE STRAIGHT CONVEX }
enum SkeletalPattern{ BRACHY MESO DOLICHO }
enum ArchMaterial   { NITI SS TMA BETA_TI ESTHETIC OTHER }
enum ArchStatus     { FUTURE CURRENT PAST SKIPPED }
enum PhotoKind      { EXTRA_FRONTAL_REST EXTRA_FRONTAL_SMILE EXTRA_LAT34 EXTRA_PROFILE_R EXTRA_PROFILE_L
  INTRA_FRONT INTRA_LAT_R INTRA_LAT_L INTRA_OCCL_UP INTRA_OCCL_LO INTRA_OVERJET
  RX_PANO RX_CEPH RX_PA RX_CBCT STL_UP STL_LO STL_BITE PDF OTHER }
enum VisitType      { INSTALLATION CONTROL EMERGENCY DEBONDING RETAINER_FIT FOLLOWUP }
enum InstStatus     { FUTURE PENDING PAID OVERDUE WAIVED }
enum RetainerKind   { NONE HAWLEY ESSIX FIXED_3_3 FIXED_EXTENDED CLEAR_NIGHT }
enum DocumentKind   { CONSENT REFERRAL_LETTER LAB_ORDER OTHER }
enum LabOrderStatus { DRAFT SENT RECEIVED CANCELLED }

// ════════ CASE ════════
model OrthoCase {
  id              String   @id @default(cuid())
  clinicId        String
  patientId       String   @unique
  caseCode        String
  status          CaseStatus @default(DRAFT)
  currentPhase    PhaseEnum?
  primaryDoctorId String
  startedAt       DateTime?
  estimatedEnd    DateTime?
  debondedAt      DateTime?
  completedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  clinic          Clinic    @relation(fields: [clinicId], references: [id])
  patient         Patient   @relation(fields: [patientId], references: [id])
  primaryDoctor   User      @relation(fields: [primaryDoctorId], references: [id])
  diagnosis       OrthoDiagnosis?
  plan            TreatmentPlan?
  photoSets       PhotoSet[]
  treatmentCards  TreatmentCard[]
  financialPlan   FinancialPlan?
  retentionPlan   RetentionPlan?
  documents       OrthoDocument[]
  labOrders       LabOrder[]
  comms           CommunicationLog[]

  @@unique([clinicId, caseCode])
  @@index([clinicId, status])
  @@index([clinicId, primaryDoctorId])
}

// ════════ DIAGNOSIS ════════
model OrthoDiagnosis {
  id               String   @id @default(cuid())
  caseId           String   @unique
  angleClass       AngleClass
  subCaninoR       AngleClass?
  subCaninoL       AngleClass?
  subMolarR        AngleClass?
  subMolarL        AngleClass?
  overjetMm        Float?
  overbiteMm       Float?
  openBite         OpenBite  @default(NONE)
  crossBite        CrossBite @default(NONE)
  crowdingMaxMm    Float?
  crowdingMandMm   Float?
  diastemas        Json
  midlineDeviation Float?
  facialProfile    FacialProfile
  skeletalPattern  SkeletalPattern
  skeletalIssues   String[]
  tmjFindings      Json
  habits           String[]
  narrative        String   @db.Text
  updatedAt        DateTime @updatedAt
  updatedBy        String

  case             OrthoCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
}

// ════════ TREATMENT PLAN ════════
model TreatmentPlan {
  id              String   @id @default(cuid())
  caseId          String   @unique
  appliances      String[]
  extractions     Int[]
  elastics        Json
  expanders       Json
  tads            Json
  objectives      String[]
  notes           String   @db.Text
  templateId      String?
  iprPlan         Json
  acceptedAt      DateTime?
  acceptedBy      String?
  signedDocUrl    String?

  case            OrthoCase    @relation(fields: [caseId], references: [id], onDelete: Cascade)
  archesPlanned   ArchPlanned[]
  template        OrthoTemplate? @relation(fields: [templateId], references: [id])

  @@index([templateId])
}

model ArchPlanned {
  id          String   @id @default(cuid())
  planId      String
  order       Int
  phase       PhaseEnum
  material    ArchMaterial
  gauge       String
  durationW   Int
  startDate   DateTime?
  endDate     DateTime?
  status      ArchStatus @default(FUTURE)
  notes       String?

  plan        TreatmentPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([planId, order])
}

// ════════ PHOTOS ════════
model PhotoSet {
  id         String   @id @default(cuid())
  caseId     String
  stageCode  String
  capturedAt DateTime
  notes      String?
  createdAt  DateTime @default(now())
  createdBy  String

  case       OrthoCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  photos     Photo[]

  @@unique([caseId, stageCode])
  @@index([caseId, capturedAt])
}

model Photo {
  id           String    @id @default(cuid())
  photoSetId   String
  kind         PhotoKind
  url          String
  thumbUrl     String?
  isFavorite   Boolean   @default(false)
  annotations  Json
  measurements Json
  teethRef     Int[]
  width        Int
  height       Int
  exifJson     Json?
  xrayId       String?
  createdAt    DateTime  @default(now())

  photoSet     PhotoSet  @relation(fields: [photoSetId], references: [id], onDelete: Cascade)
  xray         Xray?     @relation(fields: [xrayId], references: [id])

  @@index([photoSetId])
  @@index([xrayId])
}

// ════════ TREATMENT CARD ════════
model TreatmentCard {
  id              String   @id @default(cuid())
  caseId          String
  appointmentId   String?
  visitDate       DateTime
  visitType       VisitType
  templateUsed    String?
  archPlacedId    String?
  archPlacedJson  Json?
  ligColor        String?
  ligKind         String?
  activations     String[]
  elasticUse      Json
  bracketsLost    Int[]
  iprDoneDelta    Json
  soap            Json
  homeInstr       String   @db.Text
  nextSuggestedAt DateTime?
  linkedPhotoSet  String?
  createdAt       DateTime @default(now())
  createdBy       String
  signedOffAt     DateTime?

  case            OrthoCase    @relation(fields: [caseId], references: [id], onDelete: Cascade)
  appointment     Appointment? @relation(fields: [appointmentId], references: [id])

  @@index([caseId, visitDate])
  @@index([appointmentId])
}

// ════════ FINANCIAL ════════
model FinancialPlan {
  id               String   @id @default(cuid())
  caseId           String   @unique
  total            Decimal  @db.Decimal(10,2)
  downPayment      Decimal  @db.Decimal(10,2)
  months           Int
  monthly          Decimal  @db.Decimal(10,2)
  startDate        DateTime
  scenarios        Json
  activeScenarioId String?
  signAtHomeUrl    String?
  signedByPatient  Boolean  @default(false)
  signedAt         DateTime?

  case             OrthoCase    @relation(fields: [caseId], references: [id], onDelete: Cascade)
  installments     Installment[]
}

model Installment {
  id           String     @id @default(cuid())
  financialId  String
  number       Int
  amount       Decimal    @db.Decimal(10,2)
  dueDate      DateTime
  paidAt       DateTime?
  invoiceId    String?
  status       InstStatus @default(FUTURE)

  financial    FinancialPlan @relation(fields: [financialId], references: [id], onDelete: Cascade)
  invoice      Invoice?      @relation(fields: [invoiceId], references: [id])

  @@unique([financialId, number])
  @@index([dueDate, status])
}

// ════════ RETENTION ════════
model RetentionPlan {
  id              String   @id @default(cuid())
  caseId          String   @unique
  retUpper        RetainerKind @default(NONE)
  retLower        RetainerKind @default(NONE)
  fixedGauge      String?
  regimen         String   @db.Text
  checkpoints     DateTime[]
  checkpointsDone Json
  beforeAfterPdf  String?
  referralCode    String   @unique
  referralReward  Json
  referralsCount  Int      @default(0)

  case            OrthoCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
}

// ════════ DOCS & LAB ════════
model OrthoDocument {
  id          String       @id @default(cuid())
  caseId      String
  kind        DocumentKind
  title       String
  url         String
  signedAt    DateTime?
  signedToken String?
  createdAt   DateTime     @default(now())
  createdBy   String

  case        OrthoCase    @relation(fields: [caseId], references: [id], onDelete: Cascade)
}

model LabOrder {
  id           String         @id @default(cuid())
  caseId       String
  itemCode     String
  itemLabel    String
  labPartner   String
  trackingCode String?
  sentAt       DateTime?
  receivedAt   DateTime?
  status       LabOrderStatus @default(DRAFT)
  notes        String?

  case         OrthoCase      @relation(fields: [caseId], references: [id], onDelete: Cascade)

  @@index([caseId, status])
}

// ════════ COMUNICACIÓN ════════
model CommunicationLog {
  id          String   @id @default(cuid())
  caseId      String
  channel     String
  direction   String
  body        String   @db.Text
  templateId  String?
  sentAt      DateTime @default(now())
  externalId  String?

  case        OrthoCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  @@index([caseId, sentAt])
}

// ════════ CATÁLOGOS EXTENSIBLES ════════
model ApplianceType {
  id        String  @id @default(cuid())
  clinicId  String
  code      String
  label     String
  category  String
  builtin   Boolean @default(false)
  createdBy String?

  @@unique([clinicId, code])
}

model OrthoTemplate {
  id            String   @id @default(cuid())
  clinicId      String
  name          String
  description   String?
  ownerUserId   String?
  payload       Json
  usageCount    Int      @default(0)
  createdAt     DateTime @default(now())

  plans         TreatmentPlan[]
  @@unique([clinicId, name])
}

model NoteTemplate {
  id        String @id @default(cuid())
  clinicId  String
  scope     String
  name      String
  body      String @db.Text
  builtin   Boolean @default(false)
  @@unique([clinicId, scope, name])
}

model IndicationTemplate {
  id        String @id @default(cuid())
  clinicId  String
  label     String
  body      String @db.Text
  category  String
}
```

**Constraints únicos:** `(clinicId, caseCode)`, `(planId, order)`, `(caseId, stageCode)`, `(financialId, number)`, `referralCode` global, `(clinicId, name)` plantillas.
**Cascadas:** borrar caso → cae todo dependiente.
**Soft-delete:** no se usa — casos pasan a `COMPLETED` y se archivan.

---

## 1.2 Mapping de 160 elementos interactivos

### A · Header del paciente (shell compartido)

| # | Elemento | Texto · Icono | Variante UI | Acción · Server action | Drawer |
|---|---|---|---|---|---|
| 1 | Avatar paciente | — · — | Avatar 64px | click → focus; doble → /patients/[id]/edit | — |
| 2 | Btn Editar | Editar · Pencil | btn-new--ghost | updatePatient() | DrawerEditPatient |
| 3 | Btn ⋯ Menú | ⋯ · MoreHorizontal | btn-icon-ghost | open dropdown | — |
| 4 | Btn Nueva nota | + Nota · NotebookPen | btn-new--ghost | createPatientNote() | DrawerNewNote |
| 5 | Btn Portal | Portal · Globe | btn-new--ghost | generatePortalLink() | — |
| 6 | Btn Agendar cita | + Agendar · CalendarPlus | btn-new--primary | createAppointment() | DrawerScheduleAppointment |
| 7 | KPI Estado | Estado · Activity | kpi | read-only | — |
| 8 | KPI Tiempo | Mes N/M · Clock | kpi | read-only | — |
| 9 | KPI Compliance | % ▲▼ · TrendingUp | kpi | read-only | — |
| 10 | KPI Próxima cita | fecha · CalendarClock | kpi | click → /appointments/[id] | — |
| 11 | Tab Plan/Historia/Ortodoncia | 7 tabs | tabs-new | navigate | — |

### B · Sub-sidebar Ortodoncia

| # | Item | Icono lucide | Acción | Badge |
|---|---|---|---|---|
| 12 | Resumen | LayoutDashboard | /orto/resumen | — |
| 13 | Expediente clínico | ClipboardList | /orto/expediente | {Dx ✓/vacío} |
| 14 | Fotos & Rx | Camera | /orto/fotos | {Tn count} |
| 15 | Plan de tratamiento | FileBarChart2 | /orto/plan | {phase} |
| 16 | Citas & evolución | CalendarHeart | /orto/citas | {N cards} |
| 17 | Plan financiero | Wallet | /orto/financiero | {paid/total} |
| 18 | Retención | ShieldCheck | /orto/retencion | — |
| 19 | Documentos | Folder | /orto/documentos | {N docs} |

### C · Resumen del caso

| # | Elemento | Acción · Server action | Args | Retorna | Drawer |
|---|---|---|---|---|---|
| 20 | Hero KPI Fase | read | — | — | — |
| 21 | Hero KPI Arco actual | read | — | — | — |
| 22 | Hero KPI Compliance | computeCompliance() | caseId | {value, delta} | — |
| 23 | Hero KPI Mensualidad | read | — | — | — |
| 24 | Atajo "+ Treatment Card" | createTreatmentCard() | caseId, draft | TreatmentCard | DrawerNewTreatmentCard |
| 25 | Atajo "Subir foto-set" | — | — | — | DrawerUploadPhotos |
| 26 | Atajo "Avanzar arco" | advanceCurrentArch() | caseId | ArchPlanned | — |
| 27 | Atajo "Cobrar mensualidad" | collectInstallment() | installmentId | Installment+CFDI | DrawerCollectInstallment |
| 28 | Stepper de fases | click → /orto/plan?phase | — | — | — |
| 29 | Card "Diagnóstico — resumen" | → /orto/expediente | — | — | — |
| 30 | Card "Última cita #N" | → /orto/citas/[id] | — | — | — |

### D · Expediente clínico (diagnóstico)

| # | Elemento | Acción · SA | Validación | Drawer |
|---|---|---|---|---|
| 31 | Btn Editar diagnóstico | open drawer | — | DrawerEditDiagnosis |
| 32 | Btn Expandir todo | setExpandedAll(true) | — | — |
| 33 | Card colapsable Angle | toggleSection() | — | — |
| 34 | Select Angle general | updateDiagnosis({angleClass}) | enum required | — |
| 35 | Select Subcanino R/L | updateDiagnosis() | enum optional | — |
| 36 | Select Submolar R/L | updateDiagnosis() | enum optional | — |
| 37 | Input Sobremordida mm | updateDiagnosis({overbiteMm}) | 0–15 float | — |
| 38 | Input Resalte mm | updateDiagnosis({overjetMm}) | 0–20 float | — |
| 39 | Select Mordida abierta | updateDiagnosis({openBite}) | enum | — |
| 40 | Select Cruzada | updateDiagnosis({crossBite}) | enum | — |
| 41 | Input Apiñ. maxilar | updateDiagnosis() | 0–15 float | — |
| 42 | Input Apiñ. mandibular | updateDiagnosis() | 0–15 float | — |
| 43 | ToothPicker diastemas | setDiastemas() | FDI valid | — |
| 44 | Input línea media dev. | updateDiagnosis() | -10..10 float | — |
| 45 | Select Perfil facial | updateDiagnosis() | enum | — |
| 46 | Select Patrón skeletal | updateDiagnosis() | enum | — |
| 47 | Chips skeletal issues | updateDiagnosis() | string[] | — |
| 48 | Bloque ATM (4 checks + mm) | updateDiagnosis({tmjFindings}) | Json schema | — |
| 49 | Chips hábitos | updateDiagnosis({habits}) | string[] max 10 | — |
| 50 | Chip "+ Agregar hábito" | upsertHabitCatalog() | min 3 chars | — |
| 51 | Editor narrativa | updateDiagnosis({narrative}) | max 5000 | — |

### E · Fotos & Rx

| # | Elemento | Acción · SA | Args | Drawer/Modal |
|---|---|---|---|---|
| 52 | Tabs T0/T1/T2/… | switchPhotoSet() | stageCode | — |
| 53 | Btn "+ Nueva etapa" | createPhotoSet() | caseId, stageCode | DrawerNewStage |
| 54 | Btn Comparar | open modal | — | ModalCompare |
| 55 | Btn Móvil | open QR | — | ModalMobileUpload |
| 56 | Btn Subir D&D | open uploader | — | DrawerUploadPhotos |
| 57 | Slot foto vacío | — | — | DrawerUploadPhotos(kind) |
| 58 | Slot foto poblado click | open lightbox | photoId | LightboxPhoto |
| 59 | Btn ⤢ Ampliar | open lightbox | — | LightboxPhoto |
| 60 | Btn ⇅ Comparar | open compare | — | ModalCompare |
| 61 | Btn ✎ Anotar | open annotator | — | ModalAnnotate |
| 62 | Btn ✱ Medir | open ruler | — | ModalAnnotate(measure) |
| 63 | Btn ★ Favorita | togglePhotoFavorite() | photoId | — |
| 64 | Btn ⌫ Eliminar | deletePhoto() | photoId | ConfirmDialog |
| 65 | Tabs compare (side/slider/timeline) | setCompareMode() | — | — |
| 66 | Selector etapa A/B | setCompare(a,b) | stageCode | — |
| 67 | Slider deslizable | setSliderPct() | 0–100 | — |
| 68 | Anotación flecha | addAnnotation() | {arrow, pts} | — |
| 69 | Anotación círculo | addAnnotation() | {circle, cx,cy,r} | — |
| 70 | Anotación texto | addAnnotation() | {text, x,y,text} | — |
| 71 | Medición regla | addMeasurement() | {ruler, pts} | — |
| 72 | Medición ángulo | addMeasurement() | {angle, pts:3} | — |
| 73 | Drop-area D&D | uploadPhotos() | FormData[] | — |
| 74 | Btn "Tomar foto" móvil | capture() | kind | — |
| 75 | Guía de encuadre móvil | read | kind | — |

### F · Plan de tratamiento

| # | Elemento | Acción · SA | Args | Drawer/Modal |
|---|---|---|---|---|
| 76 | Btn "Cargar plantilla" | — | — | ModalLoadTemplate |
| 77 | Btn "Guardar como plantilla" | — | — | ModalSaveTemplate |
| 78 | Btn Editar plan | — | — | DrawerEditPlan |
| 79 | Sub-tab Aparatología | — | — | — |
| 80 | Multi-select aparatología | updateTreatmentPlan() | String[] | — |
| 81 | Btn "+ Tipo nuevo" | — | — | DrawerNewApplianceType |
| 82 | Sub-tab Decisiones | — | — | — |
| 83 | Switch Extracciones sí/no | updateTreatmentPlan() | boolean | — |
| 84 | ToothPicker extracciones | updateTreatmentPlan() | Int[] | — |
| 85 | Select Elásticos tipo | updateTreatmentPlan() | enum | — |
| 86 | Input horas prescritas | updateTreatmentPlan() | regex | — |
| 87 | Select Expansor | updateTreatmentPlan() | enum | — |
| 88 | ToothPicker TADs | updateTreatmentPlan() | Json | DrawerNewTAD |
| 89 | Sub-tab Arcos | — | — | — |
| 90 | Tabla arcos editable | updateArchPlanned() | archId, patch | — |
| 91 | Btn "+ Agregar arco" | addArchStep() | planId, draft | DrawerNewWireStep |
| 92 | Drag-reorder arcos | reorderArches() | Int[] | — |
| 93 | Btn delete arco | deleteArchStep() | archId | Confirm |
| 94 | Sub-tab IPR | — | — | — |
| 95 | IPRSlot click | — | — | PopoverIPR |
| 96 | Input mm planeada | updateIprPlan() | 0..1 step 0.1 | — |
| 97 | Sub-tab Objetivos | — | — | — |
| 98 | Lista editable objetivos | updateTreatmentPlan() | string[] | — |
| 99 | Editor notas plan | updateTreatmentPlan() | max 5000 | — |
| 100 | Modal cargar plantilla | loadTemplate() | templateId | — |
| 101 | Modal guardar plantilla | saveAsTemplate() | {name, payload} | — |

### G · Citas & evolución

| # | Elemento | Acción · SA | Args | Drawer/Modal |
|---|---|---|---|---|
| 102 | Btn "+ Treatment Card" | — | — | DrawerNewTreatmentCard |
| 103 | Filtros chip tipo | setFilter() | VisitType[] | — |
| 104 | Toggle timeline/calendar | setView() | — | — |
| 105 | Card timeline expandir | toggle | — | — |
| 106 | Btn Editar card | — | — | DrawerNewTreatmentCard(edit) |
| 107 | Btn Imprimir indicaciones | printIndications() | cardId | — |
| 108 | Drawer: Select plantilla rápida | applyTemplate() | templateId | — |
| 109 | Drawer: SOAP S | updateCard() | max 2000 | — |
| 110 | Drawer: SOAP O | updateCard() | max 2000 | — |
| 111 | Drawer: SOAP A | updateCard() | max 2000 | — |
| 112 | Drawer: SOAP P | updateCard() | max 2000 | — |
| 113 | Drawer: arco auto-completado | readCurrentArch() | caseId | — |
| 114 | Drawer: Color ligas | updateCard() | string | — |
| 115 | Drawer: Chips activaciones | updateCard() | string[] | — |
| 116 | Drawer: Compliance reportado | updateCard() | Int 0-100 | — |
| 117 | Drawer: ToothPicker brackets caídos | updateCard() | Int[] | — |
| 118 | Drawer: Indicaciones casa | applyIndication()+updateCard() | templateId | — |
| 119 | Drawer: Próxima cita sugerida | updateCard() | DateTime | — |
| 120 | Drawer: Link foto-set | linkPhotoSet() | photoSetId | DrawerUploadPhotos |
| 121 | Drawer: Btn Guardar | signOffTreatmentCard() | cardId | — |

### H · Plan financiero

| # | Elemento | Acción · SA | Args | Drawer/Modal |
|---|---|---|---|---|
| 122 | Btn Editar plan | — | — | DrawerEditFinancialPlan |
| 123 | Btn Presentar cotización G5 | — | — | ModalQuoteScenarios |
| 124 | Btn Sign@Home G6 | sendSignAtHome() | scenarioId | ModalSignAtHome |
| 125 | Btn Cobrar siguiente | collectInstallment() | installmentId | DrawerCollectInstallment |
| 126 | Card escenario A/B/C | setActiveScenario() | scenarioId | — |
| 127 | Input total | updateFinancialPlan() | Decimal > 0 | — |
| 128 | Input enganche | updateFinancialPlan() | Decimal >= 0 | — |
| 129 | Select meses | updateFinancialPlan() | Int 1..120 | — |
| 130 | Input mensual | updateFinancialPlan() | Decimal | — |
| 131 | Chip pagado | showCFDI() | installmentId | ModalCFDIDetail |
| 132 | Chip pendiente | collectInstallment() | installmentId | DrawerCollectInstallment |
| 133 | Chip futuro | preview | — | — |
| 134 | Modal G5: editar escenario | updateScenario() | scenarioId, patch | — |
| 135 | Modal G5: Btn enviar WhatsApp | sendSignAtHome() | scenarioId | — |
| 136 | Modal G6: preview mensaje | render | — | — |

### I · Retención & J · Documentos

| # | Elemento | Acción · SA | Args | Drawer/Modal |
|---|---|---|---|---|
| 137 | Select retenedor sup | updateRetentionPlan() | enum | DrawerConfigRetention |
| 138 | Select retenedor inf | updateRetentionPlan() | enum | — |
| 139 | Input calibre fijo | updateRetentionPlan() | regex | — |
| 140 | Editor régimen | updateRetentionPlan() | max 2000 | — |
| 141 | Chips checkpoints | scheduleRetentionCheckpoint() | DateTime | — |
| 142 | Btn "+ Agregar control" | scheduleRetentionCheckpoint() | DateTime | — |
| 143 | Btn "Generar PDF antes/después" | generateBeforeAfterPdf() | caseId | — |
| 144 | Input código referidos | updateRetentionPlan() | regex `[A-Z0-9]{4,12}` | — |
| 145 | Select premio referido | updateRetentionPlan() | Json schema | — |
| 146 | Btn Generar share-card | generateReferralCard() | caseId | — |
| 147 | Tabs Docs (4 sub) | — | — | — |
| 148 | Btn "Generar consentimiento" | generateConsent() | templateId | DrawerGenerateConsent |
| 149 | Btn "+ Carta referencia" | — | — | DrawerNewReferralLetter |
| 150 | Btn "+ Nueva lab order" | — | — | DrawerNewLabOrder |
| 151 | Tabla lab orders | updateLabOrder() | id, patch | — |
| 152 | Estado lab order chip | changeLabOrderStatus() | id, status | — |
| 153 | Input tracking | updateLabOrder() | regex | — |
| 154 | WhatsApp log lista | read | caseId | DrawerWhatsAppChat |
| 155 | Btn responder WhatsApp | sendWhatsApp() | {caseId, body} | — |
| 156 | Btn descargar consentimiento | downloadDocument() | docId | — |
| 157 | Btn re-enviar link firma | resendSignLink() | docId | — |
| 158 | Tooltip "Caso ortodóntico activo" | — | — | — |
| 159 | Btn Pregúntale a IA | openAIWithContext() | caseId | — |
| 160 | Btn "Marcar debonding" | markDebonding() | caseId, date | ConfirmDialog |

**Total: 160 elementos.**

---

## 1.3 Server actions — 48 con firma TypeScript

```ts
// ──────── CASE LIFECYCLE ────────
export async function createOrthoCase(input: { patientId: string }): Promise<Result<OrthoCase>>
export async function updateCaseStatus(caseId: string, status: CaseStatus): Promise<Result<OrthoCase>>
export async function markDebonding(caseId: string, date: Date): Promise<Result<OrthoCase>>
export async function completeCase(caseId: string): Promise<Result<OrthoCase>>
export async function archiveCase(caseId: string): Promise<Result<OrthoCase>>

// ──────── DIAGNOSIS ────────
export async function updateDiagnosis(caseId: string, patch: Partial<DiagnosisInput>): Promise<Result<OrthoDiagnosis>>
export async function upsertHabitCatalog(clinicId: string, label: string): Promise<Result<string[]>>

// ──────── TREATMENT PLAN ────────
export async function updateTreatmentPlan(caseId: string, patch: Partial<PlanInput>): Promise<Result<TreatmentPlan>>
export async function addArchStep(planId: string, draft: ArchInput): Promise<Result<ArchPlanned>>
export async function updateArchStep(archId: string, patch: Partial<ArchInput>): Promise<Result<ArchPlanned>>
export async function reorderArches(planId: string, order: string[]): Promise<Result<ArchPlanned[]>>
export async function deleteArchStep(archId: string): Promise<Result<void>>
export async function advanceCurrentArch(caseId: string): Promise<Result<ArchPlanned>>
export async function updateIprPlan(planId: string, key: string, mm: number): Promise<Result<TreatmentPlan>>
export async function acceptTreatmentPlan(planId: string, signatureToken: string): Promise<Result<TreatmentPlan>>

// ──────── TEMPLATES ────────
export async function listOrthoTemplates(clinicId: string): Promise<Result<OrthoTemplate[]>>
export async function loadTemplate(caseId: string, templateId: string): Promise<Result<TreatmentPlan>>
export async function saveAsTemplate(input: { caseId: string, name: string, description?: string }): Promise<Result<OrthoTemplate>>
export async function deleteTemplate(templateId: string): Promise<Result<void>>
export async function upsertApplianceType(input: ApplianceTypeInput): Promise<Result<ApplianceType>>

// ──────── PHOTOS ────────
export async function createPhotoSet(caseId: string, stageCode: string, capturedAt: Date): Promise<Result<PhotoSet>>
export async function uploadPhotos(photoSetId: string, files: FormData): Promise<Result<Photo[]>>
export async function togglePhotoFavorite(photoId: string): Promise<Result<Photo>>
export async function addAnnotation(photoId: string, a: Annotation): Promise<Result<Photo>>
export async function addMeasurement(photoId: string, m: Measurement): Promise<Result<Photo>>
export async function deletePhoto(photoId: string): Promise<Result<void>>
export async function generateMobileUploadToken(caseId: string, kind: PhotoKind): Promise<Result<{url:string, expiresAt:Date}>>

// ──────── TREATMENT CARDS ────────
export async function createTreatmentCard(caseId: string, draft: TreatmentCardInput): Promise<Result<TreatmentCard>>
export async function updateTreatmentCard(cardId: string, patch: Partial<TreatmentCardInput>): Promise<Result<TreatmentCard>>
export async function signOffTreatmentCard(cardId: string): Promise<Result<TreatmentCard>>
export async function applyTreatmentCardTemplate(cardId: string, templateId: string): Promise<Result<TreatmentCard>>
export async function printIndications(cardId: string): Promise<Result<{url:string}>>
export async function computeCompliance(caseId: string): Promise<Result<{value:number, delta:number}>>

// ──────── FINANCIAL ────────
export async function upsertFinancialPlan(caseId: string, input: FinancialPlanInput): Promise<Result<FinancialPlan>>
export async function setActiveScenario(planId: string, scenarioId: string): Promise<Result<FinancialPlan>>
export async function regenerateInstallments(planId: string): Promise<Result<Installment[]>>
export async function collectInstallment(installmentId: string, paymentMethod: PaymentMethod): Promise<Result<{installment:Installment, invoice:Invoice}>>
export async function sendSignAtHome(planId: string, scenarioId: string): Promise<Result<{externalId:string}>>

// ──────── RETENTION ────────
export async function upsertRetentionPlan(caseId: string, input: RetentionInput): Promise<Result<RetentionPlan>>
export async function scheduleRetentionCheckpoint(caseId: string, when: Date): Promise<Result<Appointment>>
export async function recordNpsResponse(caseId: string, checkpoint: string, score: number, comment?: string): Promise<Result<RetentionPlan>>
export async function generateBeforeAfterPdf(caseId: string): Promise<Result<{url:string}>>
export async function generateReferralCard(caseId: string): Promise<Result<{url:string}>>

// ──────── DOCUMENTS & LAB ────────
export async function generateConsent(caseId: string, templateId: string): Promise<Result<OrthoDocument>>
export async function sendReferralLetter(caseId: string, input: ReferralInput): Promise<Result<OrthoDocument>>
export async function createLabOrder(caseId: string, input: LabOrderInput): Promise<Result<LabOrder>>
export async function updateLabOrder(id: string, patch: Partial<LabOrderInput>): Promise<Result<LabOrder>>
export async function resendSignLink(docId: string): Promise<Result<void>>

// ──────── CROSS-MODULE ────────
export async function openAIWithContext(caseId: string): Promise<Result<{redirectUrl:string}>>
export async function sendWhatsApp(caseId: string, body: string, templateId?: string): Promise<Result<CommunicationLog>>
```

Cada acción retorna `Result<T> = {ok:true, data:T} | {ok:false, error:{code,message,field?}}`.

---

## 1.4 Validaciones zod

```ts
// /lib/schemas/ortho.ts
import { z } from "zod";

export const DiagnosisInputSchema = z.object({
  angleClass:       z.enum(["I","II_DIV1","II_DIV2","III","COMBO"]),
  subCaninoR:       z.enum(["I","II_DIV1","II_DIV2","III","COMBO"]).optional(),
  subCaninoL:       z.enum(["I","II_DIV1","II_DIV2","III","COMBO"]).optional(),
  subMolarR:        z.enum(["I","II_DIV1","II_DIV2","III","COMBO"]).optional(),
  subMolarL:        z.enum(["I","II_DIV1","II_DIV2","III","COMBO"]).optional(),
  overjetMm:        z.number().min(0).max(20).optional(),
  overbiteMm:       z.number().min(0).max(15).optional(),
  openBite:         z.enum(["NONE","ANTERIOR","POSTERIOR","BOTH"]),
  crossBite:        z.enum(["NONE","ANTERIOR","LATERAL_R","LATERAL_L","POSTERIOR_R","POSTERIOR_L","BILATERAL"]),
  crowdingMaxMm:    z.number().min(0).max(15).optional(),
  crowdingMandMm:   z.number().min(0).max(15).optional(),
  diastemas:        z.array(z.object({ teeth: z.array(z.number().int().min(11).max(48)).length(2), mm: z.number().min(0.1).max(10) })),
  midlineDeviation: z.number().min(-10).max(10).optional(),
  facialProfile:    z.enum(["CONCAVE","STRAIGHT","CONVEX"]),
  skeletalPattern:  z.enum(["BRACHY","MESO","DOLICHO"]),
  skeletalIssues:   z.array(z.string().min(2).max(60)).max(8),
  tmjFindings:      z.object({ noise: z.boolean(), pain: z.boolean(), deflexionMm: z.number().min(0).max(10).optional(), openingMm: z.number().min(0).max(80).optional() }),
  habits:           z.array(z.string()).max(10),
  narrative:        z.string().max(5000),
});

export const ArchInputSchema = z.object({
  phase:     z.enum(["ALIGNMENT","LEVELING","SPACE_CLOSE","DETAIL","FINISHING","RETENTION"]),
  material:  z.enum(["NITI","SS","TMA","BETA_TI","ESTHETIC","OTHER"]),
  gauge:     z.string().regex(/^\.\d{3}(\s?x\s?\.\d{3})?$/, "Formato: .016 o .016x.022"),
  durationW: z.number().int().min(1).max(52),
  startDate: z.date().optional(),
  endDate:   z.date().optional(),
}).refine(d => !d.endDate || !d.startDate || d.endDate > d.startDate, { message: "endDate > startDate" });

export const FinancialPlanInputSchema = z.object({
  total:       z.coerce.number().min(1).max(1_000_000),
  downPayment: z.coerce.number().min(0).max(1_000_000),
  months:      z.coerce.number().int().min(1).max(120),
  monthly:     z.coerce.number().min(0).max(1_000_000),
  startDate:   z.date(),
}).refine(d => Math.abs(d.total - (d.downPayment + d.monthly * d.months)) <= 10, {
  message: "Total != enganche + (mensual × meses) ± $10", path: ["total"]
});

export const TreatmentCardInputSchema = z.object({
  visitDate:       z.date().max(new Date(), "No futuro"),
  visitType:       z.enum(["INSTALLATION","CONTROL","EMERGENCY","DEBONDING","RETAINER_FIT","FOLLOWUP"]),
  archPlacedId:    z.string().cuid().optional(),
  ligColor:        z.string().max(40).optional(),
  activations:     z.array(z.string()).max(20),
  elasticUse:      z.object({ type: z.string(), prescribedHours: z.string(), reportedCompliance: z.number().min(0).max(100) }).optional(),
  bracketsLost:    z.array(z.number().int().min(11).max(48)).max(32),
  soap:            z.object({ s: z.string().max(2000), o: z.string().max(2000), a: z.string().max(2000), p: z.string().max(2000) }),
  homeInstr:       z.string().max(3000),
  nextSuggestedAt: z.date().min(new Date(), "Próxima cita en futuro").optional(),
  linkedPhotoSet:  z.string().cuid().optional(),
});

export const LabOrderInputSchema = z.object({
  itemCode:     z.string().min(2).max(60),
  itemLabel:    z.string().min(2).max(120),
  labPartner:   z.string().min(2).max(80),
  trackingCode: z.string().max(80).optional(),
  status:       z.enum(["DRAFT","SENT","RECEIVED","CANCELLED"]),
});

export const ReferralCodeSchema = z.string().regex(/^[A-Z0-9]{4,12}$/, "Solo A-Z 0-9, 4-12 chars");
```

---

## 2 · Integración cross-módulo

| Módulo | Triggers · single source of truth | Implementación |
|---|---|---|
| **/dashboard/appointments** | Cada TreatmentCard crea/actualiza un Appointment (link bidi). Cancelar Appointment marca TC como `EMERGENCY/cancelled`. | `TreatmentCard.appointmentId ←→ Appointment.treatmentCardId`. `createTreatmentCard` hace upsert en mismo tx. |
| **/dashboard/billing** | Cobrar mensualidad orto NO duplica UI: redirige a `/billing/new?installmentId=…`. Callback marca `Installment.invoiceId` y `status=PAID`. CFDI Facturapi stub Fase 2. | `collectInstallment() → router.push('/billing/new?installmentId='+id)` |
| **/dashboard/xrays** | Single source of truth = modelo `Xray`. Rx subida desde orto crea `Xray` con tag `ortho` y `Photo.xrayId` apunta. | `uploadPhotos()`: si kind ∈ {RX_*, CBCT} → crear Xray + Photo |
| **/dashboard/ai-assistant** | Alertas IA (no-compliance, riesgo abandono, vencimiento mensualidad) en cron, filtradas por paciente. Botón "Pregúntale a IA" pasa contexto. | `openAIWithContext(caseId) → /ai-assistant?context=ortho-case-{id}` |
| **/dashboard/whatsapp** | Inbox central es la fuente. `CommunicationLog` es vista filtrada por `caseId` — no duplica. | `CommunicationLog.externalId → join inbox global` |
| **/dashboard/patients** | Badge "Caso orto activo" cuando `Patient.orthoCase.status ∈ {ACTIVE,RETENTION}`. Filtro nuevo "En tratamiento orto". | `Patient.orthoCase` relación opcional |

---

## 4 · Lógica disabled — 22 reglas

| # | Control | Disabled si… | Tooltip |
|---|---|---|---|
| 1 | Btn "Generar PDF antes/después" | `status !== COMPLETED && !debondedAt` | "Disponible al marcar debonding completado" |
| 2 | Btn "Cobrar siguiente $X" | `!hasPending(installments)` | "No hay mensualidad pendiente" |
| 3 | Btn "Avanzar al arco siguiente" | `!archesPlanned.some(a => a.status === FUTURE)` | "No hay arcos futuros — agrega uno o avanza a Cierre" |
| 4 | Btn "Sign@Home WhatsApp" | `!plan.activeScenarioId` | "Selecciona escenario A/B/C antes de enviar" |
| 5 | Tab T1 (etapa) | `!T0 \|\| T0.photos.length === 0` | "Sube primero el set inicial T0" |
| 6 | Btn "+ Treatment Card" | `status === DRAFT` | "Acepta el plan antes de registrar citas" |
| 7 | Btn "Marcar debonding" | `currentPhase !== FINISHING && cards.length < 6` | "El caso debe estar en Finalización" |
| 8 | Btn "Generar consentimiento" | `!plan.acceptedAt` | "Plan no aceptado por paciente todavía" |
| 9 | Btn "+ Carta referencia" | `!diagnosis` | "Falta diagnóstico — captura clasificación de Angle primero" |
| 10 | Btn "Guardar como plantilla" | `archesPlanned.length === 0` | "Plan vacío — agrega al menos un arco" |
| 11 | Btn "Cargar plantilla" | `archesPlanned.length > 0 && status !== DRAFT` | "Plan ya iniciado — borra arcos para cargar otra plantilla" |
| 12 | Btn comparar fotos | `photoSets.length < 2` | "Necesitas al menos 2 sets para comparar" |
| 13 | Editor narrativa diagnóstico | `status === COMPLETED && !canReopen` | "Caso completado — reabre para editar" |
| 14 | Btn "Activar NPS" | `!debondedAt` | "NPS se activa post-debond" |
| 15 | Chip checkpoint pasado | `checkpoint.date < today && !done` | "Vencido — registra manualmente" |
| 16 | Btn "Eliminar foto T0" | `cards.some(c => c.linkedPhotoSet === id)` | "Foto vinculada a Treatment Card #N" |
| 17 | Input mensual | `activeScenarioId !== thisScenario` | "Activa este escenario para editar" |
| 18 | Btn "Imprimir indicaciones" | `!card.signedOffAt` | "Firma la Treatment Card primero" |
| 19 | Btn "+ Tipo nuevo aparatología" | `role !== "doctor"` | "Solo el ortodoncista puede crear tipos nuevos" |
| 20 | Drag-reorder arcos | `archesPlanned.some(a => a.status === PAST)` | "Hay arcos ya ejecutados — solo se pueden reordenar futuros" |
| 21 | Btn "Aceptar plan" | `!financialPlan \|\| !archesPlanned.length` | "Plan financiero y arcos requeridos antes de aceptar" |
| 22 | Btn "Pregúntale a IA" | `!user.aiAssistantEnabled` | "AI Assistant no contratado · contratar" |

---

## 5 · Permisos por rol — 35 acciones × 3 roles = 105 reglas

D = Doctor · A = Asistente · R = Recepción · ✓ permite · ✗ bloquea · RO read-only

| Acción | D | A | R |
|---|---|---|---|
| Ver expediente clínico | ✓ | ✓ | RO |
| Editar diagnóstico | ✓ | ✗ | ✗ |
| Editar plan tratamiento | ✓ | ✗ | ✗ |
| Cargar / Guardar plantilla | ✓ | ✗ | ✗ |
| + Tipo nuevo aparatología | ✓ | ✗ | ✗ |
| Agregar / editar / borrar arco | ✓ | ✗ | ✗ |
| Avanzar arco actual | ✓ | ✗ | ✗ |
| Editar IPR plan / realizado | ✓ | ✗ | ✗ |
| Subir foto-set | ✓ | ✓ | ✗ |
| Anotar / medir foto | ✓ | ✓ | ✗ |
| Eliminar foto | ✓ | ✗ | ✗ |
| Marcar foto favorita | ✓ | ✓ | ✗ |
| Comparar fotos | ✓ | ✓ | RO |
| Crear Treatment Card | ✓ | ✓ draft | ✗ |
| Editar SOAP | ✓ | ✓ pre-llenar | ✗ |
| Firmar Treatment Card | ✓ | ✗ | ✗ |
| Imprimir indicaciones | ✓ | ✓ | ✓ |
| Editar plan financiero | ✓ | ✗ | ✓ |
| Activar escenario / Sign@Home | ✓ | ✗ | ✓ |
| Cobrar mensualidad | ✓ | ✗ | ✓ |
| Ver detalle CFDI | ✓ | RO | ✓ |
| Editar régimen retención | ✓ | ✗ | ✗ |
| Agendar checkpoint retención | ✓ | ✓ | ✓ |
| Marcar checkpoint completado | ✓ | ✓ | ✗ |
| Generar PDF antes/después | ✓ | ✗ | ✓ |
| Generar share-card referidos | ✓ | ✓ | ✓ |
| Generar consentimiento | ✓ | ✓ | ✓ |
| Enviar carta referencia | ✓ | ✗ | ✗ |
| Crear / editar lab order | ✓ | ✓ | ✗ |
| Cambiar estado lab order | ✓ | ✓ | ✗ |
| Ver WhatsApp log | ✓ | ✓ | ✓ |
| Responder WhatsApp | ✓ | ✓ | ✓ |
| Marcar debonding completado | ✓ | ✗ | ✗ |
| Completar / archivar caso | ✓ | ✗ | ✗ |
| Pregúntale a IA · contexto caso | ✓ | ✓ | ✗ |

---

## 6 · Notificaciones — 12 eventos

| # | Evento | Trigger | Destinatario | Canal |
|---|---|---|---|---|
| 1 | Mensualidad por cobrar mañana | cron diario · `dueDate = tomorrow && FUTURE` | Recepcionista | In-app + email |
| 2 | Mensualidad vencida (overdue) | cron diario · `dueDate < today && PENDING` | Recepcionista + Doctor | In-app |
| 3 | Bracket caído reportado | WhatsApp inbound · intent BRACKET_LOST | Ortodoncista | Push + WA confirm |
| 4 | Compliance < 60% en última card | hook `signOffTreatmentCard` | Ortodoncista | In-app |
| 5 | NPS respondido | `recordNpsResponse` | Admin clínica | In-app + email digest |
| 6 | Checkpoint retención próximo (7d) | cron semanal | Asistente | In-app |
| 7 | Pre-form "¿usas retenedor?" 1-2d antes | cron · paciente | Paciente | WhatsApp (Twilio stub) |
| 8 | Lab order > 14d en SENT | cron diario | Asistente | In-app |
| 9 | Foto T-N subida (móvil → desktop) | `uploadPhotos` desde token móvil | Ortodoncista actual | In-app toast |
| 10 | Plan firmado por paciente (Sign@Home) | webhook Twilio | Ortodoncista + Recep | In-app |
| 11 | Referido entró por código | nuevo paciente usa `referralCode` | Paciente referente + Admin | WA + In-app |
| 12 | Caso completado (auto-archivo 30d) | cron mensual | Ortodoncista | In-app |

---

## 7 · Atajos de teclado — 12

Scope: solo activos dentro de `/patients/[id]/orto/*`. `⌘K` global se preserva.

| Tecla | Acción | Scope |
|---|---|---|
| `N` | + Treatment Card | cualquier sección |
| `F` | + Subir foto rápida | cualquier sección |
| `W` | + Agregar wire step | sección Plan |
| `C` | $ Cobrar siguiente mensualidad | cualquier sección |
| `D` | Marcar debonding completado | sección Retención |
| `G` | Cargar plantilla de plan | sección Plan |
| `A` | → Avanzar al arco siguiente | cualquier sección |
| `1..8` | Saltar a sección N del sub-sidebar | cualquier sección |
| `?` | Mostrar cheatsheet de atajos | cualquier sección |
| `Esc` | Cerrar drawer/modal abierto | drawer activo |
| `⌘S` | Forzar guardar drawer activo | drawer activo |
| `⌘Enter` | Aceptar & cerrar drawer | drawer activo |

---

## 8 · Artifacts entregados en el proyecto

### Documentos de planeación

| Archivo | Descripción |
|---|---|
| `Orto Fase 1 - Strategy + Wireframes.html` | Estrategia + AI + 7 wireframes low-fi + 4 drawers + estados vacío/poblado |
| `Orto Fase 1 - Variantes.html` | Estados macro del caso (DRAFT/ACTIVE/RETENTION/COMPLETED) y variantes lo-fi por sección |
| `Orto Fase 2 - SPEC Tecnico.html` | SPEC técnico completo en formato browseable |
| `ortho-spec.md` | Versión markdown del SPEC (fuente original) |
| `ortho-spec-consolidado.md` | Este documento — copy-paste directo para implementación |

### Diseño hi-fi consolidado

| Archivo | Descripción |
|---|---|
| `Orto Modulo Hi-Fi.html` | Shell completo del módulo con header de paciente, sub-sidebar 8 secciones, navegación interna, light/dark, las 7 secciones funcionales y los 8 drawers principales montados |

### Tokens y atoms compartidos

| Archivo | Descripción |
|---|---|
| `ortho-tokens.css` | Tokens DS extendidos (bg-elev-1/2/3, brand, danger, success, success-soft, dashed lines, sombras light+dark) |
| `ortho-atoms.jsx` | Atoms reutilizables: PatientHeader · SubSidebar · StatCardKPI · ApplianceBadge · ToothPicker · CollapsibleCard · WireStepRow · IPRSlot · PhotoSlot · InstallmentChip · RetentionTimeline · TreatmentCardItem |

### Secciones JSX

| Archivo | Descripción |
|---|---|
| `ortho-sections-1.jsx` | Resumen del caso · Expediente clínico (diagnóstico) · Fotos & Rx (T0/T1/T2 + compare) · Plan de tratamiento (aparatología + decisiones + arcos + IPR + objetivos) |
| `ortho-sections-2.jsx` | Citas & evolución (timeline + Treatment Cards) · Plan financiero (escenarios + mensualidades) · Retención (régimen + checkpoints + referidos) · Documentos (consents + lab orders + WhatsApp log) |

### Drawers / modales

| Archivo | Descripción |
|---|---|
| `ortho-drawers.jsx` | DrawerEditDiagnosis · DrawerEditPlan · DrawerNewWireStep · DrawerNewApplianceType · DrawerNewTAD · DrawerNewStage · DrawerUploadPhotos · ModalMobileUpload · LightboxPhoto · ModalCompare · ModalAnnotate · DrawerNewTreatmentCard · DrawerEditFinancialPlan · DrawerCollectInstallment · ModalQuoteScenarios · ModalSignAtHome · ModalCFDIDetail · DrawerConfigRetention · DrawerNewReferralLetter · DrawerNewLabOrder · DrawerGenerateConsent · DrawerWhatsAppChat · ConfirmDialog |

### Contexto existente del proyecto

| Archivo | Descripción |
|---|---|
| `MediFlow Design System.html` | DS canónico — tokens, tipografía, sombras, componentes |
| `MediFlow Screens.html` / `MediFlow Screens v2.html` | Screens previos (referencia del patrón patient-detail) |
| `MediFlow Implementation Notes.html` | Notas previas de implementación |
| `index.html` · `tokens.js` | Index del proyecto y tokens JS |

**Total entregables Fase 2:** 1 shell hi-fi + 4 archivos JSX (atoms + 2 sections + drawers) + 1 hoja de tokens + 5 docs de planeación = **11 archivos**, cubriendo todos los **160 elementos** y **8 secciones funcionales** especificadas en el SPEC.

**Fin del SPEC consolidado.**
