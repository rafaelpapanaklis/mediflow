-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T1 · ORTODONCIA OLA 2, «Modo de cobro».
--
-- Decisión de Rafael: la clínica elige CÓMO cobra el tratamiento —
--   a) "PRECIO_TOTAL"     — lo de siempre: factura del caso a plazos.
--   b) "PAGO_POR_CONTROL" — sin precio total: cada control se cobra aparte
--      (factura normal de la cita), y la colocación/enganche como factura
--      aparte. El caso ya abierto conserva el modo con el que nació.
--
-- Tres columnas ADITIVAS, las tres String/Boolean planas (SIN enum de
-- Postgres — CREATE TYPE no es idempotente sin bloques DO, y el SQL Editor
-- de Rafael no acepta DO):
--   1. "orthodontics_clinic_settings"."billingMode" — default de la
--      CLÍNICA para casos nuevos. NULL = "PRECIO_TOTAL" (comportamiento de
--      hoy, sin tocar nada).
--   2. "orthodontic_treatment_plans"."billingMode" — el modo CON EL QUE
--      NACIÓ el caso (snapshot al crearlo, createTreatmentPlan.ts). NULL =
--      "PRECIO_TOTAL" — así CUALQUIER caso de antes de esta Ola sigue
--      funcionando exactamente igual que hoy, sin migrarlo.
--   3. "procedure_catalog"."orthoIncludedInTreatment" — SOLO tiene sentido
--      en procedimientos de ortodoncia: true = incluido (no se cobra),
--      false = con costo aparte, NULL = no aplica (dental u otra
--      especialidad) o sin decidir.
--
-- NO toca ni una fila que ya exista: las tres nacen NULL, que es
-- exactamente "modo de siempre" / "no aplica" para cualquier fila de hoy.
--
-- IDEMPOTENTE (ADD COLUMN IF NOT EXISTS): correrlo varias veces no da
-- errores ni duplicados. CERO DROP. PLANO: sin bloques DO.
--
-- El código YA tolera que estas columnas aún no existan (P2021/P2022):
-- cobranza-db.ts, tablero-data.ts, billing-mode-db.ts, cobranza-controles-db.ts
-- y clinic-settings-db.ts reintentan sin ellas — nada se cae en dev.108
-- mientras esto no esté pegado.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Modo de cobro DEFAULT de la clínica ──────────────────────────────
ALTER TABLE "orthodontics_clinic_settings"
  ADD COLUMN IF NOT EXISTS "billingMode" TEXT;


-- ── 2. Modo de cobro CON EL QUE NACIÓ el caso ───────────────────────────
ALTER TABLE "orthodontic_treatment_plans"
  ADD COLUMN IF NOT EXISTS "billingMode" TEXT;


-- ── 3. Procedimiento de ortodoncia: incluido / con costo aparte ─────────
ALTER TABLE "procedure_catalog"
  ADD COLUMN IF NOT EXISTS "orthoIncludedInTreatment" BOOLEAN;


-- ── 4. Comprobación (solo lee) ───────────────────────────────────────────
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE (table_name = 'orthodontics_clinic_settings' AND column_name = 'billingMode')
   OR (table_name = 'orthodontic_treatment_plans' AND column_name = 'billingMode')
   OR (table_name = 'procedure_catalog' AND column_name = 'orthoIncludedInTreatment')
ORDER BY table_name, column_name;
