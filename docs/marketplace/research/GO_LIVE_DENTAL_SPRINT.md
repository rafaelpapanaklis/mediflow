# GO-LIVE — Sprint Cierre Dental (5 módulos)

Runbook consolidado para lanzar **Endodoncia + Periodoncia + Ortodoncia + Implantología + Odontopediatría** en una sola sesión nocturna sobre `feature/implant-phase-8-v1`.

> **Lee §0 completo antes de empezar.** Tiempo estimado total: **45–90 min**. Ventana recomendada: martes/miércoles 23:00–01:00 MX (poco tráfico, 8 h para detectar issues antes del horario laboral).

---

## §0 Pre-requisitos

### Acceso requerido
- [ ] Cuenta Supabase con rol `service_role` para el SQL Editor (proyecto MediFlow producción).
- [ ] Cuenta Vercel con rol `Owner` o `Member` con permiso de deploy a producción.
- [ ] Acceso a la consola de Twilio/Meta WhatsApp Business (verificar cuotas).
- [ ] Terminal con `git`, `npm`, `npx`, `gh` (GitHub CLI), y `psql` instalados.
- [ ] Repo clonado y branch checked out: `feature/implant-phase-8-v1`.

### Variables de entorno requeridas en Vercel (`Production`)
| Variable | Origen | Notas |
|---|---|---|
| `DATABASE_URL` | Supabase Connection String — Pooler | Ya configurada |
| `DIRECT_URL` | Supabase Connection String — Direct | Ya configurada (para `prisma migrate diff`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project Settings | Ya configurada |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Project Settings | Ya configurada |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project Settings | Ya configurada |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | **Requerido para XrayAnalysis modes** |
| `CRON_SECRET` | Generar nuevo — ver §2 | **Nuevo en este sprint** — para `/api/cron/whatsapp-queue` |
| `NEXT_PUBLIC_APP_URL` | https://mediflow.app | Ya configurada |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com → API keys | Para teleconsulta + marketplace |
| `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com → Webhooks | Ya configurada |
| `DAILY_API_KEY` | dashboard.daily.co | Para teleconsulta |

### Backup obligatorio
- [ ] Snapshot de Supabase Postgres (Settings → Database → Backups → Create Backup). Espera ✅ "Completed" antes de continuar.
- [ ] Tag git de la versión actual de producción: `git tag pre-dental-go-live-$(date +%Y%m%d)` y push.
- [ ] Captura del estado actual del marketplace (lista de módulos activos por clínica) — sólo lectura SQL:
  ```sql
  SELECT c.name, m.key, cm.status, cm."current_period_end"
  FROM clinic_modules cm
  JOIN clinics c ON c.id = cm."clinic_id"
  JOIN modules m ON m.id = cm."module_id"
  WHERE cm.status = 'ACTIVE'
  ORDER BY c.name, m.key;
  ```
  Guarda el resultado en `runbook-pre-state-$(date).csv` por si hay rollback.

---

## §1 Aplicar 5 migraciones en orden

> **Editor:** Supabase Dashboard → SQL Editor del proyecto MediFlow.
>
> **Orden estricto:** las FKs cross-módulo dependen de tablas creadas por migraciones anteriores. Saltarse una rompe la siguiente.

### 1.1 `20260430160000_pediatrics_module` (si aún no aplicada)

Verifica primero:
```sql
SELECT 1 FROM pg_tables WHERE tablename = 'pediatric_records' LIMIT 1;
```
Si retorna 0 filas, aplica:
```bash
cat prisma/migrations/20260430160000_pediatrics_module/migration.sql
# pega en SQL Editor
```
Validación post:
```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_name IN ('pediatric_records', 'ped_endodontic_treatments');
-- esperado: 2
```

### 1.2 `20260504100000_endodontics_module`

```sql
SELECT 1 FROM pg_tables WHERE tablename = 'endodontic_diagnoses' LIMIT 1;
```
Si 0 filas, pega `prisma/migrations/20260504100000_endodontics_module/migration.sql`.

Validación:
```sql
SELECT tablename FROM pg_tables
WHERE tablename IN (
  'endodontic_diagnoses', 'vitality_tests', 'endodontic_treatments',
  'root_canals', 'intracanal_medications', 'endodontic_follow_ups',
  'endodontic_retreatment_info', 'apical_surgeries'
)
ORDER BY tablename;
-- esperado: 8 filas
```

### 1.3 `20260504160000_periodontics_module`

```sql
SELECT 1 FROM pg_tables WHERE tablename = 'periodontal_classifications' LIMIT 1;
```
Pega `prisma/migrations/20260504160000_periodontics_module/migration.sql`.

Validación:
```sql
SELECT tablename FROM pg_tables
WHERE tablename IN (
  'periodontal_records', 'periodontal_classifications', 'gingival_recessions',
  'periodontal_treatment_plans', 'srp_sessions', 'periodontal_reevaluations',
  'periodontal_risk_assessments', 'periodontal_surgeries', 'peri_implant_assessments'
)
ORDER BY tablename;
-- esperado: 9 filas
```

### 1.4 `20260504200000_implants_module`

```sql
SELECT 1 FROM pg_tables WHERE tablename = 'implants' LIMIT 1;
```
Pega `prisma/migrations/20260504200000_implants_module/migration.sql`.

Validación:
```sql
SELECT tablename FROM pg_tables
WHERE tablename IN (
  'implants', 'implant_surgical_records', 'implant_healing_phases',
  'implant_second_stage_surgeries', 'implant_prosthetic_phases',
  'implant_complications', 'implant_follow_ups', 'implant_consents',
  'implant_passports'
)
ORDER BY tablename;
-- esperado: 9 filas
```

### 1.5 `20260504210000_drop_implant_traceability_trigger`

Eliminó un trigger que rompía con el pooler. **Aplicar siempre**:
```bash
cat prisma/migrations/20260504210000_drop_implant_traceability_trigger/migration.sql
```
Validación:
```sql
SELECT tgname FROM pg_trigger WHERE tgname = 'protect_implant_traceability';
-- esperado: 0 filas
```

### 1.6 `20260505000000_orthodontics_module`

```sql
SELECT 1 FROM pg_tables WHERE tablename = 'orthodontic_diagnoses' LIMIT 1;
```
Pega `prisma/migrations/20260505000000_orthodontics_module/migration.sql`.

Validación:
```sql
SELECT tablename FROM pg_tables
WHERE tablename IN (
  'orthodontic_diagnoses', 'orthodontic_treatment_plans', 'orthodontic_phases',
  'ortho_payment_plans', 'ortho_installments', 'ortho_photo_sets',
  'orthodontic_control_appointments', 'orthodontic_digital_records',
  'orthodontic_consents'
)
ORDER BY tablename;
-- esperado: 9 filas
```

### 1.7 `20260505100000_dental_cross_modules` ⭐ ÚLTIMA — depende de implants

```bash
cat prisma/migrations/20260505100000_dental_cross_modules/migration.sql
```

Validación:
```sql
-- WhatsAppReminder.payload column
SELECT column_name FROM information_schema.columns
WHERE table_name = 'whatsapp_reminders' AND column_name = 'payload';
-- esperado: payload

-- XrayAnalysisMode enum
SELECT typname FROM pg_type WHERE typname = 'XrayAnalysisMode';
-- esperado: XrayAnalysisMode

-- xray_analyses.mode + measurements
SELECT column_name FROM information_schema.columns
WHERE table_name = 'xray_analyses' AND column_name IN ('mode', 'measurements');
-- esperado: 2 filas

-- FK PeriImplantAssessment → Implant
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'peri_implant_assessments'
  AND constraint_name = 'peri_implant_assessments_implantId_fkey';
-- esperado: 1 fila
```

### Rollback de una migración

Las migraciones son aditivas (no DROP nada). Para revertir:
```sql
-- Ejemplo para revertir 20260505100000_dental_cross_modules
ALTER TABLE "peri_implant_assessments" DROP CONSTRAINT IF EXISTS "peri_implant_assessments_implantId_fkey";
ALTER TABLE "xray_analyses" DROP COLUMN IF EXISTS "measurements";
ALTER TABLE "xray_analyses" DROP COLUMN IF EXISTS "mode";
DROP TYPE IF EXISTS "XrayAnalysisMode";
ALTER TABLE "whatsapp_reminders" DROP COLUMN IF EXISTS "payload";
```
**Nunca drop tablas con datos** sin restaurar primero el snapshot. Si una migración falla a mitad, restaurar snapshot Supabase es más seguro que drop manual.

---

## §2 Configurar env vars en Vercel

### Generar `CRON_SECRET`
```bash
openssl rand -hex 32
# copia el output (64 caracteres hex)
```

### Agregar a Vercel
```bash
vercel env add CRON_SECRET production
# pega el valor cuando pregunte
vercel env add ANTHROPIC_API_KEY production
# pega tu API key de console.anthropic.com
```

### Verificar todas
```bash
vercel env ls production | grep -E "CRON_SECRET|ANTHROPIC_API_KEY|DATABASE_URL"
```
Las 3 deben aparecer.

### Re-deploy para que tomen efecto
```bash
vercel deploy --prod
```
Espera ~3 min al "Ready". Captura la URL del deploy para validación.

---

## §3 Aplicar seed marketplace

> **Importante:** el seed es idempotente — usa `upsert` por `key`. Re-correr no duplica.

```bash
npm run db:seed
```

Si `db:seed` no existe en `package.json`, alternativa:
```bash
npx tsx prisma/seed.ts
```

Validación post:
```sql
SELECT key, name, "price_mxn_monthly", "is_active"
FROM modules
WHERE key IN ('endodontics', 'periodontics', 'orthodontics', 'implants', 'pediatric-dentistry')
ORDER BY key;
-- esperado: 5 filas, todas is_active=true, prices > 0
```

> ⚠️ **Heads-up:** el seed tenía un bug pre-go-live donde la key del implant era `implantology` (ahora corregido a `implants`). Si la BD ya tiene un registro con key=`implantology`, primero ejecuta:
> ```sql
> DELETE FROM modules WHERE key = 'implantology';
> ```
> Antes del seed.

---

## §4 Activar `ClinicModule` para clínica piloto

Sustituye `<CLINIC_ID>` por el ID de la clínica piloto. Sustituye `<NOW>` por la fecha del día (`CURRENT_DATE` funciona).

```sql
-- Activa los 5 módulos dentales para la clínica piloto
WITH clinic_pilot AS (SELECT id FROM clinics WHERE id = '<CLINIC_ID>'),
     mods AS (
       SELECT id, key, "price_mxn_monthly"
       FROM modules
       WHERE key IN ('endodontics', 'periodontics', 'orthodontics', 'implants', 'pediatric-dentistry')
     )
INSERT INTO clinic_modules (
  id, clinic_id, module_id, status, billing_cycle,
  activated_at, current_period_start, current_period_end,
  payment_method, price_paid_mxn
)
SELECT
  gen_random_uuid()::text,
  cp.id,
  m.id,
  'ACTIVE',
  'MONTHLY',
  NOW(),
  NOW(),
  NOW() + INTERVAL '30 days',
  'STRIPE',
  m."price_mxn_monthly"
FROM clinic_pilot cp CROSS JOIN mods m
ON CONFLICT (clinic_id, module_id) DO UPDATE SET
  status = 'ACTIVE',
  current_period_end = NOW() + INTERVAL '30 days';
```

Validación:
```sql
SELECT m.key, cm.status, cm."current_period_end"
FROM clinic_modules cm
JOIN modules m ON m.id = cm."module_id"
WHERE cm."clinic_id" = '<CLINIC_ID>' AND m.key IN (
  'endodontics', 'periodontics', 'orthodontics', 'implants', 'pediatric-dentistry'
);
-- esperado: 5 filas, todas ACTIVE
```

---

## §5 Validar primera ejecución de los crons desde Vercel Dashboard

Vercel → tu proyecto → **Cron Jobs**. Deberías ver 6 entradas:
- `/api/cron/annual-reminder` — daily 16:00 UTC
- `/api/cron/weekly-insights` — Monday 04:00 UTC
- `/api/cron/retention` — daily 09:00 UTC
- `/api/cron/db-export` — Sunday 10:00 UTC
- `/api/cron/orthodontics/recalculate-payment-status` — daily 07:00 UTC
- `/api/cron/whatsapp-queue` — every 15 min ⭐ NUEVO

### Trigger manual desde Vercel
Click en `/api/cron/whatsapp-queue` → **Run** (botón). Espera la respuesta. Esperado:
```json
{"picked": 0, "sent": 0, "failed": 0, "skipped": 0, "errors": []}
```
Si retorna `503` → `CRON_SECRET` no configurado. Si `401` → secret incorrecto.

### Trigger manual desde terminal
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://mediflow.app/api/cron/whatsapp-queue
curl -H "Authorization: Bearer $CRON_SECRET" https://mediflow.app/api/cron/orthodontics/recalculate-payment-status
```

---

## §6 Demo end-to-end consolidado

3 seeds preparados de cada sprint (pacientes mock): cargar e inspeccionar el flow.

### 6.1 Pacientes mock
| Especialidad | Paciente | Origen |
|---|---|---|
| Ortodoncia | Andrea Vázquez | `prisma/seeds/orthodontics-mock.ts` |
| Periodoncia | Manuel Hernández | `prisma/seeds/periodontics-mock.ts` |
| Implantología | Roberto Mendoza | implant module seed (commit `5a58be9`) |
| Endodoncia | Patricia Reyes | (validar — endo seed no tiene archivo dedicado, agregar si falta) |
| Pediatría | Sofía Ramírez | módulo pediatría seed |

### 6.2 Recorrido manual (15 min)
1. **Login** como doctor de la clínica piloto.
2. **Sidebar** debe mostrar 5 nuevos íconos en "Especialidades" (Baby, Zap, Activity, Smile, Anchor).
3. **Endodoncia** → click Patricia → click diente 36 → drawer Diagnosis → captura → drawer Vitality → wizard de TC step 1 → guardar.
4. **Periodoncia** → click Manuel → carga periodontograma → registra recesiones → genera SRPSession.
5. **Ortodoncia** → click Andrea → kanban → drag Andrea de Alineación a Nivelación → registra MONTHLY_PROGRESS automático.
6. **Implantología** → click Roberto → selecciona implante 16 → MaintenanceDrawer → captura BoP+ → debe crear PeriImplantAssessment con status MUCOSITIS automático.
7. **Cross-module check**: vuelve a Periodoncia → tab del paciente Roberto → verifica que el PeriImplantAssessment del paso 6 aparece.
8. **Pediatría** → click Sofía → tab pediatría → consentimiento parental + escala Frankl.
9. **PDFs** → desde Endodoncia genera el PDF de informe legal NOM-024 → debe descargar.
10. **WhatsApp queue** → en Implantología completa una cirugía → debe encolarse `IMPLANT_POST_PLACEMENT_DAY_0` en `whatsapp_reminders`.

---

## §7 Checklist final 20 ítems pre-go-live

- [ ] 1. Backup snapshot Supabase confirmado ✅
- [ ] 2. Tag git `pre-dental-go-live-YYYYMMDD` pushed
- [ ] 3. Las 7 migraciones aplicadas en orden (validaciones SQL post cada una)
- [ ] 4. `CRON_SECRET` agregado a Vercel production
- [ ] 5. `ANTHROPIC_API_KEY` agregado/actualizado a Vercel production
- [ ] 6. Re-deploy completado, "Ready" en Vercel
- [ ] 7. `npm run db:seed` ejecutado, 5 modules activos en `modules` table
- [ ] 8. Clínica piloto con 5 ClinicModule ACTIVE (query §4)
- [ ] 9. `npx tsx scripts/smoke-test-dental.ts` → todos verdes
- [ ] 10. Cron `/api/cron/whatsapp-queue` responde 200 manual
- [ ] 11. Cron `/api/cron/orthodontics/recalculate-payment-status` responde 200 manual
- [ ] 12. Sidebar muestra 5 íconos nuevos en login real (Baby, Zap, Activity, Smile, Anchor)
- [ ] 13. Demo end-to-end §6 ejecutado sin errores en console del navegador
- [ ] 14. PDF endo legal NOM-024 descarga correctamente
- [ ] 15. PeriImplantAssessment cross-module visible desde Perio + Implant
- [ ] 16. RLS deny-all confirmada en las 6 tablas sensibles (smoke test)
- [ ] 17. Audit log registra entradas correctas tras los flows del demo
- [ ] 18. Vercel logs sin errores 500 en últimos 30 min post-deploy
- [ ] 19. WhatsApp Cloud API quota no excedida (Meta Business Manager → Insights)
- [ ] 20. Comunicación interna lista (Slack/email) con resumen de qué se lanzó y cómo reportar issues

---

## §8 Troubleshooting common issues

### Migración falla con "constraint already exists"
Las migraciones son idempotentes — usan `IF NOT EXISTS`. Si una falla:
1. Captura el error completo.
2. Comprueba qué objeto ya existe: `SELECT * FROM pg_constraint WHERE conname = '<nombre>';`.
3. Si la migración previa terminó parcialmente → restaurar snapshot y re-aplicar todas.

### Cron `/api/cron/whatsapp-queue` retorna 401
- Verifica `CRON_SECRET` en Vercel: `vercel env ls production | grep CRON_SECRET`.
- Verifica que el header sea `Authorization: Bearer <secret>` (case-sensitive).
- Re-deploy si acabas de cambiarla — vars sólo aplican post-deploy.

### Cron retorna 503
- `CRON_SECRET` no configurado. Ver §2.

### RLS bloqueando queries en producción
La pista típica: `permission denied for table <X>` aún siendo super_admin.
- Verifica que el cliente Prisma usa `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS) en server actions, no anon key.
- Verifica que las policies `<X>_deny_all USING (false)` solo aplican para roles `anon` y `authenticated`, NO para `service_role`.

### Módulo no aparece en sidebar
1. ¿`ClinicModule` activo? `SELECT * FROM clinic_modules WHERE clinic_id = '<X>' AND status = 'ACTIVE';`
2. ¿`Module.is_active = true`? `SELECT * FROM modules WHERE key = '<X>';`
3. ¿Permission del usuario? `SELECT permissions_override FROM users WHERE id = '<X>';` — debe contener `specialties.<modulo>` o estar vacío (defaults aplicados).
4. ¿Categoría DENTAL? `SELECT category FROM clinics WHERE id = '<X>';` — los 5 módulos exigen `category=DENTAL`.

### PeriImplantAssessment no se crea desde MaintenanceDrawer
- Verifica que la migración `20260505100000_dental_cross_modules` aplicó la FK (smoke test §4).
- Si falla con "column implantId not found": el modelo Implant del módulo Implantología no se aplicó. Reaplica `20260504200000_implants_module`.

### XrayAnalysis modo periodontal/periimplantar falla con "503 IA no configurada"
- `ANTHROPIC_API_KEY` no en Vercel. Re-aplicar §2 + redeploy.

### Sidebar muestra 4 specialties pero falta una
Bug histórico de permisos. Reset:
```sql
UPDATE users SET permissions_override = '[]'::jsonb WHERE clinic_id = '<X>';
```
Esto fuerza el uso de defaults que incluyen los 5 specialty perms.

---

## §9 Plan de merge a main

**Estado actual:** 4 branches stacked (orto → endo-closure → cross-modules → implant-phase-8).

### Opción A — 4 PRs secuenciales (recomendada para producción real)
Pros: revisión incremental, rollback granular, blame claro por sprint.
Contras: 4 ventanas de merge, riesgo de conflictos si se demoran.

```
PR1: feature/orthodontics-module-v1     → main  (~9000 líneas)
PR2: feature/endodontics-closure-v1     → main  (post-PR1)
PR3: feature/dental-cross-modules-v1    → main  (post-PR2)
PR4: feature/implant-phase-8-v1         → main  (post-PR3, incluye módulo implant)
```

Cada PR debe pasar:
- `npm run build` verde
- `npx tsx --test src/lib/**/*.test.ts` verde
- Review de al menos 1 reviewer

### Opción B — 1 PR consolidado desde `feature/implant-phase-8-v1`
Pros: 1 ventana de merge, sin orden a seguir.
Contras: PR de ~25k líneas, review difícil, blame único.

```
PR: feature/implant-phase-8-v1 → main  (~25000 líneas, 5 módulos completos)
```

### Recomendación
**Opción A si vas a hacer code review formal.** Opción B si ya hiciste QA conjunta y solo necesitas mergear el estado validado. La cadena de stacked branches está diseñada para Opción A — el orden de timestamps de migraciones lo respeta.

---

## §10 Rollback plan completo

### Rollback nivel 1 — feature flag
Si un módulo específico tiene bugs, desactívalo sin revertir código:
```sql
UPDATE modules SET is_active = false WHERE key = '<module-key>';
-- el sidebar deja de mostrarlo, los gates server-side cierran acceso
```

### Rollback nivel 2 — clínica específica
Solo afecta a una clínica:
```sql
UPDATE clinic_modules SET status = 'CANCELLED', cancelled_at = NOW()
WHERE clinic_id = '<CLINIC_ID>' AND module_id IN (
  SELECT id FROM modules WHERE key IN ('endodontics', 'orthodontics', 'periodontics', 'implants', 'pediatric-dentistry')
);
```

### Rollback nivel 3 — código
```bash
git checkout main
git revert <merge-commit-sha> -m 1
git push origin main
vercel deploy --prod
```
**Nota:** revertir el merge no deshace migraciones. La BD queda con tablas nuevas (sin uso). Inocuo.

### Rollback nivel 4 — base de datos completa
**SOLO si las migraciones causaron pérdida de datos.**
1. Vercel → set producción a la versión anterior al deploy.
2. Supabase → Database → Backups → Restore al snapshot pre-go-live.
3. Avisar a usuarios afectados (datos creados entre el deploy y el restore se pierden).
4. Investigar root cause antes de re-intentar.

---

## §11 Cheat sheet de comandos (copy/paste cronológico)

> Sustituye `<CRON_SECRET_VALUE>`, `<ANTHROPIC_KEY>`, `<CLINIC_ID>` por valores reales.

```bash
# ─── Pre-deploy ───────────────────────────────────────────────────────
git checkout feature/implant-phase-8-v1
git pull
git tag pre-dental-go-live-$(date +%Y%m%d)
git push --tags
# Si falla: ya existe el tag. Cambia el sufijo (-am, -pm, -v2).

# ─── Backup snapshot ──────────────────────────────────────────────────
# Supabase Dashboard → Database → Backups → "Create Backup"
# Espera ✅ "Completed". Si falla: contactar soporte Supabase, NO continuar.

# ─── Migraciones (Supabase SQL Editor — copia el contenido de cada .sql) ──
cat prisma/migrations/20260430160000_pediatrics_module/migration.sql       # Si tabla pediatric_records no existe
cat prisma/migrations/20260504100000_endodontics_module/migration.sql      # Si endodontic_diagnoses no existe
cat prisma/migrations/20260504160000_periodontics_module/migration.sql     # Si periodontal_classifications no existe
cat prisma/migrations/20260504200000_implants_module/migration.sql         # Si implants no existe
cat prisma/migrations/20260504210000_drop_implant_traceability_trigger/migration.sql  # Siempre
cat prisma/migrations/20260505000000_orthodontics_module/migration.sql     # Si orthodontic_diagnoses no existe
cat prisma/migrations/20260505100000_dental_cross_modules/migration.sql    # SIEMPRE — depende de implants
# Si una falla: PARA. Captura el error. Restaura snapshot si hay datos comprometidos.

# ─── Seed marketplace (idempotente) ──────────────────────────────────
npm run db:seed
# Si falla "module not found": npx tsx prisma/seed.ts
# Si falla con duplicate key 'implantology': DELETE FROM modules WHERE key='implantology'; y reintentar.

# ─── Activar clínica piloto (sustituye <CLINIC_ID>) ──────────────────
# Pegar el SQL de §4 en Supabase SQL Editor

# ─── Vercel env vars ──────────────────────────────────────────────────
openssl rand -hex 32   # copia el output → <CRON_SECRET_VALUE>
vercel env add CRON_SECRET production
# pegar <CRON_SECRET_VALUE> cuando pregunte
vercel env add ANTHROPIC_API_KEY production
# pegar <ANTHROPIC_KEY> cuando pregunte
# Si falla "command not found": npm i -g vercel y vercel login.

vercel deploy --prod
# Espera "Ready". Si falla: revisar logs en dashboard.

# ─── Smoke test ───────────────────────────────────────────────────────
export DATABASE_URL='<production-database-url>'
export NEXT_PUBLIC_APP_URL='https://mediflow.app'
export CRON_SECRET='<CRON_SECRET_VALUE>'
npx tsx scripts/smoke-test-dental.ts
# Si algún check rojo: lee §8 Troubleshooting. NO mergear hasta resolver.

# ─── Demo end-to-end ──────────────────────────────────────────────────
# Login como doctor piloto en https://mediflow.app
# Ejecutar §6 paso por paso. Si algún flow falla: NO mergear.

# ─── Merge a main (al final, post-validación) ────────────────────────
# Opción A — 4 PRs:
gh pr create --base main --head feature/orthodontics-module-v1   --title "Sprint dental 1/4: Ortodoncia"
gh pr create --base main --head feature/endodontics-closure-v1   --title "Sprint dental 2/4: Endo cierre"
gh pr create --base main --head feature/dental-cross-modules-v1  --title "Sprint dental 3/4: Cross-módulos"
gh pr create --base main --head feature/implant-phase-8-v1       --title "Sprint dental 4/4: Implantología + Phase 8"
# Mergear en orden, esperando CI verde de cada uno.

# Opción B — 1 PR consolidado:
gh pr create --base main --head feature/implant-phase-8-v1 \
  --title "Sprint dental: 5 módulos consolidados" \
  --body "Ortho + Endo cierre + Cross-módulos + Implant Phase 8. Ver docs/marketplace/research/GO_LIVE_DENTAL_SPRINT.md"

# Cuando el PR esté merged en main:
git checkout main
git pull
git tag dental-launch-$(date +%Y%m%d)
git push --tags
vercel deploy --prod
# Si el deploy de main difiere del de feature: smoke test de nuevo.
```

---

## Pendientes detectados durante prep (para post-launch)

1. **Endo seed** — falta archivo `prisma/seeds/endodontics-mock.ts`. Demo paso §6.4 asume Patricia Reyes; si no existe, crear pre-go-live o sustituir por crear paciente manual.
2. **TreatmentPlan sub-items** (Implant Phase 8 Item 2) — helpers existen, UI de fases con countdown pendiente. No bloquea go-live.
3. **Validación E2E con implantólogo real** (Roberto end-to-end) — pendiente del sprint Implant Phase 10. No bloquea go-live técnico, sí bloquea soft launch a clientes externos.
4. **Tercera variante de PDF Endo** — confirmado: SPEC §11 lista solo 2. No hay 3er PDF que agregar.
