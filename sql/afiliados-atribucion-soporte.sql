-- ═══════════════════════════════════════════════════════════════════════
-- Afiliados — ATRIBUCIÓN POR COOKIE + SOPORTE CON MANAGER — 2026-08-05
--
-- Cuatro cosas:
--   1) affiliate_links.publicCode  → URL corta /r/<código> (opaca)
--   2) affiliates.accountManagerId → manager de cuenta del afiliado
--   3) affiliate_support_tickets   → tickets del afiliado
--   4) affiliate_support_messages  → hilo de cada ticket
--
--     https://supabase.com/dashboard/project/_/sql/new
--
-- ⚠️ ESTE ARCHIVO YA FUE APLICADO EN SUPABASE (2026-08-05). Se guarda para el
-- histórico Y como red de auto-reparación: cada columna va con
-- ADD COLUMN IF NOT EXISTS, así que re-correrlo completa cualquier diferencia
-- entre el DDL aplicado y prisma/schema.prisma sin tocar los datos.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Espeja prisma/schema.prisma (AffiliateLink.publicCode, Affiliate.
-- accountManagerId, AffiliateSupportTicket, AffiliateSupportMessage).
--
-- POR QUÉ TABLAS PROPIAS Y NO support_tickets: el soporte de clínicas está
-- acoplado a clinicId de punta a punta (incluidos los adjuntos, con prefijo
-- support/{clinicId}/). Tocarlo para meter afiliados arriesgaría soporte en
-- producción. Estas son un espejo 1:1 con affiliateId.
--
-- El código DEGRADA si esto no estuviera aplicado: la URL de los links cae a
-- la histórica /socio/<slug>?c=<campaign>, la tarjeta del manager cae a "sin
-- manager" (estado válido) y el soporte del afiliado responde vacío en vez de
-- reventar (patrón lesson_ortho_schema_drift).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1) URL corta de los links de afiliado ──────────────────────────────
-- Código opaco de 8 chars [a-z0-9]. NULLABLE a propósito: los links creados
-- antes de esta migración se quedan en null y siguen usando su URL histórica
-- /socio/<slug>?c=<campaign>, que puede estar ya impresa en un QR.
-- Es opaco porque un ?c=facebook adivinable dejaría manipular las campañas de
-- otro afiliado.
ALTER TABLE "affiliate_links"
  ADD COLUMN IF NOT EXISTS "publicCode" text;

-- UNIQUE, no PK: /r/<code> resuelve por aquí. Postgres permite varios NULL en
-- un índice único, así que los links viejos conviven sin chocar entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_links_publicCode_key"
  ON "affiliate_links" ("publicCode");

-- ── 2) Manager de cuenta del afiliado ──────────────────────────────────
-- Mismo catálogo GLOBAL que ya usan las clínicas (sql/account-managers.sql).
ALTER TABLE "affiliates"
  ADD COLUMN IF NOT EXISTS "accountManagerId" text;

CREATE INDEX IF NOT EXISTS "affiliates_accountManagerId_idx"
  ON "affiliates" ("accountManagerId");

-- ON DELETE SET NULL: borrar un manager deja a sus afiliados SIN manager,
-- jamás los borra. Mismo criterio que clinics_accountManagerId_fkey.
DO $aff$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliates_accountManagerId_fkey') THEN
    ALTER TABLE "affiliates"
      ADD CONSTRAINT "affiliates_accountManagerId_fkey"
      FOREIGN KEY ("accountManagerId") REFERENCES "account_managers" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$aff$;

