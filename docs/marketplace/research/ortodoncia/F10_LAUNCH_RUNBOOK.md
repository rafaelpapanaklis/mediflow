# F10 — Runbook de lanzamiento Ortodoncia

> **Estado:** preparado, NO ejecutado. Rafael ejecuta los pasos manuales tras revisar este documento.
> **Branch:** `feature/orthodontics-module-v1` HEAD `619f62a` (al momento de escribir).
> **Pre-requisitos:**
> - `npm run build` verde tras F9.5 ✅
> - 35/35 tests unitarios verde ✅
> - Periodoncia (módulo 4/5) y módulos previos en producción.
> - Acceso a Supabase Production + Vercel Production env vars.

---

## 0. Antes de empezar

Verifica que estás en la branch correcta y que no haya cambios sueltos:

```bash
cd C:/Users/Rafael/Documents/GitHub/mediflow-orto
git status                    # debe estar clean
git log --oneline -3          # debe arrancar en F9.5 (619f62a) o el commit del seed F10
```

**Backup:** antes de aplicar la migración, exporta un dump de la BD desde Supabase Dashboard → Database → Backups → "Create snapshot now". Etiqueta: `pre-orthodontics-migration-YYYYMMDD`.

---

## 1. Aplicar migración SQL en Supabase Production

La migración `20260505000000_orthodontics_module/migration.sql` es idempotente
(`DO $$ ... EXCEPTION WHEN duplicate_object` + `CREATE ... IF NOT EXISTS` +
`ADD CONSTRAINT IF NOT EXISTS`). Re-ejecutarla por error no rompe nada.

### 1.1 Validación local pre-deploy

```bash
cd C:/Users/Rafael/Documents/GitHub/mediflow-orto
npx prisma generate           # cliente Prisma actualizado
npm run build                 # verde — verifica que el schema se mapea
```

### 1.2 Aplicar en Supabase

1. Abre **Supabase Dashboard** → proyecto MediFlow Production → **SQL Editor**.
2. URL directa al editor: `https://supabase.com/dashboard/project/{PROJECT_REF}/sql/new`.
3. Copia el contenido completo de:
   ```
   prisma/migrations/20260505000000_orthodontics_module/migration.sql
   ```
4. Pégalo en una query nueva. Verifica que arranca con el comentario
   `-- ═══════════════════════════════════════════════════════════════════`
   `-- Orthodontics module — schema (foundation)`.
5. Click **"Run"** (o `Ctrl+Enter`). Espera. La migración hace ~600 líneas:
   - 1× `ALTER TYPE FileCategory` agregando 6 valores.
   - 18× `CREATE TYPE` para enums nuevos (todos con guard `EXCEPTION WHEN duplicate_object`).
   - 9× `CREATE TABLE IF NOT EXISTS`.
   - ~30× `ALTER TABLE ADD CONSTRAINT` para FKs (con guard).
   - ~20× `CREATE INDEX IF NOT EXISTS` (incluye `idx_ortho_kanban_lookup`).
   - 7× `ADD CONSTRAINT ... CHECK` (overbite, overjet, duración, costo, paymentDayOfMonth, amount, paid atomicity, dropped reason).
   - 1× `DO $$ DECLARE ortho_table TEXT loop` para RLS deny-all en las 9 tablas.
   - 1× `CREATE OR REPLACE FUNCTION ortho_recalc_payment_plan_status` + trigger.
6. Resultado esperado: `Success. No rows returned`. Si aparece error de
   constraint duplicado o tabla existente, **NO te preocupes** — la
   migración es idempotente y se puede re-correr.

### 1.3 Validar post-aplicación

En el SQL Editor:

