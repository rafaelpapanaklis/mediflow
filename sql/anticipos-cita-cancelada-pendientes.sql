-- ============================================================================
-- H15 (decisión de Rafael, opción A — ws1-t4): facturas con dinero pagado
-- ligadas a una cita que YA estaba cancelada antes de este cambio.
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal no
--    toca la base.
--
-- PARA QUÉ: desde ahora, cancelar una cita con dinero pagado deja la factura
-- marcada («a favor», «por reembolsar» o «pendiente de decidir»). Las que se
-- cancelaron ANTES se quedaron sin ninguna marca (en la clínica de prueba, por
-- ejemplo MF-1043: PAGADA $800 con su cita cancelada). Esto les pone la marca
-- «PENDIENTE DE DECIDIR» para que el detalle de la factura ofrezca decidir.
--
-- QUÉ TOCA: SOLO añade una línea al final de `invoices.notes`. No mueve
-- dinero, no cambia estado, importe, pagos ni la cita. No borra nada.
-- El texto sigue el formato exacto que lee el panel
-- (src/lib/anticipos/cita-cancelada-core.ts → `ultimaMarca`).
--
-- ALCANCE: todas las clínicas (la marca es inofensiva y lo que hace es dejar
-- ver el problema). Si prefieres empezar solo por la clínica de prueba, añade
-- al WHERE:  AND i."clinicId" = 'clinica_qa_prueba'
--
-- Plano e idempotente: una factura que ya tiene la marca no se vuelve a marcar.
-- ============================================================================

-- 1) Vista previa (solo lectura): qué facturas se van a marcar.
-- SELECT c."name" AS clinica, i."invoiceNumber", i."status", i."paid", a."startsAt" AS cita, a."cancelledAt"
--   FROM "invoices" i
--   JOIN "appointments" a ON a."id" = i."appointmentId"
--   JOIN "clinics" c ON c."id" = i."clinicId"
--  WHERE a."status" = 'CANCELLED'
--    AND i."status" <> 'CANCELLED'
--    AND i."paid" > 0
--    AND COALESCE(i."notes", '') NOT LIKE '%[CITA CANCELADA CON DINERO PAGADO ·%'
--  ORDER BY 1, 2;

-- 2) Poner la marca.
UPDATE "invoices" i
   SET "notes" = COALESCE(i."notes" || E'\n', '')
       || '[CITA CANCELADA CON DINERO PAGADO · PENDIENTE DE DECIDIR · $'
       || to_char(i."paid", 'FM999G999G990D00')
       || ' · revisión de facturas (SQL) · '
       || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
       || ' UTC]'
  FROM "appointments" a
 WHERE a."id" = i."appointmentId"
   AND a."status" = 'CANCELLED'
   AND i."status" <> 'CANCELLED'
   AND i."paid" > 0
   AND COALESCE(i."notes", '') NOT LIKE '%[CITA CANCELADA CON DINERO PAGADO ·%';
