-- ============================================================================
-- Ortodoncia — desactivar los procedimientos SEMBRADOS DOS VECES (ws1-t4
-- ronda 6). Solo para Rafael Clinica y la clínica de prueba QA.
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- POR QUÉ: la siembra automática del catálogo de ortodoncia no aguantaba dos
-- cargas a la vez (dos GET /api/procedures simultáneos veían el catálogo
-- vacío y sembraban los dos). El código ya está arreglado (candado por
-- clínica, `sembrarProcedimientosDeOrtodoncia`). Esto limpia lo que quedó.
--
-- QUÉ HACE: por clínica y nombre, deja ACTIVO el más antiguo y pone
-- isActive = false en los demás. NO BORRA NADA: las facturas y presupuestos
-- que apunten a un duplicado siguen igual (las facturas guardan sus conceptos
-- como copia), y se puede reactivar desde Procedimientos.
--
-- ORDEN: pégalo ANTES de sql/ortodoncia-nombres-catalogo.sql (ese renombra
-- solo el activo más antiguo de cada nombre, así que con duplicados activos
-- funciona igual, pero así el catálogo queda limpio primero).
--
-- Plano e idempotente: la segunda vez no encuentra nada que cambiar.
-- ============================================================================

-- 1) Vista previa (solo lectura): qué se va a desactivar.
-- SELECT p."clinicId", p."name", p."id", p."createdAt", p."isActive"
--   FROM "procedure_catalog" p
--  WHERE p."clinicId" IN ('cmn6soeaw0000t17xgljxc2iq', 'clinica_qa_prueba')
--    AND p."category" = 'orthodontics'
--    AND p."isActive" = true
--    AND EXISTS (
--      SELECT 1 FROM "procedure_catalog" q
--       WHERE q."clinicId" = p."clinicId" AND q."category" = p."category" AND q."name" = p."name"
--         AND q."isActive" = true
--         AND (q."createdAt", q."id") < (p."createdAt", p."id")
--    )
--  ORDER BY 1, 2, 4;

-- 2) Desactivar los duplicados (se queda activo el más antiguo de cada nombre).
UPDATE "procedure_catalog" p
   SET "isActive" = false, "updatedAt" = now()
 WHERE p."clinicId" IN ('cmn6soeaw0000t17xgljxc2iq', 'clinica_qa_prueba')  -- Rafael Clinica, Clínica de Prueba QA
   AND p."category" = 'orthodontics'
   AND p."isActive" = true
   AND EXISTS (
     SELECT 1 FROM "procedure_catalog" q
      WHERE q."clinicId" = p."clinicId" AND q."category" = p."category" AND q."name" = p."name"
        AND q."isActive" = true
        AND (q."createdAt", q."id") < (p."createdAt", p."id")
   );

-- 3) Comprobación (solo lectura): no debe quedar ningún nombre activo repetido.
-- SELECT "clinicId", "name", COUNT(*) FROM "procedure_catalog"
--  WHERE "clinicId" IN ('cmn6soeaw0000t17xgljxc2iq', 'clinica_qa_prueba')
--    AND "category" = 'orthodontics' AND "isActive" = true
--  GROUP BY 1, 2 HAVING COUNT(*) > 1;
