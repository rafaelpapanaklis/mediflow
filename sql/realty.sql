-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl INMUEBLES — schema completo del vertical (producto separado).
--
-- GENERADO desde prisma/schema.prisma (bloque Realty*) y hecho idempotente:
-- cada bloque comprueba existencia antes de crear, así que correrlo varias
-- veces no produce errores ni duplicados.
--
-- Aplicar manualmente en Supabase (SQL editor). Es la ÚNICA fuente de
-- verdad del SQL del vertical: NO hay tablas que vivan solo aquí — todas
-- están también en prisma/schema.prisma, así que un `prisma db push` no
-- se las lleva por delante (en barber eso sí pasó).
--
-- Nota sobre $$: usamos un único delimitador `$realty$` y NUNCA bloques DO
-- anidados (el parser SQL de Supabase rompe con $$ anidado).
--
-- Nota sobre fechas: todas las columnas son TIMESTAMP(3) SIN zona. Si
-- alguna ola necesita un constraint de exclusión sobre rangos (p. ej. que
-- dos contratos no se encimen en el mismo inmueble), tiene que usar
-- `tsrange`, JAMÁS `tstzrange`: con timestamptz Postgres rechaza el índice
-- con "functions in index expression must be marked IMMUTABLE".
--
-- Contenido: 35 enums · 40 tablas · 101 índices · 86 llaves foráneas
--            + seed de los 3 planes + bucket privado realty-files.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Enums ───────────────────────────────────────────────────────────
DO $realty$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyMode') THEN
    CREATE TYPE "RealtyMode" AS ENUM ('AGENCY', 'AGENT', 'OWNER');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPlan') THEN
    CREATE TYPE "RealtyPlan" AS ENUM ('PROPIETARIO', 'ASESOR', 'INMOBILIARIA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyRole') THEN
    CREATE TYPE "RealtyRole" AS ENUM ('OWNER', 'MANAGER', 'AGENT', 'ASSISTANT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyWhatsappSender') THEN
    CREATE TYPE "RealtyWhatsappSender" AS ENUM ('PLATFORM', 'OWN_WABA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPropertyKind') THEN
    CREATE TYPE "RealtyPropertyKind" AS ENUM ('CASA', 'DEPARTAMENTO', 'TERRENO', 'BODEGA', 'LOCAL', 'EDIFICIO', 'OFICINA', 'RANCHO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyOperation') THEN
    CREATE TYPE "RealtyOperation" AS ENUM ('VENTA', 'RENTA', 'AMBAS');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPropertyStatus') THEN
    CREATE TYPE "RealtyPropertyStatus" AS ENUM ('DISPONIBLE', 'APARTADO', 'VENDIDO', 'RENTADO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyCurrency') THEN
    CREATE TYPE "RealtyCurrency" AS ENUM ('MXN', 'USD');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyTourKind') THEN
    CREATE TYPE "RealtyTourKind" AS ENUM ('TOUR_3D', 'TOUR_360', 'PANO_PROPIA', 'VIDEO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyDocumentKind') THEN
    CREATE TYPE "RealtyDocumentKind" AS ENUM ('ESCRITURA', 'PREDIAL', 'REGIMEN', 'IDENTIFICACION', 'OTRO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyContactKind') THEN
    CREATE TYPE "RealtyContactKind" AS ENUM ('PROSPECTO', 'PROPIETARIO', 'INQUILINO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyLeadStage') THEN
    CREATE TYPE "RealtyLeadStage" AS ENUM ('NUEVO', 'CONTACTADO', 'CALIFICADO', 'VISITA', 'OFERTA', 'CIERRE', 'PERDIDO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyCreditKind') THEN
    CREATE TYPE "RealtyCreditKind" AS ENUM ('INFONAVIT', 'FOVISSSTE', 'BANCARIO', 'CONTADO', 'NINGUNO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyLeadActivityKind') THEN
    CREATE TYPE "RealtyLeadActivityKind" AS ENUM ('NOTA', 'LLAMADA', 'WHATSAPP', 'CORREO', 'VISITA', 'CAMBIO_ETAPA', 'ASIGNACION');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyVisitStatus') THEN
    CREATE TYPE "RealtyVisitStatus" AS ENUM ('PROGRAMADA', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'NO_ASISTIO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyLeaseStatus') THEN
    CREATE TYPE "RealtyLeaseStatus" AS ENUM ('BORRADOR', 'ACTIVO', 'VENCIDO', 'TERMINADO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyLeasePartyRole') THEN
    CREATE TYPE "RealtyLeasePartyRole" AS ENUM ('INQUILINO', 'AVAL', 'FIADOR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyScreeningStatus') THEN
    CREATE TYPE "RealtyScreeningStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyIncreaseRule') THEN
    CREATE TYPE "RealtyIncreaseRule" AS ENUM ('INPC', 'FIJO', 'NINGUNO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyChargeStatus') THEN
    CREATE TYPE "RealtyChargeStatus" AS ENUM ('PENDIENTE', 'PARCIAL', 'PAGADO', 'VENCIDO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPaymentMethod') THEN
    CREATE TYPE "RealtyPaymentMethod" AS ENUM ('EFECTIVO', 'SPEI', 'TARJETA', 'OTRO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyDepositStatus') THEN
    CREATE TYPE "RealtyDepositStatus" AS ENUM ('RETENIDO', 'DEVUELTO', 'APLICADO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyMaintenanceStatus') THEN
    CREATE TYPE "RealtyMaintenanceStatus" AS ENUM ('ABIERTO', 'EN_PROCESO', 'RESUELTO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyExpenseKind') THEN
    CREATE TYPE "RealtyExpenseKind" AS ENUM ('PREDIAL', 'AGUA', 'MANTENIMIENTO', 'REPARACION', 'OTRO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyInventoryCheckKind') THEN
    CREATE TYPE "RealtyInventoryCheckKind" AS ENUM ('ENTRADA', 'SALIDA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyDealKind') THEN
    CREATE TYPE "RealtyDealKind" AS ENUM ('VENTA', 'RENTA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyDealStatus') THEN
    CREATE TYPE "RealtyDealStatus" AS ENUM ('EN_PROCESO', 'CERRADO', 'CANCELADO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyCommissionParty') THEN
    CREATE TYPE "RealtyCommissionParty" AS ENUM ('CAPTADOR', 'COLOCADOR', 'OFICINA', 'FRANQUICIA', 'EXTERNO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyPortalListingStatus') THEN
    CREATE TYPE "RealtyPortalListingStatus" AS ENUM ('BORRADOR', 'PUBLICADO', 'PAUSADO', 'ERROR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyMessageDirection') THEN
    CREATE TYPE "RealtyMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyMessageStatus') THEN
    CREATE TYPE "RealtyMessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyTicketStatus') THEN
    CREATE TYPE "RealtyTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_REPLY', 'CLOSED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyTicketPriority') THEN
    CREATE TYPE "RealtyTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyTicketAuthor') THEN
    CREATE TYPE "RealtyTicketAuthor" AS ENUM ('AGENCY', 'ADMIN');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RealtyCalcParamKind') THEN
    CREATE TYPE "RealtyCalcParamKind" AS ENUM ('ISAI', 'UMA', 'UDI', 'INPC', 'INFONAVIT', 'FOVISSSTE');
  END IF;
