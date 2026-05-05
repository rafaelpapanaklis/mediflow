# SPEC — Módulo Implantología (MediFlow 4/5)

> **Estado:** listo para implementación por Bot Git 3.
> **Posición:** módulo 4 de 5 del marketplace de especialidades. Pediatría (1/5), Endodoncia (2/5) y Periodoncia (3/5) ya en producción o en merge final.
> **Branch base:** `origin/feature/endodontics-module-v1` (NO main, NO periodontics).
> **Owner técnico:** Rafael Salazar.
> **Última revisión:** mayo 2026.

---

## 0. Resumen ejecutivo

Implantología es el módulo con la regulación legal más estricta de los cuatro hechos hasta ahora. El implante dental es un **dispositivo médico clase III** (COFEPRIS), lo que obliga a trazabilidad por lote: ante un recall del fabricante, el doctor debe identificar a todos los pacientes afectados en minutos. Los PMS mexicanos no resuelven esto bien — Dentrix y OpenDental tienen campos libres para marca/modelo, sin trazabilidad estructurada; Straumann CARES Visual y coDiagnostiX son excelentes para planeación 3D pero NO son PMS y cuestan ≥2 000 USD anuales. MediFlow no compite con ellos en planeación pre-quirúrgica — domina el **tracking longitudinal** del implante post-cirugía, donde todos fallan.

Cuatro diferenciadores reales:

1. **Trazabilidad COFEPRIS rigurosa** — `brand`, `lot`, `placedAt` son INMUTABLES por defecto. UPDATE solo con justificación obligatoria ≥20 chars + audit before/after. DELETE prohibido. "Remover" un implante = cambiar `currentStatus → REMOVED` con `removalReason ≥20 chars`. Difiere del soft-delete estándar de los otros módulos.
2. **Tarjeta-timeline horizontal del implante** — la pieza visual estrella, equivalente al periodontograma 6×32 de Perio. 5-6 hitos clicables (Planeación → Cirugía → Osteointegración → 2ª cirugía → Fase protésica → Mantenimiento). Color según estado: azul cicatrizando, verde sano, amarillo control próximo, naranja complicación leve, rojo complicación severa o fracaso. El doctor entiende en 2 segundos en qué fase está el paciente.
3. **Carnet del implante (PDF)** — generado automáticamente al finalizar fase protésica, formato licencia horizontal landscape. Marca, lote, doctor, lab. La "credencial dental" del paciente. Diferenciador real frente a la competencia.
4. **Wizards estructurados** — la implantología tiene flujos lineales bien definidos (planeación 4 pasos, cirugía 3 pasos, fase protésica 3 pasos). NUNCA captura inline en la vista principal — saturaría la pantalla. Drawer lateral para mantenimiento y complicación. Modal full-screen solo para consentimiento.

**Mobile = solo lectura.** Captura de cirugía/protésica requiere tablet/desktop por densidad de campos. Lectura sí permite ver tarjetas-timeline + carnet + mantenimiento previo.

**Modelos:** 9 en MVP (`Implant`, `ImplantSurgicalRecord`, `ImplantHealingPhase`, `ImplantSecondStageSurgery`, `ImplantProstheticPhase`, `ImplantComplication`, `ImplantFollowUp`, `ImplantConsent`, `ImplantPassport`). 3 en v1.1 (`ImplantSurgicalPlan`, `BoneAugmentation`, `ImplantPrescription`). 1 en v2.0 (`ImplantInventoryItem`). Total documentado: 13.

**Server actions:** 16 mutaciones clínicas, todas con audit log obligatorio. Una de ellas (`createPeriImplantAssessment`) queda como STUB porque el modelo `PeriImplantAssessment` vive en el módulo Periodoncia que aún no está en main — ver §1.20.

---

## 1. Decisiones bloqueadas (NO revaluar)

| # | Decisión | Justificación |
|---|----------|---------------|
| 1.1 | Tab "Implantología" en patient-detail con 3 sub-tabs: **Implantes, Cirugías y aumentos, Mantenimiento** | Cada implante es entidad de muy largo plazo — separar vista por implante de procedimientos quirúrgicos y de mantenimiento |
| 1.2 | Página dedicada `/dashboard/specialties/implants/page.tsx` con widgets "Controles vencidos" y "Pacientes con complicación activa" | Utilidad operativa (recepcionista llama a vencidos, doctor revisa complicaciones) |
| 1.3 | Inventario y dashboard de tasa de éxito → **v2.0** (no MVP) | MVP busca ser viable rápido; estos son nice-to-have |
| 1.4 | Visualización estrella: **tarjeta-timeline horizontal del implante** con 5-6 hitos clicables | El doctor entiende en 2s la fase del paciente |
| 1.5 | Color del implante según estado: azul cicatrizando, verde sano, amarillo control próximo, naranja complicación leve, rojo complicación severa o fracaso | Codificación cromática consistente con perio/endo |
| 1.6 | Si paciente tiene 8+ implantes (All-on-4 doble arcada): tarjetas se compactan a "vista de lista" con expansión on-demand | Usabilidad en rehabilitaciones completas |
| 1.7 | Captura primaria: **WIZARDS** para flujos secuenciales largos (cirugía 3 pasos, fase protésica 3 pasos, planeación 4 pasos en v1.1) | Flujos lineales bien definidos |
| 1.8 | **Drawer lateral derecho** para mantenimiento y complicación. Modal full-screen solo para consentimiento. NUNCA captura inline en la vista principal | Densidad de campos saturaría la vista |
| 1.9 | **Trazabilidad COFEPRIS clase III**: `brand`, `lot`, `placedAt` INMUTABLES por defecto. UPDATE solo con justificación obligatoria ≥20 chars + audit before/after. DELETE PROHIBIDO | Regulación legal — no negociable |
| 1.10 | "Remover" un implante: cambiar `currentStatus → REMOVED` con `removalReason ≥20 chars` y `removedAt` timestamp. Difiere del soft-delete estándar | Trazabilidad del dispositivo no se borra |
| 1.11 | Enum `ImplantBrand` con 8 marcas + OTRO: STRAUMANN, NOBEL_BIOCARE, NEODENT, MIS, BIOHORIZONS, ZIMMER_BIOMET, IMPLANT_DIRECT, ODONTIT, OTRO | Cobertura mercado MX. Si OTRO, campo libre `brandCustomName: String?` |
| 1.12 | **Densidad ósea: Lekholm-Zarb 1985 (D1-D4)**, NO mezclar con clasificación Misch | Estándar global |
| 1.13 | **Criterios de éxito: Albrektsson 1986** (<0.2mm pérdida ósea/año tras año 1) | Consenso internacional |
| 1.14 | **ISQ ≥70 mesiodistal Y vestibulolingual** = listo para carga; <60 = no cargar | Umbrales del consenso ITI |
| 1.15 | **Carnet del implante PDF** formato licencia horizontal landscape (no A4). Auto-generado al finalizar fase protésica | Entra en cartera del paciente, se siente como credencial |
| 1.16 | **QR público del carnet: opt-in** (NO activado por defecto). Privacidad LFPDPPP | El paciente decide si activarlo para emergencias |
| 1.17 | **Mobile = solo lectura del módulo**. Captura cirugía/protésica requiere tablet/desktop | Densidad de campos |
| 1.18 | Reutilización agresiva: SignaturePad de pediatría, Drawer del design system, patrón Server Actions con `Result<T>` discriminado, `canAccessModule` helper, audit log obligatorio, recordatorios WhatsApp con encolado tipo `IMPLANT` | Consistencia con módulos previos |
| 1.19 | Constante: `IMPLANTS_MODULE_KEY = "implants"` en `src/lib/specialties/keys.ts` | Patrón establecido en Perio/Endo/Pedi |
| 1.20 | **NO crear modelo PeriImplantAssessment en este módulo**. Vive en Periodoncia (3/5). Server action `createPeriImplantAssessment` queda como STUB que retorna `{ ok: true, data: { stub: true } }` con TODO. UI muestra mensaje "Función disponible cuando se active el módulo Periodoncia." | Branch base es endodontics-v1, perio aún no está en main |
| 1.21 | Migración SQL futura: convertir `PeriImplantAssessment.implantId` de `String?` a FK real apuntando a `Implant.id` se ejecuta en migración SEPARADA al integrar ambos módulos en main. NO incluir en este branch | Coordinación de merge con feature/periodontics-module-v1 |
| 1.22 | Icono del módulo en sidebar: **`Anchor`** de lucide-react | Anclaje óseo del implante, metáfora visual directa. Diferencia clara vs `Activity` de Perio, `Baby` de Pedi, `Zap` de Endo |
| 1.23 | Gender enum del repo: `M | F | OTHER` (NO MALE/FEMALE) | Patrón establecido |
| 1.24 | Manejador de paquetes: **npm** (NO pnpm) | Convención del repo |
| 1.25 | Stack heredado sin cambios: Next.js 14 App Router, TypeScript estricto, Tailwind con tokens dark-mode, `lucide-react`, `react-hot-toast`, `recharts`, Prisma 5.22 + Supabase | No inventar dependencias |

---

## 2. Stack y convenciones (heredadas)

- **Framework:** Next.js 14 App Router.
- **Lenguaje:** TypeScript estricto. `noImplicitAny`, `strictNullChecks`.
- **Estilos:** Tailwind CSS con tokens dark-mode existentes (`--text-1`, `--text-2`, `--text-3`, `--bg-base`, `--bg-elev`, `--bg-elev-2`, `--brand`, `--brand-soft`, `--border-soft`, `--success`, `--warning`, `--danger`, `--info`).
- **Iconos:** `lucide-react`. Icono del módulo: `Anchor`.
- **Notificaciones:** `react-hot-toast` (ya configurado en root).
- **Charts:** `recharts` (gráficos de evolución ISQ y pérdida ósea radiográfica).
- **ORM:** Prisma 5.22 + Supabase (Postgres 15).
- **Multi-tenant:** todo modelo nuevo lleva `clinicId String` con índice. RLS activa en Supabase.
- **Audit log:** OBLIGATORIO en TODA mutación clínica. Tabla `AuditLog` ya existe; reuso del helper `recordAudit`.
- **Trazabilidad COFEPRIS:** los campos `brand`, `lot`, `placedAt` de `Implant` son inmutables por convención de UI + validación server-side. La única mutación permitida sobre ellos requiere `mutationJustification: String` con length ≥20.
- **Compliance:** NOM-024-SSA3-2012 (expediente clínico — conservación 5 años, recomendado 10+ por naturaleza largo plazo) + LFPDPPP (consentimiento explícito para QR público) + COFEPRIS (trazabilidad clase III).
- **Idioma de UI:** español neutro mexicano. NUNCA argentino. `agrega/prueba/verifica`, NO `agregá/probá/verificá`. Tú, NO vos.
- **Sin emojis en UI clínica.** Iconos lucide o nada.

