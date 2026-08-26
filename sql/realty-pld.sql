-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INMUEBLES · CUMPLIMIENTO ANTILAVADO (PLD / LFPIORPI)
--
-- 7 enums · 5 tablas · 14 índices · 11 llaves foráneas
-- + el backfill del permiso nuevo para las cuentas que YA existen.
--
-- Aplicar manualmente en Supabase (SQL editor). IDEMPOTENTE: cada bloque
-- comprueba existencia antes de crear, así que correrlo dos veces no
-- produce errores ni duplicados.
--
-- 🔴 NADA VIVE SOLO AQUÍ. Las cinco tablas están también en
-- prisma/schema.prisma (al final del bloque Realty), así que un
-- `prisma db push` no se las lleva por delante — en barber eso sí pasó.
--
-- Nota sobre $$: un único delimitador `$realty$` y NUNCA bloques DO
-- anidados (el parser SQL de Supabase rompe con $$ anidado).
--
-- Nota sobre fechas: TIMESTAMP(3) SIN zona, como el resto del vertical.
--
-- ── 🔴 CERO NÚMEROS DE LA LEY EN ESTE ARCHIVO ─────────────────────────
-- No hay UMA, ni 8 025, ni 16 000, ni día 17, ni 24 horas, ni 10 años.
-- Todo eso vive en `realty_calc_params` (kind = 'UMA', stateCode = 'MX',
-- bloque `pld` de su `meta`) y se siembra desde el panel de plataforma con
-- POST /api/realty/pld/parametros — que además es IDEMPOTENTE y ADITIVO:
-- una fila que ya trae el bloque se deja INTACTA, para que volver a
-- sembrar nunca le devuelva el número de fábrica a un umbral que alguien
-- corrigió contra el texto de la ley.
--
-- Estas tablas guardan RESULTADOS y DECISIONES de una persona. Nunca la
-- regla.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────
DO $realty$
BEGIN
  -- Persona física, moral o fideicomiso: cambia QUÉ papeles pide el
  -- expediente (una moral debe declarar beneficiario controlador).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPldPersonKind') THEN
    CREATE TYPE "RealtyPldPersonKind" AS ENUM ('FISICA', 'MORAL', 'FIDEICOMISO');
  END IF;

  -- Persona políticamente expuesta. El familiar y el asociado cercano
  -- cuentan igual que el titular.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPldPepKind') THEN
    CREATE TYPE "RealtyPldPepKind" AS ENUM ('NO', 'PEP', 'FAMILIAR', 'ASOCIADO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPldRisk') THEN
    CREATE TYPE "RealtyPldRisk" AS ENUM ('BAJO', 'MEDIO', 'ALTO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPldDocKind') THEN
    CREATE TYPE "RealtyPldDocKind" AS ENUM ('IDENTIFICACION', 'COMPROBANTE_DOMICILIO', 'CONSTANCIA_FISCAL', 'CURP', 'ACTA_CONSTITUTIVA', 'PODER', 'BENEFICIARIO_CONTROLADOR', 'OTRO');
  END IF;

  -- EN_CEROS = no hubo operaciones, y aun así hay que reportarlo: es el
  -- error más caro y más fácil de cometer.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPldNoticeKind') THEN
    CREATE TYPE "RealtyPldNoticeKind" AS ENUM ('NORMAL', 'EN_CEROS');
  END IF;

  -- PRESENTADO lo marca una PERSONA después de subirlo en el portal del
  -- SAT. DaleControl nunca lo pone por su cuenta.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPldNoticeStatus') THEN
    CREATE TYPE "RealtyPldNoticeStatus" AS ENUM ('PENDIENTE', 'PRESENTADO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPldAccessAction') THEN
    CREATE TYPE "RealtyPldAccessAction" AS ENUM ('VER_EXPEDIENTE', 'ABRIR_DOCUMENTO', 'DESCARGAR_AVISO', 'ARCHIVAR_DOCUMENTO');
  END IF;
END
$realty$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────
--
-- accountId en LAS CINCO. Es la regla del vertical y no es negociable:
-- `include` no es un JOIN, así que sin la columna no se puede filtrar un
-- hijo por el tenant de su padre en un solo where.

