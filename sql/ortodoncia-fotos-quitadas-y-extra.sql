-- ============================================================================
-- Ortodoncia — «Quitar foto» y «Agregar fotos extra» en los juegos de fotos
-- por etapa (ws1-t12).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- PARA QUÉ (NOM-004: el expediente no se borra en silencio):
--   1) ortho_photo_removals — bitácora de las fotos que se quitan de una de
--      las vistas del juego: qué archivo, de qué vista, quién, cuándo y el
--      motivo. Al quitarla, la columna del juego (ortho_photo_sets.photo*Id)
--      queda libre para subir otra foto; el archivo (patient_files + bucket)
--      NO se toca y la bitácora conserva el vínculo.
--   2) ortho_photo_extras — las fotos extra de un juego (más allá de las 10
--      vistas), con etiqueta opcional. Quitarlas las MARCA (removedAt,
--      removedById, removedReason): dejan de mostrarse, no se borran.
--
-- TABLAS NUEVAS y SIN modelo en prisma/schema.prisma: el código usa SQL crudo
-- y tolera que no existan. Sin este SQL el juego de fotos se ve igual que hoy
-- y «Quitar foto» / «Agregar fotos extra» responden «todavía no está
-- disponible»; nada se cae.
--
-- ORDEN: se puede pegar antes o después de integrar.
--
-- Plano, aditivo e idempotente: se puede pegar dos veces. Sin DO $$, sin
-- migraciones, no altera ni borra nada existente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ortho_photo_removals" (
  "id"          text        PRIMARY KEY,
  "clinicId"    text        NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "photoSetId"  text        NOT NULL REFERENCES "ortho_photo_sets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Vista de la pantalla: normal | sonrisa | lateral | frontal | lat_der | lat_izq | oclusal_inf | oclusal_sup
  "slotId"      text        NOT NULL,
  -- patient_files.id de la foto quitada. Sin FK a propósito: la bitácora sobrevive a todo.
  "fileId"      text        NOT NULL,
  -- Quién la quitó (users.id). Sin FK: si se borra el usuario, la fila sigue valiendo.
  "removedById" text        NOT NULL,
  "removedAt"   timestamptz NOT NULL DEFAULT now(),
  "reason"      text
);

CREATE INDEX IF NOT EXISTS "ortho_photo_removals_set_idx"
  ON "ortho_photo_removals" ("photoSetId");
CREATE INDEX IF NOT EXISTS "ortho_photo_removals_clinic_idx"
  ON "ortho_photo_removals" ("clinicId", "removedAt" DESC);

CREATE TABLE IF NOT EXISTS "ortho_photo_extras" (
  "id"            text        PRIMARY KEY,
  "clinicId"      text        NOT NULL REFERENCES "clinics" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "photoSetId"    text        NOT NULL REFERENCES "ortho_photo_sets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "fileId"        text        NOT NULL REFERENCES "patient_files" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Nombre opcional que le pone quien la sube («Fractura del 21», «Frenillo»…).
  "label"         text,
  "createdById"   text        NOT NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  -- Quitada: se marca, no se borra. removedAt IS NULL = se muestra.
  "removedAt"     timestamptz,
  "removedById"   text,
  "removedReason" text
);

CREATE INDEX IF NOT EXISTS "ortho_photo_extras_set_idx"
  ON "ortho_photo_extras" ("photoSetId", "createdAt")
  WHERE "removedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "ortho_photo_extras_clinic_idx"
  ON "ortho_photo_extras" ("clinicId");

-- Deny-all para anon/authenticated (Prisma usa el service role y salta RLS).
ALTER TABLE "ortho_photo_removals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ortho_photo_extras"   ENABLE ROW LEVEL SECURITY;

-- Verificación (solo lectura):
-- SELECT r."slotId", r."fileId", r."removedAt", r."reason" FROM "ortho_photo_removals" r ORDER BY r."removedAt" DESC LIMIT 20;
-- SELECT e."label", e."createdAt", e."removedAt", e."removedReason" FROM "ortho_photo_extras" e ORDER BY e."createdAt" DESC LIMIT 20;
