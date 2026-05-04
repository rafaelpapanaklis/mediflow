# Módulo de Endodoncia — MediFlow

> Módulo del marketplace (2/5) que agrega un expediente endodóntico
> diente-céntrico con mapa canalicular dinámico, wizard de TC en 4 pasos,
> dashboard de tasa de éxito personal del doctor, controles automáticos
> 6/12/24 meses y consentimientos firmados con canvas.

**Spec completo:** `docs/marketplace/research/endodoncia/SPEC.md`
**Branch original:** `feature/endodontics-module-v1`

---

## 1. Resumen

| Aspecto | Estado |
|---|---|
| Modelos Prisma nuevos | 8 (`EndodonticDiagnosis`, `VitalityTest`, `EndodonticTreatment`, `RootCanal`, `IntracanalMedication`, `EndodonticFollowUp`, `EndodonticRetreatmentInfo`, `ApicalSurgery`). |
| Enums | 22 (todos prefijados con dominio: `Pulpal*`, `Periapical*`, `Vitality*`, `Endo*`, `Canal*`, `Obturation*`, etc.). |
| Server actions | 14 archivos en `src/app/actions/endodontics/` con auth + zod + audit + revalidatePath + retorno discriminado. |
| Wizard TC | 4 pasos (Acceso → Instrumentación → Irrigación → Obturación) con autosave en localStorage y completeTreatment() que crea 3 follow-ups + recordatorios WhatsApp. |
| SVGs anatómicos | 8 archivos en `public/specialties/endodontics/anatomy/` (incisor, canine, premolar-upper-1canal, premolar-upper-2canal, premolar-lower, molar-upper-mb2, molar-lower, molar-lower-cshape). Estilo técnico esquemático. |
| Tests | 2 archivos en `src/lib/helpers/__tests__/` (43 casos: canalAnatomy + successRateCalculator). |
| Multi-tenant | Sí — cada query y mutación usa `clinicId` del `getAuthContext()`. |
| RLS | Sí — deny-all para anon/authenticated en las 8 tablas nuevas. |
| Audit log | Catálogo `ENDO_AUDIT_ACTIONS` integrado a `prisma.auditLog`. |
| Reutilización | Reusa `PatientFile` para radiografías (Spec §1.4), `SignaturePad` de pediatría para firma, sidebar grupo "Especialidades" creado en pediatría, tokens `--text-1` / `--bg-elev` / `--brand-soft` existentes. |

---

## 2. Estructura de carpetas

```
src/
├── app/
│   ├── actions/endodontics/        # 14 server actions + helpers
│   │   ├── _helpers.ts             # getEndoActionContext + auditEndo
│   │   ├── result.ts               # ActionResult / isFailure
│   │   ├── diagnosis.ts            # createDiagnosis, updateDiagnosis
│   │   ├── vitality.ts             # recordVitalityTest
│   │   ├── treatment.ts            # startTreatment, updateTreatmentStep,
│   │   │                            # upsertRootCanal, recordIntracanalMed,
│   │   │                            # completeTreatment
│   │   ├── followup.ts             # scheduleFollowUp, completeFollowUp
│   │   ├── retreatment.ts          # createRetreatmentInfo, createApicalSurgery
│   │   ├── reports.ts              # exportTreatmentReportPdf, exportLegalReportPdf
│   │   └── index.ts                # barrel
│   ├── api/endodontics/context/    # GET context para integraciones
│   └── dashboard/specialties/endodontics/
│       ├── page.tsx                # index (KPIs + activos + pendientes)
│       └── [patientId]/page.tsx    # detalle diente-céntrico
├── components/specialties/endodontics/
│   ├── EndodonticsTab.tsx          # shell: 280px + ToothCenterView
│   ├── ToothMiniOdontogram.tsx     # panel izquierdo
│   ├── ToothCenterView.tsx         # 3 secciones verticales
│   ├── DiagnosisCard.tsx           # sección 1
│   ├── CanalMap.tsx                # sección 2 — motor SVG dinámico
│   ├── ToothTimeline.tsx           # sección 3
│   ├── TreatmentWizard.tsx         # wizard 4 pasos (modal full-screen)
│   ├── RetreatmentBadge.tsx
│   ├── SuccessRateChart.tsx        # bar chart Recharts
│   ├── PendingFollowUpsList.tsx
│   ├── PendingRestorationList.tsx
│   ├── RadiographComparisonView.tsx
│   ├── drawers/
│   │   ├── DiagnosisDrawer.tsx
│   │   ├── VitalityDrawer.tsx
│   │   ├── FollowUpDrawer.tsx
│   │   ├── RootCanalDrawer.tsx
│   │   └── ApicalSurgeryDrawer.tsx
│   └── modals/
│       └── ConsentModal.tsx        # reusa SignaturePad de pediatría
├── lib/
│   ├── helpers/
│   │   ├── canalAnatomy.ts         # defaultCanalsForFdi, categorizeTooth,
│   │   │                            # selectCanalSvg, QUALITY_COLORS, labels
│   │   ├── soapPrefillEndo.ts
│   │   ├── whatsappTemplatesEndo.ts # 8 plantillas (preTC, postTC, restoration,
│   │   │                            # followUp 6/12/24, resultPositive)
│   │   ├── prescriptionTemplatesEndo.ts # 3 plantillas NOM-024
│   │   ├── endoAppointmentDurations.ts
│   │   ├── successRateCalculator.ts
│   │   ├── loadEndoToothData.ts
│   │   └── __tests__/              # canalAnatomy + successRate
│   ├── legal/endoConsent.ts        # texto consentimiento + cirugía apical
│   ├── types/endodontics.ts
│   └── validation/endodontics.ts   # zod schemas para las 14 actions
└── public/specialties/endodontics/anatomy/  # 8 SVGs
```