-- ── 3) Tickets de soporte del afiliado ─────────────────────────────────
-- folio serial: serie PROPIA (#AF-0001), independiente de los #DC-XXXX de las
-- clínicas. Estados/categorías/prioridades son text, no enums de Postgres:
-- los valores válidos los define src/lib/affiliate-support/types.ts.
CREATE TABLE IF NOT EXISTS "affiliate_support_tickets" (
  "id"                     text         NOT NULL,
  "folio"                  serial       NOT NULL,
  "affiliateId"            text         NOT NULL,
  "createdById"            text,
  "createdByName"          text,
  "subject"                text         NOT NULL,
  "category"               text         NOT NULL DEFAULT 'DUDA',
  "priority"               text         NOT NULL DEFAULT 'NORMAL',
  "status"                 text         NOT NULL DEFAULT 'ABIERTO',
  "rating"                 integer,
  "firstResponseAt"        timestamp(3),
  "lastAffiliateMessageAt" timestamp(3),
  "lastSupportMessageAt"   timestamp(3),
  "affiliateUnread"        boolean      NOT NULL DEFAULT false,
  "closedAt"               timestamp(3),
  "createdAt"              timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_support_tickets_pkey" PRIMARY KEY ("id")
);

-- Auto-reparación por si una corrida anterior creó la tabla incompleta.
ALTER TABLE "affiliate_support_tickets"
  ADD COLUMN IF NOT EXISTS "createdById"            text,
  ADD COLUMN IF NOT EXISTS "createdByName"          text,
  ADD COLUMN IF NOT EXISTS "category"               text         NOT NULL DEFAULT 'DUDA',
  ADD COLUMN IF NOT EXISTS "priority"               text         NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "status"                 text         NOT NULL DEFAULT 'ABIERTO',
  ADD COLUMN IF NOT EXISTS "rating"                 integer,
  ADD COLUMN IF NOT EXISTS "firstResponseAt"        timestamp(3),
  ADD COLUMN IF NOT EXISTS "lastAffiliateMessageAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "lastSupportMessageAt"   timestamp(3),
  ADD COLUMN IF NOT EXISTS "affiliateUnread"        boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "closedAt"               timestamp(3),
  ADD COLUMN IF NOT EXISTS "updatedAt"              timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_support_tickets_folio_key"
  ON "affiliate_support_tickets" ("folio");
CREATE INDEX IF NOT EXISTS "affiliate_support_tickets_affiliateId_status_idx"
  ON "affiliate_support_tickets" ("affiliateId", "status");
CREATE INDEX IF NOT EXISTS "affiliate_support_tickets_status_updatedAt_idx"
  ON "affiliate_support_tickets" ("status", "updatedAt");

DO $aff$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_support_tickets_affiliateId_fkey') THEN
    ALTER TABLE "affiliate_support_tickets"
      ADD CONSTRAINT "affiliate_support_tickets_affiliateId_fkey"
      FOREIGN KEY ("affiliateId") REFERENCES "affiliates" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$aff$;

-- ── 4) Mensajes del hilo ───────────────────────────────────────────────
-- internalNote: nota interna de soporte. El afiliado NUNCA la ve — el filtro
-- va en el WHERE de Prisma (src/lib/affiliate-support/service.ts), no en el
-- render.
CREATE TABLE IF NOT EXISTS "affiliate_support_messages" (
  "id"           text         NOT NULL,
  "ticketId"     text         NOT NULL,
  "authorType"   text         NOT NULL,
  "authorId"     text,
  "authorName"   text,
  "body"         text         NOT NULL,
  "attachments"  jsonb,
  "internalNote" boolean      NOT NULL DEFAULT false,
  "createdAt"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "affiliate_support_messages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "affiliate_support_messages"
  ADD COLUMN IF NOT EXISTS "authorId"     text,
  ADD COLUMN IF NOT EXISTS "authorName"   text,
  ADD COLUMN IF NOT EXISTS "attachments"  jsonb,
  ADD COLUMN IF NOT EXISTS "internalNote" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "affiliate_support_messages_ticketId_createdAt_idx"
  ON "affiliate_support_messages" ("ticketId", "createdAt");

DO $aff$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_support_messages_ticketId_fkey') THEN
    ALTER TABLE "affiliate_support_messages"
      ADD CONSTRAINT "affiliate_support_messages_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "affiliate_support_tickets" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$aff$;

-- ── 5) RLS deny-all en las tablas nuevas ───────────────────────────────
-- Defense-in-depth (Prisma usa el service role y bypassa RLS). Importa: los
-- tickets llevan conversaciones privadas y datos de pago de gente real.
-- Sigue sql/rls-deny-all-policies.sql.
DO $aff$
DECLARE
  t    text;
  tbls text[] := ARRAY['affiliate_support_tickets', 'affiliate_support_messages'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END
$aff$;

-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'affiliate_links' AND column_name = 'publicCode';
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'affiliates' AND column_name = 'accountManagerId';
-- SELECT count(*) FROM "affiliate_support_tickets";
-- SELECT count(*) FROM "affiliate_support_messages";
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND tablename LIKE 'affiliate_support%';
