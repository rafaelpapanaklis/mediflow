# Pediatría — gaps clínicos para v2

Identificados durante el audit del PR `fix/pediatrics-gating-cycle`
(post-PR #11). Cobertura actual: 8/10 puntos clínicos cubiertos, 1
parcial, 1 faltante. Estos dos quedan fuera de scope del PR de UX
clarificadora y se proponen como sprint posterior.

## GAP 1 — Dosis pediátricas por peso (Alta)

**Estado:** ❌ falta.

**Por qué importa:**
- Riesgo clínico real. Anestesia y antibióticos en menores requieren
  cálculo `mg/kg` — no se prescribe "una dosis adulta menor".
- Toxicidad de lidocaína > 4.4 mg/kg → convulsiones. La receta sin
  cálculo automático invita a errores en consulta apurada.
- Mala práctica documentable bajo NOM-016-SSA3 (expediente clínico).

**Qué hace falta:**
- Helper `lib/pediatrics/dose-calculator.ts` con tabla de fármacos
  pediátricos comunes (lidocaína 4.4 mg/kg, amoxicilina 50 mg/kg/día,
  paracetamol 15 mg/kg/dosis cada 4-6h, ibuprofeno 10 mg/kg/dosis cada
  6-8h, clorhexidina 0.12% — uso tópico, sin cálculo).
- Campo `weightKg: number` requerido en el wizard de receta cuando el
  paciente es pediátrico. Validar contra `PediatricRecord.lastWeightKg`
  si existe; permitir override por consulta.
- Plantillas de prescripción pediátrica en
  `lib/pediatrics/prescription-templates.ts` análogas a las que ya
  existen para periodontics/orthodontics.
- Output de la receta debe incluir el cálculo paso a paso ("8 kg ×
  50 mg/kg/día ÷ 3 dosis = 133 mg cada 8h") por trazabilidad.

**Esfuerzo estimado:** 2-3 días.

**Archivos a tocar/crear:**
- `src/lib/pediatrics/dose-calculator.ts` (nuevo)
- `src/lib/pediatrics/prescription-templates.ts` (nuevo)
- `src/lib/pediatrics/__tests__/dose-calculator.test.ts` (nuevo)
- Wizard de receta — donde se decida UI (sin tocar todavía).

---

## GAP 2 — Corona pediátrica (Media)

**Estado:** ⚠️ parcial. Sealants, fluoride, pulpotomy/pulpectomy y
space maintainers están modelados; coronas pediátricas no.

**Por qué importa:**
- Restauración estándar para molares temporales con caries extensa o
  post-pulpotomía. Sin tabla, el tratamiento queda como nota libre y
  no aparece en el plan de tratamiento ni en el odontograma.
- Frecuentemente va en par con space maintainer (extracción + corona
  + mantenedor); modelarla permite vincular las tres en un mismo plan.

**Qué hace falta:**
- Tabla `PediatricCrownPlacement` en `prisma/schema.prisma` análoga a
  `PediatricEndodonticTreatment` (campos: `id`, `clinicId`, `patientId`,
  `pediatricRecordId`, `toothFdi`, `material` enum
  `stainless_steel|zirconia|composite_strip`, `placedAt`, `notes`,
  `deletedAt`).
- Drawer `CrownDrawer.tsx` en
  `components/patient-detail/pediatrics/drawers/`.
- Card en `OdontogramSection` que liste coronas colocadas.
- Migración + seed de catálogo de materiales.

**Esfuerzo estimado:** 1 día.

**Archivos a tocar/crear:**
- `prisma/schema.prisma` (modelo nuevo + relación desde
  `PediatricRecord`)
- `prisma/migrations/<timestamp>_add_pediatric_crown_placement/`
- `src/components/patient-detail/pediatrics/drawers/CrownDrawer.tsx`
- `src/components/patient-detail/pediatrics/sections/OdontogramSection.tsx`
  (extensión)

---

## Cobertura clínica actual (referencia rápida)

| # | Particularidad | Estado |
|---|---|---|
| 1 | Odontograma pediátrico (temporal + mixta) | ✅ |
| 2 | Captura de tutor + parentesco | ✅ |
| 3 | Escala Frankl (4 niveles + sparkline) | ✅ |
| 4 | Curvas de erupción vs OMS | ✅ |
| 5 | CAMBRA (riesgo de caries + recall) | ✅ |
| 6 | Tratamientos pediátricos (sellantes, fluoruro, pulpa, mantenedor) | ⚠️ falta corona |
| 7 | Dosis pediátricas por peso | ❌ |
| 8 | Consentimientos por tutor (firma + asentimiento) | ✅ |
| 9 | WhatsApp dirigido al tutor | ✅ |
| 10 | Hábitos orales (7 tipos) | ✅ |

Auditado contra `main@cd345b0` el 2026-05-06.
