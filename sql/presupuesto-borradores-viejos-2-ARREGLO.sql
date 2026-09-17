-- ════════════════════════════════════════════════════════════════════════
-- Borradores fantasma de presupuestos viejos · 2 de 2 · ARREGLO: CANCELAR Y DESLIGAR
-- Rama fix/borradores-viejos-sql (ws1-t4) · 17-sep-2026
-- Sustituye a sql/presupuesto-borradores-viejos-cancelar-PROPUESTA.sql (ws1-t3),
-- que se queda en el repo como estaba. Qué cambia respecto a aquél, abajo.
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 SIN APLICAR. Nadie lo ha corrido contra la base de las clínicas.
-- 🔴 TAL COMO ESTÁ NO GUARDA NADA, y tiene DOS candados, no uno:
--      1. termina en ROLLBACK;
--      2. lleva escrito `esperadas = -1`, y con eso el paso 6 CORTA la
--         transacción a propósito con un mensaje que empieza por «SIMULACRO» y
--         trae los números. Sale en rojo, como un error: ES LO PREVISTO. Es la
--         única forma de que el editor de Supabase (que solo enseña lo último)
--         te diga qué habría hecho. Con una transacción cortada, ni un COMMIT
--         puesto por descuido guarda nada.
-- 🔴 DESPUÉS DE CADA SIMULACRO, corre una línea sola:   ROLLBACK;
--    Al cortar el paso 6, el editor puede no llegar a mandar el ROLLBACK del
--    final. Nada queda guardado de ninguna forma, pero la conexión podría seguir
--    sujetando esas filas y dejar esperando a una recepcionista. Si no había
--    nada abierto, ese ROLLBACK suelto solo da un aviso: es inocuo.
-- 🔴 Supabase puede pedir confirmación por «operación destructiva»: es por el
--    DROP POLICY de la tabla de respaldo. No borra ningún dato.
-- 🔴 ANTES: corre sql/presupuesto-borradores-viejos-1-CONTEO.sql.
--
-- ── Para aplicarlo de verdad hacen falta DOS cambios a mano ─────────────
--      a) en el paso 0, cambia -1 por el número EXACTO que te dio el SIMULACRO.
--         Es la fila «8 · SE CANCELA» del conteo, menos las que el paso 1b
--         aparta por tener condiciones de pago a mano (el mensaje dice cuántas);
--      b) en la última línea, cambia ROLLBACK por COMMIT.
--    Si entre el conteo y la aplicación el número cambió (alguien confirmó un
--    borrador, un paciente aceptó un presupuesto), el paso 6 corta y no se
--    guarda nada: se vuelve a contar. NUNCA se cancela un número de facturas
--    distinto del que Rafael vio.
--    Para ensayar con UNA clínica: descomenta la línea marcada en el paso 1.
--
-- ── Qué hace ────────────────────────────────────────────────────────────
-- A las facturas BORRADOR que un presupuesto creó solo por existir (29-jun →
-- 16-sep-2026) y cuyo paciente NO aceptó ese presupuesto:
--   · las pasa a CANCELADA, con la nota en el mismo formato que el botón
--     «Cancelar factura» («[CANCELADA: …]», api/invoices/[id]/cancel/route.ts:59);
--   · desliga el presupuesto (`quotes.invoiceId = NULL`) en la MISMA transacción.
--     Cancelar sin desligar rompería el presupuesto: «Generar factura» devuelve
--     la ligada aunque esté cancelada (create-invoice-from-quote.ts:141) y
--     editarlo daría 409 (invoice-from-quote-core.ts:96);
--   · guarda copia de lo que tocó, para poder deshacerlo (al final).
--
-- ── Qué NO toca, nunca ──────────────────────────────────────────────────
--   · CON PAGOS (`paid` > 0 o renglones en `payments`, aunque sumen cero: un
--     reembolso total deja renglón). Cancelarla sacaría ese dinero de los
--     ingresos: Caja, Hoy y Sabina excluyen los pagos de facturas canceladas
--     (caja.ts:68 y :94, api/dashboard/home/revenue:48). El botón de la app
--     tampoco deja (cancel/route.ts:54).
--   · CON CFDI (`cfdiUuid` o renglones en `cfdi_records`, del estado que sean).
--     Un CFDI timbrado existe ante el SAT: cancelar la factura aquí NO lo
--     cancela allá, y no hay botón de cancelar CFDI en la app. Quedaría un
--     ingreso declarado al SAT sobre una factura que el panel dice anulada.
--   · Con plan de pagos, o ligada a una cita.
--   · Presupuestos ACEPTADOS: ese borrador es la factura que se va a cobrar.
--   · Con el importe cambiado a mano (su total ya no es el del presupuesto) o
--     con condiciones de pago capturadas (si esa tabla existe): alguien la
--     estaba trabajando.
--   · Creadas fuera de 29-jun → 16-sep-2026, o borradores hechos a mano.
--   · Facturas que ya NO son borrador (consulta D del conteo). Ni las ve.
--   · Importes, folios, fechas. Solo cambian `status`, `notes` y la liga.
--   Todas ésas SE QUEDAN COMO ESTÁN. El conteo (A, C y D) dice cuántas son.

