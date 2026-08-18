-- ─────────────────────────────────────────────────────────────────────────────
-- PAC-01 · ¿A cuántos pacientes les borró ya "Editar paciente" los arrays?
--
-- SOLO LECTURA. No hay un solo INSERT/UPDATE/DELETE en este archivo. Se puede
-- pegar entero en el editor SQL de Supabase sin miedo.
--
-- QUÉ PASABA: el PUT de /api/patients/[id] hacía patientSchema.parse(body) y
-- esparcía el resultado sobre el update. Los cuatro arrays del schema llevan
-- .default([]), así que zod los RELLENABA con [] cuando el body no los traía y
-- Prisma los escribía vacíos. Corregir un teléfono borraba padecimientos
-- crónicos y medicación actual.
--
-- POR QUÉ LA BITÁCORA Y NO EL ESTADO ACTUAL: el propio PUT llama a logMutation
-- con before/after (src/lib/audit.ts), y diffObjects guarda en audit_logs.changes
-- SOLO los campos que cambiaron, como { campo: { before, after } }. Entonces:
--
--     existe la clave 'chronicConditions' en changes  →  el campo CAMBIÓ
--     y su 'after' es []                              →  quedó vacío
--     ⇒ su 'before' era NO vacío  ⇒  se borró contenido real.
--
-- Eso es exacto, no una estimación: no hace falta adivinar mirando updatedAt.
-- La consulta 4 es el plan B por si la bitácora se hubiera podado alguna vez.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ 1 · EL NÚMERO: cuántos pacientes y cuántas clínicas ═════════════════════
-- Una fila por clínica. `pacientes_afectados` es lo que hay que contarle al
-- usuario; `ediciones_que_borraron` es cuántas veces pasó (un mismo paciente
-- puede haber sido editado varias veces).

SELECT
  a."clinicId",
  c.name                                                   AS clinica,
  count(DISTINCT a."entityId")                              AS pacientes_afectados,
  count(*)                                                  AS ediciones_que_borraron,
  min(a."createdAt")::date                                  AS primera_vez,
  max(a."createdAt")::date                                  AS ultima_vez
FROM audit_logs a
JOIN clinics c ON c.id = a."clinicId"
WHERE a."entityType" = 'patient'
  AND a.action       = 'update'
  AND (
       a.changes -> 'chronicConditions'  ->> 'after' = '[]'
    OR a.changes -> 'currentMedications' ->> 'after' = '[]'
    OR a.changes -> 'allergies'          ->> 'after' = '[]'
    OR a.changes -> 'tags'               ->> 'after' = '[]'
  )
GROUP BY a."clinicId", c.name
ORDER BY pacientes_afectados DESC;


-- ══ 2 · DESGLOSE POR CAMPO: qué se perdió, campo a campo ════════════════════
-- Lo importante clínicamente son chronicConditions y currentMedications: son
-- las dos que lee el chequeo de contraindicaciones al recetar. `tags` es CRM y
-- `allergies` sí está en el modal, así que se espera que aparezca poco.

SELECT
  campo,
  count(DISTINCT "entityId") AS pacientes,
  count(*)                    AS veces
FROM (
  SELECT a."entityId", k.campo
  FROM audit_logs a
  CROSS JOIN LATERAL (
    VALUES ('chronicConditions'), ('currentMedications'), ('allergies'), ('tags')
  ) AS k(campo)
  WHERE a."entityType" = 'patient'
    AND a.action       = 'update'
    AND a.changes -> k.campo ->> 'after' = '[]'
) t
GROUP BY campo
ORDER BY pacientes DESC;


-- ══ 3 · LA LISTA: qué pacientes concretos, y qué decía antes ════════════════
-- Para poder mirar casos reales y, si hace falta, restaurar a mano desde el
-- `before` que la bitácora conservó. Ordenado por lo más reciente.
-- El paciente puede haber sido editado varias veces: se muestra cada edición.

SELECT
  a."createdAt"                                  AS cuando,
  c.name                                         AS clinica,
  p."patientNumber"                              AS folio,
  p."firstName" || ' ' || p."lastName"           AS paciente,
  u."firstName" || ' ' || u."lastName"           AS lo_edito,
  a.changes -> 'chronicConditions'  -> 'before'  AS cronicos_antes,
  a.changes -> 'currentMedications' -> 'before'  AS medicacion_antes,
  a.changes -> 'allergies'          -> 'before'  AS alergias_antes,
  a.changes -> 'tags'               -> 'before'  AS etiquetas_antes,
  a."entityId"                                   AS patient_id
FROM audit_logs a
JOIN clinics  c ON c.id = a."clinicId"
LEFT JOIN patients p ON p.id = a."entityId"
LEFT JOIN users    u ON u.id = a."userId"
WHERE a."entityType" = 'patient'
  AND a.action       = 'update'
  AND (
       a.changes -> 'chronicConditions'  ->> 'after' = '[]'
    OR a.changes -> 'currentMedications' ->> 'after' = '[]'
    OR a.changes -> 'allergies'          ->> 'after' = '[]'
    OR a.changes -> 'tags'               ->> 'after' = '[]'
  )
ORDER BY a."createdAt" DESC
LIMIT 500;


-- ══ 4 · PLAN B (sin bitácora): cota SUPERIOR por estado actual ══════════════
-- Solo si la 1 devuelve 0 filas y hay motivo para dudar de la bitácora. Esto NO
-- es el número de afectados: es "pacientes editados alguna vez después del alta
-- que HOY tienen los cuatro arrays vacíos". Un paciente que de verdad no tiene
-- alergias ni padecimientos entra aquí igual, así que sobreestima. La 1 es la
-- buena.

SELECT
  count(*)                                                  AS pacientes_sospechosos,
  count(DISTINCT "clinicId")                                AS clinicas
FROM patients
WHERE "updatedAt" > "createdAt" + interval '1 minute'
  AND cardinality(allergies)          = 0
  AND cardinality("chronicConditions") = 0
  AND cardinality("currentMedications") = 0
  AND cardinality(tags)                = 0
  AND "deletedAt" IS NULL;
