-- ═══════════════════════════════════════════════════════════════════════
-- Ortodoncia — el material de arco que elige el doctor es el que se guarda
-- (ws1-t12, ticket BEVADENT tercero, punto 4d). Para TODAS las clínicas.
--
-- Antes «Multi-stranded» y «Cr-Co (Elgiloy)» se guardaban como 'SS' (acero)
-- y «NiTi superelástico» / «NiTi termoactivado» como 'NITI' a secas: quien
-- elegía Cr-Co veía después «SS» en la ficha, la hoja y el historial.
--
-- Contenido:
--   4 valores de enum · "OrthoWireMaterial" += NITI_SUPERELASTIC, NITI_THERMAL,
--                       MULTISTRANDED, CR_CO
--   0 tablas, 0 columnas. CERO DROP. Idempotente (IF NOT EXISTS).
--
-- Sin este script el código ya funciona: un NiTi superelástico o
-- termoactivado se guarda como 'NITI' (como siempre) y Multi-stranded / Cr-Co
-- NO se guardan: la pantalla dice «aún no está disponible» en vez de
-- guardarlos como acero. Al pegarlo, en ≤10 min (o al instante tras un
-- redeploy) se guardan con su nombre.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar el BLOQUE 1 → Run.
-- El BLOQUE 2 es opcional y va en OTRA ejecución (ver abajo).
--
-- ⚠️ Los ALTER TYPE van SUELTOS: Postgres no deja usar un valor de enum
-- recién agregado en la misma transacción que lo agregó.
-- ═══════════════════════════════════════════════════════════════════════

-- ── BLOQUE 1 ─────────────────────────────────────────────────────────────
ALTER TYPE "OrthoWireMaterial" ADD VALUE IF NOT EXISTS 'NITI_SUPERELASTIC';
ALTER TYPE "OrthoWireMaterial" ADD VALUE IF NOT EXISTS 'NITI_THERMAL';
ALTER TYPE "OrthoWireMaterial" ADD VALUE IF NOT EXISTS 'MULTISTRANDED';
ALTER TYPE "OrthoWireMaterial" ADD VALUE IF NOT EXISTS 'CR_CO';


-- ── BLOQUE 2 (OPCIONAL, en una ejecución APARTE, después del 1) ──────────
-- Corrige los arcos YA guardados con el material equivocado. Cada alta de
-- arco dejó en audit_logs la clave que eligió el doctor
-- (changes → _created → after → material = 'CRCO', 'MULTI', 'NITI_SUPER',
-- 'NITI_THERMO'). Solo se toca un arco si hoy sigue con el valor al que se
-- aplanó ('SS' o 'NITI') y es de la MISMA clínica que la fila de bitácora.
--
-- Primero, para ver cuántos son (solo lectura):
--
-- SELECT a.changes->'_created'->'after'->>'material' AS elegido, w.material AS guardado, count(*)
--   FROM ortho_wire_steps w
--   JOIN audit_logs a ON a."entityId" = w.id AND a."clinicId" = w."clinicId"
--  WHERE a.action = 'ortho.wireStep.added' AND a."entityType" = 'OrthoWireStep'
--    AND a.changes->'_created'->'after'->>'material' IN ('CRCO','MULTI','NITI_SUPER','NITI_THERMO')
--  GROUP BY 1, 2;
--
-- Y la corrección:
--
-- UPDATE ortho_wire_steps w
--    SET material = (CASE a.changes->'_created'->'after'->>'material'
--                      WHEN 'CRCO'        THEN 'CR_CO'
--                      WHEN 'MULTI'       THEN 'MULTISTRANDED'
--                      WHEN 'NITI_SUPER'  THEN 'NITI_SUPERELASTIC'
--                      WHEN 'NITI_THERMO' THEN 'NITI_THERMAL'
--                    END)::"OrthoWireMaterial",
--        "updatedAt" = now()
--   FROM audit_logs a
--  WHERE a."entityId" = w.id AND a."clinicId" = w."clinicId"
--    AND a.action = 'ortho.wireStep.added' AND a."entityType" = 'OrthoWireStep'
--    AND (   (a.changes->'_created'->'after'->>'material' IN ('CRCO','MULTI') AND w.material = 'SS')
--         OR (a.changes->'_created'->'after'->>'material' IN ('NITI_SUPER','NITI_THERMO') AND w.material = 'NITI'));
