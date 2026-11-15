-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — ESTRELLAS Y BONOS (ws6-t5, 15-nov-2026).
--
-- Una tabla nueva: el catálogo de BONOS de cada barbería. Cada bono cuesta N
-- estrellas y da algo: un servicio gratis, un descuento en pesos o en %, u
-- «otro» (texto libre).
--
-- Las estrellas NO se guardan aquí ni en ningún lado: se CUENTAN desde las
-- citas y los tickets (src/lib/barber/loyalty-core.ts). Las que se dan o
-- quitan a mano viven en barber_clients.preferences (llave __stars) y el
-- enlace personal de la tarjeta en __card: nada de eso necesita SQL.
--
-- EL PREMIO DE SIEMPRE SE VUELVE EL PRIMER BONO (paso 3): a cada barbería
-- que todavía no tenga bonos se le crea uno con el nombre y el número de
-- su premio actual (barber_shops.loyaltyReward / loyaltyThreshold), tipo
-- «servicio gratis, el que elijas en caja», que es justo como funcionaba.
-- Nadie pierde estrellas: los canjes viejos siguen restando lo que costaron.
--
-- El código funciona ANTES de pegar esto: sin la tabla, el premio de siempre
-- hace de único bono y la pantalla de bonos avisa que falta este archivo.
--
-- Plano e idempotente: se puede pegar dos veces sin error y sin duplicar.
-- Pegar en Supabase → SQL Editor, de una sola vez.
--
-- Para deshacerlo (no se pierde ninguna estrella; se vuelve al premio único):
--   DROP TABLE IF EXISTS "barber_loyalty_rewards";
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. La tabla ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "barber_loyalty_rewards" (
    "id"           TEXT NOT NULL,
    "barbershopId" TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "cost"         INTEGER NOT NULL,
    "kind"         TEXT NOT NULL,
    "serviceId"    TEXT,
    "amount"       DECIMAL(10,2),
    "percent"      INTEGER,
    "description"  TEXT,
    "active"       BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_loyalty_rewards_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "barber_loyalty_rewards_barbershopId_fkey"
        FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    -- Los mismos rangos que valida src/lib/barber/stars-core.ts.
    CONSTRAINT "barber_loyalty_rewards_name_chk"    CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
    CONSTRAINT "barber_loyalty_rewards_cost_chk"    CHECK ("cost" BETWEEN 1 AND 100),
    CONSTRAINT "barber_loyalty_rewards_kind_chk"    CHECK ("kind" IN ('service', 'amount', 'percent', 'other')),
    CONSTRAINT "barber_loyalty_rewards_amount_chk"  CHECK ("amount" IS NULL OR ("amount" > 0 AND "amount" <= 10000)),
    CONSTRAINT "barber_loyalty_rewards_percent_chk" CHECK ("percent" IS NULL OR "percent" BETWEEN 1 AND 100),
    CONSTRAINT "barber_loyalty_rewards_what_chk"    CHECK (
        ("kind" = 'service') OR
        ("kind" = 'amount'  AND "amount"  IS NOT NULL) OR
        ("kind" = 'percent' AND "percent" IS NOT NULL) OR
        ("kind" = 'other'   AND "description" IS NOT NULL)
    )
);

-- ── 2. Índice (toda lectura filtra por barbería) ───────────────────────
CREATE INDEX IF NOT EXISTS "barber_loyalty_rewards_barbershopId_idx"
    ON "barber_loyalty_rewards" ("barbershopId", "sortOrder");

-- ── 3. El premio de siempre → primer bono (solo si la barbería no tiene) ─
-- id determinista ('premio-' || id de la barbería): pegarlo dos veces no
-- crea dos bonos (ON CONFLICT) y una barbería que ya armó los suyos no se toca
-- (NOT EXISTS).
INSERT INTO "barber_loyalty_rewards"
    ("id", "barbershopId", "name", "cost", "kind", "serviceId", "active", "sortOrder")
SELECT
    'premio-' || s."id",
    s."id",
    LEFT(COALESCE(NULLIF(btrim(s."loyaltyReward"), ''), 'Corte gratis'), 60),
    LEAST(100, GREATEST(1, COALESCE(s."loyaltyThreshold", 10))),
    'service',
    NULL,
    true,
    0
FROM "barber_shops" s
WHERE NOT EXISTS (
    SELECT 1 FROM "barber_loyalty_rewards" r WHERE r."barbershopId" = s."id"
)
ON CONFLICT ("id") DO NOTHING;

-- ── 4. Comprobación (debe salir una fila por barbería, como mínimo) ─────
-- SELECT s."name", r."name" AS bono, r."cost" AS estrellas
-- FROM "barber_shops" s JOIN "barber_loyalty_rewards" r ON r."barbershopId" = s."id"
-- ORDER BY s."name", r."sortOrder";
