-- B2B payments (labs + proveedores): transferencia, MercadoPago, efectivo. Idempotente.
ALTER TABLE "dental_labs" ADD COLUMN IF NOT EXISTS "payMercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dental_labs" ADD COLUMN IF NOT EXISTS "mpAccessToken" TEXT;
ALTER TABLE "dental_lab_orders" ADD COLUMN IF NOT EXISTS "mpPreferenceId" TEXT;
ALTER TABLE "dental_lab_orders" ADD COLUMN IF NOT EXISTS "mpPaymentId" TEXT;
ALTER TABLE "dental_lab_orders" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payTransferEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payCashEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payMercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "mpAccessToken" TEXT;
ALTER TABLE "supplier_orders" ADD COLUMN IF NOT EXISTS "mpPreferenceId" TEXT;
ALTER TABLE "supplier_orders" ADD COLUMN IF NOT EXISTS "mpPaymentId" TEXT;
ALTER TABLE "supplier_orders" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "supplier_bank_accounts" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "bank" TEXT NOT NULL,
  "clabe" VARCHAR(18) NOT NULL,
  "accountNumber" TEXT,
  "holderName" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "supplier_bank_accounts_supplierId_idx" ON "supplier_bank_accounts"("supplierId");
DO $mp$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_bank_accounts_supplierId_fkey') THEN
    ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $mp$;
-- RLS deny-all (paridad con el hardening supplier_*/lab_*). Solo ENABLE (NO FORCE): Prisma/owner pasa, anon/authenticated bloqueado.
ALTER TABLE "supplier_bank_accounts" ENABLE ROW LEVEL SECURITY;
DO $mp$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='supplier_bank_accounts' AND policyname='supplier_bank_accounts_deny_all') THEN
    CREATE POLICY "supplier_bank_accounts_deny_all" ON "supplier_bank_accounts" FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $mp$;