-- El EXPEDIENTE de identificación de un cliente. Uno por contacto y por
-- cuenta: la misma persona puede aparecer en varias operaciones y el
-- expediente se integra UNA vez.
--
-- NO hay columna `status`: el estado (incompleto / completo / vencido) se
-- calcula de los papeles que hay y de sus vigencias. Guardarlo sería tener
-- dos verdades y que una envejeciera.
CREATE TABLE IF NOT EXISTS "realty_pld_files" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "personKind" "RealtyPldPersonKind" NOT NULL DEFAULT 'FISICA',
    "rfc" TEXT,
    "curp" TEXT,
    "birthDate" TIMESTAMP(3),
    "nationality" TEXT,
    "occupation" TEXT,
    "address" TEXT,
    "pep" "RealtyPldPepKind" NOT NULL DEFAULT 'NO',
    "pepDetail" TEXT,
    -- Cuándo se PREGUNTÓ. Sin fecha, el cuestionario no está contestado:
    -- "NO" por omisión y "NO" declarado no son lo mismo.
    "pepAskedAt" TIMESTAMP(3),
    -- [{ name, rfc, curp, pct, pep }]
    "beneficialOwners" JSONB,
    "risk" "RealtyPldRisk" NOT NULL DEFAULT 'BAJO',
    "riskNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    -- Sin FK a realty_users A PROPÓSITO: un expediente de cumplimiento
    -- tiene que sobrevivir a que la persona que lo revisó deje la
    -- inmobiliaria. Por eso se guarda también el nombre.
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_pld_files_pkey" PRIMARY KEY ("id")
);

-- Un papel del expediente, en el bucket PRIVADO realty-files.
--
-- 🔴 BÓVEDA: `retainUntil` se calcula al subir, con el plazo que diga el
-- parámetro vigente. Mientras esa fecha no pase, la UI NO BORRA: archiva
-- (`archivedAt`). El objeto sigue en el bucket.
--
-- `url` guarda el PATH interno del bucket, NUNCA una URL firmada: una
-- firma guardada en la columna queda muerta, y si acaba en una página
-- cacheada se publica sola.
CREATE TABLE IF NOT EXISTS "realty_pld_documents" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" "RealtyPldDocKind" NOT NULL DEFAULT 'OTRO',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_pld_documents_pkey" PRIMARY KEY ("id")
);

-- Quién consultó qué y cuándo. Es la mitad auditable de la bóveda — la
-- que casi todo el mundo olvida.
--
-- Sin FK a realty_users: una bitácora que se borra con su autor no es una
-- bitácora. Se guarda el nombre EN EL RENGLÓN porque dentro de diez años
-- "el usuario cku3n…" no le dice nada a nadie.
CREATE TABLE IF NOT EXISTS "realty_pld_access_logs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "action" "RealtyPldAccessAction" NOT NULL,
    "fileId" TEXT,
    "documentId" TEXT,
    -- Para DESCARGAR_AVISO: el periodo del que se bajó el archivo.
    "subject" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_pld_access_logs_pkey" PRIMARY KEY ("id")
);

-- El aviso MENSUAL. periodMonth = "AAAA-MM" del mes que se reporta.
--
-- Va ANTES que realty_pld_operations en este archivo porque aquella la
-- referencia; las llaves foráneas van todas al final, así que el orden es
-- solo para que se lea en el sentido correcto.
CREATE TABLE IF NOT EXISTS "realty_pld_notices" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "kind" "RealtyPldNoticeKind" NOT NULL DEFAULT 'NORMAL',
    "status" "RealtyPldNoticeStatus" NOT NULL DEFAULT 'PENDIENTE',
    -- Calculada al crear la fila con el parámetro vigente, al MEDIODÍA del
    -- día de corte: a medianoche, el 17 se pintaba como 16 en toda la
    -- República (ver HORA_DE_CALENDARIO en src/lib/realty/pld/umbrales.ts).
    "dueDate" TIMESTAMP(3) NOT NULL,
    "presentedAt" TIMESTAMP(3),
    "presentedById" TEXT,
    "presentedByName" TEXT,
    -- Acuse que devuelve el portal. Texto libre: el formato lo pone el SAT.
    "acuse" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_pld_notices_pkey" PRIMARY KEY ("id")
);