BEGIN;

-- 0) 🔒 El candado. -1 = SIMULACRO. Para aplicar: el número que dio el SIMULACRO.
SELECT set_config('limpieza.esperadas', '-1', true);

-- 1) Quiénes son. La MISMA condición que «8 · SE CANCELA» del conteo.
--    Tabla temporal: vive solo en esta transacción y solo con lo de ESTA corrida.
CREATE TEMP TABLE "_candidatas" ON COMMIT DROP AS
SELECT i."id" AS "invoiceId", i."clinicId", i."status"::text AS "statusAntes", i."notes" AS "notesAntes", i."total",
       COALESCE((SELECT array_agg(q."id" ORDER BY q."id") FROM "quotes" q
                  WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"), '{}') AS "quoteIds"
FROM "invoices" i
WHERE i."status" = 'DRAFT'
  AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
       OR i."notes" LIKE 'Generada desde presupuesto%')
  AND i."paid" = 0
  AND NOT EXISTS (SELECT 1 FROM "payments"      p  WHERE p."invoiceId"  = i."id")
  AND i."cfdiUuid" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "cfdi_records"  r  WHERE r."invoiceId"  = i."id")
  AND NOT EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")
  AND i."appointmentId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')
  AND NOT EXISTS (SELECT 1 FROM "quotes" qt WHERE qt."invoiceId" = i."id" AND abs(qt."total"::numeric - i."total"::numeric) > 1)
  AND i."createdAt" >= TIMESTAMP '2026-06-29' AND i."createdAt" < TIMESTAMP '2026-09-17'
  -- Para ensayar con UNA clínica, descomenta y pon su id:
  -- AND i."clinicId" = 'PON_AQUI_EL_ID'
;

-- 1b) Fuera las que tengan condiciones de pago capturadas a mano. Esa tabla se
--     creó por SQL aparte y puede no existir: por eso va en un bloque que mira
--     primero si está.
CREATE TEMP TABLE "_apartadas_por_condiciones" ("invoiceId" text) ON COMMIT DROP;
DO $$
BEGIN
  IF to_regclass('public.invoice_payment_terms') IS NOT NULL THEN
    EXECUTE 'WITH d AS (DELETE FROM "_candidatas" c
                         WHERE EXISTS (SELECT 1 FROM public."invoice_payment_terms" t WHERE t."invoiceId" = c."invoiceId")
                         RETURNING c."invoiceId")
             INSERT INTO "_apartadas_por_condiciones" SELECT "invoiceId" FROM d';
  END IF;
END $$;

-- 2) Cancelar. Las condiciones se REPITEN: entre el paso 1 y éste alguien pudo
--    confirmar la factura o el paciente aceptar el presupuesto.
CREATE TEMP TABLE "_canceladas" ("invoiceId" text PRIMARY KEY) ON COMMIT DROP;
WITH u AS (
  UPDATE "invoices" i
  SET "status"    = 'CANCELLED'::"InvoiceStatus",
      "notes"     = COALESCE(NULLIF(i."notes", '') || E'\n', '')
                    || '[CANCELADA: borrador que un presupuesto creó solo y que el paciente no aceptó · limpieza borradores de presupuesto 17-sep-2026]',
      "updatedAt" = (now() AT TIME ZONE 'utc')
  FROM "_candidatas" c
  WHERE c."invoiceId" = i."id"
    AND i."status" = 'DRAFT'
    AND i."paid" = 0
    AND NOT EXISTS (SELECT 1 FROM "payments"      p  WHERE p."invoiceId"  = i."id")
    AND i."cfdiUuid" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "cfdi_records"  r  WHERE r."invoiceId"  = i."id")
    AND NOT EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")
    AND i."appointmentId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')
    AND NOT EXISTS (SELECT 1 FROM "quotes" qt WHERE qt."invoiceId" = i."id" AND abs(qt."total"::numeric - i."total"::numeric) > 1)
  RETURNING i."id"
)
INSERT INTO "_canceladas" SELECT "id" FROM u;

