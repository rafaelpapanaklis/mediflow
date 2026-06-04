-- Idioma del panel por clínica: "es" (default) | "en".
-- Lo usa el motor i18n (src/i18n) para elegir diccionario en el layout del
-- dashboard: clinic.locale ?? "es". Idempotente: si la columna ya existe, no falla.

ALTER TABLE "clinics"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'es';
