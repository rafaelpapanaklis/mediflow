-- ═══════════════════════════════════════════════════════════════════
-- ws1-t5 · F15 de la auditoría del dinero — DATOS VIEJOS (OPCIONAL)
--
-- ⚠️ ESTE ARCHIVO SÍ CAMBIA FILAS EXISTENTES. Es DECISIÓN DE RAFAEL pegarlo
--    o no (ver «DECISIONES PARA RAFAEL» del reporte ws1-t5). El código no lo
--    necesita: sin él todo funciona igual que hoy.
--
-- Cada bloque primero CUENTA y solo actualiza si encuentra exactamente las
-- filas que midió la sonda de solo lectura del 3-oct-2026; si hay otro número,
-- aborta sin tocar nada (RAISE EXCEPTION deshace el bloque).
--    https://supabase.com/dashboard/project/_/sql/new
-- ═══════════════════════════════════════════════════════════════════

-- ── A) Vista previa (solo lectura) ─────────────────────────────────
SELECT count(*) AS pagos_a_medianoche_utc, sum(p.amount) AS monto
FROM payments p JOIN invoices i ON i.id = p."invoiceId" JOIN clinics c ON c.id = i."clinicId"
WHERE p."paidAt" < '2026-09-07T06:00:00Z'
  AND p."paidAt"::time = '00:00:00'
  AND p.method <> 'refund'
  AND coalesce(c.timezone, 'America/Mexico_City') = 'America/Mexico_City';

SELECT method, count(*) AS n, sum(amount) AS monto
FROM payments WHERE method IN ('CASH', 'credit_card', 'debit_card') GROUP BY method;

-- ── B) 52 pagos guardados a las 00:00 UTC antes del arreglo del 7-sep ──
-- (La auditoría contó 56: los otros 4 son posteriores al arreglo, de la demo
-- de Rafael, y no se tocan.)
-- El modal mandaba la fecha como medianoche UTC = 18:00 del día ANTERIOR en
-- México: caían en el día (y a veces en el mes) equivocado. Se mueven a las
-- 18:00 UTC del MISMO día UTC = 12:00 en México del día que se eligió.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM payments p JOIN invoices i ON i.id = p."invoiceId" JOIN clinics c ON c.id = i."clinicId"
  WHERE p."paidAt" < '2026-09-07T06:00:00Z' AND p."paidAt"::time = '00:00:00' AND p.method <> 'refund'
    AND coalesce(c.timezone, 'America/Mexico_City') = 'America/Mexico_City';
  IF n <> 52 THEN
    RAISE EXCEPTION 'Se esperaban 52 pagos a medianoche y hay %: no se cambió nada. Revisa la vista previa.', n;
  END IF;
  UPDATE payments p SET "paidAt" = p."paidAt" + interval '18 hours'
  FROM invoices i JOIN clinics c ON c.id = i."clinicId"
  WHERE i.id = p."invoiceId"
    AND p."paidAt" < '2026-09-07T06:00:00Z' AND p."paidAt"::time = '00:00:00' AND p.method <> 'refund'
    AND coalesce(c.timezone, 'America/Mexico_City') = 'America/Mexico_City';
END $$;

-- ── C) Métodos fuera del catálogo (13 filas; vienen de la semilla de la demo) ──
-- «CASH» no entraba al efectivo del corte y «credit_card»/«debit_card» no
-- entraban como tarjeta. Se pasan a los del selector. «CARD» (3) NO se toca:
-- no se sabe si fue crédito o débito.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM payments WHERE method IN ('CASH', 'credit_card', 'debit_card');
  IF n <> 13 THEN
    RAISE EXCEPTION 'Se esperaban 13 pagos con método fuera de catálogo y hay %: no se cambió nada.', n;
  END IF;
  UPDATE payments SET method = CASE method WHEN 'CASH' THEN 'cash' WHEN 'credit_card' THEN 'credit' WHEN 'debit_card' THEN 'debit' END
  WHERE method IN ('CASH', 'credit_card', 'debit_card');
END $$;

-- ── D) Los 7 «reembolsos» que en realidad pasaron dinero a saldo a favor ──
-- Se reconocen por la nota que escribe el código (excedente de ortodoncia,
-- cita cancelada «a favor», anticipo devuelto al cancelar). Se marcan como
-- traspaso: dejan de restar como reembolso en Finanzas. No cambia ningún monto.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM payments
  WHERE method = 'refund' AND "refundMethod" IS NULL
    AND (notes LIKE 'Excedente del cobro: pasa al saldo a favor%'
      OR notes LIKE 'Pasa al saldo a favor del paciente: se canceló la cita%'
      OR notes = 'Anticipo devuelto al saldo a favor del paciente (factura cancelada)');
  IF n <> 7 THEN
    RAISE EXCEPTION 'Se esperaban 7 traspasos a saldo a favor y hay %: no se cambió nada.', n;
  END IF;
  UPDATE payments SET "refundMethod" = 'saldo_a_favor'
  WHERE method = 'refund' AND "refundMethod" IS NULL
    AND (notes LIKE 'Excedente del cobro: pasa al saldo a favor%'
      OR notes LIKE 'Pasa al saldo a favor del paciente: se canceló la cita%'
      OR notes = 'Anticipo devuelto al saldo a favor del paciente (factura cancelada)');
END $$;
