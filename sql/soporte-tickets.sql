-- ═══════════════════════════════════════════════════════════════════════
-- Soporte Técnico (tickets clínica → DaleControl) — schema.
-- IDEMPOTENTE: seguro re-correr en el SQL editor de Supabase.
--
-- Equivalente idempotente de los modelos Prisma SupportTicket y
-- SupportMessage (al final de prisma/schema.prisma). Sin relación a
-- Clinic/User a propósito: Strings planos + aislamiento por clinicId en
-- src/lib/support/service.ts. Estados/categorías/prioridades son TEXT;
-- los valores válidos los define src/lib/support/types.ts (sin enums
-- Postgres a propósito).
--
-- Nota sobre $$: usamos un único delimitador `$st$` y NUNCA bloques
-- DO anidados (el parser SQL de Supabase rompe con $$ anidado).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Tablas ────────────────────────────────────────────────────────────

-- Ticket de soporte por clínica. `folio` autoincremental (se muestra como
-- #DC-0001); `externalId` reservado para el id del ticket en Zendesk
-- (integración futura).
CREATE TABLE IF NOT EXISTS "support_tickets" (
    "id" TEXT NOT NULL,
    "folio" SERIAL NOT NULL,
    "clinicId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'DUDA',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'ABIERTO',
    "rating" INTEGER,
    "externalId" TEXT,
    "firstResponseAt" TIMESTAMP(3),
    "lastClinicMessageAt" TIMESTAMP(3),
    "lastSupportMessageAt" TIMESTAMP(3),
    "clinicUnread" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- Mensajes del hilo. authorType: clinic | support | system.
-- `internalNote` = nota interna de soporte; la clínica NUNCA la ve.
CREATE TABLE IF NOT EXISTS "support_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "internalNote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);


-- ── Índices ───────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_folio_key"
    ON "support_tickets"("folio");

CREATE INDEX IF NOT EXISTS "support_tickets_clinicId_status_idx"
    ON "support_tickets"("clinicId", "status");

CREATE INDEX IF NOT EXISTS "support_tickets_status_updatedAt_idx"
    ON "support_tickets"("status", "updatedAt");

CREATE INDEX IF NOT EXISTS "support_messages_ticketId_createdAt_idx"
    ON "support_messages"("ticketId", "createdAt");


-- ── Foreign keys ──────────────────────────────────────────────────────

DO $st$
BEGIN
  ALTER TABLE "support_messages"
    ADD CONSTRAINT "support_messages_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$st$;
