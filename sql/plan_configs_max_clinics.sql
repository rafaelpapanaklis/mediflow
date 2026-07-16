-- ════════════════════════════════════════════════════════════════════════════
-- plan_configs.maxClinics — tope de SUCURSALES por dueño (Multi-Clínica Fase 1)
--
-- Aplicar A MANO en Supabase (SQL Editor) ANTES de mergear/deployar la rama
-- feat/sucursales: el modelo Prisma PlanConfig ya declara la columna, así que
-- sin ella `prisma.planConfig.findMany()` truena y TODA la config de planes cae
-- al FALLBACK del código (precios incluidos). Aplicarlo ANTES es seguro: el
-- código viejo no selecciona la columna y la ignora.
--
-- Idempotente: re-ejecutable sin daño (ADD COLUMN IF NOT EXISTS + UPDATE).
--
-- Semántica: NULL = ilimitado (igual que maxPatients/maxUsers). El DEFAULT 1 NO
-- es cosmético: evita que una fila sin sembrar quede en NULL y le regale
-- sucursales ilimitadas a BASIC/PRO. Para dejar un plan realmente ilimitado hay
-- que poner NULL A PROPÓSITO desde /admin/settings → Planes ("Ilimitado").
--
-- Se cuenta por DUEÑO (users.supabaseId con role='SUPER_ADMIN'), no por clínica.
-- Seed: BASIC=1, PRO=1, CLINIC=3 (el precio de CLINIC incluye 3 sedes; la 4.ª+
-- será un add-on cobrado aparte — pendiente).
--
-- ⚠️ NO re-ejecutes sql/plan_configs.sql para esto: ese archivo aún siembra los
-- precios VIEJOS (499/999/1999) con ON CONFLICT DO UPDATE y pisaría los precios
-- vivos (419/689/1719). Este archivo es autosuficiente.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "plan_configs"
  ADD COLUMN IF NOT EXISTS "maxClinics" integer DEFAULT 1;

UPDATE "plan_configs" SET "maxClinics" = 1 WHERE "planId" = 'BASIC';
UPDATE "plan_configs" SET "maxClinics" = 1 WHERE "planId" = 'PRO';
UPDATE "plan_configs" SET "maxClinics" = 3 WHERE "planId" = 'CLINIC';

-- Verificación (debe devolver BASIC=1, PRO=1, CLINIC=3):
-- SELECT "planId", "label", "maxClinics" FROM "plan_configs" ORDER BY "planId";
