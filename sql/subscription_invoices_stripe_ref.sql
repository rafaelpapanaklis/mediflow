-- ═══════════════════════════════════════════════════════════════════════════
-- subscription_invoices.reference → índice ÚNICO
--
-- Por qué: el webhook de Stripe ahora registra cada factura pagada con
-- upsert { where: { reference: invoice.id } }. Prisma traduce ese upsert a un
-- INSERT ... ON CONFLICT, que NECESITA una restricción única real en la BD.
-- Sin este índice el upsert revienta en producción con:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- ⚠️ APLICAR EN SUPABASE **ANTES** DE QUE ENTRE EL DEPLOY DE VERCEL.
--
-- NOTA sobre "parcial vs completo": el índice va COMPLETO (sin
-- `WHERE reference IS NOT NULL`) a propósito. En Postgres los NULL nunca
-- chocan entre sí en un índice único, así que los cobros manuales sin
-- referencia (efectivo, depósito) siguen pudiendo ser muchos con reference
-- NULL — el índice completo es igual de permisivo. La diferencia es que un
-- índice PARCIAL no lo infiere `ON CONFLICT (reference)` (Postgres exigiría
-- repetir el predicado, cosa que Prisma no emite) y volvería a fallar. El
-- nombre es el que Prisma genera para `@unique`, para que no haya drift.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PASO 1 — ¿Hay references duplicadas? ──────────────────────────────────
-- Si esta consulta devuelve FILAS: PARA. El CREATE UNIQUE INDEX de abajo
-- fallaría. Hay que decidir a mano qué fila se queda con cada reference
-- (normalmente la más antigua) antes de continuar.
SELECT reference, COUNT(*) AS veces, MIN("createdAt") AS primera, MAX("createdAt") AS ultima
FROM subscription_invoices
WHERE reference IS NOT NULL
GROUP BY reference
HAVING COUNT(*) > 1
ORDER BY veces DESC;

-- ── PASO 2 — Crear el índice único (solo si el PASO 1 no devolvió filas) ──
CREATE UNIQUE INDEX IF NOT EXISTS subscription_invoices_reference_key
  ON subscription_invoices (reference);
