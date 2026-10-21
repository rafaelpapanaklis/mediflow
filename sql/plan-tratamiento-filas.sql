-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T12 · PLAN DE TRATAMIENTO NUEVO, LA BASE (P1).
--
-- Dos piezas aditivas, las dos nuevas (nada existente cambia de forma ni de datos):
--   1) "treatment_plan_items" — los procedimientos del plan como FILAS (hoy son
--      texto en "treatment_plans"."description"): procedimiento del tarifario,
--      nombre copiado, dientes, caras, fase, cantidad, precio exacto en
--      NUMERIC(12,2), estado (pendiente | en_curso | hecho | cancelado), quién y
--      cuándo lo hizo, en qué cita, el hallazgo del odontograma que lo originó,
--      en qué nota de cobro y en qué línea quedó, y su orden. Una fila NUNCA se
--      borra desde la app: se cancela ("estado" = 'cancelado').
--   2) "invoices"."treatmentPlanId" — liga la nota de cobro (factura) al plan del
--      que nace. Mismo patrón que "invoices"."orthodonticTreatmentPlanId"
--      (sql/ortodoncia-cobro.sql). Una factura sin plan la deja en NULL.
--
-- IDEMPOTENTE: todo con IF NOT EXISTS; correrlo dos veces no falla ni duplica.
-- ADITIVO: sin DROP, sin DELETE, sin UPDATE de datos.
-- NO usa Prisma Migrate ni toca prisma/schema.prisma: el código lee y escribe
-- estas tablas con SQL crudo y pregunta antes si existen (to_regclass /
-- information_schema, src/lib/treatments/items-db.ts). Mientras este archivo no
-- se pegue, el plan funciona exactamente como hoy (texto en "description").
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Filas del plan ───────────────────────────────────────────────────
-- Borrar un PLAN (botón de siempre) se lleva sus filas, igual que sus
-- sesiones (ON DELETE CASCADE). La nota de cobro NO se borra: su liga queda en
-- NULL (ver 2).
CREATE TABLE IF NOT EXISTS "treatment_plan_items" (
  "id"           TEXT PRIMARY KEY,
  "clinicId"     TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "planId"       TEXT NOT NULL REFERENCES "treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "procedureId"  TEXT REFERENCES "procedure_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "nombre"       TEXT NOT NULL,
  "dientes"      INTEGER[] NOT NULL DEFAULT '{}',
  "caras"        TEXT[] NOT NULL DEFAULT '{}',
  "fase"         TEXT,
  "faseNumero"   INTEGER,
  "cantidad"     INTEGER NOT NULL DEFAULT 1,
  "precio"       NUMERIC(12,2) NOT NULL DEFAULT 0,
  "estado"       TEXT NOT NULL DEFAULT 'pendiente',
  "hechoEn"      TIMESTAMP(3),
  "hechoPor"     TEXT,
  "citaId"       TEXT REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "motivo"       TEXT,
  "hallazgo"     JSONB,
  "invoiceId"    TEXT REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "invoiceLinea" INTEGER,
  "quoteItemId"  TEXT,
  "orden"        INTEGER NOT NULL DEFAULT 0,
  "canceladoEn"  TIMESTAMP(3),
  "canceladoPor" TEXT,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treatment_plan_items_estado_check"
    CHECK ("estado" IN ('pendiente', 'en_curso', 'hecho', 'cancelado')),
  CONSTRAINT "treatment_plan_items_cantidad_check" CHECK ("cantidad" >= 1),
  CONSTRAINT "treatment_plan_items_precio_check" CHECK ("precio" >= 0)
);

CREATE INDEX IF NOT EXISTS "treatment_plan_items_clinicId_planId_orden_idx"
  ON "treatment_plan_items" ("clinicId", "planId", "orden");
CREATE INDEX IF NOT EXISTS "treatment_plan_items_invoiceId_idx"
  ON "treatment_plan_items" ("invoiceId");
CREATE INDEX IF NOT EXISTS "treatment_plan_items_quoteItemId_idx"
  ON "treatment_plan_items" ("quoteItemId") WHERE "quoteItemId" IS NOT NULL;


-- ── 2. Nota de cobro del plan ────────────────────────────────────────────
-- Con IF NOT EXISTS la columna y su llave foránea nacen juntas la primera vez;
-- la segunda vez Postgres salta la línea entera (sin DROP CONSTRAINT).
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "treatmentPlanId" TEXT
  REFERENCES "treatment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "invoices_treatmentPlanId_idx"
  ON "invoices" ("treatmentPlanId");


-- ── 3. Defense-in-depth: RLS deny-all (patrón sql/doctor-horarios.sql §4) ──
-- DaleControl entra solo por Prisma + service role (se salta RLS). Esto cierra
-- PostgREST si se filtra la llave anon.
DO $tpi$
BEGIN
  EXECUTE 'ALTER TABLE "treatment_plan_items" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plan_items' AND policyname = 'treatment_plan_items_deny_anon'
  ) THEN
    EXECUTE 'CREATE POLICY "treatment_plan_items_deny_anon" ON "treatment_plan_items" AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'treatment_plan_items no existe — RLS saltada';
END
$tpi$;


-- ── 4. Comprobación (solo lee) ───────────────────────────────────────────
-- Debe salir: 26 filas de "treatment_plan_items" y 1 de "invoices"."treatmentPlanId".
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE (table_name = 'treatment_plan_items')
   OR (table_name = 'invoices' AND column_name = 'treatmentPlanId')
ORDER BY table_name, ordinal_position;
