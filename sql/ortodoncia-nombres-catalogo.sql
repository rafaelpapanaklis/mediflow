-- ============================================================================
-- Ortodoncia — un solo nombre por cosa entre tipos de cita y procedimientos
-- (fila 34 de la revisión de uso, ws1-t4 ronda 6; decisión del gerente).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- PARA QUÉ: la siembra nueva ya usa los nombres de los tipos de cita. Esto
-- alinea los catálogos que YA se sembraron (hoy solo clínicas de prueba):
--   «Estudio de registros de ortodoncia»      → «Toma de registros de ortodoncia»
--   «Urgencia de ortodoncia fuera de control» → «Urgencia de ortodoncia»
--
-- QUÉ NO TOCA:
--   · Facturas ya emitidas: guardan sus conceptos como copia (invoices.items,
--     JSON). Esto solo cambia el catálogo, no ningún documento.
--   · Una clínica que ya tenga un procedimiento con el nombre nuevo: se deja
--     como está (no se crean dos con el mismo nombre).
--   · «Activación», «Cambio de arco» y «Ajuste de aparatología» (fila 35): no
--     se borran ni se desactivan; el código deja de sembrarlos y de ofrecerlos
--     en el menú del bot.
--
-- ORDEN: si la clínica tiene el catálogo sembrado dos veces, pega ANTES
-- sql/ortodoncia-catalogo-duplicados.sql. Se puede pegar antes o después de integrar. Sin él, esas clínicas
-- conservan los nombres viejos y todo funciona igual.
--
-- Plano e idempotente: la segunda vez no encuentra nada que cambiar.
-- ============================================================================

UPDATE "procedure_catalog" p
   SET "name" = 'Toma de registros de ortodoncia', "updatedAt" = now()
 WHERE p."category" = 'orthodontics'
   AND p."name" = 'Estudio de registros de ortodoncia'
   -- Solo UNO por clínica (el activo más antiguo): si hay duplicados, los
   -- demás se quedan con el nombre viejo y así no nacen dos con el nuevo.
   AND p."id" = (
     SELECT r."id" FROM "procedure_catalog" r
      WHERE r."clinicId" = p."clinicId" AND r."category" = 'orthodontics' AND r."name" = 'Estudio de registros de ortodoncia'
      ORDER BY r."isActive" DESC, r."createdAt", r."id"
      LIMIT 1
   )
   AND NOT EXISTS (
     SELECT 1 FROM "procedure_catalog" q
      WHERE q."clinicId" = p."clinicId" AND q."name" = 'Toma de registros de ortodoncia'
   );

UPDATE "procedure_catalog" p
   SET "name" = 'Urgencia de ortodoncia', "updatedAt" = now()
 WHERE p."category" = 'orthodontics'
   AND p."name" = 'Urgencia de ortodoncia fuera de control'
   -- Solo UNO por clínica (el activo más antiguo): si hay duplicados, los
   -- demás se quedan con el nombre viejo y así no nacen dos con el nuevo.
   AND p."id" = (
     SELECT r."id" FROM "procedure_catalog" r
      WHERE r."clinicId" = p."clinicId" AND r."category" = 'orthodontics' AND r."name" = 'Urgencia de ortodoncia fuera de control'
      ORDER BY r."isActive" DESC, r."createdAt", r."id"
      LIMIT 1
   )
   AND NOT EXISTS (
     SELECT 1 FROM "procedure_catalog" q
      WHERE q."clinicId" = p."clinicId" AND q."name" = 'Urgencia de ortodoncia'
   );

-- Verificación (solo lectura): qué clínicas conservan un nombre viejo.
-- SELECT c."name" AS clinica, p."name", p."isActive"
--   FROM "procedure_catalog" p JOIN "clinics" c ON c."id" = p."clinicId"
--  WHERE p."category" = 'orthodontics'
--    AND p."name" IN ('Estudio de registros de ortodoncia', 'Urgencia de ortodoncia fuera de control',
--                     'Activación', 'Cambio de arco', 'Ajuste de aparatología')
--  ORDER BY 1, 2;
