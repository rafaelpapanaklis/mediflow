-- ═══════════════════════════════════════════════════════════════════════
-- Importar mi clínica: ID EXTERNOS — ws1-t6 (26-sep-2026)
-- ⚠️ PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
--
-- QUÉ
-- Crea import_external_ids: recuerda de qué sistema (Dentalink…) y con qué ID
-- llegó cada paciente y cada saldo importado. Con eso:
--   · un reintento de la importación no duplica pacientes (aunque no tengan
--     teléfono ni correo) ni saldos;
--   · las citas, saldos y notas se emparejan con su paciente por el ID del
--     sistema de origen, sin adivinar por nombre.
--
-- ORDEN: este SQL puede ir ANTES o DESPUÉS del deploy. El código lo tolera
-- ausente (importa igual, solo que sin el ID externo y con la deduplicación de
-- siempre). Lo recomendado: SQL primero, después el deploy.
--
-- SEGURIDAD: la tabla NO está en schema.prisma (el código la usa por SQL
-- directo). El aislamiento por clínica es del código (WHERE "clinicId"); la RLS
-- sin políticas niega todo a anon/authenticated y el service role (Prisma) la
-- sigue usando. Borra en cascada con su clínica.
--
-- IDEMPOTENTE: CREATE ... IF NOT EXISTS y ALTER ... ENABLE RLS son re-ejecutables.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "import_external_ids" (
    "id" TEXT PRIMARY KEY,
    "clinicId" TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_external_ids_uq"
    ON "import_external_ids"("clinicId", "source", "entity", "externalId");

CREATE INDEX IF NOT EXISTS "import_external_ids_local_idx"
    ON "import_external_ids"("clinicId", "entity", "localId");

ALTER TABLE "import_external_ids" ENABLE ROW LEVEL SECURITY;
