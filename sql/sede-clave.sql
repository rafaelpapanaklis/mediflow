-- ═══════════════════════════════════════════════════════════════════
-- CLAVE DE LA SEDE (ws1-t4, 25-oct-2026)
-- Tablas sede_claves y sede_clave_intentos. SIN modelo de Prisma: el código las
-- lee y escribe con $queryRaw/$executeRaw (src/lib/sede-clave/estado.server.ts).
--
-- Se corre en Supabase (SQL Editor). Lo aplica Rafael, nunca una terminal.
--
-- ORDEN RESPECTO AL DEPLOY: se puede pegar ANTES o DESPUÉS. Sin estas tablas
-- la función está APAGADA y todo sigue como hoy: Configuración → Seguridad no
-- enseña «Clave de la sede», nadie ve la pantalla de la clave y el selector de
-- sedes funciona igual. El código pregunta si existen con to_regclass (nunca
-- falla) y no consulta las tablas mientras no estén.
--
-- ADITIVO e IDEMPOTENTE: seguro de re-correr. No toca ninguna tabla existente
-- y no borra nada. SQL plano, sin bloques DO. Columnas camelCase
-- entrecomilladas, como el resto de la base.
-- ═══════════════════════════════════════════════════════════════════

-- 1) La clave de cada sede. Una fila por clínica, que se crea la primera vez
--    que alguien activa la clave y NO se borra nunca: desactivar o restablecer
--    deja "claveHash" en NULL y sube "version". La versión viaja en la cookie
--    de cada desbloqueo, así que subirla invalida todos los desbloqueos.
--    "claveHash" es bcrypt: la clave en claro no se guarda en ningún lado.
CREATE TABLE IF NOT EXISTS "sede_claves" (
  "clinicId"         text         NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "claveHash"        text,
  "version"          integer      NOT NULL DEFAULT 0,
  "actualizadaPor"   text,
  "createdAt"        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sede_claves_pkey" PRIMARY KEY ("clinicId")
);

-- 2) Intentos de teclear la clave, por persona (supabaseId) y sede. De aquí sale
--    el «5 claves mal en 15 min → 15 min sin poder intentar». Se cuentan solo
--    los de la versión vigente. Nunca guarda la clave tecleada.
CREATE TABLE IF NOT EXISTS "sede_clave_intentos" (
  "id"          text         NOT NULL DEFAULT gen_random_uuid()::text,
  "clinicId"    text         NOT NULL REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "supabaseId"  text         NOT NULL,
  "version"     integer      NOT NULL,
  "ok"          boolean      NOT NULL,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sede_clave_intentos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sede_clave_intentos_clinicId_supabaseId_createdAt_idx"
  ON "sede_clave_intentos" ("clinicId", "supabaseId", "createdAt");

-- 3) Defense-in-depth: RLS activada y SIN políticas = anon y authenticated no
--    ven nada. DaleControl lee solo vía Prisma (rol postgres, que no pasa por
--    RLS). (ENABLE es idempotente.)
ALTER TABLE "sede_claves"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sede_clave_intentos" ENABLE ROW LEVEL SECURITY;

-- Comprobación: debe devolver las dos tablas con rls = true y 0 filas cada una
-- (la primera vez).
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM "sede_claves")         AS filas_sede_claves,
       (SELECT count(*) FROM "sede_clave_intentos") AS filas_intentos
  FROM pg_class c
 WHERE c.relname IN ('sede_claves', 'sede_clave_intentos')
 ORDER BY c.relname;
