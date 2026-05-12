# Aplicar seed Ortodoncia v2 · Gabriela Hernández Ruiz

Dos formas equivalentes, elige una. El seed crea ~40 rows distribuidas en
las 11 tablas v2 con datos realistas que matchean los mockups del SPEC.

## Pre-requisito

La migration `20260512170000_ortho_v2_rewrite` debe estar aplicada. Verifica:

```sql
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_name LIKE 'ortho_%';
-- Esperado: 17
```

## Opción A · Supabase Studio (recomendado)

1. Abre [supabase.com/dashboard](https://supabase.com/dashboard) → proyecto
   `nyvcwjdpwxzqlwjwjimv` → **SQL Editor**.
2. New query → pega el contenido completo de
   `scripts/ortho-v2-seed-prod.sql` (DO $$ ... END $$ block).
3. **Run**. Toma ~3-5 segundos.
4. Verifica:
   ```sql
   SELECT (SELECT COUNT(*) FROM ortho_cases)            AS cases,
          (SELECT COUNT(*) FROM ortho_diagnoses)         AS dx,
          (SELECT COUNT(*) FROM ortho_treatment_plans)   AS plans,
          (SELECT COUNT(*) FROM ortho_arches_planned)    AS arches,
          (SELECT COUNT(*) FROM ortho_photo_sets)        AS photosets,
          (SELECT COUNT(*) FROM ortho_treatment_cards)   AS cards,
          (SELECT COUNT(*) FROM ortho_financial_plans)   AS fp,
          (SELECT COUNT(*) FROM ortho_installments)      AS installments,
          (SELECT COUNT(*) FROM ortho_retention_plans)   AS retention,
          (SELECT COUNT(*) FROM ortho_documents)         AS docs,
          (SELECT COUNT(*) FROM ortho_communication_logs)AS comms;
   -- Esperado: 1, 1, 1, 7, 2, 6, 1, 18, 1, 3, 5
   ```

## Opción B · Local con Prisma client

Requiere `DATABASE_URL` apuntando a la BD destino:

```bash
npx tsx prisma/seeds/ortho-v2-demo.ts
```

Output esperado:
```
✓ Paciente: Gabriela Hernández Ruiz
✓ OrthoCase ORT-2026-001
✓ OrthoDiagnosis
✓ OrthoTreatmentPlan
✓ 7 ArchPlanned
✓ 2 PhotoSets (T0, T1)
✓ 6 TreatmentCards
✓ FinancialPlan
✓ 18 Installments
✓ RetentionPlan · código GABY26
✓ 3 OrthoDocuments
✓ 5 CommunicationLog
✅ Seed completo
```

## Validación post-seed

1. Login en MediFlow como doctor de la clínica de Gabriela.
2. Ir a `/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia`.
3. Debe abrir el OrthoModuleShell con todas las 8 secciones pobladas:
   - Resumen: fase LEVELING · arco 3/7 · 6 cards · 1 mensualidad pendiente
   - Expediente: Clase II Div 1 · resalte 6mm · 2 diastemas
   - Fotos & Rx: tabs T0 y T1 (vacíos visualmente, sin URLs reales)
   - Plan: 7 arcos · 2 aparatologías · 4 objetivos · IPR 3 slots
   - Citas: 6 TreatmentCards en timeline
   - Financiero: 3 escenarios · 18 installments (6 PAID, 1 PENDING, 11 FUTURE)
   - Retención: Essix sup + Fijo 3-3 inf · 5 checkpoints · código GABY26
   - Documentos: 3 consents · 0 lab orders · 5 WhatsApp messages
