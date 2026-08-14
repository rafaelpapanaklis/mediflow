-- ═══════════════════════════════════════════════════════════════════
-- Inbox — enlazar los hilos de WhatsApp HUÉRFANOS con su paciente
--
-- QUÉ ARREGLA: `inbox_threads."patientId"` en NULL en conversaciones que sí
-- son de un paciente registrado. El enlace hilo↔paciente solo se intentaba al
-- CREAR el hilo (webhook de Meta), así que si el paciente se dio de alta
-- DESPUÉS de que empezara la conversación —o si su teléfono se corrigió más
-- tarde— el hilo se quedaba sin paciente para siempre. Consecuencia visible:
-- la ficha del paciente y el Inbox filtrado por paciente salían VACÍOS aunque
-- la conversación estuviera ahí, en la lista general.
--
-- POR QUÉ HACE FALTA ADEMÁS DEL CÓDIGO: el panel ya se auto-repara con el uso
-- (`linkOrphanThreadsToPatient` en src/lib/whatsapp/inbox-log.ts escribe el
-- enlace la primera vez que alguien abre la ficha de ese paciente). Este
-- script hace de una sola vez lo que ese camino haría poco a poco, para que
-- los informes y las consultas por `patientId` que NO pasan por la ficha
-- (analítica, exportaciones, futuros crons) vean los datos ya corregidos.
--
-- QUÉ **NO** HACE:
--   · NO toca hilos que ya tienen paciente (ni para "corregirlo"): un enlace
--     existente lo puso alguien o el webhook con más contexto del que hay aquí.
--   · NO toca hilos de otro canal (EMAIL, PORTAL, …): el emparejamiento por
--     teléfono solo tiene sentido en WHATSAPP.
--   · NO enlaza cuando DOS o más pacientes de la clínica comparten el número
--     (hermanos con el celular de la mamá). Enlazar mal es PEOR que dejarlo
--     huérfano: metería la conversación de uno en la ficha del otro, y lo
--     huérfano se sigue viendo igual porque la interfaz también busca por
--     teléfono. Esos casos se listan en el bloque (2) para revisarlos a mano.
--   · NO toca los hilos cuyo número es el de la PROPIA clínica. Los avisos
--     internos de la plataforma (solicitud de cita nueva, saldo de IA, cobros)
--     se mandan por WhatsApp al teléfono de la clínica y hablan de OTROS
--     pacientes ("Nueva solicitud de cita · <nombre> · <teléfono>"). Si ese
--     número está además en la ficha de alguien —el propio doctor dado de alta
--     como paciente, o ese número usado de relleno—, enlazarlo metería datos de
--     terceros dentro de su expediente.
--   · NO crea hilos ni mensajes, ni borra nada.
--
-- IDEMPOTENTE: el UPDATE filtra por `"patientId" IS NULL`, así que la segunda
-- corrida no encuentra nada que escribir (UPDATE 0). Seguro de re-correr.
--
-- CÓMO SE USA: en el SQL Editor de Supabase, un bloque por Run y EN ORDEN.
-- Sustituye ANTES TODAS las apariciones de 'CLINIC_ID_AQUI' por el id real
-- (Ctrl+H / "Replace all" sobre el archivo entero: son 10 dentro de las
-- consultas, más esta de aquí, que da igual). El id de la clínica sale de:
--
--   SELECT id, name, slug FROM "clinics" ORDER BY name;
--
-- ...o de la URL de la clínica en /admin, que lleva ese mismo id.
--
-- ⚠️ UNA CLÍNICA POR CORRIDA. Si hay que arreglar varias, repite el script
-- cambiando el id; NO quites el filtro por "clinicId" para hacerlas todas de
-- golpe: sin él, un teléfono de la clínica A emparejaría con un paciente de
-- la clínica B y se rompería el aislamiento multi-tenant.
--
-- CRITERIO DE EMPAREJAMIENTO (el MISMO que el código, `normalizeLast10` en
-- src/lib/whatsapp/bot/booking-parse.ts): se quitan TODOS los caracteres que
-- no son dígito de los dos lados y se comparan los ÚLTIMOS 10. Se exige que
-- queden al menos 10 dígitos: con menos no hay nada que comparar y un
-- `right(...)` devolvería una cadena corta que casaría con cualquier cosa.
-- Los 10 finales y no el número entero porque el paciente se guarda como
-- "55 1234 5678" y Meta manda "521 55 1234 5678": mismo teléfono, distinta
-- cadena. Si este criterio cambia aquí y no allá (o al revés), el script y el
-- panel enlazarían cosas distintas.
--
-- Tablas: Prisma mapea InboxThread → "inbox_threads" y Patient → "patients"
-- (@@map), pero las COLUMNAS van en camelCase entre comillas dobles.
-- ═══════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- (1) DIAGNÓSTICO — qué se va a enlazar. NO escribe nada.
--     Cada fila es un hilo huérfano con el ÚNICO paciente que tiene ese
--     número. Revisa un par de nombres contra el teléfono antes de seguir.
--     Si devuelve 0 filas, no hay nada que arreglar: salta al bloque (4).
-- ────────────────────────────────────────────────────────────────────────────
WITH huerfanos AS (
  SELECT
    t.id,
    t."externalId",
    t."lastMessageAt",
    -- NULL cuando no llegan a 10 dígitos: así el JOIN por igualdad los
    -- descarta solo, sin poder casar con nadie.
    CASE
      WHEN length(regexp_replace(coalesce(t."externalId", ''), '[^0-9]', '', 'g')) >= 10
      THEN right(regexp_replace(t."externalId", '[^0-9]', '', 'g'), 10)
    END AS last10
  FROM "inbox_threads" t
  WHERE t."clinicId"  = 'CLINIC_ID_AQUI'
    AND t."channel"   = 'WHATSAPP'
    AND t."patientId" IS NULL
    -- El número de la PROPIA clínica queda fuera (ver la nota del encabezado).
    AND NOT EXISTS (
      SELECT 1
      FROM "clinics" c
      WHERE c.id = 'CLINIC_ID_AQUI'
        AND c.phone IS NOT NULL
        AND length(regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 10
        AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
          = right(regexp_replace(coalesce(t."externalId", ''), '[^0-9]', '', 'g'), 10)
    )
),
pacientes AS (
  SELECT
    p.id,
    p."firstName",
    p."lastName",
    p.phone,
    right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10) AS last10
  FROM "patients" p
  WHERE p."clinicId" = 'CLINIC_ID_AQUI'
    AND p.phone IS NOT NULL
    AND length(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 10
),
-- Teléfonos con UN ÚNICO dueño en la clínica. El HAVING count(*) = 1 es la
-- regla entera: es lo que hace que el enlace sea inequívoco.
unicos AS (
  SELECT last10, min(id) AS patient_id
  FROM pacientes
  GROUP BY last10
  HAVING count(*) = 1
)
SELECT
  h.id                                  AS hilo_id,
  h."externalId"                        AS telefono_del_hilo,
  h."lastMessageAt"                     AS ultimo_mensaje,
  p.id                                  AS paciente_id,
  p."firstName" || ' ' || p."lastName"  AS paciente,
  p.phone                               AS telefono_del_paciente
FROM huerfanos h
JOIN unicos    u ON u.last10 = h.last10
JOIN pacientes p ON p.id     = u.patient_id
ORDER BY h."lastMessageAt" DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- (2) LOS QUE **NO** SE VAN A TOCAR, y por qué. Tampoco escribe nada.
--     Estos hilos seguirán con "patientId" en NULL después del UPDATE:
--       · AMBIGUO      → varios pacientes comparten ese número. Hay que
--                        decidir a mano de quién es la conversación (o
--                        corregir el teléfono de uno de los pacientes y
--                        volver a correr el bloque (1)).
--       · SIN PACIENTE → nadie en la clínica tiene ese número: proveedor,
--                        spam o un paciente que aún no está dado de alta.
--       · SIN TELÉFONO → el hilo no guarda 10 dígitos con los que comparar.
--     Los dos últimos son NORMALES; el que hay que mirar es AMBIGUO.
-- ────────────────────────────────────────────────────────────────────────────
WITH huerfanos AS (
  SELECT
    t.id,
    t."externalId",
    t."lastMessageAt",
    CASE
      WHEN length(regexp_replace(coalesce(t."externalId", ''), '[^0-9]', '', 'g')) >= 10
      THEN right(regexp_replace(t."externalId", '[^0-9]', '', 'g'), 10)
    END AS last10
  FROM "inbox_threads" t
  WHERE t."clinicId"  = 'CLINIC_ID_AQUI'
    AND t."channel"   = 'WHATSAPP'
    AND t."patientId" IS NULL
    -- El número de la PROPIA clínica queda fuera (ver la nota del encabezado).
    AND NOT EXISTS (
      SELECT 1
      FROM "clinics" c
      WHERE c.id = 'CLINIC_ID_AQUI'
        AND c.phone IS NOT NULL
        AND length(regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 10
        AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
          = right(regexp_replace(coalesce(t."externalId", ''), '[^0-9]', '', 'g'), 10)
    )
),
pacientes AS (
  SELECT
    p.id,
    p."firstName",
    p."lastName",
    p.phone,
    right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10) AS last10
  FROM "patients" p
  WHERE p."clinicId" = 'CLINIC_ID_AQUI'
    AND p.phone IS NOT NULL
    AND length(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 10
)
SELECT
  h.id              AS hilo_id,
  h."externalId"    AS telefono_del_hilo,
  h."lastMessageAt" AS ultimo_mensaje,
  CASE
    WHEN h.last10 IS NULL THEN 'SIN TELÉFONO — el hilo no tiene 10 dígitos'
    WHEN (SELECT count(*) FROM pacientes p WHERE p.last10 = h.last10) = 0
      THEN 'SIN PACIENTE — nadie en la clínica tiene ese número'
    ELSE 'AMBIGUO — varios pacientes comparten ese número'
  END AS motivo,
  (
    SELECT string_agg(
             p."firstName" || ' ' || p."lastName" || ' (' || p.id || ')',
             ' · ' ORDER BY p."firstName", p."lastName"
           )
    FROM pacientes p
    WHERE p.last10 = h.last10
  ) AS candidatos
FROM huerfanos h
WHERE h.last10 IS NULL
   OR (SELECT count(*) FROM pacientes p WHERE p.last10 = h.last10) <> 1
ORDER BY motivo, h."lastMessageAt" DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- (3) EL ARREGLO. Corre ANTES el bloque (1) y mira lo que va a escribir:
--     este UPDATE hace exactamente eso y nada más.
--     TODO el bloque en UN solo Run (va dentro de la transacción).
--     Debe reportar tantas filas como devolvió (1).
-- ────────────────────────────────────────────────────────────────────────────
BEGIN;

WITH pacientes AS (
  SELECT
    p.id,
    right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10) AS last10
  FROM "patients" p
  WHERE p."clinicId" = 'CLINIC_ID_AQUI'
    AND p.phone IS NOT NULL
    AND length(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 10
),
unicos AS (
  SELECT last10, min(id) AS patient_id
  FROM pacientes
  GROUP BY last10
  HAVING count(*) = 1
)
UPDATE "inbox_threads" t
-- A PROPÓSITO no se toca `updatedAt`. En esta tabla esa columna NO es solo
-- rastro: el header del Inbox la usa como sustituto de un `resolvedAt` que no
-- existe para contar "resueltos hoy"
-- (GET /api/inbox/threads?include=stats → status ARCHIVED + updatedAt >= hoy).
-- Los hilos huérfanos más antiguos son justo los que suelen estar ARCHIVED, así
-- que refrescarles la fecha haría que esa misma tarde el panel reportara como
-- resueltas hoy conversaciones cerradas hace meses — y la fecha original ya no
-- se podría recuperar. El rastro del arreglo es el propio "patientId".
SET "patientId" = u.patient_id
FROM unicos u
WHERE t."clinicId"  = 'CLINIC_ID_AQUI'
  AND t."channel"   = 'WHATSAPP'
  -- Esta condición es la que hace el script IDEMPOTENTE y la que impide
  -- pisar un enlace que ya existe. NO la quites.
  AND t."patientId" IS NULL
  AND t."externalId" IS NOT NULL
  AND length(regexp_replace(t."externalId", '[^0-9]', '', 'g')) >= 10
  AND right(regexp_replace(t."externalId", '[^0-9]', '', 'g'), 10) = u.last10
  -- Mismo descarte que en los bloques (1) y (2): el número de la propia clínica.
  AND NOT EXISTS (
    SELECT 1
    FROM "clinics" c
    WHERE c.id = 'CLINIC_ID_AQUI'
      AND c.phone IS NOT NULL
      AND length(regexp_replace(c.phone, '[^0-9]', '', 'g')) >= 10
      AND right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
        = right(regexp_replace(t."externalId", '[^0-9]', '', 'g'), 10)
  );

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- (4) VERIFICACIÓN. Cuántos hilos de WhatsApp de la clínica siguen sin
--     paciente. No tiene por qué dar 0: ahí quedan los AMBIGUOS y los que no
--     corresponden a ningún paciente (bloque (2)). Lo que SÍ tiene que pasar
--     es que `sin_paciente` haya bajado justo en las filas que reportó (3), y
--     que volver a correr el bloque (1) devuelva 0 filas.
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  count(*)                                          AS hilos_whatsapp,
  count(*) FILTER (WHERE "patientId" IS NOT NULL)   AS con_paciente,
  count(*) FILTER (WHERE "patientId" IS NULL)       AS sin_paciente
FROM "inbox_threads"
WHERE "clinicId" = 'CLINIC_ID_AQUI'
  AND "channel"  = 'WHATSAPP';