### Convenciones de servidor (heredadas)

```ts
'use server';

export async function someAction(input: Input): Promise<Result<Data>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'UNAUTHENTICATED' };
  const clinicId = await getActiveClinicId();
  if (!clinicId) return { ok: false, error: 'NO_CLINIC_CONTEXT' };

  if (!(await canAccessModule(user.id, clinicId, IMPLANTS_MODULE_KEY))) {
    return { ok: false, error: 'FORBIDDEN_MODULE' };
  }

  const parsed = SomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION', issues: parsed.error.issues };

  const result = await prisma.$transaction(async (tx) => {
    const data = await tx.someModel.create/update(...);
    await recordAudit(tx, {
      userId: user.id, clinicId,
      entity: 'Implant', entityId: data.id,
      action: 'CREATE' | 'UPDATE' | 'STATUS_CHANGE',
      before, after: data,
    });
    return data;
  });

  revalidatePath(`/dashboard/patients/${input.patientId}/implants`);
  return { ok: true, data: result };
}
```

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: ZodIssue[] };
```

```ts
export const IMPLANTS_MODULE_KEY = 'implants' as const;
```

---

## 3. Estructura de archivos

```
src/
├── app/dashboard/
│   ├── patients/[patientId]/
│   │   └── implants/
│   │       ├── page.tsx                          # Tab principal con sub-tabs
│   │       ├── _components/
│   │       │   ├── ImplantsTab.tsx
│   │       │   ├── ImplantsSubTabs.tsx           # Implantes | Cirugías y aumentos | Mantenimiento
│   │       │   ├── ImplantsListTab.tsx
│   │       │   ├── SurgeriesTab.tsx
│   │       │   ├── MaintenanceTab.tsx
│   │       │   └── EmptyState.tsx
│   │       ├── implant-card/
│   │       │   ├── ImplantCard.tsx               # tarjeta-timeline (núcleo)
│   │       │   ├── ImplantTimeline.tsx           # 5-6 hitos clicables
│   │       │   ├── TimelineMilestone.tsx
│   │       │   ├── ImplantHeader.tsx             # FDI + ilustración + badge estado
│   │       │   ├── ImplantSidePanel.tsx          # marca/modelo/diámetro/longitud/lote
│   │       │   ├── ImplantActions.tsx            # acciones rápidas footer
│   │       │   └── CompactImplantList.tsx        # vista lista para 8+ implantes
│   │       ├── wizards/
│   │       │   ├── PlanningWizard.tsx            # v1.1 — 4 pasos
│   │       │   ├── SurgeryWizard.tsx             # 3 pasos al cierre
│   │       │   ├── ProstheticWizard.tsx          # 3 pasos
│   │       │   └── steps/                        # cada paso por wizard
│   │       ├── drawers/
│   │       │   ├── MaintenanceDrawer.tsx
│   │       │   ├── ComplicationDrawer.tsx
│   │       │   ├── SecondStageDrawer.tsx
│   │       │   └── BoneAugmentationDrawer.tsx    # v1.1
│   │       ├── modals/
│   │       │   ├── SurgeryConsentModal.tsx
│   │       │   ├── BoneAugmentConsentModal.tsx   # v1.1
│   │       │   ├── BrandUpdateJustificationModal.tsx
│   │       │   └── RemoveImplantModal.tsx
│   │       ├── radiographs/
│   │       │   └── RadiographicSeriesView.tsx    # 0/6m/12m/24m/5y comparativo
│   │       ├── passport/
│   │       │   ├── PassportPreview.tsx
│   │       │   └── PassportPdfButton.tsx
│   │       └── _actions/
│   │           ├── createImplant.ts
│   │           ├── updateImplantTraceability.ts
│   │           ├── removeImplant.ts
│   │           ├── createSurgicalRecord.ts
│   │           ├── updateImplantStatus.ts
│   │           ├── createHealingPhase.ts
│   │           ├── createSecondStageSurgery.ts
│   │           ├── createProstheticPhase.ts
│   │           ├── createComplication.ts
│   │           ├── createFollowUp.ts
│   │           ├── createImplantConsent.ts
│   │           ├── generateImplantPassport.ts
│   │           ├── exportSurgicalReportPdf.ts
│   │           ├── exportPlanPdf.ts
│   │           └── createPeriImplantAssessment.ts # STUB hasta integración Perio
│   └── specialties/
│       └── implants/
│           ├── page.tsx                          # Vista clínica: vencidos + complicaciones
│           ├── [patientId]/
│           │   └── page.tsx
│           └── _components/
│               ├── OverdueFollowUpsWidget.tsx
│               ├── ActiveComplicationsWidget.tsx
│               └── ImplantPatientList.tsx
├── lib/
│   └── implants/
│       ├── status-machine.ts                     # transiciones válidas de currentStatus
│       ├── albrektsson-success.ts                # criterios éxito a 1y/5y/10y
│       ├── isq-thresholds.ts                     # umbrales de carga
│       ├── lekholm-zarb.ts                       # densidad ósea D1-D4
│       ├── implant-helpers.ts                    # categorización por tipo de carga
│       ├── pdf-templates/
│       │   ├── implant-passport.tsx              # licencia horizontal
│       │   ├── implant-plan.tsx                  # plan al paciente
│       │   └── surgical-report.tsx               # reporte quirúrgico legal
│       ├── consent-texts.ts
│       └── whatsapp-templates.ts
└── prisma/
    ├── schema.prisma                              # +13 modelos (9 MVP + 3 v1.1 + 1 v2.0) +12 enums
    ├── migrations/
    │   └── 2026_05_implants_init/
    │       └── migration.sql
    └── seeds/
        └── implants-mock.ts                      # 3 pacientes (Roberto, María, Carlos)
```

---

## 4. Modelo de datos (Prisma)

### 4.1 Enums

```prisma
enum ImplantBrand {
  STRAUMANN
  NOBEL_BIOCARE
  NEODENT
  MIS
  BIOHORIZONS
  ZIMMER_BIOMET
  IMPLANT_DIRECT
  ODONTIT
  OTRO
}

enum ImplantConnectionType {
  EXTERNAL_HEX
  INTERNAL_HEX
  CONICAL_MORSE
  TRI_CHANNEL
  OTRO
}

enum ImplantSurfaceTreatment {
  SLA
  SLActive
  TiUnite
  OsseoSpeed
  LASER_LOK
  OTRO
}

enum LekholmZarbDensity {
  D1   // cortical densa, esponjosa mínima — mandíbula anterior atrófica
  D2   // cortical gruesa rodeando esponjosa densa — mandíbula anterior y posterior, maxilar anterior
  D3   // cortical fina rodeando esponjosa baja densidad — maxilar posterior
  D4   // cortical mínima, esponjosa muy fina — maxilar posterior atrófico
}

enum ImplantStatus {
  PLANNED                // sin cirugía aún (v1.1)
  PLACED                 // cirugía realizada, en osteointegración
  OSSEOINTEGRATING       // periodo de cicatrización en curso
  UNCOVERED              // 2ª cirugía realizada (protocolo 2 fases)
  LOADED_PROVISIONAL     // prótesis provisional
  LOADED_DEFINITIVE      // prótesis definitiva colocada
  FUNCTIONAL             // en función >1 año, sin complicación activa
  COMPLICATION           // complicación activa (mucositis, peri-implantitis, mecánica)
  FAILED                 // fracaso clínico (osteointegración perdida, fractura)
  REMOVED                // explantado
}

enum ImplantProtocol {
  ONE_STAGE                                  // pilar de cicatrización inmediato
  TWO_STAGE                                  // sumergido + 2ª cirugía
  IMMEDIATE_PLACEMENT_DELAYED_LOADING        // implante post-extracción + carga diferida
  IMMEDIATE_PLACEMENT_IMMEDIATE_LOADING      // implante post-extracción + carga inmediata
  DELAYED_PLACEMENT_IMMEDIATE_LOADING        // carga inmediata sin extracción simultánea
}

enum AbutmentType {
  PREFABRICATED_TI
  CUSTOM_TI
  CUSTOM_ZIRCONIA
  MULTI_UNIT_STRAIGHT
  MULTI_UNIT_ANGLED_17
  MULTI_UNIT_ANGLED_30
  HEALING_ABUTMENT
  OTRO
}

enum ProsthesisType {
  SCREW_RETAINED_SINGLE
  CEMENT_RETAINED_SINGLE
  SCREW_RETAINED_MULTI
  CEMENT_RETAINED_MULTI
  OVERDENTURE_LOCATOR
  OVERDENTURE_BAR
  ALL_ON_4
  ALL_ON_6
  PROVISIONAL_ACRYLIC
}

enum ProsthesisMaterial {
  ZIRCONIA_MONOLITHIC
  PORCELAIN_FUSED_TO_METAL
  PORCELAIN_FUSED_TO_ZIRCONIA
  LITHIUM_DISILICATE
  ACRYLIC_PROVISIONAL
  PMMA_PROVISIONAL
  HYBRID_TITANIUM_ACRYLIC
  OTRO
}

enum ImplantComplicationType {
  PERI_IMPLANT_MUCOSITIS
  PERI_IMPLANTITIS_INITIAL
  PERI_IMPLANTITIS_MODERATE
  PERI_IMPLANTITIS_ADVANCED
  SCREW_LOOSENING
  ABUTMENT_SCREW_FRACTURE
  PROSTHESIS_FRACTURE
  IMPLANT_FRACTURE
  NERVE_DAMAGE_TRANSIENT
  NERVE_DAMAGE_PERMANENT
  SINUS_PERFORATION
  SINUS_INFECTION
  OSSEOINTEGRATION_FAILURE
  AESTHETIC_COMPLICATION
  OTRO
}

enum ASAClassification {
  ASA_I    // sano
  ASA_II   // enfermedad sistémica leve y controlada
  ASA_III  // enfermedad sistémica grave pero estable
  ASA_IV   // enfermedad sistémica grave amenaza vital
  ASA_V    // moribundo
}

enum BoneGraftSource {  // v1.1
  AUTOLOGOUS
  ALLOGRAFT_HUMAN
  XENOGRAFT_BOVINE
  XENOGRAFT_PORCINE
  SYNTHETIC_BIOACTIVE_GLASS
  SYNTHETIC_HYDROXYAPATITE
  SYNTHETIC_TCP
  OTRO
}

