# Política de retención de datos · MediFlow

Última actualización: 2026-04-30

Este documento describe **cuánto tiempo conservamos cada tipo de dato** y
**cómo se ejecuta su eliminación o anonimización**. La automatización vive
en el cron `GET /api/cron/retention` (programado en `vercel.json`).

## Marco legal

| Norma | Aplica a |
|-------|----------|
| **NOM-024-SSA3-2012** | Expediente clínico electrónico |
| **NOM-004-SSA3-2012** | Conservación del expediente: mínimo 5 años |
| **LFPDPPP** | Datos personales — derechos ARCO |
| **CFF Mx** | Datos fiscales (CFDI) — 5 años |

## Tabla de retención

| Tabla / dato | Retención mínima | Acción al vencer | Quién ejecuta |
|---|---|---|---|
| `medical_records`, `prescriptions`, `medical_record_diagnoses`, `odontogram_*`, `treatment_plans`, `treatment_sessions`, `xray_analyses`, `patient_files` (clínicos), `consent_forms` | **5 años** desde el último acto médico | Conservar (anonimizar PII en `patients` si hay cancelación ARCO, pero **no borrar el expediente**) | Manual / cron de auditoría — no auto-borra |
| `audit_logs` | **7 años** | Borrar `createdAt < now - 7 años` | Cron diario `retention` |
| `inbox_messages` | **2 años** | Anonimizar `body` y vaciar `attachments` | Cron diario `retention` |
| `arco_requests` resueltas (`RESOLVED` / `REJECTED`) | **5 años** desde `resolvedAt` | Anonimizar `email`, `reason`, `resolvedNotes` | Cron diario `retention` |
| `cfdi_records` y datos fiscales | **5 años** | Conservar (obligación fiscal) | Manual |
| Sesiones expiradas (Supabase auth) | **30 días** | Borrar de auth schema | Supabase auto |
| Archivos físicos en `patient-files` bucket | Vinculado al `PatientFile` row | Cascade delete cuando se borra el `PatientFile` (sólo en delete de clínica completa) | Endpoint admin |

## Flujo de cancelación ARCO (LFPDPPP)

Cuando un paciente ejerce su derecho de **cancelación**, el endpoint
`POST /api/arco-request` con `action: "cancellation"`:

1. Reemplaza PII en `patients` por `[ANONIMIZADO]` o `null`:
   `firstName`, `lastName`, `email`, `phone`, `address`, `curp`, `passportNo`,
   `rfcPaciente`, `regimenFiscalPac`, `cpPaciente`, `razonSocialPac`,
   `allergies`, `chronicConditions`, `currentMedications`, `tags`, `notes`.
2. Setea `deletedAt` y `anonymizedAt` (ahora) y `status = ARCHIVED`.
3. **Conserva** `medical_records`, `prescriptions`, `consent_forms`,
   `patient_files` (los archivos clínicos siguen siendo evidencia médica
   bajo NOM-024). El paciente al que apuntan ya no es identificable.
4. Audita la operación con `logMutation` (entityType `patient`, action `delete`).

## Cron schedule

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/retention",  "schedule": "0 9 * * *"   },
    { "path": "/api/cron/db-export",  "schedule": "0 10 * * 0" }
  ]
}
```

(Hora UTC; 09:00 UTC = 03:00 CDMX.)

## Cómo correr el cron manualmente

Para QA o limpieza puntual, autenticando con el `CRON_SECRET`:

```bash
curl -X GET https://mediflow.app/api/cron/retention \
  -H "Authorization: Bearer $CRON_SECRET"
```

Respuesta JSON con `auditLogsDeleted`, `inboxMessagesAnonymized`,
`arcoRequestsAnonymized`, `clinicsProcessed`, `errors[]`.

## Pendientes

- [ ] Cron mensual que reporte por email a `privacidad@mediflow.app` el
      delta de la última corrida (resumen ejecutivo para auditoría).
- [ ] Considerar mover `audit_logs` viejos a un bucket frío de S3 antes
      de borrarlos (debate legal pendiente).
