-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T8 · ORTODONCIA, «Diagnóstico» completo (como Dentalink).
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal NO toca la base.
--
-- QUÉ AGREGA (ADITIVO, nullable; no toca ni una fila que ya exista):
--   "orthodontic_diagnoses"."diagnosticoDetalle" (JSONB): lo que el diagnóstico no tenía — características
--   faciales, líneas medias superior e inferior, planos y curvas, forma de arcos, espaciamiento, mordidas
--   cruzadas y abierta por zona, piezas ausentes/retenidas, respiración, sueño, vía aérea y el análisis
--   cefalométrico escrito a mano (VERT, Jarabak, clase, componente, ANB, Wits, stomion, Penn, sínfisis).
--   NULL = el diagnóstico todavía no tiene su parte completa (se ve como siempre).
--   Lo que el diagnóstico YA tenía (Angle, overjet/overbite en mm, apiñamiento en mm, mordidas, etiología,
--   hábitos, fase dental, patrón esquelético, ATM, resumen) SIGUE en sus columnas; la columna única de
--   línea media se deriva de las dos nuevas.
--
-- El código funciona SIN este SQL: lee y escribe la columna por SQL crudo con una sonda. Sin ella, el
-- diagnóstico se ve como siempre, lo de siempre se guarda y el paso avisa que lo nuevo no se guardó.
--
-- NO se declara en prisma/schema.prisma a propósito: con una columna de menos, cualquier lectura del
-- diagnóstico tiraría P2022 en toda la app.
--
-- IDEMPOTENTE (ADD COLUMN IF NOT EXISTS): se puede pegar dos veces. CERO DROP. PLANO: sin bloques DO.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "orthodontic_diagnoses"
  ADD COLUMN IF NOT EXISTS "diagnosticoDetalle" JSONB;

-- Comprobación (solo lee)
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orthodontic_diagnoses' AND column_name = 'diagnosticoDetalle';
