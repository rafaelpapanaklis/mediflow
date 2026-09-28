-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T4 · ORTODONCIA OLA 1, «CONTROL Y AGENDA».
--
-- Dos columnas aditivas en "ortho_treatment_cards", pedidas por el
-- documento de alcance (REPORTE-ws1-t8.md):
--   C2) "activationsNote" — activaciones de la visita (vueltas de
--       expansor, resortes, arcos auxiliares). Texto libre, por visita.
--   C3) "indications"     — indicaciones para el paciente de esa visita
--       (elásticos, higiene, qué no comer, qué hacer si se despega un
--       bracket), separadas de la nota SOAP.P.
--
-- NO toca ni una fila que ya exista: las dos columnas nacen NULL, que es
-- "sin activaciones anotadas todavía" / "sin indicaciones propias todavía"
-- para cualquier hoja ya guardada.
--
-- IDEMPOTENTE: el bloque comprueba existencia antes de crear; correrlo
-- varias veces no da errores ni duplicados. CERO DROP de tablas o columnas.
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- El código YA tolera que estas columnas aún no existan (P2021/P2022,
-- mismo patrón que sql/ortodoncia-nucleo.sql y cobranza-db.ts) — pegar
-- este SQL no es bloqueante para que dev.108 siga funcionando mientras
-- no se pega.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "ortho_treatment_cards"
  ADD COLUMN IF NOT EXISTS "activationsNote" TEXT;

ALTER TABLE "ortho_treatment_cards"
  ADD COLUMN IF NOT EXISTS "indications" TEXT;


-- ── Comprobación (solo lee) ───────────────────────────────────────────
-- Debe devolver 2 filas.
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'ortho_treatment_cards'
  AND column_name IN ('activationsNote', 'indications')
ORDER BY column_name;
