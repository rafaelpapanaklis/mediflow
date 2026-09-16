-- ═══════════════════════════════════════════════════════════════════════
-- Sabina · «lo que se te está escapando» (WS1-T8) — DOS ÍNDICES Y UNA REGLA
--
-- ⚠️ NADA DE ESTO HACE FALTA PARA QUE LA HERRAMIENTA FUNCIONE. Sin este
-- archivo, `oportunidades_perdidas` da exactamente los mismos números: lo
-- único que cambia es lo que tarda Postgres en una clínica con años de
-- historia. Se puede aplicar hoy, mañana o nunca, y se puede correr dos veces
-- sin daño.
--
-- No crea tablas ni columnas: SOLO índices. Por eso no hay riesgo de la
-- lección de `sql/patient-visibility.sql` (una columna que el Prisma Client
-- espera y la base no tiene tumba el login entero).
--
-- Plano y sin bloques DO $$ … $$ (el editor de Supabase se atraganta).
-- Nombres de columna en camelCase y ENTRE COMILLAS: Prisma mapea el nombre del
-- campo tal cual, sin @map.
--
-- Aplicar a mano en el SQL Editor de Supabase. NO `prisma migrate`.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- 1) Planes de tratamiento por clínica y estado.
--
-- La herramienta pide los planes ACTIVE de la clínica. Hoy la tabla solo tiene
-- ("clinicId", "patientId", "status"): con `patientId` en medio, una consulta
-- que no filtra por paciente solo aprovecha el primer tramo del índice y
-- Postgres acaba filtrando `status` a mano sobre todos los planes de la
-- clínica. Es la única de las cinco consultas de esta herramienta que no tiene
-- un índice a medida.
--
-- (Las demás ya están cubiertas y no se tocan; lo comprobé una por una:
--    quotes                     → "quotes_clinicId_status_idx"
--    invoices                   → "invoices_clinicId_status_createdAt_idx"
--    appointments               → "appointments_clinicId_startsAt_endsAt_status_idx"
--    treatment_sessions         → "treatment_sessions_treatmentId_idx"
--    booking_requests           → "booking_requests_clinicId_status_requestedAt_idx"
--    appointment_change_requests→ "appointment_change_requests_clinicId_status_createdAt_idx")
-- ───────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "treatment_plans_clinicId_status_idx"
  ON "treatment_plans" ("clinicId", "status");

-- ───────────────────────────────────────────────────────────────────────
-- 2) Facturas POR COBRAR (índice parcial).
--
-- «Por cobrar» es siempre el mismo puñado de filas —saldo > 0 y ni borrador ni
-- cancelada— dentro de una tabla que crece para siempre. Un índice PARCIAL
-- indexa solo esas: en una clínica con 40,000 facturas de las que 22,000 están
-- cobradas, el índice pesa la mitad y la consulta no toca ni una fila pagada.
--
-- No es solo para Sabina: es literalmente el `where` de Finanzas → Saldos y del
-- KPI de facturas (`receivableInvoiceWhere` en src/lib/caja.ts), así que esas
-- dos pantallas también se benefician.
--
-- La lista de estados va escrita a mano y NO como `status <> 'PAID'`: tiene que
-- ser la misma condición literal del código para que Postgres pueda usar el
-- índice parcial.
-- ───────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "invoices_por_cobrar_idx"
  ON "invoices" ("clinicId", "createdAt" DESC)
  WHERE "balance" > 0 AND "status" NOT IN ('DRAFT', 'CANCELLED');

-- ───────────────────────────────────────────────────────────────────────
-- 3) MEDIR. Esto no cambia nada: solo dice cuánto tarda de verdad.
--
-- Correr ANTES y DESPUÉS de crear los índices, cambiando 'PON-AQUI-EL-ID' por
-- el id de una clínica con años de historia. Lo que interesa de cada salida es
-- la última línea, «Execution Time».
-- ───────────────────────────────────────────────────────────────────────

-- 3.1 · Facturas por cobrar (la cifra que más pesa en la respuesta).
EXPLAIN ANALYZE
SELECT COUNT(*), SUM("balance")
FROM "invoices"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "balance" > 0
  AND "status" NOT IN ('DRAFT', 'CANCELLED')
  AND "createdAt" < NOW() - INTERVAL '7 days';

-- 3.2 · Presupuestos presentados y sin contestar.
EXPLAIN ANALYZE
SELECT COUNT(*), SUM("total")
FROM "quotes"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "status" IN ('PRESENTED', 'EXPIRED')
  AND "presentedAt" < NOW() - INTERVAL '7 days';

-- 3.3 · Planes activos (la que estrena índice).
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM "treatment_plans"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "status" = 'ACTIVE';

-- 3.4 · Quién tiene cita futura (el cruce que comparten dos secciones).
EXPLAIN ANALYZE
SELECT COUNT(DISTINCT "patientId")
FROM "appointments"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "startsAt" >= NOW()
  AND "status" NOT IN ('CANCELLED', 'NO_SHOW');

-- 3.5 · Citas caídas de los últimos 90 días.
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM "appointments"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "startsAt" >= NOW() - INTERVAL '90 days'
  AND "startsAt" <  NOW() - INTERVAL '7 days'
  AND "status" IN ('CANCELLED', 'NO_SHOW');

-- 3.6 · Y la más cara del catálogo, que NO es de esta herramienta pero la
--       arrastra el resumen: la última visita cumplida de cada paciente
--       (`pacientes_inactivos`). Si algo va a tardar, es esto.
EXPLAIN ANALYZE
SELECT "patientId", MAX("startsAt")
FROM "appointments"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "status" IN ('COMPLETED', 'CHECKED_OUT')
GROUP BY "patientId";

-- 3.7 · Quién pidió cita por la mini-web y nadie contestó. La tabla puede NO
--       existir (viene con sql/landing-v2.sql); si da "relation does not exist",
--       es eso, y la herramienta ya lo trata: contesta con todo lo demás.
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM "booking_requests"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "status" = 'PENDIENTE'
  AND "createdAt" >= NOW() - INTERVAL '90 days';

-- 3.8 · Quién pidió mover su cita desde el portal y nadie contestó.
EXPLAIN ANALYZE
SELECT COUNT(*)
FROM "appointment_change_requests"
WHERE "clinicId" = 'PON-AQUI-EL-ID'
  AND "status" = 'PENDING'
  AND "createdAt" >= NOW() - INTERVAL '90 days';

-- ───────────────────────────────────────────────────────────────────────
-- 4) Comprobar que quedaron aplicados (no falla si ya estaban).
-- ───────────────────────────────────────────────────────────────────────
SELECT tablename, indexname
FROM pg_indexes
WHERE indexname IN ('treatment_plans_clinicId_status_idx', 'invoices_por_cobrar_idx')
ORDER BY tablename;
