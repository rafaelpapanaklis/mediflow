# Fase 0 · Inventario de data prod en tablas ortho v1

Generado: 2026-05-12 via `scripts/inventory-old-ortho-data.mts` contra prod Supabase (DATABASE_URL pooler).

## Hallazgo crítico — ABORT

El SPEC en Fase 0.7 dice: "Si el count > 1 paciente único, ABORTA y reporta a Rafael."

**Resultado: 3 pacientes únicos tienen data en tablas ortho v1.**

### Counts por tabla

| Tabla | Filas | Pacientes únicos |
|---|---|---|
| orthodonticTreatmentPlan | 1 | 1 |
| orthodonticDiagnosis | 3 | **3** |
| orthodonticPhase | 6 | 1 |
| orthodonticControlAppointment | 16 | 1 |
| orthodonticConsent | 0 | 0 |
| orthodonticDigitalRecord | 0 | 0 |
| orthoPhotoSet | 2 | 1 |
| orthoWireStep | 8 | 1 |
| orthoTreatmentCard | 4 | 1 |
| orthoTAD | 2 | 1 |
| orthoNpsSchedule | 0 | 0 |
| orthoReferralCode | 1 | 1 |
| orthoSignAtHomePackage | 0 | 0 |
| orthoPaymentPlan | 1 | 1 |
| **TOTAL** | **44** | **3 únicos** |

### Pacientes con data

1. **Gabriela Hernández Ruiz** (`ORT-DEMO-GABY`) — caso completo: plan + fases + 16 controls + 2 photo sets + 8 wires + 4 cards + 2 TADs + payment + referral
2. **Sergio Ramírez López** (`00008`) — solo 1 OrthodonticDiagnosis (sin plan, cards, etc.)
3. **Andrés López Ramírez** (`00009`) — solo 1 OrthodonticDiagnosis (sin plan, cards, etc.)

### Decisión requerida por Rafael

Sergio y Andrés tienen **solo OrthodonticDiagnosis orphans** (un row cada uno, sin plan ni otras relaciones). Opciones para proceder con la demolición:

1. **Borrar manualmente los 2 diagnoses orphans** antes de demolish (`DELETE FROM "OrthodonticDiagnosis" WHERE patientId IN ('cmokj5td80007cux0em8qhxje', 'cmokj5td80008cux02t8hd5xk')`) — recomendado si data es de testing/seed previo abandonado.
2. **Migrar los 2 diagnoses a OrthoDiagnosis v2** preservando como `OrthoCase` DRAFT — recomendado si los pacientes son reales.
3. **Otra estrategia que indique Rafael.**

Sin decisión, la demolición ON CASCADE de los modelos viejos perdería esos 2 diagnoses.

## RESUELTO 2026-05-12 — Opción 1 (DELETE)

Rafael resolvió: borrar los 2 diagnoses orphans antes de demoler.

Ejecutado vía `scripts/delete-ortho-orphan-diagnoses.mts`:

```
🗑️  Sergio Ramírez López (#00008) · patientId=cmokj5td80007cux0em8qhxje
     deleted dx id=92e5c6c6-6dca-4a56-b677-fde2ac5de20d ✓ esperado
🗑️  Andrés López Ramírez (#00009) · patientId=cmokj5td80008cux02t8hd5xk
     deleted dx id=34e2c6c7-43ad-4be5-a373-428302917523 ✓ esperado
```

Re-ejecución de `scripts/inventory-old-ortho-data.mts` post-delete confirma:

```
TOTAL                                      42 1 unique patients
✅ OK: solo 1 paciente con data — Gabriela Hernández Ruiz (ORT-DEMO-GABY). Demolition segura.
```

Demolition de Fase 1 ahora autorizada.

### Para reproducir

```powershell
$env:DATABASE_URL = "..."
npx tsx scripts/inventory-old-ortho-data.mts
```
