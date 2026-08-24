-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — módulo de CLIENTES (T4).
--
-- PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
-- Depende de sql/barber.sql y sql/barber_complemento.sql (ya aplicados).
--
-- QUÉ HACE, Y POR QUÉ NO TOCA prisma/schema.prisma
-- El contrato del vertical prohíbe cambiar el schema Prisma (lo comparten
-- 9 terminales en paralelo). Pero la fidelidad y la lista de inactivos son
-- CONFIGURABLES POR BARBERÍA y no había dónde guardar esos 4 números. Se
-- añaden como columnas sueltas de `barber_shops`, y la capa de clientes las
-- lee/escribe con SQL parametrizado ($queryRaw), NO con el cliente Prisma.
--
-- SI ESTE ARCHIVO NO SE APLICA, EL MÓDULO SIGUE FUNCIONANDO: la lectura de
-- config atrapa el error 42703 (columna inexistente) y cae a los valores por
-- defecto (10 cortes / 60 días). Lo único que no se puede es cambiarlos desde
-- el panel. Ver BARBER_CLIENTS_CONFIG_DEFAULTS en src/lib/barber/clients.ts.
--
-- IDEMPOTENTE: re-ejecutable sin efectos colaterales (ADD COLUMN IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING).
--
-- Nota sobre $$: un único delimitador `$barberc$`, nunca anidado (el parser
-- SQL de Supabase rompe con $$ dentro de $$) — mismo criterio que
-- sql/barber_complemento.sql.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Config de fidelidad e inactividad, por barbería ─────────────────
-- loyaltyThreshold  = cada cuántas visitas se gana el premio (1..100).
-- loyaltyReward     = etiqueta del premio ("Corte gratis" si viene NULL).
-- inactiveDays      = días sin visita para considerar inactivo (7..730).
-- Los rangos los valida el servidor (src/lib/barber/clients.ts); aquí solo
-- se ponen los CHECK para que ni un UPDATE manual meta un 0 o un negativo.
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyEnabled"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyThreshold" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "loyaltyReward"    TEXT;
ALTER TABLE "barber_shops" ADD COLUMN IF NOT EXISTS "inactiveDays"     INTEGER NOT NULL DEFAULT 60;

DO $barberc$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_loyaltyThreshold_range') THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_loyaltyThreshold_range"
      CHECK ("loyaltyThreshold" >= 1 AND "loyaltyThreshold" <= 100);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_inactiveDays_range') THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_inactiveDays_range"
      CHECK ("inactiveDays" >= 7 AND "inactiveDays" <= 730);
  END IF;
END
$barberc$;


-- ── 2. Índices de las dos listas que más se consultan ──────────────────
-- Inactivos: WHERE "barbershopId" = $1 AND ("lastVisitAt" < $2 OR NULL).
CREATE INDEX IF NOT EXISTS "barber_clients_shop_lastVisit_idx"
  ON "barber_clients" ("barbershopId", "lastVisitAt");

-- Búsqueda por teléfono (la llave real del mostrador). El @@unique de
-- (barbershopId, phone) ya crea un índice compuesto que sirve para el
-- prefijo exacto; éste es para el `contains` (sufijo) que usa la búsqueda.
CREATE INDEX IF NOT EXISTS "barber_clients_shop_phone_idx"
  ON "barber_clients" ("barbershopId", "phone");

-- Cumpleaños del mes: EXTRACT(MONTH ...) es IMMUTABLE sobre timestamp, así
-- que se puede indexar. Sin esto la vista escanea la tabla de la barbería.
CREATE INDEX IF NOT EXISTS "barber_clients_shop_birthday_month_idx"
  ON "barber_clients" ("barbershopId", (EXTRACT(MONTH FROM "birthday")))
  WHERE "birthday" IS NOT NULL;

-- Fotos del historial: la ficha pide "las últimas N de este cliente".
-- barber_complemento.sql ya crea (barbershopId, clientId, createdAt).


-- ── 3. Storage: bucket PRIVADO `barber-files` ──────────────────────────
-- Constante del contrato: BARBER_FILES_BUCKET en src/lib/barber/types.ts.
-- PRIVADO a propósito: las fotos de corte de una barbería NO pueden ser
-- accesibles por otra ni por un tercero con la URL. El panel las entrega
-- SIEMPRE como signed URL de 5 min generada en el servidor después de
-- comprobar el barbershopId de la sesión.
--
-- file_size_limit 5 MB: el navegador ya comprime a WebP ≤1600px (≈200-400 KB
-- por foto), así que 5 MB es techo de seguridad, no de operación.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'barber-files',
  'barber-files',
  false,
  5242880,
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 5242880,
      allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png'];

-- SIN policies para anon/authenticated: storage.objects tiene RLS activo por
-- defecto en Supabase, así que "sin policy" = nadie entra con la anon key
-- (que SÍ se expone al navegador como NEXT_PUBLIC_SUPABASE_ANON_KEY). La app
-- sube, firma y borra con el service role, que bypassa RLS por diseño —
-- mismo criterio que sql/supplier-marketplace-rls-and-bucket-hardening.sql.
-- Se limpian por si una ejecución anterior las hubiera dejado abiertas.
DROP POLICY IF EXISTS "barber_files_auth_select" ON storage.objects;
DROP POLICY IF EXISTS "barber_files_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "barber_files_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "barber_files_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "barber_files_public_read"  ON storage.objects;


-- ── 4. Verificación (solo lectura — correr DESPUÉS de aplicar 1-3) ─────
-- 4.a) Las 4 columnas de config existen y traen su default.
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'barber_shops'
--   AND column_name IN ('loyaltyEnabled','loyaltyThreshold','loyaltyReward','inactiveDays')
-- ORDER BY column_name;

-- 4.b) El bucket es PRIVADO (public debe ser false).
-- SELECT id, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets WHERE id = 'barber-files';

-- 4.c) NO debe quedar ninguna policy de barber-files en storage.objects.
-- SELECT policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'barber_files%';   -- esperado: 0 filas

-- 4.d) Los índices nuevos.
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'barber_clients' AND indexname LIKE 'barber_clients_shop%'
-- ORDER BY indexname;
-- ═══════════════════════════════════════════════════════════════════════