-- La cara PLD de una operación (realty_deals). NO duplica el monto ni el
-- umbral: eso se calcula en vivo contra el parámetro vigente. Si se
-- guardara, una operación evaluada con la UMA del año pasado seguiría
-- diciendo "no rebasa" para siempre.
--
-- `cashDeclared` es el efectivo declarado A MANO, para la operación cuyos
-- pagos no se registraron en DaleControl. Si está capturado MANDA sobre la
-- suma de los realty_payments en efectivo — no se suman: sumarlos contaría
-- dos veces el mismo billete y levantaría una bandera roja falsa.
CREATE TABLE IF NOT EXISTS "realty_pld_operations" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "cashDeclared" DECIMAL(14,2),
    -- Efectivo por encima del tope: quién lo vio y qué dijo. La bandera
    -- roja NO se apaga; se deja constancia de que se revisó.
    "cashAckAt" TIMESTAMP(3),
    "cashAckById" TEXT,
    "cashAckNote" TEXT,
    -- Alerta urgente ante indicios. `urgentDueAt` se calcula con el plazo
    -- del parámetro, no con un 24 escrito en el código.
    "urgentFlaggedAt" TIMESTAMP(3),
    "urgentReason" TEXT,
    "urgentDueAt" TIMESTAMP(3),
    "urgentDoneAt" TIMESTAMP(3),
    "noticeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_pld_operations_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
--
-- Los dos ÚNICOS no son decoración: sostienen los `upsert` del módulo.
-- Prisma exige el índice COMPLETO para un upsert compuesto, y uno parcial
-- (solo `dealId`, solo `periodMonth`) dejaría que la fila de otra
-- inmobiliaria se pisara.

CREATE UNIQUE INDEX IF NOT EXISTS "realty_pld_files_accountId_contactId_key" ON "realty_pld_files"("accountId", "contactId");
CREATE INDEX IF NOT EXISTS "realty_pld_files_accountId_risk_idx" ON "realty_pld_files"("accountId", "risk");
CREATE INDEX IF NOT EXISTS "realty_pld_files_accountId_pep_idx" ON "realty_pld_files"("accountId", "pep");
CREATE INDEX IF NOT EXISTS "realty_pld_files_contactId_idx" ON "realty_pld_files"("contactId");

CREATE INDEX IF NOT EXISTS "realty_pld_documents_accountId_fileId_idx" ON "realty_pld_documents"("accountId", "fileId");
-- "documentos por vencer" del tablero.
CREATE INDEX IF NOT EXISTS "realty_pld_documents_accountId_expiresAt_idx" ON "realty_pld_documents"("accountId", "expiresAt");
-- Qué papeles ya salieron del plazo de conservación y se pueden borrar.
CREATE INDEX IF NOT EXISTS "realty_pld_documents_accountId_retainUntil_idx" ON "realty_pld_documents"("accountId", "retainUntil");

CREATE INDEX IF NOT EXISTS "realty_pld_access_logs_accountId_createdAt_idx" ON "realty_pld_access_logs"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_pld_access_logs_accountId_fileId_createdAt_idx" ON "realty_pld_access_logs"("accountId", "fileId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_pld_access_logs_documentId_idx" ON "realty_pld_access_logs"("documentId");

CREATE UNIQUE INDEX IF NOT EXISTS "realty_pld_notices_accountId_periodMonth_key" ON "realty_pld_notices"("accountId", "periodMonth");
CREATE INDEX IF NOT EXISTS "realty_pld_notices_accountId_status_dueDate_idx" ON "realty_pld_notices"("accountId", "status", "dueDate");

CREATE UNIQUE INDEX IF NOT EXISTS "realty_pld_operations_accountId_dealId_key" ON "realty_pld_operations"("accountId", "dealId");
CREATE INDEX IF NOT EXISTS "realty_pld_operations_accountId_urgentDueAt_idx" ON "realty_pld_operations"("accountId", "urgentDueAt");
CREATE INDEX IF NOT EXISTS "realty_pld_operations_dealId_idx" ON "realty_pld_operations"("dealId");
CREATE INDEX IF NOT EXISTS "realty_pld_operations_noticeId_idx" ON "realty_pld_operations"("noticeId");


