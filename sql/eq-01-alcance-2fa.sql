-- ─────────────────────────────────────────────────────────────────────────────
-- EQ-01 · ¿A cuánta gente le cambia la vida el gate de 2FA en /api?
--
-- SOLO LECTURA. No hay un solo INSERT/UPDATE/DELETE. Se puede pegar entero en el
-- editor SQL de Supabase.
--
-- POR QUÉ ESTE SQL: el gate nuevo exige la cookie df_2fa en las rutas /api. Si
-- aplicara a quien NO tiene 2FA configurado, dejaría a la mayoría de los usuarios
-- fuera de su propio panel — es exactamente el fallo que rompió el tab de
-- consentimientos con permissionsOverride.
--
-- Por diseño eso no puede pasar: `needsTwoFactor()` devuelve false cuando
-- totpEnabled = false y la clínica no tiene require2fa, y en ese caso el gate ni
-- se consulta (hay un test que lo fija: "quien NO tiene 2FA configurado no queda
-- fuera de su panel"). Estas consultas son para VERLO en los datos reales, no
-- para confiar en la afirmación.
--
-- La consulta 1 es el número que importa: cuántos usuarios cambian de
-- comportamiento. Si sale 0, el gate no altera a NADIE hoy y solo protege desde
-- el momento en que alguien active su 2FA.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ 1 · EL NÚMERO: a quién le aplica el gate ════════════════════════════════
-- `afectados` = usuarios a los que el gate SÍ va a exigir la cookie.
-- `intactos`  = usuarios para los que no cambia absolutamente nada.

SELECT
  count(*)                                                              AS usuarios_activos_total,
  count(*) FILTER (WHERE u."totpEnabled")                               AS con_2fa_enrolado,
  count(*) FILTER (WHERE NOT u."totpEnabled" AND c."require2fa")         AS obligados_a_enrolar,
  count(*) FILTER (WHERE u."totpEnabled" OR c."require2fa")              AS afectados_por_el_gate,
  count(*) FILTER (WHERE NOT u."totpEnabled" AND NOT c."require2fa")     AS intactos
FROM users u
JOIN clinics c ON c.id = u."clinicId"
WHERE u."isActive";


-- ══ 2 · CLÍNICAS QUE EXIGEN 2FA ═════════════════════════════════════════════
-- El caso a mirar con lupa es `sin_enrolar > 0`: esos usuarios quedan con acceso
-- SOLO a /api/auth hasta que completen el enrolamiento. No es una regresión —el
-- layout de /dashboard ya los manda hoy a /dashboard/2fa/setup y no pueden usar
-- el panel—, pero conviene saber a quién le va a pasar.

SELECT
  c.id                                                     AS clinic_id,
  c.name                                                   AS clinica,
  c."require2fa"                                           AS exige_2fa,
  count(u.id)                                              AS usuarios_activos,
  count(u.id) FILTER (WHERE u."totpEnabled")                AS ya_enrolados,
  count(u.id) FILTER (WHERE NOT u."totpEnabled")            AS sin_enrolar
FROM clinics c
LEFT JOIN users u ON u."clinicId" = c.id AND u."isActive"
WHERE c."require2fa"
GROUP BY c.id, c.name, c."require2fa"
ORDER BY sin_enrolar DESC, clinica;


-- ══ 3 · LOS USUARIOS CON 2FA, UNO POR UNO ═══════════════════════════════════
-- La lista corta de quién va a tener que teclear su código al entrar. Si aquí
-- aparece alguien sin códigos de recuperación, es el que se va a quedar fuera si
-- pierde el teléfono: `codigos_recuperacion = 0` merece un aviso.

SELECT
  c.name                                   AS clinica,
  u."firstName" || ' ' || u."lastName"     AS usuario,
  u.email,
  u.role,
  u."totpEnabled"                          AS tiene_2fa,
  c."require2fa"                           AS clinica_lo_exige,
  cardinality(u."recoveryCodes")           AS codigos_recuperacion
FROM users u
JOIN clinics c ON c.id = u."clinicId"
WHERE u."isActive"
  AND (u."totpEnabled" OR c."require2fa")
ORDER BY c.name, u."lastName";


-- ══ 4 · CONTROL: multi-sede con 2FA desigual ════════════════════════════════
-- La cookie df_2fa está atada al par (persona, clínica), así que quien tenga
-- varias sedes tendrá que pasar el reto UNA VEZ POR SEDE. Y ojo: totpEnabled es
-- por FILA de users, o sea POR MEMBRESÍA, no por persona. Alguien puede tener 2FA
-- en una sede y no en la otra, y en la sede sin 2FA entra sin segundo factor —
-- comportamiento que ya existía (el layout hace el mismo chequeo por membresía),
-- pero que conviene ver por si conviene igualarlo.

SELECT
  u."supabaseId",
  min(u.email)                                    AS email,
  count(*)                                        AS membresias_activas,
  count(*) FILTER (WHERE u."totpEnabled")          AS con_2fa,
  count(*) FILTER (WHERE NOT u."totpEnabled")      AS sin_2fa,
  string_agg(c.name || CASE WHEN u."totpEnabled" THEN ' [2FA]' ELSE ' [sin 2FA]' END, ', '
             ORDER BY c.name)                     AS detalle
FROM users u
JOIN clinics c ON c.id = u."clinicId"
WHERE u."isActive"
GROUP BY u."supabaseId"
HAVING count(*) > 1
   AND count(*) FILTER (WHERE u."totpEnabled") > 0
   AND count(*) FILTER (WHERE NOT u."totpEnabled") > 0
ORDER BY membresias_activas DESC;
