-- ============================================================================
-- Ortodoncia — que «Sobremordida» y «Resalte» se puedan subir y quitar como las
-- otras 8 vistas del juego de fotos (ws1-t12).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- POR QUÉ: ortho_photo_sets guarda las vistas en 8 columnas tipadas
-- (photoFrontalId … photoOcclusalLowerId). Sobremordida y resalte, que la
-- pantalla ofrece como vistas 5 y 8 de 10, NO tienen columna, y por eso la
-- pestaña se negaba a guardarlas («Aún no se guarda»).
--
-- QUÉ HACE: en vez de tocar ortho_photo_sets (ni añadirle columnas), la foto de
-- esas dos vistas se guarda como una fila de "ortho_photo_extras" (la tabla de
-- fotos extra, ya con quién/cuándo/motivo al quitarla — NOM-004) marcada con
-- la vista en la columna nueva "slotId". Una sola foto vigente por juego y
-- vista (índice único parcial); al quitarla se MARCA, no se borra.
--
-- ORDEN: pegar DESPUÉS de sql/ortodoncia-fotos-quitadas-y-extra.sql (que crea
-- "ortho_photo_extras"). Si esa tabla aún no existe, el ALTER no hace nada y el
-- CREATE INDEX falla con «column "slotId" does not exist»: pega el otro primero
-- y vuelve a correr este.
--
-- SIN este SQL: la ficha se ve igual, las fotos extra siguen funcionando, y
-- subir sobremordida/resalte responde «todavía no se pueden guardar» sin
-- tocar nada.
--
-- Plano, aditivo e idempotente: se puede pegar dos veces. Sin DO $$, sin
-- migraciones, no altera ni borra nada existente (las filas actuales quedan con
-- "slotId" NULL = fotos extra normales).
-- ============================================================================

ALTER TABLE IF EXISTS "ortho_photo_extras" ADD COLUMN IF NOT EXISTS "slotId" text;

-- Una foto vigente por juego y vista. Las extras normales ("slotId" NULL) y las
-- ya quitadas no cuentan.
CREATE UNIQUE INDEX IF NOT EXISTS "ortho_photo_extras_slot_vigente_uq"
  ON "ortho_photo_extras" ("photoSetId", "slotId")
  WHERE "slotId" IS NOT NULL AND "removedAt" IS NULL;

-- Verificación (solo lectura):
-- SELECT e."photoSetId", e."slotId", e."createdAt", e."removedAt", e."removedReason"
-- FROM "ortho_photo_extras" e WHERE e."slotId" IS NOT NULL ORDER BY e."createdAt" DESC LIMIT 20;
