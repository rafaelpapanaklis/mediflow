# Backups y disaster recovery · MediFlow

Última actualización: 2026-04-30

## Resumen

MediFlow tiene **dos capas** de backup:

1. **PITR de Supabase** (Point-In-Time Recovery) — primera línea, gestionada
   por el plan de Supabase contratado.
2. **Dump cifrado semanal** (`/api/cron/db-export`) — segunda línea,
   independiente de Supabase, en bucket privado y cifrado con AES-256-GCM.

## 1. PITR de Supabase

### Estado actual

> ⚠️ **Pendiente confirmar con Rafael:** plan de Supabase actualmente
> contratado (Free / Pro / Team / Enterprise).
>
> - **Free:** sin PITR, sólo backup diario simple con retention de 7 días.
>   **Riesgo aceptado mientras no haya producción seria.** Para multi-clínica
>   en producción real **se debe upgrade a Pro como mínimo** antes del
>   primer cliente de pago.
> - **Pro:** PITR habilitado, retention 7 días con granularidad de segundo.
> - **Team / Enterprise:** PITR retention configurable (28+ días).

Para verificar:
- Supabase Dashboard → Project Settings → Add Ons → Point in Time Recovery
- Si no aparece "Active", no hay PITR.

### Frecuencia de snapshots

Pro+ : continuo (WAL streaming) con granularidad de segundo dentro del
retention window.

Free : snapshot diario aproximadamente a las 02:00 UTC (best-effort, no SLA).

### Costo aproximado

- Pro: incluido en el plan ($25 USD/mes por proyecto).
- Team: $25 USD adicionales por add-on PITR (28 días).

## 2. Dump cifrado semanal

Cron `GET /api/cron/db-export` (`vercel.json` schedule `0 10 * * 0`,
domingo 04:00 CDMX).

- Vuelca tablas críticas: `patients`, `medical_records`, `prescriptions`,
  `invoices`, `audit_logs` (últimos 7 días — el resto vive en PITR),
  `doctor_signature_certs` (sólo metadata), `arco_requests`.
- Cifra con AES-256-GCM usando `DATA_ENCRYPTION_KEY`.
- Sube a `patient-files/db-backups/{YYYY-MM-DD}_{ts}.json.enc`.
- Retention: 90 días, sweep automático en la misma corrida.

### Cómo restaurar manualmente

```bash
# 1. Descargar el dump desde Supabase Dashboard → Storage → patient-files → db-backups
# 2. Descifrar (script en docs/restore.mjs — TBD; receta abajo)
node -e "
  const fs = require('fs');
  const { createDecipheriv } = require('crypto');
  const buf = fs.readFileSync(process.argv[1]);
  const nl = buf.indexOf(0x0a);
  const header = JSON.parse(buf.slice(0, nl).toString('utf8'));
  const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY.slice(0, 64), 'hex');
  const iv = Buffer.from(header.iv, 'base64');
  const tag = Buffer.from(header.tag, 'base64');
  const ct = buf.slice(nl + 1);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  console.log(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
" path/to/dump.json.enc > restored.json
```

### Quién es el on-call

- Rafael Papanaklis (rafaelpapanaklis@gmail.com) — único responsable.
- Tiempo objetivo de respuesta a incidente: 4 horas en horario CDMX.

## Verificación de integridad

Mensual (manual): descargar el dump más reciente y correr la receta de
descifrado para confirmar que `DATA_ENCRYPTION_KEY` es correcta y el
contenido es JSON válido. Sin esta verificación, un cambio accidental
de la clave deja todos los dumps inservibles.

## Pendientes

- [ ] Mover dumps a S3 externo (no-Supabase) cuando haya volumen.
- [ ] Script reutilizable `docs/restore.mjs` con flags y validación.
- [ ] Test mensual automatizado de restore en preview env.