enum FollowUpMilestone {
  M_1_WEEK
  M_2_WEEKS
  M_1_MONTH
  M_3_MONTHS
  M_6_MONTHS
  M_12_MONTHS
  M_24_MONTHS
  M_5_YEARS
  M_10_YEARS
  UNSCHEDULED
}
```

### 4.2 Modelos MVP (9)

#### `Implant` — la entidad central, trazabilidad COFEPRIS

```prisma
model Implant {
  id          String  @id @default(cuid())
  patientId   String
  clinicId    String

  // Posición anatómica
  toothFdi    Int

  // ── Trazabilidad COFEPRIS clase III (INMUTABLE por convención) ──
  brand            ImplantBrand
  brandCustomName  String?               // si brand = OTRO
  modelName        String                // ej. "BLX", "Drive CM", "Tapered Internal"
  diameterMm       Float                 // 3.0 – 7.0
  lengthMm         Float                 // 6.0 – 18.0
  connectionType   ImplantConnectionType
  surfaceTreatment ImplantSurfaceTreatment?
  lotNumber        String                // CRÍTICO COFEPRIS
  manufactureDate  DateTime?
  expiryDate       DateTime?
  // ─────────────────────────────────────────────────────────────

  placedAt        DateTime               // CRÍTICO COFEPRIS
  placedByDoctorId String
  placedByDoctor   User    @relation("ImplantPlacedBy", fields: [placedByDoctorId], references: [id])

  protocol         ImplantProtocol
  currentStatus    ImplantStatus          @default(PLACED)
  statusUpdatedAt  DateTime               @default(now())

  // Removal (en lugar de delete)
  removedAt        DateTime?
  removalReason    String?                // ≥20 chars, requerido si REMOVED
  removalSurgeryRecordId String?          // referencia a la cirugía de remoción

  // Mutabilidad / audit
  notes            String?

  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  // NO existe deletedAt — la semántica de "borrar" es REMOVED

  patient     Patient    @relation(fields: [patientId], references: [id])
  clinic      Clinic     @relation(fields: [clinicId], references: [id])

  surgicalRecord    ImplantSurgicalRecord?
  healingPhase      ImplantHealingPhase?
  secondStage       ImplantSecondStageSurgery?
  prostheticPhase   ImplantProstheticPhase?
  complications     ImplantComplication[]
  followUps         ImplantFollowUp[]
  consents          ImplantConsent[]
  passport          ImplantPassport?

  @@index([patientId, currentStatus])
  @@index([clinicId, currentStatus])
  @@index([clinicId, placedAt(sort: Desc)])
  @@index([brand, lotNumber])              // queries de recall por lote
  @@index([toothFdi])
}
```

> Los modelos detallados `ImplantSurgicalRecord`, `ImplantHealingPhase`, `ImplantSecondStageSurgery`, `ImplantProstheticPhase`, `ImplantComplication`, `ImplantFollowUp`, `ImplantConsent`, `ImplantPassport` están especificados en el SPEC original con todos sus campos. Mantener exactamente la estructura definida en el chat de generación.

### 4.3 Modelos v1.1 (3, documentados pero no implementados en MVP)

`ImplantSurgicalPlan` (planeación pre-CBCT estructurada), `BoneAugmentation` (aumento óseo con biomateriales y lotes — campo `graftLot` obligatorio por trazabilidad), `ImplantPrescription` (recetas implantológicas).

### 4.4 Modelo v2.0 (1)

`ImplantInventoryItem` (stock con caducidad — solo documentado, NO migrado en este branch).

### 4.5 Relaciones inversas a agregar a modelos existentes

`Patient`, `Clinic`, `User`, `PatientFile` requieren relaciones inversas. Detalle completo en sección original.

### 4.6 Migración SQL adicional

Constraints CHECK para rangos de torque/ISQ/diámetro/longitud, integridad de remoción (status REMOVED requiere `removedAt` + `removalReason ≥20 chars`), trigger `protect_implant_traceability` que valida flag de sesión `app.implant_mutation_justified` antes de permitir UPDATE en campos COFEPRIS, trigger `block_implant_delete` que bloquea DELETE a nivel DB, índice `idx_implant_brand_lot` para queries de recall, RLS policies multi-tenant en los 9 modelos MVP.

---

## 5. Server Actions (16) + Helpers

Las 16 actions están listadas en el SPEC original con su propósito:
1. `createImplant`, 2. `updateImplantTraceability`, 3. `removeImplant`, 4. `createSurgicalRecord`,
5. `updateImplantStatus`, 6. `createHealingPhase`, 7. `createSecondStageSurgery`, 8. `createProstheticPhase`,
9. `createComplication`, 10. `createFollowUp`, 11. `createImplantConsent`, 12. `generateImplantPassport`,
13. `exportSurgicalReportPdf`, 14. `exportImplantPlanPdf`, 15. `createPeriImplantAssessment` (STUB), 16. `enableQrPublicAccess`.

### Críticas con detalle

`updateImplantTraceability` activa `SET LOCAL app.implant_mutation_justified = 'true'` en la transacción antes del UPDATE, valida justificación ≥20 chars, registra audit log con acción `COFEPRIS_TRACEABILITY_UPDATE` incluyendo before/after/justificación.

`removeImplant` cambia `currentStatus → REMOVED` con `removalReason ≥20 chars` y `removedAt`, NUNCA usa `prisma.delete()`. Audit log con acción `REMOVE`.

`createPeriImplantAssessment` es STUB que retorna `{ ok: true, data: { stub: true } }` con TODO documentado. Se elimina y reimplementa al integrar con módulo Periodoncia.

`updateImplantStatus` valida transiciones contra `status-machine.ts`. Para `REMOVED` redirige a `removeImplant` (no permite el cambio directo).

### Helpers

`status-machine.ts` con 10 transiciones válidas (REMOVED es estado terminal).
`albrektsson-success.ts` evalúa pérdida ósea esperable: 1.5mm año 1, luego <0.2mm/año.
`isq-thresholds.ts` umbrales ITI: ≥70 apto carga, 60-69 zona límite, <60 NO cargar.
`lekholm-zarb.ts` info clínica D1-D4 con protocolo de fresado y torque esperado.
`implant-helpers.ts` mapping de status a hito activo del timeline.

---

## 6. Componentes UI

### 6.1 Árbol de componentes

```
ImplantsTab (page.tsx)
├── ImplantsSubTabs                                ← Implantes | Cirugías y aumentos | Mantenimiento
│   ├── ImplantsListTab                            ← núcleo del módulo
│   │   ├── ImplantsListHeader                     ← contador, factores de riesgo, botón "+ Nuevo"
│   │   ├── CompactImplantList                     ← cuando paciente tiene 8+ implantes
│   │   └── ImplantCard (×N)                       ← tarjeta-timeline horizontal (núcleo)
│   │       ├── ImplantHeader                      ← FDI grande + ilustración + badge estado
│   │       ├── ImplantTimeline                    ← 5-6 hitos clicables
│   │       │   └── TimelineMilestone (×6)         ← cada hito con icono + estado + fecha
│   │       ├── ImplantSidePanel                   ← marca/modelo/diámetro/longitud/lote/torque/ISQ
│   │       └── ImplantActions                     ← acciones rápidas footer
│   ├── SurgeriesTab                               ← timeline cronológico de procedimientos
│   └── MaintenanceTab                             ← tabla de visitas + STUB perio si activo
│
├── Wizards (modales overlay)
│   ├── PlanningWizard                             ← v1.1, 4 pasos
│   ├── SurgeryWizard                              ← 3 pasos al cierre de cirugía
│   └── ProstheticWizard                           ← 3 pasos
│
├── Drawers (slide derecho)
│   ├── MaintenanceDrawer                          ← sondaje rápido + radiografía
│   ├── ComplicationDrawer
│   └── SecondStageDrawer
│
└── Modals (full-screen / overlay)
    ├── SurgeryConsentModal                        ← reuso SignaturePad de pediatría
    ├── BrandUpdateJustificationModal              ← caso especial COFEPRIS
    ├── RemoveImplantModal                         ← motivo ≥20 chars
    └── ImplantPassportPreviewModal                ← preview del PDF carnet
