-- ═══════════════════════════════════════════════════════════════════════
-- DaleControl DENTAL — WS1-T3 · ORTODONCIA OLA 1, «Acceso y permisos».
--
-- Tabla nueva, una fila por clínica: configuración del submenú
-- "Configuración" del módulo (doctor tratante por defecto, catálogo propio
-- de tipos de cita — C7 — y plantillas de mensaje).
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS; correrlo varias veces no da
-- errores ni duplicados. ADITIVO: no toca ninguna tabla existente.
-- PLANO: sin bloques DO (el SQL Editor de Rafael no los acepta).
--
-- El código (src/lib/orthodontics/clinic-settings-db.ts) tolera que esta
-- tabla aún no exista (P2021) y devuelve los defaults del módulo — pegar
-- este SQL no es bloqueante para que dev.108 siga funcionando.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run.
-- ⛔ NO correr `prisma migrate dev` ni `migrate deploy`.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "orthodontics_clinic_settings" (
  "clinicId"                TEXT PRIMARY KEY,
  "defaultTreatingDoctorId" TEXT,
  "appointmentTypes"        JSONB,
  "messageTemplates"        JSONB,
  "updatedBy"               TEXT,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- Sin FK a "clinics"/"users" a propósito (mismo criterio que
-- "clinic_bank_accounts"): esos modelos los tocan varias pantallas a la vez
-- en esta ola. La corrección de "clinicId" la da la sesión (nunca el
-- cliente), igual que en el resto del panel.

-- ── Comprobación (solo lee) ───────────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orthodontics_clinic_settings'
ORDER BY ordinal_position;
