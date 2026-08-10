-- Afiliados — INVITACIONES ENTRE AFILIADOS (ago 2026). Aditivo e idempotente.
--
-- Rehace el SEGUNDO NIVEL del programa. Reemplaza al modelo de "vendedores"
-- (sql/afiliados-equipo.sql), que queda muerto: sus tres tablas siguen ahí
-- —dropearlas es destructivo— pero ninguna línea de código las lee ni las
-- escribe. Estaban en 0 filas al retirarse (0 vendedores, 0 atribuciones), así
-- que no hubo nada que migrar y nadie dejó de cobrar.
--
-- EL MODELO NUEVO
--   · Un afiliado invita a otro con /afiliados/registro?inv=<referralCode>.
--   · El invitado es un afiliado NORMAL e idéntico al que lo invitó: misma
--     comisión por plan, elige su propia modalidad, gana sus propios bonos y
--     puede invitar a su vez.
--   · Quien invita NO cobra un peso por las clínicas de su invitado. Su único
--     premio son los BONOS POR RED (sql/afiliados-bonos-red.sql), y solo como
--     PAGO ÚNICO.
--   · UN SOLO NIVEL: si A invita a B y B invita a C, las clínicas de C cuentan
--     para el bono de B y CERO para A. Nunca se acumula hacia arriba.
--
-- Se puede correr las veces que haga falta: todo va con IF NOT EXISTS.

-- ── 1. El vínculo, en la propia tabla de afiliados ───────────────────────
-- Auto-referencia nullable: null = se registró directo, sin invitación.
--
-- PERMANENTE POR DISEÑO. El código lo escribe UNA vez, al crear la cuenta
-- (createAffiliateAccount), y no hay ninguna ruta, pantalla o acción que lo
-- cambie o lo borre. Si se pudiera romper, cualquiera se desvincularía de su
-- invitador justo antes de que a este le tocara cobrar un bono que ya se ganó.
ALTER TABLE "affiliates"
  ADD COLUMN IF NOT EXISTS "invitedByAffiliateId" text;

-- ON DELETE SET NULL y no CASCADE: borrar a un invitador jamás puede borrar
-- las cuentas —ni las comisiones— de la gente que invitó.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'affiliates_invitedByAffiliateId_fkey'
  ) THEN
    ALTER TABLE "affiliates"
      ADD CONSTRAINT "affiliates_invitedByAffiliateId_fkey"
      FOREIGN KEY ("invitedByAffiliateId") REFERENCES "affiliates"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- El conteo del bono por red parte de aquí ("dame los invitados de X"), y el
-- cron lo hace para todos los afiliados de una pasada.
CREATE INDEX IF NOT EXISTS "affiliates_invitedByAffiliateId_idx"
  ON "affiliates" ("invitedByAffiliateId");

-- Nadie puede ser su propio invitador. La app ya bloquea la auto-invitación
-- por correo y por id (resolveInviterId), pero el candado tiene que estar
-- también en la BD: es la regla que impide fabricarse una red de una sola
-- persona y cobrarse un bono por el propio trabajo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'affiliates_no_self_invite'
  ) THEN
    ALTER TABLE "affiliates"
      ADD CONSTRAINT "affiliates_no_self_invite"
      CHECK ("invitedByAffiliateId" IS NULL OR "invitedByAffiliateId" <> "id");
  END IF;
END $$;

-- ── 2. Se retira la modalidad MENSUAL de los bonos por red ───────────────
-- Los bonos por red pasan a ser SOLO pago único. Las cinco columnas mensuales
-- quedan en 0 y sin uso: no entran al `select` de getNetworkBonusConfig, no
-- viajan a la UI del admin y ninguna escritura las menciona. No se dropean
-- aquí (destructivo); la limpieza queda anotada como deuda en ORQUESTA.md.
UPDATE "affiliate_payout_config"
SET "networkTier1MonthlyMxn" = 0,
    "networkTier2MonthlyMxn" = 0,
    "networkTier3MonthlyMxn" = 0,
    "networkTier4MonthlyMxn" = 0,
    "networkTier5MonthlyMxn" = 0
WHERE "id" = 1;
