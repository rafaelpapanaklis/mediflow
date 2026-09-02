-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — CUOTA DE ALMACENAMIENTO POR INSTITUTO.
--
-- Va DESPUÉS de sql/edu-ola-0.sql (necesita "edu_institutions"). En el
-- orden general de aplicación puede ir al FINAL, después de
-- sql/edu-pagos.sql: no depende de ninguna ola posterior a la 0 y no toca
-- ninguna de sus tablas. Producto SEPARADO del dental, que está VIVO en
-- producción: este archivo NO toca ni una tabla, ni una columna, ni una
-- fila del dental, de barbería ni de inmuebles.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. CERO DROP.
--
-- Contenido:
--   1 columna  · edu_institutions."storageQuotaBytes" (BIGINT, default 5 TB)
--   0 tablas   · el CONSUMO no se guarda, se cuenta (ver abajo)
--   0 índices  · la suma usa el que ya existe, edu_studies_patient_idx
--   0 backfill · ADD COLUMN con DEFAULT ya deja a TODOS los institutos que
--                existen hoy con los 5 TB incluidos
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
--
-- Nota sobre $$: delimitador con nombre, $edu$, y NUNCA bloques DO
-- anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 LO QUE ESTE ESQUEMA NO GUARDA, A PROPÓSITO:
--
--   · NO hay columna "bytes usados". El consumo se CUENTA con
--     SUM("sizeBytes") sobre edu_studies cada vez que alguien pregunta,
--     igual que el cupo de IA de la Ola 8 y el avance académico de la
--     Ola 6. Un contador guardado se desincroniza el día que una escritura
--     falle a la mitad, y a partir de ahí o se le bloquea la subida a una
--     escuela que sí tenía espacio, o se le regala el que ya usó.
--
--   · NO hay cuota por SEDE. La cuota es del INSTITUTO: tres sedes con
--     5 TB son 5 TB entre las tres, no 15. Las sedes son ilimitadas y
--     comparten la bolsa, así que la columna vive en edu_institutions y la
--     suma agrupa por "institutionId" (edu_studies ni siquiera tiene
--     campusId, así que ya pool los campus sola).
--
--   · NO hay tabla de RESERVAS de subida. El corte se hace al firmar la
--     URL; dos subidas en vuelo a la vez pueden rebasar la cuota por lo
--     que pesen (2 GB por archivo como mucho) y el siguiente intento ya lo
--     ve, porque el consumo se cuenta. El razonamiento completo está en
--     src/lib/edu/almacenamiento.ts.
--
-- 🔴 BIGINT y no INTEGER: 5 TB son 5 497 558 138 880, seis órdenes de
-- magnitud por encima del tope de un INTEGER de Postgres (2 147 483 647).
-- Es la misma razón por la que edu_studies."sizeBytes" ya era BIGINT.
--
-- 🔴 QUIÉN LA EDITA: DaleControl, desde /admin/institutos o con el UPDATE
-- del final de este archivo. El panel de la escuela la VE y no la toca. Si
-- la escuela pudiera subírsela sola, el cobro por TB extra no existiría.
-- El precio de ese TB extra NO vive en la base: vive en UNA constante del
-- dominio (EDU_ALM_TB_EXTRA_MXN, src/lib/edu/almacenamiento-core.ts).
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. La columna ──────────────────────────────────────────────────────

-- ADD COLUMN IF NOT EXISTS es idempotente por sí solo.
--
-- El DEFAULT hace de backfill: Postgres se lo aplica a las filas que YA
-- existen, así que todos los institutos dados de alta quedan con los 5 TB
-- que incluye un contrato institucional, sin un UPDATE aparte.
--
-- 5 * 1024^4 = 5 497 558 138 880 bytes = 5 TB.
ALTER TABLE "edu_institutions"
  ADD COLUMN IF NOT EXISTS "storageQuotaBytes" BIGINT NOT NULL DEFAULT 5497558138880;


-- ── 2. Comprobación ────────────────────────────────────────────────────

-- Que la columna existe, que es BIGINT y que ningún instituto se quedó sin
-- cuota. Si algo de esto falla, el bloque lanza y se ve en el editor: es
-- mejor enterarse aquí que cuando una escuela no pueda subir una
-- radiografía.
DO $edu$
DECLARE
  tipo TEXT;
  sin_cuota INT;
BEGIN
  SELECT data_type INTO tipo
    FROM information_schema.columns
   WHERE table_name = 'edu_institutions'
     AND column_name = 'storageQuotaBytes';

  IF tipo IS NULL THEN
    RAISE EXCEPTION 'edu_institutions."storageQuotaBytes" no existe: la columna no se creó.';
  END IF;

  IF tipo <> 'bigint' THEN
    RAISE EXCEPTION 'edu_institutions."storageQuotaBytes" es % y tiene que ser bigint.', tipo;
  END IF;

  SELECT COUNT(*) INTO sin_cuota
    FROM "edu_institutions"
   WHERE "storageQuotaBytes" IS NULL OR "storageQuotaBytes" <= 0;

  IF sin_cuota > 0 THEN
    RAISE EXCEPTION '% instituto(s) sin cuota de almacenamiento. Una cuota de cero bloquea la subida de estudios.', sin_cuota;
  END IF;
END
$edu$;


-- ── 3. Cómo se cambia una cuota a mano (NO se ejecuta) ─────────────────
--
-- Lo normal es hacerlo desde /admin/institutos, que además deja rastro de
-- auditoría con el nombre de quién la cambió. Esto es el rodeo para cuando
-- no se puede entrar al panel.
--
-- 10 TB para el instituto de slug 'mi-escuela':
--
--   UPDATE "edu_institutions"
--      SET "storageQuotaBytes" = 10 * 1024::BIGINT * 1024 * 1024 * 1024,
--          "updatedAt"         = NOW()
--    WHERE "slug" = 'mi-escuela';
--
-- ⚠️ El 1024 va casteado a BIGINT: 10 * 1024^4 no cabe en INTEGER y la
-- multiplicación desbordaría ANTES de llegar a la columna.
--
-- Y para leer cómo va cada escuela (los mismos números que pinta el
-- /admin: lo contratado, lo usado y los TB de más que hay que facturar):
--
--   SELECT i."name",
--          ROUND(i."storageQuotaBytes" / 1099511627776.0, 1) AS tb_contratados,
--          ROUND(COALESCE(SUM(s."sizeBytes"), 0) / 1099511627776.0, 2) AS tb_usados,
--          COUNT(s.id) AS estudios,
--          GREATEST(0, ROUND(i."storageQuotaBytes" / 1099511627776.0, 1) - 5) AS tb_extra
--     FROM "edu_institutions" i
--     LEFT JOIN "edu_studies" s ON s."institutionId" = i."id"
--    GROUP BY i."id", i."name", i."storageQuotaBytes"
--    ORDER BY tb_extra DESC, i."name";
--
-- (1 099 511 627 776 = 1024^4 = 1 TB. El JOIN es por institutionId y NO
-- por sede a propósito: las sedes comparten la bolsa.)
