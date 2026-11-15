-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — permitir el ticket NEGATIVO de «Devolución de anticipo».
--
-- PENDIENTE — REQUIERE RAFAEL: pegar a mano en el SQL Editor de Supabase.
-- Depende de sql/barber_caja.sql. Es plano (sin DO $$) e idempotente: se
-- puede pegar dos veces y queda igual.
--
-- POR QUÉ
-- sql/barber_caja.sql puso la restricción "barber_sales_amounts_nonnegative"
-- (subtotal, propina y total de un ticket nunca negativos). Devolver un
-- anticipo cobrado días antes saca dinero del cajón HOY: para que el corte de
-- hoy y el ingreso del mes lo reflejen, la devolución se registra como un
-- ticket negativo en el turno abierto (decisión aprobada el 14-nov-2026).
-- Con la restricción vieja, la base rechaza ese ticket.
--
-- QUÉ HACE
-- Cambia esa restricción por otra que sigue prohibiendo montos negativos en
-- TODOS los tickets menos uno: el de devolución de anticipo, que solo escribe
-- el servidor (sin barbero, sin cita, sin propina y con su sello interno en
-- las notas). Un ticket normal negativo sigue siendo imposible.
-- No toca datos: todas las filas actuales cumplen la regla nueva.
--
-- SI ESTE ARCHIVO NO SE APLICA, TODO SIGUE FUNCIONANDO, con una diferencia:
-- al devolver un anticipo la base rechaza el ticket negativo, el panel marca
-- el anticipo como devuelto igual y avisa en pantalla que esa salida de
-- dinero NO quedó en el corte y hay que anotarla a mano. En cuanto se pega,
-- las devoluciones nuevas bajan solas el efectivo esperado y el ingreso.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "barber_sales"
  DROP CONSTRAINT IF EXISTS "barber_sales_amounts_nonnegative";

ALTER TABLE "barber_sales"
  DROP CONSTRAINT IF EXISTS "barber_sales_amounts_valid";

ALTER TABLE "barber_sales"
  ADD CONSTRAINT "barber_sales_amounts_valid"
  CHECK (
    "tip" >= 0
    AND (
      ("subtotal" >= 0 AND "total" >= 0)
      OR (
        "barberId" IS NULL
        AND "appointmentId" IS NULL
        AND "tip" = 0
        AND "total" = "subtotal"
        -- COALESCE a propósito: con notes NULL, un LIKE da NULL y un CHECK
        -- solo rechaza cuando el resultado es FALSE (dejaría pasar el ticket).
        AND COALESCE("notes", '') LIKE '#dcb {"k":"refund",%'
      )
    )
  );