```

### 6.2 `ImplantCard` — tarjeta-timeline horizontal (núcleo)

Responsabilidades: header con FDI grande + ilustración + badge estado coloreado, timeline horizontal de 5-6 hitos clicables, panel lateral derecho con datos técnicos en tipografía monoespaciada, footer con acciones rápidas, expandir/colapsar al click. En vista compacta solo muestra header. Borde de la tarjeta coloreado según `currentStatus`: azul (PLACED/OSSEOINTEGRATING/UNCOVERED), verde (LOADED_DEFINITIVE/FUNCTIONAL), amarillo (LOADED_PROVISIONAL), naranja (COMPLICATION), rojo (FAILED/REMOVED).

Por defecto expandido si: es el implante más reciente del paciente, O tiene complicación activa.

### 6.3 `ImplantTimeline` — los 6 hitos

Los hitos son: PLANNING, SURGERY, OSSEOINTEGRATION, SECOND_STAGE (skipped si protocolo 1 fase), PROSTHETIC, MAINTENANCE.

Cada hito tiene 5 estados: `completed` (verde), `active` (azul pulsante), `future` (gris), `skipped` (gris muy tenue), `failed` (rojo).

Si está en OSSEOINTEGRATING, muestra countdown debajo del timeline: "Semana X / Y — quedan ~Z sem · ISQ último: N".

Si fracasó/removido, marca el hito activo como `failed` (rojo).

### 6.4 `TimelineMilestone` — cada hito clicable

Botón circular de 40px con icono + ring de color según estado. Click expande popover con detalle clínico de la fase. Animación `ping` cuando está active. Debajo del círculo: label + fecha + summary breve.

### 6.5 `ImplantHeader`

FDI grande (14×14) en mono, icono Anchor en círculo azul, marca + modelo + badge de estado coloreado, línea secundaria con dimensiones + lote + fecha de colocación, botón colapsar/expandir.

Badges por estado con colores específicos definidos en sección original.

### 6.6 `ImplantSidePanel`

3-4 secciones: "Implante (COFEPRIS)" con marca/modelo/⌀/longitud/conexión/superficie/lote/caducidad; "Cirugía" con fecha/torque/ISQ/densidad/protocolo; "Osteointegración" si aplica con ISQ último/medido; "Prótesis" si finalizada con pilar/lote pilar/torque pilar/tipo prótesis/material/lab. Lotes se destacan en color amber para visibilidad COFEPRIS.

Footer con "En función desde hace X días".

### 6.7 `ImplantActions`

Botones de acción rápida: Radiografías, Consentimiento, Carnet PDF (deshabilitado si aún no hay fase protésica), Registrar complicación (tono warning naranja), Mantenimiento, Modificar trazabilidad (tono caution amber con hint COFEPRIS), Remover implante (tono caution).

### 6.8 `CompactImplantList`

Para 8+ implantes: vista de lista con expansión on-demand de uno a la vez. Banner "X implantes registrados — vista compacta". Cada `CompactRow` muestra FDI + marca + modelo + dimensiones + badge de estado.

### 6.9 `SurgeryWizard` — 3 pasos al cierre

**Step 1 SurgicalData:** ASA, antibiótico profiláctico (toggle + tipo), torque inserción, ISQ MD + VL, densidad ósea Lekholm-Zarb (D1-D4 con descripciones inline desde `LEKHOLM_ZARB_INFO`), tipo de colgajo, protocolo de fresado.

**Step 2 Components:** pilar de cicatrización (toggle + diámetro + altura + LOTE obligatorio), material de sutura, fecha programada de retiro.

**Step 3 IntraoperativePhoto:** upload opcional de foto intraoperatoria (PatientFile con FileCategory: PHOTO_INTRAORAL), instrucciones post-op dadas, duración total.

### 6.10 `ProstheticWizard` — 3 pasos

**Step 1 Abutment:** tipo de pilar, marca, lote (CRÍTICO COFEPRIS), dimensiones, angulación.
**Step 2 Prosthesis:** tipo, material, laboratorio, lote del lab, esquema de oclusión.
**Step 3 TorqueAndDelivery:** torque pilar, lote tornillo, torque tornillo, fecha de entrega, carga inmediata (toggle).

> **Importante:** al finalizar exitosamente el `ProstheticWizard`, la action `createProstheticPhase` también dispara `generateImplantPassport` automáticamente (transacción única). El paciente puede descargar el carnet desde la `ImplantActions` inmediatamente.

### 6.11 `MaintenanceDrawer`

Sondaje rápido (BoP+, PD máx, supuración, movilidad, oclusión estable), upload de radiografía, pérdida ósea acumulada con hint Albrektsson, notas, próximo control.

Si BoP+ o supuración → al guardar también invoca STUB `createPeriImplantAssessment`. Banner azul informativo: "Hallazgos sugieren mucositis o peri-implantitis. Al guardar se crea registro en módulo Periodoncia."

### 6.12 `ComplicationDrawer`

Selector agrupado por categoría: Biológicas (mucositis, peri-implantitis inicial/moderada/avanzada), Mecánicas (aflojamiento tornillo, fractura tornillo/prótesis/implante), Quirúrgicas (parestesia transitoria/permanente, perforación seno, infección seno), Otras (fracaso osteointegración, complicación estética, otro).

Severidad: leve / moderada / severa.

Si tipo es biológico, muestra campos adicionales: BoP, PD máx, supuración, pérdida ósea radiográfica.

Al guardar cambia `currentStatus → COMPLICATION`.

### 6.13 `BrandUpdateJustificationModal`

Selector de campo (lotNumber, brand, placedAt), valor actual mostrado en gris, input nuevo valor, textarea de justificación con contador en vivo (rojo <20, verde ≥20).

Banner amber: "los campos son inmutables por defecto (COFEPRIS clase III). Esta modificación quedará en audit log con tu cédula, fecha exacta, valor anterior, nuevo y justificación."

### 6.14 `RemoveImplantModal`

Banner rojo: "el implante NO se borra. Cambia su estado a REMOVED y queda en historial. Trazabilidad COFEPRIS se preserva."

Textarea de motivo con contador ≥20 chars.

### 6.15 Sub-tab `Cirugías y aumentos`

Timeline cronológico de procedimientos quirúrgicos: cirugías de colocación (vinculadas al implante), descubrimientos 2ª fase, aumentos óseos (v1.1 con biomateriales y lotes), remociones de implantes. Cada evento clicable abre `SurgeryDetailDrawer`.

### 6.16 Sub-tab `Mantenimiento`

Tabla cronológica de visitas con: fecha, hito, implante (FDI), BoP, PD máx, pérdida ósea, criterios Albrektsson (✓/✗), próximo control.

`BoneLossTrendChart` arriba (recharts LineChart) con línea horizontal de Albrektsson como umbral.

Si Periodoncia NO activo: banner persistente `PeriImplantStubBanner` "Para sondaje detallado activa el módulo Periodoncia."

### 6.17 Página dedicada `/dashboard/specialties/implants`

`OverdueFollowUpsWidget`: tabla filtrable por hito (6m/12m/24m/5y), columnas paciente + implante + días vencido + teléfono + acciones rápidas (Llamar + WhatsApp con plantilla pre-cargada).

`ActiveComplicationsWidget`: tabla con paciente + implante + tipo de complicación + severidad + días desde detección + doctor que detectó. Click → tab Implantología del paciente con implante destacado.

> Inventario y dashboard de tasa de éxito → v2.0. Stubs visibles con CTA "Disponible en próxima versión".

---

## 7. Flujos UX

### 7.1 Paciente nuevo — colocación de un implante (Roberto Méndez)

1. Doctor abre Roberto → tab "Implantología" → vista vacía con CTA "+ Nuevo implante".
2. Modal `ImplantBasicDataForm` (NO wizard largo en MVP — la planeación CBCT es v1.1): FDI, marca + modelo + diámetro + longitud + lote + caducidad, conexión, superficie, protocolo, fecha programada.
3. Guarda → crea `Implant` con `currentStatus = PLANNED`.
4. "Firmar consentimiento" abre `SurgeryConsentModal` full-screen con texto de §10.4. SignaturePad de pediatría.
5. Día de cirugía: doctor opera. Después abre el implante → "Cerrar cirugía" → `SurgeryWizard` 3 pasos.
6. Al completar wizard: crea `ImplantSurgicalRecord`, status → `OSSEOINTEGRATING` (si protocolo 1 fase + healing abutment), crea `ImplantHealingPhase` con `expectedDurationWeeks` por densidad (D1=10, D2=8, D3=12, D4=24), encola WhatsApp día 1, día 7, mid-osteointegración 6 semanas.
7. Tarjeta muestra "Cirugía" verde + "Osteointegración" azul activo con countdown.
8. 8 semanas después: doctor mide ISQ con Osstell, captura en `ImplantHealingPhase.isqLatest`. Sistema evalúa con `evaluateIsqForLoading(78, 76)` → `canLoad: true`.
9. "Iniciar fase protésica" → toma de impresión. Cuando lab entrega (10 sem): `ProstheticWizard` 3 pasos.
10. Al completar: crea `ImplantProstheticPhase`, status → `LOADED_DEFINITIVE`, **genera `ImplantPassport` (PDF) automáticamente**, encola control 6m + WhatsApp post-carga.
11. Tarjeta completa: 5 hitos verdes + "Mantenimiento" azul activo.

### 7.2 All-on-4 — María Salazar (rehabilitación maxilar superior)

CBCT con maxilar atrófico clase IV. Doctor crea **4 `Implant` records** desde el form básico: 12 y 22 axiales (3.75×13mm, lote N98765432); 14 y 24 inclinados 30° (4.0×15mm, lote N98765431).

Cirugía única 180 min. `SurgeryWizard` ejecutado 4 veces al cierre con datos prellenados.

Carga inmediata: `ProstheticWizard` 4 veces con `prosthesisType: ALL_ON_4`, `immediateLoading: true`, `provisionalDeliveredAt` <24h después, `prosthesisMaterial: ACRYLIC_PROVISIONAL`.

A los 4 meses: prótesis definitiva. Re-ejecuta `ProstheticWizard` con `definitiveDeliveredAt` y material `HYBRID_TITANIUM_ACRYLIC`. Carnets de los 4 implantes generados agrupados.

### 7.3 Complicación a 3 años — Carlos Vega (peri-implantitis en 26)

Carlos llega con queja "mal sabor + sangrado en zona 26".

Doctor abre tab Implantología → encuentra implante 26 (BioHorizons Tapered Internal 4.0×11.5mm, hace 3 años).

"+ Registrar complicación" → `ComplicationDrawer`: tipo `PERI_IMPLANTITIS_MODERATE`, severidad moderada, BoP+, PD máx 7mm DV, supuración leve, pérdida ósea 3mm.

Al guardar: crea `ImplantComplication`, status → `COMPLICATION`, borde de tarjeta naranja, hito Mantenimiento naranja.

Si Periodoncia activo: también crea `PeriImplantAssessment`. Si no: solo `ImplantComplication`.

6 semanas después: si persiste, cirugía regenerativa periimplantaria (flujo v1.1 con `BoneAugmentation`).

Si exitosa: doctor cambia status `COMPLICATION → FUNCTIONAL`. La complicación queda con `resolvedAt` y `outcome: 'exitoso'`.

### 7.4 Segunda fase quirúrgica (protocolo 2 fases)

Implante en `OSSEOINTEGRATING` con `protocol: TWO_STAGE`. A las 12 semanas el hito "2ª cirugía" aparece azul pulsante.

Click → `SecondStageDrawer`: fecha, técnica (punzonado/incisión crestal/tejido conectivo), pilar de cicatrización (diámetro/altura/**lote** obligatorio), ISQ al descubrimiento, duración.

Al guardar: crea `ImplantSecondStageSurgery`, status → `UNCOVERED`, encola WhatsApp "Próxima cita: toma de impresión en 2 semanas".

### 7.5 Modificar trazabilidad COFEPRIS (excepcional)

Doctor descubre lote incorrecto. Click "Modificar trazabilidad" → `BrandUpdateJustificationModal`: selecciona campo `lotNumber`, valor actual mostrado, nuevo valor, justificación ≥20 chars con contador.

Confirma → `updateImplantTraceability`: activa `SET LOCAL app.implant_mutation_justified = 'true'`, hace UPDATE, registra `AuditLog` con acción `COFEPRIS_TRACEABILITY_UPDATE`, before/after, justificación, doctor + cédula + timestamp.

Toast: "Modificación registrada en audit log COFEPRIS".

---

## 8. Integraciones con módulos existentes

### 8.1 Appointments — 9 duraciones sugeridas

| Tipo de cita | Duración default |
|--------------|------------------|
| Consulta de planeación implantológica | 60 min |
| Cirugía de colocación 1 implante | 90 min |
| Cirugía de colocación 2-3 implantes | 120 min |
| Elevación de seno + implante | 180 min |
| All-on-4 (1 arcada) | 240 min |
| Descubrimiento 2ª fase | 45 min |
| Toma de impresión | 45 min |
| Prueba de prótesis | 30 min |
| Colocación final | 45 min |
| Mantenimiento periimplantario | 45 min |

El sistema sugiere automáticamente el tipo de cita según la fase actual del implante.

### 8.2 SOAP pre-fill por fase

S (Subjetivo): plantilla "Paciente refiere [molestia / sangrado / aflojamiento / aspecto estético / asintomático]".

O (Objetivo): pre-cargar estado de cada implante: "Implante {fdi}: {brand} {modelName}, {currentStatus}. ISQ último: {isqLatest} ({fecha}). PD máx: {pdMaxLastFollowUp} mm. Pérdida ósea radiográfica acumulada: {boneLoss} mm (Albrektsson: {ok|excedido})."

A (Análisis): "Implante {fdi} en {currentStatus}. {Albrektsson criteria summary}."

P (Plan): "{Next milestone} programado para {fecha}."

### 8.3 Plan de tratamiento general

Cada implante se inserta como ítem del plan general con sub-ítems y dependencias temporales (consulta planeación → cirugía → osteointegración 8 sem → toma impresión → prueba → colocación final → mantenimiento c/6m).

All-on-4 como ítem complejo agrupando 4 implantes con sub-ítems compartidos.

### 8.4 Odontograma general

Dientes con implante: icono distintivo de **tornillo** (NO el icono de raíz endodonciada, NO ausente). Color de fondo del diente refleja `currentStatus`: azul/amarillo/verde/naranja/rojo. Click → tab Implantología del paciente con implante seleccionado.

### 8.5 PatientFile (CBCT + radiografías + fotos + carnet)

Reuso total. NO se crea modelo `Radiography`. Cuatro puntos de integración:

1. **CBCT inicial de planeación**: `ImplantSurgicalPlan.cbctFileId` (v1.1) con `FileCategory: XRAY_CBCT`.
2. **Radiografía periapical de control**: `ImplantFollowUp.radiographFileId` con `FileCategory: XRAY_PERIAPICAL`. El análisis IA existente (`XrayAnalysis`) puede medir pérdida ósea peri-implantaria automáticamente.
3. **Foto intraoperatoria**: `ImplantSurgicalRecord.intraoperativePhotoFileId` con `FileCategory: PHOTO_INTRAORAL`.
4. **Foto del paciente para el carnet**: `ImplantPassport.patientPhotoFileId` con `FileCategory: PHOTO_PATIENT`.

`RadiographicSeriesView` agrega radiografías 0/6m/12m/24m/5y en grid horizontal con leyenda "pérdida ósea acumulada".

### 8.6 Recetas NOM-024 — 4 plantillas

**Plantilla 1: Profilaxis pre-cirugía estándar**
Amoxicilina 2 g VO. Tomar 1 hora antes de la cirugía. Dosis única.
Instrucciones pre-op: no comer ni beber 2 h previas, traer acompañante adulto, cepillar y enjuagar con clorhexidina antes de salir.

**Plantilla 2: Post-cirugía estándar**
Amoxicilina 875 mg + Ácido clavulánico 125 mg cada 12 h por 7 días con alimentos. Ibuprofeno 600 mg cada 8 h por 3 días con alimentos. Clorhexidina 0.12% colutorio 15 ml cada 12 h por 14 días iniciando a las 24 h.
Cuidados: frío 15 min cada hora primeras 24 h. Dieta blanda y fría 3 días. NO escupir, NO fumar, NO pajillas 7 días. NO ejercicio 5 días. Cita retiro de suturas en {date}.

**Plantilla 3: Post-elevación de seno** = Plantilla 2 + Oximetazolina 0.05% spray nasal 2 nebulizaciones cada 12 h por 5 días. NO sonarse 2 sem, estornudar con boca abierta, evitar cambios de presión 2 sem. Si hemorragia nasal abundante o burbujas en zona: contactar de inmediato.

**Plantilla 4: Pacientes alérgicos a penicilina**
Clindamicina 600 mg profilaxis 1 h pre-op dosis única. Clindamicina 300 mg cada 8 h por 7 días post-op con vaso lleno de agua. Suspender si diarrea severa y contactar.

Todas las plantillas con encabezado NOM-024-SSA3-2012, datos del paciente con CURP, fecha, cédula del doctor, firma.

### 8.7 Recordatorios WhatsApp — 6 templates

**PRE_SURGERY_24H**: "Hola {patient}, te recordamos tu cirugía mañana a las {time}. Recuerda: toma tu antibiótico (amoxicilina 2g) 1 h antes. NO comas ni bebas 2 h previas. Cepilla y enjuaga con clorhexidina. Trae acompañante adulto."

**POST_SURGERY_DAY_0**: "Tu cirugía terminó. Aplica frío 15 min cada hora primeras 24 h. Antibiótico cada 12 h por 7 días sin saltarte dosis. Antiinflamatorio cada 8 h por 3 días. Inicia mañana clorhexidina cada 12 h por 14 días. NO escupir, NO fumar, NO pajillas 7 días. Dieta blanda y fría hoy y mañana. Si dolor intenso, sangrado abundante, fiebre: contáctanos."

**POST_SURGERY_DAY_7**: "Recordatorio retiro de suturas mañana a las {time}. Continúa clorhexidina hasta 14 días. Higiene cuidadosa sin tocar suturas. Evita alimentos duros."

**MID_OSSEOINTEGRATION** (6-8 sem): "¿Cómo va tu cicatrización? Tu implante está en osteointegración. Faltan ~{weeks} semanas para iniciar tu prótesis. Mantén excelente higiene. Si notas movilidad, dolor o aspecto extraño en encía: avísanos."

**PROSTHETIC_PHASE_START**: "Tu implante ya cicatrizó correctamente. Es momento de iniciar la corona definitiva. Te agendaremos la toma de impresión."

**POST_LOAD_FOLLOWUP_OVERDUE**: "Tu control de {milestone} está atrasado por {N} mes(es). Aunque no sientas molestias, este control es OBLIGATORIO para verificar la salud de tu implante (revisión clínica + radiografía). Te ofrezco estos horarios: {slots}."

### 8.8 Audit log

Cada mutación clínica registra en `AuditLog` con `userId`, `clinicId`, `entity`, `entityId`, `action`, `before`, `after`, `meta`.

Acciones especiales del módulo:
- `COFEPRIS_TRACEABILITY_UPDATE`: incluye `field`, `previousValue`, `newValue`, `justification`.
- `STATUS_CHANGE`: incluye `from`, `to`, `reason`.
- `REMOVE`: incluye `removalReason`.
- `PASSPORT_GENERATED`: cuando se crea el carnet PDF.
- `QR_PUBLIC_ENABLED`: con consentimiento explícito documentado.

> **Para defensa legal en caso de recall del fabricante o inspección COFEPRIS:** la query `SELECT * FROM "AuditLog" WHERE entity='Implant' AND meta->>'cofeprisTraceability' IS NOT NULL` devuelve la cadena completa de trazabilidad de cualquier implante.

---

## 9. Reportes / Exportes PDF

### 9.1 PDF "Plan implantológico al paciente" (pre-cirugía)

A4 vertical, 3-4 páginas. Lenguaje accesible.
1. Datos del paciente, fecha, doctor responsable + odontograma con implante destacado + diagnóstico en lenguaje accesible.
2. ¿Qué es un implante dental? + cronograma estimado.
3. Costos por fase con totales + IVA + métodos de pago.
4. Riesgos y consideraciones (versión accesible) + plan de mantenimiento de por vida.

### 9.2 PDF "Reporte quirúrgico" (post-cirugía, expediente legal)

A4 vertical. Lenguaje médico. **El PDF más sensible legalmente** — principal evidencia en disputas por mala praxis.

Contiene: encabezado con membretado y cédula del cirujano, datos del paciente con ASA y antecedentes relevantes, referencia al consentimiento firmado (`consentSignedFileId`), profilaxis antibiótica, datos quirúrgicos completos (FDI, marca/modelo/diámetro/longitud/lote/manufactura/caducidad, técnica, hueso receptor con Lekholm-Zarb, estabilidad primaria torque/ISQ, componentes inmediatos con lote, sutura), complicaciones intraoperatorias, tiempo total, instrucciones post-op, firma del cirujano + cédula.

### 9.3 PDF "Carnet del implante" — formato licencia horizontal landscape

**La pieza diferenciadora del módulo.** Generación automática al finalizar fase protésica. Formato licencia horizontal 85mm × 54mm.

Contiene: foto del paciente, nombre completo, fecha de nacimiento, datos del implante (marca/modelo/⌀/longitud/lote/colocado), datos prótesis (tipo/material/lab/lote prótesis/lote pilar/entrega), doctor + cédula + clínica + teléfono, código QR opt-in.

> **QR público es opt-in.** Sin opt-in, no aparece en el PDF. Con opt-in (consentimiento separado tipo `QR_PUBLIC`), enlaza a vista pública con datos no identificables del implante para emergencias médicas.

### 9.4 Regeneración del carnet

Cualquier mutación posterior a `ImplantProstheticPhase` actualiza `regeneratedAt` y dispara nueva generación. El carnet anterior queda en historial dentro de `PatientFile`.

---

## 10. Compliance NOM-024 / COFEPRIS clase III / LFPDPPP

### 10.1 NOM-024-SSA3-2012

- Conservación 10 años mínimo (recomendación interna superior a los 5 que exige la NOM, dada la naturaleza largo plazo del implante). NUNCA hard delete del modelo `Implant`.
- Audit log obligatorio con `before`/`after` en toda mutación.
- Identificación del responsable: cada mutación apunta a User con cédula consultable.
- Receta NOM-024: las 4 plantillas cumplen formato.

### 10.2 COFEPRIS clase III — el más estricto

Los implantes son dispositivos clase III. Trazabilidad por lote es legalmente exigible:

- **Recall**: query estándar identifica afectados:

  ```sql
  SELECT p.name, p.phone, i."toothFdi", i."placedAt", i."currentStatus"
  FROM "Implant" i
  JOIN "Patient" p ON p.id = i."patientId"
  WHERE i."brand" = 'STRAUMANN'
    AND i."lotNumber" = 'A12345678'
    AND i."clinicId" = current_setting('app.current_clinic_id');
  ```

  Respaldada por índice `idx_implant_brand_lot`.

- **Inmutabilidad**: campos `brand`, `lotNumber`, `placedAt` requieren para modificación: justificación ≥20 chars, flag de sesión `app.implant_mutation_justified = 'true'`, trigger SQL valida flag, audit log con `COFEPRIS_TRACEABILITY_UPDATE`.

- **DELETE prohibido a nivel DB**: trigger `block_implant_delete`. "Remover" = `currentStatus = REMOVED` con `removalReason ≥20 chars`.

### 10.3 LFPDPPP

- CBCT y radiografías son datos sensibles. RLS multi-tenant.
- QR público opt-in con consentimiento separado (`ImplantConsent.consentType = 'QR_PUBLIC'`).
- Aviso de privacidad reforzado al iniciar tratamiento implantológico.
- Derecho al olvido: datos personales identificables eliminables; datos clínicos (lote + fecha + doctor) se conservan 10 años por trazabilidad COFEPRIS pero desvinculables del paciente.

### 10.4 Texto consentimiento informado quirúrgico (`SURGERY_CONSENT_TEXT`)

Texto completo en `src/lib/implants/consent-texts.ts` con secciones:
1. EN QUÉ CONSISTE EL TRATAMIENTO (descripción técnica accesible)
2. POR QUÉ SE ME REALIZA (indicación específica)
3. ALTERNATIVAS (puente fijo / removible / no tratamiento)
4. RIESGOS Y POSIBLES COMPLICACIONES (quirúrgicos, específicos del implante: parestesia, perforación seno, fracaso 5-10%, fractura, complicaciones biológicas y mecánicas)
5. FACTORES QUE AUMENTAN MIS RIESGOS PERSONALES (tabaquismo, diabetes, bifosfonatos, radioterapia)
6. COSTOS (total + distribuido por fases)
7. PLAN DE MANTENIMIENTO DE POR VIDA (higiene + mantenimiento profesional cada 6 meses + control radiográfico 6/12/24m)
8. LO QUE NO SE GARANTIZA (tasa éxito 90-95% a 10 años)

Firmas: paciente + doctor con cédula. Si menor o representación legal: padre/madre/tutor.

### 10.5 Texto consentimiento aumento óseo (v1.1)

`BONE_AUGMENTATION_CONSENT_TEXT(graftSource)` con descripción específica por origen del biomaterial:
- Autólogo: hueso propio.
- Aloinjerto humano: banco de tejidos certificado.
- Xenoinjerto bovino: típicamente Bio-Oss, >30 años respaldo clínico.
- Xenoinjerto porcino: alerta para creencias religiosas.
- Sintéticos (vidrio bioactivo, hidroxiapatita, TCP): 100% sintético.

Riesgos específicos: reabsorción parcial 20%, fracaso 5-15%, exposición de membrana, reacción a biomateriales.

Consideraciones religiosas/éticas: documentar discusión con paciente.

### 10.6 Pacientes con bifosfonatos

Si `Patient.medicationHistory` incluye bifosfonatos:
1. Banner persistente "Riesgo MRONJ documentado — coordina con médico tratante antes de cirugía."
2. Bloquea "+ Nuevo implante" hasta confirmar opción: coordinación completa con suspensión documentada O riesgo evaluado y aceptado con cláusula MRONJ extendida.
3. `ImplantConsent.acceptedRisks.mronj = true`.

### 10.7 Pacientes diabéticos

Banner "Verifica HbA1c <7% para cirugía electiva." Wizard cirugía: campo HbA1c reciente obligatorio. Si ≥7%: warning suave "Considera coordinación con endocrinólogo. Documenta decisión clínica."

---

## 11. Estados visuales

| Estado | Visual |
|--------|--------|
| Vacío | Onboarding centrado + CTA "Planear primer implante" |
| Planeado no colocado | Timeline gris excepto Planeación azul activo, borde amarillo |
| En cicatrización post-cirugía | Borde azul, countdown "Sem X / Y", ISQ baseline |
| Listo para fase protésica | ISQ ≥70, banner verde claro "Listo para iniciar prótesis" |
| En función exitoso | Borde verde, métricas Albrektsson visibles |
| Complicación activa | Borde naranja, banner "Peri-implantitis moderada {date}" |
| Fracaso/removido | Tarjeta archivada gris, motivo visible, consultable por trazabilidad |
| Rehabilitación 8+ implantes | `CompactImplantList` activo, banner azul "X implantes — vista compacta" |
| Lote en recall (v2.0) | Banner rojo "ALERTA: lote {N} en recall del fabricante" |
| Mantenimiento vencido | Banner naranja "Control {milestone} atrasado por {N} meses" |

### Codificación cromática consolidada

| Token | Hex | Uso |
|-------|-----|-----|
| Azul cicatrizando | `#3B82F6` | PLACED, OSSEOINTEGRATING, UNCOVERED |
| Verde sano | `#22C55E` | LOADED_DEFINITIVE, FUNCTIONAL (Albrektsson cumplido) |
| Amarillo control próximo | `#EAB308` | LOADED_PROVISIONAL, follow-up 4 semanas |
| Naranja complicación | `#F97316` | COMPLICATION (mucositis, peri-implantitis inicial/moderada, mecánica leve) |
| Rojo severa/fracaso | `#EF4444` | FAILED, REMOVED, peri-implantitis avanzada, fractura |
| Gris archivado | `#3F3F46` | REMOVED en historial colapsado |

