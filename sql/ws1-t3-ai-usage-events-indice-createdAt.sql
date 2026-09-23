-- ws1-t3 · Índice por fecha en ai_usage_events
--
-- El único índice de la tabla es (clinicId, createdAt), que EMPIEZA por
-- clinicId. La Tesorería de IA (/api/admin/ai-billing) consulta sin clinicId:
--
--   aggregate({ where: { createdAt: { gte: burnSince } } })        -- quema 30 días
--   groupBy({ by: ["model"], where: { createdAt: { gte: burnSince } } })
--   groupBy({ by: ["fxRate"], where: { billedCents…, createdAt: { gte: monthStart } } })
--
-- Un índice compuesto no sirve si no se filtra por su primera columna, así que
-- Postgres lee la tabla entera. Con 63 filas da igual; con volumen, la página
-- se arrastra. Este índice cubre las consultas acotadas por fecha.
--
-- Las consultas de TODO el histórico (groupBy por fxRate sin fecha, groupBy
-- por clinicId sin fecha) siguen leyendo la tabla entera: son agregados de
-- toda la vida por definición y acotarlas cambiaría los números que hoy se
-- enseñan (consumo total, margen histórico). No se tocan.
--
-- Sin CONCURRENTLY a propósito: hoy la tabla tiene ~63 filas y el índice se
-- crea al instante. Si se pega cuando ya tenga volumen, mejor
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_usage_events_createdAt_idx" ON "ai_usage_events" ("createdAt");
-- (no bloquea escrituras; debe ir SOLO, fuera de una transacción).
--
-- Idempotente, sin DROP. Espejo en prisma/schema.prisma: @@index([createdAt])
-- en AiUsageEvent. NO se aplica con prisma migrate: se pega a mano.

CREATE INDEX IF NOT EXISTS "ai_usage_events_createdAt_idx"
  ON "ai_usage_events" ("createdAt");
