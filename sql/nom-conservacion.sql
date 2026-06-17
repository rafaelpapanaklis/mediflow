-- ════════════════════════════════════════════════════════════════════════
--  NOM-004 conservación / NOM-024 §7 — Anti-hard-delete / preservación
--  Rama: feat/nom-conservacion
--  Espejo EXACTO de los campos agregados a prisma/schema.prisma.
--  Aplicar en Supabase (SQL Editor) DESPUÉS de desplegar la rama / merge.
--  Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--  Sin migración destructiva: solo agrega columnas/índices; cero DROP.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Receta electrónica — anulación LÓGICA en vez de hard-delete (RX-11 / RX-06).
--    status NOT NULL DEFAULT 'ACTIVE' → las filas existentes quedan en 'ACTIVE'.
--    Una receta anulada se conserva; el QR público resuelve y muestra "ANULADA".
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "status"     TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "voidedAt"   TIMESTAMP(3);
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "voidedBy"   TEXT;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

-- 2) Archivo del expediente (radiografías, modelos 3D, fotos) — borrado LÓGICO (RET-01).
--    El blob en Storage se PRESERVA; deletedAt oculta el archivo de las vistas
--    activas (radiografías, modelos 3D, timeline, export) sin destruir el dato.
ALTER TABLE "patient_files" ADD COLUMN IF NOT EXISTS "deletedAt"    TIMESTAMP(3);
ALTER TABLE "patient_files" ADD COLUMN IF NOT EXISTS "deletedBy"    TEXT;
ALTER TABLE "patient_files" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
CREATE INDEX IF NOT EXISTS "patient_files_clinicId_deletedAt_idx"
  ON "patient_files" ("clinicId", "deletedAt");

-- 3) Clínica — archivado LÓGICO en vez de hard-delete con cascada (RET-01 / RET-12).
--    Eliminar una clínica JAMÁS debe cascada-destruir el expediente. La app marca
--    archivedAt y baja isPublic/landingActive; el expediente y los blobs quedan.
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "archivedAt"    TIMESTAMP(3);
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "archivedBy"    TEXT;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "archiveReason" TEXT;
