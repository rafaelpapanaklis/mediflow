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
- **Escala por clínica (v2):** en vez de cargar toda la base en memoria y cifrar
  un único archivo gigante (OOM al crecer), exporta **una clínica a la vez** con
  cursor/paginado y escribe **un archivo por clínica**:
  - `patient-files/db-backups/{YYYY-MM-DD}/{clinicId}.ndjson.enc`
  - `…/__global.ndjson.enc` — filas sin clínica (ARCO públicas, `clinicId` null).
  - `…/__manifest.json` — resumen + **sentinela de "corrida completa"**.
- Cada `.ndjson.enc` usa el **mismo sobre** que v1 (línea header JSON
  `{v,alg,iv,tag}` + ciphertext **AES-256-GCM** con `DATA_ENCRYPTION_KEY`), así
  que la receta de descifrado de abajo funciona **por archivo**. El texto plano
  ya **no** es un JSON único: es **NDJSON** (una línea por fila),
  `{"t":"<tabla>","d":{<fila>}}`.
- **Reanudable:** si una corrida no termina dentro del presupuesto de tiempo
  (~240s de los 300s de `maxDuration`), deja los archivos ya subidos y responde
  `complete:false`; la siguiente corrida lista la carpeta del día y omite las
  clínicas ya hechas. El `__manifest.json` sólo aparece cuando terminó completa.
- Retention: 90 días, sweep automático en la misma corrida (borra carpetas de
  fecha viejas y dumps planos `*.json.enc` legacy de v1).

### Cómo restaurar manualmente

```bash
# 1. Descargar UN archivo de clínica: Supabase Dashboard → Storage →
#    patient-files → db-backups/{YYYY-MM-DD}/{clinicId}.ndjson.enc
#    (repite por cada clínica; __global.ndjson.enc para las filas sin clínica).
# 2. Descifrar (MISMO sobre que v1). La salida es NDJSON: una línea por fila,
#    {"t":"<tabla>","d":{<fila>}}. Agrupa luego por "t" para importar cada tabla.
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
" path/to/{clinicId}.ndjson.enc > restored.ndjson
```

### Quién es el on-call

- Rafael Papanaklis (rafaelpapanaklis@gmail.com) — único responsable.
- Tiempo objetivo de respuesta a incidente: 4 horas en horario CDMX.

## Verificación de integridad

Mensual (manual): descargar un archivo de clínica de la carpeta más reciente
(que tenga `__manifest.json`) y correr la receta de descifrado para confirmar
que `DATA_ENCRYPTION_KEY` es correcta y el contenido es NDJSON válido. Sin esta
verificación, un cambio accidental de la clave deja todos los dumps inservibles.

## Pendientes

- [ ] Mover dumps a S3 externo (no-Supabase) cuando haya volumen.
- [ ] Script reutilizable `docs/restore.mjs` con flags y validación.
- [ ] Test mensual automatizado de restore en preview env.
