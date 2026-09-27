-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t3 (fases 2 y 3) · ANTICIPO POR TRANSFERENCIA.
--
-- «Pedir anticipo» también por transferencia (texto + PDF con los datos
--  bancarios de la SEDE) y «Registrar anticipo recibido» (efectivo,
--  transferencia, terminal).
--
-- Amplía sql/anticipo-desde-panel.sql (fase 1, YA APLICADO). NO la vuelve a
-- crear ni la toca. `appointment_deposits.method` YA acepta 'transferencia' y
-- 'manual' desde esa migración (CHECK appointment_deposits_method_chk): fase 2
-- no necesita ni una columna nueva ahí. Solo hace falta UNA tabla nueva.
--
-- Contenido:
--   1 tabla nueva  · "clinic_bank_accounts" (una fila por Clinic = por sede)
--   1 llave foránea· clinicId → clinics
--   1 índice único · clinicId (una cuenta por sede)
--   RLS activada, SIN políticas (molde: platform_bank_accounts /
--   sql/spei-transferencia-directa.sql — anon/authenticated no ven nada;
--   DaleControl lee con Prisma + service role, que bypassa RLS)
--
-- NO toca ninguna tabla existente ni una fila que ya haya. Sin esta tabla el
-- código de fase 2 la trata como «sin datos bancarios» (P2021) y la pantalla
-- de Configuración → Anticipos no ofrece «Transferencia» — Mercado Pago y el
-- resto de la fase 1 siguen funcionando exactamente igual.
--
-- ORDEN: se puede aplicar antes o después de integrar la rama.
--
-- IDEMPOTENTE Y PLANO — SIN `DO $$` EN NINGÚN SITIO (regla de la casa: el SQL
-- Editor de Supabase no los digiere de fiar). Para la llave foránea —que no
-- tiene `IF NOT EXISTS` en Postgres— el patrón es siempre el mismo par de
-- líneas: "ALTER TABLE ... DROP CONSTRAINT IF EXISTS ..." seguido de
-- "ALTER TABLE ... ADD CONSTRAINT ...". Quitar y volver a poner una
-- restricción no toca ni una fila. Probado dos veces seguidas contra Postgres
-- (PGlite) sin errores ni duplicados. CERO DROP de tablas o columnas.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- Nota sobre los nombres: camelCase ENTRECOMILLADO, como los escribe Prisma.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. clinic_bank_accounts: banco, beneficiario, CLABE y referencia ────
-- Una fila por SEDE (cada sede es una Clinic aislada en dental): el id es el
-- propio clinicId, así que "una cuenta por sede" no necesita índice aparte —
-- lo garantiza la llave primaria.
CREATE TABLE IF NOT EXISTS "clinic_bank_accounts" (
  "clinicId"     text         NOT NULL,
  "banco"        text         NOT NULL,
  "beneficiario" text         NOT NULL,
  "clabe"        text         NOT NULL,
  -- Texto libre que la clínica escribe para guiar el concepto de la
  -- transferencia (p. ej. "Escribe el nombre del paciente"). Nullable: sin
  -- él, el texto y el PDF simplemente no muestran esa línea.
  "referencia"   text,
  "updatedBy"    text,
  "updatedAt"    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clinic_bank_accounts_pkey" PRIMARY KEY ("clinicId")
);


-- ── 2. Llave foránea ─────────────────────────────────────────────────────
-- Borrar la clínica se lleva su cuenta bancaria (no tiene sentido huérfana).
ALTER TABLE "clinic_bank_accounts" DROP CONSTRAINT IF EXISTS "clinic_bank_accounts_clinicId_fkey";
ALTER TABLE "clinic_bank_accounts"
  ADD CONSTRAINT "clinic_bank_accounts_clinicId_fkey"
  FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- ── 3. Defense-in-depth: RLS activada y SIN políticas ───────────────────
ALTER TABLE "clinic_bank_accounts" ENABLE ROW LEVEL SECURITY;


-- ── 4. Comprobación (solo lee) ───────────────────────────────────────────
-- Debe devolver la tabla.
SELECT table_name FROM information_schema.tables
 WHERE table_name = 'clinic_bank_accounts';
