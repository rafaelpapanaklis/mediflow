-- ─────────────────────────────────────────────────────────────────────────────
-- EQ-01 (bis) · ¿Hay que rotar los `totpSecret` después de la fuga de
--               PATCH /api/users/me?  — 2026-09-06
--
-- ⚠️ PENDIENTE — REQUIERE RAFAEL. Las consultas 1 a 3 son SOLO LECTURA y se
--    pueden pegar tal cual en el editor SQL de Supabase. El bloque 4 ESCRIBE y
--    está comentado a propósito: apaga el segundo factor de gente real y no se
--    corre sin decidirlo antes. Ninguna terminal aplica esto.
--
-- ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
-- PATCH /api/users/me resolvía la sesión con una copia local de getDbUser
-- (createClient + prisma.user.findFirst) que NO pasaba por getAuthContext, donde
-- vive el gate autoritativo de 2FA. Y su `prisma.user.update` iba sin `select`,
-- así que respondía la fila ENTERA de `users`:
--
--     totpSecret            ← el secret base32 del segundo factor, EN CLARO
--     recoveryCodes         ← hashes bcrypt de los códigos de rescate
--     cajaPinHash           ← hash bcrypt del PIN de Caja
--     googleRefreshToken / googleCalendarToken
--     stripeAccountId
--
-- Dos vías de exposición, y solo la segunda es un ataque:
--
--   (a) El "Guardar" de Ajustes llama a esta ruta. O sea: TODO el que guardó su
--       perfil tuvo su propio secret en su propio navegador — pestaña Red, caché
--       y al alcance de cualquier extensión instalada. Es el secreto de esa misma
--       persona, así que por sí solo no le da acceso a nadie más.
--
--   (b) Quien tuviera SOLO la contraseña podía hacer signInWithPassword contra
--       Supabase fuera del navegador (así no se siembra df_2fa_pending y el
--       fast-path del middleware no ve nada), mandar PATCH /api/users/me con
--       cuerpo `{}` —los cuatro campos quedan undefined, Prisma los descarta, el
--       update es un no-op— y recibir 200 con el secret. Con eso genera códigos
--       TOTP válidos y entra: /api/auth/2fa/verify solo hace authenticator.check.
--       El segundo factor de esa persona deja de valer.
--
-- ── LA RECOMENDACIÓN, Y SU LETRA PEQUEÑA ────────────────────────────────────
-- No hay forma de saber si (b) ocurrió: la ruta no dejaba bitácora (no llama a
-- logMutation) y un 200 legítimo de Ajustes es idéntico a uno del ataque. Lo
-- único que se puede afirmar es que quien haya perdido su contraseña perdió
-- también su segundo factor.
--
-- "Rotar" un totpSecret NO es cambiarlo por otro en silencio: el secret vive en
-- la app del teléfono, así que rotar = FORZAR UN RE-ENROLAMIENTO. La persona
-- vuelve a escanear el QR. Eso tiene coste operativo real y por eso lo decide
-- Rafael, no esta terminal.
--
-- Y hay un detalle que cambia el resultado según la clínica:
--   · clinics.require2fa = true  → al siguiente login el layout manda a
--     /dashboard/2fa/setup y no hay pérdida de protección: re-enrola o no entra.
--   · clinics.require2fa = false → apagarle el 2FA lo deja SIN segundo factor y
--     sin que nadie le avise. Si el suyo estaba comprometido, mejor; si no lo
--     estaba, acabas de bajarle la seguridad. Para estos conviene avisar antes
--     por WhatsApp y correr el bloque 4 acotado a quien conteste.
--
-- Tercer detalle, y es el que se olvida: la cookie df_2fa vale 12 h
-- (TWO_FA_OK_MAX_AGE_SECONDS). Una sesión que ya pasó el reto sigue trabajando
-- hasta que caduque, aunque le hayas borrado el secret. Si la rotación es por
-- una sospecha concreta, además hay que cambiar la contraseña de esa persona en
-- Supabase Auth para cortar la sesión de raíz.
-- ─────────────────────────────────────────────────────────────────────────────


-- ══ 1 · EL NÚMERO: ¿a cuánta gente afectaría rotar? ══════════════════════════
-- Si `con_2fa` sale 0, no hay nada que rotar y la decisión se acabó aquí.

SELECT
  count(*)                                                      AS usuarios_activos,
  count(*) FILTER (WHERE u."totpEnabled")                        AS con_2fa,
  count(*) FILTER (WHERE u."totpEnabled" AND c."require2fa")      AS con_2fa_y_clinica_lo_exige,
  count(*) FILTER (WHERE u."totpEnabled" AND NOT c."require2fa")  AS con_2fa_pero_voluntario,
  count(DISTINCT u."supabaseId") FILTER (WHERE u."totpEnabled")   AS personas_distintas_con_2fa
FROM users u
JOIN clinics c ON c.id = u."clinicId"
WHERE u."isActive";


-- ══ 2 · QUIÉNES SON, PARA PODER AVISARLES ═══════════════════════════════════
-- Por PERSONA (supabaseId), no por fila: una persona tiene una fila `users` por
-- clínica y el 2FA se resuelve por persona (EQ-02). `sedes` dice a cuántas
-- afecta. No selecciona ningún secreto: no hace falta verlos para decidir.

