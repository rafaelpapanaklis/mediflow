-- ═══════════════════════════════════════════════════════════════════════
-- Google Calendar — estado de la conexión de la clínica y ajuste de privacidad.
-- IDEMPOTENTE: seguro re-correr en el SQL editor de Supabase. SIN aplicar.
--
-- Tabla NUEVA, una fila por clínica (no toca `clinics`: así el modelo Prisma
-- `Clinic` no cambia y ninguna consulta existente depende de este SQL). El
-- código la lee con SQL directo y, si todavía no existe, se comporta como hoy:
--   · «invitarPaciente» = true (se invita al paciente, como siempre);
--   · una conexión caída se deduce de `clinics` (googleCalendarEnabled = false
--     con googleRefreshToken aún guardado), solo que sin fecha ni motivo.
--
--   lostAt          cuándo se detectó que Google ya no acepta la conexión
--                   (invalid_grant / permiso revocado). NULL = sin problema.
--   lostReason      texto corto del motivo (sin tokens ni datos del paciente).
--   invitePatient   «Enviar invitación por correo al paciente». Por defecto
--                   true = el comportamiento de antes.
--
-- Nota sobre $$: un único delimitador `$gc$` y NUNCA bloques DO anidados.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "clinic_google_status" (
    "clinicId" TEXT NOT NULL,
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "invitePatient" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clinic_google_status_pkey" PRIMARY KEY ("clinicId")
);

-- Si la clínica se borra, su fila se va con ella.
DO $gc$
BEGIN
  ALTER TABLE "clinic_google_status"
    ADD CONSTRAINT "clinic_google_status_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$gc$;

-- ── RLS deny-all (defense-in-depth) ──────────────────────────────────────
-- Prisma usa el service role y bypassa RLS; el cliente nunca consulta esta
-- tabla por PostgREST. Sigue sql/rls-deny-all-policies.sql.
ALTER TABLE "clinic_google_status" ENABLE ROW LEVEL SECURITY;

DO $gc$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'clinic_google_status'
      AND policyname = 'clinic_google_status_deny_anon'
  ) THEN
    CREATE POLICY "clinic_google_status_deny_anon" ON "clinic_google_status"
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (false) WITH CHECK (false);
  END IF;
END
$gc$;

-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación
-- ═══════════════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'clinic_google_status' ORDER BY ordinal_position;
-- SELECT policyname FROM pg_policies WHERE tablename = 'clinic_google_status';
