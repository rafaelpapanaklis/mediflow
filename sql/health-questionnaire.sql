-- ═══════════════════════════════════════════════════════════════════
-- Cuestionario de salud / anamnesis dental + contacto de emergencia
-- (WS1-T2 anamnesis-vitales)
--
-- Tabla health_questionnaires ⇄ modelo Prisma HealthQuestionnaire (al
-- final de prisma/schema.prisma) + 3 columnas de contacto de emergencia
-- en patients.
--
-- IDEMPOTENTE: CREATE/ALTER ... IF NOT EXISTS + bloques DO con guardas.
-- Seguro de re-correr. Delimitadores $hq$ (NUNCA $$ pelado — el editor de
-- Supabase rompe el parser con $$).
--
-- Aplicar a mano en Supabase. NO prisma migrate.
--
-- ⚠️ ORDEN DE DESPLIEGUE: este SQL es seguro de correr ANTES de que el
-- deploy esté vivo (ADD COLUMN no rompe lecturas previas). Aplícalo apenas
-- veas el push: si las columnas emergencyContact* NO existen cuando el
-- nuevo Prisma Client corre, CUALQUIER lectura de patients revienta
-- (lista, detalle, búsqueda). Corriéndolo primero, la ventana es CERO.
-- ═══════════════════════════════════════════════════════════════════

-- 0) Contacto de emergencia: 3 columnas en patients. camelCase entre
--    comillas: Prisma mapea el nombre del campo tal cual (sin @map).
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "emergencyContactName"     TEXT;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "emergencyContactPhone"    TEXT;
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "emergencyContactRelation" TEXT;

-- 1) Tabla del cuestionario. Columnas camelCase entre comillas (igual que
--    Prisma). Versionado simple: una fila por llenado.
CREATE TABLE IF NOT EXISTS "health_questionnaires" (
  "id"         TEXT NOT NULL,
  "clinicId"   TEXT NOT NULL,
  "patientId"  TEXT NOT NULL,
  "filledAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "filledById" TEXT,
  "answers"    JSONB NOT NULL,
  "riskFlags"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_questionnaires_pkey" PRIMARY KEY ("id")
);

-- 2) Índice de consulta: el VIGENTE = el más reciente por paciente.
CREATE INDEX IF NOT EXISTS "health_questionnaires_clinic_patient_filled_idx"
  ON "health_questionnaires" ("clinicId", "patientId", "filledAt" DESC);

-- 3) Llaves foráneas (idempotentes). clinic/patient ON DELETE CASCADE; el
--    staff que llenó queda en NULL si se borra el usuario (se conserva la
--    fila histórica). Si alguna tabla referenciada falta (deploy parcial),
--    se saltan sin romper.
DO $hq$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_questionnaires_clinicId_fkey') THEN
    ALTER TABLE "health_questionnaires"
      ADD CONSTRAINT "health_questionnaires_clinicId_fkey"
      FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_questionnaires_patientId_fkey') THEN
    ALTER TABLE "health_questionnaires"
      ADD CONSTRAINT "health_questionnaires_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'health_questionnaires_filledById_fkey') THEN
    ALTER TABLE "health_questionnaires"
      ADD CONSTRAINT "health_questionnaires_filledById_fkey"
      FOREIGN KEY ("filledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FKs saltadas (deploy parcial)';
END
$hq$;

-- 4) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). MediFlow accede solo vía Prisma +
--    service role (bypassa RLS). Cierra PostgREST si se filtra el anon key.
DO $hq$
BEGIN
  EXECUTE 'ALTER TABLE "health_questionnaires" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'health_questionnaires'
      AND policyname = 'health_questionnaires_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "health_questionnaires_deny_anon" ON "health_questionnaires" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'health_questionnaires no existe — RLS saltada';
END
$hq$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   SELECT policyname FROM pg_policies WHERE tablename = 'health_questionnaires';
--   \d health_questionnaires
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'patients' AND column_name LIKE 'emergencyContact%';
-- ═══════════════════════════════════════════════════════════════════