SELECT
  u."supabaseId",
  min(u.email)                                        AS email,
  min(u."firstName" || ' ' || u."lastName")           AS nombre,
  count(*)                                            AS sedes,
  string_agg(DISTINCT c.name, ', ')                   AS clinicas,
  bool_or(c."require2fa")                             AS alguna_clinica_lo_exige,
  max(u."lastLogin")                                  AS ultimo_login
FROM users u
JOIN clinics c ON c.id = u."clinicId"
WHERE u."isActive" AND u."totpEnabled"
GROUP BY u."supabaseId"
ORDER BY ultimo_login DESC NULLS LAST;


-- ══ 3 · LOS OTROS CUATRO SECRETOS QUE IBAN EN LA MISMA RESPUESTA ════════════
-- Para dimensionar el resto de la limpieza. Cuenta, no contenido.
--
--   · cajaPinHash        — es un bcrypt de 6 dígitos, no el PIN. Sale caro de
--                          romper pero un PIN de 6 dígitos es fuerza bruta
--                          barata offline: conviene que lo cambien desde Caja.
--   · googleRefreshToken / googleCalendarToken — estos SÍ son credenciales
--                          vivas. Se revocan desconectando y reconectando
--                          Google Calendar desde Ajustes (o desde la consola de
--                          Google). Eso es un clic de Rafael / del usuario, no
--                          SQL: borrar la columna deja el token vivo del lado
--                          de Google.
--   · stripeAccountId    — es un identificador (acct_…), no una credencial. No
--                          se rota; no abre nada por sí solo.

SELECT
  count(*) FILTER (WHERE u."cajaPinHash" IS NOT NULL)         AS con_pin_de_caja,
  count(*) FILTER (WHERE u."googleRefreshToken" IS NOT NULL)   AS con_refresh_de_google,
  count(*) FILTER (WHERE u."googleCalendarToken" IS NOT NULL)  AS con_token_de_calendario,
  count(*) FILTER (WHERE u."stripeAccountId" IS NOT NULL)      AS con_cuenta_stripe
FROM users u
WHERE u."isActive";


-- ══ 4 · LA ROTACIÓN — COMENTADA. DESCOMENTAR SOLO SI SE DECIDE ══════════════
--
-- Apaga el segundo factor y borra el secret y los códigos de rescate de las
-- personas elegidas. A partir de ese momento:
--   · /dashboard/2fa/setup les genera un secret NUEVO (setup exige totpEnabled
--     = false, por eso hay que apagarlo, no solo borrar el secret);
--   · si su clínica tiene require2fa, el layout las manda ahí en el siguiente
--     login y no pueden usar el panel hasta re-enrolar.
--
-- ⚠️ POR PERSONA, NO POR FILA. El 2FA se resuelve mirando TODAS las filas de la
--    persona (dosFactoresDeLaPersona). Si borras el secret de una sede y dejas
--    la hermana puesta, la persona sigue enrolada y encima con el secret viejo.
--    Por eso el WHERE va por "supabaseId" y no por id de fila.
--
-- Empieza SIEMPRE por la lista acotada. El bloque de "todas" está aparte y con
-- su propio comentario para que no se corra por inercia.

-- ── 4a · Acotado: solo las personas que decidas (recomendado) ───────────────
-- Pega aquí los supabaseId de la consulta 2.
--
-- BEGIN;
--
-- UPDATE users
-- SET "totpEnabled"   = false,
--     "totpSecret"    = NULL,
--     "recoveryCodes" = '{}'
-- WHERE "supabaseId" IN (
--   '00000000-0000-0000-0000-000000000000'   -- ← reemplazar
-- );
--
-- -- Comprueba ANTES de confirmar: tiene que salir 0 en las tres columnas.
-- SELECT count(*) FILTER (WHERE "totpEnabled")            AS quedan_enrolados,
--        count(*) FILTER (WHERE "totpSecret" IS NOT NULL) AS quedan_con_secret,
--        count(*) FILTER (WHERE cardinality("recoveryCodes") > 0) AS quedan_con_codigos
-- FROM users
-- WHERE "supabaseId" IN (
--   '00000000-0000-0000-0000-000000000000'   -- ← el mismo de arriba
-- );
--
-- COMMIT;   -- o ROLLBACK; si el conteo no sale a cero


-- ── 4b · Todas las personas con 2FA (solo si se asume la fuga como cierta) ──
-- Deja sin segundo factor, hasta que re-enrolen, a todo el que lo tenía. En las
-- clínicas SIN require2fa nadie los va a obligar a volver a ponerlo: avísales
-- primero.
--
-- BEGIN;
--
-- UPDATE users
-- SET "totpEnabled"   = false,
--     "totpSecret"    = NULL,
--     "recoveryCodes" = '{}'
-- WHERE "supabaseId" IN (
--   SELECT DISTINCT "supabaseId" FROM users WHERE "isActive" AND "totpEnabled"
-- );
--
-- SELECT count(*) AS quedan_enrolados FROM users WHERE "totpEnabled";  -- → 0
--
-- COMMIT;
