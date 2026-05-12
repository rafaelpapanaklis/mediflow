# Fase 0 · Inventario del módulo ortho v1 a demoler

Generado: 2026-05-12 — branch `feat/ortho-v2-rewrite` desde `origin/main` (commit `e86f4f8`).

## Archivos en el módulo v1

| Carpeta | Files count |
|---|---|
| `src/components/specialties/orthodontics/` | 100 archivos |
| `src/app/actions/orthodontics/` | 42 archivos |
| `src/lib/orthodontics/` | 35 archivos |
| `src/lib/orthodontics-v2/` (placeholder previo) | 1 archivo |

**Total a backup/demolish:** ~177 archivos en `src/`.

## Schema Prisma — modelos a eliminar

24 modelos del módulo viejo (todos prefijo `Ortho*` o `Orthodontic*` o el genérico `TreatmentPlan` legacy):

| Modelo | Línea |
|---|---|
| TreatmentPlan (legacy — NO el TreatmentPlan v2 del SPEC) | 895 |
| OrthodonticDiagnosis | 4232 |
| OrthodonticTreatmentPlan | 4291 |
| OrthodonticPhase | 4368 |
| OrthoPaymentPlan | 4395 |
| OrthoInstallment | 4434 |
| OrthoPhotoSet | 4470 |
| OrthodonticControlAppointment | 4520 |
| OrthodonticDigitalRecord | 4567 |
| OrthodonticConsent | 4591 |
| OrthoWireStep | 4624 |
| OrthoTreatmentCard | 4667 |
| OrthoCardElastic | 4733 |
| OrthoCardIprPoint | 4754 |
| OrthoCardBrokenBracket | 4775 |
| OrthoTAD | 4796 |
| OrthoAuxMechanics | 4829 |
| OrthoPhaseTransition | 4856 |
| OrthoQuoteScenario | 4948 |
| OrthoSignAtHomePackage | 4984 |
| OrthoRetentionRegimen | 5024 |
| OrthoRetainerCheckup | 5053 |
| OrthoNpsSchedule | 5076 |
| OrthoReferralCode | 5105 |

**Nota:** `LabOrder` (línea 5523) es **compartido cross-módulo** (endodontics, periodontics, implants, ortho) — NO eliminar, ya tiene FKs a otras especialidades. El SPEC v2 reusa `LabOrder` con un nuevo modelo dedicado `LabOrder` para ortho — habrá conflicto de nombre. Decidir si: (a) renombrar el `LabOrder` v2 del SPEC a `OrthoLabOrderV2`, o (b) extender el `LabOrder` cross-módulo existente con los campos nuevos.

## Schema Prisma — enums a eliminar

29 enums del módulo viejo:

| Enum | Línea |
|---|---|
| OrthoPhaseKey | 4008 |
| OrthoTreatmentStatus | 4024 |
| OrthoPhotoSetType | 4047 |
| OrthoPhotoView | 4054 |
| OrthoConsentType | 4092 |
| ControlAttendance | 4099 |
| AdjustmentType | 4105 |
| OrthoPaymentMethod | 4117 |
| DigitalRecordType | 4126 |
| OrthoApplianceSlot | 4133 |
| OrthoBondingType | 4144 |
| OrthoSkeletalPattern | 4149 |
| OrthoWireMaterial | 4155 |
| OrthoWireShape | 4162 |
| OrthoWireStepStatus | 4167 |
| OrthoElasticClass | 4174 |
| OrthoElasticZone | 4183 |
| OrthoTadBrand | 4189 |
| OrthoExpanderType | 4196 |
| OrthoDistalizerType | 4203 |
| OrthoGingivitisLevel | 4211 |
| OrthoCardStatus | 4218 |
| OrthoQuoteScenarioStatus | 4890 |
| OrthoQuoteScenarioPaymentMode | 4897 |
| OrthoSignAtHomeStatus | 4903 |
| OrthoRetainerType | 4912 |
| OrthoRetainerArchwireGauge | 4921 |
| OrthoRetainerCheckupStatus | 4927 |
| OrthoNpsType | 4934 |
| OrthoNpsStatus | 4940 |

**Antes de borrar enums:** verificar que ningún modelo NO-ortho los referencia (sospecho `ControlAttendance` y `OrthoPaymentMethod` podrían tener uso externo — auditar grep antes del DROP).

## Seeds y scripts a archivar (mover a `.backup/`)

- `prisma/seeds/ortho-demo.ts`
- `scripts/apply-ortho-redesign-fase1-prod.sql`
- `scripts/apply-ortho-redesign-fase1-5-prod.sql`
- `scripts/apply-ortho-redesign-incremental-fix.sql`
- `scripts/verify-ortho-prod-state.mts`
- `scripts/verify-ortho-seed.mts`
- `scripts/verify-whatsapp-seed.mts`
- `scripts/inspect-ortho-prod-schema.mts`
- `scripts/debug-ortho-loader.mts`
- `scripts/debug-confirm-collect.mts`
- `scripts/inventory-old-ortho-data.mts` (creado en esta sesión)

## Tests a archivar

- `tests/e2e/orthodontics-patient-detail.spec.ts`
- `tests/e2e/debug-section-f.spec.ts`
- `tests/e2e/debug-stats-hero.spec.ts`
