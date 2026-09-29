-- ws1-t2 · BEVADENT — devolverle el acceso a la doctora Johnnifer (ortodoncista).
--
-- Contexto: la ficha users.id = 'cmu7zj006001a8brxmktdmmnl' apunta a un usuario de
-- Auth que el reinicio de la clínica borró, y quedó con un correo de relleno.
-- Se ENLAZA la misma ficha (conserva foto, color, teléfono, especialidad) a una
-- cuenta de Auth nueva y se le pone su correo real y su cédula.
--
-- ORDEN (ver REPORTE-ws1-t2.md):
--   0. Pide a la clínica el correo REAL y la cédula de la doctora.
--   1. Supabase → Authentication → Users → Add user → Create new user:
--        correo real, una contraseña temporal, «Auto Confirm User» ACTIVADO.
--      Copia el «User UID» de la fila que se crea.
--   2. Corre el PASO 1 (solo lee) y comprueba que el correo no lo usa nadie más.
--   3. Sustituye los 3 valores en MAYÚSCULAS del PASO 2 y córrelo.
--      Si algo no está bien puesto, el UPDATE toca 0 filas (no rompe nada).
--   4. Corre el PASO 3 (solo lee): debe salir 1 fila con las dos columnas de correo iguales.
--   5. Entrega la contraseña temporal a la doctora por un canal seguro; al entrar
--      tendrá que cambiarla.
-- Idempotente: si ya se aplicó, el PASO 2 toca 0 filas.

-- PASO 1 · ¿ese correo ya está en alguna ficha? (debe salir vacío)
SELECT id, "clinicId", email, "supabaseId"
FROM users
WHERE lower(email) = lower('CORREO_REAL_DE_LA_DOCTORA');

-- PASO 2 · el enlace (sustituye CORREO_REAL_DE_LA_DOCTORA, UID_DE_AUTH y CEDULA)
UPDATE users
SET "supabaseId"         = 'UID_DE_AUTH',
    email                = lower('CORREO_REAL_DE_LA_DOCTORA'),
    "cedulaProfesional"  = 'CEDULA',
    "mustChangePassword" = true
WHERE id = 'cmu7zj006001a8brxmktdmmnl'
  AND "clinicId" = 'cmu7uttes000nq2n003bhxazo'
  AND "supabaseId" = '26e82327-e7f4-4d26-a671-902901627219'
  AND 'UID_DE_AUTH' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND 'CORREO_REAL_DE_LA_DOCTORA' ~ '^[^@ ]+@[^@ ]+\.[^@ ]+$'
  AND lower('CORREO_REAL_DE_LA_DOCTORA') NOT LIKE '%@invalid.dalecontrol';

-- PASO 3 · comprobación (una fila; correo_ficha y correo_auth deben ser iguales)
SELECT u.id, u."isActive", u.email AS correo_ficha, a.email AS correo_auth,
       a.email_confirmed_at IS NOT NULL AS confirmado, u."cedulaProfesional", u."mustChangePassword"
FROM users u
JOIN auth.users a ON a.id::text = u."supabaseId"
WHERE u.id = 'cmu7zj006001a8brxmktdmmnl';
