-- Migration: Discount coupons for subscription payments
-- Admin crea cupones desde /admin/coupons y se aplican en /admin/payments.

CREATE TABLE IF NOT EXISTS "coupons" (
  "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "code"       TEXT NOT NULL UNIQUE,
  "type"       TEXT NOT NULL,                                           -- percentage | fixed
  "value"      DOUBLE PRECISION NOT NULL,
  "validFrom"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "maxUses"    INTEGER,
  "usedCount"  INTEGER NOT NULL DEFAULT 0,
  "appliesTo"  TEXT NOT NULL DEFAULT 'all',                             -- all | BASIC | PRO | CLINIC
  "active"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
