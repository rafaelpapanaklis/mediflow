-- ═══════════════════════════════════════════════════════════════════
-- Reseñas verificadas del directorio (WS2-T2 perfil-resenas)
-- Tabla clinic_reviews ⇄ modelo Prisma ClinicReview (al final de
-- prisma/schema.prisma). Una reseña por cita completada.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS + bloques DO con guardas. Seguro de
-- re-correr. Delimitadores $rv$ (NUNCA $$ pelado — el editor de Supabase
-- rompe el parser con $$).
--
-- Aplicar a mano en Supabase. NO prisma migrate. Hasta aplicarlo, cualquier
-- ruta que toque prisma.clinicReview revienta en runtime (perfil, /resena,
-- dashboard/resenas, admin/resenas y el rating de las cards del directorio).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla. Columnas en camelCase entre comillas: Prisma mapea el nombre del
--    campo tal cual (sin @map) → la columna DEBE llamarse igual.
CREATE TABLE IF NOT EXISTS "clinic_reviews" (
  "id"              TEXT NOT NULL,
  "clinicId"        TEXT NOT NULL,
  "patientId"       TEXT NOT NULL,
  "appointmentId"   TEXT NOT NULL,
  "authorName"      TEXT NOT NULL,
  "rating"          INTEGER,
  "comment"         TEXT,
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "response"        TEXT,
  "respondedAt"     TIMESTAMP(3),
  "respondedById"   TEXT,
  "reported"        BOOLEAN NOT NULL DEFAULT false,
  "reportedReason"  TEXT,
  "reportedAt"      TIMESTAMP(3),
  "token"           TEXT NOT NULL,
  "tokenExpiresAt"  TIMESTAMP(3) NOT NULL,
  "submittedAt"     TIMESTAMP(3),
  "invitedChannels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinic_reviews_pkey" PRIMARY KEY ("id")
);

-- 2) Únicos (una reseña por cita; token de un solo uso).
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_reviews_appointmentId_key" ON "clinic_reviews" ("appointmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_reviews_token_key"         ON "clinic_reviews" ("token");

-- 3) Índices de consulta (perfil paginado, cola de moderación admin).
CREATE INDEX IF NOT EXISTS "clinic_reviews_clinic_status_created_idx" ON "clinic_reviews" ("clinicId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "clinic_reviews_clinic_reported_idx"       ON "clinic_reviews" ("clinicId", "reported");

-- 4) Llaves foráneas (idempotentes). ON DELETE CASCADE: si se borra la clínica,
--    el paciente o la cita, la reseña se va con ellos.
DO $rv$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_reviews_clinicId_fkey') THEN
    ALTER TABLE "clinic_reviews"
      ADD CONSTRAINT "clinic_reviews_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_reviews_patientId_fkey') THEN
    ALTER TABLE "clinic_reviews"
      ADD CONSTRAINT "clinic_reviews_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_reviews_appointmentId_fkey') THEN
    ALTER TABLE "clinic_reviews"
      ADD CONSTRAINT "clinic_reviews_appointmentId_fkey"
      FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FKs saltadas (deploy parcial)';
END
$rv$;

-- 5) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). MediFlow accede solo vía Prisma +
--    service role (bypassa RLS). Esto cierra PostgREST si se filtra el anon key.
DO $rv$
BEGIN
  EXECUTE 'ALTER TABLE "clinic_reviews" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'clinic_reviews'
      AND policyname = 'clinic_reviews_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "clinic_reviews_deny_anon" ON "clinic_reviews" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'clinic_reviews no existe — RLS saltada';
END
$rv$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT policyname FROM pg_policies WHERE tablename = 'clinic_reviews';
--   \d clinic_reviews
-- ═══════════════════════════════════════════════════════════════════