END
$realty$;


-- ── 2. Tablas ──────────────────────────────────────────────────────────
-- accountId está en TODAS las tablas de negocio a propósito (ver la
-- cabecera del bloque en prisma/schema.prisma): `include` no es un JOIN,
-- así que sin la columna no se puede filtrar un hijo por el tenant de su
-- padre en un solo where. Las dos únicas sin accountId son de PLATAFORMA:
-- realty_plan_configs y realty_calc_params.

CREATE TABLE IF NOT EXISTS "realty_accounts" (
    "id" TEXT NOT NULL,
    "mode" "RealtyMode" NOT NULL DEFAULT 'AGENCY',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "locale" TEXT NOT NULL DEFAULT 'es',
    "logoUrl" TEXT,
    "teamSize" TEXT,
    "plan" "RealtyPlan" NOT NULL DEFAULT 'PROPIETARIO',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'pending_payment',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "licenseNumber" TEXT,
    "licenseState" TEXT,
    "licenseExpiresAt" TIMESTAMP(3),
    "whatsappSenderMode" "RealtyWhatsappSender" NOT NULL DEFAULT 'PLATFORM',
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "whatsappToken" TEXT,
    "whatsappVerifiedAt" TIMESTAMP(3),
    "messageQuota" INTEGER,
    "messagesUsedPeriod" INTEGER NOT NULL DEFAULT 0,
    "messagesPeriodStart" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_users" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "RealtyRole" NOT NULL DEFAULT 'OWNER',
    "permissionsOverride" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publicProfileEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_offices" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "phone" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_offices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_user_office_access" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_user_office_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_agent_profiles" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "realtyUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "bio" TEXT,
    "zones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credentials" JSONB,
    "socials" JSONB,
    "publicSlug" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_agent_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_properties" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "officeId" TEXT,
    "assignedUserId" TEXT,
    "ownerId" TEXT,
    "kind" "RealtyPropertyKind" NOT NULL DEFAULT 'CASA',
    "operation" "RealtyOperation" NOT NULL DEFAULT 'VENTA',
    "status" "RealtyPropertyStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" "RealtyCurrency" NOT NULL DEFAULT 'MXN',
    "rentPrice" DECIMAL(14,2),
    "maintenanceFee" DECIMAL(14,2),
    "landM2" DECIMAL(12,2),
    "builtM2" DECIMAL(10,2),
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "halfBathrooms" INTEGER,
    "parking" INTEGER,
    "ageYears" INTEGER,
    "amenities" JSONB,
    "address" TEXT,
    "colonia" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "showExactAddress" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "internalNotes" TEXT,
    "commissionPct" DECIMAL(5,2),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publicUrlSlug" TEXT,
    "shortTermFolio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_properties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_property_photos" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "watermarked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_property_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_property_tours" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "RealtyTourKind" NOT NULL DEFAULT 'TOUR_360',
    "provider" TEXT NOT NULL DEFAULT 'propio',
    "externalUrl" TEXT,
    "fileUrl" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_property_tours_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_property_documents" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "RealtyDocumentKind" NOT NULL DEFAULT 'OTRO',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_property_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_property_owners" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "rfc" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_property_owners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_exclusives" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL,
    "signedDocUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_exclusives_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_contacts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "kind" "RealtyContactKind" NOT NULL DEFAULT 'PROSPECTO',
    "source" TEXT,
    "assignedUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_leads" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "propertyId" TEXT,
    "portal" TEXT,
    "stage" "RealtyLeadStage" NOT NULL DEFAULT 'NUEVO',
    "lostReason" TEXT,
    "budgetMin" DECIMAL(14,2),
    "budgetMax" DECIMAL(14,2),
    "creditKind" "RealtyCreditKind" NOT NULL DEFAULT 'NINGUNO',
    "firstResponseAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_lead_activities" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" "RealtyLeadActivityKind" NOT NULL DEFAULT 'NOTA',
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_lead_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_search_profiles" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kinds" JSONB,
    "operation" "RealtyOperation" NOT NULL DEFAULT 'VENTA',
    "zones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budgetMin" DECIMAL(14,2),
    "budgetMax" DECIMAL(14,2),
    "bedroomsMin" INTEGER,
    "notifyByWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_search_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_tasks" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "propertyId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_visits" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "leadId" TEXT,
    "userId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "RealtyVisitStatus" NOT NULL DEFAULT 'PROGRAMADA',
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_visits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_keys" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "holderUserId" TEXT,
    "holderNote" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_leases" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "rentAmount" DECIMAL(14,2) NOT NULL,
    "currency" "RealtyCurrency" NOT NULL DEFAULT 'MXN',
    "paymentDay" INTEGER NOT NULL DEFAULT 1,
    "depositAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "increaseRule" "RealtyIncreaseRule" NOT NULL DEFAULT 'NINGUNO',
    "increasePct" DECIMAL(5,2),
    "status" "RealtyLeaseStatus" NOT NULL DEFAULT 'BORRADOR',
    "signedDocUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_leases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_lease_parties" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "role" "RealtyLeasePartyRole" NOT NULL DEFAULT 'INQUILINO',
    "contactId" TEXT NOT NULL,
    "screeningStatus" "RealtyScreeningStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_lease_parties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_rent_charges" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "RealtyChargeStatus" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_rent_charges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_payments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "chargeId" TEXT,
    "leaseId" TEXT,
    "dealId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "RealtyPaymentMethod" NOT NULL DEFAULT 'EFECTIVO',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_deposits" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "RealtyDepositStatus" NOT NULL DEFAULT 'RETENIDO',
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_deposits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_maintenances" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "leaseId" TEXT,
    "reportedBy" TEXT,
    "description" TEXT NOT NULL,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RealtyMaintenanceStatus" NOT NULL DEFAULT 'ABIERTO',
    "vendorName" TEXT,
    "cost" DECIMAL(14,2),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_maintenances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_expenses" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "RealtyExpenseKind" NOT NULL DEFAULT 'OTRO',
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_inventory_checks" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "kind" "RealtyInventoryCheckKind" NOT NULL DEFAULT 'ENTRADA',
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_inventory_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_inventory_items" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_inventory_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_deals" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "RealtyDealKind" NOT NULL DEFAULT 'VENTA',
    "contactId" TEXT,
    "closedAt" TIMESTAMP(3),
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "RealtyDealStatus" NOT NULL DEFAULT 'EN_PROCESO',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_deals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_commission_splits" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "realtyUserId" TEXT,
    "party" "RealtyCommissionParty" NOT NULL DEFAULT 'COLOCADOR',
    "pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "externalName" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_commission_splits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_landing_configs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'clasica',
    "data" JSONB NOT NULL DEFAULT '{}',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_landing_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_portal_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "apiKey" TEXT,
    "maxListings" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_portal_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_portal_listings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "externalId" TEXT,
    "status" "RealtyPortalListingStatus" NOT NULL DEFAULT 'BORRADOR',
    "lastPushedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_portal_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_threads" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "phone" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_messages" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "RealtyMessageDirection" NOT NULL DEFAULT 'OUTBOUND',
    "body" TEXT,
    "mediaUrl" TEXT,
    "templateName" TEXT,
    "externalId" TEXT,
    "status" "RealtyMessageStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" INTEGER,
    "errorTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_plan_configs" (
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" DECIMAL(10,2) NOT NULL,
    "priceYearly" DECIMAL(10,2),
    "maxUsers" INTEGER NOT NULL DEFAULT 1,
    "maxOffices" INTEGER NOT NULL DEFAULT 1,
    "maxProperties" INTEGER NOT NULL DEFAULT -1,
    "storageQuotaMb" INTEGER NOT NULL DEFAULT 2048,
    "messageQuota" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL,
    "stripeLookupKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_plan_configs_pkey" PRIMARY KEY ("planId")
);

CREATE TABLE IF NOT EXISTS "realty_client_auth_tokens" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_client_auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_support_tickets" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'DUDA',
    "status" "RealtyTicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "RealtyTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_support_messages" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" "RealtyTicketAuthor" NOT NULL DEFAULT 'AGENCY',
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_support_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_admin_actions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "adminUserId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realty_admin_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "realty_calc_params" (
    "id" TEXT NOT NULL,
    "kind" "RealtyCalcParamKind" NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT 'MX',
    "year" INTEGER NOT NULL,
    "value" DECIMAL(14,6) NOT NULL,
    "meta" JSONB,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realty_calc_params_pkey" PRIMARY KEY ("id")
);


