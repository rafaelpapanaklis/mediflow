-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t2 · INTERRUPTOR DEL PAGO EN LÍNEA DEL PORTAL.
--
-- «Que se pueda apagar con interruptor, pero por default que se encienda una
--  vez se conecte la cuenta de Mercado Pago.»
--
-- Contenido: UNA columna nueva en "clinic_mercadopago":
--   "portalPaymentsEnabled" BOOLEAN NOT NULL DEFAULT true
--
-- Las clínicas que YA tienen la cuenta conectada quedan ENCENDIDAS: Postgres
-- llena la columna nueva con su DEFAULT en todas las filas que ya existen. No
-- hay backfill a mano ni UPDATE: nadie pierde el cobro en línea.
--
-- 🔴 ORDEN: pégalo ANTES de desplegar el código de la rama. El código nuevo lee
-- esta columna (y la escribe al conectar la cuenta); el código de hoy no la
-- conoce y sigue funcionando igual con ella puesta.
--
-- Requiere sql/anticipo-whatsapp.sql (la tabla "clinic_mercadopago"). Si esa
-- tabla no existe, esto no hace nada.
--
-- IDEMPOTENTE: correrlo varias veces no da errores ni cambia nada. CERO DROP,
-- CERO UPDATE.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('public.clinic_mercadopago') IS NOT NULL THEN
    ALTER TABLE public.clinic_mercadopago
      ADD COLUMN IF NOT EXISTS "portalPaymentsEnabled" BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Comprobación (solo lee). Debe salir: la columna existe, con DEFAULT true, y
-- las clínicas conectadas aparecen todas en «encendidas».
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'clinic_mercadopago' AND column_name = 'portalPaymentsEnabled';

SELECT
  count(*) FILTER (WHERE "accessToken" IS NOT NULL AND "mpUserId" IS NOT NULL)                              AS conectadas,
  count(*) FILTER (WHERE "accessToken" IS NOT NULL AND "mpUserId" IS NOT NULL AND "portalPaymentsEnabled")  AS encendidas
FROM public.clinic_mercadopago;
