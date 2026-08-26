-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INMUEBLES — BOLSA INMOBILIARIA (MLS interna). O2-T4.
--
-- GENERADO desde prisma/schema.prisma (bloque "BOLSA INMOBILIARIA", al
-- final del archivo) y hecho idempotente: cada bloque comprueba existencia
-- antes de crear, así que correrlo varias veces no produce errores ni
-- duplicados.
--
-- Aplicar manualmente en Supabase (SQL editor), DESPUÉS de sql/realty.sql.
--
-- 🔴 NADA VIVE SOLO AQUÍ. Las tres tablas y el enum de este archivo están
-- también en prisma/schema.prisma, así que un `prisma db push` no se las
-- lleva por delante. En barber esa deuda existe y costó cara.
--
-- Nota sobre $$: un único delimitador `$realty$` y NUNCA bloques DO
-- anidados (el parser SQL de Supabase rompe con $$ anidado).
--
-- Nota sobre fechas: TIMESTAMP(3) SIN zona, igual que todo el vertical. Si
-- algún día hace falta un constraint de exclusión sobre rangos, tiene que
-- ser `tsrange` y JAMÁS `tstzrange`.
--
-- 🔴 SIN LLAVES FORÁNEAS, A PROPÓSITO — y es la misma decisión que en el
-- schema de Prisma, no una omisión. Una FK en Prisma obliga a declarar el
-- lado inverso dentro de RealtyAccount y de RealtyProperty, es decir a
-- editar modelos en medio de un archivo que se pelean siete terminales en
-- paralelo. Se eligió que los tres bloques fueran CONTIGUOS y estuvieran
-- al final, para que un conflicto de git se resuelva conservando los dos
-- lados. El precio, dicho en voz alta: no hay ON DELETE CASCADE. Borrar un
-- inmueble deja su fila de bolsa huérfana. NO es una fuga: cada lectura de
-- la bolsa vuelve a leer realty_properties y realty_accounts, y una fila
-- huérfana no produce resultados (falla CERRADA). La consulta 4.c de abajo
-- las lista para barrerlas a mano mientras T1 no cablee la limpieza.
--
-- Contenido: 1 enum · 3 tablas · 10 índices (3 únicos) · 0 llaves foráneas.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enum ────────────────────────────────────────────────────────────
DO $realty$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyMlsAgreementStatus') THEN
    CREATE TYPE "RealtyMlsAgreementStatus" AS ENUM (
      'PROPUESTO', 'ACEPTADO', 'RECHAZADO', 'CANCELADO', 'CERRADO'
    );
  END IF;
END
$realty$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- 2.a) El CONSENTIMIENTO. Sin fila aquí, o con active en false, el
--      inmueble no existe para ninguna otra cuenta.
CREATE TABLE IF NOT EXISTS "realty_mls_listings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sharedCommissionPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "acceptsCollaboration" BOOLEAN NOT NULL DEFAULT true,
    "requiresBuyerFromPartner" BOOLEAN NOT NULL DEFAULT false,
    "exposedFields" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_mls_listings_pkey" PRIMARY KEY ("id")
);

-- 2.b) El ACUERDO entre dos cuentas sobre un inmueble.
CREATE TABLE IF NOT EXISTS "realty_mls_agreements" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "listingAccountId" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "agreedPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" "RealtyMlsAgreementStatus" NOT NULL DEFAULT 'PROPUESTO',
    "message" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_mls_agreements_pkey" PRIMARY KEY ("id")
);

-- 2.c) El ESCAPARATE: un inmueble ajeno pintado en la web propia.
CREATE TABLE IF NOT EXISTS "realty_mls_adoptions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "showOnLanding" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_mls_adoptions_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────

-- Únicos. propertyId es único GLOBAL y no [accountId, propertyId]: el id de
-- un inmueble ya es único en toda la base. La pertenencia se comprueba
-- ANTES de escribir, contra realty_properties, nunca confiando en el
-- accountId que llegue del navegador.
CREATE UNIQUE INDEX IF NOT EXISTS "realty_mls_listings_propertyId_key"
  ON "realty_mls_listings"("propertyId");

-- Un solo acuerdo por par (inmueble, cuenta que coloca). Volver a proponer
-- tras un rechazo REUSA esta fila: así nadie llena la bandeja del vecino a
-- base de propuestas repetidas.
CREATE UNIQUE INDEX IF NOT EXISTS "realty_mls_agreements_listingId_partnerAccountId_key"
  ON "realty_mls_agreements"("listingId", "partnerAccountId");

