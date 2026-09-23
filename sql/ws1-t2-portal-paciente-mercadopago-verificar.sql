-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t2 · EL PORTAL DEL PACIENTE COBRA CON MERCADO PAGO.
--
-- ⚠️ ESTA RAMA NO CAMBIA LA BASE. Este archivo SOLO LEE: no crea, no borra,
-- no actualiza nada. Sirve para comprobar, antes y después de integrar, que
-- el portal va a ofrecer Mercado Pago donde toca.
--
-- El portal reutiliza la tabla "invoice_payment_links" de
-- sql/ws1-t1-factura-link-mercadopago.sql. Si esa tabla NO existe, el portal
-- no rompe: dice «Paga en tu clínica», como hoy.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. ¿Está la tabla de links de factura? (debe salir 'invoice_payment_links';
--    si sale NULL, falta pegar sql/ws1-t1-factura-link-mercadopago.sql)
SELECT to_regclass('public.invoice_payment_links') AS tabla_links_factura;

-- 2. ¿Cuántas clínicas tienen Mercado Pago conectado? (a sus pacientes el
--    portal les ofrece «Pagar con Mercado Pago»)
SELECT count(*) AS clinicas_con_mercado_pago
FROM clinic_mercadopago
WHERE "accessToken" IS NOT NULL AND "mpUserId" IS NOT NULL;

-- 3. Después de integrar: links pedidos desde el PORTAL y cuántos se pagaron.
--    Aproximado: el portal los crea sin "createdById"; los del panel lo llevan
--    (salvo que después se borrara ese usuario: la FK lo deja en NULL).
SELECT status, count(*) AS links, sum("paidAmount") AS cobrado
FROM invoice_payment_links
WHERE "createdById" IS NULL
GROUP BY status
ORDER BY status;