```sql
-- 1. Verifica que las 9 tablas existen.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'ortho%'
ORDER BY table_name;
-- Debe devolver 9 filas: ortho_installments, ortho_payment_plans,
-- ortho_photo_sets, orthodontic_consents, orthodontic_control_appointments,
-- orthodontic_diagnoses, orthodontic_digital_records, orthodontic_phases,
-- orthodontic_treatment_plans.

-- 2. Verifica que el enum FileCategory tiene los 6 valores nuevos.
SELECT unnest(enum_range(NULL::"FileCategory")) AS file_category
WHERE unnest(enum_range(NULL::"FileCategory"))::TEXT IN
  ('ORTHO_PHOTO_T0', 'ORTHO_PHOTO_T1', 'ORTHO_PHOTO_T2',
   'ORTHO_PHOTO_CONTROL', 'CEPH_ANALYSIS_PDF', 'SCAN_STL');
-- Debe devolver 6 filas.

-- 3. Verifica el índice del kanban.
SELECT indexname FROM pg_indexes
WHERE indexname = 'idx_ortho_kanban_lookup';
-- Debe devolver 1 fila.

-- 4. Verifica que el trigger de recálculo está activo.
SELECT tgname FROM pg_trigger
WHERE tgname = 'recalc_payment_plan_status';
-- Debe devolver 1 fila.

-- 5. Verifica RLS deny-all en las 9 tablas.
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'ortho%';
-- Las 9 tablas deben tener rowsecurity = true.
```

---

## 2. Crear `Module` marketplace y activar `ClinicModule` QA

### 2.1 Aplicar el seed del marketplace (idempotente)

El seed `prisma/seed.ts` es idempotente (usa `upsert` por `key`). Ya
contiene la entry `orthodontics` actualizada con icono `Smile` + features
reales. Aplica el seed:

```bash
cd C:/Users/Rafael/Documents/GitHub/mediflow-orto
DATABASE_URL="<PROD_DATABASE_URL>" \
DIRECT_URL="<PROD_DIRECT_URL>" \
npx tsx prisma/seed.ts
```

> **Decisión personal:** ejecutar el seed con env vars inline garantiza
> que apuntas a producción a propósito. NO uses `.env.production` para
> evitar accidentes con flags de migrate.

Resultado esperado:
```
Seed marketplace: upsert de 6 módulos activos …
… orthodontics ✓ (priceMxnMonthly: 329)
```

### 2.2 Validar el `Module` quedó bien

```sql
SELECT key, name, "priceMxnMonthly", "iconKey", description
FROM modules
WHERE key = 'orthodontics';
-- Debe devolver: orthodontics | Ortodoncia | 329 | Smile | "Kanban operativo..."
```

### 2.3 Activar `ClinicModule` para clínica QA

Identifica el `clinicId` de QA. Asume que existe una clínica DENTAL
llamada "MediFlow QA" o similar:

```sql
-- 1. Encuentra el clinicId de QA.
SELECT id, name, category FROM clinics
WHERE category = 'DENTAL' AND name ILIKE '%QA%'
LIMIT 5;

-- 2. Encuentra el moduleId de orthodontics.
SELECT id FROM modules WHERE key = 'orthodontics';

-- 3. Crea el ClinicModule activo (UPSERT).
INSERT INTO clinic_modules (id, "clinicId", "moduleId", status, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::TEXT,
  '<CLINIC_ID_QA>',
  '<ORTHO_MODULE_ID>',
  'active',
  NOW(),
  NOW()
)
ON CONFLICT ("clinicId", "moduleId")
DO UPDATE SET status = 'active', "updatedAt" = NOW();
```

### 2.4 Asignar permission `specialties.orthodontics` al rol QA

El permission ya está en `src/lib/auth/permissions.ts` con default para
DOCTOR y RECEPTIONIST. Si el `User` de QA tiene `permissionsOverride`,
agrégalo al array:

```sql
-- Solo si el usuario tiene override granular.
UPDATE users
SET "permissionsOverride" = array_append(
  "permissionsOverride", 'specialties.orthodontics'
)
WHERE email = '<QA_USER_EMAIL>'
  AND NOT 'specialties.orthodontics' = ANY("permissionsOverride");
```

Si NO hay override (`permissionsOverride = '{}'`), el rol default ya
incluye el permiso — no necesitas hacer nada.

---

## 3. Configurar `CRON_SECRET` en Vercel

### 3.1 Generar el secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Resultado: una cadena hex de 64 chars como `a3f9...e21b`.

### 3.2 Cargar en Vercel

