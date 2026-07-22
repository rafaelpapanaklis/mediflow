-- ═══════════════════════════════════════════════════════════════════
-- MULTI-CLÍNICA · FASE 2 — PACIENTES COMPARTIDOS entre sedes vinculadas
-- Tabla clinic_patient_links ⇄ modelo Prisma ClinicPatientLink
-- (ver prisma/schema.prisma, al final del archivo).
--
-- ⚠️  CORRER EN SUPABASE (SQL Editor) ANTES del merge / deploy. Prisma ya
--     declara el modelo: si la tabla NO existe, cualquier lectura de
--     pacientes con el flag encendido responde 500 (mismo patrón que Caja /
--     CRM / afiliados — ver MEMORY: lesson_ortho_schema_drift).
--     https://supabase.com/dashboard/project/_/sql/new
--
--     ⚠️ ES OBLIGATORIO ANTES DEL MERGE, no sólo antes de encender el flag.
--     El flag PATIENT_SHARING_ENABLED (src/lib/branches-shared.ts, hoy false)
--     apaga la LECTURA de pacientes compartidos, pero NO apaga la pantalla
--     /dashboard/settings/sucursales ni los endpoints /api/clinics/links:
--     esos consultan la tabla SIEMPRE. Sin este SQL, esa página revienta con
--     P2021 (500 en un server component) y los endpoints devuelven 500.
--     Correrlo antes del merge es gratis: es aditivo y no toca datos.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No borra ni modifica datos.
-- Columnas camelCase entrecomilladas (espejo exacto de Prisma; sin @map).
-- Delimitador único $cpl$ (nunca $$ pelado — Supabase lo rompe).
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tabla. El par (clinicAId, clinicBId) se guarda SIEMPRE normalizado
--    menor→mayor por id, para que el vínculo simétrico A↔B sea UNA sola fila
--    y el UNIQUE impida el duplicado invertido (B,A).
CREATE TABLE IF NOT EXISTS "clinic_patient_links" (
  "id"          text         NOT NULL,
  "clinicAId"   text         NOT NULL,
  "clinicBId"   text         NOT NULL,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" text,
  CONSTRAINT "clinic_patient_links_pkey" PRIMARY KEY ("id")
);

-- 2) Unicidad del par + índices de lectura. getVisiblePatientClinicIds busca
--    por OR (clinicAId = $1 OR clinicBId = $1), así que hacen falta LOS DOS
--    índices sueltos: el compuesto del UNIQUE no sirve para filtrar por B.
CREATE UNIQUE INDEX IF NOT EXISTS "clinic_patient_links_clinicAId_clinicBId_key"
  ON "clinic_patient_links" ("clinicAId", "clinicBId");
CREATE INDEX IF NOT EXISTS "clinic_patient_links_clinicAId_idx"
  ON "clinic_patient_links" ("clinicAId");
CREATE INDEX IF NOT EXISTS "clinic_patient_links_clinicBId_idx"
  ON "clinic_patient_links" ("clinicBId");

-- 3) CHECK de normalización. Defensa en profundidad: aunque alguien escriba
--    por fuera de la app (SQL a mano, script), la BD rechaza el par invertido
--    y el auto-vínculo. Sin esto, una fila (B,A) haría que el UNIQUE no
--    detecte el duplicado y una sede podría "compartir consigo misma".
DO $cpl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_patient_links_normalized_pair_check') THEN
    ALTER TABLE "clinic_patient_links"
      ADD CONSTRAINT "clinic_patient_links_normalized_pair_check"
      CHECK ("clinicAId" < "clinicBId");
  END IF;
END
$cpl$;

-- 4) Llaves foráneas (idempotentes vía pg_constraint).
--    Ambas clínicas → clinics CASCADE: si se borra una sede, sus vínculos
--    mueren con ella (no queda visibilidad colgando).
--    createdById → users SET NULL: espeja onDelete: SetNull de Prisma; si el
--    dueño se da de baja, el vínculo sobrevive y solo se pierde la autoría.
DO $cpl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_patient_links_clinicAId_fkey') THEN
    ALTER TABLE "clinic_patient_links"
      ADD CONSTRAINT "clinic_patient_links_clinicAId_fkey"
      FOREIGN KEY ("clinicAId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_patient_links_clinicBId_fkey') THEN
    ALTER TABLE "clinic_patient_links"
      ADD CONSTRAINT "clinic_patient_links_clinicBId_fkey"
      FOREIGN KEY ("clinicBId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinic_patient_links_createdById_fkey') THEN
    ALTER TABLE "clinic_patient_links"
      ADD CONSTRAINT "clinic_patient_links_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Tabla referenciada inexistente — FKs saltadas (deploy parcial)';
END
$cpl$;

-- 5) Defense-in-depth: RLS deny-all para anon y authenticated (patrón
--    sql/rls-deny-all-policies.sql). DaleControl accede solo vía Prisma +
--    service role (bypassa RLS). Cierra PostgREST si se filtra el anon key.
--
--    ⚠️ OJO con esta tabla en particular: quien pueda ESCRIBIR aquí se
--    auto-otorga lectura de los pacientes de otra clínica. Es la tabla con
--    más apalancamiento del esquema — el deny-all no es cosmético.
DO $cpl$
BEGIN
  EXECUTE 'ALTER TABLE "clinic_patient_links" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clinic_patient_links' AND policyname = 'clinic_patient_links_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "clinic_patient_links_deny_anon" ON "clinic_patient_links" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'clinic_patient_links no existe — RLS saltada';
END
$cpl$;

-- ═══════════════════════════════════════════════════════════════════
-- Verificación:
--   \d clinic_patient_links
--   SELECT policyname FROM pg_policies WHERE tablename = 'clinic_patient_links';
--   SELECT conname FROM pg_constraint WHERE conrelid = 'clinic_patient_links'::regclass;
--
-- Inspección de vínculos vigentes (con nombres legibles):
--   SELECT l.id, a.name AS sede_a, b.name AS sede_b, l."createdAt"
--     FROM clinic_patient_links l
--     JOIN clinics a ON a.id = l."clinicAId"
--     JOIN clinics b ON b.id = l."clinicBId"
--    ORDER BY l."createdAt";
--
-- Apagar TODO el compartir de golpe (rollback de datos, si hiciera falta):
--   DELETE FROM clinic_patient_links;
-- ═══════════════════════════════════════════════════════════════════
