-- ═══════════════════════════════════════════════════════════════════════
-- Marketplace · Precio real de venta del módulo de Ortodoncia (ws1-t2)
--
-- DECISIÓN DE RAFAEL (28-sep-2026): "ortodoncia cuesta $129 pesos al mes o
-- anual con 15% de descuento" → anual = 129 × 12 × 0.85 = $1,315.80,
-- REDONDEADO a $1,316 (el sistema factura en pesos enteros — "modules",
-- "clinic_modules" y "orders" son columnas INTEGER en todo el marketplace,
-- igual que `plan_configs`/`plans.ts` para los planes de la plataforma; no
-- hay ningún lado en Stripe ni en el panel donde perder 20 centavos importe).
-- Reemplaza el precio $329/mes que traía el seed desde el Sprint 1
-- (prisma/seed.ts, nunca corregido tras la decisión de precio de hoy).
--
-- "price_mxn_annual" es columna NUEVA y ADITIVA, a propósito FUERA de
-- prisma/schema.prisma (igual que "invoice_payment_terms" y
-- "orthodontic_payment_promises"): el modelo Prisma "Module" no declara
-- este campo, así que Prisma jamás la pide en su SELECT — un
-- "prisma.module.findMany()" sin este SQL pegado sigue funcionando exacto
-- igual que hoy (cero P2022). Se lee con SQL crudo + sonda
-- "information_schema", mismo patrón que el resto de columnas nuevas de
-- esta ola. NULL en cualquier otro módulo = "todavía sin precio anual
-- propio configurado" (no se le inventa un descuento a nadie más).
--
-- IDEMPOTENTE (ADD COLUMN IF NOT EXISTS + UPDATE puro). ADITIVO: no borra
-- ni renombra nada. PLANO: sin bloques DO $$.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE "modules"
  ADD COLUMN IF NOT EXISTS "price_mxn_annual" INTEGER;

UPDATE "modules"
SET    "price_mxn_monthly" = 129,
       "price_mxn_annual"  = 1316
WHERE  "key" = 'orthodontics';

-- ── Comprobación (solo lee) — debe devolver 1 fila: 129 | 1316 ──────────
SELECT "key", "price_mxn_monthly", "price_mxn_annual", "is_active"
FROM   "modules"
WHERE  "key" = 'orthodontics';