---

## 12. Mock data — 3 pacientes (`prisma/seeds/implants-mock.ts`)

### 12.1 Paciente 1 — Roberto Méndez Aguilar (58, Straumann BLX en 36)

```ts
patient: {
  id: 'pat_imp_roberto', name: 'Roberto Méndez Aguilar',
  birthDate: '1967-03-12', gender: 'M', phone: '+529991234567',
  fileNumber: 'EXP-2024-1015',
  medicalConditions: ['Hipertensión controlada con losartán'],
  smokingHistory: { status: 'EX_SMOKER', quitYear: 2019, packYears: 20 },
  asaClassification: 'ASA_II',
}
implant: {
  id: 'imp_roberto_36', toothFdi: 36,
  brand: 'STRAUMANN', modelName: 'BLX',
  diameterMm: 4.5, lengthMm: 10.0,
  connectionType: 'CONICAL_MORSE', surfaceTreatment: 'SLActive',
  lotNumber: 'A12345678',
  manufactureDate: '2023-03-01', expiryDate: '2028-03-01',
  placedAt: '2024-10-15T09:00:00Z',
  protocol: 'ONE_STAGE',
  currentStatus: 'FUNCTIONAL',
}
surgicalRecord: {
  insertionTorqueNcm: 38,
  isqMesiodistal: 74, isqVestibulolingual: 72,
  boneDensity: 'D2',
  ridgeWidthMm: 7.0, ridgeHeightMm: 11.0,
  flapType: 'Crestal con liberación distal',
  drillingProtocol: 'Estándar D2',
  healingAbutmentLot: 'HA-22334-R',
  sutureMaterial: 'Monofilamento nylon 4-0',
  durationMinutes: 65,
}
healingPhase: {
  startedAt: '2024-10-15', expectedDurationWeeks: 8,
  isqAt4Weeks: 75, isqAt8Weeks: 78,
  completedAt: '2024-12-10',
}
prostheticPhase: {
  abutmentType: 'PREFABRICATED_TI', abutmentLot: 'SP-87654',
  abutmentTorqueNcm: 35,
  prosthesisType: 'SCREW_RETAINED_SINGLE',
  prosthesisMaterial: 'ZIRCONIA_MONOLITHIC',
  prosthesisLabName: 'Zarate Lab',
  prosthesisLabLot: '8X-2024-0815',
  prosthesisDeliveredAt: '2024-12-24',
  occlusionScheme: 'función de grupo',
}
followUps: [
  { milestone: 'M_1_WEEK',    performedAt: '2024-10-22' },
  { milestone: 'M_1_MONTH',   performedAt: '2024-11-15' },
  { milestone: 'M_3_MONTHS',  performedAt: '2025-01-15', radiographicBoneLossMm: 0.4, meetsAlbrektssonCriteria: true },
  { milestone: 'M_6_MONTHS',  performedAt: '2025-06-15', radiographicBoneLossMm: 0.5, meetsAlbrektssonCriteria: true },
  { milestone: 'M_12_MONTHS', scheduledAt: '2025-12-15', performedAt: null },
  { milestone: 'M_24_MONTHS', scheduledAt: '2026-12-15', performedAt: null },
]
```

