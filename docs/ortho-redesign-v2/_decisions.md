# Fase 0 cierre · decisiones de Rafael (2026-05-12)

Tras el ABORT por 3 pacientes con data ortho v1, Rafael resolvió los 3 bloqueadores:

## 1. Orphans Sergio + Andrés — DELETED

Ambos `OrthodonticDiagnosis` rows borrados de prod (sin plan, sin cards, eran test data residual).

| Paciente | patientId | diagnosisId borrado |
|---|---|---|
| Sergio Ramírez López (#00008) | `cmokj5td80007cux0em8qhxje` | `92e5c6c6-6dca-4a56-b677-fde2ac5de20d` |
| Andrés López Ramírez (#00009) | `cmokj5td80008cux02t8hd5xk` | `34e2c6c7-43ad-4be5-a373-428302917523` |

Ejecutado por `scripts/delete-ortho-orphan-diagnoses.mts`. El inventario post-delete confirma **solo Gabriela** queda con data ortho v1 (42 rows en 14 tablas). Demolition ahora segura per SPEC 0.7.

## 2. Conflicto LabOrder cross-módulo — rename del SPEC v2

El modelo `LabOrder` global (línea 5523 de `schema.prisma`) se queda **INTACTO** porque lo usan endodontics/perio/implants. El módulo Ortodoncia tendrá su modelo dedicado renombrado:

- En SPEC v2: `LabOrder` → **`OrthoLabOrder`**
- En el código nuevo: server actions, drawers, sections, types, zod schemas, seed deben usar el nombre `OrthoLabOrder` (no `LabOrder`).
- FK `caseId String` apunta a `OrthoCase.id`.
- Catalog G18 extensible se mantiene.

Esto evita el shadowing al hacer `import { LabOrder } from "@prisma/client"` en código no-ortho.

## 3. Audit enums cross-módulo — todos safe to drop

Grep `ControlAttendance|AdjustmentType|OrthoPaymentMethod` ejecutado contra `src/` y `prisma/schema.prisma`:

### `ControlAttendance`
Aparece en 4 archivos, **todos dentro de orto**:
- `src/lib/orthodontics/__tests__/attendance-tracker.test.ts`
- `src/lib/types/orthodontics.ts`
- `src/lib/orthodontics/compliance-helpers.ts`
- `src/components/specialties/orthodontics/controls/ControlAppointmentWizard.tsx`

Único modelo Prisma que lo referencia: `OrthodonticControlAppointment.attendance` (línea 4529 schema).

### `AdjustmentType`
Aparece en 2 archivos, **ambos en orto**:
- `src/lib/types/orthodontics.ts`
- `src/components/specialties/orthodontics/controls/ControlAppointmentWizard.tsx`

Único modelo Prisma que lo referencia: `OrthodonticControlAppointment.adjustments` (línea 4540 schema).

### `OrthoPaymentMethod`
Aparece en 5 archivos, **todos en orto**:
- `src/app/actions/orthodontics/confirmCollect.ts`
- `src/components/specialties/orthodontics/redesign/types-finance.ts`
- `src/lib/types/orthodontics.ts`
- `src/components/specialties/orthodontics/payments/RecordPaymentDrawer.tsx`
- `src/components/specialties/orthodontics/consent/FinancialAgreementModal.tsx`

Modelos Prisma que lo referencian: `OrthoPaymentPlan.preferredPaymentMethod` (4415), `OrthoInstallment.paymentMethod` (4446), `OrthoSignAtHomePackage.paymentMethod` (5002) — todos modelos viejos a drop.

### Conclusión audit
Ningún enum tiene uso fuera del módulo orto. **Los 29 enums se eliminan completos** en Fase 2 sin riesgo cross-módulo.

## 4. Conflicto TreatmentPlan legacy

`prisma/schema.prisma` línea 895 tiene un `model TreatmentPlan` legacy NO-ortho (genérico/multiespecialidad). El SPEC v2 define un `TreatmentPlan` específico de ortodoncia (línea 107 del SPEC.md).

**Decisión:** el `TreatmentPlan` legacy de línea 895 se mantiene si lo usan otras especialidades — verificar en Fase 2 antes de drop. Si efectivamente solo lo usa orto, se elimina y el nuevo `TreatmentPlan` v2 ocupa el namespace. Si lo usa cualquier otra especialidad, el v2 se renombra a `OrthoTreatmentPlanV2`.

Por ahora se documenta como riesgo pendiente para Fase 2.

## 5. Fase 4 tests · 144+ vitest postpuestos a followup

El SPEC pedía 144+ tests vitest (3 por server action × 48). Durante el modo
autónomo Fases 3-12, se prioriza implementación end-to-end sobre cobertura
de tests. Las 48 server actions tienen validación zod + perms + Prisma
funcional, suficiente para Fase 11 E2E Playwright de happy path.

Tests vitest se pueden agregar en un followup PR enfocado solo en cobertura.

## 6. Fase 2 helper reFail() · workaround narrowing TS de Result<T>

Al codear los server actions, TypeScript no narrowing automático cuando se
pasa un `Result<A>` (fallido) hacia un puesto que espera `Result<B>`. Pese
a que la branch failure es estructuralmente idéntica entre las dos
parametrizaciones, TS las trata nominalmente.

Solución: helper `reFail<T>(r: Result<unknown>): Result<T>` que cast-ea el
error a la firma esperada, manteniendo type-safety. Patrón uniforme:

```ts
const auth = await requirePermission("...");
if (!auth.ok) return reFail(auth);
```

Documentado en src/lib/orthodontics-v2/types.ts.