-- ── 3. Índices ─────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "realty_accounts_slug_key" ON "realty_accounts"("slug");
CREATE INDEX IF NOT EXISTS "realty_accounts_subscriptionStatus_idx" ON "realty_accounts"("subscriptionStatus");
CREATE INDEX IF NOT EXISTS "realty_users_accountId_active_idx" ON "realty_users"("accountId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_users_supabaseId_accountId_key" ON "realty_users"("supabaseId", "accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_users_accountId_email_key" ON "realty_users"("accountId", "email");
CREATE INDEX IF NOT EXISTS "realty_offices_accountId_isActive_idx" ON "realty_offices"("accountId", "isActive");
CREATE INDEX IF NOT EXISTS "realty_user_office_access_accountId_idx" ON "realty_user_office_access"("accountId");
CREATE INDEX IF NOT EXISTS "realty_user_office_access_officeId_idx" ON "realty_user_office_access"("officeId");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_user_office_access_userId_officeId_key" ON "realty_user_office_access"("userId", "officeId");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_agent_profiles_realtyUserId_key" ON "realty_agent_profiles"("realtyUserId");
CREATE INDEX IF NOT EXISTS "realty_agent_profiles_accountId_active_idx" ON "realty_agent_profiles"("accountId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_agent_profiles_accountId_publicSlug_key" ON "realty_agent_profiles"("accountId", "publicSlug");
CREATE INDEX IF NOT EXISTS "realty_properties_accountId_status_idx" ON "realty_properties"("accountId", "status");
CREATE INDEX IF NOT EXISTS "realty_properties_accountId_createdAt_idx" ON "realty_properties"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_properties_accountId_operation_kind_idx" ON "realty_properties"("accountId", "operation", "kind");
CREATE INDEX IF NOT EXISTS "realty_properties_accountId_operation_status_idx" ON "realty_properties"("accountId", "operation", "status");
CREATE INDEX IF NOT EXISTS "realty_properties_accountId_assignedUserId_idx" ON "realty_properties"("accountId", "assignedUserId");
CREATE INDEX IF NOT EXISTS "realty_properties_accountId_city_colonia_idx" ON "realty_properties"("accountId", "city", "colonia");
CREATE INDEX IF NOT EXISTS "realty_properties_officeId_idx" ON "realty_properties"("officeId");
CREATE INDEX IF NOT EXISTS "realty_properties_ownerId_idx" ON "realty_properties"("ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_properties_accountId_publicUrlSlug_key" ON "realty_properties"("accountId", "publicUrlSlug");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_properties_accountId_shortTermFolio_key" ON "realty_properties"("accountId", "shortTermFolio");
CREATE INDEX IF NOT EXISTS "realty_property_photos_accountId_propertyId_sortOrder_idx" ON "realty_property_photos"("accountId", "propertyId", "sortOrder");
CREATE INDEX IF NOT EXISTS "realty_property_photos_propertyId_isCover_idx" ON "realty_property_photos"("propertyId", "isCover");
CREATE INDEX IF NOT EXISTS "realty_property_tours_accountId_propertyId_sortOrder_idx" ON "realty_property_tours"("accountId", "propertyId", "sortOrder");
CREATE INDEX IF NOT EXISTS "realty_property_documents_accountId_propertyId_idx" ON "realty_property_documents"("accountId", "propertyId");
CREATE INDEX IF NOT EXISTS "realty_property_owners_accountId_name_idx" ON "realty_property_owners"("accountId", "name");
CREATE INDEX IF NOT EXISTS "realty_property_owners_accountId_phone_idx" ON "realty_property_owners"("accountId", "phone");
CREATE INDEX IF NOT EXISTS "realty_exclusives_accountId_endsAt_idx" ON "realty_exclusives"("accountId", "endsAt");
CREATE INDEX IF NOT EXISTS "realty_exclusives_accountId_propertyId_endsAt_idx" ON "realty_exclusives"("accountId", "propertyId", "endsAt");
CREATE INDEX IF NOT EXISTS "realty_exclusives_ownerId_idx" ON "realty_exclusives"("ownerId");
CREATE INDEX IF NOT EXISTS "realty_contacts_accountId_kind_idx" ON "realty_contacts"("accountId", "kind");
CREATE INDEX IF NOT EXISTS "realty_contacts_accountId_phone_idx" ON "realty_contacts"("accountId", "phone");
CREATE INDEX IF NOT EXISTS "realty_contacts_accountId_name_idx" ON "realty_contacts"("accountId", "name");
CREATE INDEX IF NOT EXISTS "realty_contacts_accountId_assignedUserId_idx" ON "realty_contacts"("accountId", "assignedUserId");
CREATE INDEX IF NOT EXISTS "realty_leads_accountId_stage_idx" ON "realty_leads"("accountId", "stage");
CREATE INDEX IF NOT EXISTS "realty_leads_accountId_assignedUserId_stage_idx" ON "realty_leads"("accountId", "assignedUserId", "stage");
CREATE INDEX IF NOT EXISTS "realty_leads_accountId_createdAt_idx" ON "realty_leads"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_leads_contactId_idx" ON "realty_leads"("contactId");
CREATE INDEX IF NOT EXISTS "realty_leads_propertyId_idx" ON "realty_leads"("propertyId");
CREATE INDEX IF NOT EXISTS "realty_lead_activities_accountId_leadId_createdAt_idx" ON "realty_lead_activities"("accountId", "leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_search_profiles_accountId_operation_idx" ON "realty_search_profiles"("accountId", "operation");
CREATE INDEX IF NOT EXISTS "realty_search_profiles_contactId_idx" ON "realty_search_profiles"("contactId");
CREATE INDEX IF NOT EXISTS "realty_tasks_accountId_userId_done_dueAt_idx" ON "realty_tasks"("accountId", "userId", "done", "dueAt");
CREATE INDEX IF NOT EXISTS "realty_tasks_accountId_dueAt_idx" ON "realty_tasks"("accountId", "dueAt");
CREATE INDEX IF NOT EXISTS "realty_tasks_leadId_idx" ON "realty_tasks"("leadId");
CREATE INDEX IF NOT EXISTS "realty_tasks_propertyId_idx" ON "realty_tasks"("propertyId");
CREATE INDEX IF NOT EXISTS "realty_visits_accountId_scheduledAt_idx" ON "realty_visits"("accountId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "realty_visits_accountId_userId_scheduledAt_idx" ON "realty_visits"("accountId", "userId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "realty_visits_propertyId_scheduledAt_idx" ON "realty_visits"("propertyId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "realty_visits_leadId_idx" ON "realty_visits"("leadId");
CREATE INDEX IF NOT EXISTS "realty_keys_accountId_returnedAt_idx" ON "realty_keys"("accountId", "returnedAt");
CREATE INDEX IF NOT EXISTS "realty_keys_accountId_propertyId_returnedAt_idx" ON "realty_keys"("accountId", "propertyId", "returnedAt");
CREATE INDEX IF NOT EXISTS "realty_keys_accountId_holderUserId_returnedAt_idx" ON "realty_keys"("accountId", "holderUserId", "returnedAt");
CREATE INDEX IF NOT EXISTS "realty_leases_accountId_status_idx" ON "realty_leases"("accountId", "status");
CREATE INDEX IF NOT EXISTS "realty_leases_accountId_endsAt_idx" ON "realty_leases"("accountId", "endsAt");
CREATE INDEX IF NOT EXISTS "realty_leases_propertyId_status_idx" ON "realty_leases"("propertyId", "status");
CREATE INDEX IF NOT EXISTS "realty_lease_parties_accountId_leaseId_idx" ON "realty_lease_parties"("accountId", "leaseId");
CREATE INDEX IF NOT EXISTS "realty_lease_parties_contactId_idx" ON "realty_lease_parties"("contactId");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_lease_parties_leaseId_contactId_role_key" ON "realty_lease_parties"("leaseId", "contactId", "role");
CREATE INDEX IF NOT EXISTS "realty_rent_charges_accountId_status_dueAt_idx" ON "realty_rent_charges"("accountId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "realty_rent_charges_accountId_dueAt_idx" ON "realty_rent_charges"("accountId", "dueAt");
CREATE INDEX IF NOT EXISTS "realty_rent_charges_accountId_periodMonth_idx" ON "realty_rent_charges"("accountId", "periodMonth");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_rent_charges_leaseId_periodMonth_key" ON "realty_rent_charges"("leaseId", "periodMonth");
CREATE INDEX IF NOT EXISTS "realty_payments_accountId_paidAt_idx" ON "realty_payments"("accountId", "paidAt");
CREATE INDEX IF NOT EXISTS "realty_payments_chargeId_idx" ON "realty_payments"("chargeId");
CREATE INDEX IF NOT EXISTS "realty_payments_leaseId_idx" ON "realty_payments"("leaseId");
CREATE INDEX IF NOT EXISTS "realty_payments_dealId_idx" ON "realty_payments"("dealId");
CREATE INDEX IF NOT EXISTS "realty_deposits_accountId_status_idx" ON "realty_deposits"("accountId", "status");
CREATE INDEX IF NOT EXISTS "realty_deposits_leaseId_idx" ON "realty_deposits"("leaseId");
CREATE INDEX IF NOT EXISTS "realty_maintenances_accountId_status_createdAt_idx" ON "realty_maintenances"("accountId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_maintenances_propertyId_status_idx" ON "realty_maintenances"("propertyId", "status");
CREATE INDEX IF NOT EXISTS "realty_maintenances_leaseId_idx" ON "realty_maintenances"("leaseId");
CREATE INDEX IF NOT EXISTS "realty_expenses_accountId_paidAt_idx" ON "realty_expenses"("accountId", "paidAt");
CREATE INDEX IF NOT EXISTS "realty_expenses_propertyId_kind_paidAt_idx" ON "realty_expenses"("propertyId", "kind", "paidAt");
CREATE INDEX IF NOT EXISTS "realty_inventory_checks_accountId_leaseId_kind_idx" ON "realty_inventory_checks"("accountId", "leaseId", "kind");
CREATE INDEX IF NOT EXISTS "realty_inventory_items_accountId_checkId_idx" ON "realty_inventory_items"("accountId", "checkId");
CREATE INDEX IF NOT EXISTS "realty_deals_accountId_status_closedAt_idx" ON "realty_deals"("accountId", "status", "closedAt");
CREATE INDEX IF NOT EXISTS "realty_deals_accountId_closedAt_idx" ON "realty_deals"("accountId", "closedAt");
CREATE INDEX IF NOT EXISTS "realty_deals_propertyId_idx" ON "realty_deals"("propertyId");
CREATE INDEX IF NOT EXISTS "realty_deals_contactId_idx" ON "realty_deals"("contactId");
CREATE INDEX IF NOT EXISTS "realty_commission_splits_accountId_dealId_idx" ON "realty_commission_splits"("accountId", "dealId");
CREATE INDEX IF NOT EXISTS "realty_commission_splits_accountId_realtyUserId_paidAt_idx" ON "realty_commission_splits"("accountId", "realtyUserId", "paidAt");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_landing_configs_accountId_key" ON "realty_landing_configs"("accountId");
CREATE INDEX IF NOT EXISTS "realty_portal_accounts_accountId_active_idx" ON "realty_portal_accounts"("accountId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_portal_accounts_accountId_portal_key" ON "realty_portal_accounts"("accountId", "portal");
CREATE INDEX IF NOT EXISTS "realty_portal_listings_accountId_portal_status_idx" ON "realty_portal_listings"("accountId", "portal", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_portal_listings_propertyId_portal_key" ON "realty_portal_listings"("propertyId", "portal");
CREATE INDEX IF NOT EXISTS "realty_threads_accountId_archived_lastMessageAt_idx" ON "realty_threads"("accountId", "archived", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "realty_threads_contactId_idx" ON "realty_threads"("contactId");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_threads_accountId_phone_key" ON "realty_threads"("accountId", "phone");
CREATE INDEX IF NOT EXISTS "realty_messages_accountId_threadId_createdAt_idx" ON "realty_messages"("accountId", "threadId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_messages_externalId_idx" ON "realty_messages"("externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_messages_threadId_externalId_key" ON "realty_messages"("threadId", "externalId");
CREATE INDEX IF NOT EXISTS "realty_client_auth_tokens_accountId_phone_expiresAt_idx" ON "realty_client_auth_tokens"("accountId", "phone", "expiresAt");
CREATE INDEX IF NOT EXISTS "realty_support_tickets_accountId_status_lastMessageAt_idx" ON "realty_support_tickets"("accountId", "status", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "realty_support_tickets_status_lastMessageAt_idx" ON "realty_support_tickets"("status", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "realty_support_messages_accountId_ticketId_createdAt_idx" ON "realty_support_messages"("accountId", "ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_admin_actions_accountId_createdAt_idx" ON "realty_admin_actions"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "realty_calc_params_kind_stateCode_year_idx" ON "realty_calc_params"("kind", "stateCode", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "realty_calc_params_kind_stateCode_year_effectiveFrom_key" ON "realty_calc_params"("kind", "stateCode", "year", "effectiveFrom");


-- ── 4. Llaves foráneas (idempotentes vía pg_constraint) ────────────────
-- ADD CONSTRAINT no soporta IF NOT EXISTS, así que van todas dentro de un
-- solo DO con su comprobación. Un único delimitador, sin anidar.
DO $realty$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_users_accountId_fkey') THEN
    ALTER TABLE "realty_users" ADD CONSTRAINT "realty_users_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_offices_accountId_fkey') THEN
    ALTER TABLE "realty_offices" ADD CONSTRAINT "realty_offices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_user_office_access_accountId_fkey') THEN
    ALTER TABLE "realty_user_office_access" ADD CONSTRAINT "realty_user_office_access_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_user_office_access_userId_fkey') THEN
    ALTER TABLE "realty_user_office_access" ADD CONSTRAINT "realty_user_office_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "realty_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_user_office_access_officeId_fkey') THEN
    ALTER TABLE "realty_user_office_access" ADD CONSTRAINT "realty_user_office_access_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "realty_offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_agent_profiles_accountId_fkey') THEN
    ALTER TABLE "realty_agent_profiles" ADD CONSTRAINT "realty_agent_profiles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_agent_profiles_realtyUserId_fkey') THEN
    ALTER TABLE "realty_agent_profiles" ADD CONSTRAINT "realty_agent_profiles_realtyUserId_fkey" FOREIGN KEY ("realtyUserId") REFERENCES "realty_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_properties_accountId_fkey') THEN
    ALTER TABLE "realty_properties" ADD CONSTRAINT "realty_properties_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_properties_officeId_fkey') THEN
    ALTER TABLE "realty_properties" ADD CONSTRAINT "realty_properties_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "realty_offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_properties_assignedUserId_fkey') THEN
    ALTER TABLE "realty_properties" ADD CONSTRAINT "realty_properties_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_properties_ownerId_fkey') THEN
    ALTER TABLE "realty_properties" ADD CONSTRAINT "realty_properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "realty_property_owners"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_property_photos_accountId_fkey') THEN
    ALTER TABLE "realty_property_photos" ADD CONSTRAINT "realty_property_photos_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_property_photos_propertyId_fkey') THEN
    ALTER TABLE "realty_property_photos" ADD CONSTRAINT "realty_property_photos_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_property_tours_accountId_fkey') THEN
    ALTER TABLE "realty_property_tours" ADD CONSTRAINT "realty_property_tours_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_property_tours_propertyId_fkey') THEN
    ALTER TABLE "realty_property_tours" ADD CONSTRAINT "realty_property_tours_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_property_documents_accountId_fkey') THEN
    ALTER TABLE "realty_property_documents" ADD CONSTRAINT "realty_property_documents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_property_documents_propertyId_fkey') THEN
    ALTER TABLE "realty_property_documents" ADD CONSTRAINT "realty_property_documents_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_property_owners_accountId_fkey') THEN
    ALTER TABLE "realty_property_owners" ADD CONSTRAINT "realty_property_owners_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_exclusives_accountId_fkey') THEN
    ALTER TABLE "realty_exclusives" ADD CONSTRAINT "realty_exclusives_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_exclusives_propertyId_fkey') THEN
    ALTER TABLE "realty_exclusives" ADD CONSTRAINT "realty_exclusives_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_exclusives_ownerId_fkey') THEN
    ALTER TABLE "realty_exclusives" ADD CONSTRAINT "realty_exclusives_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "realty_property_owners"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_contacts_accountId_fkey') THEN
    ALTER TABLE "realty_contacts" ADD CONSTRAINT "realty_contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_contacts_assignedUserId_fkey') THEN
    ALTER TABLE "realty_contacts" ADD CONSTRAINT "realty_contacts_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_leads_accountId_fkey') THEN
    ALTER TABLE "realty_leads" ADD CONSTRAINT "realty_leads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_leads_contactId_fkey') THEN
    ALTER TABLE "realty_leads" ADD CONSTRAINT "realty_leads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "realty_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_leads_propertyId_fkey') THEN
    ALTER TABLE "realty_leads" ADD CONSTRAINT "realty_leads_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_leads_assignedUserId_fkey') THEN
    ALTER TABLE "realty_leads" ADD CONSTRAINT "realty_leads_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_lead_activities_accountId_fkey') THEN
    ALTER TABLE "realty_lead_activities" ADD CONSTRAINT "realty_lead_activities_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_lead_activities_leadId_fkey') THEN
    ALTER TABLE "realty_lead_activities" ADD CONSTRAINT "realty_lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "realty_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_lead_activities_userId_fkey') THEN
    ALTER TABLE "realty_lead_activities" ADD CONSTRAINT "realty_lead_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_search_profiles_accountId_fkey') THEN
    ALTER TABLE "realty_search_profiles" ADD CONSTRAINT "realty_search_profiles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_search_profiles_contactId_fkey') THEN
    ALTER TABLE "realty_search_profiles" ADD CONSTRAINT "realty_search_profiles_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "realty_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_tasks_accountId_fkey') THEN
    ALTER TABLE "realty_tasks" ADD CONSTRAINT "realty_tasks_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_tasks_userId_fkey') THEN
    ALTER TABLE "realty_tasks" ADD CONSTRAINT "realty_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "realty_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_tasks_leadId_fkey') THEN
    ALTER TABLE "realty_tasks" ADD CONSTRAINT "realty_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "realty_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_tasks_propertyId_fkey') THEN
    ALTER TABLE "realty_tasks" ADD CONSTRAINT "realty_tasks_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_visits_accountId_fkey') THEN
    ALTER TABLE "realty_visits" ADD CONSTRAINT "realty_visits_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_visits_propertyId_fkey') THEN
    ALTER TABLE "realty_visits" ADD CONSTRAINT "realty_visits_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_visits_leadId_fkey') THEN
    ALTER TABLE "realty_visits" ADD CONSTRAINT "realty_visits_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "realty_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_visits_userId_fkey') THEN
    ALTER TABLE "realty_visits" ADD CONSTRAINT "realty_visits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_keys_accountId_fkey') THEN
    ALTER TABLE "realty_keys" ADD CONSTRAINT "realty_keys_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_keys_propertyId_fkey') THEN
    ALTER TABLE "realty_keys" ADD CONSTRAINT "realty_keys_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_keys_holderUserId_fkey') THEN
    ALTER TABLE "realty_keys" ADD CONSTRAINT "realty_keys_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_leases_accountId_fkey') THEN
    ALTER TABLE "realty_leases" ADD CONSTRAINT "realty_leases_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_leases_propertyId_fkey') THEN
    ALTER TABLE "realty_leases" ADD CONSTRAINT "realty_leases_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_lease_parties_accountId_fkey') THEN
    ALTER TABLE "realty_lease_parties" ADD CONSTRAINT "realty_lease_parties_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_lease_parties_leaseId_fkey') THEN
    ALTER TABLE "realty_lease_parties" ADD CONSTRAINT "realty_lease_parties_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "realty_leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_lease_parties_contactId_fkey') THEN
    ALTER TABLE "realty_lease_parties" ADD CONSTRAINT "realty_lease_parties_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "realty_contacts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_rent_charges_accountId_fkey') THEN
    ALTER TABLE "realty_rent_charges" ADD CONSTRAINT "realty_rent_charges_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_rent_charges_leaseId_fkey') THEN
    ALTER TABLE "realty_rent_charges" ADD CONSTRAINT "realty_rent_charges_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "realty_leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_payments_accountId_fkey') THEN
    ALTER TABLE "realty_payments" ADD CONSTRAINT "realty_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_payments_chargeId_fkey') THEN
    ALTER TABLE "realty_payments" ADD CONSTRAINT "realty_payments_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "realty_rent_charges"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_payments_leaseId_fkey') THEN
    ALTER TABLE "realty_payments" ADD CONSTRAINT "realty_payments_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "realty_leases"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_payments_dealId_fkey') THEN
    ALTER TABLE "realty_payments" ADD CONSTRAINT "realty_payments_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "realty_deals"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_deposits_accountId_fkey') THEN
    ALTER TABLE "realty_deposits" ADD CONSTRAINT "realty_deposits_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_deposits_leaseId_fkey') THEN
    ALTER TABLE "realty_deposits" ADD CONSTRAINT "realty_deposits_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "realty_leases"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_maintenances_accountId_fkey') THEN
    ALTER TABLE "realty_maintenances" ADD CONSTRAINT "realty_maintenances_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_maintenances_propertyId_fkey') THEN
    ALTER TABLE "realty_maintenances" ADD CONSTRAINT "realty_maintenances_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_maintenances_leaseId_fkey') THEN
    ALTER TABLE "realty_maintenances" ADD CONSTRAINT "realty_maintenances_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "realty_leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_expenses_accountId_fkey') THEN
    ALTER TABLE "realty_expenses" ADD CONSTRAINT "realty_expenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_expenses_propertyId_fkey') THEN
    ALTER TABLE "realty_expenses" ADD CONSTRAINT "realty_expenses_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_inventory_checks_accountId_fkey') THEN
    ALTER TABLE "realty_inventory_checks" ADD CONSTRAINT "realty_inventory_checks_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_inventory_checks_leaseId_fkey') THEN
    ALTER TABLE "realty_inventory_checks" ADD CONSTRAINT "realty_inventory_checks_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "realty_leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_inventory_items_accountId_fkey') THEN
    ALTER TABLE "realty_inventory_items" ADD CONSTRAINT "realty_inventory_items_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_inventory_items_checkId_fkey') THEN
    ALTER TABLE "realty_inventory_items" ADD CONSTRAINT "realty_inventory_items_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "realty_inventory_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_deals_accountId_fkey') THEN
    ALTER TABLE "realty_deals" ADD CONSTRAINT "realty_deals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_deals_propertyId_fkey') THEN
    ALTER TABLE "realty_deals" ADD CONSTRAINT "realty_deals_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_deals_contactId_fkey') THEN
    ALTER TABLE "realty_deals" ADD CONSTRAINT "realty_deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "realty_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_commission_splits_accountId_fkey') THEN
    ALTER TABLE "realty_commission_splits" ADD CONSTRAINT "realty_commission_splits_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_commission_splits_dealId_fkey') THEN
    ALTER TABLE "realty_commission_splits" ADD CONSTRAINT "realty_commission_splits_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "realty_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_commission_splits_realtyUserId_fkey') THEN
    ALTER TABLE "realty_commission_splits" ADD CONSTRAINT "realty_commission_splits_realtyUserId_fkey" FOREIGN KEY ("realtyUserId") REFERENCES "realty_users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_landing_configs_accountId_fkey') THEN
    ALTER TABLE "realty_landing_configs" ADD CONSTRAINT "realty_landing_configs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_landing_configs_updatedByUserId_fkey') THEN
    ALTER TABLE "realty_landing_configs" ADD CONSTRAINT "realty_landing_configs_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_portal_accounts_accountId_fkey') THEN
    ALTER TABLE "realty_portal_accounts" ADD CONSTRAINT "realty_portal_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_portal_listings_accountId_fkey') THEN
    ALTER TABLE "realty_portal_listings" ADD CONSTRAINT "realty_portal_listings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_portal_listings_propertyId_fkey') THEN
    ALTER TABLE "realty_portal_listings" ADD CONSTRAINT "realty_portal_listings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "realty_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_threads_accountId_fkey') THEN
    ALTER TABLE "realty_threads" ADD CONSTRAINT "realty_threads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_threads_contactId_fkey') THEN
    ALTER TABLE "realty_threads" ADD CONSTRAINT "realty_threads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "realty_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_messages_accountId_fkey') THEN
    ALTER TABLE "realty_messages" ADD CONSTRAINT "realty_messages_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_messages_threadId_fkey') THEN
    ALTER TABLE "realty_messages" ADD CONSTRAINT "realty_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "realty_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_client_auth_tokens_accountId_fkey') THEN
    ALTER TABLE "realty_client_auth_tokens" ADD CONSTRAINT "realty_client_auth_tokens_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_support_tickets_accountId_fkey') THEN
    ALTER TABLE "realty_support_tickets" ADD CONSTRAINT "realty_support_tickets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_support_tickets_createdByUserId_fkey') THEN
    ALTER TABLE "realty_support_tickets" ADD CONSTRAINT "realty_support_tickets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "realty_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_support_messages_accountId_fkey') THEN
    ALTER TABLE "realty_support_messages" ADD CONSTRAINT "realty_support_messages_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_support_messages_ticketId_fkey') THEN
    ALTER TABLE "realty_support_messages" ADD CONSTRAINT "realty_support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "realty_support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'realty_admin_actions_accountId_fkey') THEN
    ALTER TABLE "realty_admin_actions" ADD CONSTRAINT "realty_admin_actions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "realty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$realty$;


-- ── 5. Seed de los 3 planes (editables después desde la tabla) ─────────
-- CERO precios escritos en la UI: la UI SIEMPRE lee de aquí. Estos
-- números son los mismos de FALLBACK_REALTY_PLAN_CONFIG
-- (src/lib/realty/plan-shared.ts), que es el fallback si la tabla está
-- vacía. Si cambias un precio aquí, cámbialo también allá.
--
-- messageQuota 0 = el plan NO incluye WhatsApp. El de $199 no lo tiene.
-- maxProperties -1 = ilimitado en los tres: lo que cambia entre planes es
-- el CUPO DE ARCHIVOS (storageQuotaMb), no cuántos inmuebles caben.
-- 3D/360 (tours3d) va en los TRES planes.

INSERT INTO "realty_plan_configs"
  ("planId", "name", "priceMonthly", "priceYearly", "maxUsers", "maxOffices", "maxProperties", "storageQuotaMb", "messageQuota", "features", "stripeLookupKey", "sortOrder", "isActive", "updatedAt")
VALUES
  ('PROPIETARIO', 'Propietario', 199, NULL, 1, 1, -1, 2048, 0, '{"properties":true,"leads":true,"publicWeb":true,"webEditor":true,"tours3d":true,"calculators":true,"rentals":true,"maintenance":true,"whatsapp":false,"whatsappInbox":false,"portalsFeed":false,"commissions":false,"multiOffice":false,"agentPages":false,"mls":false,"pld":false,"aiStudio":false,"advancedRoles":false,"analytics":false,"affiliates":false,"clientPortal":false}'::jsonb, NULL, 0, true, CURRENT_TIMESTAMP)
ON CONFLICT ("planId") DO NOTHING;

INSERT INTO "realty_plan_configs"
  ("planId", "name", "priceMonthly", "priceYearly", "maxUsers", "maxOffices", "maxProperties", "storageQuotaMb", "messageQuota", "features", "stripeLookupKey", "sortOrder", "isActive", "updatedAt")
VALUES
  ('ASESOR', 'Asesor', 349, NULL, 6, 1, -1, 10240, 500, '{"properties":true,"leads":true,"publicWeb":true,"webEditor":true,"tours3d":true,"calculators":true,"rentals":true,"maintenance":true,"whatsapp":true,"whatsappInbox":true,"portalsFeed":true,"commissions":true,"multiOffice":false,"agentPages":false,"mls":false,"pld":false,"aiStudio":false,"advancedRoles":false,"analytics":false,"affiliates":false,"clientPortal":true}'::jsonb, NULL, 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("planId") DO NOTHING;

INSERT INTO "realty_plan_configs"
  ("planId", "name", "priceMonthly", "priceYearly", "maxUsers", "maxOffices", "maxProperties", "storageQuotaMb", "messageQuota", "features", "stripeLookupKey", "sortOrder", "isActive", "updatedAt")
VALUES
  ('INMOBILIARIA', 'Inmobiliaria', 649, NULL, -1, -1, -1, 40960, 2000, '{"properties":true,"leads":true,"publicWeb":true,"webEditor":true,"tours3d":true,"calculators":true,"rentals":true,"maintenance":true,"whatsapp":true,"whatsappInbox":true,"portalsFeed":true,"commissions":true,"multiOffice":true,"agentPages":true,"mls":true,"pld":true,"aiStudio":true,"advancedRoles":true,"analytics":true,"affiliates":true,"clientPortal":true}'::jsonb, NULL, 2, true, CURRENT_TIMESTAMP)
ON CONFLICT ("planId") DO NOTHING;


-- ── 6. Parámetros de las calculadoras — SIN SEED, a propósito ─────────
-- realty_calc_params queda VACÍA. El ISAI lo fija cada congreso estatal y
-- la UMA se publica cada enero: meter aquí números sin verificar produce
-- cotizaciones que se ven correctas y están mal, que es peor que no tener
-- calculadora. La ola de calculadoras los captura con su fuente y su
-- fecha, y la pantalla avisa mientras la tabla esté vacía.
--
-- stateCode es NOT NULL con default 'MX' (= federal) a propósito: en un
-- índice único de Postgres cada NULL cuenta como distinto, así que con la
-- columna nullable se podrían colar dos UMA del mismo año sin que nada
-- se queje.


-- ── 7. Bucket privado de archivos del vertical ────────────────────────
-- realty-files guarda fotos de inmuebles, panorámicas propias y
-- DOCUMENTOS (escrituras, prediales, identificaciones). Es PRIVADO: nada
-- de esto puede quedar accesible con una URL adivinada. El panel entrega
-- SIEMPRE una signed URL de 5 minutos generada en el servidor DESPUÉS de
-- comprobar el accountId de la sesión.
--
-- file_size_limit 50 MB: las fotos ya se comprimen a WebP en el navegador
-- (≈300 KB), pero una panorámica equirectangular y un PDF de escritura
-- escaneada sí pesan. Es techo de seguridad, no de operación. El cupo
-- REAL por cuenta es storageQuotaMb del plan, y se lleva en
-- realty_accounts.storageUsedBytes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'realty-files',
  'realty-files',
  false,
  52428800,
  ARRAY['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 52428800,
      allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'application/pdf'];

-- SIN policies para anon/authenticated: storage.objects tiene RLS activo
-- por defecto en Supabase, así que "sin policy" = nadie entra con la anon
-- key (que SÍ se expone al navegador como NEXT_PUBLIC_SUPABASE_ANON_KEY).
-- La app sube, firma y borra con el service role, que bypassa RLS por
-- diseño — mismo criterio que barber y que el marketplace.
-- Se limpian por si una ejecución anterior las hubiera dejado abiertas.
DROP POLICY IF EXISTS "realty_files_auth_select" ON storage.objects;
DROP POLICY IF EXISTS "realty_files_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "realty_files_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "realty_files_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "realty_files_public_read" ON storage.objects;


-- ── 8. Verificación (solo lectura — correr DESPUÉS de aplicar 1-7) ────
-- 8.a) Deben salir 40 tablas.
-- SELECT count(*) FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'realty%';

-- 8.b) Deben salir 3 planes con 199 / 349 / 649.
-- SELECT "planId", "name", "priceMonthly", "maxUsers", "storageQuotaMb", "messageQuota"
-- FROM "realty_plan_configs" ORDER BY "sortOrder";

-- 8.c) El bucket debe ser PRIVADO (public = false).
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'realty-files';

-- 8.d) NO debe quedar ninguna policy de realty-files en storage.objects.
--      OJO: pg_policies guarda el esquema y la tabla POR SEPARADO. Con
--      tablename = 'storage.objects' esta consulta devolvía SIEMPRE vacío,
--      o sea un "todo bien" falso.
-- SELECT policyname FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'realty_files%';

-- 8.d-bis) 🔴 CHOQUE DE RUTAS — correr ANTES de anunciar el vertical.
--      /inmobiliaria, /inmobiliarias e /i son rutas ESTÁTICAS nuevas y una
--      ruta estática SIEMPRE le gana al catch-all /[slug] de las mini-webs
--      dentales. Si alguna clínica ya tiene uno de esos slugs, su sitio
--      público deja de resolver. La lista de slugs reservados de
--      src/app/api/check-slug/route.ts no los incluye (ese archivo está
--      fuera del allowlist de esta ola). Esta consulta debe devolver 0 filas:
-- SELECT id, name, slug FROM "Clinic"
-- WHERE slug IN ('i', 'inmobiliaria', 'inmobiliarias');

-- 8.e) Toda tabla de negocio debe tener accountId. Este SELECT lista las
--      que NO lo tienen: solo pueden salir realty_plan_configs y
--      realty_calc_params (las dos de plataforma).
-- SELECT t.table_name FROM information_schema.tables t
-- WHERE t.table_schema = 'public' AND t.table_name LIKE 'realty%'
--   AND NOT EXISTS (
--     SELECT 1 FROM information_schema.columns c
--     WHERE c.table_schema = 'public' AND c.table_name = t.table_name
--       AND c.column_name = 'accountId')
-- ORDER BY 1;
