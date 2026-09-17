-- ⛔ SUSTITUIDO (17-sep-2026, ws1-t4): NO corras éste. El bueno es
--    sql/presupuesto-borradores-viejos-2-ARREGLO.sql
--    (a éste, con COMMIT, nada le impide cancelar un número distinto del que se contó). Se deja por historia.
-- ════════════════════════════════════════════════════════════════════════
-- Borradores fantasma de presupuestos viejos — PROPUESTA: CANCELAR Y DESLIGAR
-- Rama feat/factura-doctor-vencimiento (ws1-t3) · 17-sep-2026
-- ════════════════════════════════════════════════════════════════════════
--
-- 🔴 SIN APLICAR. NADIE lo ha corrido. Y TAL COMO ESTÁ NO CAMBIA NADA: termina
--    en ROLLBACK. Se corre así para VER los números; solo cuando Rafael los
--    haya visto y esté de acuerdo se cambia la última línea a COMMIT.
-- 🔴 ANTES: corre sql/presupuesto-borradores-viejos-conteo.sql y mira cuántas son.
--
-- ── Qué hace ────────────────────────────────────────────────────────────
-- A las facturas BORRADOR que un presupuesto creó solo por existir, y cuyo
-- paciente NO aceptó ese presupuesto:
--   1. las pasa a CANCELADA, con una nota que dice por qué (mismo formato que el
--      botón «Cancelar factura»: «[CANCELADA: …]»);
--   2. desliga el presupuesto (`quotes.invoiceId = NULL`);
--   3. guarda antes una copia de lo que tocó, para poder deshacerlo.
--
-- ── Qué NO toca, nunca ──────────────────────────────────────────────────
--   · Presupuestos ACEPTADOS: ese borrador es la factura que se va a cobrar.
--     La recepcionista la confirma desde la pantalla, como hasta hoy.
--   · Cualquier borrador con pagos (`paid` > 0 o renglones en `payments`), con
--     CFDI (`cfdiUuid` o `cfdi_records`) o con plan de pagos. Esas se ven una
--     por una (consulta 4 del conteo).
--   · Borradores hechos a mano en Facturación: solo entran los ligados a un
--     presupuesto o con la nota «Generada desde presupuesto…».
--   · Importes, folios, pagos, CFDI. Solo cambia `status`, `notes` y la liga.
--
-- ── Por qué CANCELAR y no BORRAR ni DEJAR ───────────────────────────────
--   DEJARLAS: siguen inflando «quién me debe» de Sabina, «Con deuda» de
--     Pacientes, el saldo y el «Cobrar ahora» de la ficha (que además PRIORIZA
--     el borrador) y el «debes» del portal por liga. Un paciente ve que debe
--     $18,000 de un presupuesto que nunca aceptó.
--   BORRARLAS (DELETE): es lo que hace «Eliminar borrador» en pantalla, pero en
--     masa tiene dos problemas. (a) NO SE PUEDE DESHACER. (b) El folio sale del
--     MÁXIMO emitido (next-invoice-number.ts): si el borrador borrado tenía el
--     folio más alto de la clínica, la siguiente factura REUTILIZA ese número —
--     un folio que ya pudo haberse impreso o mandado en PDF.
--   CANCELARLAS: todas las sumas de deuda del panel ya excluyen CANCELLED (la
--     cancelada conserva su `balance`, por eso todos filtran por estado); el
--     folio queda quemado y no se reutiliza; la factura sigue visible como
--     «Cancelada» con su motivo; y se deshace con un UPDATE (abajo).
--
--   ⚠️ Cancelar SIN desligar rompería el presupuesto: «Generar factura»
--     devuelve la factura ligada aunque esté cancelada (createInvoiceFromQuote
--     no mira el estado) y editar el presupuesto da 409 (una ligada que no es
--     BORRADOR bloquea). Por eso el paso 2 va en la MISMA transacción.
--
--   Lo que se pierde: la factura cancelada sigue saliendo en la lista de
--   facturas del paciente y en Facturación → Canceladas. Es ruido, pero es
--   ruido honesto y con explicación. Y esto NO deja rastro en `audit_logs`
--   (eso solo lo escribe la app): el rastro es la tabla de respaldo.

BEGIN;