-- 3) Respaldo SOLO de lo que de verdad se canceló. Tabla cerrada a la API
--    pública, como las demás (en Supabase una tabla sin RLS se lee desde fuera).
CREATE TABLE IF NOT EXISTS "_respaldo_borradores_presupuesto_20260917" (
  "invoiceId"    text PRIMARY KEY,
  "clinicId"     text NOT NULL,
  "statusAntes"  text NOT NULL,
  "notesAntes"   text,
  -- TODOS los presupuestos que apuntaban a la factura (no hay índice único en
  -- quotes.invoiceId: pueden ser más de uno).
  "quoteIds"     text[] NOT NULL DEFAULT '{}',
  "respaldadoEn" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deshechoEn"   timestamp(3)
);
ALTER TABLE "_respaldo_borradores_presupuesto_20260917" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "_respaldo_borradores_deny_anon" ON "_respaldo_borradores_presupuesto_20260917";
CREATE POLICY "_respaldo_borradores_deny_anon" ON "_respaldo_borradores_presupuesto_20260917"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

INSERT INTO "_respaldo_borradores_presupuesto_20260917" ("invoiceId", "clinicId", "statusAntes", "notesAntes", "quoteIds")
SELECT c."invoiceId", c."clinicId", c."statusAntes", c."notesAntes", c."quoteIds"
FROM "_candidatas" c
JOIN "_canceladas" x ON x."invoiceId" = c."invoiceId"
ON CONFLICT ("invoiceId") DO UPDATE
  SET "statusAntes" = EXCLUDED."statusAntes", "notesAntes" = EXCLUDED."notesAntes",
      "quoteIds" = EXCLUDED."quoteIds", "respaldadoEn" = (now() AT TIME ZONE 'utc'), "deshechoEn" = NULL;

-- 4) Desligar los presupuestos de las que se cancelaron AHORA, y solo de ésas.
UPDATE "quotes" q
SET "invoiceId" = NULL,
    "updatedAt" = (now() AT TIME ZONE 'utc')
FROM "_canceladas" x
JOIN "invoices" i ON i."id" = x."invoiceId"
WHERE q."invoiceId" = x."invoiceId"
  AND q."clinicId"  = i."clinicId";

-- 5) Lo que pasó, por clínica. (En psql se ve; en Supabase lo cuenta el paso 6.)
SELECT
  c."name"                                                          AS clinica,
  COUNT(*)                                                          AS candidatas,
  COUNT(x."invoiceId")                                              AS canceladas,
  COUNT(*) - COUNT(x."invoiceId")                                   AS no_tocadas,
  ROUND((SUM(k."total") FILTER (WHERE x."invoiceId" IS NOT NULL))::numeric, 2) AS deuda_fantasma_quitada_mxn,
  COALESCE(SUM(cardinality(k."quoteIds")) FILTER (WHERE x."invoiceId" IS NOT NULL), 0) AS presupuestos_desligados
FROM "_candidatas" k
JOIN "clinics" c ON c."id" = k."clinicId"
LEFT JOIN "_canceladas" x ON x."invoiceId" = k."invoiceId"
GROUP BY c."id", c."name"
ORDER BY canceladas DESC;

-- 6) 🔒 El candado se cierra aquí. Si algo no cuadra, CORTA: no se guarda nada.
DO $$
DECLARE
  esperadas  int := current_setting('limpieza.esperadas')::int;
  canceladas int;  clinicas int;  monto numeric;  desligados int;  apartadas int;
  colgando   int;  sucias int;
BEGIN
  SELECT COUNT(*), COUNT(DISTINCT k."clinicId"), COALESCE(ROUND(SUM(k."total")::numeric, 2), 0),
         COALESCE(SUM(cardinality(k."quoteIds")), 0)
    INTO canceladas, clinicas, monto, desligados
    FROM "_canceladas" x JOIN "_candidatas" k ON k."invoiceId" = x."invoiceId";
  SELECT COUNT(*) INTO apartadas FROM "_apartadas_por_condiciones";

  -- Ningún presupuesto puede quedar apuntando a una cancelada por esta corrida.
  SELECT COUNT(*) INTO colgando
    FROM "quotes" q JOIN "_canceladas" x ON x."invoiceId" = q."invoiceId"
    JOIN "invoices" i ON i."id" = x."invoiceId" AND i."clinicId" = q."clinicId";
  -- Ninguna cancelada puede tener dinero, CFDI ni plan. (Doble comprobación.)
  SELECT COUNT(*) INTO sucias
    FROM "invoices" i JOIN "_canceladas" x ON x."invoiceId" = i."id"
   WHERE i."paid" <> 0 OR i."cfdiUuid" IS NOT NULL OR i."status" <> 'CANCELLED'
      OR EXISTS (SELECT 1 FROM "payments"      p  WHERE p."invoiceId"  = i."id")
      OR EXISTS (SELECT 1 FROM "cfdi_records"  r  WHERE r."invoiceId"  = i."id")
      OR EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id");

  IF colgando > 0 OR sucias > 0 THEN
    RAISE EXCEPTION 'ALGO NO CUADRA — no se guardó nada. Presupuestos aún ligados a una cancelada: %. Canceladas con pagos, CFDI o plan: %. No lo apliques: avisa.', colgando, sucias;
  END IF;
  IF canceladas = 0 THEN
    RAISE EXCEPTION 'NADA QUE CANCELAR — no se guardó nada. Ningún borrador cumple las condiciones (apartadas por condiciones de pago a mano: %).', apartadas;
  END IF;
  IF esperadas = -1 THEN
    RAISE EXCEPTION 'SIMULACRO — no se guardó nada. Se cancelarían % borradores de % clínicas, por $% de deuda que no existe, y se desligarían % presupuestos. Apartadas por tener condiciones de pago a mano: %. AHORA corre una línea sola: ROLLBACK;  — Para aplicarlo: escribe % en el paso 0 y cambia ROLLBACK por COMMIT.',
      canceladas, clinicas, monto, desligados, apartadas, canceladas;
  END IF;
  IF esperadas <> canceladas THEN
    RAISE EXCEPTION 'EL NÚMERO CAMBIÓ — no se guardó nada. Esperabas % y ahora serían %. Vuelve a correr el conteo y decide con el número nuevo.', esperadas, canceladas;
  END IF;
  RAISE NOTICE 'Cuadra: % borradores cancelados de % clínicas ($%), % presupuestos desligados.', canceladas, clinicas, monto, desligados;