1. Vercel Dashboard → proyecto MediFlow → **Settings** → **Environment Variables**.
2. Click **"Add New"**.
3. Configura:
   - **Name:** `CRON_SECRET`
   - **Value:** la cadena hex generada arriba.
   - **Environments:** marca solo `Production` (NO Preview, NO Development).
4. Click **"Save"**.

### 3.3 Verificar que `vercel.json` tiene el cron orto

```bash
cd C:/Users/Rafael/Documents/GitHub/mediflow-orto
cat vercel.json | grep orthodontics
# Debe imprimir:
#   "path": "/api/cron/orthodontics/recalculate-payment-status",
#   "schedule": "0 7 * * *"
```

### 3.4 Hacer un deploy en Vercel para que tome la nueva env var

```bash
git push origin feature/orthodontics-module-v1
# (Ya está pusheado tras F9.5; si haces cambios de F10, push del seed.)
```

Vercel detecta el push y auto-deploya. Espera el deploy verde antes
de seguir con la validación del cron.

---

## 4. Validar primera ejecución del cron

### 4.1 Trigger manual desde dashboard Vercel

1. Vercel Dashboard → proyecto MediFlow → **Cron Jobs**.
2. Busca `/api/cron/orthodontics/recalculate-payment-status` en la lista.
3. Click **"Run now"** (botón al lado del cron).
4. Espera el log. Resultado esperado:
   ```
   200 OK
   {
     "ok": true,
     "overdueMarked": <N>,
     "plansRecalculated": <N>,
     "plansFailed": 0,
     "dueIn3DaysReminders": <N>,
     "timestamp": "2026-05-..."
   }
   ```

### 4.2 Validar en base de datos

```sql
-- Si hubiera installments vencidas, deberían aparecer marcadas:
SELECT COUNT(*) FROM ortho_installments WHERE status = 'OVERDUE';

-- Si hubiera planes en transición a delay, deberían tener entrada en audit_log:
SELECT * FROM "AuditLog"
WHERE action = 'ortho.paymentStatus.recalculated'
ORDER BY "createdAt" DESC LIMIT 10;

-- Reminders de WA encolados por el cron:
SELECT COUNT(*) FROM whatsapp_reminders
WHERE type = 'ORTHO' AND "createdAt" > NOW() - INTERVAL '10 minutes';
```

### 4.3 Próximas ejecuciones automáticas

El cron ya está en `vercel.json` con schedule `0 7 * * *` = 7:00 AM UTC
diario = 1:00 AM CST de México. Vercel lo dispara automáticamente cada
día. Monitorea las primeras 3 ejecuciones desde el dashboard.

---

## 5. Cargar mock data + Demo end-to-end con Andrea

### 5.1 Cargar el seed de los 3 pacientes mock

```bash
cd C:/Users/Rafael/Documents/GitHub/mediflow-orto
DATABASE_URL="<PROD_DATABASE_URL>" \
DIRECT_URL="<PROD_DIRECT_URL>" \
npx tsx prisma/seeds/orthodontics-mock.ts
```

Resultado esperado:
```
[ortho-mock] Sembrando en clínica "MediFlow QA" con doctor <Nombre>.
[ortho-mock] OK: 3 pacientes sembrados (Andrea LEVELING, Sofía PLANNED, Mauricio ALIGNMENT).
```

### 5.2 Demo paso a paso — Andrea Reyes Domínguez

**Paso 1: Login + acceso al módulo**
1. Abre `https://<DOMINIO_PROD>/login`.
2. Login con el usuario QA (que tiene `specialties.orthodontics`).
3. En el sidebar, sección **Especialidades**, debe aparecer **"Ortodoncia"** con icono `Smile`.

**Paso 2: Kanban a nivel clínica**
1. Click en **"Ortodoncia"** del sidebar → te lleva a `/dashboard/specialties/orthodontics`.
2. Debes ver:
   - Header `Ortodoncia` con descripción.
   - **PaymentDelayWidget** con KPIs (Tratamientos activos: 3, Al corriente: 3, Atraso leve: 0, Atraso severo: 0, Total adeudado: $0).
   - 6 columnas (Alineación, Nivelación, Cierre de espacios, Detalles, Finalización, Retención).
   - **Andrea** en la columna **Nivelación** (mes 8/18).
   - **Mauricio** en la columna **Alineación** (mes 3/12).
   - **Sofía** NO aparece (status PLANNED, no IN_PROGRESS).

