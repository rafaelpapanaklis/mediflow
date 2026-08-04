-- Afiliados — BONOS POR HITOS (ago 2026). Aditivo e idempotente.
ALTER TABLE "affiliate_payout_config"
  ADD COLUMN IF NOT EXISTS "milestonesEnabled" boolean          NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "milestone1Clinics" integer          NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "milestone1Mxn"     double precision NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS "milestone2Clinics" integer          NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS "milestone2Mxn"     double precision NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS "milestone3Clinics" integer          NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "milestone3Mxn"     double precision NOT NULL DEFAULT 100000;
