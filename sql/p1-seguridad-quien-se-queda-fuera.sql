-- ═══════════════════════════════════════════════════════════════════════
-- P1-SEGURIDAD — CUÁNTA GENTE SE QUEDA FUERA SI EMPEZAMOS A EXIGIR PERMISOS
--
-- SOLO LECTURA. Ni un INSERT, ni un UPDATE, ni un ALTER. Se puede correr en
-- producción tal cual, en cualquier momento y las veces que haga falta.
--
-- ── PARA QUÉ ES ────────────────────────────────────────────────────────
-- EQ-07 dice que ~12 interruptores de la pantalla de Permisos no los lee
-- NADIE, e ISO-03 que 14 endpoints validan con la capa que IGNORA
-- `permissionsOverride`. Arreglar los dos significa EMPEZAR A EXIGIR
-- permisos que hoy no se exigen — y ahí está el peligro:
--
--   `permissionsOverride` REEMPLAZA los defaults del rol, no se fusiona
--   con ellos (src/lib/auth/permissions.ts, getEffectivePermissions).
--
-- O sea: quien tenga un override no vacío tiene EXACTAMENTE esas llaves y
-- ninguna más. Si un permiso se dio de alta después de que alguien
-- personalizara sus permisos, esa persona no lo tiene aunque su rol sí lo
-- traiga por default. El día que el endpoint empiece a pedirlo, se queda
-- fuera de su propio trabajo sin que nadie haya tocado su configuración.
-- Es lo que rompió el tab de consentimientos.
--
-- Estas siete consultas contestan, con números, si eso pasaría y a cuántos.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1 · EL CENSO: cuántos usuarios activos hay de cada rol ─────────────
-- El denominador de todo lo demás.
SELECT
  "role",
  COUNT(*)                                              AS usuarios,
  COUNT(*) FILTER (WHERE "isActive")                    AS activos,
  COUNT(DISTINCT "clinicId")                            AS clinicas
FROM "users"
GROUP BY "role"
ORDER BY activos DESC;


-- ── 2 · LA PREGUNTA QUE DECIDE: ¿alguien tiene override? ───────────────
-- Si esto sale 0 en la columna `con_override`, EQ-07 e ISO-03 son deuda
-- latente: nadie ha personalizado permisos, así que empezar a exigirlos no
-- puede dejar a nadie fuera y se pueden arreglar sin red.
-- Si sale > 0, hay que mirar las consultas 3 a 6 UNA POR UNA.
SELECT
  COUNT(*)                                                          AS usuarios_activos,
  COUNT(*) FILTER (WHERE COALESCE(array_length("permissionsOverride", 1), 0) > 0)
                                                                    AS con_override,
  COUNT(DISTINCT "clinicId") FILTER (WHERE COALESCE(array_length("permissionsOverride", 1), 0) > 0)
                                                                    AS clinicas_con_override
FROM "users"
WHERE "isActive";


-- ── 3 · QUIÉNES SON, uno por uno ───────────────────────────────────────
-- Sin nombres ni correos: rol, clínica y cuántas llaves tiene. Si la lista
-- es corta se puede revisar a mano antes de tocar nada.
SELECT
  u."id",
  u."role",
  c."name"                                    AS clinica,
  array_length(u."permissionsOverride", 1)    AS llaves,
  u."permissionsOverride"                     AS permisos
FROM "users" u
JOIN "clinics" c ON c."id" = u."clinicId"
WHERE u."isActive"
  AND COALESCE(array_length(u."permissionsOverride", 1), 0) > 0
ORDER BY c."name", u."role";


-- ── 4 · LOS QUE SE QUEDARÍAN FUERA, POR PERMISO ────────────────────────
-- Para cada permiso que estaríamos a punto de empezar a exigir: cuántos
-- usuarios con override NO lo tienen. Ese número es, literalmente, cuánta
-- gente deja de poder hacer su trabajo el día del deploy.
--
-- La lista son los que EQ-07 marca como muertos o de solo-adorno y que
-- protegen algo que hoy se puede hacer sin ellos.
WITH candidatos(permiso, que_desbloquea) AS (
  VALUES
    ('xrays.view',        'ver radiografías'),
    ('xrays.upload',      'subir radiografías'),
    ('xrays.analyze',     'analizar radiografías con IA (cobra tokens)'),
    ('treatments.edit',   'crear y editar planes de tratamiento'),
    ('inventory.edit',    'ajustar existencias del inventario'),
    ('suppliers.order',   'hacer un pedido a proveedores'),
    ('procedures.edit',   'editar procedimientos'),
    ('tvModes.edit',      'configurar las Pantallas TV'),
    ('settings.edit',     'editar la configuración de la clínica'),
    ('clinicLayout.edit', 'editar Mi Clínica Visual'),
    ('prescription.view', 'ver recetas'),
    ('prescription.create','crear y firmar recetas'),
    ('medicalRecord.view','ver el expediente clínico'),
    ('medicalRecord.edit','editar notas SOAP / firmar')
)
SELECT
  k.permiso,
  k.que_desbloquea,
  COUNT(*) FILTER (WHERE NOT (k.permiso = ANY (u."permissionsOverride")))
                                                        AS se_quedan_fuera,
  COUNT(*)                                              AS de_usuarios_con_override,
  string_agg(DISTINCT u."role", ', ')
    FILTER (WHERE NOT (k.permiso = ANY (u."permissionsOverride")))
                                                        AS roles_afectados
