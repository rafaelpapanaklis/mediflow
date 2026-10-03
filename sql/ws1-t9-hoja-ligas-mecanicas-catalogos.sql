-- ============================================================================
-- WS1-T9 — Ortodoncia: hoja de control con arco por arcada, ligas, mecánicas
-- auxiliares y catálogos propios de la clínica (auditoría BEVADENT, M1-M4).
--
-- ⚠️ Lo aplica Rafael, en el SQL editor de Supabase. La terminal no toca la base.
-- Plano, aditivo e idempotente: se puede correr dos veces sin efecto. No borra
-- ni reescribe datos. Nada de esto va en schema.prisma (el código lo lee con
-- SQL crudo y una sonda): mientras no se pegue, la hoja sale como antes.
--
-- 1) M1 · ortho_treatment_cards."wireToLowerId": el arco nuevo INFERIOR de la
--    hoja cuando es otro que el superior ("wireToId"). NULL = el de "wireToId"
--    (si es de las dos arcadas) o sin cambio abajo.
-- 2) M2 · ortho_card_ligatures: las ligas anotadas en cada hoja (tipo, color,
--    arcada, «se cambiaron hoy»). Se borran con su hoja.
-- 3) M3 · ortho_aux_devices: las mecánicas auxiliares del caso (resorte,
--    cadeneta, botón, gancho, tope, elástico intermaxilar, expansor…), con
--    arcada, diente o zona, colocación y retiro. Se borran con su caso.
-- 4) M4 · orthodontics_clinic_settings."hojaCatalogos": los catálogos de la
--    clínica (materiales y calibres de arco, tipos y colores de liga, tipos de
--    mecánica). NULL = los de fábrica.
--
-- Las tablas nuevas llevan RLS sin políticas (deny-all), igual que el resto:
-- el servidor entra con service role.
-- ============================================================================

-- 1) Arco nuevo inferior de la hoja
ALTER TABLE "ortho_treatment_cards" ADD COLUMN IF NOT EXISTS "wireToLowerId" TEXT;

-- 2) Ligas de cada hoja
CREATE TABLE IF NOT EXISTS "ortho_card_ligatures" (
  "id"              TEXT PRIMARY KEY,
  "cardId"          TEXT NOT NULL REFERENCES "ortho_treatment_cards"("id") ON DELETE CASCADE,
  "clinicId"        TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "patientId"       TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL,
  "orden"           INTEGER NOT NULL DEFAULT 0,
  "tipo"            TEXT NOT NULL,
  "color"           TEXT,
  "arcada"          TEXT NOT NULL DEFAULT 'AMBAS',
  "cambiadasHoy"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ortho_card_ligatures_cardId_idx" ON "ortho_card_ligatures" ("cardId");
CREATE INDEX IF NOT EXISTS "ortho_card_ligatures_clinicId_treatmentPlanId_idx" ON "ortho_card_ligatures" ("clinicId", "treatmentPlanId");
ALTER TABLE "ortho_card_ligatures" ENABLE ROW LEVEL SECURITY;

-- 3) Mecánicas auxiliares del caso
CREATE TABLE IF NOT EXISTS "ortho_aux_devices" (
  "id"              TEXT PRIMARY KEY,
  "clinicId"        TEXT NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE,
  "patientId"       TEXT NOT NULL,
  "treatmentPlanId" TEXT NOT NULL REFERENCES "orthodontic_treatment_plans"("id") ON DELETE CASCADE,
  "tipo"            TEXT NOT NULL,
  "arcada"          TEXT,
  "ubicacion"       TEXT,
  "nota"            TEXT,
  "colocadaEl"      TIMESTAMP(3) NOT NULL,
  "retiradaEl"      TIMESTAMP(3),
  "cardIdAlta"      TEXT,
  "cardIdRetiro"    TEXT,
  "createdById"     TEXT,
  "retiradaPorId"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ortho_aux_devices_clinicId_treatmentPlanId_idx" ON "ortho_aux_devices" ("clinicId", "treatmentPlanId");
ALTER TABLE "ortho_aux_devices" ENABLE ROW LEVEL SECURITY;

-- 4) Catálogos de la hoja, por clínica
ALTER TABLE "orthodontics_clinic_settings" ADD COLUMN IF NOT EXISTS "hojaCatalogos" JSONB;