### 12.2 Paciente 2 — María Salazar Ortiz (62, All-on-4 superior con Neodent)

Edéntula superior, diabetes tipo 2 HbA1c 6.8%, ex-fumadora 2017.

4 implantes Neodent Drive CM:
- 12 y 22 axiales 3.75×13mm, lote N98765432, torques 42 y 40 Ncm.
- 14 y 24 inclinados 30° 4.0×15mm, lote N98765431, torques 45 y 38 Ncm.

Todos `protocol: IMMEDIATE_PLACEMENT_IMMEDIATE_LOADING`, `currentStatus: LOADED_DEFINITIVE`. Densidad ósea D3.

ProstheticPhase:
- Provisional acrílica entregada en 24h: `ACRYLIC_PROVISIONAL`, `immediateLoading: true`, `provisionalDeliveredAt: 2024-11-26`.
- Definitiva titanio-acrílico a 4 meses: `HYBRID_TITANIUM_ACRYLIC`, `definitiveDeliveredAt: 2025-03-25`.

### 12.3 Paciente 3 — Carlos Vega Ruiz (45, peri-implantitis a 3 años en 26)

Ex-fumador 2024 reanudó (5 cig/día). Implante BioHorizons Tapered Internal 4.0×11.5mm lote BH-77665544, colocado 2022-05-10, protocolo TWO_STAGE.

`currentStatus: COMPLICATION`.

ImplantComplication:
```ts
{
  detectedAt: '2025-04-15',
  type: 'PERI_IMPLANTITIS_MODERATE', severity: 'moderada',
  description: 'PD 7mm DV (vs 3mm previo), BoP+ en 4 sitios, supuración leve, pérdida ósea 3mm. Higiene irregular y reanudación de tabaquismo hace 1 año.',
  bopAtDiagnosis: true,
  pdMaxAtDiagnosisMm: 7,
  suppurationAtDiagnosis: true,
  radiographicBoneLossMm: 3.0,
  treatmentPlan: 'Fase 1 no quirúrgica: descontaminación cepillos titanio + clorhexidina + láser Er:YAG. Antibiótico amoxicilina 875+125 cada 12h por 7 días. Reevaluación 6 sem.',
}
```

BoneAugmentation original (v1.1): elevación de seno con Bio-Oss lote XO87654321 + membrana Bio-Gide lote BG-44556677.

FollowUps con pérdida ósea progresiva: 6m=0.3mm, 12m=0.6mm, 24m=1.2mm (límite Albrektsson), unscheduled abr 2025=3.0mm (NO cumple criterios — peri-implantitis activa).

---

## 13. Testing

### 13.1 Tests unitarios

`status-machine.test.ts`: 10 transiciones válidas, REMOVED estado terminal, FUNCTIONAL no regresa a PLANNED.

`albrektsson-success.test.ts`: pérdida 0.4mm a 6m cumple, 1.5mm año 1 cumple (límite), 2.0mm año 1 NO cumple, año 3 expectedMaxBoneLoss = 1.5 + 2*0.2 = 1.9mm.