-- ── 4. Llaves foráneas (idempotentes vía pg_constraint) ────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que van todas dentro de un
-- solo DO con su comprobación. Un único delimitador, sin anidar.
--
-- 🔴 CASCADE hacia la cuenta y hacia el contacto, y NO "NO ACTION". Con NO
-- ACTION, borrar una CUENTA entera podía fallar por el orden en que
-- Postgres resuelve los cascades. La retención de diez años NO se hace
-- valer con una FK: se hace valer en la aplicación (los documentos se
-- ARCHIVAN, y DELETE responde 409 mientras no pase `retainUntil`).
--
-- Las dos de la BITÁCORA van en SET NULL a propósito: el renglón sobrevive
-- al expediente y al papel que describe. Una bitácora que se borra con lo
-- que audita no es una bitácora.
DO $realty$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_files_accountId_fkey') THEN
    ALTER TABLE "realty_pld_files" ADD CONSTRAINT "realty_pld_files_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_files_contactId_fkey') THEN
    ALTER TABLE "realty_pld_files" ADD CONSTRAINT "realty_pld_files_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "realty_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_documents_accountId_fkey') THEN
    ALTER TABLE "realty_pld_documents" ADD CONSTRAINT "realty_pld_documents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_documents_fileId_fkey') THEN
    ALTER TABLE "realty_pld_documents" ADD CONSTRAINT "realty_pld_documents_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "realty_pld_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_access_logs_accountId_fkey') THEN
    ALTER TABLE "realty_pld_access_logs" ADD CONSTRAINT "realty_pld_access_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_access_logs_fileId_fkey') THEN
    ALTER TABLE "realty_pld_access_logs" ADD CONSTRAINT "realty_pld_access_logs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "realty_pld_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_access_logs_documentId_fkey') THEN
    ALTER TABLE "realty_pld_access_logs" ADD CONSTRAINT "realty_pld_access_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "realty_pld_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_notices_accountId_fkey') THEN
    ALTER TABLE "realty_pld_notices" ADD CONSTRAINT "realty_pld_notices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_operations_accountId_fkey') THEN
    ALTER TABLE "realty_pld_operations" ADD CONSTRAINT "realty_pld_operations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_operations_dealId_fkey') THEN
    ALTER TABLE "realty_pld_operations" ADD CONSTRAINT "realty_pld_operations_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "realty_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_pld_operations_noticeId_fkey') THEN
    ALTER TABLE "realty_pld_operations" ADD CONSTRAINT "realty_pld_operations_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "realty_pld_notices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$realty$;


-- ── 5. El permiso nuevo, para las cuentas que YA existen ───────────────
--
-- 🔴 POR QUÉ HACE FALTA ESTO. En este vertical `permissionsOverride`
-- REEMPLAZA los defaults del rol, no se suma a ellos. Así que un permiso
-- NUEVO —pld.view, pld.manage— llega solo a quien tenga el arreglo VACÍO.
-- Quien tenga excepciones capturadas se queda sin el módulo… y sin forma
-- de arreglarlo desde la UI: `updateRealtyMemberPermissions` no deja
-- repartir un permiso que el propio llamante no tiene
-- (PERMISSION_OUT_OF_REACH en src/lib/realty/team.ts). El dueño con
-- excepciones no puede dárselo a nadie NI a sí mismo.
--
-- QUÉ HACE: le AGREGA las dos claves a los OWNER y MANAGER que tengan un
-- override no vacío. A esos dos roles el default les da TODO (al MANAGER,
-- todo menos billing), así que esto no regala nada: restituye lo que el
-- rol ya decía. Su override se escribió cuando `pld.*` no existía, así que
-- nadie pudo excluirlo a propósito.
--
-- QUÉ NO HACE: no toca AGENT ni ASSISTANT. Cumplimiento es trabajo de
-- oficial de cumplimiento, no del asesor de piso, y por eso tampoco está
-- en sus defaults. Si una inmobiliaria quiere dárselo a un asesor, se lo
-- da desde Equipo.
--
-- ⚠️ ANTES DE CORRERLO, mira a quién va a tocar:
--
--   SELECT u."id", u."email", u."role", u."permissionsOverride"
--     FROM "realty_users" u
--    WHERE u."role" IN ('OWNER', 'MANAGER')
--      AND array_length(u."permissionsOverride", 1) > 0
--      AND NOT (u."permissionsOverride" @> ARRAY['pld.view']::text[]);
--
-- Es idempotente: el `NOT @>` hace que la segunda pasada no cambie nada.

