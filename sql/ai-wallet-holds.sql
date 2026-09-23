-- ═══════════════════════════════════════════════════════════════════
-- ai-wallet-holds.sql — reserva de saldo del monedero de IA (rama fix/saldo-ia-dinero)
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES DEL DEPLOY de esta rama.
--     https://supabase.com/dashboard/project/_/sql/new
--
-- Crea la tabla ai_wallet_holds (model AiWalletHold de prisma/schema.prisma).
-- Antes de llamar a Claude se reserva aquí lo que la llamada puede costar; al
-- terminar se cobra lo real y la fila se borra. Si el proceso muere, la fila
-- deja de contar al pasar "expiresAt" (3 minutos). NO mueve saldo.
--
-- Si el deploy llega ANTES que este script, nada se rompe: el código detecta
-- que falta la tabla y decide sin reservar (mira el costo estimado, pero dos
-- llamadas a la vez vuelven a poder pasar las dos). Con el script aplicado,
-- la reserva cierra ese hueco.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. Sin DROP. No toca datos.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "ai_wallet_holds" (
  "id"          text         NOT NULL,
  "clinicId"    text         NOT NULL,
  "feature"     text         NOT NULL,
  "amountCents" integer      NOT NULL,
  "expiresAt"   timestamp(3) NOT NULL,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_wallet_holds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_wallet_holds_clinicId_expiresAt_idx"
  ON "ai_wallet_holds" ("clinicId", "expiresAt");

-- FK → clinics, como el resto de tablas ai_* (idempotente vía pg_constraint).
DO $aihold$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_wallet_holds_clinicId_fkey') THEN
    ALTER TABLE "ai_wallet_holds" ADD CONSTRAINT "ai_wallet_holds_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$aihold$;

-- RLS deny-all (defense-in-depth), igual que sql/ai-billing.sql. Prisma usa el
-- service role y no le afecta; el cliente nunca toca esta tabla.
ALTER TABLE "ai_wallet_holds" ENABLE ROW LEVEL SECURITY;
DO $aihold$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_wallet_holds' AND policyname = 'ai_wallet_holds_deny_anon'
  ) THEN
    CREATE POLICY "ai_wallet_holds_deny_anon" ON "ai_wallet_holds"
      AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  END IF;
END
$aihold$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación (debe salir 1 fila con rls = true y 1 política):
--   SELECT c.relname, c.relrowsecurity AS rls,
--          (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS politicas
--   FROM pg_class c WHERE c.relname = 'ai_wallet_holds';
-- ═══════════════════════════════════════════════════════════════════
