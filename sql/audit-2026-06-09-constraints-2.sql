-- ============================================================================
-- Auditoría 2026-06-09 (parte 2) — Uniques: clinics.waPhoneNumberId y
-- weekly_insights (clinicId, weekStart).
-- Acompaña los @unique/@@unique añadidos a prisma/schema.prisma en este commit.
-- Complementa sql/audit-2026-06-09-indexes.sql (esa parte ya cubre
-- whatsapp_reminders, inbox_messages, inbox_threads y ai_topups — NO repetir).
-- El deploy NO corre migraciones: aplicar A MANO en Supabase (SQL editor).
--
-- ⚠️ CÓMO APLICAR
--  1. CREATE/DROP INDEX CONCURRENTLY no puede correr dentro de una transacción
--     y el SQL editor de Supabase envuelve lotes multi-statement en una
--     transacción implícita → ejecuta cada statement CONCURRENTLY en un "Run"
--     PROPIO (un statement por ejecución).
--  2. Si un CREATE ... CONCURRENTLY falla a medias (p. ej. por duplicados),
--     deja un índice INVALID: haz DROP INDEX "nombre"; y reintenta (ver §3).
--  3. Antes de cada UNIQUE corre su query de DETECCIÓN; si devuelve filas,
--     resuelve los duplicados primero (§1.2 manual, §2.2 automático).
--  4. Los nombres siguen la convención de Prisma (tabla_columnas_key) para
--     que el schema y la DB no driften.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- §1 [P2] clinics — UNIQUE (waPhoneNumberId): el webhook de WhatsApp resuelve
--     la clínica con findFirst sobre este campo; si dos clínicas comparten
--     phone_number_id los mensajes de pacientes se enrutan a la clínica
--     equivocada. NULLs no chocan (NULLS DISTINCT): clínicas sin WhatsApp
--     conectado no se ven afectadas.
-- ────────────────────────────────────────────────────────────────────────────

-- §1.1 DETECCIÓN de clínicas que comparten waPhoneNumberId. Si devuelve 0
--      filas, salta a §1.3.
SELECT "waPhoneNumberId", COUNT(*) AS n,
       array_agg(id   ORDER BY "createdAt", id) AS ids,
       array_agg(name ORDER BY "createdAt", id) AS names
FROM "clinics"
WHERE "waPhoneNumberId" IS NOT NULL
GROUP BY "waPhoneNumberId"
HAVING COUNT(*) > 1;

-- §1.2 RESOLUCIÓN MANUAL (solo si §1.1 devolvió filas). ⚠️ NO borrar a ciegas:
--      son clínicas. Decide a mano cuál es la dueña real del número en Meta
--      Business y desconecta WhatsApp en las demás (NULL no choca con el
--      unique). Plantilla, una por clínica equivocada:
--
--      UPDATE "clinics"
--      SET "waPhoneNumberId" = NULL, "waAccessToken" = NULL,
--          "waConnected" = false, "updatedAt" = CURRENT_TIMESTAMP
--      WHERE id = '<id_de_la_clinica_que_NO_es_dueña_del_número>';

-- §1.3 El índice único (Run propio, sin transacción).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "clinics_waPhoneNumberId_key"
  ON "clinics" ("waPhoneNumberId");


-- ────────────────────────────────────────────────────────────────────────────
-- §2 [P2] weekly_insights — UNIQUE (clinicId, weekStart): disparos
--     concurrentes del cron de insights semanales insertaban resúmenes
--     duplicados (cada uno = una llamada de IA pagada). Con el unique, el
--     segundo insert falla en vez de duplicar.
-- ────────────────────────────────────────────────────────────────────────────

-- §2.1 DETECCIÓN de insights duplicados por (clinicId, weekStart). El array
--      lista ids del más reciente al más viejo: se conserva el PRIMERO.
--      Si devuelve 0 filas, salta a §2.3.
SELECT "clinicId", "weekStart", COUNT(*) AS n,
       array_agg(id ORDER BY "createdAt" DESC, id DESC) AS ids
FROM "weekly_insights"
GROUP BY "clinicId", "weekStart"
HAVING COUNT(*) > 1;

-- §2.2 DE-DUP: conserva el insight MÁS RECIENTE de cada (clinicId, weekStart)
--      y borra el resto (mismo periodo regenerado = el último es el válido).
--      No-op si §2.1 devolvió 0 filas. Un solo Run.
DELETE FROM "weekly_insights" d
USING "weekly_insights" k
WHERE k."clinicId"  = d."clinicId"
  AND k."weekStart" = d."weekStart"
  AND k.id <> d.id
  AND (k."createdAt" > d."createdAt" OR (k."createdAt" = d."createdAt" AND k.id > d.id));

-- §2.3 El índice único (Run propio, sin transacción).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "weekly_insights_clinicId_weekStart_key"
  ON "weekly_insights" ("clinicId", "weekStart");

-- §2.4 El @@index([clinicId, weekStart]) del schema se reemplazó por el
--      @@unique (mismo prefijo de columnas → redundante). Borra el viejo
--      SOLO después de que §2.3 quede válido. Run propio.
DROP INDEX CONCURRENTLY IF EXISTS "weekly_insights_clinicId_weekStart_idx";


-- ────────────────────────────────────────────────────────────────────────────
-- §3 VERIFICACIÓN final
-- ────────────────────────────────────────────────────────────────────────────

-- Esperado: 2 filas (los dos _key). El _idx viejo de weekly_insights NO debe
-- aparecer.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND indexname IN (
  'clinics_waPhoneNumberId_key',
  'weekly_insights_clinicId_weekStart_key',
  'weekly_insights_clinicId_weekStart_idx'
)
ORDER BY indexname;

-- Esperado: 0 filas. Si aparece uno de los de arriba quedó INVALID por un
-- fallo a medias: DROP INDEX "nombre"; y reintenta su CREATE.
SELECT c.relname AS invalid_index
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE NOT i.indisvalid;