**Paso 3: Abrir Andrea**
1. Click en la card de Andrea → te lleva a `/dashboard/specialties/orthodontics/<andrea-id>`.
2. Debes ver:
   - Avatar + nombre + edad (≈29 años en 2026).
   - Topbar con "Volver al kanban" + "Expediente completo".
   - 5 sub-tabs: **Diagnóstico, Plan, Fotos, Controles, Pagos**.
   - Sub-tab activo por default: **Controles** (porque ya hay diagnóstico + plan).

**Paso 4: Verificar diagnóstico**
1. Click sub-tab **Diagnóstico**.
2. Debes ver: Clase II div 1 bilateral, overbite 4mm/35%, overjet 6mm,
   apiñamiento 4mm sup + 1.5mm inf, hábito DIGITAL_SUCKING,
   resumen clínico completo.

**Paso 5: Verificar plan + timeline**
1. Click sub-tab **Plan**.
2. Debes ver:
   - 6 KPIs (Técnica: metal_brackets, Duración: 18 meses, Mes actual: ~13, Costo: $47,200, Anclaje: moderate, Estado: in_progress).
   - Banner ámbar: `Extracciones planificadas: FDI 14, 24`.
   - **PhaseTimeline** con 6 fases:
     - ALIGNMENT: ✅ COMPLETED (verde, abr-oct 2024).
     - LEVELING: 🔵 IN_PROGRESS (azul pulsante, oct 2024 → feb 2025).
     - SPACE_CLOSURE → RETENTION: ⚪ NOT_STARTED (gris).
   - Botón **"Avanzar a Cierre de espacios"** disponible bajo LEVELING.
3. Plan de retención visible en card al final.

**Paso 6: Registrar pago**
1. Click sub-tab **Pagos**.
2. Debes ver:
   - 4 KPIs: Total $47,200, Pagado $20,800, Pendiente $26,400, Estado: Al corriente.
   - Barra de progreso ~44%.
   - Tabla de 18 mensualidades. Las primeras 7 marcadas PAID, las 11 restantes PENDING.
3. Click **"Pagar"** en la mensualidad #8 (vence 15-dic-2024 → estará vencida en 2026).
4. Drawer derecho **RecordPaymentDrawer** abre con:
   - DatePicker `paidAt` con default `today`.
   - NumberInput `amountPaid` con default `2400`.
   - Banner ámbar: "⚠ Fuera del rango ±60 días — exigirá justificación".
5. Click **"Confirmar pago"**.
6. Aparece **BackdateJustificationModal** con textarea + contador rojo.
7. Escribe: `"Pago en efectivo registrado en cuaderno físico, traspaso retrasado al sistema (demo F10)."` (≥20 chars → contador verde).
8. Click **"Confirmar registro"**.
9. Toast verde "Pago registrado".
10. Sub-tab Pagos refresca: mensualidad #8 ahora marcada PAID.
11. **AuditLog en BD:**
    ```sql
    SELECT action, changes FROM "AuditLog"
    WHERE action = 'ortho.installment.paid'
    ORDER BY "createdAt" DESC LIMIT 1;
    ```
    Debe aparecer la entrada con `backdatingJustification` en el changes JSON.

**Paso 7: Comparar fotos T0/T2**
1. Click sub-tab **Fotos**.
2. Como el seed NO incluye OrthoPhotoSet (placeholder en F9), verás
   estado vacío o sin sets para Andrea. **Para validar el comparativo:**
3. Click **"+ Nueva sesión fotográfica"** → wizard se abre.
4. Selecciona tipo `T0`, fecha hoy. Click "Siguiente".
5. En cada vista, sube una foto de prueba (cualquier imagen). Validar:
   - Banner verde "Subida" tras cada upload.
   - Foto aparece como background del área del wizard.
   - Si una foto falla, banner ámbar "1 foto pendiente — reintentar".
