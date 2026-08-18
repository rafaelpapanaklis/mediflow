-- ═══════════════════════════════════════════════════════════════════════
-- EQ-02 — EL SEGUNDO FACTOR PASA A SER DE LA PERSONA, NO DE LA FILA
--
-- OPCIONAL, NO BLOQUEANTE. El código ya resuelve el 2FA mirando TODAS las
-- filas de la persona (src/lib/auth/two-factor-identity-core.ts), así que el
-- agujero está cerrado con o sin este SQL. Esto solo pone la BASE de acuerdo
-- con el código: deja de haber filas hermanas en blanco.
--
-- ── QUÉ ARREGLA ────────────────────────────────────────────────────────
-- El schema es @@unique([supabaseId, clinicId]): una persona tiene UNA fila
-- `users` POR clínica. Los endpoints de 2FA escribían en UNA sola, así que el
-- dueño con dos sedes tiene el secret y la bandera en la sede donde enroló y
-- las hermanas vacías.
--
-- ── ORDEN ──────────────────────────────────────────────────────────────
-- 1. Correr la consulta 1 y MIRAR el resultado.
-- 2. Si sale 0 filas, no hay nada que hacer: nadie tiene el 2FA repartido.
-- 3. Si sale algo, correr la 2 (backfill) y luego la 3 para comprobar.
--
-- Idempotente: correrlo dos veces no cambia nada la segunda.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1 · A QUIÉN LE FALTA (SOLO LECTURA — correr esta primero) ──────────
-- Personas con el 2FA puesto en al menos una sede y filas hermanas sin él.
-- Sin datos personales: el supabaseId, cuántas sedes y cuántas están en blanco.
SELECT
  u."supabaseId",
  COUNT(*)                                                  AS sedes_activas,
  COUNT(*) FILTER (WHERE u."totpEnabled")                    AS sedes_con_2fa,
  COUNT(*) FILTER (WHERE NOT u."totpEnabled")                AS sedes_sin_2fa,
  COUNT(*) FILTER (WHERE u."totpSecret" IS NULL)             AS sedes_sin_secret
FROM "users" u
WHERE u."isActive"
GROUP BY u."supabaseId"
HAVING BOOL_OR(u."totpEnabled") AND BOOL_OR(NOT u."totpEnabled")
ORDER BY sedes_sin_2fa DESC;


-- ── 2 · EL BACKFILL (ESCRIBE — correr solo si la 1 devolvió filas) ─────
-- Copia el secret, la bandera y los códigos de recuperación de la fila donde
-- la persona enroló a TODAS sus filas hermanas.
--
-- `DISTINCT ON` con el orden de abajo elige, por persona, la fila que de
-- verdad manda: enrolada y con secret primero. Es el MISMO criterio que aplica
-- `resolverDosFactores` en el código, para que la base y el gate no puedan
-- decir cosas distintas.
--
-- No toca a quien no tenga ninguna fila enrolada: si nadie enroló, no hay nada
-- que copiar y el WHERE final lo deja fuera.
WITH fuente AS (
  SELECT DISTINCT ON (u."supabaseId")
    u."supabaseId",
    u."totpSecret",
    u."recoveryCodes"
  FROM "users" u
  WHERE u."isActive"
    AND u."totpEnabled"
    AND u."totpSecret" IS NOT NULL
  ORDER BY u."supabaseId", u."updatedAt" DESC
)
UPDATE "users" destino
SET
  "totpEnabled"   = true,
  "totpSecret"    = fuente."totpSecret",
  "recoveryCodes" = fuente."recoveryCodes"
FROM fuente
WHERE destino."supabaseId" = fuente."supabaseId"
  AND destino."isActive"
  -- Solo las que están a medias. Sin esto, cada ejecución reescribiría filas
  -- que ya están bien y le movería el updatedAt a todo el mundo.
  AND (
    destino."totpEnabled" IS DISTINCT FROM true
    OR destino."totpSecret" IS DISTINCT FROM fuente."totpSecret"
    OR destino."recoveryCodes" IS DISTINCT FROM fuente."recoveryCodes"
  );


-- ── 3 · COMPROBAR (SOLO LECTURA — correr después del backfill) ─────────
-- Tiene que devolver CERO filas. Si devuelve alguna, el backfill no cubrió a
-- esa persona: mírala a mano antes de dar EQ-02 por cerrado en la base.
SELECT
  u."supabaseId",
  COUNT(*) FILTER (WHERE u."totpEnabled")     AS con_2fa,
  COUNT(*) FILTER (WHERE NOT u."totpEnabled") AS sin_2fa
FROM "users" u
WHERE u."isActive"
GROUP BY u."supabaseId"
HAVING BOOL_OR(u."totpEnabled") AND BOOL_OR(NOT u."totpEnabled");


-- ── 4 · CUÁNTA GENTE TIENE VARIAS SEDES (SOLO LECTURA) ─────────────────
-- El contexto: si esto devuelve 0, EQ-02 nunca se pudo explotar en esta base
-- porque nadie tiene más de una fila. Vale la pena saberlo antes de decidir
-- cuánto QA merece.
SELECT
  COUNT(*)                                    AS personas,
  COUNT(*) FILTER (WHERE sedes > 1)           AS con_varias_sedes,
  MAX(sedes)                                  AS maximo_sedes
FROM (
  SELECT "supabaseId", COUNT(*) AS sedes
  FROM "users"
  WHERE "isActive"
  GROUP BY "supabaseId"
) t;
