-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — ola de MEMBRESÍAS, ANTICIPOS y PAGOS DEL CLIENTE.
--
-- Aplicar manualmente en Supabase (SQL editor). Re-ejecutable: todo el
-- archivo es idempotente (IF NOT EXISTS), correrlo varias veces no rompe
-- ni duplica nada.
--
-- ── QUÉ CREA Y POR QUÉ ────────────────────────────────────────────────
-- Las tablas de la ola (barber_memberships y barber_client_memberships) ya
-- existen desde sql/barber.sql, y los anticipos viven en las columnas
-- depositAmount / depositStatus de barber_appointments. Lo ÚNICO que
-- faltaba era dónde guardar la CONFIGURACIÓN de anticipos de cada barbería
-- (monto o porcentaje, a quién se le pide, ventana de reembolso, si se
-- cobra en línea): el schema del vertical no tiene ninguna tabla ni
-- columna de ajustes por barbería.
--
-- Por eso esta ola agrega UNA tabla propia, `barber_payment_settings`, que
-- a propósito NO está en prisma/schema.prisma:
--   · Meter una columna nueva en un modelo Prisma existente rompería TODAS
--     las lecturas de esa tabla hasta que este SQL se aplique (findMany sin
--     select revienta si la columna no está en la BD todavía).
--   · Una tabla nueva en el schema chocaría con las otras terminales que
--     están editando prisma/schema.prisma en paralelo.
-- Se lee y escribe con SQL crudo desde src/lib/barber/payments.ts y, si
-- este archivo aún no se aplicó, TODO cae a los valores por defecto en vez
-- de tronar (mismo criterio que plans.ts con barber_plan_configs).
--
-- ⚠️ OJO CON `prisma db push` / `prisma migrate`: como la tabla NO está en
-- prisma/schema.prisma a propósito, esos comandos la BORRAN por considerarla
-- sobrante. En producción no aplica (el SQL del vertical se corre a mano en
-- Supabase), pero en cualquier base de desarrollo hay que volver a correr
-- ESTE archivo después de un db push. Si falta, nada truena: la política de
-- anticipos cae a sus valores por defecto y el panel avisa que falta el SQL.
--
-- Para deshacerlo: DROP TABLE IF EXISTS "barber_payment_settings";
--   (no se pierde ninguna membresía ni ningún anticipo: solo la política).
-- ═══════════════════════════════════════════════════════════════════════


-- ── Configuración de pagos/anticipos por barbería ─────────────────────
-- settings (jsonb) tiene la forma { "deposit": { ...BarberDepositPolicy } }.
-- El contenido lo valida y normaliza normalizeDepositPolicy() en
-- src/lib/barber/payments-core.ts — la BD solo guarda el blob.
CREATE TABLE IF NOT EXISTS "barber_payment_settings" (
    "barbershopId" TEXT NOT NULL,
    "settings"     JSONB NOT NULL DEFAULT '{}'::jsonb,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "barber_payment_settings_pkey" PRIMARY KEY ("barbershopId")
);

-- Borrar la barbería se lleva su configuración (igual que el resto del
-- vertical: todo cuelga de barber_shops con ON DELETE CASCADE).
DO $barbermem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_payment_settings_barbershopId_fkey'
  ) THEN
    ALTER TABLE "barber_payment_settings"
      ADD CONSTRAINT "barber_payment_settings_barbershopId_fkey"
      FOREIGN KEY ("barbershopId") REFERENCES "barber_shops"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$barbermem$;


-- ── Índice de apoyo para "por vencer" y "vencidas" ────────────────────
-- La lista con la que el dueño sale a cobrar ordena por endAt dentro de la
-- barbería. El índice existente es (barbershopId, status); este agrega la
-- fecha. Es solo rendimiento: Prisma ignora los índices que no conoce.
CREATE INDEX IF NOT EXISTS "barber_client_memberships_shop_end_idx"
  ON "barber_client_memberships" ("barbershopId", "endAt");


-- ── Verificación rápida (opcional) ────────────────────────────────────
-- SELECT "barbershopId", "settings" -> 'deposit' ->> 'audience' AS audiencia,
--        "settings" -> 'deposit' ->> 'enabled'  AS activo
-- FROM "barber_payment_settings";
