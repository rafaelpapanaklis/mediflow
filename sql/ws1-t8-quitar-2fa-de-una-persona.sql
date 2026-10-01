-- ws1-t8 · Quitar la verificación en dos pasos a UNA persona que perdió el
-- celular Y sus códigos de recuperación. Es el último recurso: antes, que entre
-- con un código de recuperación (pantalla del reto → «Usar un código de
-- recuperación») y desde Configuración → Seguridad desactive y vuelva a activar
-- el 2FA con el celular nuevo.
--
-- ⚠ PLANTILLA. NO se aplica sola. Verifica la identidad de quien lo pide por un
-- canal que no sea el correo de la cuenta (llamada al teléfono de la clínica,
-- videollamada…) ANTES de correrlo: quien tenga la contraseña robada también
-- puede escribir a soporte.
--
-- Qué pasa después: la persona entra solo con su contraseña. Si es DUEÑO
-- (SUPER_ADMIN) y la gracia ya venció, el panel la manda directo a configurar
-- el 2FA con el celular nuevo (no queda bloqueada: puede hacerlo ahí mismo).
--
-- El 2FA es de la PERSONA (EQ-02): se quita en todas sus filas de users, por
-- supabaseId, no solo en una clínica.

-- 1) Revisa a quién vas a tocar (cambia el correo):
SELECT u.id, u."clinicId", c.name AS clinica, u.role, u.email, u."totpEnabled",
       cardinality(u."recoveryCodes") AS codigos_restantes
FROM users u
JOIN clinics c ON c.id = u."clinicId"
WHERE u."supabaseId" = (SELECT "supabaseId" FROM users WHERE lower(email) = lower('CORREO@DE.LA.PERSONA') LIMIT 1);

-- 2) Si son las filas correctas:
BEGIN;
UPDATE users
SET "totpEnabled" = false,
    "totpSecret" = NULL,
    "recoveryCodes" = '{}'
WHERE "supabaseId" = (SELECT "supabaseId" FROM users WHERE lower(email) = lower('CORREO@DE.LA.PERSONA') LIMIT 1);
-- Debe decir UPDATE <n> con n = número de filas del paso 1. Si no, ROLLBACK;
COMMIT;
