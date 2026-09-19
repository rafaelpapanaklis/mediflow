-- ============================================================
-- Plantillas de documentos — PASO 2 de 2: las tablas.
-- Aplicar manualmente en Supabase SQL editor, DESPUÉS de
-- sql/document-templates-1-enum.sql (en otro Run).
--
-- document_templates: los textos que la clínica escribe una vez
--   (Administración → Plantillas). `body` es HTML ya saneado en el servidor.
-- patient_documents: el documento llenado en la ficha del paciente. CONGELA
--   sus datos: `body` es el HTML final y `encabezado` la foto de los datos al
--   firmar. `templateId` es nullable + ON DELETE SET NULL: borrar la plantilla
--   no rompe el documento.
--
-- SQL plano e idempotente salvo los ADD CONSTRAINT (Postgres no tiene
-- ADD CONSTRAINT IF NOT EXISTS): si repites el Run, esos dan «already exists».
-- ============================================================

CREATE TABLE IF NOT EXISTS "document_templates" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "kind" "DocumentTemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_clinicId_kind_name_key"
    ON "document_templates"("clinicId", "kind", "name");
CREATE INDEX IF NOT EXISTS "document_templates_clinicId_kind_isActive_idx"
    ON "document_templates"("clinicId", "kind", "isActive");

CREATE TABLE IF NOT EXISTS "patient_documents" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "templateId" TEXT,
    "kind" "DocumentTemplateKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "encabezado" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "signedAt" TIMESTAMP(3),
    "firmaDoctorUrl" TEXT,
    "firmaPacienteUrl" TEXT,
    "modoFirma" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "patient_documents_clinicId_patientId_kind_createdAt_idx"
    ON "patient_documents"("clinicId", "patientId", "kind", "createdAt" DESC);

ALTER TABLE "document_templates"
    ADD CONSTRAINT "document_templates_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_templates"
    ADD CONSTRAINT "document_templates_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "patient_documents"
    ADD CONSTRAINT "patient_documents_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "clinics"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patient_documents"
    ADD CONSTRAINT "patient_documents_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patient_documents"
    ADD CONSTRAINT "patient_documents_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_documents"
    ADD CONSTRAINT "patient_documents_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "document_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma entra con el rol dueño y no pasa por RLS; encenderlo sin políticas
-- deja a anon/authenticated (la API pública de Supabase) sin acceso a nada.
ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_documents" ENABLE ROW LEVEL SECURITY;