CREATE UNIQUE INDEX IF NOT EXISTS "realty_mls_adoptions_accountId_listingId_key"
  ON "realty_mls_adoptions"("accountId", "listingId");

-- De búsqueda. La consulta de la bolsa es "todo lo activo MENOS lo mío",
-- así que este índice empieza por active y no por accountId — al revés que
-- el resto del vertical, donde todo empieza por el inquilino.
CREATE INDEX IF NOT EXISTS "realty_mls_listings_active_sharedAt_idx"
  ON "realty_mls_listings"("active", "sharedAt");
CREATE INDEX IF NOT EXISTS "realty_mls_listings_accountId_active_idx"
  ON "realty_mls_listings"("accountId", "active");

CREATE INDEX IF NOT EXISTS "realty_mls_agreements_listingAccountId_status_proposedAt_idx"
  ON "realty_mls_agreements"("listingAccountId", "status", "proposedAt");
CREATE INDEX IF NOT EXISTS "realty_mls_agreements_partnerAccountId_status_proposedAt_idx"
  ON "realty_mls_agreements"("partnerAccountId", "status", "proposedAt");
CREATE INDEX IF NOT EXISTS "realty_mls_agreements_propertyId_idx"
  ON "realty_mls_agreements"("propertyId");

CREATE INDEX IF NOT EXISTS "realty_mls_adoptions_accountId_showOnLanding_sortOrder_idx"
  ON "realty_mls_adoptions"("accountId", "showOnLanding", "sortOrder");
CREATE INDEX IF NOT EXISTS "realty_mls_adoptions_listingId_idx"
  ON "realty_mls_adoptions"("listingId");


-- ── 4. Comprobaciones (comentadas: correr a mano tras aplicar) ─────────

-- 4.a) Las tres tablas existen. Debe devolver 3 filas.
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'realty_mls%' ORDER BY 1;

-- 4.b) Toda tabla de negocio del vertical tiene accountId. Las tres de la
--      bolsa lo tienen, aunque en realty_mls_agreements se llame
--      listingAccountId/partnerAccountId (son DOS inquilinos por fila: es
--      la única tabla del producto que cruza cuentas a propósito).
-- SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position)
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name LIKE 'realty_mls%'
--   AND column_name IN ('accountId', 'listingAccountId', 'partnerAccountId')
-- GROUP BY table_name ORDER BY 1;

-- 4.c) HUÉRFANAS. Sin FK, borrar un inmueble o una cuenta deja filas
--      colgando. No son una fuga (toda lectura vuelve a leer el inmueble y
--      falla cerrada), pero conviene barrerlas. Debe devolver 0 filas:
-- SELECT 'listing' AS tabla, l.id FROM "realty_mls_listings" l
--   WHERE NOT EXISTS (SELECT 1 FROM "realty_properties" p WHERE p.id = l."propertyId")
--      OR NOT EXISTS (SELECT 1 FROM "realty_accounts" a WHERE a.id = l."accountId")
-- UNION ALL
-- SELECT 'agreement', g.id FROM "realty_mls_agreements" g
--   WHERE NOT EXISTS (SELECT 1 FROM "realty_mls_listings" l WHERE l.id = g."listingId")
--      OR NOT EXISTS (SELECT 1 FROM "realty_accounts" a WHERE a.id = g."partnerAccountId")
-- UNION ALL
-- SELECT 'adoption', d.id FROM "realty_mls_adoptions" d
--   WHERE NOT EXISTS (SELECT 1 FROM "realty_mls_listings" l WHERE l.id = d."listingId")
--      OR NOT EXISTS (SELECT 1 FROM "realty_accounts" a WHERE a.id = d."accountId");

-- 4.d) NADIE puede estar en la bolsa sin haberlo pedido. Toda fila activa
--      debe apuntar a un inmueble que su dueño tiene publicado o al menos
--      en cartera. Debe devolver 0 filas:
-- SELECT l.id, l."accountId", l."propertyId" FROM "realty_mls_listings" l
-- JOIN "realty_properties" p ON p.id = l."propertyId"
-- WHERE l.active = true AND p."accountId" <> l."accountId";

-- 4.e) Un acuerdo jamás puede tener al mismo inquilino de los dos lados.
--      Debe devolver 0 filas:
-- SELECT id FROM "realty_mls_agreements"
-- WHERE "listingAccountId" = "partnerAccountId";