---

## 3. Cómo activar el módulo en una clínica

El módulo vive en el marketplace con la key `endodontics`. Para que aparezca:

1. **Categoría compatible:** `clinic.category` debe ser `DENTAL`.
2. **Módulo activo:** debe existir un registro en `clinic_modules` con:
   - `module.key = 'endodontics'`
   - `status = 'active'`
   - `currentPeriodEnd > NOW()`

Si ambos predicados pasan, el item "Endodoncia" aparece en el sidebar
bajo el grupo "Especialidades" (que también se renderiza solo si la
clínica tiene al menos un módulo de especialidad activo).

### Activar manualmente vía SQL (dev)

```sql
-- 1. Asegúrate que el módulo 'endodontics' exista en la tabla modules.
--    Si no, agrégalo o pídele al equipo de marketplace que extienda
--    el seed (prisma/seed.ts SEED_MODULES).

-- 2. Activa el módulo en la clínica:
INSERT INTO clinic_modules (
  id, clinic_id, module_id, status, billing_cycle,
  current_period_start, current_period_end, payment_method, price_paid_mxn
)
SELECT
  gen_random_uuid()::text,
  '<CLINIC_ID>',
  m.id,
  'active',
  'monthly',
  NOW(),
  NOW() + INTERVAL '12 months',
  'manual',
  m.price_mxn_monthly
FROM modules m
WHERE m.key = 'endodontics';
```

### Sembrar 3 pacientes mock

```bash
npx tsx prisma/seeds/endodontics-mock.ts
```

Esto crea Roberto Salinas (TC primario completado en 36), Mariana Torres
(retratamiento en curso en 21) y Carlos Mendoza (control 12m post-TC en
47). Idempotente.

---

## 4. Flujo típico de un TC primario

1. Doctor selecciona el paciente y entra a
   `/dashboard/specialties/endodontics/[patientId]`.
2. Click en el diente afectado en el `ToothMiniOdontogram` (panel izquierdo).
3. `DiagnosisCard` muestra "Sin diagnóstico" → click en "Capturar diagnóstico"
   abre `DiagnosisDrawer` con select AAE pulpar + periapical.
4. Click en "Iniciar tratamiento" en `CanalMap` → `startTreatment` server
   action crea el `EndodonticTreatment` y abre el `TreatmentWizard`.
5. Wizard de 4 pasos:
   - **Paso 1:** dique de hule + tipo de acceso.
   - **Paso 2:** sistema de instrumentación + técnica + parámetros del motor.
   - **Paso 3:** irrigantes (lista dinámica), técnica de activación, minutos.
   - **Paso 4:** técnica de obturación + sealer + cono + plan restauración.
   - Cada paso persiste antes de avanzar (autosave en localStorage también).
6. En el odontograma del wizard o post-wizard, el doctor agrega/edita los
   conductos vía `RootCanalDrawer` (LT, lima, taper, calidad de obturación).
   Cada calidad colorea el `<g id="canal-X">` del SVG en `CanalMap`.
7. "Completar tratamiento" valida que todos los conductos tengan calidad y
   que paso 4 tenga plan de restauración → marca `outcomeStatus =
   COMPLETADO`, crea 3 `EndodonticFollowUp` (CONTROL_6M/12M/24M) y encola
   recordatorios WhatsApp en `whatsapp_reminders` con `type = 'ENDO'`.

---

## 5. Cómo agregar un nuevo arquetipo SVG

Si en v1.1 quieres agregar un SVG anatómico nuevo (ej. `molar-cshape-bilingual.svg`):

1. **SVG:** crea el archivo en `public/specialties/endodontics/anatomy/`
   con `viewBox="0 0 200 400"` y `<g id="canal-X" data-canal-name="...">`
   por conducto.
2. **Type:** agrega el archetype al union `CanalSvgArchetype` en
   `src/lib/types/endodontics.ts`.
3. **Selector:** modifica `selectCanalSvg()` en
   `src/lib/helpers/canalAnatomy.ts` con la lógica de cuándo elegirlo.
4. **Test:** agrega un caso en `__tests__/canalAnatomy.test.ts`.

---

## 6. Tests

```bash
# Lib helpers
npx tsx --test src/lib/helpers/__tests__/canalAnatomy.test.ts \
                src/lib/helpers/__tests__/successRateCalculator.test.ts

# Type check
npx tsc --noEmit
```

---

## 7. Roadmap

| Versión | Funcionalidad |
|---|---|
| **v1.0 (MVP)** — entregado | Schema, vista diente-céntrica, wizard 4 pasos, mapa canalicular dinámico, drawers, dashboard, mock seed. |
| **v1.1** | SVGs ilustrados de mayor calidad (Cohen ref). Zoom/pan sincronizado en `RadiographComparisonView`. PDFs `treatmentReport` y `legalEndoReport` con render real (`@react-pdf/renderer`) en `/api/endodontics/reports/*`. Configuración de doctor (Vertucci vs Ahmed 2017). |
| **v2.0** | XrayAnalysis IA → PAI sugerido automático. CBCT viewer integrado. Comparativo 4 radiografías con anotaciones. |
