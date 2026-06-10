-- ============================================================================
-- Auditoría 2026-06-09 — Índices y uniques: whatsapp_reminders, inbox, ai_topups
-- Acompaña los @@index/@@unique añadidos a prisma/schema.prisma en este commit.
-- El deploy NO corre migraciones: aplicar A MANO en Supabase (SQL editor).
--
-- ⚠️ CÓMO APLICAR
--  1. CREATE INDEX CONCURRENTLY no puede correr dentro de una transacción y el
--     SQL editor de Supabase envuelve lotes multi-statement en una transacción
--     implícita → ejecuta cada CREATE ... CONCURRENTLY en un "Run" PROPIO
--     (un statement por ejecución). Los bloques BEGIN/COMMIT de de-dup sí van
--     completos en un solo Run.
--  2. Si un CREATE ... CONCURRENTLY falla a medias (p. ej. por duplicados),
--     deja un índice INVALID: haz DROP INDEX "nombre"; y reintenta (ver §5).
--  3. Antes de cada UNIQUE (§2/§3) corre su query de DETECCIÓN; si devuelve
--     filas, ejecuta el bloque de de-dup (es no-op si no hay duplicados).
--  4. Los nombres siguen la convención de Prisma (tabla_columnas_idx/_key) para
--     que el schema y la DB no driften.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- §1 [P1] whatsapp_reminders — índices para el worker de recordatorios y
--     los listados por clínica. (Un Run por statement.)
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS "whatsapp_reminders_status_scheduledFor_idx"
  ON "whatsapp_reminders" ("status", "scheduledFor");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "whatsapp_reminders_clinicId_status_sentAt_idx"
  ON "whatsapp_reminders" ("clinicId", "status", "sentAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "whatsapp_reminders_clinicId_type_createdAt_idx"
  ON "whatsapp_reminders" ("clinicId", "type", "createdAt");


-- ────────────────────────────────────────────────────────────────────────────
-- §2 [P0 defensa] inbox_messages — UNIQUE (threadId, externalId): dedup por
--     wamid a nivel DB (Meta reintenta webhooks). NULLs no chocan (NULLS
--     DISTINCT): mensajes sin wamid (outbound del staff, notas internas) no
--     se ven afectados.
-- ────────────────────────────────────────────────────────────────────────────

-- §2.1 DETECCIÓN de duplicados previos (reintentos de Meta anteriores al
--      guard en código ffa0ac5). Si devuelve 0 filas, salta a §2.3.
SELECT "threadId", "externalId", COUNT(*) AS n,
       array_agg(id ORDER BY "sentAt", id) AS ids
FROM "inbox_messages"
WHERE "externalId" IS NOT NULL
GROUP BY "threadId", "externalId"
HAVING COUNT(*) > 1;

-- §2.2 DE-DUP: conserva el mensaje más antiguo de cada (threadId, externalId)
--      y borra las copias (cuerpos idénticos: mismo wamid = mismo mensaje).
--      No-op si §2.1 devolvió 0 filas. Un solo Run.
DELETE FROM "inbox_messages" d
USING "inbox_messages" k
WHERE d."externalId" IS NOT NULL
  AND k."threadId"   = d."threadId"
  AND k."externalId" = d."externalId"
  AND k.id <> d.id
  AND (k."sentAt" < d."sentAt" OR (k."sentAt" = d."sentAt" AND k.id < d.id));

-- §2.3 El índice único (Run propio, sin transacción).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "inbox_messages_threadId_externalId_key"
  ON "inbox_messages" ("threadId", "externalId");


-- ────────────────────────────────────────────────────────────────────────────
-- §3 [P3] inbox_threads — UNIQUE (clinicId, channel, externalId): evita hilos
--     duplicados por reintentos de Meta. Threads sin externalId (NULL) no
--     chocan entre sí.
-- ────────────────────────────────────────────────────────────────────────────

-- §3.1 DETECCIÓN de hilos duplicados. Si devuelve 0 filas, salta a §3.3.
SELECT "clinicId", "channel", "externalId", COUNT(*) AS n,
       array_agg(id ORDER BY "createdAt", id) AS ids
FROM "inbox_threads"
WHERE "externalId" IS NOT NULL
GROUP BY "clinicId", "channel", "externalId"
HAVING COUNT(*) > 1;

-- §3.2 MERGE de duplicados: conserva el hilo más ANTIGUO, re-apunta sus
--      mensajes y reminders, actualiza lastMessageAt y borra el resto.
--      No-op si §3.1 devolvió 0 filas. TODO el bloque en UN solo Run.
BEGIN;

CREATE TEMP TABLE _dup_threads ON COMMIT DROP AS
SELECT id AS dup_id, keep_id FROM (
  SELECT id,
         FIRST_VALUE(id) OVER (
           PARTITION BY "clinicId", "channel", "externalId"
           ORDER BY "createdAt", id
         ) AS keep_id
  FROM "inbox_threads"
  WHERE "externalId" IS NOT NULL
) t
WHERE id <> keep_id;

UPDATE "inbox_messages" m SET "threadId" = d.keep_id
FROM _dup_threads d WHERE m."threadId" = d.dup_id;

UPDATE "reminders" r SET "threadId" = d.keep_id
FROM _dup_threads d WHERE r."threadId" = d.dup_id;

UPDATE "inbox_threads" t
SET "lastMessageAt" = GREATEST(t."lastMessageAt", s.max_lm),
    "updatedAt"     = CURRENT_TIMESTAMP
FROM (
  SELECT d.keep_id, MAX(x."lastMessageAt") AS max_lm
  FROM _dup_threads d
  JOIN "inbox_threads" x ON x.id = d.dup_id
  GROUP BY d.keep_id
) s
WHERE t.id = s.keep_id;

DELETE FROM "inbox_threads" t USING _dup_threads d WHERE t.id = d.dup_id;

COMMIT;

-- §3.3 El índice único (Run propio, sin transacción).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "inbox_threads_clinicId_channel_externalId_key"
  ON "inbox_threads" ("clinicId", "channel", "externalId");


-- ────────────────────────────────────────────────────────────────────────────
-- §4 [P2] ai_topups — índice por gatewayRef (lookup de webhooks Stripe/MP) +
--     único PARCIAL anti doble-acreditación. El parcial NO está en
--     schema.prisma (Prisma no soporta índices parciales): solo vive aquí.
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_topups_gatewayRef_idx"
  ON "ai_topups" ("gatewayRef");

-- §4.1 DETECCIÓN de topups PAID duplicados por referencia. ⚠️ Si devuelve
--      filas hubo DOBLE ACREDITACIÓN al wallet: NO borrar a ciegas — revisar
--      ai_wallet_transactions de esa clínica a mano y ajustar el saldo antes
--      de marcar la fila sobrante como REJECTED (no DELETE: es dinero).
SELECT "gatewayRef", COUNT(*) AS n,
       array_agg(id ORDER BY "paidAt", "createdAt") AS ids
FROM "ai_topups"
WHERE "gatewayRef" IS NOT NULL AND status = 'PAID'
GROUP BY "gatewayRef"
HAVING COUNT(*) > 1;

-- §4.2 Único parcial: solo un topup PAID por gatewayRef. Run propio.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ai_topups_gatewayref_paid_uq
  ON ai_topups ("gatewayRef")
  WHERE "gatewayRef" IS NOT NULL AND status = 'PAID';


-- ────────────────────────────────────────────────────────────────────────────
-- §5 VERIFICACIÓN final
-- ────────────────────────────────────────────────────────────────────────────

-- Esperado: 7 filas.
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND indexname IN (
  'whatsapp_reminders_status_scheduledFor_idx',
  'whatsapp_reminders_clinicId_status_sentAt_idx',
  'whatsapp_reminders_clinicId_type_createdAt_idx',
  'inbox_messages_threadId_externalId_key',
  'inbox_threads_clinicId_channel_externalId_key',
  'ai_topups_gatewayRef_idx',
  'ai_topups_gatewayref_paid_uq'
)
ORDER BY indexname;

-- Esperado: 0 filas. Si aparece uno de los de arriba quedó INVALID por un
-- fallo a medias: DROP INDEX "nombre"; y reintenta su CREATE.
SELECT c.relname AS invalid_index
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE NOT i.indisvalid;