`isq-thresholds.test.ts`: ISQ 74/72 → canLoad true; ISQ 68/72 → false (mín <70); ISQ 50 → false.

### 13.2 Tests de integración (Playwright)

- Crear implante con datos COFEPRIS completos.
- Modificar lote requiere justificación ≥20 chars (con contador en vivo).
- DELETE en Implant rechazado por trigger SQL.
- removeImplant con motivo ≥20 chars cambia status a REMOVED.
- SurgeryWizard 3 pasos guarda datos completos.
- Mobile = solo lectura sin botones de captura.
- Al finalizar ProstheticWizard, carnet PDF se genera automáticamente.
- STUB de createPeriImplantAssessment retorna { stub: true }.

### 13.3 Tests RLS multi-tenant

Clínica A no ve Implant de clínica B. Query de recall por lote funciona dentro del tenant.

### 13.4 Tests visuales (Storybook + Chromatic)

ImplantCard en cada estado (PLANNED, OSSEOINTEGRATING con countdown, FUNCTIONAL, COMPLICATION, REMOVED). ImplantTimeline con protocolo 1 y 2 fases. CompactImplantList con 8/12 implantes. Carnet PDF preview con/sin QR público. BrandUpdateJustificationModal con contador en 0/15/20+ chars.

### 13.5 Tests compliance COFEPRIS

Audit log de COFEPRIS_TRACEABILITY_UPDATE captura before/after/justification. Trigger SQL rechaza UPDATE sin flag de sesión. Query de recall identifica afectados <200ms con 1000 implantes.

### 13.6 Performance

ImplantCard renderiza <50ms. Query getOverdueFollowUps con 1000 follow-ups <150ms. Generación de carnet PDF <1s.

---

## 14. Roadmap

### MVP v1.0 — 6 features MUST

1. Registro completo con trazabilidad (marca/modelo/⌀/longitud/lote).
2. Cirugía de colocación con datos quirúrgicos.
3. Tracking multi-fase con timeline visual.
4. Fase protésica con trazabilidad de componentes.
5. Mantenimiento periimplantario (compartido vía STUB con Periodoncia).
6. Consentimiento informado quirúrgico.

### v1.1 (Q+1) — SHOULD

- Planeación pre-cirugía estructurada — `ImplantSurgicalPlan`.
- Aumento óseo con biomateriales y lotes — `BoneAugmentation`.
- Wizard dedicado de 2ª cirugía.
- Vinculación con CBCT y radiografías de seguimiento (con análisis IA).
- Plantillas de receta — `ImplantPrescription`.
- Integración real con `PeriImplantAssessment` (eliminar STUB).

### v2.0 — NICE

- Inventario con alertas de caducidad — `ImplantInventoryItem`.
- Dashboard tasa de éxito personal del doctor.
- Integración Osstell vía Bluetooth.
- Importar plan de coDiagnostiX/CARES Visual.
- IA predicción de éxito.
- Comparativo radiográfico con alineación.
- Vista pública del QR (acceso emergencia).

---

## 15. Casos de uso resumidos

### Caso 1 — Roberto Méndez (58, Straumann BLX en 36)

Hipertenso controlado, ex-fumador 5 años. Cirugía D2 torque 38 Ncm, ISQ 74/72. Osteointegración 8 sem confirmada ISQ 78/76. Fase protésica: pilar Ti prefabricado lote SP-87654, corona zirconia monolítica lote 8X-2024-0815, torque 35 Ncm. **Estado actual: FUNCTIONAL.**

### Caso 2 — María Salazar (62, All-on-4 superior)

Edéntula superior, diabetes controlada, ex-fumadora. Maxilar atrófico clase IV. 4 implantes Neodent Drive CM en 1 sesión: 12 y 22 axiales (lote N98765432); 14 y 24 inclinados 30° (lote N98765431). Carga inmediata provisional acrílica 24h. Definitiva titanio-acrílico a 4m. **4 carnets generados.**

### Caso 3 — Carlos Vega (45, peri-implantitis a 3 años en 26)

BioHorizons 4.0×11.5mm lote BH-77665544, colocado 2022 post-elevación de seno. Función exitosa hasta 2024. Hoy: PD 7mm, BoP+ 4 sitios, supuración leve, pérdida ósea 3mm. **Diagnóstico: peri-implantitis moderada.** Factor: tabaquismo reanudado. Tratamiento Fase 1 iniciado. `currentStatus: COMPLICATION`. **Tarjeta-timeline borde naranja, hito Mantenimiento naranja.**

---

## 16. Checklist de implementación (10 fases)

### Fase 1: Schema
- [ ] Schema Prisma con 9 modelos MVP + 12 enums.
- [ ] 3 modelos v1.1 documentados pero comentados con TODO.
- [ ] `ImplantInventoryItem` solo en comentario, NO migrado.
- [ ] Relaciones inversas en Patient, Clinic, User, PatientFile.
- [ ] Migración SQL con CHECK + triggers + RLS + índice idx_implant_brand_lot.
- [ ] `npm run prisma:migrate:deploy` en staging.

### Fase 2: Tipos + helpers
- [ ] Schemas zod, status-machine (pasa tests), albrektsson-success (pasa tests), isq-thresholds (pasa tests), lekholm-zarb, implant-helpers, whatsapp-templates (6), consent-texts.
- [ ] `IMPLANTS_MODULE_KEY = "implants"` registrado.

### Fase 3: Server actions
- [ ] 16 actions con auth + tenant + audit + revalidate.
- [ ] updateImplantTraceability activa flag de sesión + valida ≥20 chars.
- [ ] removeImplant reemplaza completamente la semántica de delete.
- [ ] createPeriImplantAssessment STUB con TODO.

### Fase 4: Componentes núcleo
- [ ] ImplantCard con expansión + borde por estado.
- [ ] ImplantHeader, ImplantTimeline (6 hitos + countdown), TimelineMilestone (5 estados), ImplantSidePanel, ImplantActions.
- [ ] CompactImplantList para 8+.

### Fase 5: Wizards, drawers, modales
- [ ] SurgeryWizard 3 pasos, ProstheticWizard 3 pasos con auto-generación carnet.
- [ ] MaintenanceDrawer con activación STUB Perio si BoP+/sup.
- [ ] ComplicationDrawer con grupos.
- [ ] SecondStageDrawer.
- [ ] BrandUpdateJustificationModal con contador.
- [ ] RemoveImplantModal con motivo ≥20.
- [ ] SurgeryConsentModal con SignaturePad.

### Fase 6: Sub-tabs + página dedicada
- [ ] ImplantsSubTabs (3 sub-tabs).
- [ ] SurgeriesTab cronológico, MaintenanceTab con BoneLossTrendChart + PeriImplantStubBanner.
- [ ] /dashboard/specialties/implants con OverdueFollowUpsWidget + ActiveComplicationsWidget.
- [ ] Anchor en sidebar grupo "Especialidades".

### Fase 7: PDFs
- [ ] implant-plan.tsx (A4 vertical), surgical-report.tsx (legal), implant-passport.tsx (licencia horizontal con auto-generación).

### Fase 8: Integraciones
- [ ] 9 duraciones cita, SOAP pre-fill, plan general con sub-ítems, badge en odontograma (icono tornillo + color status).
- [ ] 4 plantillas receta NOM-024, 6 templates WhatsApp, audit log con acciones especiales.

### Fase 9: Mock data + tests
- [ ] Seed Roberto + María (4 implantes) + Carlos.
- [ ] Tests unitarios, Playwright E2E (5 flujos), RLS, snapshots Storybook, compliance COFEPRIS, performance.

### Fase 10: QA + lanzamiento
- [ ] Validación con implantólogo real (Roberto end-to-end).
- [ ] Validación query recall <200ms.
- [ ] Validación NOM-024 + COFEPRIS interno.
- [ ] Validación LFPDPPP (consentimiento QR + revocación).
- [ ] Documentación de usuario.
- [ ] Toggle del módulo activable por clínica.
- [ ] Deploy a producción.

---

## 17. Hoja de referencia rápida

### Densidad ósea Lekholm-Zarb

| Densidad | Localización típica | Protocolo fresado | Torque esperado |
|----------|---------------------|-------------------|-----------------|
| D1 | Mandíbula anterior atrófica | Tap obligatorio | 40-60 Ncm |
| D2 | Mandíbula post., maxilar ant. | Estándar | 35-50 Ncm |
| D3 | Maxilar posterior | Subdimensionado moderado | 25-40 Ncm |
| D4 | Maxilar posterior atrófico | Subdimensionado agresivo | 20-30 Ncm |

### Umbrales ISQ (consenso ITI)

| ISQ mínimo (MD ó VL) | Decisión |
|----------------------|----------|
| ≥70 | Apto para carga |
| 60-69 | Zona límite — cicatrizar 4 sem más |
| <60 | NO cargar — riesgo de pérdida |

### Criterios Albrektsson 1986 (modificado ITI)

- Año 1: pérdida ósea aceptada hasta **1.5 mm**.
- Tras año 1: <0.2 mm/año.
- Sin movilidad clínica, dolor, parestesia, sangrado a presión sostenida, radiolucidez.

### Tiempos osteointegración por densidad

| Densidad | Mínimas | Típicas |
|----------|---------|---------|
| D1 | 8 | 10 |
| D2 | 6 | 8 |
| D3 | 10 | 12 |
| D4 | 16 | 20-24 |

### Validaciones COFEPRIS

| Campo | Validación |
|-------|------------|
| `lotNumber` | Obligatorio, length ≥1 |
| `placedAt` | Obligatorio, datetime |
| `brand` | Enum estricto |
| `brandCustomName` | Obligatorio si brand=OTRO |
| Mutación brand/lot/placedAt | Justificación ≥20 + flag sesión + audit |
| Remoción | Motivo ≥20 + currentStatus=REMOVED |
| `abutmentLot` (prótesis) | Obligatorio |
| `graftLot` (BoneAugmentation v1.1) | Obligatorio |

### Severidad de complicaciones

| Tipo | Severidad típica | Estado |
|------|------------------|--------|
| `PERI_IMPLANT_MUCOSITIS` | Leve | COMPLICATION (reversible) |
| `PERI_IMPLANTITIS_MODERATE` | Moderada | COMPLICATION (Fase 1 → posible cirugía) |
| `PERI_IMPLANTITIS_ADVANCED` | Severa | COMPLICATION (probable explantación) |
| `SCREW_LOOSENING` | Leve | COMPLICATION (mecánica fácil) |
| `IMPLANT_FRACTURE` | Severa | FAILED → REMOVED |
| `OSSEOINTEGRATION_FAILURE` | Severa | FAILED → REMOVED |
| `NERVE_DAMAGE_PERMANENT` | Severa | Implante puede continuar |
| `SINUS_PERFORATION` | Mod-severa | Resoluble misma cirugía o ORL |