-- 0) Respaldo de lo que se va a tocar. Tabla nueva, cerrada a la API pública
--    igual que las demás (en Supabase una tabla sin RLS se lee desde fuera).
CREATE TABLE IF NOT EXISTS "_respaldo_borradores_presupuesto_20260917" (
  "invoiceId"      text PRIMARY KEY,
  "clinicId"       text NOT NULL,
  "statusAntes"    text NOT NULL,
  "notesAntes"     text,
  -- TODOS los presupuestos que apuntaban a la factura (no hay índice único en
  -- quotes.invoiceId: podrían ser más de uno).
  "quoteIds"       text[] NOT NULL DEFAULT '{}',
  "respaldadoEn"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "_respaldo_borradores_presupuesto_20260917" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "_respaldo_borradores_deny_anon" ON "_respaldo_borradores_presupuesto_20260917";
CREATE POLICY "_respaldo_borradores_deny_anon" ON "_respaldo_borradores_presupuesto_20260917"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- 1) Quiénes son. La MISMA definición que el conteo, más las exclusiones.
--    Una fila por factura (sin JOIN a quotes, que podría duplicarla).
INSERT INTO "_respaldo_borradores_presupuesto_20260917" ("invoiceId", "clinicId", "statusAntes", "notesAntes", "quoteIds")
SELECT i."id", i."clinicId", i."status"::text, i."notes",
       COALESCE((SELECT array_agg(q."id") FROM "quotes" q
                  WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId"), '{}')
FROM "invoices" i
WHERE i."status" = 'DRAFT'
  AND (EXISTS (SELECT 1 FROM "quotes" q WHERE q."invoiceId" = i."id" AND q."clinicId" = i."clinicId")
       OR i."notes" LIKE 'Generada desde presupuesto%')
  -- NINGÚN presupuesto ACEPTADO apunta a ella: los aceptados se quedan.
  AND NOT EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')
  -- Nada con dinero, con CFDI o con plan de pagos.
  AND i."paid" = 0
  AND NOT EXISTS (SELECT 1 FROM "payments"      p  WHERE p."invoiceId"  = i."id")
  AND i."cfdiUuid" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "cfdi_records"  r  WHERE r."invoiceId"  = i."id")
  AND NOT EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id")
  -- Para probar primero con UNA clínica, descomenta y pon su id:
  -- AND i."clinicId" = 'PON_AQUI_EL_ID'
ON CONFLICT ("invoiceId") DO NOTHING;

-- 2) Cancelar. TODAS las condiciones se repiten aquí: el respaldo puede traer
--    filas de una corrida anterior, y entre una cosa y otra alguien pudo
--    confirmar, cobrar o timbrar la factura, o el paciente aceptar el presupuesto.
UPDATE "invoices" i
SET "status"    = 'CANCELLED'::"InvoiceStatus",
    "notes"     = COALESCE(NULLIF(i."notes", '') || E'\n', '')
                  || '[CANCELADA: borrador creado automáticamente por un presupuesto que el paciente no aceptó · limpieza 17-sep-2026]',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_respaldo_borradores_presupuesto_20260917" b
WHERE b."invoiceId" = i."id"
  AND i."status" = 'DRAFT'
  AND NOT EXISTS (SELECT 1 FROM "quotes" qa WHERE qa."invoiceId" = i."id" AND qa."status" = 'ACCEPTED')
  AND i."paid" = 0
  AND NOT EXISTS (SELECT 1 FROM "payments"      p  WHERE p."invoiceId"  = i."id")
  AND i."cfdiUuid" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "cfdi_records"  r  WHERE r."invoiceId"  = i."id")
  AND NOT EXISTS (SELECT 1 FROM "payment_plans" pp WHERE pp."invoiceId" = i."id");

-- 3) Desligar TODO presupuesto que apunte a una de las que de verdad quedaron
--    canceladas por este script (por la factura, no por el id guardado: así no
--    queda ninguno colgando de una cancelada).
UPDATE "quotes" q
SET "invoiceId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_respaldo_borradores_presupuesto_20260917" b
JOIN "invoices" i ON i."id" = b."invoiceId" AND i."status" = 'CANCELLED'
WHERE q."invoiceId" = b."invoiceId"
  AND q."clinicId"  = b."clinicId";

-- 4) Lo que pasó, por clínica. ESTO es lo que hay que mirar antes del COMMIT.
SELECT
  c."name"                                                     AS clinica,
  COUNT(*)                                                     AS respaldadas,
  COUNT(*) FILTER (WHERE i."status" = 'CANCELLED')             AS canceladas,
  COUNT(*) FILTER (WHERE i."status" <> 'CANCELLED')            AS no_tocadas,
  ROUND((SUM(i."total") FILTER (WHERE i."status" = 'CANCELLED'))::numeric, 2) AS deuda_fantasma_quitada_mxn,
  (SELECT COUNT(*) FROM "quotes" q
    WHERE q."clinicId" = c."id" AND q."invoiceId" IN
      (SELECT b2."invoiceId" FROM "_respaldo_borradores_presupuesto_20260917" b2
         JOIN "invoices" i2 ON i2."id" = b2."invoiceId" AND i2."status" = 'CANCELLED')) AS presupuestos_aun_ligados
FROM "_respaldo_borradores_presupuesto_20260917" b
JOIN "invoices" i ON i."id" = b."invoiceId"
JOIN "clinics"  c ON c."id" = b."clinicId"
GROUP BY c."id", c."name"
ORDER BY canceladas DESC;
-- Esperado: canceladas = respaldadas, no_tocadas = 0, presupuestos_aun_ligados = 0.

-- 🔴 Así como está, NO SE GUARDA NADA. Cambia a COMMIT solo tras ver el paso 4.
ROLLBACK;
-- COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- CÓMO SE DESHACE (solo si se hizo COMMIT). Devuelve cada factura a BORRADOR
-- con su nota de antes, vuelve a ligar sus presupuestos si siguen sin factura,
-- y VACÍA el respaldo (si no, una corrida posterior volvería a cancelarlas).
-- ════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- UPDATE "invoices" i
--    SET "status" = b."statusAntes"::"InvoiceStatus", "notes" = b."notesAntes", "updatedAt" = CURRENT_TIMESTAMP
--   FROM "_respaldo_borradores_presupuesto_20260917" b
--  WHERE b."invoiceId" = i."id" AND i."status" = 'CANCELLED';
-- UPDATE "quotes" q
--    SET "invoiceId" = b."invoiceId", "updatedAt" = CURRENT_TIMESTAMP
--   FROM "_respaldo_borradores_presupuesto_20260917" b
--  WHERE q."id" = ANY (b."quoteIds") AND q."clinicId" = b."clinicId" AND q."invoiceId" IS NULL;
-- DELETE FROM "_respaldo_borradores_presupuesto_20260917";
-- COMMIT;
