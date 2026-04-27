-- ═══════════════════════════════════════════════════════════
-- Fase 6 — Inbox unificado + Reminders
-- WhatsApp + Email + Form + Validation + Reminder en una sola bandeja.
-- ═══════════════════════════════════════════════════════════

-- ─── Twilio + Postmark inbound credenciales por clínica ─────
ALTER TABLE "clinics"
  ADD COLUMN "twilioAccountSid"     TEXT,
  ADD COLUMN "twilioAuthToken"      TEXT,
  ADD COLUMN "twilioWhatsappNumber" TEXT,
  ADD COLUMN "postmarkInboundEmail" TEXT;

-- ─── Enums ──────────────────────────────────────────────────
CREATE TYPE "InboxChannel" AS ENUM ('WHATSAPP','EMAIL','PORTAL_FORM','VALIDATION','REMINDER');
CREATE TYPE "InboxStatus"  AS ENUM ('UNREAD','READ','ARCHIVED','SNOOZED');
CREATE TYPE "MessageDirection" AS ENUM ('IN','OUT');
CREATE TYPE "ReminderStatus"   AS ENUM ('PENDING','DONE','DISMISSED');

-- ─── InboxThread ────────────────────────────────────────────
CREATE TABLE "inbox_threads" (
  "id"             TEXT          NOT NULL,
  "clinicId"       TEXT          NOT NULL,
  "channel"        "InboxChannel" NOT NULL,
  "externalId"     TEXT,
  "patientId"      TEXT,
  "subject"        TEXT          NOT NULL,
  "status"         "InboxStatus" NOT NULL DEFAULT 'UNREAD',
  "assignedToId"   TEXT,
  "snoozedUntil"   TIMESTAMP(3),
  "lastMessageAt"  TIMESTAMP(3)  NOT NULL,
  "tags"           TEXT[]        DEFAULT ARRAY[]::TEXT[],
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL,
  CONSTRAINT "inbox_threads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbox_threads_clinic_status_last_idx"
  ON "inbox_threads"("clinicId", "status", "lastMessageAt" DESC);
CREATE INDEX "inbox_threads_clinic_channel_last_idx"
  ON "inbox_threads"("clinicId", "channel", "lastMessageAt" DESC);
CREATE INDEX "inbox_threads_assignee_status_idx"
  ON "inbox_threads"("assignedToId", "status");
CREATE INDEX "inbox_threads_snoozedUntil_idx"
  ON "inbox_threads"("snoozedUntil");

ALTER TABLE "inbox_threads"
  ADD CONSTRAINT "inbox_threads_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "inbox_threads_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "inbox_threads_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL;

-- ─── InboxMessage ───────────────────────────────────────────
CREATE TABLE "inbox_messages" (
  "id"          TEXT             NOT NULL,
  "threadId"    TEXT             NOT NULL,
  "direction"   "MessageDirection" NOT NULL,
  "body"        TEXT             NOT NULL,
  "attachments" JSONB,
  "sentAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentById"    TEXT,
  "externalId"  TEXT,
  "isInternal"  BOOLEAN          NOT NULL DEFAULT false,
  CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbox_messages_thread_sentAt_idx"
  ON "inbox_messages"("threadId", "sentAt");

ALTER TABLE "inbox_messages"
  ADD CONSTRAINT "inbox_messages_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "inbox_threads"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "inbox_messages_sentById_fkey"
    FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL;

-- ─── Reminders ──────────────────────────────────────────────
CREATE TABLE "reminders" (
  "id"            TEXT             NOT NULL,
  "clinicId"      TEXT             NOT NULL,
  "createdById"   TEXT             NOT NULL,
  "assignedToId"  TEXT             NOT NULL,
  "patientId"     TEXT,
  "threadId"      TEXT,
  "title"         TEXT             NOT NULL,
  "body"          TEXT,
  "dueAt"         TIMESTAMP(3)     NOT NULL,
  "status"        "ReminderStatus" NOT NULL DEFAULT 'PENDING',
  "completedAt"   TIMESTAMP(3),
  "completedById" TEXT,
  "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reminders_clinic_status_due_idx"
  ON "reminders"("clinicId", "status", "dueAt");
CREATE INDEX "reminders_assignee_status_due_idx"
  ON "reminders"("assignedToId", "status", "dueAt");
CREATE INDEX "reminders_dueAt_idx"
  ON "reminders"("dueAt");

ALTER TABLE "reminders"
  ADD CONSTRAINT "reminders_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "reminders_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id"),
  ADD CONSTRAINT "reminders_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "users"("id"),
  ADD CONSTRAINT "reminders_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "reminders_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "inbox_threads"("id") ON DELETE SET NULL;
