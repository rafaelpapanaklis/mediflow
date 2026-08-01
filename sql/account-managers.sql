-- ═══════════════════════════════════════════════════════════════════════
-- Manager de cuenta — AccountManager + clinics.accountManagerId — 2026-08-01
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- Cada clínica puede tener asignada una persona real (su "Manager de cuenta")
-- a la que escribe DIRECTO por WhatsApp desde la pantalla de Soporte, en vez
-- de abrir un ticket. El catálogo de managers es GLOBAL (lo administra el
-- owner en /admin/account-managers); la clínica sólo ve el suyo.
--
-- El código es TOLERANTE a que esto no esté aplicado todavía: la lectura del
-- manager va en try/catch y degrada a "sin manager asignado". La pantalla de
-- Soporte funciona igual antes y después de correr este archivo. La tarjeta
-- aparece recién cuando (1) se aplica este SQL y (2) se asigna un manager a
-- la clínica desde /admin.
--
-- Horario: `days` = 0=Domingo … 6=Sábado (Lun–Vie = {1,2,3,4,5}).
-- `startMinutes`/`endMinutes` = minutos desde medianoche (9:00=540, 18:00=1080),
-- evaluados en `timezone`.
--
-- IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, FK
-- con guarda sobre pg_constraint y policy con guarda sobre pg_policies.
-- Re-ejecutable sin efectos colaterales.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Tabla ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "account_managers" (
    "id"              TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "photoUrl"        TEXT,
    "whatsappE164"    TEXT NOT NULL,
    "whatsappDisplay" TEXT,
    "days"            INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
    "startMinutes"    INTEGER NOT NULL DEFAULT 540,
    "endMinutes"      INTEGER NOT NULL DEFAULT 1080,
    "timezone"        TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "status"          TEXT NOT NULL DEFAULT 'active',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_managers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "account_managers_status_idx"
    ON "account_managers"("status");

-- ── Columna en clinics + índice ───────────────────────────────────────
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "accountManagerId" TEXT;

CREATE INDEX IF NOT EXISTS "clinics_accountManagerId_idx"
    ON "clinics"("accountManagerId");

-- ── Foreign key (ADD CONSTRAINT no soporta IF NOT EXISTS → guarda) ─────
-- ON DELETE SET NULL: borrar un manager deja a sus clínicas SIN manager,
-- jamás las borra. Es lo que avisa el modal de eliminar en /admin.
DO $am$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_accountManagerId_fkey') THEN
    ALTER TABLE "clinics"
      ADD CONSTRAINT "clinics_accountManagerId_fkey"
      FOREIGN KEY ("accountManagerId") REFERENCES "account_managers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$am$;

-- ── RLS deny-all restrictive (patrón sql/rls-deny-all-policies.sql) ────
-- Niega todo a anon/authenticated; el service role (Prisma) la sigue usando.
-- Importa: la tabla lleva teléfonos personales de gente real.
DO $am$
DECLARE
  t    text;
  tbls text[] := ARRAY['account_managers'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = t
        AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END
$am$;

-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'clinics' AND column_name = 'accountManagerId';
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'account_managers';
