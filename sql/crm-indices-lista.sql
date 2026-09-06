-- ═══════════════════════════════════════════════════════════════════════
-- CRM DE VENTAS — LOS ÍNDICES DE LA LISTA FILTRADA Y PAGINADA
--
-- SIETE ÍNDICES Y NADA MÁS. Ni una tabla, ni una columna, ni un enum, ni
-- una fila, ni un DROP, ni un ALTER. Sólo toca "crm_prospects", que es
-- una tabla propia del CRM de /admin y de /afiliados/crm.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar TODO → Run. Una sola vez.
-- ADITIVO e idempotente: `IF NOT EXISTS` en los siete. Correrlo dos veces
-- no hace nada la segunda.
--
-- ⚠️ NO ES BLOQUEANTE PARA EL DEPLOY, y conviene saberlo. Aquí no hay
-- ninguna columna nueva que el cliente Prisma vaya a pedir: sin estos
-- índices /admin/crm funciona EXACTAMENTE igual, sólo que Postgres lee
-- más páginas de las necesarias para contestar. Se puede aplicar antes,
-- durante o después del deploy, y también nunca — hasta que la libreta
-- crezca lo suficiente para que se note.
--
-- ⚠️ ESTOS ÍNDICES NO ESTÁN EN prisma/schema.prisma, y es a propósito:
-- el schema es un archivo COMPARTIDO con el dental, el instituto, la
-- barbería y los inmuebles, y esta tarea no lo toca. Es el mismo trato
-- que ya tienen los índices de sql/edu-volumen.sql y los trigram de
-- sql/edu-cierre.sql: viven sólo aquí. La consecuencia hay que saberla —
-- un `prisma db push` contra una base de desarrollo se los llevaría por
-- delante, y se recuperan volviendo a correr este archivo, que para eso
-- es idempotente. En producción no se corre `db push`, así que no se
-- pierden.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas. Los nombres de índice siguen la convención de Prisma
-- (tabla_columnas_idx) para que un futuro `migrate`/`db push` los
-- reconozca como existentes en vez de duplicarlos.
--
-- Nota sobre CONCURRENTLY: NO se usa, a propósito. CONCURRENTLY no puede
-- ir dentro de una transacción y el editor de Supabase envuelve los lotes
-- en una, así que obligaría a siete "Run" separados. Con una libreta de
-- ventas de una persona (miles de filas, no millones) un CREATE INDEX
-- normal tarda milisegundos y el bloqueo de escritura no se nota. Si
-- algún día esta tabla llega a cientos de miles de filas, se corre cada
-- CREATE de abajo en su propio Run añadiéndole la palabra CONCURRENTLY.
--
-- ═══════════════════════════════════════════════════════════════════════
-- QUÉ CAMBIÓ ARRIBA Y POR QUÉ HACEN FALTA
--
-- Hasta ahora /admin/crm se traía hasta 2.000 prospectos completos de
-- una vez y filtraba, ordenaba y paginaba en el navegador. Con eso a la
-- base sólo se le pedían dos cosas: un `count` y un `findMany` ordenado
-- por "updatedAt".
--
-- Ahora filtra, ordena, cuenta y pagina la BASE (ver `crmListar` en
-- src/lib/admin/crm/service.ts). Eso quita el techo de los 2.000 y hace
-- que sólo cruce la red la página que se va a pintar — pero mueve el
-- trabajo a Postgres, y sobre "crm_prospects" sólo había cinco índices de
-- una columna: stage, nextActionAt, vertical, createdAt y affiliateId.
--
-- Los siete de abajo cubren, en este orden de importancia:
--
--   1. LOS TRES CONTADORES DE ARRIBA, que se calculan en CADA carga de la
--      pantalla (vencidos, para hoy, enfriándose) y además el badge del
--      menú lateral de /admin entero (`crmContarPendientes`, que corre en
--      TODAS las páginas de /admin, no sólo en el CRM).
--   2. LOS ÓRDENES que antes no existían: "movidos hace poco"
--      ("updatedAt", que NO tenía índice ni siquiera cuando era el orden
--      por defecto), "más abandonados" ("lastContactAt") y alfabético
--      ("name", que además es el desempate de TODOS los demás órdenes —
--      sin él dos filas con el mismo valor podrían repetirse o saltarse
--      entre la página 1 y la 2).
--   3. EL FILTRO DE FUENTE, que antes no tocaba la base porque se hacía
--      en el navegador.
--
-- SOBRE EL ORDEN DE LAS COLUMNAS EN LOS COMPUESTOS. El criterio es el
-- mismo que ya está escrito en sql/edu-volumen.sql: la IGUALDAD antes que
-- el RANGO. Aquí está al revés a propósito, y por un motivo concreto: el
-- filtro de etapa de estas consultas no es una igualdad sino una NEGACIÓN
-- (`stage NOT IN ('GANADO','PERDIDO')`), y una negación de baja
-- selectividad no sirve como primera columna — no acota nada. Lo que sí
-- acota es el rango de fechas, así que va delante, y "stage" detrás para
-- que la negación se resuelva dentro del propio índice sin ir a la tabla.
--
-- La alternativa era un índice PARCIAL con `WHERE stage NOT IN (...)`.
-- Sería un pelo más pequeño, pero se queda obsoleto en silencio: el
-- catálogo de etapas es TEXT y se retoca desde TypeScript (ver el
-- comentario de crm-core.ts), así que el día que se añada una etapa
-- terminal la condición del índice dejaría de coincidir con la de la
-- consulta y Postgres lo descartaría sin avisar. Se prefiere el
-- compuesto: no se puede quedar desalineado.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Los seguimientos: vencidos, de hoy, y el orden "por atender" ────
-- Sirve a la vez a:
--   · el contador de vencidos      → nextActionAt <  <arranque de hoy>
--   · el contador de "para hoy"    → nextActionAt >= <hoy> AND < <mañana>
--   · la tarjeta "Hoy toca"        → ... ORDER BY "nextActionAt" ASC
--   · el orden por defecto de la lista ("Por atender")
--   · `crmContarPendientes`, el badge del menú de TODO /admin
-- El rango va primero (ver arriba); "stage" detrás resuelve la negación
-- sin bajar a la tabla.
CREATE INDEX IF NOT EXISTS "crm_prospects_nextActionAt_stage_idx"
  ON "crm_prospects" ("nextActionAt", "stage");


