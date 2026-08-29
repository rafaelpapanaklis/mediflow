-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INSTITUCIONAL — Ola 0. Escuelas de especialidades
-- odontológicas. Producto SEPARADO del dental (que está VIVO en
-- producción): este archivo NO altera ni una tabla existente. Solo CREATE.
--
-- GENERADO desde el bloque Edu* de prisma/schema.prisma y hecho
-- idempotente: cada bloque comprueba existencia antes de crear, así que
-- correrlo varias veces no produce errores ni duplicados. Cero DROP, cero
-- ALTER sobre nada del dental.
--
-- Contenido: 1 enum · 2 tablas · 4 índices (1 único) · 1 llave foránea.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es la ÚNICA fuente
-- de verdad del SQL del vertical; las mismas tablas están en
-- prisma/schema.prisma, así que un `prisma db push` no se las lleva.
--
-- Nota sobre $$: usamos un delimitador con nombre, $edu$, y NUNCA bloques
-- DO anidados — el parser SQL de Supabase rompe con $$ anidado.
--
-- Nota sobre los nombres: las columnas van en camelCase ENTRECOMILLADO
-- porque así las escribe Prisma; sin comillas Postgres las bajaría a
-- minúsculas y el cliente dejaría de encontrarlas.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enum ────────────────────────────────────────────────────────────
DO $edu$
BEGIN
  CREATE TYPE "EduRole" AS ENUM ('DIRECCION', 'DOCENTE', 'ALUMNO', 'CAJA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────

-- El instituto: el tenant raíz del vertical.
CREATE TABLE IF NOT EXISTS "edu_institutions" (
  "id"               TEXT         NOT NULL,
  "name"             VARCHAR(160) NOT NULL,
  "slug"             VARCHAR(80)  NOT NULL,
  "legalName"        VARCHAR(200),
  "rfc"              VARCHAR(13),
  "city"             VARCHAR(80),
  "state"            VARCHAR(80),
  "phone"            VARCHAR(30),
  "email"            VARCHAR(160),
  "logoUrl"          TEXT,
  "timezone"         VARCHAR(60)  NOT NULL DEFAULT 'America/Tijuana',
  "isActive"         BOOLEAN      NOT NULL DEFAULT true,
  -- Contrato institucional. NO pasa por Stripe ni por el gate de plan del
  -- dental: se administra a mano. Si "contractEndsAt" queda en el pasado,
  -- el panel AVISA pero NO corta el acceso.
  "contractStartsAt" TIMESTAMP(3),
  "contractEndsAt"   TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- @updatedAt lo escribe Prisma en cada UPDATE. El DEFAULT es para que un
  -- INSERT hecho a mano desde el SQL Editor (como el del final de este
  -- archivo) no falle por una columna NOT NULL sin valor.
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_institutions_pkey" PRIMARY KEY ("id")
);

-- Persona con login en el instituto.
CREATE TABLE IF NOT EXISTS "edu_users" (
  "id"                  TEXT         NOT NULL,
  "institutionId"       TEXT         NOT NULL,
  -- Identidad de Supabase Auth (auth.users.id). NO hay FK a auth.users a
  -- propósito: es el mismo criterio que barber_users / realty_users, para
  -- no acoplar el esquema público al esquema de auth de Supabase.
  "supabaseId"          TEXT         NOT NULL,
  "email"               VARCHAR(160) NOT NULL,
  "firstName"           VARCHAR(80)  NOT NULL,
  "lastName"            VARCHAR(80)  NOT NULL,
  "role"                "EduRole"    NOT NULL,
  "phone"               VARCHAR(30),
  "avatarUrl"           TEXT,
  "isActive"            BOOLEAN      NOT NULL DEFAULT true,
  "mustChangePassword"  BOOLEAN      NOT NULL DEFAULT false,
  -- Si trae keys, REEMPLAZAN al default del rol (no se suman). Por eso
  -- cada ola que agregue un permiso nuevo tiene que traer su backfill:
  -- a quien ya tenga override, el permiso nuevo NO le llega solo.
  "permissionsOverride" TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastLogin"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "edu_users_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
-- Los nombres son los que genera Prisma: si algún día se corre
-- `prisma migrate diff` contra esta base, los reconoce y no propone
-- recrearlos.

CREATE UNIQUE INDEX IF NOT EXISTS "edu_institutions_slug_key"
  ON "edu_institutions" ("slug");

-- La misma persona puede existir en DOS institutos (un docente que da
-- clase en dos escuelas) sin pisarse: lo único es el par.
CREATE UNIQUE INDEX IF NOT EXISTS "edu_users_supabaseId_institutionId_key"
  ON "edu_users" ("supabaseId", "institutionId");

-- getEduContext entra por aquí en CADA request del panel.
CREATE INDEX IF NOT EXISTS "edu_users_supabaseId_idx"
  ON "edu_users" ("supabaseId");

-- Listados del padrón: "los alumnos activos de este instituto".
CREATE INDEX IF NOT EXISTS "edu_users_institutionId_role_isActive_idx"
  ON "edu_users" ("institutionId", "role", "isActive");


-- ── 4. Llave foránea ───────────────────────────────────────────────────
-- ADD CONSTRAINT no acepta IF NOT EXISTS en Postgres, así que se envuelve.
DO $edu$
BEGIN
  ALTER TABLE "edu_users"
    ADD CONSTRAINT "edu_users_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "edu_institutions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$edu$;


-- ── 5. Documentación en la propia base ─────────────────────────────────
-- COMMENT ON reemplaza el comentario anterior: es idempotente por sí solo.
COMMENT ON COLUMN "edu_institutions"."contractEndsAt" IS
  'Fin del contrato institucional. AVISA, no corta: el panel muestra un banner y sigue dejando entrar. Ver src/lib/edu/contract.ts.';
COMMENT ON COLUMN "edu_users"."permissionsOverride" IS
  'Si trae keys, REEMPLAZAN al default del rol (no se suman). Catálogo en src/lib/edu/permissions.ts.';


-- ═══════════════════════════════════════════════════════════════════════
-- 6. ALTA DEL PRIMER INSTITUTO Y DE SU PRIMER USUARIO
--
-- Todo lo de aquí abajo está COMENTADO a propósito: es el ejemplo, no
-- parte de la migración. Descoméntalo, cámbiale los datos y córrelo aparte.
--
-- ORDEN OBLIGATORIO — el usuario va DESPUÉS, y en dos pasos:
--
--   1) Crear el instituto (bloque A).
--
--   2) Dar de alta a la persona en Supabase Auth: Authentication → Users →
--      "Add user" → correo + contraseña (marca "Auto Confirm User", si no
--      no podrá entrar). Supabase le asigna un UUID: ése es el
--      "supabaseId". NO te lo puedes inventar ni generar aquí — si no
--      coincide con el de auth.users, getEduContext no encontrará la fila
--      y la persona entrará al login una y otra vez sin ningún error
--      visible.
--
--   3) Crear su fila en edu_users con ESE UUID (bloque B).
--
-- El primer usuario tiene que ser DIRECCION: es el rol que da de alta a
-- los demás. Los cuatro roles entran al panel, pero la administración del
-- instituto es suya.
--
-- ── Bloque A · el instituto ────────────────────────────────────────────
-- INSERT INTO "edu_institutions"
--   ("id", "name", "slug", "legalName", "rfc", "city", "state",
--    "phone", "email", "timezone", "isActive",
--    "contractStartsAt", "contractEndsAt")
-- VALUES (
--   gen_random_uuid()::text,          -- Prisma escribe cuids; la columna es
--                                     -- TEXT, así que cualquier id único sirve
--   'Instituto de Especialidades Odontológicas',
--   'ieo',                            -- slug: único, minúsculas, sin espacios
--   'Instituto de Especialidades Odontológicas S.C.',
--   'IEO010101AA1',
--   'Tijuana',
--   'Baja California',
--   '+526641234567',
--   'direccion@instituto.mx',
--   'America/Tijuana',
--   true,
--   '2026-01-01'::timestamp,          -- contractStartsAt
--   '2026-12-31'::timestamp           -- contractEndsAt (vencerlo NO cierra el panel)
-- );
--
-- ── Bloque B · la primera persona (DIRECCION) ──────────────────────────
-- Sustituye:
--   · '00000000-0000-0000-0000-000000000000' por el UUID real de
--     Supabase Auth (Authentication → Users → columna UID);
--   · 'ieo' por el slug que usaste arriba.
--
-- INSERT INTO "edu_users"
--   ("id", "institutionId", "supabaseId", "email",
--    "firstName", "lastName", "role", "isActive", "mustChangePassword")
-- SELECT
--   gen_random_uuid()::text,
--   i."id",
--   '00000000-0000-0000-0000-000000000000',   -- ← UUID REAL de Supabase Auth
--   'direccion@instituto.mx',                 -- el MISMO correo del alta en Auth
--   'Nombre',
--   'Apellido',
--   'DIRECCION',
--   true,
--   false
-- FROM "edu_institutions" i
-- WHERE i."slug" = 'ieo';
--
-- ── Comprobación ───────────────────────────────────────────────────────
-- SELECT u."email", u."role", u."isActive", i."name", i."contractEndsAt"
-- FROM "edu_users" u
-- JOIN "edu_institutions" i ON i."id" = u."institutionId";
--
-- Si esa consulta devuelve la fila y la persona sigue sin poder entrar,
-- el sospechoso número uno es el "supabaseId": compáralo carácter por
-- carácter con el UID que muestra Supabase Auth.
-- ═══════════════════════════════════════════════════════════════════════
