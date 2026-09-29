-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T12 · ORTODONCIA, «Plan de tratamiento» completo
-- (como Dentalink) y conectado.
--
-- ⚠️ Lo aplica Rafael, pegándolo en el SQL editor de Supabase. La terminal NO
--    toca la base.
--
-- QUÉ AGREGA (todo ADITIVO, todo nullable; no toca ni una fila que ya exista):
--   1. "orthodontic_treatment_plans"."planDetalle" (JSONB): el plan completo del
--      caso — controles previstos, anclaje superior e inferior, aditamentos,
--      extracciones realizadas, control radiográfico (tipo, periodicidad,
--      reevaluación), aparatología (brackets, alineadores, placas), tubos, bandas,
--      cementación e interconsultas. NULL = el caso todavía no tiene su plan
--      completo (se ve como siempre). Lo que el caso ya tenía (técnica, duración,
--      anclaje general, extracciones indicadas, IPR/TADs) SIGUE en sus columnas.
--   2. "orthodontics_clinic_settings"."planOptions" (JSONB): las listas editables
--      de cada clínica (brackets, alineadores, placas, aditamentos, prescripciones,
--      tipos de cementación) en Ortodoncia → Configuración. NULL = la clínica aún
--      no las editó: se ofrecen las de ejemplo (las de Dentalink).
--   3. Alertas: la nueva alerta «Reevaluación radiográfica» se puede posponer 7 días
--      como las demás; para eso "ortho_alert_snoozes" acepta el tipo
--      'reevaluacion-radiografica'. (Si esa tabla aún no existe, este bloque no hace
--      nada: al pegar después sql/ortodoncia-alertas-pospuestas.sql ya lo trae.)
--
-- El código funciona SIN este SQL: lee y escribe esas dos columnas por SQL crudo con
-- una sonda de columna. Sin la 1.ª, «Editar plan» avisa que falta pegarlo; sin la
-- 2.ª, se ofrecen las listas de ejemplo y Configuración avisa que no se pueden
-- guardar; sin la 3.ª, «Posponer» de esa alerta responde que falta el SQL.
--
-- Ninguna columna se declara en prisma/schema.prisma a propósito: con una columna de
-- menos, cualquier lectura del plan (decenas de sitios) o de la configuración
-- tiraría P2022 en toda la app.
--
-- IDEMPOTENTE (ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS): se puede pegar
-- dos veces. CERO DROP de tablas o columnas. PLANO: sin bloques DO.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. El plan completo del caso ────────────────────────────────────────
ALTER TABLE "orthodontic_treatment_plans"
  ADD COLUMN IF NOT EXISTS "planDetalle" JSONB;


-- ── 2. Las listas editables de la clínica ───────────────────────────────
ALTER TABLE "orthodontics_clinic_settings"
  ADD COLUMN IF NOT EXISTS "planOptions" JSONB;


-- ── 3. «Reevaluación radiográfica» se puede posponer ────────────────────
ALTER TABLE IF EXISTS "ortho_alert_snoozes" DROP CONSTRAINT IF EXISTS "ortho_alert_snoozes_tipo_check";
ALTER TABLE IF EXISTS "ortho_alert_snoozes" ADD CONSTRAINT "ortho_alert_snoozes_tipo_check"
  CHECK ("tipo" IN ('sin-proximo-control', 'no-asistio', 'proximo-a-terminar', 'pasado-de-fecha', 'reevaluacion-radiografica'));


-- ── 4. Comprobación (solo lee) ───────────────────────────────────────────
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE (table_name = 'orthodontic_treatment_plans' AND column_name = 'planDetalle')
   OR (table_name = 'orthodontics_clinic_settings' AND column_name = 'planOptions')
ORDER BY table_name, column_name;
