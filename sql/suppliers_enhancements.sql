-- Proveedores B2B — fundación de mejoras (T1)
-- ADITIVO y seguro de re-ejecutar (IF NOT EXISTS).
-- Nombres de tabla/columna IDÉNTICOS a los que genera Prisma con el schema:
--   model Supplier @@map("suppliers"); SupplierReview @@map("supplier_reviews");
--   SupplierFavorite @@map("supplier_favorites"); Clinic @@map("clinics").

-- 1) Campos nuevos en suppliers ----------------------------------------------
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "whatsapp"       TEXT,
  ADD COLUMN IF NOT EXISTS "website"        TEXT,
  ADD COLUMN IF NOT EXISTS "mapsUrl"        TEXT,
  ADD COLUMN IF NOT EXISTS "minOrderAmount" INTEGER,
  ADD COLUMN IF NOT EXISTS "shippingNote"   TEXT,
  ADD COLUMN IF NOT EXISTS "rating"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ratingCount"    INTEGER          NOT NULL DEFAULT 0;

-- 2) Reseñas de proveedores --------------------------------------------------
CREATE TABLE IF NOT EXISTS "supplier_reviews" (
  "id"         TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "clinicId"   TEXT NOT NULL,
  "orderId"    TEXT,
  "rating"     INTEGER NOT NULL,
  "comment"    TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_reviews_supplierId_fkey" FOREIGN KEY ("supplierId")
    REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplier_reviews_clinicId_fkey" FOREIGN KEY ("clinicId")
    REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_reviews_orderId_key" ON "supplier_reviews"("orderId");
CREATE INDEX IF NOT EXISTS "supplier_reviews_supplierId_idx" ON "supplier_reviews"("supplierId");
CREATE INDEX IF NOT EXISTS "supplier_reviews_clinicId_idx"   ON "supplier_reviews"("clinicId");

-- 3) Favoritos de proveedores ------------------------------------------------
CREATE TABLE IF NOT EXISTS "supplier_favorites" (
  "id"         TEXT NOT NULL,
  "clinicId"   TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_favorites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_favorites_supplierId_fkey" FOREIGN KEY ("supplierId")
    REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplier_favorites_clinicId_fkey" FOREIGN KEY ("clinicId")
    REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_favorites_clinicId_supplierId_key" ON "supplier_favorites"("clinicId", "supplierId");
CREATE INDEX IF NOT EXISTS "supplier_favorites_clinicId_idx" ON "supplier_favorites"("clinicId");
