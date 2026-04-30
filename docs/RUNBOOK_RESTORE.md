# Runbook · Restore de base de datos

Última actualización: 2026-04-30
Owner on-call: Rafael Papanaklis

Este runbook describe el procedimiento paso a paso para restaurar
MediFlow en caso de pérdida de datos (corrupción, drop accidental, ataque).

## Cuándo usar este runbook

Disparadores:
- Pérdida masiva de datos confirmada en producción.
- Drop o truncate accidental sobre una tabla crítica (`patients`,
  `medical_records`, `appointments`, `invoices`, `audit_logs`).
- Compromiso de seguridad que obligue a roll-back a un punto previo.
- Cliente reporta "no veo mis pacientes" y se descartó bug de UI.

## Tiempos objetivo

| Métrica | Objetivo |
|---|---|
| RTO (Recovery Time Objective) | 4 horas |
| RPO (Recovery Point Objective) | 5 minutos (PITR Pro) / 24h (Free) |

## Precondiciones

- Acceso a Supabase Dashboard del proyecto (rafaelpapanaklis@gmail.com).
- Acceso a Vercel (para detener tráfico si es necesario).
- `DATA_ENCRYPTION_KEY` actual disponible (1Password / vault).
- Acceso a `CRON_SECRET` para verificar crons post-restore.

## Procedimiento

### Paso 1 — Detener tráfico de escritura

Para evitar que se mezclen datos nuevos con datos restaurados:

1. Vercel → Project Settings → Deployment Protection → Habilitar
   "Maintenance Mode" (Enterprise) o redeployar con flag `MAINTENANCE=true`
   que bloquee escrituras (TODO: implementar este flag).
2. Notificar a clínicas vía banner (`/api/admin/announcements`).

### Paso 2 — Identificar el snapshot válido más reciente

#### Opción A — PITR (plan Pro+)

1. Supabase Dashboard → Database → Backups → "Point in Time Recovery".
2. Elegir timestamp **antes** del incidente (granularidad de segundo).
3. Crear nuevo proyecto restaurado o restaurar in-place (in-place
   sobreescribe el actual — usar con cuidado).

#### Opción B — Snapshot diario (plan Free)

1. Supabase Dashboard → Database → Backups → "Daily Backups".
2. Elegir el snapshot más reciente anterior al incidente.
3. "Restore" → confirma → espera 10-30 min según tamaño.

#### Opción C — Dump cifrado semanal (último recurso)

Si Supabase backups fallan por completo:
1. Storage → `patient-files` → carpeta `db-backups`.
2. Descargar el `.json.enc` más reciente.
3. Descifrar con la receta de `docs/BACKUPS.md` (sección "Cómo restaurar").
4. Importar el JSON con un script ad-hoc (TODO: `docs/restore-from-dump.mjs`).
   Esto sólo cubre las tablas críticas — el resto se pierde si no hay PITR.

### Paso 3 — Validación post-restore (queries SQL)

Ejecutar en Supabase SQL Editor sobre la DB restaurada:

```sql
-- Conteos por clínica para validar que la restauración trajo datos.
SELECT
  c.id, c.name,
  (SELECT COUNT(*) FROM patients         WHERE "clinicId" = c.id) AS patients,
  (SELECT COUNT(*) FROM appointments     WHERE "clinicId" = c.id) AS appointments,
  (SELECT COUNT(*) FROM medical_records  WHERE "clinicId" = c.id) AS medical_records,
  (SELECT COUNT(*) FROM invoices         WHERE "clinicId" = c.id) AS invoices,
  (SELECT COUNT(*) FROM audit_logs       WHERE "clinicId" = c.id) AS audit_logs
FROM clinics c
ORDER BY c.name;

-- Spot check: el último audit_log por clínica debe tener createdAt cerca
-- del timestamp del snapshot, no en el futuro.
SELECT "clinicId", MAX("createdAt") AS last_audit
FROM audit_logs
GROUP BY "clinicId";

-- ARCO requests pendientes (LFPDPPP — no perder solicitudes en curso).
SELECT id, "patientId", type, status, "createdAt"
FROM arco_requests
WHERE status IN ('PENDING', 'IN_PROGRESS')
ORDER BY "createdAt" DESC;
```

Comparar contra los conteos previos al incidente (si hay reportes
históricos en `weekly_insights`).

### Paso 4 — Reapuntar la app

Si se restauró a un proyecto nuevo:
1. Vercel → Settings → Environment Variables.
2. Actualizar `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Redeployar.

### Paso 5 — Comunicación a clínicas

Plantilla de email:

> Asunto: [MediFlow] Restauración del servicio · {fecha}
>
> Estimada clínica,
>
> El día {fecha} a las {hora} CDMX detectamos un incidente que requirió
> restaurar nuestra base de datos. La operación se completó a las {hora}
> y el servicio está nuevamente disponible.
>
> Datos potencialmente afectados: cualquier cambio realizado entre
> {snapshot_ts} y {incident_ts}. Le pedimos revisar:
>
> - Citas creadas o modificadas en ese rango.
> - Notas clínicas agregadas en ese rango.
> - Pagos registrados en ese rango.
>
> Si detecta alguna inconsistencia, repórtela a soporte@mediflow.app.
>
> Pedimos disculpas por las molestias.
>
> — Rafael Papanaklis · MediFlow

Script para enviar (correr desde un workspace local autenticado):

```bash
# Lista de clínicas afectadas
psql "$DATABASE_URL" -c "
  SELECT id, name, email FROM clinics
  WHERE email IS NOT NULL
" --csv > affected.csv

# Mailing — usa Resend manual o un script ad-hoc
```

### Paso 6 — Reactivar tráfico

1. Quitar el modo mantenimiento.
2. Verificar que `/api/cron/retention` y `/api/cron/db-export` corren OK
   (Vercel Logs → Cron). Si se restauró a proyecto nuevo, los crons
   pueden necesitar regenerar `CRON_SECRET`.
3. Monitorear `/admin/bug-audit` por anomalías durante 24h.

## Post-mortem

Después de cada incidente:
1. Documentar timeline en `docs/incidents/{YYYY-MM-DD}.md`.
2. Identificar root cause y action items.
3. Si el incidente fue por bug de código, revertir y agregar test.
4. Revisar este runbook y actualizarlo si algún paso fue incorrecto.
