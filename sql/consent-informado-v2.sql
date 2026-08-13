-- ─────────────────────────────────────────────────────────────────────────────
-- Consentimiento informado v2 — columnas de evidencia, testigos y contrafirma.
--
-- REGISTRO: Rafael YA aplicó este ALTER en Supabase antes de la tarea. El
-- archivo queda como la fuente escrita de qué se aplicó, para poder repetirlo
-- en otro entorno (staging, base nueva) sin adivinar. Es IDEMPOTENTE: correrlo
-- dos veces no rompe nada.
--
-- Qué habilita cada bloque:
--   · updatedAt/deletedAt  → soft delete de PENDIENTES (un firmado jamás se
--     borra: NOM-004 numeral 5.11, conservación mínima 5 años).
--   · createdById/doctorId → quién generó la carta y qué estomatólogo se
--     responsabiliza del acto (NOM-004 10.1.1.4).
--   · signerName/Relation  → representante legal que firma por el paciente
--     (NOM-004 10.1.1.3).
--   · viewedAt/signedIp/signedUserAgent/contentHash → evidencia de la firma
--     electrónica: que la carta se abrió antes de firmarla, desde dónde se
--     firmó y que el texto no se alteró después (Código de Comercio arts. 89 y
--     89 bis, CFPC 210-A).
--   · witness1*/witness2*  → testigos del acto, hasta dos (NOM-004 10.1.1.7).
--   · doctorSignedAt/doctorSignatureUrl → contrafirma del estomatólogo
--     (NOM-013 9.6.9).
--   · revoked*             → revocación: no borra el documento, deja constancia.
--
-- Los ids de usuario van como TEXT SIN foreign key a propósito: la carta debe
-- seguir siendo legible aunque el usuario que la generó se dé de baja, y una FK
-- con RESTRICT bloquearía esa baja años después.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "consent_forms"
  ADD COLUMN IF NOT EXISTS "updatedAt"            timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "deletedAt"            timestamp(3),
  ADD COLUMN IF NOT EXISTS "createdById"          text,
  ADD COLUMN IF NOT EXISTS "doctorId"             text,
  ADD COLUMN IF NOT EXISTS "procedureKey"         text,
  ADD COLUMN IF NOT EXISTS "signerName"           text,
  ADD COLUMN IF NOT EXISTS "signerRelation"       text,
  ADD COLUMN IF NOT EXISTS "viewedAt"             timestamp(3),
  ADD COLUMN IF NOT EXISTS "signedIp"             text,
  ADD COLUMN IF NOT EXISTS "signedUserAgent"      text,
  ADD COLUMN IF NOT EXISTS "contentHash"          text,
  ADD COLUMN IF NOT EXISTS "witness1Name"         text,
  ADD COLUMN IF NOT EXISTS "witness1SignatureUrl" text,
  ADD COLUMN IF NOT EXISTS "witness1SignedAt"     timestamp(3),
  ADD COLUMN IF NOT EXISTS "witness2Name"         text,
  ADD COLUMN IF NOT EXISTS "witness2SignatureUrl" text,
  ADD COLUMN IF NOT EXISTS "witness2SignedAt"     timestamp(3),
  ADD COLUMN IF NOT EXISTS "doctorSignedAt"       timestamp(3),
  ADD COLUMN IF NOT EXISTS "doctorSignatureUrl"   text,
  ADD COLUMN IF NOT EXISTS "revokedAt"            timestamp(3),
  ADD COLUMN IF NOT EXISTS "revokedById"          text,
  ADD COLUMN IF NOT EXISTS "revokedReason"        text;

-- Red de seguridad por si la columna se creó ANTES como nullable: el modelo de
-- Prisma declara `updatedAt DateTime @updatedAt` (obligatorio) y leer un NULL
-- ahí revienta la consulta entera, no sólo esa fila.
UPDATE "consent_forms" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "consent_forms" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Los dos accesos reales: la lista del expediente (por paciente) y el orden
-- cronológico del panel. Ambos arrancan por clinicId porque TODA consulta de la
-- app filtra primero por la clínica de la sesión.
CREATE INDEX IF NOT EXISTS "consent_forms_clinicId_patientId_idx"
  ON "consent_forms" ("clinicId", "patientId");
CREATE INDEX IF NOT EXISTS "consent_forms_clinicId_createdAt_idx"
  ON "consent_forms" ("clinicId", "createdAt");
