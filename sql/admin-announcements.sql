-- Migration: Global announcements banner
-- Shown in dashboard layout to every logged-in clinic user.

CREATE TABLE IF NOT EXISTS "admin_announcements" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "message"   TEXT NOT NULL,
  "type"      TEXT NOT NULL DEFAULT 'info',          -- info | warning | success | maintenance
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "startsAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
