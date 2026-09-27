-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t3 (fase 1) · ANTICIPO PEDIDO DESDE EL PANEL.
--
-- «Pedir un anticipo desde la cita o la factura, con Mercado Pago, por un
--  importe PARCIAL, que se aplica a ESA factura al pagarse.»
--
-- Amplía las tablas de sql/anticipo-whatsapp.sql (el anticipo por WhatsApp,
-- ws1-t5). NO las vuelve a crear. El anticipo del bot sigue exactamente
-- igual: las columnas nuevas nacen con el default que reproduce su
-- comportamiento de hoy (origin='bot', method='mercadopago', invoiceId NULL).
--
-- Contenido:
--   5 columnas nuevas · "appointment_deposits": origin, method, invoiceId,
--                        createdById, paymentId
--   4 columnas nuevas · "clinic_mercadopago": panelDepositMode,
--                        panelDepositAmount, panelDepositPercent,
--                        panelDepositExpiryHours (config PROPIA del panel,
--                        separada de depositMode/depositAmount/depositPercent/
--                        holdMinutes del bot — esos NO se tocan)
--   3 índices          · invoiceId, y el único parcial "un PENDING por factura"
--   3 llaves foráneas  · invoiceId → invoices, createdById → users,
--                        paymentId → payments
--   3 CHECK            · origin, method, panelDepositMode + panelDepositExpiryHours
--
-- NO toca ni una fila que ya exista, ni las columnas del bot. Las filas de
-- hoy quedan con origin='bot', method='mercadopago', invoiceId=NULL: EXACTAMENTE
-- lo que ya significaban antes de esta migración.
--
-- ORDEN: se puede aplicar antes o después de integrar la rama. Sin estas
-- columnas, el código de la fase 1 (panel) las detecta (P2022) y NO ofrece
-- «Pedir anticipo»; el anticipo del bot y el link de factura siguen
-- funcionando exactamente igual que hoy.
--
-- Requiere sql/anticipo-whatsapp.sql ya aplicado (las tablas base).
--
-- IDEMPOTENTE Y PLANO — SIN `DO $$` EN NINGÚN SITIO (el SQL Editor de
-- Supabase no lo digiere de fiar; ya dio "relation does not exist" con
-- bloques DO en otro script). Para las columnas y los índices, los propios
-- `IF NOT EXISTS` bastan. Para las llaves foráneas y los CHECK —que no
-- tienen `IF NOT EXISTS` en Postgres— el patrón es SIEMPRE el mismo par de
-- líneas: "ALTER TABLE ... DROP CONSTRAINT IF EXISTS ..." seguido de
-- "ALTER TABLE ... ADD CONSTRAINT ...". Quitar y volver a poner una
-- restricción no toca ni una fila; solo falla si algún dato YA violara la
-- restricción, que es justo lo que se quiere detectar. Probado dos veces
-- seguidas contra Postgres (PGlite) sin errores ni duplicados. CERO DROP
-- de tablas o columnas.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
--
-- Nota sobre los nombres: camelCase ENTRECOMILLADO, como los escribe Prisma.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. appointment_deposits: de dónde salió y a qué factura se aplica ──
ALTER TABLE "appointment_deposits" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'bot';
ALTER TABLE "appointment_deposits" ADD COLUMN IF NOT EXISTS "method" TEXT NOT NULL DEFAULT 'mercadopago';
ALTER TABLE "appointment_deposits" ADD COLUMN IF NOT EXISTS "invoiceId" TEXT;
ALTER TABLE "appointment_deposits" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "appointment_deposits" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;


