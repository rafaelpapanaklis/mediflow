-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — ws1-t2 (ronda 5) · BACKFILL de permisos personalizados
-- para "billing.deposit" / "billing.deposit.register" (N10, QA ronda 4).
--
-- El override de permisos REEMPLAZA al default del rol, no lo mergea
-- (src/lib/auth/permissions.ts, getEffectivePermissions — y lo prueba
-- src/lib/auth/__tests__/permissions-matrix.test.ts: "override lleno
-- REEMPLAZA"). Es la semántica correcta para que un SUPER_ADMIN pueda
-- QUITARLE de verdad un permiso a alguien, pero tiene un efecto secundario:
-- "billing.deposit" y "billing.deposit.register" se añadieron al catálogo
-- DESPUÉS de que algunas clínicas ya hubieran personalizado los permisos de
-- un doctor o de recepción desde Equipo → Permisos. Quien personalizó ANTES
-- de que esas dos keys existieran nunca tuvo oportunidad de marcarlas, así
-- que hoy las pierde por completo aunque su ROL sí las trae de fábrica — no
-- es que la clínica las haya negado a propósito, es que no pudo elegir.
--
-- Este script se las agrega al array `permissionsOverride` de los usuarios
-- cuyo override YA NO ESTÁ VACÍO (están personalizando) y cuyo rol las trae
-- por default. NO toca:
--   · usuarios con override vacío — ya heredan el default del rol solos, sin
--     nada que arreglar;
--   · SUPER_ADMIN — sus permisos no se editan desde el modal
--     (POST/PATCH /api/team/[id]/permissions lo rechaza);
--   · READONLY — su default nunca incluye estas dos keys (no terminan en
--     ".view").
--
-- Es un arreglo PUNTUAL, no un mecanismo automático: la próxima key que se
-- quiera propagar a los overrides YA GUARDADOS necesita su propio backfill
-- igual que este (decisión: mantener "override reemplaza, no mergea" tal
-- cual está probado, en vez de inventar una semántica de "negación
-- explícita" que ningún flujo del modal sabe escribir hoy). Ver el
-- comentario junto a ROLE_DEFAULT_PERMISSIONS en
-- src/lib/auth/permissions.ts.
--
-- Idempotente: correrlo dos veces no duplica nada (el WHERE excluye a quien
-- ya la tiene).

-- 1) Revisa ANTES de aplicar quién se ve afectado.
SELECT id, "clinicId", role, "firstName", "lastName", "permissionsOverride"
FROM users
WHERE role IN ('DOCTOR', 'RECEPTIONIST', 'ADMIN')
  AND cardinality("permissionsOverride") > 0
  AND NOT (
    'billing.deposit' = ANY("permissionsOverride")
    AND 'billing.deposit.register' = ANY("permissionsOverride")
  );

-- 2) El backfill — dos UPDATE independientes (una clínica pudo haber negado
--    una de las dos keys y no la otra; cada uno respeta la que ya tenga).
UPDATE users
SET "permissionsOverride" = "permissionsOverride" || ARRAY['billing.deposit']::text[]
WHERE role IN ('DOCTOR', 'RECEPTIONIST', 'ADMIN')
  AND cardinality("permissionsOverride") > 0
  AND NOT ('billing.deposit' = ANY("permissionsOverride"));

UPDATE users
SET "permissionsOverride" = "permissionsOverride" || ARRAY['billing.deposit.register']::text[]
WHERE role IN ('DOCTOR', 'RECEPTIONIST', 'ADMIN')
  AND cardinality("permissionsOverride") > 0
  AND NOT ('billing.deposit.register' = ANY("permissionsOverride"));
