# Fase 0 · Schema viejo del módulo ortho — modelos y enums identificados

Generado: 2026-05-12 desde `prisma/schema.prisma` actual (post PR #23, antes de v2 rewrite).

## 24 modelos a eliminar

```
Línea  Modelo
─────  ────────────────────────────────────
 895   TreatmentPlan                   ← LEGACY (no confundir con TreatmentPlan del SPEC v2 línea 107)
4232   OrthodonticDiagnosis
4291   OrthodonticTreatmentPlan
4368   OrthodonticPhase
4395   OrthoPaymentPlan
4434   OrthoInstallment
4470   OrthoPhotoSet
4520   OrthodonticControlAppointment
4567   OrthodonticDigitalRecord
4591   OrthodonticConsent
4624   OrthoWireStep
4667   OrthoTreatmentCard
4733   OrthoCardElastic
4754   OrthoCardIprPoint
4775   OrthoCardBrokenBracket
4796   OrthoTAD
4829   OrthoAuxMechanics
4856   OrthoPhaseTransition
4948   OrthoQuoteScenario
4984   OrthoSignAtHomePackage
5024   OrthoRetentionRegimen
5053   OrthoRetainerCheckup
5076   OrthoNpsSchedule
5105   OrthoReferralCode
```

## 29 enums a eliminar

```
Línea  Enum                              Posible uso cross-módulo
─────  ────────────────────────────────  ─────────────────────────
4008   OrthoPhaseKey                     solo orto
4024   OrthoTreatmentStatus              solo orto
4047   OrthoPhotoSetType                 solo orto (T0/T1/T2/CONTROL)
4054   OrthoPhotoView                    solo orto (8 vistas AAO)
4092   OrthoConsentType                  solo orto
4099   ControlAttendance                 ⚠️ AUDITAR — posible uso en agenda
4105   AdjustmentType                    ⚠️ AUDITAR — posible uso en treatment cards generic
4117   OrthoPaymentMethod                ⚠️ AUDITAR — posible uso en billing
4126   DigitalRecordType                 solo orto (RX/STL)
4133   OrthoApplianceSlot
4144   OrthoBondingType
4149   OrthoSkeletalPattern
4155   OrthoWireMaterial
4162   OrthoWireShape
4167   OrthoWireStepStatus
4174   OrthoElasticClass
4183   OrthoElasticZone
4189   OrthoTadBrand
4196   OrthoExpanderType
4203   OrthoDistalizerType
4211   OrthoGingivitisLevel
4218   OrthoCardStatus
4890   OrthoQuoteScenarioStatus
4897   OrthoQuoteScenarioPaymentMode
4903   OrthoSignAtHomeStatus
4912   OrthoRetainerType
4921   OrthoRetainerArchwireGauge
4927   OrthoRetainerCheckupStatus
4934   OrthoNpsType
4940   OrthoNpsStatus
```

## NO eliminar

| Modelo | Línea | Razón |
|---|---|---|
| `LabOrder` | 5523 | Cross-módulo (endo/perio/implants/orto). El SPEC v2 define un `LabOrder` con `caseId String` — **conflicto de nombre**. Decidir si extender el existente o renombrar el v2 |

## Constraint check: enums potencialmente cross-módulo — RESUELTO 2026-05-12

Audit ejecutado: los 3 enums sospechosos (`ControlAttendance`, `AdjustmentType`, `OrthoPaymentMethod`) están **solo dentro del módulo orto** (archivos `src/**/orthodontics/**` o `src/lib/types/orthodontics.ts`, y modelos Prisma `OrthodonticControlAppointment`, `OrthoPaymentPlan`, `OrthoInstallment`, `OrthoSignAtHomePackage` — todos a drop).

Detalle completo en `_decisions.md` punto 3. **Conclusión: los 29 enums se drop sin riesgo cross-módulo.**

## Mapeo old → new (SPEC v2)

Para informar la decisión de migración de data (Sergio + Andrés):

| Viejo | Nuevo SPEC v2 |
|---|---|
| `OrthodonticTreatmentPlan` | `OrthoCase` + `TreatmentPlan` (split en 2 modelos) |
| `OrthodonticDiagnosis` | `OrthoDiagnosis` |
| `OrthoPhotoSet` + columnas | `PhotoSet` + `Photo[]` (refactor a 1:N) |
| `OrthoTreatmentCard` + hijos | `TreatmentCard` con Json para activations/elasticUse |
| `OrthoPaymentPlan` + `OrthoInstallment` | `FinancialPlan` + `Installment` |
| `OrthoRetentionRegimen` | `RetentionPlan` |
| `OrthoQuoteScenario` | `FinancialPlan.scenarios` (Json) |
| `OrthoNpsSchedule` | `RetentionPlan.checkpoints` + nuevos modelos |
| `OrthoReferralCode` | `RetentionPlan.referralCode` |
| `OrthoWireStep` | `ArchPlanned` |
| `OrthoTAD` | dentro de `TreatmentPlan.tads` (Json) |
| `OrthoCardElastic/IprPoint/BrokenBracket` | dentro de `TreatmentCard.elasticUse/iprDoneDelta/bracketsLost` (Json) |
| `OrthoAuxMechanics` | dentro de `TreatmentPlan.expanders` (Json) |
| `OrthoPhaseTransition` | derivado de `ArchPlanned.status` history en audit log |
| `OrthodonticControlAppointment` | merged con `Appointment` + `TreatmentCard` (single source of truth = Appointment) |
| `OrthodonticConsent` | `OrthoDocument` con `kind=CONSENT` |
| `OrthodonticDigitalRecord` | merged con `Xray` (single source of truth = Xray + Photo.xrayId) |
| `OrthoSignAtHomePackage` | `FinancialPlan.signAtHomeUrl` + `signedByPatient` |
| `OrthoRetainerCheckup` | derivado de `Appointment` + `RetentionPlan.checkpoints` |

Para Sergio + Andrés (solo tienen `OrthodonticDiagnosis`):
- Mínimo: crear `OrthoCase` DRAFT + `OrthoDiagnosis` desde el viejo
- O: borrar como orphans si confirma Rafael que son test data