UPDATE "realty_users"
   SET "permissionsOverride" = "permissionsOverride" || ARRAY['pld.view']::text[]
 WHERE "role" IN ('OWNER', 'MANAGER')
   AND array_length("permissionsOverride", 1) > 0
   AND NOT ("permissionsOverride" @> ARRAY['pld.view']::text[]);

UPDATE "realty_users"
   SET "permissionsOverride" = "permissionsOverride" || ARRAY['pld.manage']::text[]
 WHERE "role" IN ('OWNER', 'MANAGER')
   AND array_length("permissionsOverride", 1) > 0
   AND NOT ("permissionsOverride" @> ARRAY['pld.manage']::text[]);


-- ── 6. La feature del plan ─────────────────────────────────────────────
--
-- `pld` ya viene en el seed de sql/realty.sql (INMOBILIARIA en true, los
-- otros dos en false). Esto es solo la red por si la fila de planes se
-- pobló ANTES de que la llave existiera: en ese caso el gate leería
-- `undefined`, o sea false, y el módulo sería invisible para todos.
--
-- 🔴 Solo rellena la llave si FALTA (`NOT (features ? 'pld')`). Un `pld`
-- puesto en false a mano se respeta: apagar una feature es una decisión
-- comercial y este archivo no la revierte.

UPDATE "realty_plan_configs"
   SET "features" = "features" || '{"pld": true}'::jsonb
 WHERE "planId" = 'INMOBILIARIA'
   AND NOT ("features" ? 'pld');

UPDATE "realty_plan_configs"
   SET "features" = "features" || '{"pld": false}'::jsonb
 WHERE "planId" IN ('PROPIETARIO', 'ASESOR')
   AND NOT ("features" ? 'pld');


-- ── 7. Verificación ────────────────────────────────────────────────────
--
-- Las cinco tablas:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name LIKE 'realty_pld%' ORDER BY table_name;
--
-- Los siete enums:
--   SELECT typname FROM pg_type WHERE typname LIKE 'RealtyPld%' ORDER BY typname;
--
-- Las once llaves foráneas:
--   SELECT conname FROM pg_constraint
--    WHERE conname LIKE 'realty_pld%_fkey' ORDER BY conname;
--
-- Los tres índices ÚNICOS (sin ellos, los upsert del módulo fallan):
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN (
--      'realty_pld_files_accountId_contactId_key',
--      'realty_pld_notices_accountId_periodMonth_key',
--      'realty_pld_operations_accountId_dealId_key'
--    );
--
-- La feature del plan:
--   SELECT "planId", "features"->'pld' FROM "realty_plan_configs" ORDER BY "sortOrder";
--
-- 🔴 Y LO QUE FALTA DESPUÉS DE ESTE ARCHIVO: los umbrales. Sin ellos la
-- pantalla funciona pero NO COMPARA NADA — dice qué falta capturar y sigue
-- dejando integrar expedientes. Se siembran con una sesión de /admin:
--
--   POST /api/realty/pld/parametros
--
-- y se comprueban con GET a la misma ruta (`listo: true`). Después se
-- editan en /admin/inmobiliarias/parametros, sin desplegar nada.
--
--   SELECT "year", "value", "meta"->'pld'
--     FROM "realty_calc_params"
--    WHERE "kind" = 'UMA' AND "stateCode" = 'MX'
--    ORDER BY "effectiveFrom" DESC;
--
-- El bloque nace con `porVerificar: true`: los umbrales salen del brief del
-- vertical y NADIE los ha confrontado contra el texto vigente de la
-- LFPIORPI ni contra la reforma del 27 de marzo de 2026. Mientras esa
-- bandera esté encendida la pantalla lo dice en ámbar. La apaga quien haya
-- cotejado el texto, desde /admin.
-- ═══════════════════════════════════════════════════════════════════════
