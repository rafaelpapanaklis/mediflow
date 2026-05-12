# Plan de ejecución · feat/ortho-v2-rewrite

Generado: 2026-05-12 — interpretación de cada fase del SPEC del usuario con realismo de scope.

## Estado a la fecha de este commit

**Fase 0 (pre-flight):** ~80% completa.

| Subtask | Estado |
|---|---|
| 0.1 Branch correcto | ✅ `feat/ortho-v2-rewrite` desde `origin/main` |
| 0.2 Pull rebase | ✅ branch is up-to-date |
| 0.3 Lectura SPEC.md | ✅ 910 líneas leídas completas |
| 0.3 Lectura atoms/sections/drawers/hi-fi/tokens | ⏳ pendiente · 3,066 líneas restantes |
| 0.4 Patron patient-detail-client | ⏳ pendiente — relectura post-demolición |
| 0.5 Inventario módulo v1 | ✅ `_demolition-inventory.md` |
| 0.6 Inventario schema v1 | ✅ 24 modelos + 29 enums identificados |
| 0.7 Verifica solo-Gabriela | ❌ **3 pacientes detectados — ABORT pendiente decisión Rafael** |
| 0.8 Execution plan | ✅ este archivo |

## Bloqueador actual

Sergio + Andrés tienen 1 `OrthodonticDiagnosis` cada uno (orphans, sin plan). Ver `_prod-data-inventory.md` para decisión requerida.

## Plan de ejecución multi-sesión

El SPEC describe **12 fases** que en alcance real son **18-24 sesiones Claude** de trabajo enfocado.
La sesión actual se usa solo para Fase 0. Las siguientes:

### Sesión 2 — Cierre Fase 0 + Fase 1 (demolición)

Tras decisión de Rafael sobre Sergio/Andrés:
- 0.3 leer 3,066 líneas restantes de design docs
- Validar que `LabOrder` cross-módulo no causa conflicto con v2 (`OrthoLabOrderV2` o extender existente)
- Validar enums potencialmente cross-módulo (`ControlAttendance`, `OrthoPaymentMethod`)
- Mover módulo viejo a `.backup/` (Fase 1.1)
- Identificar imports rotos (Fase 1.2)
- Arreglar referencias (Fase 1.3)
- Validar build limpio sin v1 (Fase 1.4)
- Mover seeds + scripts + tests (Fase 1.5-1.6)
- Commit Fase 1

### Sesión 3 — Fase 2 (schema + migration)

⚠️ **Alto riesgo prod.** Validar antes de aplicar:
- Edit `prisma/schema.prisma`: drop 24 models + 29 enums, agregar 14+ models + 11 enums
- FKs no-destructivas en Patient/Appointment/Invoice/Xray
- `npx prisma format && npx prisma validate`
- `npx prisma migrate dev --create-only` — **revisar SQL antes de aplicar**
- Aplicar migration · verificar en Supabase

### Sesión 4 — Fase 3 (zod + permisos + disabled)

- `src/lib/orthodontics-v2/schemas.ts` (12+ schemas zod)
- `src/lib/orthodontics-v2/types.ts` (Result<T>, ViewModels)
- `src/lib/orthodontics-v2/permissions.ts` (105 reglas)
- `src/lib/orthodontics-v2/disabled-rules.ts` (22 reglas)

### Sesiones 5-8 — Fase 4 (48 server actions + 144 tests)

Distribución sugerida por archivo del SPEC:
- Sesión 5: CASE (5) + DIAGNOSIS (2) + TREATMENT PLAN (8) = 15 actions + 45 tests
- Sesión 6: TEMPLATES (5) + PHOTOS (7) = 12 actions + 36 tests
- Sesión 7: TREATMENT CARDS (6) + FINANCIAL (5) = 11 actions + 33 tests
- Sesión 8: RETENTION (5) + DOCUMENTS (5) + CROSS (2) = 12 actions + 36 tests

Total: 48 actions, 150 vitest tests.

### Sesiones 9-10 — Fase 5 (12 atoms)

- 6 atoms por sesión, con tipos + light/dark + tests visuales mínimos

### Sesiones 11-13 — Fase 6 (8 secciones)

- 3 secciones por sesión

### Sesiones 14-17 — Fase 7 (23 drawers)

- 6 drawers por sesión

### Sesión 18 — Fase 8 (loader + adapter + shell + atajos)

### Sesión 19 — Fase 9 (integración patient-detail)

### Sesión 20 — Fase 10 (seed Gabriela v2)

### Sesiones 21-22 — Fase 11 (30+ E2E Playwright)

### Sesión 23 — Fase 12 (validación visual + PR)

## Riesgos identificados

1. **Cross-módulo `LabOrder`**: el modelo `LabOrder` existente es compartido. El SPEC define un `LabOrder` v2 con `caseId String`. Esto crea conflicto de nombre. Decisión: extender el existente con `caseId String?` o renombrar el v2 a `OrthoLabOrderV2`.
2. **Enums cross-módulo**: algunos enums viejos (`ControlAttendance`, `OrthoPaymentMethod`) pueden tener uso fuera de orto — auditar antes de drop.
3. **Migration prod**: el drop de 24 models en una sola migration es alto-riesgo. Considerar split en dos migrations: (a) drop + (b) create.
4. **Schema `TreatmentPlan`**: existe ya un `model TreatmentPlan` legacy en línea 895 — choca con el `TreatmentPlan` v2 del SPEC. Decisión: ¿renombrar el legacy a `OldTreatmentPlan` o eliminar el v1 antes del v2?
5. **CFDI Facturapi / Twilio / Stripe MX / WebCeph**: los 4 servicios externos siguen como stubs documentados, ninguno integrado en código real.

## Stubs externos permitidos en v2

Per restricciones del SPEC, solo estos 4 servicios externos pueden quedar como toast.info(...) con mensaje que mencione el servicio:

| Servicio | Acción afectada | Mensaje canónico |
|---|---|---|
| **Facturapi** | CFDI timbrado en `collectInstallment` | "CFDI con Facturapi · contratar para activar" |
| **Twilio** / 360dialog | WhatsApp send en `sendWhatsApp`, `sendSignAtHome` | "WhatsApp con Twilio · contratar para activar" |
| **Stripe MX** | Cobro tokenizado en `collectInstallment` (payment method CARD/MSI) | "Cobro Stripe MX · contratar para activar" |
| **WebCeph** | Cefalometría AI Landmarking en plan tx | "Cefalometría WebCeph · contratar para activar" |

Todo lo demás debe ser CRUD funcional real, no stub.

## Comandos de validación a cada commit

```powershell
npx tsc --noEmit                 # 0 errores
npm run build                    # exit 0
npx vitest run                   # todos verdes (objetivo >200 tests al final)
npx playwright test              # todos verdes (objetivo >30 al final)
```
