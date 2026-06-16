-- Backfill: sincroniza Clinic.aiTokensLimit con el plan actual.
-- Hasta ahora aiTokensLimit nunca se escribía (quedaba en el default 50000),
-- así que casi todas las clínicas tienen el cupo de BASIC aunque su plan
-- prometa más. Este UPDATE alinea el cupo con el plan vigente.
--
-- Fuente de cupos (única): src/lib/plans.ts → getPlanLimits(plan).aiTokensDefault
--   BASIC 50000 · PRO 200000 · CLINIC 1000000
--
-- NO toca aiTokensUsed ni aiLastResetAt (el consumo del periodo se conserva).
-- El monedero de recargas de IA es OTRO sistema (sql/ai-billing.sql) — no se toca aquí.
-- Aplicar a mano en Supabase (no se aplica solo).
-- OJO: la tabla física es "clinics" (Prisma @@map), NO "Clinic" (nombre del modelo).

UPDATE "clinics" SET "aiTokensLimit" = CASE "plan"::text
  WHEN 'BASIC'  THEN 50000
  WHEN 'PRO'    THEN 200000
  WHEN 'CLINIC' THEN 1000000
  ELSE "aiTokensLimit" END;
