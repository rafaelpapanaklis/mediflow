-- ═══════════════════════════════════════════════════════════════════
-- ws1-t5 · DINERO: caja (auditoría del dinero, 3-oct-2026)
--
-- ⚠️ CORRER EN SUPABASE (SQL Editor). ADITIVO e IDEMPOTENTE: no borra ni
--    modifica ninguna fila existente. Se puede correr antes o después del
--    deploy: sin estas tablas el código usa los valores de fábrica (cierre
--    automático APAGADO) y los botones
--    «Pasar a esta caja» / guardar ajustes contestan «falta el SQL».
--    https://supabase.com/dashboard/project/_/sql/new
-- ═══════════════════════════════════════════════════════════════════

-- 1) Por dónde salió el dinero de un reembolso. YA EXISTE en producción
--    (sql/payment-refund-method.sql); se repite por si acaso, es inofensivo.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "refundMethod" text;
COMMENT ON COLUMN "payments"."refundMethod" IS
  'Solo en method=''refund'': "cash"|"transfer"|"debit"|"credit"|"check"|"other" = '
  'por dónde SALIÓ el dinero; "saldo_a_favor" = traspaso al saldo a favor (no sale '
  'dinero, no es reembolso); NULL = reembolso viejo, no se sabe.';

-- 2) Ajustes de dinero por clínica.
CREATE TABLE IF NOT EXISTS "clinic_dinero_ajustes" (
  "clinicId"             text         PRIMARY KEY REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Cierre automático de caja a medianoche (hora de la clínica). Apagado de fábrica.
  "cajaCierreAutomatico" boolean      NOT NULL DEFAULT false,
  "updatedAt"            timestamptz  NOT NULL DEFAULT now(),
  "updatedById"          text         REFERENCES "users" ("id") ON DELETE SET NULL
);
ALTER TABLE "clinic_dinero_ajustes" ENABLE ROW LEVEL SECURITY;

-- 3) Cobros en efectivo fuera de todo corte que alguien pasó a una caja.
CREATE TABLE IF NOT EXISTS "caja_cobros_asignados" (
  "paymentId"      text        PRIMARY KEY REFERENCES "payments" ("id") ON DELETE CASCADE,
  "clinicId"       text        NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "cashRegisterId" text        NOT NULL REFERENCES "cash_registers" ("id") ON DELETE CASCADE,
  "assignedById"   text        REFERENCES "users" ("id") ON DELETE SET NULL,
  "assignedAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "caja_cobros_asignados_caja_idx" ON "caja_cobros_asignados" ("cashRegisterId");
CREATE INDEX IF NOT EXISTS "caja_cobros_asignados_clinica_idx" ON "caja_cobros_asignados" ("clinicId");
ALTER TABLE "caja_cobros_asignados" ENABLE ROW LEVEL SECURITY;