### Recall por riesgo

| Perfil | Frecuencia |
|--------|------------|
| Bajo (no fumador, sin diabetes, BoP <10%) | Cada 6 meses |
| Moderado (ex-fumador, diabetes controlada) | Cada 4-6 meses |
| Alto (fumador activo, HbA1c >7%, peri-implantitis previa) | Cada 3 meses |

---

## 18. Notas finales

### Decisiones inamovibles

Las 25 decisiones bloqueadas de §1 NO se revaluan. La trazabilidad COFEPRIS es regulación legal — cualquier resistencia técnica para implementar inmutabilidad debe documentarse con `// PRECAUCIÓN COFEPRIS:` y proceder lo más cercano posible al spec sin ceder en el principio.

### Ambigüedad clínica

Si Bot Git 3 encuentra ambigüedad clínica (ej. "¿paciente con 9 implantes uno fracasado?"), implementar opción más permisiva (mostrarlos todos en CompactImplantList, fracasado con badge gris) y dejar TODO para Rafael.

### Reuso obligatorio

NO duplicar componentes existentes:
- SignaturePad (pediatría) — todos los consentimientos.
- Drawer, Modal, Section, RadioGroup, Toggle, NumberInput, Select, TextArea, DateInput, FileUpload (design system).
- recordAudit, getCurrentUser, getActiveClinicId, canAccessModule (auth/audit).
- useDebouncedCallback (hooks compartidos).
- Result<T> y isFailure (patrones).
- XrayAnalysis existente para análisis de pérdida ósea peri-implantaria.

### Mobile cap

Mobile = solo lectura. Banner explícito. Permite ver ImplantCard + carnet PDF + historial + radiografías. NO permite crear/editar, wizards, drawers de captura, modificar trazabilidad, remover.

### Persistencia wizards

Wizard a la mitad NO persiste — draft state local. Recargar pierde el progreso del wizard (no del Implant base ya guardado). Decisión simplificadora — la cirugía dura ~5 min de captura post-quirúrgica.

### Regeneración carnet

Cualquier cambio relevante (pilar/prótesis/oclusión/complicación con cambio de componente) actualiza `regeneratedAt` y dispara nueva generación. Anterior queda en `PatientFile`. Paciente puede tener múltiples carnets en historial.

### Contrato con Periodoncia

Modelo `PeriImplantAssessment` vive en Periodoncia con campos `{ implantId: String?, implantFdi, status, bop, suppuration, radiographicBoneLossMm, recommendedTreatment, evaluatedAt, evaluatedById }`.

En este branch (origen `feature/endodontics-module-v1`) ese modelo NO existe. STUB con TODO. Cuando ambos módulos se mergeen en main:
1. Eliminar el STUB.
2. Implementar versión real que crea PeriImplantAssessment.
3. Migración SQL separada para FK real `PeriImplantAssessment.implantId` → `Implant.id`.

Esta migración NO va en este branch.

---

## 19. Prompt para Bot Git 3

```
→ BOT GIT 3

Implementa el módulo Implantología (4/5) de MediFlow siguiendo el SPEC en docs/marketplace/research/implantologia/SPEC.md al pie de la letra.

CONTEXTO
- Cuarto módulo del marketplace de especialidades. Pediatría (1/5) y Endodoncia (2/5) en producción. Periodoncia (3/5) la termina Bot Git 1 en paralelo en feature/periodontics-module-v1.
- TU branch base es origin/feature/endodontics-module-v1 (NO main, NO periodontics). Worktree dedicado a Implantología — corres en paralelo a Bot Git 1.
- Stack: Next.js 14 App Router, TypeScript estricto, Tailwind dark-mode, Prisma 5.22 + Supabase, lucide-react, react-hot-toast, recharts, react-pdf. NO inventes dependencias. Usar npm (NO pnpm).

EJECUTA EN ESTE ORDEN — NO SALTES FASES

Fase 1 — Schema:
1. Agrega los 9 modelos MVP + 12 enums (sección 4).
2. Agrega 3 modelos v1.1 con TODO claro (no implementar lógica).
3. NO agregues ImplantInventoryItem (v2.0).
4. Relaciones inversas en Patient/Clinic/User/PatientFile.
5. Genera migración: `npm run prisma:migrate:dev -- --name implants_init`.
6. Aplica SQL adicional (sección 4.6): CHECK constraints, trigger protect_implant_traceability, trigger block_implant_delete, RLS, índice idx_implant_brand_lot.
7. `prisma generate`.

Fase 2 — Helpers:
1. src/lib/implants/* completo (sección 5.4).
2. status-machine, albrektsson-success, isq-thresholds pasan tests unitarios (sección 13.1).
3. IMPLANTS_MODULE_KEY = "implants" en src/lib/specialties/keys.ts.

Fase 3 — Actions:
1. 16 actions (sección 5.2).
2. updateImplantTraceability ACTIVA SET LOCAL app.implant_mutation_justified='true' antes del UPDATE + valida justificación ≥20 chars.
3. removeImplant cambia currentStatus a REMOVED — NO usa prisma.delete().
4. createPeriImplantAssessment STUB que retorna { ok: true, data: { stub: true } } con TODO documentado.
5. Cada action: auth + tenant + canAccessModule + zod + transacción + recordAudit + revalidatePath. Retorna Result<T>.

Fase 4 — Componentes núcleo:
1. ImplantCard, ImplantHeader, ImplantTimeline, TimelineMilestone, ImplantSidePanel, ImplantActions, CompactImplantList.
2. Reutiliza Drawer, Modal, RadioGroup, Toggle, etc. del design system.
3. NO USES storage del navegador — todo persiste vía server actions.
4. SurgeryWizard 3 pasos, ProstheticWizard 3 pasos. Drawers (Maintenance, Complication, SecondStage). Modales (SurgeryConsent, BrandUpdateJustification, RemoveImplant).

Fase 5 — Sub-tabs + página dedicada:
1. ImplantsSubTabs con 3 sub-tabs.
2. /dashboard/specialties/implants/page.tsx con OverdueFollowUpsWidget + ActiveComplicationsWidget.
3. Icono Anchor de lucide-react en sidebar grupo "Especialidades".

Fase 6 — PDFs:
1. surgical-report.tsx (la pieza más sensible legalmente).
2. implant-passport.tsx (licencia horizontal landscape, auto-generado al finalizar ProstheticWizard).
3. implant-plan.tsx (A4 vertical).
4. SurgeryConsentModal con texto exacto de §10.4 + SignaturePad de pediatría.

Fase 7 — Integraciones:
1. 9 duraciones de cita en Appointment.
2. Pre-fill SOAP por fase.
3. Plan general con sub-ítems y dependencias.
4. Badge perio en odontograma — icono de tornillo + color por currentStatus.
5. 4 plantillas receta NOM-024 (texto exacto).
6. 6 templates WhatsApp (texto exacto).
7. Audit log con COFEPRIS_TRACEABILITY_UPDATE, STATUS_CHANGE, REMOVE, PASSPORT_GENERATED, QR_PUBLIC_ENABLED.

Fase 8 — Mock data + tests:
1. Seed de los 3 pacientes (Roberto, María con 4 implantes, Carlos con peri-implantitis) según §12.
2. Tests unitarios (helpers).
3. Playwright E2E (5 flujos de §7).
4. Tests RLS multi-tenant.
5. Snapshots Storybook.
6. Compliance COFEPRIS (audit log + query de recall <200ms).

REGLAS DE NEGOCIO INNEGOCIABLES
- COFEPRIS clase III: brand, lotNumber, placedAt INMUTABLES por defecto. Modificación requiere justificación ≥20 chars + flag de sesión + trigger SQL. NO NEGOCIABLE.
- DELETE prohibido en Implant a nivel DB. "Remover" = currentStatus = REMOVED + removalReason ≥20 chars.
- Mobile = SOLO LECTURA. Banner explícito.
- Carnet del implante: licencia HORIZONTAL landscape (NO A4). Auto-generado al finalizar fase protésica.
- QR público: OPT-IN (privacidad LFPDPPP).
- Densidad ósea: SOLO Lekholm-Zarb (D1-D4). NO Misch.
- Albrektsson 1986 para criterios de éxito.
- ISQ ≥70 MD Y VL = listo para carga; <60 = NO cargar.
- Audit log obligatorio en TODAS las mutaciones clínicas.
- Idioma: español neutro mexicano. NUNCA argentino.
- Gender enum: M | F | OTHER.
- NO crear Radiography. Reutilizar PatientFile con FileCategory.
- NO crear PeriImplantAssessment — vive en Periodoncia. createPeriImplantAssessment STUB.
- ImplantBrand = OTRO requiere brandCustomName.

CHECKLIST DE FINALIZACIÓN
- [ ] Las 16 actions con audit log y validación zod.
- [ ] updateImplantTraceability rechaza modificación sin justificación ≥20 chars (test E2E).
- [ ] DELETE en Implant rechazado por trigger SQL.
- [ ] removeImplant cambia status a REMOVED con removalReason.
- [ ] Tarjeta-timeline renderiza 6 hitos + countdown osteointegración.
- [ ] SurgeryWizard 3 pasos funciona end-to-end con Roberto.
- [ ] ProstheticWizard auto-genera carnet PDF.
- [ ] Carnet horizontal landscape se descarga con datos del implante.
- [ ] Mobile solo lectura.
- [ ] STUB de createPeriImplantAssessment retorna { stub: true } con TODO.
- [ ] CompactImplantList se activa con 8+.
- [ ] Widget de controles vencidos lista pacientes.
- [ ] Widget de complicaciones activas lista implantes en COMPLICATION.
- [ ] Query de recall por brand+lot ejecuta <200ms.
- [ ] RLS multi-tenant.

CONTRATO CON PERIODONCIA
- En tu branch NO existe PeriImplantAssessment (vive en feature/periodontics-module-v1).
- createPeriImplantAssessment es STUB con TODO documentado.
- Al mergear ambos módulos en main: eliminar STUB, implementar versión real, ejecutar migración SQL separada para FK real PeriImplantAssessment.implantId → Implant.id.
- Esta migración NO va en este branch.

Cualquier ambigüedad clínica: opción más permisiva + TODO para Rafael. Cualquier obstáculo COFEPRIS: comenta // PRECAUCIÓN COFEPRIS: y procede lo más cercano al spec — la inmutabilidad NO se cede.

Cuando termines: comenta en el PR los seeds de los 3 pacientes para validación clínica con Rafael, y la query de recall por lote como demo.
```
