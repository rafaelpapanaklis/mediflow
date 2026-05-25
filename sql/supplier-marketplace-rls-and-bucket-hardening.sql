-- ═══════════════════════════════════════════════════════════════════════
-- Supplier Marketplace — Hardening de seguridad (RLS + Storage)
-- PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- POR QUÉ
-- La migración 20260522120000_supplier_marketplace creó las 10 tablas
-- supplier_* y el bucket 'supplier-products', PERO (a diferencia de la
-- migración 20260430140000_marketplace_foundation y de
-- sql/rls-deny-all-policies.sql) NO habilitó Row Level Security ni creó
-- policies deny-all en esas tablas. Resultado:
--
--   [P0] Las 10 tablas supplier_* quedan accesibles vía la API REST de
--        Supabase con la anon/authenticated key (que sí se expone al browser
--        como NEXT_PUBLIC_SUPABASE_ANON_KEY). MediFlow accede a estas tablas
--        SIEMPRE vía Prisma + service role (que bypassa RLS por diseño), así
--        que habilitar RLS deny-all NO afecta a la app y cierra la exposición
--        de pedidos, carritos, mensajes de chat y emails de proveedores.
--
--   [P1] El bucket 'supplier-products' otorga INSERT/UPDATE/DELETE al rol
--        `authenticated` validando solo bucket_id (no la carpeta dueña). Es
--        decir, CUALQUIER usuario autenticado (cualquier clínica, cualquier
--        proveedor) podría escribir/borrar CUALQUIER objeto del bucket vía la
--        API de Storage. La app NUNCA usa esto: todas las subidas/borrados van
--        por el service role (getAdminSupabase() en
--        api/proveedores/products/[productId]/images y .../[productId]). Por
--        eso es seguro DROPear las policies de escritura `authenticated` y
--        dejar solo la lectura pública.
--
-- IDEMPOTENTE: re-ejecutable sin efectos colaterales (ENABLE RLS es no-op si
-- ya está; CREATE POLICY va con guard sobre pg_policies; DROP POLICY IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. RLS deny-all en las 10 tablas supplier_* ────────────────────────────
-- Mismo patrón que marketplace_foundation: ENABLE RLS + policy RESTRICTIVE que
-- niega todo a anon/authenticated. El service role (Prisma) las sigue usando.
DO $$
DECLARE
  t    text;
  tbls text[] := ARRAY[
    'suppliers',
    'supplier_users',
    'supplier_products',
    'supplier_product_images',
    'supplier_carts',
    'supplier_cart_items',
    'supplier_orders',
    'supplier_order_items',
    'supplier_chat_threads',
    'supplier_chat_messages'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = t
        AND policyname = t || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_deny_anon', t
      );
    END IF;
  END LOOP;
END $$;


-- ── 2. Storage: quitar la escritura abierta a `authenticated` ──────────────
-- Se conserva la lectura pública (supplier_products_public_read) porque las
-- imágenes de producto se muestran sin auth en el browse de la clínica.
-- Las 3 policies de escritura se eliminan: la app escribe con service role.
DROP POLICY IF EXISTS "supplier_products_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "supplier_products_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "supplier_products_auth_delete" ON storage.objects;


-- ── 3. Verificación (solo lectura — corre después de aplicar 1 y 2) ────────
-- 3.a) RLS habilitado en las 10 tablas → relrowsecurity debe ser true.
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relkind = 'r' AND relname LIKE 'supplier%'
-- ORDER BY relname;

-- 3.b) Policy deny-all presente en cada tabla supplier_*.
-- SELECT tablename, policyname, permissive, roles
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename LIKE 'supplier%'
-- ORDER BY tablename;

-- 3.c) En storage solo debe quedar la lectura pública del bucket.
-- SELECT policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'supplier_products%'
-- ORDER BY policyname;   -- esperado: solo supplier_products_public_read (SELECT)
-- ═══════════════════════════════════════════════════════════════════════