-- ── 2. clinic_mercadopago: sugerido y plazo PROPIOS del panel ──────────
-- "fixed"|"percent" únicamente (nunca "total": aquí el % siempre es sobre el
-- TOTAL de la factura, nunca sobre un precio de catálogo como en el bot).
ALTER TABLE "clinic_mercadopago" ADD COLUMN IF NOT EXISTS "panelDepositMode" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "clinic_mercadopago" ADD COLUMN IF NOT EXISTS "panelDepositAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "clinic_mercadopago" ADD COLUMN IF NOT EXISTS "panelDepositPercent" INTEGER NOT NULL DEFAULT 0;
-- Plazo en HORAS (1–48), no minutos: es un anticipo pedido por recepción con
-- el paciente enfrente o por teléfono, no un límite pensado para el aviso de
-- WhatsApp del bot (esa es la razón del tope de 240 MINUTOS de holdMinutes).
ALTER TABLE "clinic_mercadopago" ADD COLUMN IF NOT EXISTS "panelDepositExpiryHours" INTEGER NOT NULL DEFAULT 24;


-- ── 3. Índices ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "appointment_deposits_invoiceId_idx"
  ON "appointment_deposits" ("invoiceId");

-- Único ÚNICO por Payment: sella que un Payment no puede saldar dos
-- anticipos (y por tanto no puede contarse dos veces).
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_deposits_paymentId_key"
  ON "appointment_deposits" ("paymentId");

-- Un anticipo PENDING por factura a la vez: pedirlo de nuevo con uno ya
-- pendiente reutiliza el mismo (lo resuelve el servicio), nunca crea un
-- segundo link que confirmaría el mismo monto dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_deposits_un_pendiente_por_factura"
  ON "appointment_deposits" ("invoiceId")
  WHERE "status" = 'PENDING' AND "invoiceId" IS NOT NULL;


-- ── 4. Llaves foráneas ─────────────────────────────────────────────────
-- SET NULL en las tres: borrar la factura, al usuario que lo pidió o el
-- Payment que lo saldó no debe borrar el rastro del anticipo. Patrón plano:
-- quitar (si existe) y volver a poner — no toca datos, solo la restricción.
ALTER TABLE "appointment_deposits" DROP CONSTRAINT IF EXISTS "appointment_deposits_invoiceId_fkey";
ALTER TABLE "appointment_deposits"
  ADD CONSTRAINT "appointment_deposits_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointment_deposits" DROP CONSTRAINT IF EXISTS "appointment_deposits_createdById_fkey";
ALTER TABLE "appointment_deposits"
  ADD CONSTRAINT "appointment_deposits_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointment_deposits" DROP CONSTRAINT IF EXISTS "appointment_deposits_paymentId_fkey";
ALTER TABLE "appointment_deposits"
  ADD CONSTRAINT "appointment_deposits_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- ── 5. CHECK: lo que la base NO deja escribir ──────────────────────────
-- Mismo patrón plano: quitar (si existe) y volver a poner.
ALTER TABLE "appointment_deposits" DROP CONSTRAINT IF EXISTS "appointment_deposits_origin_chk";
ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_origin_chk"
  CHECK ("origin" IN ('bot', 'panel'));

ALTER TABLE "appointment_deposits" DROP CONSTRAINT IF EXISTS "appointment_deposits_method_chk";
ALTER TABLE "appointment_deposits" ADD CONSTRAINT "appointment_deposits_method_chk"
  CHECK ("method" IN ('mercadopago', 'transferencia', 'manual'));

ALTER TABLE "clinic_mercadopago" DROP CONSTRAINT IF EXISTS "clinic_mercadopago_panelDepositMode_chk";
ALTER TABLE "clinic_mercadopago" ADD CONSTRAINT "clinic_mercadopago_panelDepositMode_chk"
  CHECK ("panelDepositMode" IN ('fixed', 'percent'));

ALTER TABLE "clinic_mercadopago" DROP CONSTRAINT IF EXISTS "clinic_mercadopago_panelDepositExpiryHours_chk";
ALTER TABLE "clinic_mercadopago" ADD CONSTRAINT "clinic_mercadopago_panelDepositExpiryHours_chk"
  CHECK ("panelDepositExpiryHours" BETWEEN 1 AND 48);


-- ── 6. Comprobación (solo lee) ──────────────────────────────────────────
-- Debe devolver 5 filas (una por columna nueva de appointment_deposits).
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'appointment_deposits'
  AND column_name IN ('origin', 'method', 'invoiceId', 'createdById', 'paymentId')
ORDER BY column_name;
