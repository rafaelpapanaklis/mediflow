-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — CAJA COMPLETA (ws6-t1, 16-nov-2026).
--
-- Rafael: «necesito que sea una caja completa donde puedas ver gastos,
-- ingresos del día por ejemplo, abrir y cerrar caja».
--
-- Hasta hoy la caja solo abría turno, cobraba tickets y cerraba: no había
-- forma de anotar el efectivo que SALE del cajón (gastos, retiros, pagos a
-- barberos) ni el que ENTRA sin ser venta (cambio), y el corte nunca cuadraba.
--
-- Dos cosas, las dos ADITIVAS (no toca ni una fila que ya exista):
--
--   1. La tabla "barber_cash_movements": cada gasto, retiro, entrada de
--      efectivo y pago a barbero. Un movimiento NUNCA se borra: se anula
--      ("voidedAt", quién y por qué) y deja de contar.
--        · type    EXPENSE (gasto) | WITHDRAWAL (sacar efectivo)
--                  | DEPOSIT (meter efectivo) | BARBER_PAYOUT (pago a barbero)
--        · method  CASH | CARD | TRANSFER | OTHER — solo CASH mueve el cajón.
--                  Sacar y meter efectivo son siempre CASH.
--        · "sessionId" NULL = gasto fuera de caja (la renta pagada con
--          transferencia, la luz con tarjeta).
--        · "payoutKind" (solo en pagos a barbero): ADVANCE (adelanto/vale),
--          COMMISSION, SALARY, OTHER. "periodKey" (YYYY-MM) liga el pago al
--          periodo de Comisiones. Un adelanto se RESTA SOLO del siguiente
--          pago de su periodo; "settledAt" dice en qué pago se descontó.
--
--   2. Dos columnas en "barber_cash_sessions":
--        · "countedBreakdown" — el conteo del corte por billete/moneda
--          ({"500": 3, "0.5": 4, …}); NULL si se escribió el total directo.
--        · "leftForNext" — el fondo que se dejó para el siguiente turno
--          (la caja lo sugiere al abrir). NULL = no se dijo.
--
-- El código funciona ANTES de pegar esto: sin la tabla, los botones nuevos
-- (gasto, sacar, meter, pagar a barbero) no aparecen y la caja se ve y
-- cuadra exactamente como hoy.
--
-- Plano e idempotente: se puede pegar dos veces. Supabase → SQL Editor.
--
-- Para deshacerlo (no toca tickets, turnos ni comisiones):
--   DROP TABLE IF EXISTS "barber_cash_movements";
--   ALTER TABLE "barber_cash_sessions" DROP COLUMN IF EXISTS "countedBreakdown",
--     DROP COLUMN IF EXISTS "leftForNext";
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Movimientos de caja ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "barber_cash_movements" (
    "id"               TEXT NOT NULL,
    "barbershopId"     TEXT NOT NULL,
    "sessionId"        TEXT,
    "type"             TEXT NOT NULL,
    "method"           TEXT NOT NULL DEFAULT 'CASH',
    "amount"           DECIMAL(10,2) NOT NULL,
    "category"         TEXT,
    "note"             TEXT,
    "barberId"         TEXT,
    "payoutKind"       TEXT,
    "periodKey"        TEXT,
    "receiptUrl"       TEXT,
    "createdByUserId"  TEXT NOT NULL,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "voidedAt"         TIMESTAMPTZ,
    "voidedByUserId"   TEXT,
    "voidReason"       TEXT,
    CONSTRAINT "barber_cash_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "barber_cash_movements_shop_fkey"
        FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_cash_movements_session_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "barber_cash_sessions"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "barber_cash_movements_barber_fkey"
        FOREIGN KEY ("barberId") REFERENCES "barber_barbers"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "barber_cash_movements_created_by_fkey"
        FOREIGN KEY ("createdByUserId") REFERENCES "barber_users"("id")
        ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "barber_cash_movements_voided_by_fkey"
        FOREIGN KEY ("voidedByUserId") REFERENCES "barber_users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "barber_cash_movements_type_chk"
        CHECK ("type" IN ('EXPENSE', 'WITHDRAWAL', 'DEPOSIT', 'BARBER_PAYOUT')),
    CONSTRAINT "barber_cash_movements_method_chk"
        CHECK ("method" IN ('CASH', 'CARD', 'TRANSFER', 'OTHER')),
    -- Sacar y meter efectivo son, por definición, efectivo.
    CONSTRAINT "barber_cash_movements_cash_only_chk"
        CHECK ("type" NOT IN ('WITHDRAWAL', 'DEPOSIT') OR "method" = 'CASH'),
    CONSTRAINT "barber_cash_movements_amount_chk" CHECK ("amount" > 0),
    -- Un pago a barbero dice de qué tipo es; los demás no llevan tipo de pago.
    -- COALESCE a propósito: con "payoutKind" NULL, un IN da NULL y un CHECK
    -- solo rechaza cuando el resultado es FALSE (dejaría pasar el pago sin tipo).
    CONSTRAINT "barber_cash_movements_payout_chk"
        CHECK (
          ("type" = 'BARBER_PAYOUT' AND COALESCE("payoutKind", '') IN ('ADVANCE', 'COMMISSION', 'SALARY', 'OTHER'))
          OR ("type" <> 'BARBER_PAYOUT' AND "payoutKind" IS NULL)
        ),
    CONSTRAINT "barber_cash_movements_period_chk"
        CHECK ("periodKey" IS NULL OR "periodKey" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    -- Anulado = fecha y quién, juntos (el motivo es opcional).
    CONSTRAINT "barber_cash_movements_void_chk"
        CHECK (("voidedAt" IS NULL) = ("voidedByUserId" IS NULL))
);

-- La lista del día y la pestaña Gastos (por barbería y fecha).
CREATE INDEX IF NOT EXISTS "barber_cash_movements_shop_created_idx"
    ON "barber_cash_movements" ("barbershopId", "createdAt");

-- El resumen y el corte de un turno.
CREATE INDEX IF NOT EXISTS "barber_cash_movements_session_idx"
    ON "barber_cash_movements" ("sessionId");

-- «Adelantos del periodo» en Comisiones.
CREATE INDEX IF NOT EXISTS "barber_cash_movements_payout_idx"
    ON "barber_cash_movements" ("barbershopId", "barberId", "periodKey")
    WHERE "type" = 'BARBER_PAYOUT';

-- Adelanto/vale YA DESCONTADO en un pago de comisión o sueldo: la hora de
-- ese pago. NULL = todavía se resta del siguiente «a pagar» de su periodo.
-- (Va aparte del CREATE TABLE para que pegarlo encima de la versión anterior
-- también la agregue.)
ALTER TABLE "barber_cash_movements" ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMPTZ;

-- ── 2. Conteo del corte y fondo para el siguiente turno ────────────────
ALTER TABLE "barber_cash_sessions" ADD COLUMN IF NOT EXISTS "countedBreakdown" JSONB;
ALTER TABLE "barber_cash_sessions" ADD COLUMN IF NOT EXISTS "leftForNext" DECIMAL(10,2);

-- Plano, sin bloques anónimos: quitar y volver a poner deja lo mismo (también si ya
-- se había pegado la versión anterior de este archivo).
ALTER TABLE "barber_cash_sessions" DROP CONSTRAINT IF EXISTS "barber_cash_sessions_left_for_next_chk";
ALTER TABLE "barber_cash_sessions" ADD CONSTRAINT "barber_cash_sessions_left_for_next_chk"
  CHECK ("leftForNext" IS NULL OR "leftForNext" >= 0);
