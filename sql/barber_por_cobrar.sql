-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — notas «POR COBRAR» (ws6-t5, 15-nov-2026).
--
-- Una nota que se arma mientras el cliente está en la silla y se cobra
-- después. NO es un ticket: no tiene importes guardados, no entra al corte,
-- ni a ingresos, ni a comisiones, ni a estrellas. Guarda QUÉ se va a cobrar
-- (servicios y productos con cantidad, barbero, descuento, nota); los precios
-- se toman del catálogo al cobrar, por el mismo createSale de Caja.
--
-- Al cobrarla, en la MISMA transacción del ticket, pasa a CHARGED con el id
-- del ticket (una sola vez: el UPDATE exige status = 'OPEN'). Descartarla la
-- deja en DISCARDED. Nunca se borra.
--
-- El código funciona ANTES de pegar esto: sin la tabla, «Guardar sin cobrar»
-- no aparece y todo lo demás sigue igual.
--
-- Plano e idempotente: se puede pegar dos veces. Supabase → SQL Editor.
--
-- Para deshacerlo (no toca ningún ticket ni el corte):
--   DROP TABLE IF EXISTS "barber_sale_drafts";
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "barber_sale_drafts" (
    "id"              TEXT NOT NULL,
    "barbershopId"    TEXT NOT NULL,
    "clientId"        TEXT,
    "barberId"        TEXT,
    "payload"         JSONB NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'OPEN',
    "saleId"          TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "closedByUserId"  TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"        TIMESTAMP(3),
    CONSTRAINT "barber_sale_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "barber_sale_drafts_barbershopId_fkey"
        FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "barber_sale_drafts_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "barber_clients"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "barber_sale_drafts_status_chk" CHECK ("status" IN ('OPEN', 'CHARGED', 'DISCARDED')),
    -- Cobrada ⇔ tiene ticket.
    CONSTRAINT "barber_sale_drafts_charged_chk" CHECK (("status" = 'CHARGED') = ("saleId" IS NOT NULL)),
    CONSTRAINT "barber_sale_drafts_payload_chk" CHECK (jsonb_typeof("payload") = 'object')
);

CREATE INDEX IF NOT EXISTS "barber_sale_drafts_open_idx"
    ON "barber_sale_drafts" ("barbershopId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "barber_sale_drafts_client_idx"
    ON "barber_sale_drafts" ("clientId");