END $$;

-- 🔴 Así como está, NO SE GUARDA NADA.
ROLLBACK;
-- COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- CÓMO SE DESHACE (solo si se hizo COMMIT). Devuelve cada factura a BORRADOR
-- con su nota de antes y vuelve a ligar sus presupuestos si siguen sin factura.
-- No borra el respaldo: lo marca como deshecho. Solo toca las que siguen tal
-- como las dejó este script (canceladas y con SU nota).
-- ════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- UPDATE "invoices" i
--    SET "status" = b."statusAntes"::"InvoiceStatus", "notes" = b."notesAntes", "updatedAt" = (now() AT TIME ZONE 'utc')
--   FROM "_respaldo_borradores_presupuesto_20260917" b
--  WHERE b."invoiceId" = i."id" AND b."deshechoEn" IS NULL
--    AND i."status" = 'CANCELLED' AND i."notes" LIKE '%limpieza borradores de presupuesto 17-sep-2026]'
--    -- Si el paciente aceptó después y ya se le generó OTRA factura, ésta se
--    -- queda cancelada: resucitarla sería cobrarle dos veces.
--    AND NOT EXISTS (SELECT 1 FROM "quotes" q WHERE q."id" = ANY (b."quoteIds")
--                      AND q."invoiceId" IS NOT NULL AND q."invoiceId" <> b."invoiceId");
-- UPDATE "quotes" q
--    SET "invoiceId" = b."invoiceId", "updatedAt" = (now() AT TIME ZONE 'utc')
--   FROM "_respaldo_borradores_presupuesto_20260917" b
--   JOIN "invoices" i ON i."id" = b."invoiceId" AND i."status" = 'DRAFT'
--  WHERE q."id" = ANY (b."quoteIds") AND q."clinicId" = b."clinicId" AND q."invoiceId" IS NULL
--    AND b."deshechoEn" IS NULL;
-- UPDATE "_respaldo_borradores_presupuesto_20260917" b
--    SET "deshechoEn" = (now() AT TIME ZONE 'utc')
--   FROM "invoices" i
--  WHERE i."id" = b."invoiceId" AND i."status" = 'DRAFT' AND b."deshechoEn" IS NULL;
-- COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- Qué cambia respecto a presupuesto-borradores-viejos-cancelar-PROPUESTA.sql
-- ════════════════════════════════════════════════════════════════════════
--  1. El candado del número: aquél, con COMMIT, cancelaba las que hubiera.
--  2. En Supabase aquél no enseñaba nada: su paso 4 no era la última sentencia.
--  3. Sus pasos 3 y 4 recorrían TODO el respaldo, corridas anteriores incluidas;
--     éste solo lo cancelado en esta corrida, y respalda solo lo que canceló
--     (aquél respaldaba candidatas aunque luego no las tocara).
--  4. Exclusiones nuevas: ligada a una cita, fuera de fechas, condiciones a mano.
--  5. El deshacer ya no borra el respaldo (DELETE): lo marca. Y no resucita un
--     borrador si su presupuesto ya tiene otra factura.
--
-- Dos cosas que conviene saber: (a) esto NO deja rastro en `audit_logs` (eso
-- solo lo escribe la app): el rastro es la nota de cada factura y la tabla de
-- respaldo; (b) la tabla de respaldo no está en schema.prisma: un
-- `prisma db push` futuro propondría borrarla.