-- ── 2. Los que se están enfriando ──────────────────────────────────────
-- El contador de "Enfriándose" (lastContactAt < hoy − 13 días, abiertos)
-- y el orden "Más abandonados". Mismo criterio de columnas que el #1.
-- Ojo con lo que NO cubre: "nunca contactados" es `lastContactAt IS NULL`
-- y ése sí lo resuelve este mismo índice, porque un B-tree de Postgres
-- indexa los NULL.
-- El NULLS FIRST no es decoración: un B-tree normal es ASC NULLS LAST, y
-- el orden "Más abandonados" pide `ORDER BY "lastContactAt" ASC NULLS
-- FIRST` (el que nunca se contactó va arriba, ver orderByDeOrden). Sin
-- que el índice esté construido en ESE orden, Postgres no lo puede usar
-- para ordenar y se come una ordenación completa de la tabla. Para los
-- contadores (`< limite` y `IS NULL`) daría igual; para el orden, no.
CREATE INDEX IF NOT EXISTS "crm_prospects_lastContactAt_stage_idx"
  ON "crm_prospects" ("lastContactAt" ASC NULLS FIRST, "stage");


-- ── 3. "Movidos hace poco" ─────────────────────────────────────────────
-- "updatedAt" era el orden POR DEFECTO de la lista desde el primer día y
-- nunca tuvo índice: cada carga de /admin/crm ordenaba la tabla entera
-- para quedarse con las primeras filas. Ya no es el defecto, pero sigue
-- siendo uno de los seis órdenes que se ofrecen.
CREATE INDEX IF NOT EXISTS "crm_prospects_updatedAt_idx"
  ON "crm_prospects" ("updatedAt");


-- ── 4. Alfabético ──────────────────────────────────────────────────────
-- El orden "Nombre (A-Z)".
--
-- Lo que este índice NO hace, para que no se le pida: no sirve como
-- segundo criterio de los otros órdenes. Un índice de una sola columna
-- nunca puede resolver un desempate; eso lo hace un nodo de ordenación
-- incremental. Y el desempate que de verdad importa —el que evita que una
-- fila se repita en la página 1 y falte en la 2— no es el nombre sino el
-- ID, que va el último en TODOS los órdenes (ver orderByDeOrden en
-- service.ts y cmpId en crm-core.ts): el nombre no es único, y dos
-- "Clínica Dental Sonrisa" empatarían hasta el final.
CREATE INDEX IF NOT EXISTS "crm_prospects_name_idx"
  ON "crm_prospects" ("name");


-- ── 5. El filtro de fuente ─────────────────────────────────────────────
-- De dónde salió el prospecto (Google Maps, Instagram, referido…). Antes
-- este filtro se resolvía en el navegador sobre las filas ya cargadas;
-- ahora es un WHERE.
CREATE INDEX IF NOT EXISTS "crm_prospects_source_idx"
  ON "crm_prospects" ("source");


-- ── 6. "Mayor valor" ───────────────────────────────────────────────────
-- `ORDER BY "monthlyValue" DESC NULLS LAST, "name" ASC, "id" ASC`. Es el
-- orden con los grupos de empate MÁS grandes de todos —el valor mensual
-- está sin poner en la mayoría de las filas, y todas ellas empatan— y por
-- tanto el que más caro sale de ordenar a mano. Las tres columnas van en
-- el índice, y en el mismo sentido que la consulta, para que Postgres
-- pueda leer la página ya ordenada en vez de ordenar la tabla entera.
CREATE INDEX IF NOT EXISTS "crm_prospects_monthlyValue_name_id_idx"
  ON "crm_prospects" ("monthlyValue" DESC NULLS LAST, "name" ASC, "id" ASC);


-- ── 7. Las recomendaciones de socios sin contactar ─────────────────────
-- El aviso de arriba de la pantalla (`affiliateId IS NOT NULL AND stage =
-- 'NUEVO'`), agrupado por socio. Aquí SÍ manda la igualdad primero,
-- porque "affiliateId" es muy selectivo y "stage" es una igualdad de
-- verdad, no una negación.
--
-- De regalo cubre también dos consultas del panel del afiliado
-- (src/lib/affiliates/crm.ts): la lista de un socio y su resumen por
-- etapa, que hoy tiran del índice de una sola columna.
CREATE INDEX IF NOT EXISTS "crm_prospects_affiliateId_stage_idx"
  ON "crm_prospects" ("affiliateId", "stage");


-- ═══════════════════════════════════════════════════════════════════════
-- Verificación post-aplicación: tiene que devolver SIETE filas.
-- ═══════════════════════════════════════════════════════════════════════
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'crm_prospects'
  AND indexname IN (
    'crm_prospects_nextActionAt_stage_idx',
    'crm_prospects_lastContactAt_stage_idx',
    'crm_prospects_updatedAt_idx',
    'crm_prospects_name_idx',
    'crm_prospects_source_idx',
    'crm_prospects_monthlyValue_name_id_idx',
    'crm_prospects_affiliateId_stage_idx'
  )
ORDER BY indexname;
