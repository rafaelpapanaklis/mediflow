-- ═══════════════════════════════════════════════════════════════════
-- UNA ACTIVACIÓN DEL PLAN POR SESIÓN DE CHECKOUT DE STRIPE
-- (seguridad admin-auth, auditoría «cloudflare» nº13 · ws1-t4, 28-oct-2026)
--
-- Si Stripe reentrega el mismo checkout.session.completed o
-- checkout.session.async_payment_succeeded (entrega «al menos una vez», un
-- reintento tras un 500, un «Resend» desde su panel), el webhook sumaba OTRO
-- mes (u otro año) de plan por un solo pago. Con esta tabla, cada sesión se
-- RECLAMA una vez, en la misma transacción que actualiza la clínica
-- (src/lib/billing/activacion-unica.ts).
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--
-- ES REQUISITO DEL ARREGLO: pégalo ANTES del deploy o junto con él. Sin la
-- tabla NO hay ninguna protección: el código funciona como hoy y una
-- reentrega SÍ suma otro periodo (deja un aviso en los logs). No hay
-- respaldo: la v1 miraba la bitácora, pero el webhook no podía escribir esa
-- fila (audit_logs."userId" tiene FK a users; revisión ws1-t8, M1) y se quitó.
-- El código lo pregunta con to_regclass, así que la ausencia de la tabla no
-- genera errores; en cuanto exista, la usa (vuelve a preguntar cada 5 min).
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No toca ninguna tabla
-- existente y no borra nada. Sin modelo de Prisma (SQL crudo).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "stripe_activaciones_plataforma" (
  "sessionId"  text         NOT NULL,
  "clinicId"   text         NOT NULL,
  "evento"     text         NOT NULL,
  "createdAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_activaciones_plataforma_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX IF NOT EXISTS "stripe_activaciones_plataforma_clinicId_idx"
  ON "stripe_activaciones_plataforma" ("clinicId");

-- Defense-in-depth: RLS activada y SIN políticas = anon y authenticated no
-- leen ni escriben nada por la API de Supabase. El servidor usa la conexión
-- de Prisma (rol con BYPASSRLS), que no se ve afectada.
ALTER TABLE "stripe_activaciones_plataforma" ENABLE ROW LEVEL SECURITY;

-- Comprobación (solo lectura): debe salir una fila con rls = true.
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM "stripe_activaciones_plataforma") AS filas
  FROM pg_class c
 WHERE c.relname = 'stripe_activaciones_plataforma';