6. Tras las 8 vistas, click **"Guardar"**.
7. Crear segundo set con tipo `T2` y subir 8 fotos distintas.
8. Click botón **"Comparar T0 vs T2"** que aparece en el header de
   PhotoSetGrid.
9. Modal full-screen con `PhotoCompareSlider`. Mueve el slider para
   alternar entre T0 y T2 en cada vista. Probar las 8 vistas con el
   selector.

**Paso 8: Avanzar fase**
1. Vuelve a sub-tab **Plan**.
2. Click **"Avanzar a Cierre de espacios"** bajo LEVELING.
3. Toast verde "Fase avanzada a SPACE_CLOSURE".
4. Timeline actualiza: LEVELING → COMPLETED, SPACE_CLOSURE → IN_PROGRESS.
5. **AuditLog:**
    ```sql
    SELECT action, changes FROM "AuditLog"
    WHERE action = 'ortho.phase.advanced'
    ORDER BY "createdAt" DESC LIMIT 1;
    ```

**Paso 9: Plan PDF**
1. Sub-tab Pagos → click **"Acuerdo PDF"** en `PaymentPlanView`.
2. Se abre el PDF en otra pestaña. Verifica:
   - 2 páginas A4 vertical.
   - Tabla de mensualidades pre-poblada.
   - Cláusulas legales + firmas.
3. (Opcional) `https://<DOMINIO>/api/orthodontics/treatment-plans/<andrea-plan-id>/treatment-plan-pdf` → 4 páginas A4.
4. (Opcional) `https://<DOMINIO>/api/orthodontics/treatment-plans/<andrea-plan-id>/progress-report-pdf` → 2 páginas A4 horizontal con grid 4×2 T0 vs T2.

**Paso 10: Verificar tab embebida en patient-detail**
1. Click "Volver al kanban" → click "Expediente completo" sobre Andrea.
2. Te lleva a `/dashboard/patients/<andrea-id>`.
3. **Pendiente conocido:** la integración como tab dentro del
   patient-detail-client está documentada en `OrthodonticsClient` pero
   NO está cableada al patient-detail global. Por ahora abre directo
   `/dashboard/patients/<andrea-id>/orthodontics` para verla embebida.

---

## 6. Rollback plan

### 6.1 Si la migración falla a media corrida

La migración es idempotente — re-ejecutarla retoma desde donde se quedó.
Si sigue fallando con un error específico:

```sql
-- Ver qué tablas alcanzaron a crearse:
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'ortho%';

-- Ver qué constraints se crearon:
SELECT conname FROM pg_constraint WHERE conname LIKE '%ortho%';

-- Si necesitas borrar y reintentar limpio (DESTRUCTIVO — solo en QA):
DROP TABLE IF EXISTS "orthodontic_consents" CASCADE;
DROP TABLE IF EXISTS "orthodontic_digital_records" CASCADE;
DROP TABLE IF EXISTS "orthodontic_control_appointments" CASCADE;
DROP TABLE IF EXISTS "ortho_photo_sets" CASCADE;
DROP TABLE IF EXISTS "ortho_installments" CASCADE;
DROP TABLE IF EXISTS "ortho_payment_plans" CASCADE;
DROP TABLE IF EXISTS "orthodontic_phases" CASCADE;
DROP TABLE IF EXISTS "orthodontic_treatment_plans" CASCADE;
DROP TABLE IF EXISTS "orthodontic_diagnoses" CASCADE;
DROP TYPE IF EXISTS "AngleClass" CASCADE;
DROP TYPE IF EXISTS "OrthoTechnique" CASCADE;
-- ... (los 18 enums) ...
DROP FUNCTION IF EXISTS ortho_recalc_payment_plan_status() CASCADE;
```

> **NUNCA ejecutar el DROP en producción** sin autorización explícita
> de Rafael. La migración es idempotente; preferir re-ejecutarla.

### 6.2 Si el cron falla la primera ejecución

