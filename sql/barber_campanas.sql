-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl BARBER — CAMPAÑAS de retención.
--
-- PENDIENTE — REQUIERE RAFAEL: aplicar a mano en el SQL Editor de Supabase.
-- Depende de sql/barber.sql y sql/barber_clientes.sql.
--
-- QUÉ HACE, Y POR QUÉ NO TOCA prisma/schema.prisma
-- El contrato del vertical prohíbe cambiar el schema Prisma. Las campañas
-- necesitan guardar DOS cosas por barbería: los textos de promoción que
-- escribe el dueño y cuántos días de descanso deja entre campañas. Se
-- añaden como columnas sueltas de `barber_shops` y la capa de campañas las
-- lee/escribe con SQL parametrizado ($queryRaw), NO con el cliente Prisma.
-- Mismo patrón que sql/barber_clientes.sql.
--
-- SI ESTE ARCHIVO NO SE APLICA, LA PANTALLA SIGUE FUNCIONANDO: la lectura
-- atrapa el error 42703 (columna inexistente) y cae a los textos por
-- defecto y a 21 días de descanso. Lo único que no se puede es GUARDAR
-- plantillas propias — la pantalla lo avisa con un banner. Ver
-- CAMPAIGN_DEFAULT_PROMOS en src/lib/barber/campaigns.ts.
--
-- LO QUE NO ESTÁ AQUÍ, A PROPÓSITO:
-- · Las BAJAS ("ya no me escriban") NO necesitan este archivo: viven en la
--   llave reservada `__optout` de `barber_clients.preferences`, que ya es
--   una columna Json existente. Una baja tiene que funcionar el día uno,
--   sin esperar a que nadie corra un SQL.
-- · La BITÁCORA anti-repetidos vive igual en `__campaigns` de esa misma
--   columna, por la misma razón.
-- · El RECIBO de lo enviado son las filas reales de `barber_messages`.
--
-- IDEMPOTENTE: re-ejecutable sin efectos colaterales (ADD COLUMN IF NOT
-- EXISTS). Delimitador único `$barbercmp$`, nunca anidado.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Config de campañas, por barbería ────────────────────────────────
-- campaignCooldownDays = días mínimos entre CUALQUIER par de campañas al
--                        mismo teléfono (3..180). Es el freno anti-spam.
-- campaignTemplates    = { "<audiencia>": "<texto de la promoción>" }.
--                        Solo la promoción: el cuerpo aprobado por Meta ya
--                        saluda al cliente y nombra la barbería.
-- Los rangos los valida el servidor (src/lib/barber/campaigns.ts); el CHECK
-- está para que ni un UPDATE manual meta un 0 o un negativo.
ALTER TABLE "barber_shops"
  ADD COLUMN IF NOT EXISTS "campaignCooldownDays" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "barber_shops"
  ADD COLUMN IF NOT EXISTS "campaignTemplates" JSONB;

DO $barbercmp$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barber_shops_campaign_cooldown_check'
  ) THEN
    ALTER TABLE "barber_shops"
      ADD CONSTRAINT "barber_shops_campaign_cooldown_check"
      CHECK ("campaignCooldownDays" >= 3 AND "campaignCooldownDays" <= 180);
  END IF;
END
$barbercmp$;


-- ── 2. Índice para el recibo de campañas ───────────────────────────────
-- El historial lee barber_messages OUTBOUND cuyo templateName es una de las
-- dos plantillas de marketing, en los últimos 120 días. Ya existe
-- (barbershopId, createdAt), que es el que manda; este índice parcial evita
-- recorrer los recordatorios de utilidad, que son la enorme mayoría.
CREATE INDEX IF NOT EXISTS "barber_messages_campaign_idx"
  ON "barber_messages" ("barbershopId", "createdAt" DESC)
  WHERE "templateName" IN ('dc_barber_cumpleanos', 'dc_barber_te_extranamos');


-- ── 3. Comprobación ────────────────────────────────────────────────────
-- SELECT "id", "name", "campaignCooldownDays", "campaignTemplates"
-- FROM "barber_shops" LIMIT 5;
