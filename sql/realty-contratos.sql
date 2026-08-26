-- ═══════════════════════════════════════════════════════════════════════
-- INMUEBLES · CONTRATOS Y FIRMA ELECTRÓNICA (Ola 2 · T2)
--
-- Las CINCO tablas del módulo, en el mismo formato idempotente que
-- sql/realty.sql. Aplicar a mano en el editor SQL de Supabase.
--
-- ── ESTAS TABLAS TAMBIÉN ESTÁN EN prisma/schema.prisma ────────────────
-- Y no es redundancia: `prisma db push` reconcilia la base con el schema,
-- así que una tabla que solo viviera aquí se la llevaría por delante. En
-- barber eso ya pasó. La regla del vertical —escrita en la cabecera de
-- sql/realty.sql— es "nada vive solo en SQL".
--
-- Los nombres de índice y de constraint de este archivo están escritos
-- A MANO en el schema (`map:`) para que los DOS caminos —correr este .sql
-- o dejar que Prisma cree las tablas— produzcan exactamente la misma base,
-- sin índices duplicados con nombres distintos.
--
-- El módulo las CONSULTA con $queryRaw parametrizado desde
-- src/lib/realty/contracts.ts —el único archivo del repo que las toca—.
--
-- ── ES SEGURO CORRERLO DOS VECES ──────────────────────────────────────
-- Todo es IF NOT EXISTS. Y además el propio módulo aplica este MISMO DDL
-- la primera vez que alguien abre Contratos en una base donde las tablas
-- no están (ensureContractTables en contracts.ts). O sea: correr este
-- archivo a mano no es obligatorio para que el módulo arranque; sirve para
-- dejarlo listo antes de que entre el primer cliente y para que quede la
-- constancia en el repo.
--
-- ── LO QUE NO HAY AQUÍ, A PROPÓSITO ───────────────────────────────────
-- · Ninguna FOREIGN KEY a realty_leases / realty_exclusives / realty_deals.
--   Un contrato FIRMADO es prueba: tiene que sobrevivir a que alguien borre
--   el contrato de renta del que salió. Se guarda el id y se resuelve al
--   leer; si el origen ya no está, el contrato sigue legible.
-- · La ÚNICA cascada es la de realty_accounts (y la de contrato → partes):
--   si la inmobiliaria se va del producto, sus contratos se van con ella
--   —es su expediente, no el nuestro—.
-- · Nada fiscal. Estos son contratos privados entre particulares: no hay
--   CFDI, ni timbrado, ni folio fiscal. El "folio" de aquí es un
--   consecutivo interno de la inmobiliaria.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Plantillas por cuenta ───────────────────────────────────────────
-- UNA por (cuenta, tipo). Si no hay fila, el módulo usa la plantilla base
-- que trae el código (REALTY_BASE_TEMPLATES). Editarla crea la fila; el
-- botón "restaurar" la borra.
CREATE TABLE IF NOT EXISTS "realty_contract_templates" (
    "id"              TEXT NOT NULL,
    "accountId"       TEXT NOT NULL,
    -- ARRENDAMIENTO | EXCLUSIVA | PROMESA | COMISION
    "kind"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "body"            TEXT NOT NULL,
    "version"         INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_contract_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "realty_contract_templates_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "realty_contract_templates_account_kind_key"
  ON "realty_contract_templates" ("accountId", "kind");

-- ── 2. El contrato ─────────────────────────────────────────────────────
-- `body` es un SNAPSHOT: el texto YA resuelto que las partes van a leer y
-- firmar. No se vuelve a renderizar desde la plantilla al mostrarlo — si la
-- inmobiliaria edita su plantilla mañana, este contrato no cambia.
--
-- `documentHash` es sha256 del canónico de ESE snapshot (ver
-- canonicalDocument en src/lib/realty/signature.ts). Es lo que prueba que
-- nadie lo alteró después de la firma.
--
-- `sealedAt` es la línea que no se cruza dos veces: en cuanto se manda a
-- firmar, el cuerpo queda congelado. Todas las escrituras al cuerpo llevan
-- `"sealedAt" IS NULL` en el WHERE, no un if en JavaScript.
CREATE TABLE IF NOT EXISTS "realty_contracts" (
    "id"              TEXT NOT NULL,
    "accountId"       TEXT NOT NULL,
    "kind"            TEXT NOT NULL,
    "folio"           TEXT NOT NULL,
    "title"           TEXT NOT NULL,

    -- Origen. Los tres son opcionales y SIN foreign key (ver cabecera).
    "leaseId"         TEXT,
    "exclusiveId"     TEXT,
    "dealId"          TEXT,
    "propertyId"      TEXT,
    "contactId"       TEXT,

    "body"            TEXT NOT NULL,
    "variables"       TEXT NOT NULL DEFAULT '{}',
    "documentHash"    TEXT NOT NULL,

    -- BORRADOR | ENVIADO | PARCIAL | FIRMADO | ARCHIVADO | ANULADO
    "status"          TEXT NOT NULL DEFAULT 'BORRADOR',

    -- Vigencia del CONTRATO (para el tablero de vencimientos). Se copia del
    -- origen al generar; en un contrato suelto la captura el asesor.
    "effectiveFrom"   TIMESTAMP(3),
    "effectiveTo"     TIMESTAMP(3),

    "sealedAt"        TIMESTAMP(3),
    "signedAt"        TIMESTAMP(3),
    "archivedAt"      TIMESTAMP(3),
    "voidedAt"        TIMESTAMP(3),
    "voidReason"      TEXT,
    -- Cuando se anula por corrección, aquí queda el contrato que lo sustituye.
    "replacedById"    TEXT,

    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_contracts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "realty_contracts_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE
);

-- El folio es consecutivo POR CUENTA. El único evita que dos asesores
-- guardando a la vez se lleven el mismo número (el MAX + advisory lock de
-- nextFolio hace el resto).
CREATE UNIQUE INDEX IF NOT EXISTS "realty_contracts_account_folio_key"
  ON "realty_contracts" ("accountId", "folio");

CREATE INDEX IF NOT EXISTS "realty_contracts_account_status_idx"
  ON "realty_contracts" ("accountId", "status", "createdAt");
-- El tablero de vencimientos recorre la cuenta entera por fecha de fin.
CREATE INDEX IF NOT EXISTS "realty_contracts_account_effectiveto_idx"
  ON "realty_contracts" ("accountId", "effectiveTo");
-- La bóveda: "todos los contratos de este inmueble" y "…de este contacto".
CREATE INDEX IF NOT EXISTS "realty_contracts_account_property_idx"
  ON "realty_contracts" ("accountId", "propertyId");
CREATE INDEX IF NOT EXISTS "realty_contracts_account_contact_idx"
  ON "realty_contracts" ("accountId", "contactId");
CREATE INDEX IF NOT EXISTS "realty_contracts_account_lease_idx"
  ON "realty_contracts" ("accountId", "leaseId");

-- ── 3. Quién firma ─────────────────────────────────────────────────────
-- El contrato NO queda firmado hasta que todas las partes con
-- `mustSign = true` tienen `signedAt`. El tablero enseña quién falta.
CREATE TABLE IF NOT EXISTS "realty_contract_parties" (
    "id"          TEXT NOT NULL,
    "accountId"   TEXT NOT NULL,
    "contractId"  TEXT NOT NULL,
    -- ARRENDADOR | INQUILINO | AVAL | PROPIETARIO | INMOBILIARIA |
    -- COMPRADOR | VENDEDOR | ASESOR
    "role"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "email"       TEXT,
    "phone"       TEXT,
    "contactId"   TEXT,
    "mustSign"    BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "signedAt"    TIMESTAMP(3),
    "signatureId" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_contract_parties_pkey" PRIMARY KEY ("id"),
    -- Ésta SÍ cascadea: una parte sin contrato no significa nada. Y borrar
    -- el contrato solo es posible mientras es BORRADOR (ver contracts.ts).
    CONSTRAINT "realty_contract_parties_contract_fkey"
      FOREIGN KEY ("contractId") REFERENCES "realty_contracts"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "realty_contract_parties_contract_idx"
  ON "realty_contract_parties" ("contractId", "sortOrder");
CREATE INDEX IF NOT EXISTS "realty_contract_parties_account_idx"
  ON "realty_contract_parties" ("accountId");

-- ── 4. La evidencia de cada firma ──────────────────────────────────────
-- 🔴 ESTA TABLA NO SE ACTUALIZA NUNCA. Solo INSERT y SELECT. No hay una
-- sola sentencia UPDATE ni DELETE contra ella en todo el módulo, y el
-- único por (contractId, partyId) hace que un segundo intento choque en la
-- base en vez de pisar la primera firma.
--
-- `documentHash` se copia aquí a propósito, duplicado del contrato: es el
-- hash del texto TAL COMO ESTABA cuando esta persona firmó. Si algún día no
-- coincide con el del contrato, la evidencia lo delata sola.
--
-- `strokePath` vive en el bucket privado realty-files. `strokeInline` es la
-- red de abajo: si el bucket falla justo en ese momento, el trazo se guarda
-- aquí como data URL antes que perderlo. Una de las dos SIEMPRE tiene algo.
CREATE TABLE IF NOT EXISTS "realty_contract_signatures" (
    "id"           TEXT NOT NULL,
    "accountId"    TEXT NOT NULL,
    "contractId"   TEXT NOT NULL,
    "partyId"      TEXT NOT NULL,
    "signerName"   TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "strokePath"   TEXT,
    "strokeInline" TEXT,
    "strokeHash"   TEXT NOT NULL,
    "ip"           TEXT,
    "userAgent"    TEXT,
    -- Reloj del SERVIDOR. Jamás una fecha que venga del dispositivo.
    "signedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenId"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_contract_signatures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "realty_contract_signatures_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "realty_contract_signatures_party_key"
  ON "realty_contract_signatures" ("contractId", "partyId");
CREATE INDEX IF NOT EXISTS "realty_contract_signatures_account_idx"
  ON "realty_contract_signatures" ("accountId", "signedAt");

-- ── 5. La liga de firma ────────────────────────────────────────────────
-- 🔴 EL TOKEN EN CLARO NO SE GUARDA. Solo su sha256, igual que
-- realty_client_auth_tokens.codeHash. Quien se lleve un volcado de la base
-- no puede firmar por nadie: no hay forma de reconstruir la liga.
--
-- `attempts` cuenta los intentos de FIRMA fallidos, no las aperturas: el
-- token de 256 bits no se adivina a fuerza bruta, lo que hay que frenar es
-- que una liga filtrada se use a golpes.
CREATE TABLE IF NOT EXISTS "realty_signature_tokens" (
    "id"         TEXT NOT NULL,
    "accountId"  TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "partyId"    TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "attempts"   INTEGER NOT NULL DEFAULT 0,
    "usedAt"     TIMESTAMP(3),
    "revokedAt"  TIMESTAMP(3),
    "sentAt"     TIMESTAMP(3),
    -- whatsapp | correo | copiada
    "sentVia"    TEXT,
    "viewedAt"   TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_signature_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "realty_signature_tokens_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE
);

-- Único y no solo índice: es por donde entra la página pública.
CREATE UNIQUE INDEX IF NOT EXISTS "realty_signature_tokens_hash_key"
  ON "realty_signature_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "realty_signature_tokens_contract_idx"
  ON "realty_signature_tokens" ("contractId", "partyId");
CREATE INDEX IF NOT EXISTS "realty_signature_tokens_account_idx"
  ON "realty_signature_tokens" ("accountId", "expiresAt");
