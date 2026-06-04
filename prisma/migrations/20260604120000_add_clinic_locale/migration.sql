-- Idioma del panel de la clínica: "es" (default) | "en".
-- Resuelto en el layout del dashboard (clinic.locale ?? "es") y usado por el
-- motor i18n (src/i18n) para elegir el diccionario activo.
ALTER TABLE "clinics" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'es';
