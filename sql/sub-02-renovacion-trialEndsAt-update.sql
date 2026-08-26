-- ─────────────────────────────────────────────────────────────────────────────
-- SUB-02 · Backfill: trialEndsAt ("acceso hasta") = nextBillingDate para las
--          clínicas con suscripción viva que lo traen atrasado.
--
-- Corre PRIMERO sql/sub-02-renovacion-trialEndsAt-lectura.sql (misma condición).
--
-- REVERSIBLE: el bloque A guarda lo que había en una tabla de respaldo y
-- enseña fila por fila lo que va a cambiar SIN tocar `clinics`. Solo después
-- de mirarlo se corre B. El bloque C deshace todo. En el editor de Supabase
-- cada bloque se pega y se corre por separado; B lleva su BEGIN/COMMIT en el
-- mismo run porque el editor no conserva una transacción abierta entre runs.
--
-- NO cambia el acceso de NADIE: solo toca filas con subscriptionStatus viva
-- (active / trialing / paid), y a esas el gate (isPlanExpired) NUNCA las
-- bloquea mire la fecha que mire. Lo que cambia es lo que /admin muestra
-- ("Al corriente" con la fecha correcta) y lo que pasa el día que un cobro
-- falle: la clínica conserva el periodo pagado en vez de quedar fuera al
-- instante. Nunca mueve la fecha hacia atrás. Las SEDES (nextBillingDate NULL)
-- quedan fuera por construcción.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ A · RESPALDO + VISTA PREVIA (no modifica clinics) ════════════════════════
-- CREATE TABLE ... AS copia los tipos de las columnas tal cual. IF NOT EXISTS
-- hace el paso idempotente: si se corre dos veces, el respaldo original se
-- conserva y no se pisa.

CREATE TABLE IF NOT EXISTS sub02_trial_ends_at_backup AS
SELECT
  id                  AS clinic_id,
  "trialEndsAt"       AS trial_ends_at_old,
  "nextBillingDate"   AS trial_ends_at_new,
  now()               AS backed_up_at
FROM clinics
WHERE "subscriptionStatus" IN ('active', 'trialing', 'paid')
  AND "nextBillingDate" IS NOT NULL
  AND "trialEndsAt" < "nextBillingDate" - interval '1 day';

-- Lo que B va a cambiar, fila por fila (antes → después):
SELECT
  b.clinic_id,
  c.name                                                 AS clinica,
  c."subscriptionStatus"                                 AS estado,
  b.trial_ends_at_old                                    AS antes,
  b.trial_ends_at_new                                    AS despues,
  (b.trial_ends_at_new::date - b.trial_ends_at_old::date) AS dias
FROM sub02_trial_ends_at_backup b
JOIN clinics c ON c.id = b.clinic_id
WHERE c."trialEndsAt" = b.trial_ends_at_old          -- todavía sin aplicar
ORDER BY dias DESC, c.name;


-- ══ B · EL UPDATE (solo después de mirar A) ══════════════════════════════════

BEGIN;

UPDATE clinics c
SET    "trialEndsAt" = b.trial_ends_at_new
FROM   sub02_trial_ends_at_backup b
WHERE  c.id = b.clinic_id
  AND  c."trialEndsAt" = b.trial_ends_at_old                    -- solo lo respaldado, tal cual estaba
  AND  c."subscriptionStatus" IN ('active', 'trialing', 'paid') -- si dejó de estar viva entre A y B, no se toca
  AND  b.trial_ends_at_new > c."trialEndsAt";                   -- nunca hacia atrás

-- Verificación: debe dar 0.
SELECT count(*) AS desfasadas_que_quedan
FROM clinics
WHERE "subscriptionStatus" IN ('active', 'trialing', 'paid')
  AND "nextBillingDate" IS NOT NULL
  AND "trialEndsAt" < "nextBillingDate" - interval '1 day';

COMMIT;   -- si algo no cuadra, cambia esta línea por ROLLBACK; y vuelve a correr el bloque


-- ══ C · DESHACER (vuelve a dejar exactamente lo que había) ═══════════════════
-- Descomenta y corre solo si hace falta revertir B.

-- UPDATE clinics c
-- SET    "trialEndsAt" = b.trial_ends_at_old
-- FROM   sub02_trial_ends_at_backup b
-- WHERE  c.id = b.clinic_id
--   AND  c."trialEndsAt" = b.trial_ends_at_new;

-- Y cuando ya no haga falta el respaldo (después de revertir o de dar B por bueno):
-- DROP TABLE sub02_trial_ends_at_backup;