FROM candidatos k
CROSS JOIN "users" u
WHERE u."isActive"
  AND COALESCE(array_length(u."permissionsOverride", 1), 0) > 0
GROUP BY k.permiso, k.que_desbloquea
ORDER BY se_quedan_fuera DESC, k.permiso;


-- ── 5 · EL OTRO RIESGO: los que HOY trabajan sin el permiso ────────────
-- Aquí no manda el override sino el DEFAULT del rol. Un RECEPTIONIST no
-- tiene `xrays.upload` ni `suppliers.order` por default, y hoy los usa
-- igual porque el endpoint no comprueba nada. Este es el conteo de a
-- cuántos afectaría aunque NADIE tenga override.
--
-- Lee así: "si empiezo a exigir xrays.upload, los N recepcionistas activos
-- dejan de poder subir placas".
SELECT
  u."role",
  COUNT(*) AS usuarios_activos,
  CASE u."role"
    WHEN 'RECEPTIONIST' THEN 'sin xrays.*, sin treatments.edit, sin inventory.edit, sin suppliers.order'
    WHEN 'READONLY'     THEN 'sin xrays.*, sin specialties.*, sin nada que no acabe en .view'
    WHEN 'DOCTOR'       THEN 'sin inventory.view, sin treatments.edit, sin suppliers.order'
    ELSE                     'admin: los tiene todos por default'
  END AS que_le_falta_por_default
FROM "users" u
WHERE u."isActive"
GROUP BY u."role"
ORDER BY usuarios_activos DESC;


-- ── 6 · ¿DE VERDAD LO USAN? evidencia de la bitácora ───────────────────
-- Antes de quitarle una llave a alguien, mirar si la ha usado.
--
-- ⚠ OJO CON LO QUE ESTA CONSULTA **NO** PUEDE CONTESTAR. La bitácora solo
-- escribe estos entityType: appointment, clinic, consent, implant, invoice,
-- patient, periodontal, prescription, quote, record, review, staff,
-- subscription, treatment, user. NO hay 'xray', ni 'inventory', ni
-- 'procedure', ni pedidos a proveedores — o sea que justo los cuatro
-- permisos más peligrosos de la consulta 4 (xrays.*, inventory.edit,
-- suppliers.order, procedures.edit) NO dejan rastro y aquí saldrán vacíos.
-- Un cero en esta tabla para esos NO significa "nadie lo usa": significa
-- "no lo estamos midiendo". Para esos hay que preguntarle a las clínicas.
--
-- Lo que sí contesta: recetas, expediente (record), tratamientos y los
-- cambios de la propia clínica.
SELECT
  u."role",
  a."entityType",
  a."action",
  COUNT(*)                    AS veces,
  COUNT(DISTINCT a."userId")  AS personas,
  MAX(a."createdAt")          AS la_ultima
FROM "audit_logs" a
JOIN "users" u ON u."id" = a."userId"
WHERE a."createdAt" > now() - interval '90 days'
  AND a."entityType" IN ('prescription', 'record', 'treatment', 'clinic')
GROUP BY u."role", a."entityType", a."action"
ORDER BY veces DESC;


-- ── 6b · QUÉ HAY DE VERDAD EN LA BITÁCORA ──────────────────────────────
-- El inventario completo, por si algún módulo empezó a escribir y el
-- comentario de arriba se quedó viejo. Correr esta ANTES de fiarse de la 6.
SELECT
  a."entityType",
  COUNT(*)           AS filas,
  MIN(a."createdAt") AS desde,
  MAX(a."createdAt") AS hasta
FROM "audit_logs" a
WHERE a."createdAt" > now() - interval '90 days'
GROUP BY a."entityType"
ORDER BY filas DESC;


-- ── 7 · SALUD DEL PROPIO OVERRIDE: llaves que ya no existen ────────────
-- `getEffectivePermissions` descarta en silencio las llaves que no estén en
-- el catálogo. Un override lleno de llaves viejas es un usuario con MENOS
-- permisos de los que su dueño cree haberle dado, y nadie se entera.
-- Ajustar la lista de abajo si el catálogo cambia (hoy son 57 llaves).
SELECT
  u."id",
  u."role",
  c."name" AS clinica,
  llave    AS llave_desconocida
FROM "users" u
JOIN "clinics" c ON c."id" = u."clinicId"
CROSS JOIN LATERAL unnest(u."permissionsOverride") AS llave
WHERE u."isActive"
  AND llave NOT IN (
    'today.view',
    'agenda.view','agenda.create','agenda.edit','agenda.delete',
    'patients.view','patients.create','patients.edit','patients.delete',
    'medicalRecord.view','medicalRecord.edit',
    'prescription.view','prescription.create',
    'consents.view','consents.create','consents.revoke',
    'xrays.view','xrays.upload','xrays.analyze',
    'inbox.view','inbox.send','inbox.delete','whatsapp.view','whatsapp.send',
    'treatments.view','treatments.edit','resources.view','resources.edit',
    'inventory.view','inventory.edit','suppliers.view','suppliers.order',
    'billing.view','billing.create','billing.charge','billing.refund','billing.edit',
    'analytics.view','tvModes.view','tvModes.edit','reports.view',
    'team.view','team.edit','settings.view','settings.edit',
    'landing.view','landing.edit','procedures.view','procedures.edit',
    'clinicLayout.view','clinicLayout.edit','marketplace.view',
    'specialties.pediatrics','specialties.endodontics','specialties.periodontics',
    'specialties.orthodontics','specialties.implants'
  )
ORDER BY c."name", u."role";
