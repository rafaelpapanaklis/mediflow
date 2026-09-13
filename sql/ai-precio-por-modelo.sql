-- ════════════════════════════════════════════════════════════════════════════
-- ai-precio-por-modelo.sql — OPCIONAL. No cambia el esquema. Rama fix/ai-precio-por-modelo.
--
-- Desde esta rama, cada llamada de IA se cobra al precio de SU modelo (tabla en
-- src/lib/ai-billing/pricing-core.ts). Los cuatro precios GLOBALES de la fila
-- id='default' de ai_pricing_configs (inputUsdPerMtok, outputUsdPerMtok,
-- cacheWriteUsdPerMtok, cacheReadUsdPerMtok) DEJAN DE USARSE para cobrar.
-- El tipo de cambio (usdToMxnRate) y el fee (feePct) de esa fila siguen mandando.
--
-- Esos cuatro precios globales siempre fueron la tarifa de Sonnet 4.6 (3 / 15 /
-- 3.75 / 0.30), que es el modelo del bot de WhatsApp. Si alguien los editó a
-- mano en /admin/ai-billing, tras el deploy el bot volvería a la lista de
-- Anthropic sin avisar. Este script lo evita:
--
--   PASO 1 · Mira qué hay. Si sale 3 | 15 | 3.75 | 0.3, NO hace falta el paso 2.
--   PASO 2 · Si sale otra cosa, copia esos precios a una fila del modelo
--            'model:claude-sonnet-4-6', para que el bot siga cobrando igual que hoy.
--
-- Idempotente: el paso 2 no hace nada si los precios son los de lista, si alguno
-- es cero, o si la fila del modelo ya existe. No borra ni modifica filas.
-- https://supabase.com/dashboard/project/_/sql/new
-- ════════════════════════════════════════════════════════════════════════════

-- PASO 1 — solo lectura
SELECT "id", "inputUsdPerMtok", "outputUsdPerMtok", "cacheWriteUsdPerMtok",
       "cacheReadUsdPerMtok", "usdToMxnRate", "feePct", "updatedAt"
FROM "ai_pricing_configs"
ORDER BY "id";

-- PASO 2 — solo si el paso 1 mostró precios distintos de 3 / 15 / 3.75 / 0.3
INSERT INTO "ai_pricing_configs"
  ("id", "inputUsdPerMtok", "outputUsdPerMtok", "cacheWriteUsdPerMtok", "cacheReadUsdPerMtok", "updatedAt")
SELECT 'model:claude-sonnet-4-6', "inputUsdPerMtok", "outputUsdPerMtok", "cacheWriteUsdPerMtok",
       "cacheReadUsdPerMtok", CURRENT_TIMESTAMP
FROM "ai_pricing_configs"
WHERE "id" = 'default'
  AND ("inputUsdPerMtok", "outputUsdPerMtok", "cacheWriteUsdPerMtok", "cacheReadUsdPerMtok")
      IS DISTINCT FROM (3::double precision, 15::double precision, 3.75::double precision, 0.3::double precision)
  AND "inputUsdPerMtok" > 0 AND "outputUsdPerMtok" > 0
  AND "cacheWriteUsdPerMtok" > 0 AND "cacheReadUsdPerMtok" > 0
ON CONFLICT ("id") DO NOTHING;
