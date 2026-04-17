-- Migration: Admin internal notes per clinic
-- Visible only from /admin/clinics/[id] → tab "Notas internas"

CREATE TABLE IF NOT EXISTS "admin_clinic_notes" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "clinicId"  TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "authorId"  TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "content"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "admin_clinic_notes_clinicId_idx"
  ON "admin_clinic_notes"("clinicId");