1. Vercel Dashboard → Logs del endpoint `/api/cron/orthodontics/...`.
2. Errores comunes:
   - `UNAUTHORIZED` → `CRON_SECRET` no configurado o mal pegado.
   - `Module not active` → falta `ClinicModule` activo.
   - Error de Prisma → schema no aplicado en BD (migration falló).
3. Workaround: invocar `recalculatePaymentStatus` manualmente desde
   el botón "Recalcular ahora" en `PaymentPlanView` para cada plan
   afectado.

### 6.3 Si alguna foto no sube

`/api/orthodontics/photos/upload` falla típicamente por:
- `SUPABASE_SERVICE_ROLE_KEY` no configurada en env vars.
- Bucket `patient-files` no existe → crearlo en Supabase Storage.
- `sharp` no compatible con la arquitectura del runtime → verificar
  que Vercel construye con `sharp` para Linux x64 (default).

### 6.4 Desactivar el módulo si urge

```sql
-- Quita el módulo del marketplace sin borrar datos:
UPDATE modules SET "isActive" = false WHERE key = 'orthodontics';

-- Desactiva el ClinicModule QA temporalmente:
UPDATE clinic_modules SET status = 'paused'
WHERE "moduleId" = (SELECT id FROM modules WHERE key = 'orthodontics');
```

Los datos quedan intactos. Para reactivar: revertir los UPDATE.

---

## 7. Checklist final pre-go-live

- [ ] Backup snapshot Supabase Production creado.
- [ ] Migración SQL aplicada y validada (5 queries de §1.3 OK).
- [ ] `Module orthodontics` en `modules` con `priceMxnMonthly = 329` y `iconKey = 'Smile'`.
- [ ] `ClinicModule` activo para clínica QA.
- [ ] Permiso `specialties.orthodontics` en rol DOCTOR/RECEPTIONIST de QA.
- [ ] `CRON_SECRET` configurado en Vercel Production.
- [ ] Deploy Vercel verde tras configurar CRON_SECRET.
- [ ] Cron `0 7 * * *` ejecutado manualmente con éxito (200 OK).
- [ ] Mock seed de 3 pacientes cargado.
- [ ] Demo end-to-end con Andrea completado (10 pasos §5.2).
- [ ] AuditLog tiene entradas `ortho.installment.paid` y `ortho.phase.advanced`.
- [ ] Tab Ortodoncia embebida en patient-detail global — **diferida a iteración post-QA**.
- [ ] Comunicación a usuarios piloto enviada (email/WhatsApp con link al módulo).

---

## 8. Pendientes para v1.1 (NO bloquean go-live)

Documentados en `src/components/specialties/orthodontics/README.md`:

- Badge brackets/alineadores en odontograma global.
- Sub-ítems orto en `TreatmentPlan` general.
- Re-encolado de WA cuando se actualiza `installedAt` con `updateTreatmentPlan`.
- Cefalometría con captura numérica Steiner/Ricketts/Jarabak.
- Tracking detallado de alineadores + IPR + TADs.
- Tests E2E Playwright + RLS multi-tenant + Storybook (requieren infra
  no instalada en el repo).
- Tab Ortodoncia integrada como tab del `patient-detail-client.tsx`
  global (similar a Pediatría).

---

## Apéndice A — Notas sobre `prisma migrate diff` dry-run

El comando original de F10 paso 1:

```bash
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Falla en local con:
```
Error: P1012 — Environment variable not found: DIRECT_URL.
```

Razón: `--from-schema-datasource` apunta al `datasource` del schema, que
incluye `directUrl = env("DIRECT_URL")`. Sin acceso a la BD real, Prisma
no puede leer el estado actual.

**Workaround para Rafael durante el deploy real:**
```bash
DATABASE_URL="<PROD_DATABASE_URL>" \
DIRECT_URL="<PROD_DIRECT_URL>" \
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script | tee /tmp/orto-diff.sql
```

Si el archivo resultante está vacío o solo tiene comentarios → la BD ya
está al día con el schema y no se necesita aplicar la migración. Si tiene
DDL → se necesita aplicar (idealmente vía SQL editor del paso 1.2 con la
migración pre-escrita en `prisma/migrations/20260505000000_orthodontics_module/migration.sql`,
no con el output del diff que es menos idempotente).
